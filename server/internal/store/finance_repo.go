package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

// ── 记账数据模型 ──────────────────────────────────────────────────

// FinAccount 资金账户；余额不落库，由流水实时计算。
type FinAccount struct {
	ID             int64  `json:"id"`
	Name           string `json:"name"`
	Kind           string `json:"kind"`
	Currency       string `json:"currency"`
	OpeningBalance int64  `json:"opening_balance"`
	Icon           string `json:"icon"`
	Sort           int    `json:"sort"`
	Archived       bool   `json:"archived"`
	Balance        int64  `json:"balance"`
}

// FinCategory 收支分类；一级分类带 children。
type FinCategory struct {
	ID            int64         `json:"id"`
	Name          string        `json:"name"`
	Type          string        `json:"type"`
	ParentID      int64         `json:"parent_id"`
	Icon          string        `json:"icon"`
	Sort          int           `json:"sort"`
	MonthlyBudget int64         `json:"monthly_budget"`
	Children      []FinCategory `json:"children,omitempty"`
}

// FinTransaction 交易流水（金额单位为分）。
type FinTransaction struct {
	ID             int64  `json:"id"`
	Type           string `json:"type"`
	Amount         int64  `json:"amount"`
	AccountID      int64  `json:"account_id"`
	AccountName    string `json:"account_name"`
	ToAccountID    int64  `json:"to_account_id"`
	ToAccountName  string `json:"to_account_name"`
	CategoryID     int64  `json:"category_id"`
	CategoryName   string `json:"category_name"`
	CategoryParent string `json:"category_parent"`
	Currency       string `json:"currency"`
	Note           string `json:"note"`
	Tags           string `json:"tags"`
	Source         string `json:"source"`
	RefType        string `json:"ref_type"`
	RefID          int64  `json:"ref_id"`
	OccurredAt     string `json:"occurred_at"`
	CreatedBy      string `json:"created_by"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

// FinAccountInput 账户新建/编辑入参。
type FinAccountInput struct {
	Name           string `json:"name"`
	Kind           string `json:"kind"`
	Currency       string `json:"currency"`
	OpeningBalance int64  `json:"opening_balance"`
	Icon           string `json:"icon"`
	Sort           int    `json:"sort"`
}

// FinCategoryInput 分类新建/编辑入参。
type FinCategoryInput struct {
	Name          string `json:"name"`
	Type          string `json:"type"`
	ParentID      int64  `json:"parent_id"`
	Icon          string `json:"icon"`
	Sort          int    `json:"sort"`
	MonthlyBudget int64  `json:"monthly_budget"`
}

// FinTransactionInput 记账/改账入参。
type FinTransactionInput struct {
	Type        string `json:"type"`
	Amount      int64  `json:"amount"`
	AccountID   int64  `json:"account_id"`
	ToAccountID int64  `json:"to_account_id"`
	CategoryID  int64  `json:"category_id"`
	Currency    string `json:"currency"`
	Note        string `json:"note"`
	Tags        string `json:"tags"`
	OccurredAt  string `json:"occurred_at"`
}

// FinTransactionFilter 流水筛选条件。
type FinTransactionFilter struct {
	Month      string
	Type       string
	AccountID  int64
	CategoryID int64
	Query      string
	RefType    string
	RefID      int64
	Page       int
	PageSize   int
}

// FinTransactionPage 分页流水。
type FinTransactionPage struct {
	Items    []FinTransaction `json:"items"`
	Total    int              `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"page_size"`
}

// FinCategoryStat 分类支出占比。
type FinCategoryStat struct {
	CategoryID int64   `json:"category_id"`
	Name       string  `json:"name"`
	Amount     int64   `json:"amount"`
	Percent    float64 `json:"percent"`
}

// FinStats 本月概览。
type FinStats struct {
	Month       string            `json:"month"`
	Expense     int64             `json:"expense"`
	Income      int64             `json:"income"`
	Balance     int64             `json:"balance"`
	BudgetTotal int64             `json:"budget_total"`
	BudgetLeft  int64             `json:"budget_left"`
	BudgetPct   int               `json:"budget_pct"`
	ByCategory  []FinCategoryStat `json:"by_category"`
	ByAccount   []FinAccount      `json:"by_account"`
}

// FinanceRepo 提供记账相关持久化访问。
type FinanceRepo struct{ db *sql.DB }

// NewFinanceRepo 构造仓储。
func NewFinanceRepo(db *sql.DB) *FinanceRepo { return &FinanceRepo{db: db} }

// ── 默认数据 ──────────────────────────────────────────────────────

type seedCategory struct {
	name, icon string
}

var seedExpenseCategories = []seedCategory{
	{"餐饮", "restaurant"},
	{"食品", "local_grocery_store"},
	{"交通", "directions_bus"},
	{"购物", "shopping_bag"},
	{"日用", "home"},
	{"居住", "apartment"},
	{"娱乐", "sports_esports"},
	{"医疗", "medical_services"},
	{"教育", "school"},
	{"人情", "redeem"},
	{"其他支出", "more_horiz"},
}

var seedIncomeCategories = []seedCategory{
	{"工资", "payments"},
	{"奖金", "emoji_events"},
	{"理财", "trending_up"},
	{"兼职", "work"},
	{"红包", "card_giftcard"},
	{"其他收入", "more_horiz"},
}

// ensureDefaults 首次使用账本时补齐默认账户与分类。
func (r *FinanceRepo) ensureDefaults(ctx context.Context, instanceID int64) error {
	var n int
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM fin_accounts WHERE instance_id=?`, instanceID).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		if _, err := r.db.ExecContext(ctx,
			`INSERT INTO fin_accounts(instance_id, name, kind, icon, sort) VALUES(?,?,?,?,?)`,
			instanceID, "现金", "cash", "payments", 0); err != nil {
			return err
		}
	}
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM fin_categories WHERE instance_id=?`, instanceID).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	for i, c := range seedExpenseCategories {
		if _, err := r.db.ExecContext(ctx,
			`INSERT INTO fin_categories(instance_id, name, type, icon, sort) VALUES(?,?,?,?,?)`,
			instanceID, c.name, "expense", c.icon, i); err != nil {
			return err
		}
	}
	for i, c := range seedIncomeCategories {
		if _, err := r.db.ExecContext(ctx,
			`INSERT INTO fin_categories(instance_id, name, type, icon, sort) VALUES(?,?,?,?,?)`,
			instanceID, c.name, "income", c.icon, i); err != nil {
			return err
		}
	}
	return nil
}

// ── 账户 ──────────────────────────────────────────────────────────

const finAccountSelect = `SELECT a.id, a.name, a.kind, a.currency, a.opening_balance, a.icon, a.sort, a.archived,
	a.opening_balance
	+ COALESCE((SELECT SUM(t.amount) FROM fin_transactions t
		WHERE t.instance_id=a.instance_id AND t.deleted_at='' AND t.type='income' AND t.account_id=a.id),0)
	- COALESCE((SELECT SUM(t.amount) FROM fin_transactions t
		WHERE t.instance_id=a.instance_id AND t.deleted_at='' AND t.type='expense' AND t.account_id=a.id),0)
	- COALESCE((SELECT SUM(t.amount) FROM fin_transactions t
		WHERE t.instance_id=a.instance_id AND t.deleted_at='' AND t.type='transfer' AND t.account_id=a.id),0)
	+ COALESCE((SELECT SUM(t.amount) FROM fin_transactions t
		WHERE t.instance_id=a.instance_id AND t.deleted_at='' AND t.type='transfer' AND t.to_account_id=a.id),0)
	FROM fin_accounts a`

func scanFinAccount(row interface{ Scan(...any) error }) (FinAccount, error) {
	var a FinAccount
	var archived int
	err := row.Scan(&a.ID, &a.Name, &a.Kind, &a.Currency, &a.OpeningBalance,
		&a.Icon, &a.Sort, &archived, &a.Balance)
	a.Archived = archived != 0
	return a, err
}

// ListAccounts 列出账户（含实时余额）。
func (r *FinanceRepo) ListAccounts(ctx context.Context, instanceID int64, includeArchived bool) ([]FinAccount, error) {
	if err := r.ensureDefaults(ctx, instanceID); err != nil {
		return nil, err
	}
	q := finAccountSelect + ` WHERE a.instance_id=?`
	if !includeArchived {
		q += ` AND a.archived=0`
	}
	q += ` ORDER BY a.archived, a.sort, a.id`
	rows, err := r.db.QueryContext(ctx, q, instanceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FinAccount{}
	for rows.Next() {
		a, err := scanFinAccount(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *FinanceRepo) getAccount(ctx context.Context, instanceID, id int64) (FinAccount, error) {
	row := r.db.QueryRowContext(ctx, finAccountSelect+` WHERE a.instance_id=? AND a.id=?`, instanceID, id)
	a, err := scanFinAccount(row)
	if errors.Is(err, sql.ErrNoRows) {
		return FinAccount{}, ErrNotFound
	}
	return a, err
}

// CreateAccount 新增账户。
func (r *FinanceRepo) CreateAccount(ctx context.Context, instanceID int64, in FinAccountInput) (FinAccount, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return FinAccount{}, errors.New("账户名称不能为空")
	}
	if in.Kind == "" {
		in.Kind = "cash"
	}
	if in.Currency == "" {
		in.Currency = "CNY"
	}
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO fin_accounts(instance_id, name, kind, currency, opening_balance, icon, sort)
		 VALUES(?,?,?,?,?,?,?)`,
		instanceID, in.Name, in.Kind, in.Currency, in.OpeningBalance, in.Icon, in.Sort)
	if err != nil {
		return FinAccount{}, err
	}
	id, _ := res.LastInsertId()
	return r.getAccount(ctx, instanceID, id)
}

// UpdateAccount 编辑账户。
func (r *FinanceRepo) UpdateAccount(ctx context.Context, instanceID, id int64, in FinAccountInput) (FinAccount, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return FinAccount{}, errors.New("账户名称不能为空")
	}
	if in.Kind == "" {
		in.Kind = "cash"
	}
	if in.Currency == "" {
		in.Currency = "CNY"
	}
	res, err := r.db.ExecContext(ctx,
		`UPDATE fin_accounts SET name=?, kind=?, currency=?, opening_balance=?, icon=?, sort=?,
			updated_at=datetime('now') WHERE id=? AND instance_id=?`,
		in.Name, in.Kind, in.Currency, in.OpeningBalance, in.Icon, in.Sort, id, instanceID)
	if err != nil {
		return FinAccount{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return FinAccount{}, ErrNotFound
	}
	return r.getAccount(ctx, instanceID, id)
}

// DeleteAccount 删除账户；有流水时转为归档，保留历史账目。
func (r *FinanceRepo) DeleteAccount(ctx context.Context, instanceID, id int64) (bool, error) {
	var used int
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM fin_transactions WHERE instance_id=? AND (account_id=? OR to_account_id=?)`,
		instanceID, id, id).Scan(&used); err != nil {
		return false, err
	}
	if used > 0 {
		res, err := r.db.ExecContext(ctx,
			`UPDATE fin_accounts SET archived=1, updated_at=datetime('now') WHERE id=? AND instance_id=?`,
			id, instanceID)
		if err != nil {
			return false, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return false, ErrNotFound
		}
		return true, nil
	}
	res, err := r.db.ExecContext(ctx, `DELETE FROM fin_accounts WHERE id=? AND instance_id=?`, id, instanceID)
	if err != nil {
		return false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return false, ErrNotFound
	}
	return false, nil
}

// ── 分类 ──────────────────────────────────────────────────────────

// ListCategories 返回分类树（type 为空时返回全部）。
func (r *FinanceRepo) ListCategories(ctx context.Context, instanceID int64, typ string) ([]FinCategory, error) {
	if err := r.ensureDefaults(ctx, instanceID); err != nil {
		return nil, err
	}
	q := `SELECT id, name, type, parent_id, icon, sort, monthly_budget
		FROM fin_categories WHERE instance_id=?`
	args := []any{instanceID}
	if typ != "" {
		q += ` AND type=?`
		args = append(args, typ)
	}
	q += ` ORDER BY sort, id`
	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var all []FinCategory
	for rows.Next() {
		var c FinCategory
		if err := rows.Scan(&c.ID, &c.Name, &c.Type, &c.ParentID, &c.Icon, &c.Sort, &c.MonthlyBudget); err != nil {
			return nil, err
		}
		all = append(all, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	children := map[int64][]FinCategory{}
	roots := []FinCategory{}
	for _, c := range all {
		if c.ParentID == 0 {
			roots = append(roots, c)
		} else {
			children[c.ParentID] = append(children[c.ParentID], c)
		}
	}
	for i := range roots {
		if ch, ok := children[roots[i].ID]; ok {
			roots[i].Children = ch
		} else {
			roots[i].Children = []FinCategory{}
		}
	}
	return roots, nil
}

func (r *FinanceRepo) getCategory(ctx context.Context, instanceID, id int64) (FinCategory, error) {
	var c FinCategory
	err := r.db.QueryRowContext(ctx,
		`SELECT id, name, type, parent_id, icon, sort, monthly_budget
		 FROM fin_categories WHERE id=? AND instance_id=?`, id, instanceID).
		Scan(&c.ID, &c.Name, &c.Type, &c.ParentID, &c.Icon, &c.Sort, &c.MonthlyBudget)
	if errors.Is(err, sql.ErrNoRows) {
		return FinCategory{}, ErrNotFound
	}
	return c, err
}

// CreateCategory 新增分类。
func (r *FinanceRepo) CreateCategory(ctx context.Context, instanceID int64, in FinCategoryInput) (FinCategory, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return FinCategory{}, errors.New("分类名称不能为空")
	}
	if in.Type != "income" {
		in.Type = "expense"
	}
	if in.ParentID > 0 {
		parent, err := r.getCategory(ctx, instanceID, in.ParentID)
		if err != nil {
			return FinCategory{}, errors.New("上级分类不存在")
		}
		in.Type = parent.Type
	}
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO fin_categories(instance_id, name, type, parent_id, icon, sort, monthly_budget)
		 VALUES(?,?,?,?,?,?,?)`,
		instanceID, in.Name, in.Type, in.ParentID, in.Icon, in.Sort, in.MonthlyBudget)
	if err != nil {
		return FinCategory{}, err
	}
	id, _ := res.LastInsertId()
	return r.getCategory(ctx, instanceID, id)
}

// UpdateCategory 编辑分类。
func (r *FinanceRepo) UpdateCategory(ctx context.Context, instanceID, id int64, in FinCategoryInput) (FinCategory, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return FinCategory{}, errors.New("分类名称不能为空")
	}
	if in.Type != "income" {
		in.Type = "expense"
	}
	if in.ParentID == id {
		return FinCategory{}, errors.New("上级分类不能是自己")
	}
	if in.ParentID > 0 {
		parent, err := r.getCategory(ctx, instanceID, in.ParentID)
		if err != nil {
			return FinCategory{}, errors.New("上级分类不存在")
		}
		in.Type = parent.Type
	}
	res, err := r.db.ExecContext(ctx,
		`UPDATE fin_categories SET name=?, type=?, parent_id=?, icon=?, sort=?, monthly_budget=?
		 WHERE id=? AND instance_id=?`,
		in.Name, in.Type, in.ParentID, in.Icon, in.Sort, in.MonthlyBudget, id, instanceID)
	if err != nil {
		return FinCategory{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return FinCategory{}, ErrNotFound
	}
	return r.getCategory(ctx, instanceID, id)
}

// DeleteCategory 删除分类（有子分类或被流水引用时拒绝）。
func (r *FinanceRepo) DeleteCategory(ctx context.Context, instanceID, id int64) error {
	var children int
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM fin_categories WHERE instance_id=? AND parent_id=?`,
		instanceID, id).Scan(&children); err != nil {
		return err
	}
	if children > 0 {
		return errors.New("请先删除子分类")
	}
	var used int
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM fin_transactions WHERE instance_id=? AND category_id=?`,
		instanceID, id).Scan(&used); err != nil {
		return err
	}
	if used > 0 {
		return errors.New("该分类已被流水使用，无法删除")
	}
	res, err := r.db.ExecContext(ctx, `DELETE FROM fin_categories WHERE id=? AND instance_id=?`, id, instanceID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ── 流水 ──────────────────────────────────────────────────────────

const finTxSelect = `SELECT t.id, t.type, t.amount, t.account_id, COALESCE(a.name,''),
	t.to_account_id, COALESCE(a2.name,''), t.category_id, COALESCE(c.name,''), COALESCE(p.name,''),
	t.currency, t.note, t.tags, t.source, t.ref_type, t.ref_id, t.occurred_at,
	t.created_by, t.created_at, t.updated_at
	FROM fin_transactions t
	LEFT JOIN fin_accounts a ON a.id=t.account_id
	LEFT JOIN fin_accounts a2 ON a2.id=t.to_account_id
	LEFT JOIN fin_categories c ON c.id=t.category_id
	LEFT JOIN fin_categories p ON p.id=c.parent_id`

func scanFinTx(row interface{ Scan(...any) error }) (FinTransaction, error) {
	var t FinTransaction
	err := row.Scan(&t.ID, &t.Type, &t.Amount, &t.AccountID, &t.AccountName,
		&t.ToAccountID, &t.ToAccountName, &t.CategoryID, &t.CategoryName, &t.CategoryParent,
		&t.Currency, &t.Note, &t.Tags, &t.Source, &t.RefType, &t.RefID, &t.OccurredAt,
		&t.CreatedBy, &t.CreatedAt, &t.UpdatedAt)
	return t, err
}

// ListTransactions 分页查询流水。
func (r *FinanceRepo) ListTransactions(ctx context.Context, instanceID int64, f FinTransactionFilter) (FinTransactionPage, error) {
	if f.Page <= 0 {
		f.Page = 1
	}
	if f.PageSize <= 0 || f.PageSize > 200 {
		f.PageSize = 50
	}
	where := []string{"t.instance_id=?", "t.deleted_at=''"}
	args := []any{instanceID}
	if f.Month != "" {
		where = append(where, "substr(t.occurred_at,1,7)=?")
		args = append(args, f.Month)
	}
	if f.Type != "" {
		where = append(where, "t.type=?")
		args = append(args, f.Type)
	}
	if f.AccountID > 0 {
		where = append(where, "(t.account_id=? OR t.to_account_id=?)")
		args = append(args, f.AccountID, f.AccountID)
	}
	if f.CategoryID > 0 {
		where = append(where, "(t.category_id=? OR c.parent_id=?)")
		args = append(args, f.CategoryID, f.CategoryID)
	}
	if f.RefType != "" {
		where = append(where, "t.ref_type=? AND t.ref_id=?")
		args = append(args, f.RefType, f.RefID)
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		where = append(where, "(t.note LIKE ? OR t.tags LIKE ?)")
		like := "%" + q + "%"
		args = append(args, like, like)
	}
	cond := " WHERE " + strings.Join(where, " AND ")

	var total int
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM fin_transactions t
		 LEFT JOIN fin_categories c ON c.id=t.category_id`+cond, args...).Scan(&total); err != nil {
		return FinTransactionPage{}, err
	}
	q := finTxSelect + cond + ` ORDER BY t.occurred_at DESC, t.id DESC LIMIT ? OFFSET ?`
	qargs := append(append([]any{}, args...), f.PageSize, (f.Page-1)*f.PageSize)
	rows, err := r.db.QueryContext(ctx, q, qargs...)
	if err != nil {
		return FinTransactionPage{}, err
	}
	defer rows.Close()
	items := []FinTransaction{}
	for rows.Next() {
		t, err := scanFinTx(rows)
		if err != nil {
			return FinTransactionPage{}, err
		}
		items = append(items, t)
	}
	return FinTransactionPage{Items: items, Total: total, Page: f.Page, PageSize: f.PageSize}, rows.Err()
}

// GetTransaction 取一笔未删除的流水。
func (r *FinanceRepo) GetTransaction(ctx context.Context, instanceID, id int64) (FinTransaction, error) {
	row := r.db.QueryRowContext(ctx,
		finTxSelect+` WHERE t.instance_id=? AND t.id=? AND t.deleted_at=''`, instanceID, id)
	t, err := scanFinTx(row)
	if errors.Is(err, sql.ErrNoRows) {
		return FinTransaction{}, ErrNotFound
	}
	return t, err
}

func normOccurred(v string) string {
	v = strings.TrimSpace(strings.ReplaceAll(v, "T", " "))
	if v == "" {
		return time.Now().Format("2006-01-02 15:04")
	}
	if len(v) == 10 {
		return v + " 00:00"
	}
	if len(v) > 16 {
		return v[:16]
	}
	return v
}

func (r *FinanceRepo) checkAccount(ctx context.Context, instanceID, id int64) error {
	if id <= 0 {
		return errors.New("请选择账户")
	}
	var n int
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM fin_accounts WHERE id=? AND instance_id=?`, id, instanceID).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		return errors.New("账户不存在")
	}
	return nil
}

func (r *FinanceRepo) normalizeTxInput(ctx context.Context, instanceID int64, in *FinTransactionInput) error {
	if in.Type != "income" {
		in.Type = "expense"
	}
	if in.Amount <= 0 {
		return errors.New("金额必须大于 0")
	}
	if err := r.checkAccount(ctx, instanceID, in.AccountID); err != nil {
		return err
	}
	if in.CategoryID > 0 {
		if _, err := r.getCategory(ctx, instanceID, in.CategoryID); err != nil {
			return errors.New("分类不存在")
		}
	}
	if in.Currency == "" {
		in.Currency = "CNY"
	}
	in.OccurredAt = normOccurred(in.OccurredAt)
	in.Note = strings.TrimSpace(in.Note)
	in.Tags = strings.TrimSpace(in.Tags)
	return nil
}

// CreateTransaction 记一笔收支。
func (r *FinanceRepo) CreateTransaction(ctx context.Context, instanceID int64, in FinTransactionInput, user string) (FinTransaction, error) {
	if err := r.normalizeTxInput(ctx, instanceID, &in); err != nil {
		return FinTransaction{}, err
	}
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO fin_transactions(instance_id, type, amount, account_id, category_id, currency,
			note, tags, source, occurred_at, created_by)
		 VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		instanceID, in.Type, in.Amount, in.AccountID, in.CategoryID, in.Currency,
		in.Note, in.Tags, "manual", in.OccurredAt, user)
	if err != nil {
		return FinTransaction{}, err
	}
	id, _ := res.LastInsertId()
	return r.GetTransaction(ctx, instanceID, id)
}

// UpdateTransaction 修改一笔流水（来源与关联批次保持不变）。
func (r *FinanceRepo) UpdateTransaction(ctx context.Context, instanceID, id int64, in FinTransactionInput) (FinTransaction, error) {
	if err := r.normalizeTxInput(ctx, instanceID, &in); err != nil {
		return FinTransaction{}, err
	}
	res, err := r.db.ExecContext(ctx,
		`UPDATE fin_transactions SET type=?, amount=?, account_id=?, category_id=?, currency=?,
			note=?, tags=?, occurred_at=?, updated_at=datetime('now')
		 WHERE id=? AND instance_id=? AND deleted_at=''`,
		in.Type, in.Amount, in.AccountID, in.CategoryID, in.Currency,
		in.Note, in.Tags, in.OccurredAt, id, instanceID)
	if err != nil {
		return FinTransaction{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return FinTransaction{}, ErrNotFound
	}
	return r.GetTransaction(ctx, instanceID, id)
}

// DeleteTransaction 软删除（保留 30 天可恢复）。
func (r *FinanceRepo) DeleteTransaction(ctx context.Context, instanceID, id int64) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE fin_transactions SET deleted_at=datetime('now'), updated_at=datetime('now')
		 WHERE id=? AND instance_id=? AND deleted_at=''`, id, instanceID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// RestoreTransaction 恢复软删除。
func (r *FinanceRepo) RestoreTransaction(ctx context.Context, instanceID, id int64) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE fin_transactions SET deleted_at='', updated_at=datetime('now')
		 WHERE id=? AND instance_id=? AND deleted_at<>''`, id, instanceID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// CreateTransfer 账户间转账：单条 type=transfer 记录，校验转出余额（信用卡允许负）。
func (r *FinanceRepo) CreateTransfer(ctx context.Context, instanceID, fromID, toID, amount int64, note string, occurredAt string, user string) (FinTransaction, error) {
	if amount <= 0 {
		return FinTransaction{}, errors.New("金额必须大于 0")
	}
	if fromID <= 0 || toID <= 0 {
		return FinTransaction{}, errors.New("请选择转出与转入账户")
	}
	if fromID == toID {
		return FinTransaction{}, errors.New("转出与转入账户不能相同")
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return FinTransaction{}, err
	}
	defer tx.Rollback()
	var kind string
	var balance int64
	err = tx.QueryRowContext(ctx,
		`SELECT a.kind,
			a.opening_balance
			+ COALESCE((SELECT SUM(t.amount) FROM fin_transactions t
				WHERE t.instance_id=a.instance_id AND t.deleted_at='' AND t.type='income' AND t.account_id=a.id),0)
			- COALESCE((SELECT SUM(t.amount) FROM fin_transactions t
				WHERE t.instance_id=a.instance_id AND t.deleted_at='' AND t.type='expense' AND t.account_id=a.id),0)
			- COALESCE((SELECT SUM(t.amount) FROM fin_transactions t
				WHERE t.instance_id=a.instance_id AND t.deleted_at='' AND t.type='transfer' AND t.account_id=a.id),0)
			+ COALESCE((SELECT SUM(t.amount) FROM fin_transactions t
				WHERE t.instance_id=a.instance_id AND t.deleted_at='' AND t.type='transfer' AND t.to_account_id=a.id),0)
		 FROM fin_accounts a WHERE a.id=? AND a.instance_id=?`, fromID, instanceID).Scan(&kind, &balance)
	if errors.Is(err, sql.ErrNoRows) {
		return FinTransaction{}, errors.New("转出账户不存在")
	}
	if err != nil {
		return FinTransaction{}, err
	}
	var toExists int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM fin_accounts WHERE id=? AND instance_id=?`, toID, instanceID).Scan(&toExists); err != nil {
		return FinTransaction{}, err
	}
	if toExists == 0 {
		return FinTransaction{}, errors.New("转入账户不存在")
	}
	if kind != "credit" && balance < amount {
		return FinTransaction{}, errors.New("转出账户余额不足")
	}
	res, err := tx.ExecContext(ctx,
		`INSERT INTO fin_transactions(instance_id, type, amount, account_id, to_account_id, currency,
			note, source, occurred_at, created_by)
		 VALUES(?,?,?,?,?,?,?,?,?,?)`,
		instanceID, "transfer", amount, fromID, toID, "CNY",
		strings.TrimSpace(note), "manual", normOccurred(occurredAt), user)
	if err != nil {
		return FinTransaction{}, err
	}
	id, _ := res.LastInsertId()
	if err := tx.Commit(); err != nil {
		return FinTransaction{}, err
	}
	return r.GetTransaction(ctx, instanceID, id)
}

// ── 统计 ──────────────────────────────────────────────────────────

// MonthOf 规范化月份参数（yyyy-mm），非法时返回当前月份。
func MonthOf(v string) string {
	v = strings.TrimSpace(v)
	if len(v) == 7 && v[4] == '-' {
		return v
	}
	return time.Now().Format("2006-01")
}

// Stats 汇总某月收支、分类占比、账户余额与预算进度。
func (r *FinanceRepo) Stats(ctx context.Context, instanceID int64, month string) (FinStats, error) {
	month = MonthOf(month)
	st := FinStats{Month: month, ByCategory: []FinCategoryStat{}, ByAccount: []FinAccount{}}
	if err := r.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0),
			COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0)
		 FROM fin_transactions
		 WHERE instance_id=? AND deleted_at='' AND type IN ('expense','income')
		   AND substr(occurred_at,1,7)=?`, instanceID, month).
		Scan(&st.Expense, &st.Income); err != nil {
		return st, err
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT t.category_id, COALESCE(c.name,'未分类'), SUM(t.amount)
		 FROM fin_transactions t LEFT JOIN fin_categories c ON c.id=t.category_id
		 WHERE t.instance_id=? AND t.deleted_at='' AND t.type='expense'
		   AND substr(t.occurred_at,1,7)=?
		 GROUP BY t.category_id ORDER BY SUM(t.amount) DESC`, instanceID, month)
	if err != nil {
		return st, err
	}
	for rows.Next() {
		var cs FinCategoryStat
		if err := rows.Scan(&cs.CategoryID, &cs.Name, &cs.Amount); err != nil {
			rows.Close()
			return st, err
		}
		if st.Expense > 0 {
			cs.Percent = math.Round(float64(cs.Amount)*1000/float64(st.Expense)) / 10
		}
		st.ByCategory = append(st.ByCategory, cs)
	}
	rows.Close()
	accounts, err := r.ListAccounts(ctx, instanceID, true)
	if err != nil {
		return st, err
	}
	st.ByAccount = accounts
	for _, a := range accounts {
		st.Balance += a.Balance
	}
	if err := r.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(amount),0) FROM fin_budgets
		 WHERE instance_id=? AND month=? AND category_id=0`, instanceID, month).
		Scan(&st.BudgetTotal); err != nil {
		return st, err
	}
	if st.BudgetTotal == 0 {
		if err := r.db.QueryRowContext(ctx,
			`SELECT COALESCE(SUM(monthly_budget),0) FROM fin_categories
			 WHERE instance_id=? AND type='expense'`, instanceID).Scan(&st.BudgetTotal); err != nil {
			return st, err
		}
	}
	if st.BudgetTotal > 0 {
		st.BudgetLeft = st.BudgetTotal - st.Expense
		st.BudgetPct = int(math.Round(float64(st.Expense) * 100 / float64(st.BudgetTotal)))
	}
	return st, nil
}

// InstanceIDsWithFinance 返回存在账户的实例 id（供定时同步使用）。
func (r *FinanceRepo) InstanceIDsWithFinance(ctx context.Context) ([]int64, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT DISTINCT instance_id FROM fin_accounts`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ── 库存联动 ──────────────────────────────────────────────────────

// itemCategoryName 把库存物品分类映射到记账分类名。
func itemCategoryName(c string) string {
	switch strings.TrimSpace(c) {
	case "食品", "饮料", "生鲜", "蔬菜", "水果", "零食", "粮油", "乳品":
		return "食品"
	case "药品", "医药", "保健品":
		return "医疗"
	case "日用品", "日用", "清洁", "纸品":
		return "日用"
	default:
		return "其他支出"
	}
}

func queryIntRow(ctx context.Context, ex interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, q string, args ...any) (int64, bool) {
	var id int64
	if err := ex.QueryRowContext(ctx, q, args...).Scan(&id); err != nil {
		return 0, false
	}
	return id, true
}

// defaultAccountTx 取默认账户；没有账户时补一个「现金」。
func defaultAccountTx(ctx context.Context, ex interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, instanceID int64) (int64, error) {
	if id, ok := queryIntRow(ctx, ex,
		`SELECT id FROM fin_accounts WHERE instance_id=? AND archived=0 ORDER BY sort, id LIMIT 1`,
		instanceID); ok {
		return id, nil
	}
	res, err := ex.ExecContext(ctx,
		`INSERT INTO fin_accounts(instance_id, name, kind, icon, sort) VALUES(?,?,?,?,?)`,
		instanceID, "现金", "cash", "payments", 0)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// defaultExpenseCategoryTx 按物品分类挑记账分类，未命中落「其他支出」。
func defaultExpenseCategoryTx(ctx context.Context, ex interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, instanceID int64, itemCategory string) int64 {
	candidates := []string{strings.TrimSpace(itemCategory), itemCategoryName(itemCategory), "其他支出"}
	for _, name := range candidates {
		if name == "" {
			continue
		}
		if id, ok := queryIntRow(ctx, ex,
			`SELECT id FROM fin_categories WHERE instance_id=? AND type='expense' AND name=? ORDER BY id LIMIT 1`,
			instanceID, name); ok {
			return id
		}
	}
	id, _ := queryIntRow(ctx, ex,
		`SELECT id FROM fin_categories WHERE instance_id=? AND type='expense' ORDER BY sort, id LIMIT 1`, instanceID)
	return id
}

func insertAutoTx(ctx context.Context, tx *sql.Tx, instanceID int64, refType string, refID int64,
	accountID, categoryID, amount int64, note, occurredAt, user string) error {
	_, err := tx.ExecContext(ctx,
		`INSERT OR IGNORE INTO fin_transactions(instance_id, type, amount, account_id, category_id,
			currency, note, source, ref_type, ref_id, occurred_at, created_by)
		 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
		instanceID, "expense", amount, accountID, categoryID, "CNY", note,
		"inventory", refType, refID, normOccurred(occurredAt), user)
	return err
}

// RecordInventoryPurchase 库存入库自动记一笔支出（按批次幂等）。
func (r *FinanceRepo) RecordInventoryPurchase(ctx context.Context, instanceID int64, itemName, itemCategory string, batchID, amount int64, occurredAt, user string) error {
	if amount <= 0 || batchID <= 0 {
		return nil
	}
	if err := r.ensureDefaults(ctx, instanceID); err != nil {
		return err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	accountID, err := defaultAccountTx(ctx, tx, instanceID)
	if err != nil {
		return err
	}
	categoryID := defaultExpenseCategoryTx(ctx, tx, instanceID, itemCategory)
	if err := insertAutoTx(ctx, tx, instanceID, "inventory_batch", batchID,
		accountID, categoryID, amount, "入库："+itemName, occurredAt, user); err != nil {
		return err
	}
	return tx.Commit()
}

// RecordInventoryLoss 丢弃批次自动记一笔损耗支出（独立 ref_type，避免与入库冲突）。
func (r *FinanceRepo) RecordInventoryLoss(ctx context.Context, instanceID int64, itemName string, batchID, amount int64, occurredAt, user string) error {
	if amount <= 0 || batchID <= 0 {
		return nil
	}
	if err := r.ensureDefaults(ctx, instanceID); err != nil {
		return err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	accountID, err := defaultAccountTx(ctx, tx, instanceID)
	if err != nil {
		return err
	}
	categoryID := defaultExpenseCategoryTx(ctx, tx, instanceID, "")
	if err := insertAutoTx(ctx, tx, instanceID, "inventory_loss", batchID,
		accountID, categoryID, amount, "损耗："+itemName, occurredAt, user); err != nil {
		return err
	}
	return tx.Commit()
}

// FormatCents 把分转换为元的字符串表示（供日志/导出复用）。
func FormatCents(c int64) string {
	return fmt.Sprintf("%.2f", float64(c)/100)
}
