package handler

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"stickykee/server/internal/store"

	"github.com/go-chi/chi/v5"
)

// Inventory 提供库存/食品库的 REST 接口。
type Inventory struct {
	repo *store.InventoryRepo
	fin  *store.FinanceRepo
	inst *store.InstanceRepo
	sync *InventorySync
	ai   *AI
}

// NewInventory 构造 handler。
func NewInventory(repo *store.InventoryRepo, fin *store.FinanceRepo, inst *store.InstanceRepo, sync *InventorySync, ai *AI) *Inventory {
	return &Inventory{repo: repo, fin: fin, inst: inst, sync: sync, ai: ai}
}

// active 解析当前激活实例；未配置时写错误并返回 false。
func (h *Inventory) active(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := h.inst.ActiveID(r.Context())
	if err != nil || id <= 0 {
		WriteErr(w, 400, "no_instance", "请先在设置中添加并启用 Home Assistant 实例")
		return 0, false
	}
	return id, true
}

func (h *Inventory) changed(instanceID int64) {
	if h.sync != nil {
		h.sync.RequestSync(instanceID)
	}
}

// cents 把「单价 × 数量（元）」换算为分；非正数返回 0。
func cents(price, qty float64) int64 {
	if price <= 0 || qty <= 0 {
		return 0
	}
	return int64(math.Round(price * qty * 100))
}

// recordPurchase 库存入库自动记一笔支出（金额为 0 或未配置账本时跳过）。
func (h *Inventory) recordPurchase(instanceID int64, itemName, category string, b store.InventoryBatch, user string) {
	if h.fin == nil {
		return
	}
	amount := cents(b.EntryPrice, b.Quantity)
	if amount <= 0 {
		return
	}
	if err := h.fin.RecordInventoryPurchase(context.Background(), instanceID,
		itemName, category, b.ID, amount, b.EntryDate, user); err != nil {
		slog.Warn("inventory auto finance: purchase failed", "instance", instanceID, "batch", b.ID, "err", err.Error())
	}
}

// financeLossEnabled 实例设置：丢弃批次是否记损耗，默认开启。
func (h *Inventory) financeLossEnabled(ctx context.Context) bool {
	v, _ := h.inst.GetPref(ctx, "finance_loss_enabled")
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "0", "false", "off", "no":
		return false
	}
	return true
}

// recordLoss 丢弃批次自动记一笔损耗支出。
func (h *Inventory) recordLoss(instanceID int64, itemName string, b store.InventoryBatch, user string) {
	if h.fin == nil {
		return
	}
	amount := cents(b.EntryPrice, b.Quantity)
	if amount <= 0 {
		return
	}
	if err := h.fin.RecordInventoryLoss(context.Background(), instanceID,
		itemName, b.ID, amount, "", user); err != nil {
		slog.Warn("inventory auto finance: loss failed", "instance", instanceID, "batch", b.ID, "err", err.Error())
	}
}

// invErr 把仓储错误映射为响应。
func invErr(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		WriteErr(w, 404, "not_found", "记录不存在")
		return
	}
	WriteErr(w, 400, "bad_request", err.Error())
}

func invID(r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func invQueryInt(r *http.Request, key string) int64 {
	v, _ := strconv.ParseInt(r.URL.Query().Get(key), 10, 64)
	return v
}

// ── 位置 ──────────────────────────────────────────────────────────

type inventoryLocationPayload struct {
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	Icon       string `json:"icon"`
	HAEntityID string `json:"ha_entity_id"`
	ParentID   int64  `json:"parent_id"`
	Sort       int    `json:"sort"`
}

// ListLocations GET /inventory/locations
func (h *Inventory) ListLocations(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	list, err := h.repo.ListLocations(r.Context(), id)
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, list)
}

// CreateLocation POST /inventory/locations
func (h *Inventory) CreateLocation(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	var p inventoryLocationPayload
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	l, err := h.repo.CreateLocation(r.Context(), id, p.Name, p.Kind, p.Icon, p.HAEntityID, p.ParentID, p.Sort)
	if err != nil {
		invErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 201, l)
}

// UpdateLocation PUT /inventory/locations/{id}
func (h *Inventory) UpdateLocation(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	lid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "位置不存在")
		return
	}
	var p inventoryLocationPayload
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	l, err := h.repo.UpdateLocation(r.Context(), id, lid, p.Name, p.Kind, p.Icon, p.HAEntityID, p.ParentID, p.Sort)
	if err != nil {
		invErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 200, l)
}

// DeleteLocation DELETE /inventory/locations/{id}
func (h *Inventory) DeleteLocation(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	lid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "位置不存在")
		return
	}
	if err := h.repo.DeleteLocation(r.Context(), id, lid); err != nil {
		invErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 200, true)
}

// ── 物品 ──────────────────────────────────────────────────────────

type inventoryItemPayload struct {
	store.InventoryItemInput
	FirstBatch *store.InventoryBatchInput `json:"first_batch"`
}

// ListItems GET /inventory/items?location=&q=&category=&expiring_days=&low_stock=
func (h *Inventory) ListItems(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	lowStock := r.URL.Query().Get("low_stock")
	f := store.InventoryFilter{
		LocationID:   invQueryInt(r, "location"),
		Query:        r.URL.Query().Get("q"),
		Category:     r.URL.Query().Get("category"),
		ExpiringDays: int(invQueryInt(r, "expiring_days")),
		LowStock:     lowStock == "1" || lowStock == "true",
	}
	list, err := h.repo.ListItems(r.Context(), id, f)
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, list)
}

// CreateItem POST /inventory/items
func (h *Inventory) CreateItem(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	var p inventoryItemPayload
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	it, err := h.repo.CreateItem(r.Context(), id, p.InventoryItemInput, p.FirstBatch, rUsername(r))
	if err != nil {
		invErr(w, err)
		return
	}
	// 首批次带单价：自动记一笔入库支出。
	if p.FirstBatch != nil && len(it.Batches) > 0 {
		h.recordPurchase(id, it.Name, it.Category, it.Batches[0], rUsername(r))
	}
	h.changed(id)
	WriteJSON(w, 201, it)
}

// GetItem GET /inventory/items/{id}
func (h *Inventory) GetItem(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	iid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "物品不存在")
		return
	}
	it, err := h.repo.GetItem(r.Context(), id, iid)
	if err != nil {
		invErr(w, err)
		return
	}
	WriteJSON(w, 200, it)
}

// UpdateItem PUT /inventory/items/{id}
func (h *Inventory) UpdateItem(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	iid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "物品不存在")
		return
	}
	var p inventoryItemPayload
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	it, err := h.repo.UpdateItem(r.Context(), id, iid, p.InventoryItemInput)
	if err != nil {
		invErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 200, it)
}

// DeleteItem DELETE /inventory/items/{id}
func (h *Inventory) DeleteItem(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	iid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "物品不存在")
		return
	}
	if err := h.repo.DeleteItem(r.Context(), id, iid); err != nil {
		invErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 200, true)
}

// ── 批次 ──────────────────────────────────────────────────────────

// AddBatch POST /inventory/items/{id}/batches
func (h *Inventory) AddBatch(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	iid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "物品不存在")
		return
	}
	var p store.InventoryBatchInput
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	b, err := h.repo.AddBatch(r.Context(), id, iid, p, rUsername(r))
	if err != nil {
		invErr(w, err)
		return
	}
	// 入库批次带单价：自动记一笔入库支出。
	if it, ierr := h.repo.GetItem(r.Context(), id, iid); ierr == nil {
		h.recordPurchase(id, it.Name, it.Category, b, rUsername(r))
	}
	h.changed(id)
	WriteJSON(w, 201, b)
}

type inventoryConsumePayload struct {
	Qty float64 `json:"qty"`
}

// ConsumeBatch POST /inventory/batches/{id}/consume
func (h *Inventory) ConsumeBatch(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	bid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "批次不存在")
		return
	}
	var p inventoryConsumePayload
	_ = DecodeBody(r, &p)
	remain, err := h.repo.ConsumeBatch(r.Context(), id, bid, p.Qty, rUsername(r))
	if err != nil {
		invErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 200, map[string]any{"remaining": remain})
}

// DiscardBatch POST /inventory/batches/{id}/discard
func (h *Inventory) DiscardBatch(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	bid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "批次不存在")
		return
	}
	b, err := h.repo.DiscardBatch(r.Context(), id, bid, rUsername(r))
	if err != nil {
		invErr(w, err)
		return
	}
	// 丢弃可选记损耗（实例设置 finance_loss_enabled，默认开）。
	if h.financeLossEnabled(r.Context()) {
		if it, ierr := h.repo.GetItem(r.Context(), id, b.ItemID); ierr == nil {
			h.recordLoss(id, it.Name, b, rUsername(r))
		}
	}
	h.changed(id)
	WriteJSON(w, 200, true)
}

type inventoryMovePayload struct {
	LocationID int64 `json:"location_id"`
}

// MoveBatch POST /inventory/batches/{id}/move
func (h *Inventory) MoveBatch(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	bid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "批次不存在")
		return
	}
	var p inventoryMovePayload
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	b, err := h.repo.MoveBatch(r.Context(), id, bid, p.LocationID, rUsername(r))
	if err != nil {
		invErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 200, b)
}

// OpenBatch POST /inventory/batches/{id}/open
func (h *Inventory) OpenBatch(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	bid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "批次不存在")
		return
	}
	if err := h.repo.OpenBatch(r.Context(), id, bid, rUsername(r)); err != nil {
		invErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 200, true)
}

// ── 统计与流水 ────────────────────────────────────────────────────

// Stats GET /inventory/stats
func (h *Inventory) Stats(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	days := int(invQueryInt(r, "expiring_days"))
	if days <= 0 {
		days = 3
	}
	st, err := h.repo.Stats(r.Context(), id, days)
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, st)
}

// Logs GET /inventory/logs?limit=
func (h *Inventory) Logs(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	list, err := h.repo.ListLogs(r.Context(), id, int(invQueryInt(r, "limit")))
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, list)
}

// ── 购物清单 ──────────────────────────────────────────────────────

// ListShopping GET /inventory/shopping-list?all=1
func (h *Inventory) ListShopping(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	includeDone := r.URL.Query().Get("all") == "1"
	list, err := h.repo.ListShopping(r.Context(), id, includeDone)
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, list)
}

// AddShopping POST /inventory/shopping-list
func (h *Inventory) AddShopping(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	var p store.ShoppingInput
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	item, err := h.repo.AddShopping(r.Context(), id, p, rUsername(r))
	if err != nil {
		invErr(w, err)
		return
	}
	WriteJSON(w, 201, item)
}

// UpdateShopping PUT /inventory/shopping-list/{id}
func (h *Inventory) UpdateShopping(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	sid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "条目不存在")
		return
	}
	var p store.ShoppingInput
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	item, err := h.repo.UpdateShopping(r.Context(), id, sid, p)
	if err != nil {
		invErr(w, err)
		return
	}
	WriteJSON(w, 200, item)
}

type inventoryCheckPayload struct {
	Done bool `json:"done"`
}

// CheckShopping POST /inventory/shopping-list/{id}/check
func (h *Inventory) CheckShopping(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	sid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "条目不存在")
		return
	}
	var p inventoryCheckPayload
	_ = DecodeBody(r, &p)
	if err := h.repo.CheckShopping(r.Context(), id, sid, p.Done); err != nil {
		invErr(w, err)
		return
	}
	WriteJSON(w, 200, true)
}

// DeleteShopping DELETE /inventory/shopping-list/{id}
func (h *Inventory) DeleteShopping(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	sid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "条目不存在")
		return
	}
	if err := h.repo.DeleteShopping(r.Context(), id, sid); err != nil {
		invErr(w, err)
		return
	}
	WriteJSON(w, 200, true)
}

type inventoryShoppingPurchasePayload struct {
	LocationID     int64   `json:"location_id"`
	Quantity       float64 `json:"quantity"`
	EntryPrice     float64 `json:"entry_price"`
	ProductionDate string  `json:"production_date"`
	ExpiryDate     string  `json:"expiry_date"`
	EntryDate      string  `json:"entry_date"`
}

// PurchaseShopping POST /inventory/shopping-list/{id}/purchase
// 购物清单条目入库：新建/复用物品与批次，并自动记一笔采购支出。
func (h *Inventory) PurchaseShopping(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	sid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "条目不存在")
		return
	}
	var p inventoryShoppingPurchasePayload
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	it, b, err := h.repo.PurchaseShopping(r.Context(), id, sid, store.InventoryBatchInput{
		LocationID:     p.LocationID,
		Quantity:       p.Quantity,
		ProductionDate: p.ProductionDate,
		ExpiryDate:     p.ExpiryDate,
		EntryDate:      p.EntryDate,
		EntryPrice:     p.EntryPrice,
	}, rUsername(r))
	if err != nil {
		invErr(w, err)
		return
	}
	if h.fin != nil {
		if amount := cents(b.EntryPrice, b.Quantity); amount > 0 {
			if ferr := h.fin.RecordShoppingPurchase(context.Background(), id,
				it.Name, it.Category, sid, amount, b.EntryDate, rUsername(r)); ferr != nil {
				slog.Warn("inventory auto finance: shopping purchase failed", "instance", id, "shopping", sid, "err", ferr.Error())
			}
		}
	}
	h.changed(id)
	WriteJSON(w, 201, map[string]any{"item": it, "batch": b})
}

type inventoryToShoppingPayload struct {
	Quantity float64 `json:"quantity"`
}

// ItemToShopping POST /inventory/items/{id}/to-shopping
func (h *Inventory) ItemToShopping(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	iid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "物品不存在")
		return
	}
	var p inventoryToShoppingPayload
	_ = DecodeBody(r, &p)
	it, err := h.repo.GetItem(r.Context(), id, iid)
	if err != nil {
		invErr(w, err)
		return
	}
	qty := p.Quantity
	if qty <= 0 {
		qty = 1
	}
	item, err := h.repo.AddShopping(r.Context(), id, store.ShoppingInput{
		ItemID: it.ID, Name: it.Name, Unit: it.Unit, Quantity: qty,
	}, rUsername(r))
	if err != nil {
		invErr(w, err)
		return
	}
	WriteJSON(w, 201, item)
}

// ── 条码 ──────────────────────────────────────────────────────────

// GetBarcode GET /inventory/barcodes/{code}
func (h *Inventory) GetBarcode(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	code := strings.TrimSpace(chi.URLParam(r, "code"))
	m, err := h.repo.GetBarcode(r.Context(), id, code)
	if err != nil {
		invErr(w, err)
		return
	}
	WriteJSON(w, 200, m)
}

type inventoryBarcodePayload struct {
	Barcode string `json:"barcode"`
	ItemID  int64  `json:"item_id"`
}

// BindBarcode POST /inventory/barcodes
func (h *Inventory) BindBarcode(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	var p inventoryBarcodePayload
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	if err := h.repo.BindBarcode(r.Context(), id, p.Barcode, p.ItemID, "manual"); err != nil {
		invErr(w, err)
		return
	}
	WriteJSON(w, 200, true)
}

// ── FEFO 消耗 ─────────────────────────────────────────────────────

// ConsumeItem POST /inventory/items/{id}/consume {qty}
func (h *Inventory) ConsumeItem(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	iid, ok := invID(r, "id")
	if !ok {
		WriteErr(w, 404, "not_found", "物品不存在")
		return
	}
	var p inventoryConsumePayload
	_ = DecodeBody(r, &p)
	consumed, err := h.repo.ConsumeItemFEFO(r.Context(), id, iid, p.Qty, rUsername(r))
	if err != nil {
		invErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 200, map[string]any{"consumed": consumed})
}

// ── 识图 ──────────────────────────────────────────────────────────

type inventoryRecognizePayload struct {
	Image string `json:"image"`
}

// Recognize POST /inventory/recognize 图片 → 结构化候选。
func (h *Inventory) Recognize(w http.ResponseWriter, r *http.Request) {
	var p inventoryRecognizePayload
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
	messages := []map[string]any{
		{"role": "system", "content": "你是食品与日常物品识别助手。只输出 JSON，不要解释。"},
		{"role": "user", "content": []map[string]any{
			{"type": "text", "text": "识别图片中的主要物品，返回严格 JSON 对象，字段：name(名称)、category(食品/饮料/药品/日用品)、unit(件/盒/瓶)、quantity(数量)、expiry_date(yyyy-mm-dd，看不清则空)、barcode(可见则填)、confidence(0-1)。"},
			{"type": "image_url", "image_url": map[string]any{"url": p.Image}},
		}},
	}
	text, err := h.ai.CompleteByUser(r.Context(), rUsername(r), messages, 0.2)
	if err != nil {
		WriteErr(w, 502, "ai_error", err.Error())
		return
	}
	WriteJSON(w, 200, map[string]any{
		"raw":       text,
		"candidate": extractJSONObject(text),
	})
}

func extractJSONObject(s string) any {
	s = strings.TrimSpace(s)
	if i := strings.Index(s, "```"); i >= 0 {
		s = s[i+3:]
		if j := strings.Index(s, "\n"); j >= 0 {
			s = s[j+1:]
		}
		if j := strings.Index(s, "```"); j >= 0 {
			s = s[:j]
		}
	}
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start >= 0 && end > start {
		var v any
		if json.Unmarshal([]byte(s[start:end+1]), &v) == nil {
			return v
		}
	}
	return nil
}

// ── 盘点与导出 ────────────────────────────────────────────────────

type inventoryStocktakePayload struct {
	Lines []store.StocktakeLine `json:"lines"`
}

// Stocktake POST /inventory/stocktake
func (h *Inventory) Stocktake(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	var p inventoryStocktakePayload
	if err := DecodeBody(r, &p); err != nil || len(p.Lines) == 0 {
		WriteErr(w, 400, "bad_request", "请提供盘点数据")
		return
	}
	n, err := h.repo.Stocktake(r.Context(), id, p.Lines, rUsername(r))
	if err != nil {
		invErr(w, err)
		return
	}
	h.changed(id)
	WriteJSON(w, 200, map[string]any{"processed": n})
}

// Export GET /inventory/export 返回 CSV 文本（前端转成文件下载）。
func (h *Inventory) Export(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	list, err := h.repo.ListItems(r.Context(), id, store.InventoryFilter{})
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	var buf bytes.Buffer
	buf.WriteString("\uFEFF") // 带 BOM，Excel 打开中文不乱码
	cw := csv.NewWriter(&buf)
	_ = cw.Write([]string{"名称", "条码", "分类", "单位", "在库数量", "最近到期", "需补货", "位置", "备注"})
	for _, it := range list {
		seen := map[string]bool{}
		var names []string
		for _, b := range it.Batches {
			if b.LocationName != "" && !seen[b.LocationName] {
				seen[b.LocationName] = true
				names = append(names, b.LocationName)
			}
		}
		low := ""
		if it.LowStock {
			low = "是"
		}
		_ = cw.Write([]string{
			it.Name, it.Barcode, it.Category, it.Unit,
			strconv.FormatFloat(it.TotalQuantity, 'f', -1, 64),
			it.NearestExpiry, low, strings.Join(names, "/"), it.Notes,
		})
	}
	cw.Flush()
	WriteJSON(w, 200, map[string]any{
		"filename": "inventory-" + time.Now().Format("20060102") + ".csv",
		"content":  buf.String(),
	})
}
