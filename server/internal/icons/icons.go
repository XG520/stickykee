// Package icons 内嵌 Material Symbols（Outlined）SVG 图标子集，
// 通过 HTTP 提供给前端，替代在前端打包的大体积图标字体文件。
package icons

import (
	"embed"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed svg/*.svg
var svgFS embed.FS

// FS 暴露给 handler 使用的只读文件系统。
var FS = func() fs.FS {
	sub, err := fs.Sub(svgFS, "svg")
	if err != nil {
		panic(err) // embed 路径错误在编译期即失败，这里理论上不会触发
	}
	return sub
}()

// iconName 把用户输入规范化：只允许小写字母、数字、下划线、连字符。
// 连字符是 MDI（HA 原生图标）命名风格，下划线是 Material Symbols 风格。
func iconName(s string) string {
	s = strings.TrimPrefix(s, "mdi:")
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Normalize 导出 iconName 供 handler 校验/规范化用户输入（去 mdi: 前缀、过滤非法字符）。
func Normalize(s string) string { return iconName(s) }

// mdiSVG 用 mdiPaths 中的 path 数据动态拼出完整 SVG（MDI 图标统一 24x24 viewBox）。
func mdiSVG(path string) []byte {
	const prefix = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="`
	const suffix = `"/></svg>`
	b := make([]byte, 0, len(prefix)+len(path)+len(suffix))
	b = append(b, prefix...)
	b = append(b, path...)
	b = append(b, suffix...)
	return b
}

// Has 报告图标是否存在（内嵌 Material 子集 + 内嵌 MDI 全集）。
func Has(name string) bool {
	name = iconName(name)
	if name == "" {
		return false
	}
	if _, err := fs.Stat(FS, name+".svg"); err == nil {
		return true
	}
	if _, ok := mdiPaths[name]; ok {
		return true
	}
	// mdi 官方命名为连字符风格：下划线输入转连字符再试一次（本地优先，避免走网络）
	if dash := strings.ReplaceAll(name, "_", "-"); dash != name {
		_, ok := mdiPaths[dash]
		return ok
	}
	return false
}

// Get 返回图标 SVG 内容；不存在时 ok 为 false。
// 查找顺序：内嵌 Material svg → 内嵌 MDI path 数据（动态拼 SVG）。
// 远程下载兜底不在此函数内，由 Handler 在 Get 失败后调用 fetchRemote。
func Get(name string) (data []byte, ok bool) {
	name = iconName(name)
	if name == "" {
		return nil, false
	}
	if b, err := fs.ReadFile(FS, name+".svg"); err == nil {
		return b, true
	}
	if p, hit := mdiPaths[name]; hit {
		return mdiSVG(p), true
	}
	// mdi 官方命名为连字符风格：下划线输入转连字符再试一次（本地优先，避免走网络）
	if dash := strings.ReplaceAll(name, "_", "-"); dash != name {
		if p, hit := mdiPaths[dash]; hit {
			return mdiSVG(p), true
		}
	}
	return nil, false
}

// List 返回全部图标名（内嵌 Material 子集 + MDI 全集，去掉 .svg 后缀、排序）。
func List() []string {
	entries, err := fs.ReadDir(FS, ".")
	if err != nil {
		return nil
	}
	seen := make(map[string]struct{}, len(entries)+len(mdiPaths))
	out := make([]string, 0, len(entries)+len(mdiPaths))
	for _, e := range entries {
		n := strings.TrimSuffix(e.Name(), ".svg")
		if n != "" && n != e.Name() {
			seen[n] = struct{}{}
			out = append(out, n)
		}
	}
	for n := range mdiPaths {
		if _, dup := seen[n]; !dup {
			out = append(out, n)
		}
	}
	sort.Strings(out)
	return out
}

// Handler 处理单图标 GET /{name}.svg：解析路径最后一段为图标名并返回 SVG。
func Handler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	path := r.URL.Path
	name := path[strings.LastIndex(path, "/")+1:]
	name = strings.TrimSuffix(name, ".svg")
	name = iconName(name)
	if name == "" {
		http.NotFound(w, r)
		return
	}
	// 1) 本地内嵌集合
	if data, ok := Get(name); ok {
		serveSVG(w, data)
		return
	}
	// 2) 兜底：不在内嵌集合时从外部图标源下载并缓存（优先 MDI，贴合 HA 实体图标）
	data, ok := fetchRemote(name)
	if !ok {
		// 全部失败：返回内置占位图标，避免前端 mask 无图渲染成纯色块。
		w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.Write(fallbackIcon)
		return
	}
	serveSVG(w, data)
}

// 通用占位图标（单一矩形轮廓），作为无法解析的图标名的兜底。
var fallbackIcon = []byte(`<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path fill="%23ffffff" d="M120-120v-720h720v720H120Zm80-80h560v-560H200v560Z"/></svg>`)

func serveSVG(w http.ResponseWriter, data []byte) {
	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write(data)
}

// 远程兜底：缓存 key=图标名；存在记录则直接返回。使用单飞避免并发重复下载。
// 命中磁盘缓存的图标在请求时惰性加载进内存，下载成功的图标持久化回磁盘，
// 避免每次服务重启后重复的慢网络请求。
var (
	remoteCache  = map[string][]byte{}
	remoteFlight = map[string]*sync.Mutex{}
	remoteMu     sync.Mutex
	remoteClient = &http.Client{Timeout: 5 * time.Second}
	cacheDir     string // 磁盘缓存目录；Init 调用前为空（禁用持久化）
)

// Init 设置远程图标的磁盘缓存目录并预热内存缓存。
func Init(dir string) {
	if dir == "" {
		return
	}
	_ = os.MkdirAll(dir, 0o755)
	cacheDir = dir
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	remoteMu.Lock()
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".svg") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err == nil && len(b) > 0 {
			remoteCache[strings.TrimSuffix(e.Name(), ".svg")] = b
		}
	}
	remoteMu.Unlock()
}

// cacheFile 返回某图标的磁盘缓存文件路径；cacheDir 未启用时返回空串。
func cacheFile(name string) string {
	if cacheDir == "" {
		return ""
	}
	return filepath.Join(cacheDir, name+".svg")
}

// loadDisk 尝试从磁盘缓存读取图标，成功时填充内存缓存并返回 true。
func loadDisk(name string) ([]byte, bool) {
	remoteMu.Lock()
	if data, ok := remoteCache[name]; ok {
		remoteMu.Unlock()
		return data, true
	}
	remoteMu.Unlock()
	f := cacheFile(name)
	if f == "" {
		return nil, false
	}
	b, err := os.ReadFile(f)
	if err != nil || len(b) == 0 {
		return nil, false
	}
	remoteMu.Lock()
	remoteCache[name] = b
	remoteMu.Unlock()
	return b, true
}

// persistDisk 把下载成功的图标写入磁盘缓存（尽力而为，失败不影响内存功能）。
func persistDisk(name string, data []byte) {
	f := cacheFile(name)
	if f == "" {
		return
	}
	tmp := f + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err == nil {
		_ = os.Rename(tmp, f)
	}
}

// 候选下载源。图标名可能来自两个命名体系：
//   - Material Symbols（前端模板图标）：下划线风格，gstatic CDN。
//   - MDI / MaterialDesignIcons（HA 实体 icon，如 mdi:xxx）：连字符风格，与 HA 完全对齐。
//
// 按顺序尝试任一源成功即缓存。
const (
	mdiJSBase = "https://cdn.jsdelivr.net/npm/@mdi/svg@latest/svg"
	mdiGHBase = "https://raw.githubusercontent.com/Templarian/MaterialDesign-SVG/master/svg"
	msGSBase  = "https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined"
	msJSBase  = "https://cdn.jsdelivr.net/npm/@material-symbols/svg-400/outlined"
)

func fetchRemote(name string) ([]byte, bool) {
	// 1) 内存或磁盘缓存命中则直接返回。
	if data, ok := loadDisk(name); ok {
		return data, true
	}
	remoteMu.Lock()
	m, ok := remoteFlight[name]
	if !ok {
		m = &sync.Mutex{}
		remoteFlight[name] = m
	}
	remoteMu.Unlock()

	// 同一图标并发访问串行化，避免重复下载；等待期间持有锁的协程会填缓存。
	m.Lock()
	defer m.Unlock()

	// 2) 再次检查（可能等待期间已被其他协程填充）。
	if data, ok := loadDisk(name); ok {
		return data, true
	}

	dash := strings.ReplaceAll(name, "_", "-")
	// 命名变体：MDI 用连字符风格，MS/模板用下划线风格。输入本身 + 连字符变体去重。
	candidates := []string{name}
	if dash != name && dash != "" {
		candidates = append(candidates, dash)
	}

	// 源优先级：MDI jsdelivr → MDI GitHub → MS gstatic → MS jsdelivr。
	// 理想都带 UA，gstatic 偶尔拒绝默认客户端。
	var urls []string
	for _, n := range candidates {
		urls = append(urls,
			mdiJSBase+"/"+n+".svg",
			mdiGHBase+"/"+n+".svg",
			msGSBase+"/"+n+"/default/24px.svg",
			msJSBase+"/"+n+".svg",
		)
	}
	var body []byte
	for _, u := range urls {
		b, err := httpGetSVG(u)
		if err == nil && len(b) > 0 {
			body = b
			break
		}
	}
	if len(body) == 0 {
		return nil, false
	}
	remoteMu.Lock()
	remoteCache[name] = body
	remoteMu.Unlock()
	persistDisk(name, body)
	return body, true
}

func httpGetSVG(url string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "stickynuo/1.0")
	resp, err := remoteClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, io.ErrUnexpectedEOF
	}
	return io.ReadAll(io.LimitReader(resp.Body, 1<<20))
}

// ListHandler 返回可用图标名列表（JSON { data: [...] }）。
func ListHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	list := List()
	buf := []byte(`{"data":[`)
	for i, n := range list {
		if i > 0 {
			buf = append(buf, ',')
		}
		buf = append(buf, '"')
		buf = append(buf, n...)
		buf = append(buf, '"')
	}
	buf = append(buf, ']', '}')
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write(buf)
}
