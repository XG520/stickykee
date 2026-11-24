package store

import (
	"context"
	"database/sql"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ── 鲨鱼记账 / 通用账本 CSV 导入 ────────────────────────────────
//
// 支付宝 / 微信官方账单有固定表头，鲨鱼记账等第三方账本导出的 CSV 表头更自由，
// 这里按「日期 + 金额」定位表头，再自动识别收/支、分类、备注、标签等列；
// 分类先按别名映射到内置分类，映射不到的原样新建，保证金额与分类都不丢。

type finImportExecer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

type ledgerColumns struct {
	time, dir, amount, category, note, tags, counterparty int
}

func findLedgerColumns(records [][]string) (ledgerColumns, int, bool) {
	for i, rec := range records {
		if i > 60 {
			break
		}
		headers := make([]string, len(rec))
		for j, h := range rec {
			headers[j] = strings.Trim(strings.TrimSpace(h), "`\"")
		}
		timeCol := pickCol(headers, "日期", "时间", "记账日期", "交易日期", "账目日期", "日期时间")
		amountCol := pickCol(headers, "金额(元)", "金额（元）", "收支金额", "金额")
		if timeCol < 0 || amountCol < 0 {
			continue
		}
		dirCol := pickCol(headers, "收/支", "收支", "收支类型", "账目类型", "方向", "类型")
		catCol := pickCol(headers, "分类", "类别", "账目分类", "收支分类", "项目")
		noteCol := pickCol(headers, "备注", "说明", "备注信息", "描述", "账目备注")
		tagCol := pickCol(headers, "标签", "tag", "Tag")
		cpCol := pickCol(headers, "交易对方", "对方", "商家", "商户")
		// 只有日期和金额不足以确认是账本，至少还要有分类 / 收支 / 备注之一。
		if catCol < 0 && dirCol < 0 && noteCol < 0 {
			continue
		}
		cols := ledgerColumns{-1, -1, -1, -1, -1, -1, -1}
		cols.time, cols.amount = timeCol, amountCol
		cols.dir, cols.category = dirCol, catCol
		cols.note, cols.tags, cols.counterparty = noteCol, tagCol, cpCol
		return cols, i, true
	}
	return ledgerColumns{}, 0, false
}

func detectLedgerSource(content string) string {
	if strings.Contains(content, "鲨鱼") || strings.Contains(strings.ToLower(content), "shark") {
		return "shark"
	}
	return "ledger"
}

var reLedgerTime = regexp.MustCompile(`^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{1,2})(?::\d{1,2})?)?`)

// parseLedgerTime 兼容 2024-01-02、2024/1/2、2024年1月2日、带时分秒以及 Excel 日期序列号。
func parseLedgerTime(raw string) (string, bool) {
	v := strings.Trim(strings.TrimSpace(raw), "`\"")
	if v == "" {
		return "", false
	}
	m := reLedgerTime.FindStringSubmatch(v)
	if m == nil {
		if n, err := strconv.Atoi(v); err == nil && n > 20000 && n < 80000 {
			d := time.Date(1899, 12, 30, 0, 0, 0, 0, time.Local).AddDate(0, 0, n)
			return d.Format("2006-01-02 15:04"), true
		}
		return "", false
	}
	year, _ := strconv.Atoi(m[1])
	month, _ := strconv.Atoi(m[2])
	day, _ := strconv.Atoi(m[3])
	hour, minute := 0, 0
	if m[4] != "" {
		hour, _ = strconv.Atoi(m[4])
		minute, _ = strconv.Atoi(m[5])
	}
	if month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 {
		return "", false
	}
	return time.Date(year, time.Month(month), day, hour, minute, 0, 0, time.Local).
		Format("2006-01-02 15:04"), true
}

// parseLedgerAmount 解析金额（分），同时返回是否带负号（负号通常代表支出）。
func parseLedgerAmount(raw string) (int64, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, false
	}
	neg := strings.HasPrefix(raw, "-")
	cleaned := strings.NewReplacer(
		"¥", "", "￥", "", "元", "", ",", "", "，", "", " ", "", "+", "",
	).Replace(raw)
	v, err := strconv.ParseFloat(cleaned, 64)
	if err != nil || v == 0 {
		return 0, false
	}
	if v < 0 {
		neg = true
		v = -v
	}
	cents := int64(math.Round(v * 100))
	if cents <= 0 || cents > 100000000 {
		return 0, false
	}
	return cents, neg
}

// ledgerDirection 解析收/支列；转账、还款等非收支账目跳过。
func ledgerDirection(v string) (typ, skipReason string) {
	s := strings.TrimSpace(v)
	if s == "" {
		return "", ""
	}
	low := strings.ToLower(s)
	if containsAny(low, "不计", "转账", "transfer", "还款", "借款", "借入", "借出") {
		return "", "非收支账目：" + s
	}
	switch {
	case containsAny(low, "支出", "支", "expense", "out", "-"):
		return "expense", ""
	case containsAny(low, "收入", "收", "income", "in", "+"):
		return "income", ""
	}
	return "", ""
}

type ledgerCategoryRule struct{ key, name string }

var ledgerExpenseAliases = []ledgerCategoryRule{
	{"早餐", "餐饮"}, {"早饭", "餐饮"}, {"午餐", "餐饮"}, {"午饭", "餐饮"},
	{"晚餐", "餐饮"}, {"晚饭", "餐饮"}, {"夜宵", "餐饮"}, {"外卖", "餐饮"},
	{"餐饮", "餐饮"}, {"美食", "餐饮"}, {"咖啡", "餐饮"}, {"奶茶", "餐饮"},
	{"零食", "食品"}, {"饮料", "食品"}, {"买菜", "食品"}, {"食材", "食品"},
	{"生鲜", "食品"}, {"水果", "食品"}, {"超市", "食品"}, {"食品", "食品"},
	{"交通", "交通"}, {"公交", "交通"}, {"地铁", "交通"}, {"打车", "交通"},
	{"出租", "交通"}, {"滴滴", "交通"}, {"加油", "交通"}, {"停车", "交通"},
	{"过路", "交通"}, {"火车", "交通"}, {"高铁", "交通"}, {"机票", "交通"},
	{"购物", "购物"}, {"衣服", "购物"}, {"服饰", "购物"}, {"鞋", "购物"},
	{"包包", "购物"}, {"化妆", "购物"}, {"护肤", "购物"}, {"数码", "购物"},
	{"电子", "购物"}, {"家电", "购物"},
	{"日用", "日用"}, {"家居", "日用"}, {"清洁", "日用"}, {"洗护", "日用"},
	{"住房", "居住"}, {"房租", "居住"}, {"房贷", "居住"}, {"物业", "居住"},
	{"水费", "居住"}, {"电费", "居住"}, {"燃气", "居住"}, {"煤气", "居住"},
	{"取暖", "居住"}, {"居住", "居住"},
	{"通讯", "通讯"}, {"话费", "通讯"}, {"流量", "通讯"}, {"宽带", "通讯"}, {"网费", "通讯"},
	{"娱乐", "娱乐"}, {"游戏", "娱乐"}, {"电影", "娱乐"}, {"唱歌", "娱乐"},
	{"ktv", "娱乐"}, {"会员", "娱乐"}, {"演出", "娱乐"}, {"按摩", "娱乐"},
	{"旅游", "旅游"}, {"旅行", "旅游"}, {"酒店", "旅游"}, {"住宿", "旅游"},
	{"景点", "旅游"}, {"门票", "旅游"}, {"度假", "旅游"},
	{"医疗", "医疗"}, {"看病", "医疗"}, {"医院", "医疗"}, {"药品", "医疗"},
	{"药房", "医疗"}, {"体检", "医疗"}, {"挂号", "医疗"},
	{"学习", "教育"}, {"教育", "教育"}, {"培训", "教育"}, {"课程", "教育"},
	{"学费", "教育"}, {"考试", "教育"}, {"文具", "教育"}, {"书店", "教育"},
	{"运动", "运动"}, {"健身", "运动"}, {"体育", "运动"}, {"游泳", "运动"}, {"瑜伽", "运动"},
	{"宠物", "宠物"}, {"猫", "宠物"}, {"狗", "宠物"},
	{"人情", "人情"}, {"红包", "人情"}, {"礼金", "人情"}, {"送礼", "人情"},
	{"请客", "人情"}, {"随礼", "人情"}, {"捐赠", "人情"},
	{"其他", "其他支出"}, {"其它", "其他支出"}, {"未知", "其他支出"}, {"杂项", "其他支出"},
}

var ledgerIncomeAliases = []ledgerCategoryRule{
	{"工资", "工资"}, {"薪资", "工资"}, {"薪水", "工资"}, {"代发", "工资"}, {"劳务", "工资"},
	{"奖金", "奖金"}, {"奖励", "奖金"}, {"补贴", "奖金"}, {"提成", "奖金"}, {"绩效", "奖金"},
	{"理财", "理财"}, {"利息", "理财"}, {"基金", "理财"}, {"股票", "理财"},
	{"分红", "理财"}, {"收益", "理财"}, {"投资", "理财"},
	{"兼职", "兼职"}, {"外快", "兼职"}, {"稿费", "兼职"}, {"佣金", "兼职"}, {"副业", "兼职"},
	{"红包", "红包"}, {"礼金", "红包"}, {"收礼", "红包"},
	{"其他", "其他收入"}, {"其它", "其他收入"}, {"未知", "其他收入"},
}

func ledgerSeedNames(typ string) []string {
	src := seedExpenseCategories
	if typ == "income" {
		src = seedIncomeCategories
	}
	out := make([]string, 0, len(src))
	for _, c := range src {
		out = append(out, c.name)
	}
	return out
}

func ledgerDefaultCategory(typ string) string {
	if typ == "income" {
		return "其他收入"
	}
	return "其他支出"
}

// ledgerCategoryMatch 把第三方账本的分类名映射到内置分类。
func ledgerCategoryMatch(typ, raw string) (string, bool) {
	raw = sanitizeLedgerCategory(raw)
	if raw == "" {
		return "", false
	}
	for _, n := range ledgerSeedNames(typ) {
		if raw == n {
			return n, true
		}
	}
	rules := ledgerExpenseAliases
	if typ == "income" {
		rules = ledgerIncomeAliases
	}
	low := strings.ToLower(raw)
	for _, r := range rules {
		if strings.Contains(low, r.key) {
			return r.name, true
		}
	}
	for _, n := range ledgerSeedNames(typ) {
		if strings.Contains(raw, n) || strings.Contains(n, raw) {
			return n, true
		}
	}
	return "", false
}

// ledgerIncomeHint 无收/支列时推断是否为收入：只有明确只属于收入的分类才算收入，
// 「其他」「红包」这类收支都有的分类按支出处理，避免把支出误记成收入。
func ledgerIncomeHint(raw string) bool {
	if sanitizeLedgerCategory(raw) == "" {
		return false
	}
	if _, ok := ledgerCategoryMatch("expense", raw); ok {
		return false
	}
	_, ok := ledgerCategoryMatch("income", raw)
	return ok
}

func sanitizeLedgerCategory(raw string) string {
	raw = strings.Trim(strings.TrimSpace(raw), "`\"'")
	raw = strings.Join(strings.Fields(raw), "")
	for _, p := range []string{"支出-", "收入-", "支出:", "收入:"} {
		raw = strings.TrimPrefix(raw, p)
	}
	if r := []rune(raw); len(r) > 12 {
		raw = string(r[:12])
	}
	return raw
}

var ledgerCategoryIcons = []struct {
	keys []string
	icon string
}{
	{[]string{"餐", "饭", "外卖", "咖啡", "奶茶"}, "restaurant"},
	{[]string{"食品", "零食", "水果", "买菜"}, "local_grocery_store"},
	{[]string{"交通", "车", "地铁", "公交"}, "directions_bus"},
	{[]string{"购物", "衣", "化妆", "数码"}, "shopping_bag"},
	{[]string{"日用", "家居"}, "home"},
	{[]string{"住", "房租", "水电"}, "apartment"},
	{[]string{"通讯", "话费", "宽带"}, "phone_iphone"},
	{[]string{"娱乐", "游戏", "电影"}, "sports_esports"},
	{[]string{"旅游", "旅行", "酒店"}, "flight"},
	{[]string{"医疗", "药", "医院"}, "medical_services"},
	{[]string{"教育", "学习", "学费"}, "school"},
	{[]string{"运动", "健身"}, "fitness_center"},
	{[]string{"宠物", "猫", "狗"}, "pets"},
	{[]string{"人情", "红包", "礼"}, "redeem"},
	{[]string{"工资", "薪"}, "payments"},
	{[]string{"奖金", "奖励"}, "emoji_events"},
	{[]string{"理财", "利息", "基金"}, "trending_up"},
	{[]string{"兼职", "副业"}, "work"},
}

func ledgerCategoryIcon(name string) string {
	low := strings.ToLower(name)
	for _, rule := range ledgerCategoryIcons {
		for _, k := range rule.keys {
			if strings.Contains(low, k) {
				return rule.icon
			}
		}
	}
	return "label"
}

// ensureLedgerCategory 取分类 ID：先按别名映射，映射不到则原样新建，避免数据丢失。
// create=false（预览）时不写库，只返回应显示的分类名。
func ensureLedgerCategory(ctx context.Context, ex finImportExecer, instanceID int64, typ, raw string, create bool) (int64, string) {
	name := ledgerDefaultCategory(typ)
	if mapped, ok := ledgerCategoryMatch(typ, raw); ok {
		name = mapped
	} else if v := sanitizeLedgerCategory(raw); v != "" {
		name = v
	}
	if id, ok := queryIntRow(ctx, ex,
		`SELECT id FROM fin_categories WHERE instance_id=? AND type=? AND name=? ORDER BY parent_id, id LIMIT 1`,
		instanceID, typ, name); ok {
		return id, name
	}
	if !create {
		return 0, name
	}
	res, err := ex.ExecContext(ctx,
		`INSERT INTO fin_categories(instance_id, name, type, icon, sort) VALUES(?,?,?,?,?)`,
		instanceID, name, typ, ledgerCategoryIcon(name), 200)
	if err == nil {
		if id, e := res.LastInsertId(); e == nil && id > 0 {
			return id, name
		}
	}
	if id, ok := queryIntRow(ctx, ex,
		`SELECT id FROM fin_categories WHERE instance_id=? AND type=? AND name=? ORDER BY parent_id, id LIMIT 1`,
		instanceID, typ, name); ok {
		return id, name
	}
	return 0, name
}

func truncateRunes(s string, n int) string {
	if n <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// importLedgerRows 逐行导入第三方账本（鲨鱼记账等）CSV。
func (r *FinanceRepo) importLedgerRows(ctx context.Context, ex finImportExecer, instanceID, accountID int64,
	records [][]string, cols ledgerColumns, headerAt int, out *FinImportResult, commit bool, user string) error {
	for i := headerAt + 1; i < len(records); i++ {
		rec := records[i]
		if len(rec) == 0 {
			continue
		}
		occurred, ok := parseLedgerTime(billCell(rec, cols.time))
		if !ok {
			continue
		}
		amount, negative := parseLedgerAmount(billCell(rec, cols.amount))
		if amount <= 0 {
			continue
		}
		out.Total++
		item := FinImportItem{
			Line:         i + 1,
			Source:       out.Source,
			Amount:       amount,
			OccurredAt:   occurred,
			Counterparty: billCell(rec, cols.counterparty),
			Note:         truncateRunes(strings.TrimSpace(billCell(rec, cols.note)), 200),
			Tags:         truncateRunes(strings.TrimSpace(billCell(rec, cols.tags)), 100),
		}
		rawCat := billCell(rec, cols.category)
		typ, skipReason := ledgerDirection(billCell(rec, cols.dir))
		if skipReason != "" {
			item.Skipped, item.Reason = true, skipReason
			out.Skipped++
			out.appendItem(item, commit)
			continue
		}
		if typ == "" {
			if !negative && ledgerIncomeHint(rawCat) {
				typ = "income"
			} else {
				typ = "expense"
			}
		}
		item.Type = typ
		categoryID, categoryName := ensureLedgerCategory(ctx, ex, instanceID, typ, rawCat, commit)
		item.CategoryID, item.CategoryName = categoryID, categoryName
		if categoryID == 0 && commit {
			item.Skipped, item.Reason = true, "分类创建失败"
			out.Skipped++
			out.appendItem(item, commit)
			continue
		}
		refID := fnvID("import|" + out.Source + "|" + occurred + "|" + typ + "|" +
			strconv.FormatInt(amount, 10) + "|" + item.Note + "|" + categoryName + "|" + item.Tags)
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
				currency, note, tags, source, ref_type, ref_id, occurred_at, created_by)
			 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			instanceID, typ, amount, accountID, categoryID, "CNY", item.Note, item.Tags,
			"import", "import", refID, occurred, user)
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
