package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/6tail/lunar-go/calendar"
	"github.com/go-chi/chi/v5"

	"stickynuo/server/internal/ha"
	"stickynuo/server/internal/ha/client"
	"stickynuo/server/internal/store"
)

// Birthdays 账号级生日：存储 + HA mobile_app 传感器同步。
//
// 生日跟随账号（存于 user_prefs 键 birthdays，按用户隔离）：
//   - 本人经 PUT /prefs 设置（值必须为 JSON 字符串，与 dashboard 等键一致）；
//   - 管理员经 PUT /users/{username}/birthdays 代设（数组直接传）。
//
// HA 侧：后端为每个 HA 实例各注册一条**虚拟 mobile_app 设备**
// （device_id=stickynuo_server_<instance_id>，device_name=Sticky Kee Server），
// 所有账号的生日都登记在这一台上（unique_id = birthday_<username>）。
// 这样同一用户在多台手机上登录时 HA 里只会出现一个生日实体；
// 同一 server 连接多台 HA 时各自有独立设备，互不串扰。
// 每个账号登记两个实体：birthday_<username>（状态 = 距最近生日的天数，attributes 携带
// 全部生日的下次公历日期与倒计时）与 birthday_<username>_date（状态 = 下次生日公历日期）。
// 写入后立即同步一次；后台每小时校正一次倒计时（跨天自动推进）。
type Birthdays struct {
	manager   *ha.Manager
	repo      *store.InstanceRepo
	userPrefs *store.UserPrefs
	users     *store.UserRepo

	// lastPush 记录每个 (instance_id, username) 上次推送的 (days,next_date)，
	// 倒计时不变化时跳过推送，避免每小时重复写 HA 状态刷 last_updated。
	lastPush sync.Map

	// reqSync 用户触发同步的限频状态（username → *bdSyncReq）。
	reqSync sync.Map
}

// bdSyncMinInterval 用户触发同步的最小间隔：普通用户可经高频写 prefs 放大
// 服务端持管理员 token 对 HA 的请求量（探活+登记+推送每次最多 3 个调用），限频防滥用。
const bdSyncMinInterval = 5 * time.Second

// bdSyncReq 单账号的限频状态（立即一次 + 间隔内合并为尾随一次）。
type bdSyncReq struct {
	mu    sync.Mutex
	last  time.Time
	timer *time.Timer
}

// bdLastPush 上次推送的传感器状态快照（比对用）。
type bdLastPush struct {
	Days int
	Date string
}

// NewBirthdays 构造 handler。
func NewBirthdays(manager *ha.Manager, repo *store.InstanceRepo, userPrefs *store.UserPrefs, users *store.UserRepo) *Birthdays {
	return &Birthdays{manager: manager, repo: repo, userPrefs: userPrefs, users: users}
}

// BirthdayItem 生日条目（与前端 birthday.js 的数据结构一致）。
type BirthdayItem struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Calendar string `json:"calendar"` // solar | lunar
	Month    int    `json:"month"`
	Day      int    `json:"day"`
}

// validate 校验并归一化生日条目。
func (it *BirthdayItem) validate() error {
	// 控制字符一律剔除：名称会进入 HA 实体属性，不允许夹带不可见字符。
	it.Name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.TrimSpace(it.Name))
	if it.Name == "" {
		it.Name = "生日"
	}
	if len([]rune(it.Name)) > 12 {
		return errors.New("称呼最多 12 个字")
	}
	if it.Calendar != "lunar" {
		it.Calendar = "solar"
	}
	if it.Month < 1 || it.Month > 12 {
		return errors.New("月份须为 1-12")
	}
	maxDay := 31
	if it.Calendar == "lunar" {
		maxDay = 30
	}
	if it.Day < 1 || it.Day > maxDay {
		return errors.New("日期超出范围")
	}
	if len(it.ID) > 32 {
		it.ID = ""
	}
	return nil
}

// parseBirthdays 解析存储中的生日 JSON（容错：坏项跳过、坏数据返回空）。
func parseBirthdays(s string) []BirthdayItem {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	var out []BirthdayItem
	if json.Unmarshal([]byte(s), &out) != nil {
		return nil
	}
	valid := make([]BirthdayItem, 0, len(out))
	for _, it := range out {
		if it.validate() != nil {
			continue
		}
		valid = append(valid, it)
	}
	return valid
}

// lunarToSolar 农历日 → 公历日；该农历日不存在时 lunar-go 会 panic（如二月只有 29 天
// 却取三十），这里以 recover 统一转零值，由调用方回落（与前端「三十缺位回落二十九」一致）。
func lunarToSolar(y, m, d int) (yy, mm, dd int) {
	defer func() { _ = recover() }()
	s := calendar.NewLunarFromYmd(y, m, d).GetSolar()
	return s.GetYear(), s.GetMonth(), s.GetDay()
}

// solarInYear 生日在某公历年的公历日期；换不出返回 (0,0,0)。
// 特例与前端 birthday.js 完全一致：公历 2·29 平年回落 2·28；农历三十缺位回落二十九。
func solarInYear(it BirthdayItem, y int) (int, int, int) {
	if it.Calendar != "lunar" {
		if it.Month == 2 && it.Day == 29 {
			leap := (y%4 == 0 && y%100 != 0) || y%400 == 0
			if !leap {
				return y, 2, 28
			}
		}
		return y, it.Month, it.Day
	}
	if it.Day == 30 {
		if yy, mm, dd := lunarToSolar(y, it.Month, 30); yy != 0 {
			return yy, mm, dd
		}
		return lunarToSolar(y, it.Month, 29)
	}
	return lunarToSolar(y, it.Month, it.Day)
}

// nextOccurrence 距下一次生日的公历日期与天数（days=0 即今天）；换不出返回 ok=false。
func nextOccurrence(it BirthdayItem, now time.Time) (time.Time, int, bool) {
	t0 := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	for _, y := range []int{now.Year(), now.Year() + 1} {
		yy, mm, dd := solarInYear(it, y)
		if yy == 0 {
			continue
		}
		d := time.Date(yy, time.Month(mm), dd, 0, 0, 0, 0, now.Location())
		if !d.Before(t0) {
			return d, int(d.Sub(t0) / (24 * time.Hour)), true
		}
	}
	return time.Time{}, 0, false
}

// birthdayAttr 单个生日的传感器属性。
type birthdayAttr struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Calendar string `json:"calendar"`
	Month    int    `json:"month"`
	Day      int    `json:"day"`
	Date     string `json:"date"` // 下一次生日公历日期 yyyy-mm-dd
	Days     int    `json:"days"` // 距下一次生日天数
	Text     string `json:"text"` // 展示文本：农历八月十五 / 8月15日
}

// birthdaySnapshot 计算全部生日的下一次日期；返回最近一个的天数与完整属性。
func birthdaySnapshot(items []BirthdayItem, now time.Time) (int, map[string]any, bool) {
	list := make([]birthdayAttr, 0, len(items))
	for _, it := range items {
		d, days, ok := nextOccurrence(it, now)
		if !ok {
			continue
		}
		text := fmt.Sprintf("%d月%d日", it.Month, it.Day)
		if it.Calendar == "lunar" {
			text = fmt.Sprintf("农历%d月%d日", it.Month, it.Day)
		}
		list = append(list, birthdayAttr{
			ID: it.ID, Name: it.Name, Calendar: it.Calendar, Month: it.Month, Day: it.Day,
			Date: d.Format("2006-01-02"), Days: days, Text: text,
		})
	}
	if len(list) == 0 {
		return 0, nil, false
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Days < list[j].Days })
	nx := list[0]
	return nx.Days, map[string]any{
		"next_name": nx.Name,
		"next_date": nx.Date,
		"next_text": nx.Text,
		"birthdays": list,
	}, true
}

// ---- HA 实例级注册（每 HA 实例一条，存于实例 prefs；所有账号的生日共用） ----
// 注册与推送统一使用**管理员 token**（取第一个配置了 ha_token 的管理员账号）：
// server 侧虚拟设备只需要一份 HA 管理员 token 即可注册并推送所有用户的实体，
// 设备归属与权限保持一致，与目标用户是否配置个人 token 无关。
// 每个 HA 实例**只注册一次**（键按 instance_id），之后缓存 webhook，
// 所有账号复用同一个 webhook_id 登记各自的 birthday_<username> 传感器。

const bdRegKeyPrefix = "server_birthday_reg_" // + <instance_id>

type bdReg struct {
	WebhookID  string `json:"webhook_id"`
	Registered bool   `json:"registered"`
}

func bdRegKeyForInstance(instanceID int64) string {
	return fmt.Sprintf("%s%d", bdRegKeyPrefix, instanceID)
}

// 注册与 webhook 缓存存在 user_prefs，但 per-instance 注册不是 per-user：
// 选一个固定用户名（后端虚拟 user）来存，避免不同用户各自写一份。
const bdRegBackendUser = "__server__"

func (h *Birthdays) readReg(ctx context.Context, instanceID int64) bdReg {
	var r bdReg
	if v := h.userPrefs.Get(ctx, bdRegBackendUser, bdRegKeyForInstance(instanceID)); v != "" {
		_ = json.Unmarshal([]byte(v), &r)
	}
	return r
}

func (h *Birthdays) saveReg(ctx context.Context, instanceID int64, r bdReg) {
	b, _ := json.Marshal(r)
	_ = h.userPrefs.Set(ctx, bdRegBackendUser, bdRegKeyForInstance(instanceID), string(b))
}

// ensureReg 为某 HA 实例确保后端虚拟设备与生日传感器命名空间已注册。
// 使用传入用户 token（需要有 HA 管理员权限）；webhook 失效（HA 侧删除设备）时自动重注册。
func (h *Birthdays) ensureReg(ctx context.Context, instanceID int64, rest *client.Rest) (*bdReg, error) {
	reg := h.readReg(ctx, instanceID)
	if reg.WebhookID != "" && probeWebhookAlive(ctx, rest, reg.WebhookID) {
		return &reg, nil
	}
	payload := map[string]any{
		"app_id":              "stickynuo",
		"app_name":            "stickynuo",
		"app_version":         Version,
		"device_id":           fmt.Sprintf("stickynuo_server_%d", instanceID),
		"device_name":         "Sticky Kee Server",
		"manufacturer":        "stickynuo",
		"model":               "server",
		"os_name":             "stickynuo",
		"os_version":          Version,
		"supports_encryption": false,
	}
	var resp struct {
		WebhookID string `json:"webhook_id"`
	}
	if err := rest.PostJSON(ctx, "/api/mobile_app/registrations", payload, &resp); err != nil {
		return nil, err
	}
	if resp.WebhookID == "" {
		return nil, errors.New("mobile_app registration returned no webhook_id")
	}
	reg = bdReg{WebhookID: resp.WebhookID, Registered: true}
	h.saveReg(ctx, instanceID, reg)
	slog.Info("birthday server device registered", "instance", instanceID, "webhook_id", resp.WebhookID)
	return &reg, nil
}

// birthdayUniqueID 某账号的生日传感器在 server 设备上的 unique_id；
// 同一台设备 unique_id 必须唯一，所以把用户名带进来。
func birthdayUniqueID(username string) string {
	return "birthday_" + username
}

// birthdayDateUniqueID 生日日期实体的 unique_id（与倒计时实体并列）。
func birthdayDateUniqueID(username string) string {
	return birthdayUniqueID(username) + "_date"
}

// SyncUser 把某账号的生日同步到**所有已启用**的 HA 实例（幂等；无实例 / 无可用管理员 token 时静默跳过）。
func (h *Birthdays) SyncUser(ctx context.Context, username string) {
	instances, err := h.repo.List(ctx)
	if err != nil || len(instances) == 0 {
		return
	}
	for _, inst := range instances {
		if !inst.Enabled {
			continue
		}
		h.syncOne(ctx, inst.ID, username)
	}
}

// RequestSync 用户触发的同步入口（PUT /prefs 与管理员代设统一走这里）。
// 限频：距上次同步不足 bdSyncMinInterval 时合并为一次尾随同步，防止高频写 prefs
// 放大服务端持管理员 token 对 HA 的请求量；后台每小时 ticker 走 SyncAll 不受限。
func (h *Birthdays) RequestSync(username string) {
	v, _ := h.reqSync.LoadOrStore(username, &bdSyncReq{})
	s := v.(*bdSyncReq)
	s.mu.Lock()
	wait := bdSyncMinInterval - time.Since(s.last)
	if wait <= 0 {
		s.last = time.Now()
		s.mu.Unlock()
		go h.syncWithTimeout(username)
		return
	}
	if s.timer != nil {
		s.timer.Stop()
	}
	s.timer = time.AfterFunc(wait, func() {
		s.mu.Lock()
		s.last = time.Now()
		s.timer = nil
		s.mu.Unlock()
		h.syncWithTimeout(username)
	})
	s.mu.Unlock()
}

// syncWithTimeout 带超时的 SyncUser（用户触发路径统一 15s 上限）。
func (h *Birthdays) syncWithTimeout(username string) {
	c, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	h.SyncUser(c, username)
}

// adminRest 服务器虚拟设备的传感器注册/推送统一使用管理员 token：
// 设备归属与权限一致，不随目标用户是否配置个人 token 而变化。
// users.List 按 is_admin DESC, id ASC 排序，取第一个配置了 ha_token 的管理员。
func (h *Birthdays) adminRest(ctx context.Context, instanceID int64) *client.Rest {
	users, err := h.users.List(ctx)
	if err != nil {
		return nil
	}
	for _, u := range users {
		if !u.IsAdmin || h.userPrefs.Get(ctx, u.Username, "ha_token") == "" {
			continue
		}
		if rest, err := h.manager.RestForUser(ctx, instanceID, u.Username); err == nil {
			return rest
		}
	}
	return nil
}

// syncOne 单实例同步：确保 server 虚拟设备注册、登记 birthday_<username> 传感器、推送状态。
func (h *Birthdays) syncOne(ctx context.Context, instanceID int64, username string) {
	rest := h.adminRest(ctx, instanceID)
	if rest == nil {
		return // 无可用管理员 token → 跳过（与目标用户是否配 token 无关）
	}
	reg, err := h.ensureReg(ctx, instanceID, rest)
	if err != nil {
		slog.Warn("birthday sync: register failed", "instance", instanceID, "user", username, "err", err.Error())
		return
	}
	// 先登记 sensor 实体（幂等；已存在 HA 会按更新处理，带 null 清理旧元数据）。
	// 每个账号两个实体：倒计时（天数）+ 日期（下次生日公历日期），名称带用户名前缀以便区分。
	sensors := []map[string]any{
		{
			"type":                "sensor",
			"unique_id":           birthdayUniqueID(username),
			"name":                username + "生日倒计时",
			"icon":                "mdi:cake-variant",
			"unit_of_measurement": "天",
			"state_class":         nil, // 倒计时 171 天是数值型，但我们不希望 HA 把它归类成 measurement（没意义）
		},
		{
			"type":      "sensor",
			"unique_id": birthdayDateUniqueID(username),
			"name":      username + "生日",
			"icon":      "mdi:calendar-heart",
		},
	}
	for _, sensor := range sensors {
		if err := rest.PostJSON(ctx, "/api/webhook/"+reg.WebhookID,
			map[string]any{"type": "register_sensor", "data": sensor}, nil); err != nil {
			if !strings.Contains(err.Error(), "already_registered") {
				slog.Warn("birthday sync: register sensor failed", "instance", instanceID, "user", username, "err", err.Error())
				return
			}
		}
	}
	// 状态与属性：无生日 → unknown；有生日 → 天数 + 日期 + 全量属性
	var state any = "unknown"
	var dateState any = "unknown"
	var attrs map[string]any
	if items := parseBirthdays(h.userPrefs.Get(ctx, username, "birthdays")); len(items) > 0 {
		if days, a, ok := birthdaySnapshot(items, time.Now()); ok {
			state = days
			attrs = a
			dateState = a["next_date"]
		}
	}
	// 倒计时未变化时跳过推送（HA 不必每小时收到一次相同状态）
	pushKey := fmt.Sprintf("%d:%s", instanceID, username)
	if s, ok := state.(int); ok {
		cur := bdLastPush{Days: s, Date: fmt.Sprint(attrs["next_date"])}
		if prev, loaded := h.lastPush.Load(pushKey); loaded {
			if p, ok := prev.(bdLastPush); ok && p == cur {
				return
			}
		}
		h.lastPush.Store(pushKey, cur)
	}
	entry := map[string]any{
		"unique_id": birthdayUniqueID(username),
		"state":     state,
		"type":      "sensor",
		"icon":      "mdi:cake-variant",
	}
	if attrs != nil {
		entry["attributes"] = attrs
	}
	dateEntry := map[string]any{
		"unique_id": birthdayDateUniqueID(username),
		"state":     dateState,
		"type":      "sensor",
		"icon":      "mdi:calendar-heart",
	}
	if attrs != nil {
		dateEntry["attributes"] = map[string]any{
			"next_name": attrs["next_name"],
			"next_text": attrs["next_text"],
		}
	}
	payload := map[string]any{"type": "update_sensor_states", "data": []map[string]any{entry, dateEntry}}
	if err := rest.PostJSON(ctx, "/api/webhook/"+reg.WebhookID, payload, nil); err != nil {
		slog.Warn("birthday sync: push failed", "instance", instanceID, "user", username, "err", err.Error())
	}
}

// StartTicker 每小时把全部配置了生日的账号同步一遍（倒计时随日期跨天推进）。
func (h *Birthdays) StartTicker(ctx context.Context) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			h.SyncAll(context.Background())
		}
	}
}

// SyncAll 同步全部账号（仅处理存有 birthdays 键的用户）。
func (h *Birthdays) SyncAll(ctx context.Context) {
	users, err := h.users.List(ctx)
	if err != nil {
		return
	}
	for _, u := range users {
		if h.userPrefs.Get(ctx, u.Username, "birthdays") == "" {
			continue
		}
		c, cancel := context.WithTimeout(ctx, 15*time.Second)
		h.SyncUser(c, u.Username)
		cancel()
	}
}

// GetFor GET /users/{username}/birthdays —— 管理员读取某账号生日列表。
func (h *Birthdays) GetFor(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	username := chi.URLParam(r, "username")
	items := parseBirthdays(h.userPrefs.Get(r.Context(), username, "birthdays"))
	if items == nil {
		items = []BirthdayItem{}
	}
	WriteJSON(w, 200, items)
}

// SetFor PUT /users/{username}/birthdays —— 管理员代设某账号生日（数组），保存后立即同步 HA。
func (h *Birthdays) SetFor(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	username := chi.URLParam(r, "username")
	if _, err := h.users.GetByUsername(r.Context(), username); err != nil {
		WriteErr(w, 404, "not_found", "user not found")
		return
	}
	var p struct {
		Birthdays []BirthdayItem `json:"birthdays"`
	}
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	if len(p.Birthdays) > 50 {
		WriteErr(w, 400, "bad_request", "最多 50 条生日")
		return
	}
	for i := range p.Birthdays {
		if err := p.Birthdays[i].validate(); err != nil {
			WriteErr(w, 400, "bad_request", fmt.Sprintf("第 %d 条：%s", i+1, err.Error()))
			return
		}
	}
	b, _ := json.Marshal(p.Birthdays)
	if err := h.userPrefs.Set(r.Context(), username, "birthdays", string(b)); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	// 异步同步 HA（限频入口；不阻塞响应，注册+推送失败只记日志）
	h.RequestSync(username)
	WriteJSON(w, 200, map[string]any{"ok": true, "count": len(p.Birthdays)})
}
