package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// InventoryLocation 库存存放位置（冷藏室/冷冻室/橱柜/药箱…）。
type InventoryLocation struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	Icon       string `json:"icon"`
	HAEntityID string `json:"ha_entity_id"`
	ParentID   int64  `json:"parent_id"`
	Sort       int    `json:"sort"`
}

// InventoryBatch 库存批次（同一物品可有多个过期日）。
type InventoryBatch struct {
	ID             int64   `json:"id"`
	ItemID         int64   `json:"item_id"`
	LocationID     int64   `json:"location_id"`
	LocationName   string  `json:"location_name"`
	Quantity       float64 `json:"quantity"`
	ProductionDate string  `json:"production_date"`
	ExpiryDate     string  `json:"expiry_date"`
	Opened         bool    `json:"opened"`
	OpenedAt       string  `json:"opened_at"`
	EntryDate      string  `json:"entry_date"`
	EntryPrice     float64 `json:"entry_price"`
	Status         string  `json:"status"`
	CreatedAt      string  `json:"created_at"`
}

// InventoryItem 物品主数据（聚合批次后的视图）。
type InventoryItem struct {
	ID                   int64            `json:"id"`
	Name                 string           `json:"name"`
	Barcode              string           `json:"barcode"`
	Category             string           `json:"category"`
	Unit                 string           `json:"unit"`
	ImagePath            string           `json:"image_path"`
	DefaultShelfLifeDays int              `json:"default_shelf_life_days"`
	AfterOpenDays        int              `json:"after_open_days"`
	MinQuantity          float64          `json:"min_quantity"`
	PackSize             float64          `json:"pack_size"`
	PackUnit             string           `json:"pack_unit"`
	Tags                 string           `json:"tags"`
	Notes                string           `json:"notes"`
	CreatedBy            string           `json:"created_by"`
	CreatedAt            string           `json:"created_at"`
	UpdatedAt            string           `json:"updated_at"`
	TotalQuantity        float64          `json:"total_quantity"`
	NearestExpiry        string           `json:"nearest_expiry"`
	LowStock             bool             `json:"low_stock"`
	Batches              []InventoryBatch `json:"batches"`
}

// InventoryLog 进出库流水。
type InventoryLog struct {
	ID            int64   `json:"id"`
	ItemID        int64   `json:"item_id"`
	BatchID       int64   `json:"batch_id"`
	Action        string  `json:"action"`
	Delta         float64 `json:"delta"`
	QuantityAfter float64 `json:"quantity_after"`
	User          string  `json:"user"`
	TsMs          int64   `json:"ts_ms"`
}

// InventoryItemInput 新建/编辑物品的入参。
type InventoryItemInput struct {
	Name                 string  `json:"name"`
	Barcode              string  `json:"barcode"`
	Category             string  `json:"category"`
	Unit                 string  `json:"unit"`
	ImagePath            string  `json:"image_path"`
	DefaultShelfLifeDays int     `json:"default_shelf_life_days"`
	AfterOpenDays        int     `json:"after_open_days"`
	MinQuantity          float64 `json:"min_quantity"`
	PackSize             float64 `json:"pack_size"`
	PackUnit             string  `json:"pack_unit"`
	Tags                 string  `json:"tags"`
	Notes                string  `json:"notes"`
}

// InventoryBatchInput 新建批次的入参。
type InventoryBatchInput struct {
	LocationID     int64   `json:"location_id"`
	Quantity       float64 `json:"quantity"`
	ProductionDate string  `json:"production_date"`
	ExpiryDate     string  `json:"expiry_date"`
	EntryDate      string  `json:"entry_date"`
	EntryPrice     float64 `json:"entry_price"`
}

// InventoryFilter 物品列表筛选条件。
type InventoryFilter struct {
	LocationID   int64
	Query        string
	Category     string
	ExpiringDays int
	LowStock     bool
}

// LocationStat 按位置汇总。
type LocationStat struct {
	ID       int64   `json:"id"`
	Name     string  `json:"name"`
	Quantity float64 `json:"quantity"`
}

// InventoryStats 库存统计。
type InventoryStats struct {
	Total      float64        `json:"total"`
	TotalValue float64        `json:"total_value"`
	ItemCount  int            `json:"item_count"`
	Expiring   int            `json:"expiring"`
	Expired    int            `json:"expired"`
	LowStock   int            `json:"low_stock"`
	ByLocation []LocationStat `json:"by_location"`
}

// InventoryRepo 提供库存相关持久化访问。
type InventoryRepo struct{ db *sql.DB }

// NewInventoryRepo 构造仓储。
func NewInventoryRepo(db *sql.DB) *InventoryRepo { return &InventoryRepo{db: db} }

// ── 位置 ──────────────────────────────────────────────────────────

const locationCols = `id, name, kind, icon, ha_entity_id, parent_id, sort`

func scanLocation(row interface{ Scan(...any) error }) (InventoryLocation, error) {
	var l InventoryLocation
	err := row.Scan(&l.ID, &l.Name, &l.Kind, &l.Icon, &l.HAEntityID, &l.ParentID, &l.Sort)
	return l, err
}

// ListLocations 列出某实例的全部位置。
func (r *InventoryRepo) ListLocations(ctx context.Context, instanceID int64) ([]InventoryLocation, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+locationCols+` FROM inventory_locations WHERE instance_id=? ORDER BY sort, id`, instanceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []InventoryLocation
	for rows.Next() {
		l, err := scanLocation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (r *InventoryRepo) getLocation(ctx context.Context, instanceID, id int64) (InventoryLocation, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT `+locationCols+` FROM inventory_locations WHERE id=? AND instance_id=?`, id, instanceID)
	l, err := scanLocation(row)
	if errors.Is(err, sql.ErrNoRows) {
		return InventoryLocation{}, ErrNotFound
	}
	return l, err
}

// CreateLocation 新增位置。
func (r *InventoryRepo) CreateLocation(ctx context.Context, instanceID int64, name, kind, icon, haEntity string, parentID int64, sort int) (InventoryLocation, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return InventoryLocation{}, errors.New("位置名称不能为空")
	}
	if kind == "" {
		kind = "other"
	}
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO inventory_locations(instance_id, name, kind, icon, ha_entity_id, parent_id, sort) VALUES(?,?,?,?,?,?,?)`,
		instanceID, name, kind, icon, haEntity, parentID, sort)
	if err != nil {
		return InventoryLocation{}, err
	}
	id, _ := res.LastInsertId()
	return r.getLocation(ctx, instanceID, id)
}

// UpdateLocation 更新位置。
func (r *InventoryRepo) UpdateLocation(ctx context.Context, instanceID, id int64, name, kind, icon, haEntity string, parentID int64, sort int) (InventoryLocation, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return InventoryLocation{}, errors.New("位置名称不能为空")
	}
	if kind == "" {
		kind = "other"
	}
	res, err := r.db.ExecContext(ctx,
		`UPDATE inventory_locations SET name=?, kind=?, icon=?, ha_entity_id=?, parent_id=?, sort=?, updated_at=datetime('now')
		 WHERE id=? AND instance_id=?`,
		name, kind, icon, haEntity, parentID, sort, id, instanceID)
	if err != nil {
		return InventoryLocation{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return InventoryLocation{}, ErrNotFound
	}
	return r.getLocation(ctx, instanceID, id)
}

// DeleteLocation 删除位置（有批次引用时拒绝，避免悬空）。
func (r *InventoryRepo) DeleteLocation(ctx context.Context, instanceID, id int64) error {
	var used int
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM inventory_batches b JOIN inventory_items i ON i.id=b.item_id
		 WHERE i.instance_id=? AND b.location_id=?`, instanceID, id).Scan(&used); err != nil {
		return err
	}
	if used > 0 {
		return errors.New("该位置下仍有库存，无法删除")
	}
	res, err := r.db.ExecContext(ctx, `DELETE FROM inventory_locations WHERE id=? AND instance_id=?`, id, instanceID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ── 物品 ──────────────────────────────────────────────────────────

const itemCols = `id, name, barcode, category, unit, image_path, default_shelf_life_days,
	after_open_days, min_quantity, pack_size, pack_unit, tags, notes, created_by, created_at, updated_at`

func scanItem(row interface{ Scan(...any) error }) (InventoryItem, error) {
	var it InventoryItem
	err := row.Scan(&it.ID, &it.Name, &it.Barcode, &it.Category, &it.Unit, &it.ImagePath,
		&it.DefaultShelfLifeDays, &it.AfterOpenDays, &it.MinQuantity, &it.PackSize, &it.PackUnit,
		&it.Tags, &it.Notes, &it.CreatedBy, &it.CreatedAt, &it.UpdatedAt)
	return it, err
}

// ListItems 按筛选条件返回物品（含 active 批次聚合）。
func (r *InventoryRepo) ListItems(ctx context.Context, instanceID int64, f InventoryFilter) ([]InventoryItem, error) {
	where := []string{"instance_id=?"}
	args := []any{instanceID}
	if q := strings.TrimSpace(f.Query); q != "" {
		where = append(where, "(name LIKE ? OR barcode LIKE ?)")
		like := "%" + q + "%"
		args = append(args, like, like)
	}
	if f.Category != "" {
		where = append(where, "category=?")
		args = append(args, f.Category)
	}
	if f.LocationID > 0 {
		where = append(where, `EXISTS (SELECT 1 FROM inventory_batches b
			WHERE b.item_id=inventory_items.id AND b.status='active' AND b.location_id=?)`)
		args = append(args, f.LocationID)
	}
	if f.ExpiringDays > 0 {
		deadline := time.Now().AddDate(0, 0, f.ExpiringDays).Format("2006-01-02")
		where = append(where, `EXISTS (SELECT 1 FROM inventory_batches b
			WHERE b.item_id=inventory_items.id AND b.status='active' AND b.expiry_date<>'' AND b.expiry_date<=?)`)
		args = append(args, deadline)
	}
	if f.LowStock {
		where = append(where, `min_quantity>0 AND (SELECT COALESCE(SUM(b.quantity),0)
			FROM inventory_batches b WHERE b.item_id=inventory_items.id AND b.status='active') < min_quantity`)
	}
	q := `SELECT ` + itemCols + ` FROM inventory_items WHERE ` + strings.Join(where, " AND ") + ` ORDER BY name, id`
	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []InventoryItem
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return items, nil
	}
	ids := make([]any, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.ID)
	}
	batches, err := r.batchesForItems(ctx, ids)
	if err != nil {
		return nil, err
	}
	byItem := make(map[int64][]InventoryBatch, len(items))
	for _, b := range batches {
		byItem[b.ItemID] = append(byItem[b.ItemID], b)
	}
	for i := range items {
		bs := byItem[items[i].ID]
		if bs == nil {
			bs = []InventoryBatch{}
		}
		items[i].Batches = bs
		var total float64
		near := ""
		for _, b := range bs {
			total += b.Quantity
			if b.ExpiryDate != "" && (near == "" || b.ExpiryDate < near) {
				near = b.ExpiryDate
			}
		}
		items[i].TotalQuantity = total
		items[i].NearestExpiry = near
		items[i].LowStock = items[i].MinQuantity > 0 && total < items[i].MinQuantity
	}
	return items, nil
}

// GetItem 返回单个物品（含批次）。
func (r *InventoryRepo) GetItem(ctx context.Context, instanceID, id int64) (InventoryItem, error) {
	row := r.db.QueryRowContext(ctx, `SELECT `+itemCols+` FROM inventory_items WHERE id=? AND instance_id=?`, id, instanceID)
	it, err := scanItem(row)
	if errors.Is(err, sql.ErrNoRows) {
		return InventoryItem{}, ErrNotFound
	}
	if err != nil {
		return InventoryItem{}, err
	}
	batches, err := r.batchesForItems(ctx, []any{id})
	if err != nil {
		return InventoryItem{}, err
	}
	if batches == nil {
		batches = []InventoryBatch{}
	}
	it.Batches = batches
	for _, b := range batches {
		it.TotalQuantity += b.Quantity
		if b.ExpiryDate != "" && (it.NearestExpiry == "" || b.ExpiryDate < it.NearestExpiry) {
			it.NearestExpiry = b.ExpiryDate
		}
	}
	it.LowStock = it.MinQuantity > 0 && it.TotalQuantity < it.MinQuantity
	return it, nil
}

func (r *InventoryRepo) batchesForItems(ctx context.Context, ids []any) ([]InventoryBatch, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	ph := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	q := `SELECT b.id, b.item_id, b.location_id, COALESCE(l.name,''), b.quantity, b.production_date,
		b.expiry_date, b.opened, b.opened_at, b.entry_date, b.entry_price, b.status, b.created_at
		FROM inventory_batches b LEFT JOIN inventory_locations l ON l.id=b.location_id
		WHERE b.status='active' AND b.item_id IN (` + ph + `)
		ORDER BY CASE WHEN b.expiry_date='' THEN 1 ELSE 0 END, b.expiry_date, b.id`
	rows, err := r.db.QueryContext(ctx, q, ids...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []InventoryBatch
	for rows.Next() {
		var b InventoryBatch
		var opened int
		if err := rows.Scan(&b.ID, &b.ItemID, &b.LocationID, &b.LocationName, &b.Quantity,
			&b.ProductionDate, &b.ExpiryDate, &opened, &b.OpenedAt, &b.EntryDate,
			&b.EntryPrice, &b.Status, &b.CreatedAt); err != nil {
			return nil, err
		}
		b.Opened = opened != 0
		out = append(out, b)
	}
	return out, rows.Err()
}

// CreateItem 新建物品并可选带首个批次（同事务）。
func (r *InventoryRepo) CreateItem(ctx context.Context, instanceID int64, in InventoryItemInput, first *InventoryBatchInput, user string) (InventoryItem, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return InventoryItem{}, errors.New("物品名称不能为空")
	}
	in.Barcode = strings.TrimSpace(in.Barcode)
	if in.Barcode != "" {
		var exists int
		if err := r.db.QueryRowContext(ctx,
			`SELECT COUNT(1) FROM inventory_items WHERE instance_id=? AND barcode=?`, instanceID, in.Barcode).Scan(&exists); err != nil {
			return InventoryItem{}, err
		}
		if exists > 0 {
			return InventoryItem{}, errors.New("该条码已存在")
		}
	}
	if in.Unit == "" {
		in.Unit = "件"
	}
	if in.PackSize <= 0 {
		in.PackSize = 1
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return InventoryItem{}, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx,
		`INSERT INTO inventory_items(instance_id, name, barcode, category, unit, image_path,
			default_shelf_life_days, after_open_days, min_quantity, pack_size, pack_unit, tags, notes, created_by)
		 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		instanceID, in.Name, in.Barcode, in.Category, in.Unit, in.ImagePath,
		in.DefaultShelfLifeDays, in.AfterOpenDays, in.MinQuantity, in.PackSize, in.PackUnit, in.Tags, in.Notes, user)
	if err != nil {
		return InventoryItem{}, err
	}
	id, _ := res.LastInsertId()
	if first != nil && first.LocationID > 0 && first.Quantity > 0 {
		batchID, err := insertBatch(ctx, tx, id, *first, user)
		if err != nil {
			return InventoryItem{}, err
		}
		if err := addLog(ctx, tx, instanceID, id, batchID, "add", first.Quantity, first.Quantity, user); err != nil {
			return InventoryItem{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return InventoryItem{}, err
	}
	return r.GetItem(ctx, instanceID, id)
}

// UpdateItem 编辑物品主数据。
func (r *InventoryRepo) UpdateItem(ctx context.Context, instanceID, id int64, in InventoryItemInput) (InventoryItem, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return InventoryItem{}, errors.New("物品名称不能为空")
	}
	in.Barcode = strings.TrimSpace(in.Barcode)
	if in.Barcode != "" {
		var exists int
		if err := r.db.QueryRowContext(ctx,
			`SELECT COUNT(1) FROM inventory_items WHERE instance_id=? AND barcode=? AND id<>?`, instanceID, in.Barcode, id).Scan(&exists); err != nil {
			return InventoryItem{}, err
		}
		if exists > 0 {
			return InventoryItem{}, errors.New("该条码已存在")
		}
	}
	if in.Unit == "" {
		in.Unit = "件"
	}
	if in.PackSize <= 0 {
		in.PackSize = 1
	}
	res, err := r.db.ExecContext(ctx,
		`UPDATE inventory_items SET name=?, barcode=?, category=?, unit=?, image_path=?,
			default_shelf_life_days=?, after_open_days=?, min_quantity=?, pack_size=?, pack_unit=?, tags=?, notes=?,
			updated_at=datetime('now') WHERE id=? AND instance_id=?`,
		in.Name, in.Barcode, in.Category, in.Unit, in.ImagePath,
		in.DefaultShelfLifeDays, in.AfterOpenDays, in.MinQuantity, in.PackSize, in.PackUnit, in.Tags, in.Notes,
		id, instanceID)
	if err != nil {
		return InventoryItem{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return InventoryItem{}, ErrNotFound
	}
	return r.GetItem(ctx, instanceID, id)
}

// DeleteItem 删除物品（批次与条码随外键级联）。
func (r *InventoryRepo) DeleteItem(ctx context.Context, instanceID, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM inventory_items WHERE id=? AND instance_id=?`, id, instanceID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ── 批次 ──────────────────────────────────────────────────────────

func (r *InventoryRepo) getBatch(ctx context.Context, instanceID, batchID int64) (InventoryBatch, error) {
	var b InventoryBatch
	var opened int
	err := r.db.QueryRowContext(ctx,
		`SELECT b.id, b.item_id, b.location_id, COALESCE(l.name,''), b.quantity, b.production_date,
			b.expiry_date, b.opened, b.opened_at, b.entry_date, b.entry_price, b.status, b.created_at
		 FROM inventory_batches b
		 JOIN inventory_items i ON i.id=b.item_id
		 LEFT JOIN inventory_locations l ON l.id=b.location_id
		 WHERE b.id=? AND i.instance_id=?`, batchID, instanceID).
		Scan(&b.ID, &b.ItemID, &b.LocationID, &b.LocationName, &b.Quantity, &b.ProductionDate,
			&b.ExpiryDate, &opened, &b.OpenedAt, &b.EntryDate, &b.EntryPrice, &b.Status, &b.CreatedAt)
	if err != nil {
		return InventoryBatch{}, err
	}
	b.Opened = opened != 0
	return b, nil
}

func insertBatch(ctx context.Context, ex interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, itemID int64, in InventoryBatchInput, user string) (int64, error) {
	if in.LocationID <= 0 {
		return 0, errors.New("请选择存放位置")
	}
	if in.Quantity <= 0 {
		in.Quantity = 1
	}
	if in.EntryDate == "" {
		in.EntryDate = time.Now().Format("2006-01-02")
	}
	res, err := ex.ExecContext(ctx,
		`INSERT INTO inventory_batches(item_id, location_id, quantity, production_date, expiry_date, entry_date, entry_price, created_by)
		 VALUES(?,?,?,?,?,?,?,?)`,
		itemID, in.LocationID, in.Quantity, in.ProductionDate, in.ExpiryDate, in.EntryDate, in.EntryPrice, user)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func addLog(ctx context.Context, ex interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, instanceID, itemID, batchID int64, action string, delta, after float64, user string) error {
	_, err := ex.ExecContext(ctx,
		`INSERT INTO inventory_logs(instance_id, item_id, batch_id, action, delta, quantity_after, user, ts_ms)
		 VALUES(?,?,?,?,?,?,?,?)`,
		instanceID, itemID, batchID, action, delta, after, user, time.Now().UnixMilli())
	return err
}

// AddBatch 为已有物品追加批次（再次入库）。
func (r *InventoryRepo) AddBatch(ctx context.Context, instanceID, itemID int64, in InventoryBatchInput, user string) (InventoryBatch, error) {
	if _, err := r.GetItem(ctx, instanceID, itemID); err != nil {
		return InventoryBatch{}, err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return InventoryBatch{}, err
	}
	defer tx.Rollback()
	batchID, err := insertBatch(ctx, tx, itemID, in, user)
	if err != nil {
		return InventoryBatch{}, err
	}
	qty := in.Quantity
	if qty <= 0 {
		qty = 1
	}
	if err := addLog(ctx, tx, instanceID, itemID, batchID, "add", qty, qty, user); err != nil {
		return InventoryBatch{}, err
	}
	if err := tx.Commit(); err != nil {
		return InventoryBatch{}, err
	}
	return r.getBatch(ctx, instanceID, batchID)
}

// ConsumeBatch 消耗批次库存；qty<=0 表示全部消耗。返回剩余数量。
func (r *InventoryRepo) ConsumeBatch(ctx context.Context, instanceID, batchID int64, qty float64, user string) (float64, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var itemID, locationID int64
	var cur float64
	var status string
	err = tx.QueryRowContext(ctx,
		`SELECT b.item_id, b.location_id, b.quantity, b.status FROM inventory_batches b
		 JOIN inventory_items i ON i.id=b.item_id WHERE b.id=? AND i.instance_id=?`, batchID, instanceID).
		Scan(&itemID, &locationID, &cur, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	if status != "active" {
		return 0, errors.New("该批次已结束")
	}
	if qty <= 0 || qty > cur {
		qty = cur
	}
	newQty := cur - qty
	newStatus := "active"
	if newQty <= 0.000001 {
		newQty = 0
		newStatus = "consumed"
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE inventory_batches SET quantity=?, status=?, updated_at=datetime('now') WHERE id=?`,
		newQty, newStatus, batchID); err != nil {
		return 0, err
	}
	if err := addLog(ctx, tx, instanceID, itemID, batchID, "consume", -qty, newQty, user); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return newQty, nil
}

// DiscardBatch 丢弃批次。
func (r *InventoryRepo) DiscardBatch(ctx context.Context, instanceID, batchID int64, user string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var itemID int64
	var cur float64
	var status string
	err = tx.QueryRowContext(ctx,
		`SELECT b.item_id, b.quantity, b.status FROM inventory_batches b
		 JOIN inventory_items i ON i.id=b.item_id WHERE b.id=? AND i.instance_id=?`, batchID, instanceID).
		Scan(&itemID, &cur, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if status != "active" {
		return errors.New("该批次已结束")
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE inventory_batches SET status='discarded', quantity=0, updated_at=datetime('now') WHERE id=?`, batchID); err != nil {
		return err
	}
	if err := addLog(ctx, tx, instanceID, itemID, batchID, "discard", -cur, 0, user); err != nil {
		return err
	}
	return tx.Commit()
}

// MoveBatch 批次移库。
func (r *InventoryRepo) MoveBatch(ctx context.Context, instanceID, batchID, locationID int64, user string) (InventoryBatch, error) {
	if locationID <= 0 {
		return InventoryBatch{}, errors.New("请选择目标位置")
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return InventoryBatch{}, err
	}
	defer tx.Rollback()
	var itemID int64
	var cur float64
	err = tx.QueryRowContext(ctx,
		`SELECT b.item_id, b.quantity FROM inventory_batches b
		 JOIN inventory_items i ON i.id=b.item_id WHERE b.id=? AND i.instance_id=?`, batchID, instanceID).
		Scan(&itemID, &cur)
	if errors.Is(err, sql.ErrNoRows) {
		return InventoryBatch{}, ErrNotFound
	}
	if err != nil {
		return InventoryBatch{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE inventory_batches SET location_id=?, updated_at=datetime('now') WHERE id=?`, locationID, batchID); err != nil {
		return InventoryBatch{}, err
	}
	if err := addLog(ctx, tx, instanceID, itemID, batchID, "move", 0, cur, user); err != nil {
		return InventoryBatch{}, err
	}
	if err := tx.Commit(); err != nil {
		return InventoryBatch{}, err
	}
	return r.getBatch(ctx, instanceID, batchID)
}

// OpenBatch 标记批次已开封。
func (r *InventoryRepo) OpenBatch(ctx context.Context, instanceID, batchID int64, user string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE inventory_batches SET opened=1, opened_at=datetime('now'), updated_at=datetime('now')
		 WHERE id=? AND item_id IN (SELECT id FROM inventory_items WHERE instance_id=?)`, batchID, instanceID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ── 流水与统计 ────────────────────────────────────────────────────

// ListLogs 返回最近的库存流水。
func (r *InventoryRepo) ListLogs(ctx context.Context, instanceID int64, limit int) ([]InventoryLog, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, item_id, batch_id, action, delta, quantity_after, user, ts_ms
		 FROM inventory_logs WHERE instance_id=? ORDER BY ts_ms DESC, id DESC LIMIT ?`, instanceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []InventoryLog
	for rows.Next() {
		var l InventoryLog
		if err := rows.Scan(&l.ID, &l.ItemID, &l.BatchID, &l.Action, &l.Delta, &l.QuantityAfter, &l.User, &l.TsMs); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// Stats 汇总某实例库存。
func (r *InventoryRepo) Stats(ctx context.Context, instanceID int64, expiringDays int) (InventoryStats, error) {
	st := InventoryStats{ByLocation: []LocationStat{}}
	today := time.Now().Format("2006-01-02")
	deadline := time.Now().AddDate(0, 0, expiringDays).Format("2006-01-02")
	if err := r.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(b.quantity),0), COUNT(DISTINCT i.id)
		 FROM inventory_batches b JOIN inventory_items i ON i.id=b.item_id
		 WHERE i.instance_id=? AND b.status='active'`, instanceID).Scan(&st.Total, &st.ItemCount); err != nil {
		return st, err
	}
	if err := r.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(b.quantity*b.entry_price),0)
		 FROM inventory_batches b JOIN inventory_items i ON i.id=b.item_id
		 WHERE i.instance_id=? AND b.status='active'`, instanceID).Scan(&st.TotalValue); err != nil {
		return st, err
	}
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM inventory_batches b JOIN inventory_items i ON i.id=b.item_id
		 WHERE i.instance_id=? AND b.status='active' AND b.expiry_date<>'' AND b.expiry_date<=?`,
		instanceID, deadline).Scan(&st.Expiring); err != nil {
		return st, err
	}
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM inventory_batches b JOIN inventory_items i ON i.id=b.item_id
		 WHERE i.instance_id=? AND b.status='active' AND b.expiry_date<>'' AND b.expiry_date<?`,
		instanceID, today).Scan(&st.Expired); err != nil {
		return st, err
	}
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM inventory_items i WHERE i.instance_id=? AND i.min_quantity>0
		 AND (SELECT COALESCE(SUM(b.quantity),0) FROM inventory_batches b
		      WHERE b.item_id=i.id AND b.status='active') < i.min_quantity`, instanceID).Scan(&st.LowStock); err != nil {
		return st, err
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT l.id, l.name, COALESCE(SUM(b.quantity),0)
		 FROM inventory_locations l
		 LEFT JOIN inventory_batches b ON b.location_id=l.id AND b.status='active'
		 WHERE l.instance_id=? GROUP BY l.id, l.name ORDER BY l.sort, l.id`, instanceID)
	if err != nil {
		return st, err
	}
	defer rows.Close()
	for rows.Next() {
		var ls LocationStat
		if err := rows.Scan(&ls.ID, &ls.Name, &ls.Quantity); err != nil {
			return st, err
		}
		st.ByLocation = append(st.ByLocation, ls)
	}
	return st, rows.Err()
}

// InstanceIDsWithInventory 返回存在库存物品的实例 id（供定时同步使用）。
func (r *InventoryRepo) InstanceIDsWithInventory(ctx context.Context) ([]int64, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT DISTINCT instance_id FROM inventory_items`)
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
