package store

import (
	"context"
	"database/sql"
	"encoding/csv"
	"errors"
	"hash/fnv"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ── 通知自动记账 ──────────────────────────────────────────────────

// FinNotificationInput 安卓通知监听推送的支付通知。
type FinNotificationInput struct {
	PackageName string `json:"package_name"`
	AppName     string `json:"app_name"`
	Title       string `json:"title"`
	Text        string `json:"text"`
	PostedAt    string `json:"posted_at"`
}

// FinNotificationResult 通知入账结果。
type FinNotificationResult struct {
	Matched     bool            `json:"matched"`
	Duplicate   bool            `json:"duplicate"`
	Source      string          `json:"source,omitempty"`
	Reason      string          `json:"reason,omitempty"`
	Transaction *FinTransaction `json:"transaction,omitempty"`
}

var (
	reNotifyCurrency = regexp.MustCompile(`(?:¥|￥|RMB|CNY)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)`)
	reNotifyYuan     = regexp.MustCompile(`([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*元`)
	reNotifyKeyword  = regexp.MustCompile(`(?:付款|支付|消费|收款|到账|转账|退款|金额)[^0-9]{0,6}([0-9][0-9,]*(?:\.[0-9]{1,2})?)`)
	reNoticeTradeNo  = regexp.MustCompile(`(?:交易单号|交易订单号|订单号|商户单号|商家订单号|交易号)\s*[:：]?\s*([A-Za-z0-9]{8,})`)
)

type parsedNotice struct {
	source     string
	typ        string
	amount     int64
	note       string
	occurredAt string
	dedupeKey  string
}

func containsAny(s string, words ...string) bool {
	for _, w := range words {
		if strings.Contains(s, w) {
			return true
		}
	}
	return false
}

func fnvID(s string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(s))
	v := int64(h.Sum64() & 0x7fffffffffffffff)
	if v == 0 {
		v = 1
	}
	return v
}

// noticeTime 兼容毫秒时间戳与常规日期字符串。
func noticeTime(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return time.Now().Format("2006-01-02 15:04")
	}
	if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
		if n > 1e12 {
			n /= 1000
		}
		return time.Unix(n, 0).Format("2006-01-02 15:04")
	}
	return normOccurred(v)
}

// noticeAmount 从通知文本中提取金额（分）。
func noticeAmount(text string) int64 {
	for _, re := range []*regexp.Regexp{reNotifyCurrency, reNotifyYuan, reNotifyKeyword} {
		for _, m := range re.FindAllStringSubmatch(text, -1) {
			if len(m) < 2 {
				continue
			}
			if v := parseBillAmount(m[1]); v > 0 {
				return v
			}
		}
	}
	return 0
}

func parseFinanceNotice(in FinNotificationInput) (parsedNotice, bool) {
	pkg := strings.ToLower(strings.TrimSpace(in.PackageName))
	title := strings.TrimSpace(in.Title)
	text := strings.TrimSpace(in.Text)
	all := strings.TrimSpace(title + " " + text)
	source := ""
	switch {
	case pkg == "com.eg.android.alipaygphone":
		source = "alipay"
	case pkg == "com.tencent.mm":
		source = "wechat"
	case pkg == "" && strings.Contains(all, "支付宝"):
		source = "alipay"
	case pkg == "" && strings.Contains(all, "微信支付"):
		source = "wechat"
	}
	if source == "" {
		return parsedNotice{}, false
	}
	// 微信的聊天消息也来自同一包名，必须含支付语义才处理。
	if source == "wechat" && !containsAny(all, "微信支付", "支付成功", "付款", "收款", "到账", "转账", "退款", "扣款") {
		return parsedNotice{}, false
	}
	if source == "alipay" && !containsAny(all, "付款", "支付", "收款", "到账", "转账", "退款", "扣款", "消费") {
		return parsedNotice{}, false
	}
	amount := noticeAmount(all)
	if amount <= 0 {
		return parsedNotice{}, false
	}
	typ := "expense"
	if strings.Contains(all, "退款") {
		typ = "income"
	} else if containsAny(all, "收款", "到账", "收入", "转入", "收到") &&
		!containsAny(all, "付款", "支付成功", "消费", "扣款") {
		typ = "income"
	}
	note := all
	if runes := []rune(note); len(runes) > 120 {
		note = string(runes[:120])
	}
	occurred := noticeTime(in.PostedAt)
	// 无交易单号时用「来源+金额+正文+分钟」去重：同一通知重发只记一次，
	// 不同时间的两笔同额消费仍可分别入账。
	key := "notification|" + source + "|" + typ + "|" + strconv.FormatInt(amount, 10) + "|" + occurred + "|" + note
	if m := reNoticeTradeNo.FindStringSubmatch(all); len(m) > 1 {
		key = "notification|trade|" + source + "|" + m[1]
	}
	return parsedNotice{
		source: source, typ: typ, amount: amount, note: note,
		occurredAt: occurred, dedupeKey: key,
	}, true
}

// notificationAccountTx 优先使用与通知来源同类型的账户（支付宝 / 微信），否则默认账户。
func notificationAccountTx(ctx context.Context, ex interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, instanceID int64, source string) (int64, error) {
	kind := "alipay"
	if source == "wechat" {
		kind = "wechat"
	}
	if id, ok := queryIntRow(ctx, ex,
		`SELECT id FROM fin_accounts WHERE instance_id=? AND archived=0 AND kind=? ORDER BY sort, id LIMIT 1`,
		instanceID, kind); ok {
		return id, nil
	}
	return defaultAccountTx(ctx, ex, instanceID)
}

// categoryIDByName 按分类名取 ID，缺失时回退该类型第一个分类。
func categoryIDByName(ctx context.Context, ex interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, instanceID int64, typ, name string) int64 {
	name = strings.TrimSpace(name)
	if name != "" {
		if id, ok := queryIntRow(ctx, ex,
			`SELECT id FROM fin_categories WHERE instance_id=? AND type=? AND name=? ORDER BY id LIMIT 1`,
			instanceID, typ, name); ok {
			return id
		}
	}
	id, _ := queryIntRow(ctx, ex,
		`SELECT id FROM fin_categories WHERE instance_id=? AND type=? ORDER BY sort, id LIMIT 1`, instanceID, typ)
	return id
}

type categoryKeyword struct {
	name  string
	words []string
}

var expenseCategoryKeywords = []categoryKeyword{
	{"餐饮", []string{"餐饮", "外卖", "饿了么", "美团", "肯德基", "麦当劳", "星巴克", "咖啡", "奶茶", "饭店", "餐厅", "面馆", "烧烤"}},
	{"食品", []string{"超市", "便利店", "食品", "生鲜", "菜场", "水果", "粮油", "零食", "乳品", "盒马", "永辉"}},
	{"交通", []string{"交通", "地铁", "公交", "打车", "滴滴", "高德", "铁路", "12306", "加油", "停车", "高速", "充电桩"}},
	{"购物", []string{"淘宝", "天猫", "京东", "拼多多", "商城", "旗舰店", "购物", "百货", "唯品会"}},
	{"日用", []string{"日用", "清洁", "纸品", "洗护", "家居"}},
	{"居住", []string{"房租", "租金", "物业", "水费", "电费", "燃气", "话费", "宽带", "供暖"}},
	{"娱乐", []string{"电影", "游戏", "娱乐", "KTV", "演出", "会员", "视频"}},
	{"医疗", []string{"医院", "药房", "药店", "医疗", "挂号", "体检"}},
	{"教育", []string{"学费", "培训", "课程", "书店", "教育", "考试"}},
	{"人情", []string{"红包", "礼金", "随礼", "捐赠"}},
}

var incomeCategoryKeywords = []categoryKeyword{
	{"工资", []string{"工资", "薪资", "代发", "劳务"}},
	{"奖金", []string{"奖金", "奖励", "补贴"}},
	{"理财", []string{"利息", "理财", "基金", "分红", "收益"}},
	{"兼职", []string{"兼职", "稿费", "佣金", "外快"}},
	{"红包", []string{"红包", "礼金"}},
}

// importCategoryName 按交易对方 / 商品说明等文本启发式匹配分类名。
func importCategoryName(typ, text string) string {
	rules := expenseCategoryKeywords
	def := "其他支出"
	if typ == "income" {
		rules = incomeCategoryKeywords
		def = "其他收入"
	}
	t := strings.ToLower(text)
	for _, rule := range rules {
		for _, w := range rule.words {
			if strings.Contains(t, strings.ToLower(w)) {
				return rule.name
			}
		}
	}
	return def
}

// RecordNotification 解析通知并幂等入账（source=notification）。
func (r *FinanceRepo) RecordNotification(ctx context.Context, instanceID int64, in FinNotificationInput, user string) (FinNotificationResult, error) {
	p, ok := parseFinanceNotice(in)
	if !ok {
		return FinNotificationResult{Matched: false, Reason: "未识别为微信 / 支付宝支付通知"}, nil
	}
	if err := r.ensureDefaults(ctx, instanceID); err != nil {
		return FinNotificationResult{}, err
	}
	refID := fnvID(p.dedupeKey)
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return FinNotificationResult{}, err
	}
	defer tx.Rollback()
	accountID, err := notificationAccountTx(ctx, tx, instanceID, p.source)
	if err != nil {
		return FinNotificationResult{}, err
	}
	categoryID := categoryIDByName(ctx, tx, instanceID, p.typ, importCategoryName(p.typ, p.note))
	res, err := tx.ExecContext(ctx,
		`INSERT OR IGNORE INTO fin_transactions(instance_id, type, amount, account_id, category_id,
			currency, note, source, ref_type, ref_id, occurred_at, created_by)
		 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
		instanceID, p.typ, p.amount, accountID, categoryID, "CNY", p.note,
		"notification", "notification", refID, p.occurredAt, user)
	if err != nil {
		return FinNotificationResult{}, err
	}
	n, _ := res.RowsAffected()
	var id int64
	duplicate := n == 0
	if duplicate {
		id, _ = queryIntRow(ctx, tx,
			`SELECT id FROM fin_transactions WHERE instance_id=? AND ref_type='notification' AND ref_id=? AND deleted_at=''`,
			instanceID, refID)
	} else {
		id, _ = res.LastInsertId()
	}
	if err := tx.Commit(); err != nil {
		return FinNotificationResult{}, err
	}
	out := FinNotificationResult{Matched: true, Duplicate: duplicate, Source: p.source}
	if id > 0 {
		if t, err := r.GetTransaction(ctx, instanceID, id); err == nil {
			out.Transaction = &t
		}
	}
	return out, nil
}

// ── 官方账单 CSV 导入 ─────────────────────────────────────────────

// FinImportInput 账单导入入参；Commit=false 时仅预览。
type FinImportInput struct {
	Content   string `json:"content"`
	AccountID int64  `json:"account_id"`
	Commit    bool   `json:"commit"`
}

// FinImportItem 单条账单解析结果。
type FinImportItem struct {
	Line         int    `json:"line"`
	Source       string `json:"source"`
	Type         string `json:"type"`
	Amount       int64  `json:"amount"`
	OccurredAt   string `json:"occurred_at"`
	Counterparty string `json:"counterparty"`
	Note         string `json:"note"`
	Tags         string `json:"tags,omitempty"`
	CategoryID   int64  `json:"category_id"`
	CategoryName string `json:"category_name"`
	Duplicate    bool   `json:"duplicate"`
	Skipped      bool   `json:"skipped"`
	Reason       string `json:"reason,omitempty"`
}

// FinImportResult 导入 / 预览汇总。
type FinImportResult struct {
	Source     string          `json:"source"`
	Total      int             `json:"total"`
	Importable int             `json:"importable"`
	Imported   int             `json:"imported"`
	Duplicates int             `json:"duplicates"`
	Skipped    int             `json:"skipped"`
	Items      []FinImportItem `json:"items"`
	Errors     []string        `json:"errors"`
}

func (o *FinImportResult) appendItem(it FinImportItem, commit bool) {
	if !commit && len(o.Items) < 100 {
		o.Items = append(o.Items, it)
	}
}

type billColumns struct {
	time, dir, amount, counterparty, product, status, tradeNo, merchantNo, kind, method int
}

func billCell(rec []string, idx int) string {
	if idx < 0 || idx >= len(rec) {
		return ""
	}
	// 微信导出会给日期 / 单号加反引号防止 Excel 自动格式化，读取时统一去掉。
	return strings.Trim(strings.TrimSpace(rec[idx]), "`\"")
}

func pickCol(headers []string, names ...string) int {
	for _, want := range names {
		for i, h := range headers {
			if h == want {
				return i
			}
		}
	}
	for _, want := range names {
		for i, h := range headers {
			if strings.Contains(h, want) {
				return i
			}
		}
	}
	return -1
}

func findBillColumns(records [][]string) (billColumns, int, bool) {
	for i, rec := range records {
		if i > 60 {
			break
		}
		headers := make([]string, len(rec))
		for j, h := range rec {
			headers[j] = strings.TrimSpace(h)
		}
		timeCol := pickCol(headers, "交易时间", "交易创建时间", "创建时间")
		amountCol := pickCol(headers, "金额(元)", "金额（元）", "金额")
		dirCol := pickCol(headers, "收/支", "收支")
		if timeCol < 0 || amountCol < 0 || dirCol < 0 {
			continue
		}
		cols := billColumns{-1, -1, -1, -1, -1, -1, -1, -1, -1, -1}
		cols.time = timeCol
		cols.amount = amountCol
		cols.dir = dirCol
		cols.counterparty = pickCol(headers, "交易对方", "对方")
		cols.product = pickCol(headers, "商品说明", "商品名称", "商品")
		cols.status = pickCol(headers, "交易状态", "当前状态", "状态")
		cols.tradeNo = pickCol(headers, "交易订单号", "交易单号", "交易号")
		cols.merchantNo = pickCol(headers, "商家订单号", "商户单号", "商户订单号")
		cols.kind = pickCol(headers, "交易分类", "交易类型")
		cols.method = pickCol(headers, "收/付款方式", "支付方式", "付款方式")
		return cols, i, true
	}
	return billColumns{}, 0, false
}

func readBillCSV(content string) ([][]string, error) {
	rd := csv.NewReader(strings.NewReader(content))
	rd.FieldsPerRecord = -1
	rd.LazyQuotes = true
	rd.TrimLeadingSpace = true
	records := make([][]string, 0, 512)
	for {
		rec, err := rd.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			if len(records) == 0 {
				return nil, errors.New("账单格式无法解析，请确认为官方导出的 CSV")
			}
			continue
		}
		records = append(records, rec)
	}
	if len(records) == 0 {
		return nil, errors.New("账单内容为空")
	}
	return records, nil
}

func detectBillSource(content string) string {
	if strings.Contains(content, "微信支付") || strings.Contains(content, "微信账单") {
		return "wechat"
	}
	if strings.Contains(content, "支付宝") {
		return "alipay"
	}
	return "bill"
}

func looksLikeBillTime(v string) bool {
	v = strings.TrimSpace(v)
	return len(v) >= 10 && strings.Contains(v, "-")
}

func billDirection(v string) string {
	v = strings.TrimSpace(v)
	switch {
	case strings.Contains(v, "不计"):
		return ""
	case strings.Contains(v, "支出"), v == "支":
		return "expense"
	case strings.Contains(v, "收入"), v == "收":
		return "income"
	}
	return ""
}

func billStatusSkipped(v string) bool {
	return containsAny(v, "关闭", "失败", "撤销")
}

func parseBillAmount(raw string) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	raw = strings.NewReplacer("¥", "", "￥", "", "元", "", ",", "", "，", "", " ", "").Replace(raw)
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || v <= 0 {
		return 0
	}
	cents := int64(math.Round(v * 100))
	if cents > 100000000 {
		return 0
	}
	return cents
}

func buildBillNote(rec []string, cols billColumns, counterparty string) string {
	parts := make([]string, 0, 2)
	if counterparty != "" {
		parts = append(parts, counterparty)
	}
	product := billCell(rec, cols.product)
	if product != "" && product != counterparty {
		parts = append(parts, product)
	}
	note := strings.TrimSpace(strings.Join(parts, " "))
	if note == "" {
		note = billCell(rec, cols.kind)
	}
	if runes := []rune(note); len(runes) > 200 {
		note = string(runes[:200])
	}
	return note
}

func billCategoryText(rec []string, cols billColumns, counterparty string) string {
	return strings.Join([]string{
		counterparty, billCell(rec, cols.product), billCell(rec, cols.kind), billCell(rec, cols.method),
	}, " ")
}

func billRefID(source string, rec []string, cols billColumns, item FinImportItem) int64 {
	trade := billCell(rec, cols.tradeNo)
	if trade == "" {
		trade = billCell(rec, cols.merchantNo)
	}
	if trade != "" {
		return fnvID("import|" + source + "|" + trade)
	}
	return fnvID("import|" + source + "|" + item.OccurredAt + "|" +
		strconv.FormatInt(item.Amount, 10) + "|" + item.Counterparty + "|" + item.Note)
}

func txRefExists(ctx context.Context, ex interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, instanceID int64, refType string, refID int64) bool {
	_, ok := queryIntRow(ctx, ex,
		`SELECT 1 FROM fin_transactions WHERE instance_id=? AND ref_type=? AND ref_id=? AND deleted_at=''`,
		instanceID, refType, refID)
	return ok
}

// ImportBill 解析支付宝 / 微信官方账单、鲨鱼记账等账本 CSV；Commit=true 时写入流水（幂等）。
func (r *FinanceRepo) ImportBill(ctx context.Context, instanceID int64, in FinImportInput, user string) (FinImportResult, error) {
	out := FinImportResult{Items: []FinImportItem{}, Errors: []string{}}
	content := strings.TrimSpace(strings.TrimPrefix(in.Content, "\uFEFF"))
	if content == "" {
		return out, errors.New("账单内容为空")
	}
	records, err := readBillCSV(content)
	if err != nil {
		return out, err
	}
	cols, headerAt, isBill := findBillColumns(records)
	var ledgerCols ledgerColumns
	var ledgerHeaderAt int
	isLedger := false
	if !isBill {
		ledgerCols, ledgerHeaderAt, isLedger = findLedgerColumns(records)
	}
	if !isBill && !isLedger {
		return out, errors.New("未识别到账单表头（支持支付宝 / 微信官方账单与鲨鱼记账等账本导出的 CSV，需包含日期和金额列）")
	}
	if isBill {
		out.Source = detectBillSource(content)
	} else {
		out.Source = detectLedgerSource(content)
	}
	if err := r.ensureDefaults(ctx, instanceID); err != nil {
		return out, err
	}

	var ex finImportExecer
	var tx *sql.Tx
	accountID := in.AccountID
	if in.Commit {
		tx, err = r.db.BeginTx(ctx, nil)
		if err != nil {
			return out, err
		}
		defer tx.Rollback()
		if accountID > 0 {
			if err := r.checkAccount(ctx, instanceID, accountID); err != nil {
				return out, err
			}
		} else {
			accountID, err = defaultAccountTx(ctx, tx, instanceID)
			if err != nil {
				return out, err
			}
		}
		ex = tx
	} else {
		ex = r.db
	}

	if isBill {
		if err := r.importBillRows(ctx, ex, instanceID, accountID, records, cols, headerAt, &out, in.Commit, user); err != nil {
			return out, err
		}
	} else if err := r.importLedgerRows(ctx, ex, instanceID, accountID, records, ledgerCols, ledgerHeaderAt, &out, in.Commit, user); err != nil {
		return out, err
	}

	if in.Commit {
		if err := tx.Commit(); err != nil {
			return out, err
		}
	}
	return out, nil
}

// importBillRows 导入支付宝 / 微信官方账单行。
func (r *FinanceRepo) importBillRows(ctx context.Context, ex finImportExecer, instanceID, accountID int64,
	records [][]string, cols billColumns, headerAt int, out *FinImportResult, commit bool, user string) error {
	for i := headerAt + 1; i < len(records); i++ {
		rec := records[i]
		if len(rec) == 0 {
			continue
		}
		timeCell := billCell(rec, cols.time)
		if !looksLikeBillTime(timeCell) {
			continue
		}
		out.Total++
		item := FinImportItem{Line: i + 1, Source: out.Source, OccurredAt: normOccurred(timeCell)}
		item.Counterparty = billCell(rec, cols.counterparty)
		item.Note = buildBillNote(rec, cols, item.Counterparty)
		item.Type = billDirection(billCell(rec, cols.dir))
		if item.Type == "" {
			item.Skipped, item.Reason = true, "不计收支"
			out.Skipped++
			out.appendItem(item, commit)
			continue
		}
		item.Amount = parseBillAmount(billCell(rec, cols.amount))
		if item.Amount <= 0 {
			item.Skipped, item.Reason = true, "金额无法解析"
			out.Skipped++
			out.appendItem(item, commit)
			continue
		}
		if status := billCell(rec, cols.status); billStatusSkipped(status) {
			item.Skipped, item.Reason = true, "交易状态："+status
			out.Skipped++
			out.appendItem(item, commit)
			continue
		}
		catName := importCategoryName(item.Type, billCategoryText(rec, cols, item.Counterparty))
		item.CategoryID = categoryIDByName(ctx, ex, instanceID, item.Type, catName)
		item.CategoryName = catName
		refID := billRefID(out.Source, rec, cols, item)
		if txRefExists(ctx, ex, instanceID, "import", refID) {
			item.Duplicate = true
			out.Duplicates++
			out.appendItem(item, commit)
			continue
		}
		if !commit {
			out.Importable++
			out.appendItem(item, false)
			continue
		}
		res, err := ex.ExecContext(ctx,
			`INSERT OR IGNORE INTO fin_transactions(instance_id, type, amount, account_id, category_id,
				currency, note, source, ref_type, ref_id, occurred_at, created_by)
			 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
			instanceID, item.Type, item.Amount, accountID, item.CategoryID, "CNY", item.Note,
			"import", "import", refID, item.OccurredAt, user)
		if err != nil {
			out.Errors = append(out.Errors, "第"+strconv.Itoa(i+1)+"行："+err.Error())
			out.Skipped++
			continue
		}
		if n, _ := res.RowsAffected(); n == 0 {
			item.Duplicate = true
			out.Duplicates++
		} else {
			out.Imported++
			out.Importable++
		}
		out.appendItem(item, true)
	}
	return nil
}
