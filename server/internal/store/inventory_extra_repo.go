package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// ShoppingItem 购物清单条目。
type ShoppingItem struct {
	ID        int64   `json:"id"`
	ItemID    int64   `json:"item_id"`
	Name      string  `json:"name"`
	Quantity  float64 `json:"quantity"`
	Unit      string  `json:"unit"`
	Note      string  `json:"note"`
	Done      bool    `json:"done"`
	CreatedBy string  `json:"created_by"`
	CreatedAt string  `json:"created_at"`
	DoneAt    string  `json:"done_at"`
}

// ShoppingInput 新增/编辑购物清单条目。
type ShoppingInput struct {
	ItemID   int64   `json:"item_id"`
	Name     string  `json:"name"`
	Quantity float64 `json:"quantity"`
	Unit     string  `json:"unit"`
	Note     string  `json:"note"`
}

// BarcodeMapping 条码到物品的本地映射。
type BarcodeMapping struct {
	Barcode  string `json:"barcode"`
	ItemID   int64  `json:"item_id"`
	ItemName string `json:"item_name"`
}

const shoppingCols = `id, item_id, name, quantity, unit, note, done, created_by, created_at, done_at`

func scanShopping(row interface{ Scan(...any) error }) (ShoppingItem, error) {
	var s ShoppingItem
	var done int
	err := row.Scan(&s.ID, &s.ItemID, &s.Name, &s.Quantity, &s.Unit, &s.Note, &done,
		&s.CreatedBy, &s.CreatedAt, &s.DoneAt)
	s.Done = done != 0
	return s, err
}

// ListShopping 返回购物清单（默认只看未完成）。
func (r *InventoryRepo) ListShopping(ctx context.Context, instanceID int64, includeDone bool) ([]ShoppingItem, error) {
	q := `SELECT ` + shoppingCols + ` FROM inventory_shopping_list WHERE instance_id=?`
	if !includeDone {
		q += ` AND done=0`
	}
	q += ` ORDER BY done, id`
	rows, err := r.db.QueryContext(ctx, q, instanceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ShoppingItem
	for rows.Next() {
		s, err := scanShopping(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *InventoryRepo) getShopping(ctx context.Context, instanceID, id int64) (ShoppingItem, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT `+shoppingCols+` FROM inventory_shopping_list WHERE id=? AND instance_id=?`, id, instanceID)
	s, err := scanShopping(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ShoppingItem{}, ErrNotFound
	}
	return s, err
}

// AddShopping 新增条目；同一物品已有未完成项时合并数量。
func (r *InventoryRepo) AddShopping(ctx context.Context, instanceID int64, in ShoppingInput, user string) (ShoppingItem, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" && in.ItemID <= 0 {
		return ShoppingItem{}, errors.New("清单名称不能为空")
	}
	if in.Quantity <= 0 {
		in.Quantity = 1
	}
	if in.Unit == "" {
		in.Unit = "件"
	}
	if in.ItemID > 0 {
		var id int64
		err := r.db.QueryRowContext(ctx,
			`SELECT id FROM inventory_shopping_list WHERE instance_id=? AND item_id=? AND done=0 LIMIT 1`,
			instanceID, in.ItemID).Scan(&id)
		if err == nil {
			if _, err := r.db.ExecContext(ctx,
				`UPDATE inventory_shopping_list SET quantity=quantity+? WHERE id=?`, in.Quantity, id); err != nil {
				return ShoppingItem{}, err
			}
			return r.getShopping(ctx, instanceID, id)
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return ShoppingItem{}, err
		}
	}
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO inventory_shopping_list(instance_id, item_id, name, quantity, unit, note, created_by)
		 VALUES(?,?,?,?,?,?,?)`, instanceID, in.ItemID, in.Name, in.Quantity, in.Unit, in.Note, user)
	if err != nil {
		return ShoppingItem{}, err
	}
	id, _ := res.LastInsertId()
	return r.getShopping(ctx, instanceID, id)
}

// UpdateShopping 编辑条目。
func (r *InventoryRepo) UpdateShopping(ctx context.Context, instanceID, id int64, in ShoppingInput) (ShoppingItem, error) {
	if in.Quantity <= 0 {
		in.Quantity = 1
	}
	if in.Unit == "" {
		in.Unit = "件"
	}
	res, err := r.db.ExecContext(ctx,
		`UPDATE inventory_shopping_list SET name=?, quantity=?, unit=?, note=? WHERE id=? AND instance_id=?`,
		strings.TrimSpace(in.Name), in.Quantity, in.Unit, in.Note, id, instanceID)
	if err != nil {
		return ShoppingItem{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ShoppingItem{}, ErrNotFound
	}
	return r.getShopping(ctx, instanceID, id)
}

// CheckShopping 勾选/取消完成。
func (r *InventoryRepo) CheckShopping(ctx context.Context, instanceID, id int64, done bool) error {
	d := 0
	if done {
		d = 1
	}
	res, err := r.db.ExecContext(ctx,
		`UPDATE inventory_shopping_list SET done=?, done_at=CASE WHEN ?=1 THEN datetime('now') ELSE '' END
		 WHERE id=? AND instance_id=?`, d, d, id, instanceID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteShopping 删除条目。
func (r *InventoryRepo) DeleteShopping(ctx context.Context, instanceID, id int64) error {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM inventory_shopping_list WHERE id=? AND instance_id=?`, id, instanceID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// PurchaseShopping 把购物清单条目入库：按名称复用/创建物品，新增批次并标记完成。
func (r *InventoryRepo) PurchaseShopping(ctx context.Context, instanceID, shoppingID int64, in InventoryBatchInput, user string) (InventoryItem, InventoryBatch, error) {
	if in.LocationID <= 0 {
		return InventoryItem{}, InventoryBatch{}, errors.New("请选择存放位置")
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return InventoryItem{}, InventoryBatch{}, err
	}
	defer tx.Rollback()
	var itemID int64
	var name, unit string
	var qty float64
	var done int
	err = tx.QueryRowContext(ctx,
		`SELECT item_id, name, unit, quantity, done FROM inventory_shopping_list
		 WHERE id=? AND instance_id=?`, shoppingID, instanceID).
		Scan(&itemID, &name, &unit, &qty, &done)
	if errors.Is(err, sql.ErrNoRows) {
		return InventoryItem{}, InventoryBatch{}, ErrNotFound
	}
	if err != nil {
		return InventoryItem{}, InventoryBatch{}, err
	}
	if done != 0 {
		return InventoryItem{}, InventoryBatch{}, errors.New("该条目已入库")
	}
	if unit == "" {
		unit = "件"
	}
	if itemID > 0 {
		var exists int
		if err := tx.QueryRowContext(ctx,
			`SELECT COUNT(1) FROM inventory_items WHERE id=? AND instance_id=?`, itemID, instanceID).Scan(&exists); err != nil {
			return InventoryItem{}, InventoryBatch{}, err
		}
		if exists == 0 {
			itemID = 0
		}
	}
	if itemID == 0 {
		err := tx.QueryRowContext(ctx,
			`SELECT id FROM inventory_items WHERE instance_id=? AND name=? ORDER BY id LIMIT 1`,
			instanceID, name).Scan(&itemID)
		if errors.Is(err, sql.ErrNoRows) {
			res, ierr := tx.ExecContext(ctx,
				`INSERT INTO inventory_items(instance_id, name, unit, created_by) VALUES(?,?,?,?)`,
				instanceID, name, unit, user)
			if ierr != nil {
				return InventoryItem{}, InventoryBatch{}, ierr
			}
			itemID, _ = res.LastInsertId()
		} else if err != nil {
			return InventoryItem{}, InventoryBatch{}, err
		}
	}
	if in.Quantity <= 0 {
		in.Quantity = qty
	}
	if in.Quantity <= 0 {
		in.Quantity = 1
	}
	batchID, err := insertBatch(ctx, tx, itemID, in, user)
	if err != nil {
		return InventoryItem{}, InventoryBatch{}, err
	}
	if err := addLog(ctx, tx, instanceID, itemID, batchID, "add", in.Quantity, in.Quantity, user); err != nil {
		return InventoryItem{}, InventoryBatch{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE inventory_shopping_list SET done=1, done_at=datetime('now') WHERE id=?`, shoppingID); err != nil {
		return InventoryItem{}, InventoryBatch{}, err
	}
	if err := tx.Commit(); err != nil {
		return InventoryItem{}, InventoryBatch{}, err
	}
	item, err := r.GetItem(ctx, instanceID, itemID)
	if err != nil {
		return InventoryItem{}, InventoryBatch{}, err
	}
	batch, err := r.getBatch(ctx, instanceID, batchID)
	return item, batch, err
}

// ── 条码映射 ──────────────────────────────────────────────────────

// BindBarcode 绑定条码到物品（同一条码再次绑定则改指向）。
func (r *InventoryRepo) BindBarcode(ctx context.Context, instanceID int64, barcode string, itemID int64, source string) error {
	barcode = strings.TrimSpace(barcode)
	if barcode == "" || itemID <= 0 {
		return errors.New("条码与物品不能为空")
	}
	if source == "" {
		source = "manual"
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO inventory_barcodes(instance_id, barcode, item_id, source) VALUES(?,?,?,?)
		 ON CONFLICT(instance_id, barcode) DO UPDATE SET item_id=excluded.item_id, source=excluded.source`,
		instanceID, barcode, itemID, source)
	return err
}

// GetBarcode 按条码查本地映射。
// 先查独立条码表（一个物品可绑定多个条码），再回退到物品自身的 barcode 字段：
// 新增/编辑物品时填写的条码此前不会写入条码表，导致再次扫同一件商品仍显示未收录。
func (r *InventoryRepo) GetBarcode(ctx context.Context, instanceID int64, barcode string) (BarcodeMapping, error) {
	var m BarcodeMapping
	barcode = strings.TrimSpace(barcode)
	err := r.db.QueryRowContext(ctx,
		`SELECT b.barcode, b.item_id, COALESCE(i.name,'')
		 FROM inventory_barcodes b LEFT JOIN inventory_items i ON i.id=b.item_id
		 WHERE b.instance_id=? AND b.barcode=?`, instanceID, barcode).
		Scan(&m.Barcode, &m.ItemID, &m.ItemName)
	if errors.Is(err, sql.ErrNoRows) {
		err = r.db.QueryRowContext(ctx,
			`SELECT COALESCE(barcode,''), id, COALESCE(name,'')
			 FROM inventory_items WHERE instance_id=? AND barcode=? LIMIT 1`,
			instanceID, barcode).Scan(&m.Barcode, &m.ItemID, &m.ItemName)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return BarcodeMapping{}, ErrNotFound
	}
	return m, err
}

// ── FEFO 消耗 ─────────────────────────────────────────────────────

// ConsumeItemFEFO 按先到期先出消耗某物品的库存；qty<=0 表示全部消耗。
// 返回本次实际消耗数量。
func (r *InventoryRepo) ConsumeItemFEFO(ctx context.Context, instanceID, itemID int64, qty float64, user string) (float64, error) {
	if _, err := r.GetItem(ctx, instanceID, itemID); err != nil {
		return 0, err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	if qty <= 0 {
		if err := tx.QueryRowContext(ctx,
			`SELECT COALESCE(SUM(quantity),0) FROM inventory_batches WHERE item_id=? AND status='active'`,
			itemID).Scan(&qty); err != nil {
			return 0, err
		}
	}
	if qty <= 0 {
		return 0, nil
	}

	rows, err := tx.QueryContext(ctx,
		`SELECT id, quantity FROM inventory_batches
		 WHERE item_id=? AND status='active' AND quantity>0
		 ORDER BY CASE WHEN expiry_date='' THEN 1 ELSE 0 END, expiry_date, id`, itemID)
	if err != nil {
		return 0, err
	}
	type batchQty struct {
		id  int64
		qty float64
	}
	var list []batchQty
	for rows.Next() {
		var b batchQty
		if err := rows.Scan(&b.id, &b.qty); err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, b)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	remaining := qty
	var consumed float64
	for _, b := range list {
		if remaining <= 0 {
			break
		}
		take := b.qty
		if take > remaining {
			take = remaining
		}
		newQty := b.qty - take
		status := "active"
		if newQty <= 0.000001 {
			newQty = 0
			status = "consumed"
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE inventory_batches SET quantity=?, status=?, updated_at=datetime('now') WHERE id=?`,
			newQty, status, b.id); err != nil {
			return 0, err
		}
		if err := addLog(ctx, tx, instanceID, itemID, b.id, "consume", -take, newQty, user); err != nil {
			return 0, err
		}
		remaining -= take
		consumed += take
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return consumed, nil
}
