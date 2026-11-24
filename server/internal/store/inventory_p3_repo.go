package store

import (
	"context"
	"time"
)

// StocktakeLine 盘点单行：某物品在某个位置的应有数量。
type StocktakeLine struct {
	ItemID     int64   `json:"item_id"`
	LocationID int64   `json:"location_id"`
	Quantity   float64 `json:"quantity"`
}

// ExpiringBatch 临期/过期批次（用于提醒）。
type ExpiringBatch struct {
	BatchID      int64
	ItemID       int64
	ItemName     string
	ExpiryDate   string
	LocationName string
	Quantity     float64
}

// Stocktake 批量盘点：把指定位置的库存调整为目标数量，逐条写 adjust 流水。
// 返回实际处理的条数。
func (r *InventoryRepo) Stocktake(ctx context.Context, instanceID int64, lines []StocktakeLine, user string) (int, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	today := time.Now().Format("2006-01-02")
	processed := 0
	for _, ln := range lines {
		if ln.ItemID <= 0 || ln.LocationID <= 0 || ln.Quantity < 0 {
			continue
		}
		var exists int
		if err := tx.QueryRowContext(ctx,
			`SELECT COUNT(1) FROM inventory_items WHERE id=? AND instance_id=?`,
			ln.ItemID, instanceID).Scan(&exists); err != nil {
			return processed, err
		}
		if exists == 0 {
			continue
		}
		var cur float64
		if err := tx.QueryRowContext(ctx,
			`SELECT COALESCE(SUM(quantity),0) FROM inventory_batches
			 WHERE item_id=? AND location_id=? AND status='active'`,
			ln.ItemID, ln.LocationID).Scan(&cur); err != nil {
			return processed, err
		}
		diff := ln.Quantity - cur
		if diff > 0.000001 {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO inventory_batches(item_id, location_id, quantity, entry_date, created_by)
				 VALUES(?,?,?,?,?)`, ln.ItemID, ln.LocationID, diff, today, user); err != nil {
				return processed, err
			}
		} else if diff < -0.000001 {
			need := -diff
			rows, err := tx.QueryContext(ctx,
				`SELECT id, quantity FROM inventory_batches
				 WHERE item_id=? AND location_id=? AND status='active' AND quantity>0
				 ORDER BY CASE WHEN expiry_date='' THEN 1 ELSE 0 END, expiry_date, id`,
				ln.ItemID, ln.LocationID)
			if err != nil {
				return processed, err
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
					return processed, err
				}
				list = append(list, b)
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return processed, err
			}
			for _, b := range list {
				if need <= 0 {
					break
				}
				take := b.qty
				if take > need {
					take = need
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
					return processed, err
				}
				need -= take
			}
		}
		if err := addLog(ctx, tx, instanceID, ln.ItemID, 0, "adjust", diff, ln.Quantity, user); err != nil {
			return processed, err
		}
		processed++
	}
	if err := tx.Commit(); err != nil {
		return processed, err
	}
	return processed, nil
}

// ExpiringBatches 返回窗口内（含已过期）的 active 批次。
func (r *InventoryRepo) ExpiringBatches(ctx context.Context, instanceID int64, days int) ([]ExpiringBatch, error) {
	deadline := time.Now().AddDate(0, 0, days).Format("2006-01-02")
	rows, err := r.db.QueryContext(ctx,
		`SELECT b.id, b.item_id, i.name, b.expiry_date, COALESCE(l.name,''), b.quantity
		 FROM inventory_batches b
		 JOIN inventory_items i ON i.id=b.item_id
		 LEFT JOIN inventory_locations l ON l.id=b.location_id
		 WHERE i.instance_id=? AND b.status='active' AND b.expiry_date<>'' AND b.expiry_date<=?
		 ORDER BY b.expiry_date, b.id`, instanceID, deadline)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ExpiringBatch
	for rows.Next() {
		var b ExpiringBatch
		if err := rows.Scan(&b.BatchID, &b.ItemID, &b.ItemName, &b.ExpiryDate, &b.LocationName, &b.Quantity); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// MarkReminder 记录「批次 + 日期」已提醒；返回 true 表示本次为新插入（需要推送）。
func (r *InventoryRepo) MarkReminder(ctx context.Context, instanceID, batchID int64, date string) (bool, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO inventory_reminders(instance_id, batch_id, remind_date) VALUES(?,?,?)`,
		instanceID, batchID, date)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}
