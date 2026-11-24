// Package store 提供 SQLite 持久化访问。
package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// Store 持有数据库连接。
type Store struct {
	db *sql.DB
}

// Open 打开/初始化 SQLite 数据库，并执行迁移。
func Open(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create db dir: %w", err)
		}
	}
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func migrate(db *sql.DB) error {
	schemas := []string{
		`CREATE TABLE IF NOT EXISTS instances (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			url TEXT NOT NULL,
			token TEXT NOT NULL DEFAULT '',
			enabled INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);`,
		`CREATE TABLE IF NOT EXISTS prefs (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user TEXT NOT NULL,
			expires_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			is_admin INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);`,
		`CREATE TABLE IF NOT EXISTS user_prefs (
			username TEXT NOT NULL,
			key TEXT NOT NULL,
			value TEXT NOT NULL,
			PRIMARY KEY (username, key)
		);`,
		`CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			from_user TEXT NOT NULL,
			to_user TEXT NOT NULL,
			msg_type TEXT NOT NULL DEFAULT 'text',
			payload TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			read INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);`,
		`CREATE INDEX IF NOT EXISTS idx_messages_users ON messages(from_user, to_user);`,
		// 运行日志：级别 / 来源分类持久化，30 天后由后台任务清理
		`CREATE TABLE IF NOT EXISTS app_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ts_ms INTEGER NOT NULL,
			level TEXT NOT NULL,
			source TEXT NOT NULL,
			msg TEXT NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_app_logs_ts ON app_logs(ts_ms);`,
		`CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level, ts_ms);`,
		`CREATE INDEX IF NOT EXISTS idx_app_logs_source ON app_logs(source, ts_ms);`,
		// 实体图标覆盖：本系统内的自定义图标（不写回 HA），空行即恢复默认
		`CREATE TABLE IF NOT EXISTS entity_icons (
			instance_id INTEGER NOT NULL,
			entity_id TEXT NOT NULL,
			icon TEXT NOT NULL,
			PRIMARY KEY (instance_id, entity_id)
		);`,
		// ── 库存 / 食品库 ───────────────────────────────────────────
		// 位置：冷藏室 / 冷冻室 / 橱柜 / 药箱 …；parent_id 支持 冰箱→冷藏/冷冻 层级
		`CREATE TABLE IF NOT EXISTS inventory_locations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			kind TEXT NOT NULL DEFAULT 'other',
			icon TEXT NOT NULL DEFAULT '',
			ha_entity_id TEXT NOT NULL DEFAULT '',
			parent_id INTEGER NOT NULL DEFAULT 0,
			sort INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);`,
		`CREATE INDEX IF NOT EXISTS idx_inventory_locations_instance ON inventory_locations(instance_id, sort);`,
		// 物品主数据（商品维度）
		`CREATE TABLE IF NOT EXISTS inventory_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			barcode TEXT NOT NULL DEFAULT '',
			category TEXT NOT NULL DEFAULT '',
			unit TEXT NOT NULL DEFAULT '件',
			image_path TEXT NOT NULL DEFAULT '',
			default_shelf_life_days INTEGER NOT NULL DEFAULT 0,
			after_open_days INTEGER NOT NULL DEFAULT 0,
			min_quantity REAL NOT NULL DEFAULT 0,
			pack_size REAL NOT NULL DEFAULT 1,
			pack_unit TEXT NOT NULL DEFAULT '',
			tags TEXT NOT NULL DEFAULT '',
			notes TEXT NOT NULL DEFAULT '',
			created_by TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_barcode
			ON inventory_items(instance_id, barcode) WHERE barcode <> '';`,
		`CREATE INDEX IF NOT EXISTS idx_inventory_items_instance ON inventory_items(instance_id, name);`,
		// 库存批次（同一物品可有多个过期日）
		`CREATE TABLE IF NOT EXISTS inventory_batches (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
			location_id INTEGER NOT NULL REFERENCES inventory_locations(id),
			quantity REAL NOT NULL DEFAULT 1,
			production_date TEXT NOT NULL DEFAULT '',
			expiry_date TEXT NOT NULL DEFAULT '',
			opened INTEGER NOT NULL DEFAULT 0,
			opened_at TEXT NOT NULL DEFAULT '',
			entry_date TEXT NOT NULL DEFAULT '',
			entry_price REAL NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'active',
			created_by TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);`,
		`CREATE INDEX IF NOT EXISTS idx_inventory_batches_item ON inventory_batches(item_id);`,
		`CREATE INDEX IF NOT EXISTS idx_inventory_batches_expiry ON inventory_batches(status, expiry_date);`,
		// 进出库流水（统计 / 回溯）
		`CREATE TABLE IF NOT EXISTS inventory_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
			item_id INTEGER NOT NULL DEFAULT 0,
			batch_id INTEGER NOT NULL DEFAULT 0,
			action TEXT NOT NULL,
			delta REAL NOT NULL DEFAULT 0,
			quantity_after REAL NOT NULL DEFAULT 0,
			user TEXT NOT NULL DEFAULT '',
			ts_ms INTEGER NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_inventory_logs_ts ON inventory_logs(ts_ms);`,
		// 过期提醒去重（同一批次同一天只提醒一次）
		`CREATE TABLE IF NOT EXISTS inventory_reminders (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
			batch_id INTEGER NOT NULL REFERENCES inventory_batches(id) ON DELETE CASCADE,
			remind_date TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			UNIQUE(batch_id, remind_date)
		);`,
		// 本地条码库（一个物品可对应多个条码，离线可查）
		`CREATE TABLE IF NOT EXISTS inventory_barcodes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
			barcode TEXT NOT NULL,
			item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
			source TEXT NOT NULL DEFAULT 'manual',
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			UNIQUE(instance_id, barcode)
		);`,
		`CREATE INDEX IF NOT EXISTS idx_inventory_barcodes_item ON inventory_barcodes(item_id);`,
		// 购物清单（缺货/临期一键加入，成员共享）
		`CREATE TABLE IF NOT EXISTS inventory_shopping_list (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
			item_id INTEGER NOT NULL DEFAULT 0,
			name TEXT NOT NULL,
			quantity REAL NOT NULL DEFAULT 1,
			unit TEXT NOT NULL DEFAULT '件',
			note TEXT NOT NULL DEFAULT '',
			done INTEGER NOT NULL DEFAULT 0,
			created_by TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			done_at TEXT NOT NULL DEFAULT ''
		);`,
		`CREATE INDEX IF NOT EXISTS idx_inventory_shopping_done ON inventory_shopping_list(instance_id, done);`,
		// ── 记账 / 账本 ─────────────────────────────────────────────
		// 资金账户：现金 / 储蓄卡 / 信用卡 / 支付宝 / 微信 / 其他
		`CREATE TABLE IF NOT EXISTS fin_accounts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			kind TEXT NOT NULL DEFAULT 'cash',
			currency TEXT NOT NULL DEFAULT 'CNY',
			opening_balance INTEGER NOT NULL DEFAULT 0,
			icon TEXT NOT NULL DEFAULT '',
			sort INTEGER NOT NULL DEFAULT 0,
			archived INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);`,
		`CREATE INDEX IF NOT EXISTS idx_fin_accounts_instance ON fin_accounts(instance_id, archived, sort);`,
		// 收支分类（parent_id=0 为一级，二级分类挂在下面）
		`CREATE TABLE IF NOT EXISTS fin_categories (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT 'expense',
			parent_id INTEGER NOT NULL DEFAULT 0,
			icon TEXT NOT NULL DEFAULT '',
			sort INTEGER NOT NULL DEFAULT 0,
			monthly_budget INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);`,
		`CREATE INDEX IF NOT EXISTS idx_fin_categories_type ON fin_categories(instance_id, type, parent_id);`,
		// 交易流水（金额恒为正数，单位为分）
		`CREATE TABLE IF NOT EXISTS fin_transactions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
			type TEXT NOT NULL DEFAULT 'expense',
			amount INTEGER NOT NULL,
			account_id INTEGER NOT NULL REFERENCES fin_accounts(id),
			to_account_id INTEGER NOT NULL DEFAULT 0,
			category_id INTEGER NOT NULL DEFAULT 0,
			currency TEXT NOT NULL DEFAULT 'CNY',
			orig_amount INTEGER NOT NULL DEFAULT 0,
			fx_rate REAL NOT NULL DEFAULT 0,
			note TEXT NOT NULL DEFAULT '',
			tags TEXT NOT NULL DEFAULT '',
			source TEXT NOT NULL DEFAULT 'manual',
			ref_type TEXT NOT NULL DEFAULT '',
			ref_id INTEGER NOT NULL DEFAULT 0,
			occurred_at TEXT NOT NULL,
			created_by TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now')),
			deleted_at TEXT NOT NULL DEFAULT ''
		);`,
		`CREATE INDEX IF NOT EXISTS idx_fin_tx_time ON fin_transactions(instance_id, occurred_at);`,
		`CREATE INDEX IF NOT EXISTS idx_fin_tx_category ON fin_transactions(instance_id, category_id, occurred_at);`,
		`CREATE INDEX IF NOT EXISTS idx_fin_tx_account ON fin_transactions(instance_id, account_id, occurred_at);`,
		// 库存自动记账幂等：同一批次/清单项只生成一笔（软删除后释放，可重新记账）
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_tx_ref
			ON fin_transactions(instance_id, ref_type, ref_id)
			WHERE ref_type <> '' AND deleted_at = '';`,
		// 月度预算（按月覆盖分类的默认预算）
		`CREATE TABLE IF NOT EXISTS fin_budgets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
			month TEXT NOT NULL,
			category_id INTEGER NOT NULL DEFAULT 0,
			amount INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			UNIQUE(instance_id, month, category_id)
		);`,
		// 周期账单（房租、会员、还款）
		`CREATE TABLE IF NOT EXISTS fin_recurring (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT 'expense',
			amount INTEGER NOT NULL,
			account_id INTEGER NOT NULL,
			category_id INTEGER NOT NULL DEFAULT 0,
			day_of_month INTEGER NOT NULL DEFAULT 1,
			enabled INTEGER NOT NULL DEFAULT 1,
			last_run_month TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);`,
	}
	for _, s := range schemas {
		if _, err := db.Exec(s); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	// 迁移：为旧库补充 skip_tls 列（每实例忽略证书验证开关）
	if has, err := hasColumn(db, "instances", "skip_tls"); err != nil {
		return err
	} else if !has {
		if _, err := db.Exec(`ALTER TABLE instances ADD COLUMN skip_tls INTEGER NOT NULL DEFAULT 0`); err != nil {
			return fmt.Errorf("migrate skip_tls: %w", err)
		}
	}
	// 迁移：为旧库补充 meta 列（share 消息的分享目标端等附加元数据，JSON）
	if has, err := hasColumn(db, "messages", "meta"); err != nil {
		return err
	} else if !has {
		if _, err := db.Exec(`ALTER TABLE messages ADD COLUMN meta TEXT NOT NULL DEFAULT ''`); err != nil {
			return fmt.Errorf("migrate messages.meta: %w", err)
		}
	}
	// 迁移：多币种——原币金额（分）与折算汇率（1 原币 = fx_rate 元）
	if has, err := hasColumn(db, "fin_transactions", "orig_amount"); err != nil {
		return err
	} else if !has {
		if _, err := db.Exec(`ALTER TABLE fin_transactions ADD COLUMN orig_amount INTEGER NOT NULL DEFAULT 0`); err != nil {
			return fmt.Errorf("migrate fin_transactions.orig_amount: %w", err)
		}
	}
	if has, err := hasColumn(db, "fin_transactions", "fx_rate"); err != nil {
		return err
	} else if !has {
		if _, err := db.Exec(`ALTER TABLE fin_transactions ADD COLUMN fx_rate REAL NOT NULL DEFAULT 0`); err != nil {
			return fmt.Errorf("migrate fin_transactions.fx_rate: %w", err)
		}
	}
	return nil
}

// hasColumn 判断表是否已存在某列。
func hasColumn(db *sql.DB, table, column string) (bool, error) {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notnull, pk int
		var name, ctype string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

// DB 暴露底层连接（供仓储使用）。
func (s *Store) DB() *sql.DB { return s.db }

// Close 关闭数据库。
func (s *Store) Close() error { return s.db.Close() }
