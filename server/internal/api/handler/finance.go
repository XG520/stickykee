package handler

import (
	"bytes"
	"encoding/csv"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"

	"stickykee/server/internal/auth"
	"stickykee/server/internal/store"

	"github.com/go-chi/chi/v5"
)

// Finance 提供账本 REST 接口。
type Finance struct {
	repo *store.FinanceRepo
	inst *store.InstanceRepo
	sync *FinanceSync
	ai   *AI
}

// NewFinance 构造 handler。
func NewFinance(repo *store.FinanceRepo, inst *store.InstanceRepo, sync *FinanceSync, ai *AI) *Finance {
	return &Finance{repo: repo, inst: inst, sync: sync, ai: ai}
}

func (h *Finance) active(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := h.inst.ActiveID(r.Context())
	if err != nil || id <= 0 {
		WriteErr(w, 400, "no_instance", "请先在设置中添加并启用 Home Assistant 实例")
		return 0, false
	}
	return id, true
}

func (h *Finance) changed(instanceID int64) {
	if h.sync != nil {
		h.sync.RequestSync(instanceID)
	}
}

func finErr(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		WriteErr(w, 404, "not_found", "记录不存在")
		return
	}
	WriteErr(w, 400, "bad_request", err.Error())
}

func finID(r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func finQueryInt(r *http.Request, key string) int64 {
	v, _ := strconv.ParseInt(r.URL.Query().Get(key), 10, 64)
	return v
}

// canModify 本人或管理员可改/删账目。
func (h *Finance) canModify(r *http.Request, tx store.FinTransaction) bool {
	id, _ := auth.From(r.Context())
	return tx.CreatedBy == "" || tx.CreatedBy == id.Username || id.IsAdmin
}

// ── 账户 ──────────────────────────────────────────────────────────

// ListAccounts GET /finance/accounts?all=1
func (h *Finance) ListAccounts(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	all := r.URL.Query().Get("all")
	list, err := h.repo.ListAccounts(r.Context(), id, all == "1" || all == "true")
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, list)
}

// CreateAccount POST /finance/accounts
func (h *Finance) CreateAccount(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	var p store.FinAccountInput
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	a, err := h.repo.CreateAccount(r.Context(), id, p)
	if err != nil {
		finErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 201, a)
}

// UpdateAccount PUT /finance/accounts/{id}
func (h *Finance) UpdateAccount(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	aid, ok := finID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "账户不存在")
		return
	}
	var p store.FinAccountInput
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	a, err := h.repo.UpdateAccount(r.Context(), id, aid, p)
	if err != nil {
		finErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 200, a)
}

// DeleteAccount DELETE /finance/accounts/{id} 有流水时自动归档。
func (h *Finance) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	aid, ok := finID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "账户不存在")
		return
	}
	archived, err := h.repo.DeleteAccount(r.Context(), id, aid)
	if err != nil {
		finErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 200, map[string]any{"archived": archived})
}

// ── 分类 ──────────────────────────────────────────────────────────

// ListCategories GET /finance/categories?type=
func (h *Finance) ListCategories(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	typ := r.URL.Query().Get("type")
	if typ != "income" && typ != "expense" {
		typ = ""
	}
	list, err := h.repo.ListCategories(r.Context(), id, typ)
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, list)
}

// CreateCategory POST /finance/categories
func (h *Finance) CreateCategory(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	var p store.FinCategoryInput
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	c, err := h.repo.CreateCategory(r.Context(), id, p)
	if err != nil {
		finErr(w, err)
		return
	}
	WriteJSON(w, 201, c)
}

// UpdateCategory PUT /finance/categories/{id}
func (h *Finance) UpdateCategory(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	cid, ok := finID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "分类不存在")
		return
	}
	var p store.FinCategoryInput
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	c, err := h.repo.UpdateCategory(r.Context(), id, cid, p)
	if err != nil {
		finErr(w, err)
		return
	}
	WriteJSON(w, 200, c)
}

// DeleteCategory DELETE /finance/categories/{id}
func (h *Finance) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	cid, ok := finID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "分类不存在")
		return
	}
	if err := h.repo.DeleteCategory(r.Context(), id, cid); err != nil {
		finErr(w, err)
		return
	}
	WriteJSON(w, 200, true)
}

// ── 流水 ──────────────────────────────────────────────────────────

// ListTransactions GET /finance/transactions?month=&type=&account=&category=&q=&ref_type=&ref_id=&page=
func (h *Finance) ListTransactions(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	f := store.FinTransactionFilter{
		Month:      r.URL.Query().Get("month"),
		Day:        r.URL.Query().Get("day"),
		Type:       r.URL.Query().Get("type"),
		AccountID:  finQueryInt(r, "account"),
		CategoryID: finQueryInt(r, "category"),
		Query:      r.URL.Query().Get("q"),
		Tag:        r.URL.Query().Get("tag"),
		RefType:    r.URL.Query().Get("ref_type"),
		RefID:      finQueryInt(r, "ref_id"),
		Page:       int(finQueryInt(r, "page")),
		PageSize:   int(finQueryInt(r, "page_size")),
	}
	if f.Type != "income" && f.Type != "expense" && f.Type != "transfer" {
		f.Type = ""
	}
	page, err := h.repo.ListTransactions(r.Context(), id, f)
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, page)
}

// CreateTransaction POST /finance/transactions
func (h *Finance) CreateTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	var p store.FinTransactionInput
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	tx, err := h.repo.CreateTransaction(r.Context(), id, p, rUsername(r))
	if err != nil {
		finErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 201, tx)
}

// UpdateTransaction PUT /finance/transactions/{id}
func (h *Finance) UpdateTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	tid, ok := finID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "流水不存在")
		return
	}
	old, err := h.repo.GetTransaction(r.Context(), id, tid)
	if err != nil {
		finErr(w, err)
		return
	}
	if !h.canModify(r, old) {
		WriteErr(w, 403, "forbidden", "只能修改自己的账目")
		return
	}
	var p store.FinTransactionInput
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	tx, err := h.repo.UpdateTransaction(r.Context(), id, tid, p)
	if err != nil {
		finErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 200, tx)
}

// DeleteTransaction DELETE /finance/transactions/{id}（软删除）
func (h *Finance) DeleteTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	tid, ok := finID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "流水不存在")
		return
	}
	old, err := h.repo.GetTransaction(r.Context(), id, tid)
	if err != nil {
		finErr(w, err)
		return
	}
	if !h.canModify(r, old) {
		WriteErr(w, 403, "forbidden", "只能删除自己的账目")
		return
	}
	if err := h.repo.DeleteTransaction(r.Context(), id, tid); err != nil {
		finErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 200, true)
}

// RestoreTransaction POST /finance/transactions/{id}/restore
func (h *Finance) RestoreTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	tid, ok := finID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "流水不存在")
		return
	}
	if err := h.repo.RestoreTransaction(r.Context(), id, tid); err != nil {
		finErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 200, true)
}

// ── 转账与统计 ────────────────────────────────────────────────────

type financeTransferPayload struct {
	AccountID   int64  `json:"account_id"`
	ToAccountID int64  `json:"to_account_id"`
	Amount      int64  `json:"amount"`
	Note        string `json:"note"`
	OccurredAt  string `json:"occurred_at"`
}

// CreateTransfer POST /finance/transfer
func (h *Finance) CreateTransfer(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	var p financeTransferPayload
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	tx, err := h.repo.CreateTransfer(r.Context(), id, p.AccountID, p.ToAccountID, p.Amount,
		p.Note, p.OccurredAt, rUsername(r))
	if err != nil {
		finErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 201, tx)
}

// Stats GET /finance/stats?month=
func (h *Finance) Stats(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	st, err := h.repo.Stats(r.Context(), id, r.URL.Query().Get("month"))
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, st)
}

// ── 预算、趋势与导出 ──────────────────────────────────────────────

// ListBudgets GET /finance/budgets?month=
func (h *Finance) ListBudgets(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	list, err := h.repo.ListBudgets(r.Context(), id, r.URL.Query().Get("month"))
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, list)
}

type financeBudgetsPayload struct {
	Items []store.FinBudgetInput `json:"items"`
}

// SetBudgets PUT /finance/budgets?month=
func (h *Finance) SetBudgets(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	var p financeBudgetsPayload
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	if err := h.repo.SetBudgets(r.Context(), id, r.URL.Query().Get("month"), p.Items); err != nil {
		finErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 200, true)
}

// Trend GET /finance/trend?months=6
func (h *Finance) Trend(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	list, err := h.repo.Trend(r.Context(), id, int(finQueryInt(r, "months")))
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, list)
}

// Export GET /finance/export?month= 返回 CSV 文本（前端转成文件下载）。
func (h *Finance) Export(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	month := store.MonthOf(r.URL.Query().Get("month"))
	list, err := h.repo.MonthTransactions(r.Context(), id, month)
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	var buf bytes.Buffer
	buf.WriteString("\uFEFF") // 带 BOM，Excel 打开中文不乱码
	cw := csv.NewWriter(&buf)
	_ = cw.Write([]string{"日期", "类型", "分类", "账户", "金额(元)", "原币金额", "汇率", "备注", "标签", "来源"})
	for _, t := range list {
		typ := "支出"
		if t.Type == "income" {
			typ = "收入"
		} else if t.Type == "transfer" {
			typ = "转账"
		}
		account := t.AccountName
		if t.Type == "transfer" {
			account = t.AccountName + "→" + t.ToAccountName
		}
		orig := ""
		rate := ""
		if t.OrigAmount > 0 {
			orig = store.FormatCents(t.OrigAmount)
		}
		if t.FxRate > 0 {
			rate = strconv.FormatFloat(t.FxRate, 'f', 4, 64)
		}
		_ = cw.Write([]string{
			t.OccurredAt, typ, t.CategoryName, account,
			store.FormatCents(t.Amount), orig, rate, t.Note, t.Tags, t.Source,
		})
	}
	cw.Flush()
	WriteJSON(w, 200, map[string]any{
		"filename": "finance-" + month + ".csv",
		"content":  buf.String(),
	})
}

// ── 周期账单 ──────────────────────────────────────────────────────

// ListRecurring GET /finance/recurring
func (h *Finance) ListRecurring(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	list, err := h.repo.ListRecurring(r.Context(), id)
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, list)
}

// CreateRecurring POST /finance/recurring
func (h *Finance) CreateRecurring(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	var p store.FinRecurringInput
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	x, err := h.repo.CreateRecurring(r.Context(), id, p)
	if err != nil {
		finErr(w, err)
		return
	}
	WriteJSON(w, 201, x)
}

// UpdateRecurring PUT /finance/recurring/{id}
func (h *Finance) UpdateRecurring(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	rid, ok := finID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "周期账单不存在")
		return
	}
	var p store.FinRecurringInput
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	x, err := h.repo.UpdateRecurring(r.Context(), id, rid, p)
	if err != nil {
		finErr(w, err)
		return
	}
	WriteJSON(w, 200, x)
}

// DeleteRecurring DELETE /finance/recurring/{id}
func (h *Finance) DeleteRecurring(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	rid, ok := finID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "周期账单不存在")
		return
	}
	if err := h.repo.DeleteRecurring(r.Context(), id, rid); err != nil {
		finErr(w, err)
		return
	}
	WriteJSON(w, 200, true)
}

// ── 账单截图识别 ──────────────────────────────────────────────────

type financeRecognizePayload struct {
	Image string `json:"image"`
}

// financeCandidate 识图得到的候选账目（金额单位为分）。
type financeCandidate struct {
	Type       string `json:"type"`
	Amount     int64  `json:"amount"`
	Category   string `json:"category"`
	Note       string `json:"note"`
	OccurredAt string `json:"occurred_at"`
	Tags       string `json:"tags"`
}

// Recognize POST /finance/recognize 账单截图 → 候选账目。
func (h *Finance) Recognize(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	var p financeRecognizePayload
	if err := DecodeBody(r, &p); err != nil || strings.TrimSpace(p.Image) == "" {
		WriteErr(w, 400, "bad_request", "请提供图片")
		return
	}
	if len(p.Image) > 8<<20 {
		WriteErr(w, 400, "bad_request", "图片过大")
		return
	}
	if h.ai == nil {
		WriteErr(w, 400, "ai_not_configured", "AI 未配置")
		return
	}
	var names []string
	if list, err := h.repo.ListCategories(r.Context(), id, "expense"); err == nil {
		for _, c := range list {
			names = append(names, c.Name)
		}
	}
	messages := []map[string]any{
		{"role": "system", "content": "你是记账助手。只输出 JSON，不要解释。"},
		{"role": "user", "content": []map[string]any{
			{"type": "text", "text": "识别这张账单/支付截图中的交易，返回严格 JSON：{\"items\":[{\"type\":\"expense|income\",\"amount\":12.34,\"category\":\"餐饮\",\"note\":\"\",\"occurred_at\":\"yyyy-mm-dd HH:MM\",\"tags\":\"\"}]}。amount 单位为元，最多 3 条；category 优先从这些分类中选择：" + strings.Join(names, "、")},
			{"type": "image_url", "image_url": map[string]any{"url": p.Image}},
		}},
	}
	text, err := h.ai.CompleteByUser(r.Context(), rUsername(r), messages, 0.2)
	if err != nil {
		WriteErr(w, 502, "ai_error", err.Error())
		return
	}
	WriteJSON(w, 200, map[string]any{
		"raw":   text,
		"items": financeCandidatesFromText(text),
	})
}

func financeCandidatesFromText(text string) []financeCandidate {
	out := []financeCandidate{}
	obj, _ := extractJSONObject(text).(map[string]any)
	if obj == nil {
		return out
	}
	raw, ok := obj["items"].([]any)
	if !ok {
		if _, single := obj["amount"]; single {
			raw = []any{obj}
		} else {
			return out
		}
	}
	for _, it := range raw {
		m, ok := it.(map[string]any)
		if !ok {
			continue
		}
		c := financeCandidate{
			Type:       strings.ToLower(finStr(m["type"])),
			Amount:     finAmountCents(m["amount"]),
			Category:   finStr(m["category"]),
			Note:       finStr(m["note"]),
			OccurredAt: finStr(m["occurred_at"]),
			Tags:       finStr(m["tags"]),
		}
		if c.Type != "income" {
			c.Type = "expense"
		}
		if c.Amount <= 0 {
			continue
		}
		out = append(out, c)
		if len(out) >= 5 {
			break
		}
	}
	return out
}

func finStr(v any) string {
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

func finAmountCents(v any) int64 {
	switch x := v.(type) {
	case float64:
		return int64(math.Round(x * 100))
	case string:
		s := strings.TrimSpace(x)
		s = strings.TrimLeft(s, "¥$￥€£")
		f, err := strconv.ParseFloat(s, 64)
		if err == nil {
			return int64(math.Round(f * 100))
		}
	}
	return 0
}
