package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// ErrNotFound 表示记录不存在。
var ErrNotFound = errors.New("record not found")

// Instance 表示一个可配置的 Home Assistant 连接。
type Instance struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	Token     string `json:"-"`
	Enabled   bool   `json:"enabled"`
	SkipTLS   bool   `json:"skip_tls"` // 忽略 TLS 证书验证（本地自签名 HA 常用）
	Active    bool   `json:"active"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// InstanceRepo 提供实例 CRUD 与 active 切换。
type InstanceRepo struct{ db *sql.DB }

// NewInstanceRepo 构造仓储。
func NewInstanceRepo(db *sql.DB) *InstanceRepo { return &InstanceRepo{db: db} }

const instanceCols = `id, name, url, token, enabled, skip_tls, created_at, updated_at`

func scanInstance(row interface{ Scan(...any) error }) (Instance, error) {
	var i Instance
	var enabled, skipTLS int
	err := row.Scan(&i.ID, &i.Name, &i.URL, &i.Token, &enabled, &skipTLS, &i.CreatedAt, &i.UpdatedAt)
	i.Enabled = enabled != 0
	i.SkipTLS = skipTLS != 0
	i.Active = false // 由外层填充
	return i, err
}

// List 返回全部实例（含 active 标记）。
func (r *InstanceRepo) List(ctx context.Context) ([]Instance, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT `+instanceCols+` FROM instances ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Instance
	for rows.Next() {
		i, err := scanInstance(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	active, _ := r.ActiveID(ctx)
	for k := range out {
		out[k].Active = out[k].ID == active
	}
	return out, rows.Err()
}

// Get 按 id 查单个实例（含 active 标记）。
func (r *InstanceRepo) Get(ctx context.Context, id int64) (Instance, error) {
	row := r.db.QueryRowContext(ctx, `SELECT `+instanceCols+` FROM instances WHERE id=?`, id)
	i, err := scanInstance(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Instance{}, ErrNotFound
	}
	if err != nil {
		return Instance{}, err
	}
	active, _ := r.ActiveID(ctx)
	i.Active = i.ID == active
	return i, nil
}

// Create 新增实例；若当前无 active 实例则自动设为 active。
func (r *InstanceRepo) Create(ctx context.Context, name, url, token string, skipTLS bool) (Instance, error) {
	skip := 0
	if skipTLS {
		skip = 1
	}
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO instances(name, url, token, enabled, skip_tls) VALUES(?,?,?,1,?)`, name, url, token, skip)
	if err != nil {
		return Instance{}, err
	}
	id, _ := res.LastInsertId()
	active, _ := r.ActiveID(ctx)
	if active == 0 {
		_ = r.SetActive(ctx, id)
	}
	return r.Get(ctx, id)
}

// Update 更新实例名称/地址/token/skip_tls；token 为空时保留原值。
func (r *InstanceRepo) Update(ctx context.Context, id int64, name, url, token string, skipTLS bool) error {
	skip := 0
	if skipTLS {
		skip = 1
	}
	_, err := r.db.ExecContext(ctx,
		`UPDATE instances SET name=?, url=?, token=CASE WHEN ?='' THEN token ELSE ? END, skip_tls=?, updated_at=datetime('now') WHERE id=?`,
		name, url, token, token, skip, id)
	return err
}

// Delete 删除实例。
func (r *InstanceRepo) Delete(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM instances WHERE id=?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errors.New("instance not found")
	}
	// 若删除的是 active，则激活剩下第一个
	active, _ := r.ActiveID(ctx)
	if active == id {
		var first int64
		err := r.db.QueryRowContext(ctx, `SELECT id FROM instances LIMIT 1`).Scan(&first)
		if err == nil {
			_ = r.SetActive(ctx, first)
		}
	}
	return nil
}

// ActiveID 返回当前激活实例 id（从 prefs 读取；无则 0）。
// 若激活指向的实例已被删除（悬挂引用，例如删除最后一个实例后未清理、
// 又新增了实例），自动回退到当前首个实例并修复 prefs，避免前端永远指向已删除实例。
func (r *InstanceRepo) ActiveID(ctx context.Context) (int64, error) {
	v, _ := r.GetPref(ctx, "active_instance")
	if v == "" {
		return 0, nil
	}
	id, _ := parseID(v)
	if id == 0 {
		return 0, nil
	}
	var exists int
	err := r.db.QueryRowContext(ctx, `SELECT 1 FROM instances WHERE id=?`, id).Scan(&exists)
	if err == nil {
		return id, nil
	}
	// 悬挂引用：回退到第一个存在的实例，并即时修复持久化值。
	var first int64
	if err := r.db.QueryRowContext(ctx, `SELECT id FROM instances ORDER BY id LIMIT 1`).Scan(&first); err != nil {
		_ = r.SetPref(ctx, "active_instance", "")
		return 0, nil
	}
	_ = r.SetActive(ctx, first)
	return first, nil
}

// SetActive 将某 id 设为 active（持久化到 prefs 单值 key）。
func (r *InstanceRepo) SetActive(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO prefs(key,value) VALUES('active_instance',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, fmt.Sprint(id))
	return err
}

// SetPref 保存偏好（JSON 字符串）。
func (r *InstanceRepo) SetPref(ctx context.Context, key, value string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO prefs(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

// GetPref 读取偏好。
func (r *InstanceRepo) GetPref(ctx context.Context, key string) (string, error) {
	var v string
	err := r.db.QueryRowContext(ctx, `SELECT value FROM prefs WHERE key=?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

// GetActiveInstance 返回 active 实例；无则返回当前首个实例。
func (r *InstanceRepo) GetActiveInstance(ctx context.Context) (Instance, error) {
	// active 从 prefs 读，找不到回退首个
	v, _ := r.GetPref(ctx, "active_instance")
	if v != "" {
		if id, err := parseID(v); err == nil {
			if i, err := r.Get(ctx, id); err == nil {
				return i, nil
			}
		}
	}
	var i Instance
	row := r.db.QueryRowContext(ctx, `SELECT `+instanceCols+` FROM instances ORDER BY id LIMIT 1`)
	i, err := scanInstance(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Instance{}, errors.New("no instance configured")
	}
	active, _ := r.ActiveID(ctx)
	i.Active = i.ID == active
	return i, err
}

func parseID(s string) (int64, error) {
	var id int64
	_, err := fmt.Sscan(s, &id)
	return id, err
}
