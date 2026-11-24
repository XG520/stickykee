package handler

import (
	"errors"
	"net/http"
	"strconv"

	"stickynuo/server/internal/auth"
	"stickynuo/server/internal/store"

	"github.com/go-chi/chi/v5"
)

// Finance 提供账本 REST 接口。
type Finance struct {
	repo *store.FinanceRepo
	inst *store.InstanceRepo
	sync *FinanceSync
}

// NewFinance 构造 handler。
func NewFinance(repo *store.FinanceRepo, inst *store.InstanceRepo, sync *FinanceSync) *Finance {
	return &Finance{repo: repo, inst: inst, sync: sync}
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
		Type:       r.URL.Query().Get("type"),
		AccountID:  finQueryInt(r, "account"),
		CategoryID: finQueryInt(r, "category"),
		Query:      r.URL.Query().Get("q"),
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
