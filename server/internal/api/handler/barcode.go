package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
)

// 商品条码在线识别：本地 inventory_barcodes 只记录「用户绑定过」的条码，
// 未绑定过的商品需要联网到公开商品库补全名称（微信扫码识物用的也是商品数据库）。
// 这里使用 Open Food Facts（开放、免 Key，覆盖大量国内外食品饮料）；
// 查询失败/未收录时前端仍会打开新增表单，只是名称需手填。
// 国内网络访问 openfoodfacts 偶有抖动，故同时尝试国际站与中文站两个入口。

type barcodeProduct struct {
	Barcode  string `json:"barcode"`
	Name     string `json:"name"`
	Brand    string `json:"brand,omitempty"`
	Category string `json:"category,omitempty"`
	Quantity string `json:"quantity,omitempty"`
	Source   string `json:"source"`
}

var barcodeDigits = regexp.MustCompile(`^[0-9]{8,14}$`)

var barcodeHosts = []string{
	"https://world.openfoodfacts.org",
	"https://cn.openfoodfacts.org",
}

// 查询结果三态：命中 / 商品库明确未收录 / 网络不可用（不缓存，稍后重试）
type barcodeLookup int

const (
	barcodeMiss barcodeLookup = iota
	barcodeHit
	barcodeUnavailable
)

type barcodeCacheEntry struct {
	product barcodeProduct
	found   bool
	at      time.Time
}

var (
	barcodeCacheMu sync.Mutex
	barcodeCache   = map[string]barcodeCacheEntry{}
	barcodeHTTP    = &http.Client{Timeout: 6 * time.Second}
)

const barcodeCacheTTL = 12 * time.Hour

// LookupBarcodeProduct GET /inventory/barcodes/{code}/product
// 只查在线商品库，不读写本地映射；前端在本地未命中时异步调用，用于预填新增表单。
func (h *Inventory) LookupBarcodeProduct(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.active(w, r); !ok {
		return
	}
	code := strings.TrimSpace(chi.URLParam(r, "code"))
	if !barcodeDigits.MatchString(code) {
		WriteErr(w, 404, "not_found", "当前条码不支持联网识别")
		return
	}
	if e, ok := getBarcodeCache(code); ok {
		if !e.found {
			WriteErr(w, 404, "not_found", "商品库未收录该条码")
			return
		}
		WriteJSON(w, 200, e.product)
		return
	}

	p, result := lookupBarcodeProduct(r.Context(), code)
	switch result {
	case barcodeHit:
		putBarcodeCache(code, p, true)
		WriteJSON(w, 200, p)
	case barcodeMiss:
		putBarcodeCache(code, barcodeProduct{}, false)
		WriteErr(w, 404, "not_found", "商品库未收录该条码")
	default:
		// 网络抖动不写缓存：下次扫描可立即重试
		WriteErr(w, 503, "barcode_unavailable", "商品库暂时不可用，请稍后重试")
	}
}

// openFoodFactsResp 只取需要的字段，避免商品详情页级别的大响应。
type openFoodFactsResp struct {
	Status  int `json:"status"`
	Product struct {
		Name       string   `json:"product_name"`
		NameZh     string   `json:"product_name_zh"`
		Generic    string   `json:"generic_name"`
		Brands     string   `json:"brands"`
		Categories string   `json:"categories"`
		Tags       []string `json:"categories_tags"`
		Quantity   string   `json:"quantity"`
	} `json:"product"`
}

func lookupBarcodeProduct(ctx context.Context, code string) (barcodeProduct, barcodeLookup) {
	// 两个入口并行查询，取最先命中的结果，避免串行等待翻倍
	type lookupOut struct {
		product barcodeProduct
		result  barcodeLookup
	}
	ch := make(chan lookupOut, len(barcodeHosts))
	for _, host := range barcodeHosts {
		go func(host string) {
			p, result := queryOpenFacts(ctx, host, code)
			ch <- lookupOut{product: p, result: result}
		}(host)
	}

	visited := false
	unavailable := false
	for i := 0; i < len(barcodeHosts); i++ {
		out := <-ch
		switch out.result {
		case barcodeHit:
			return out.product, barcodeHit
		case barcodeMiss:
			visited = true // 至少有一个入口明确答复「没有此商品」
		default:
			unavailable = true
		}
	}
	if visited {
		return barcodeProduct{}, barcodeMiss
	}
	if unavailable {
		return barcodeProduct{}, barcodeUnavailable
	}
	return barcodeProduct{}, barcodeMiss
}

func queryOpenFacts(ctx context.Context, host, code string) (barcodeProduct, barcodeLookup) {
	url := host + "/api/v2/product/" + code +
		".json?fields=product_name,product_name_zh,generic_name,brands,categories,categories_tags,quantity,status"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return barcodeProduct{}, barcodeUnavailable
	}
	// OFF 要求带可识别的 UA，否则可能被限流。
	req.Header.Set("User-Agent", "StickyNuo/1.0 (home inventory barcode lookup)")
	req.Header.Set("Accept", "application/json")
	resp, err := barcodeHTTP.Do(req)
	if err != nil {
		return barcodeProduct{}, barcodeUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return barcodeProduct{}, barcodeMiss
	}
	if resp.StatusCode != http.StatusOK {
		return barcodeProduct{}, barcodeUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 256<<10))
	if err != nil {
		return barcodeProduct{}, barcodeUnavailable
	}
	var out openFoodFactsResp
	if json.Unmarshal(body, &out) != nil {
		return barcodeProduct{}, barcodeUnavailable
	}
	if out.Status != 1 {
		return barcodeProduct{}, barcodeMiss
	}

	// 中文名优先；部分商品只有 product_name_zh（如可口可乐）。
	name := firstNonEmpty(strings.TrimSpace(out.Product.NameZh),
		strings.TrimSpace(out.Product.Name), strings.TrimSpace(out.Product.Generic))
	if name == "" {
		return barcodeProduct{}, barcodeMiss
	}
	quantity := strings.TrimSpace(out.Product.Quantity)
	if quantity != "" && len([]rune(quantity)) <= 16 &&
		!strings.Contains(strings.ToLower(name), strings.ToLower(quantity)) {
		name += " " + quantity
	}

	p := barcodeProduct{
		Barcode:  code,
		Name:     name,
		Brand:    strings.TrimSpace(strings.Split(out.Product.Brands, ",")[0]),
		Quantity: quantity,
		Source:   "openfoodfacts",
	}
	p.Category = mapBarcodeCategory(out.Product.Categories, out.Product.Tags)
	return p, barcodeHit
}

// mapBarcodeCategory 把商品库的分类标签归一到 App 的库存分类；无法判断时留空。
func mapBarcodeCategory(categories string, tags []string) string {
	text := strings.ToLower(categories + " " + strings.Join(tags, " "))
	has := func(keys ...string) bool {
		for _, k := range keys {
			if strings.Contains(text, k) {
				return true
			}
		}
		return false
	}
	switch {
	case has("dairy", "milk", "yogurt", "cheese", "乳", "奶"):
		return "乳品"
	case has("wine", "beer", "alcohol", "spirits", "liquor", "酒"):
		return "酒水"
	case has("beverage", "drink", "water", "juice", "soda", "cola", "tea", "coffee", "饮料", "茶", "果汁", "矿泉"):
		return "饮料"
	case has("frozen", "冷冻"):
		return "冷冻食品"
	case has("snack", "biscuit", "cookie", "candy", "chocolate", "crisp", "零食", "饼干", "糖"):
		return "零食"
	case has("condiment", "sauce", "vinegar", "spice", "调味", "酱", "醋"):
		return "调味品"
	case has("cereal", "rice", "flour", "pasta", "noodle", "bread", "米", "面", "粮"):
		return "主食粮油"
	case has("vegetable", "蔬菜"):
		return "蔬菜"
	case has("fruit", "水果"):
		return "水果"
	case has("meat", "poultry", "egg", "肉", "蛋"):
		return "肉禽蛋"
	case has("seafood", "fish", "水产", "鱼"):
		return "水产"
	case has("baby", "infant", "母婴", "婴儿"):
		return "母婴用品"
	case has("cosmetic", "beauty", "shampoo", "美妆", "洗护"):
		return "个护美妆"
	case has("detergent", "cleaner", "清洁"):
		return "清洁用品"
	case has("tissue", "paper", "纸"):
		return "纸品"
	default:
		return ""
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func getBarcodeCache(code string) (barcodeCacheEntry, bool) {
	barcodeCacheMu.Lock()
	defer barcodeCacheMu.Unlock()
	e, ok := barcodeCache[code]
	if !ok || time.Since(e.at) > barcodeCacheTTL {
		return barcodeCacheEntry{}, false
	}
	return e, true
}

func putBarcodeCache(code string, p barcodeProduct, found bool) {
	barcodeCacheMu.Lock()
	defer barcodeCacheMu.Unlock()
	if len(barcodeCache) > 512 { // 简单上限，避免长期运行无限增长
		barcodeCache = map[string]barcodeCacheEntry{}
	}
	barcodeCache[code] = barcodeCacheEntry{product: p, found: found, at: time.Now()}
}
