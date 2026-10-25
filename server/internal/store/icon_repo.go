package store

import (
	"context"
	"database/sql"
)

// IconRepo 提供实体图标覆盖的存取（entity_icons 表，(instance_id, entity_id) 唯一）。
// 覆盖只存本系统，不写回 HA；空串图标即删除覆盖（恢复默认）。
type IconRepo struct{ db *sql.DB }

// NewIconRepo 构造仓储。
func NewIconRepo(db *sql.DB) *IconRepo { return &IconRepo{db: db} }

// Set 写入/覆盖某实体的自定义图标；icon 为空串时删除覆盖（恢复默认）。
func (r *IconRepo) Set(ctx context.Context, instanceID int64, entityID, icon string) error {
	if icon == "" {
		_, err := r.db.ExecContext(ctx,
			`DELETE FROM entity_icons WHERE instance_id=? AND entity_id=?`, instanceID, entityID)
		return err
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO entity_icons(instance_id, entity_id, icon) VALUES(?,?,?)
		 ON CONFLICT(instance_id, entity_id) DO UPDATE SET icon=excluded.icon`,
		instanceID, entityID, icon)
	return err
}

// Map 返回某实例的全部图标覆盖（entity_id → icon）。
func (r *IconRepo) Map(ctx context.Context, instanceID int64) (map[string]string, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT entity_id, icon FROM entity_icons WHERE instance_id=?`, instanceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var eid, icon string
		if err := rows.Scan(&eid, &icon); err != nil {
			return nil, err
		}
		out[eid] = icon
	}
	return out, rows.Err()
}
