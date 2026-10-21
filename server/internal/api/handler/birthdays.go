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
// HA 侧：每个账号注册一个专属 mobile_app 虚拟设备（device_id=stickynuo_birthday_<user>），
// 其上登记唯一一个 sensor 实体（unique_id=birthday，名称 Birthday，单位 天）——
// 同账号全部设备共用这一个实体。实体状态 = 距最近生日的天数，attributes 携带
// 全部生日的下次公历日期与倒计时（农历换算用 lunar-go，与前端 lunar-javascript 同算法）。
// 写入后立即同步一次；后台每小时校正一次倒计时（跨天自动推进）。
type Birthdays struct {
	manager   *ha.Manager
	repo      *store.InstanceRepo
	userPrefs *store.UserPrefs
	users     *store.UserRepo

	// lastPush 记录每个账号上次推送的 (days,next_date)，倒计时不变化时跳过推送，
	// 避免每小时重复写 HA 状态刷 last_updated。
	lastPush sync.Map
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
	it.Name = strings.TrimSpace(it.Name)
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

// ---- HA 账号级注册（user_prefs 键 birthday_reg，每用户一条） ----

const bdRegKey = "birthday_reg"

type bdReg struct {
	WebhookID  string `json:"webhook_id"`
	Registered bool   `json:"registered"` // birthday 传感器实体是否已登记
}

func (h *Birthdays) readReg(ctx context.Context, username string) bdReg {
	var r bdReg
	if v := h.userPrefs.Get(ctx, username, bdRegKey); v != "" {
		_ = json.Unmarshal([]byte(v), &r)
	}
	return r
}

func (h *Birthdays) saveReg(ctx context.Context, username string, r bdReg) {
	b, _ := json.Marshal(r)
	_ = h.userPrefs.Set(ctx, username, bdRegKey, string(b))
}

// ensureReg 确保账号级 mobile_app 虚拟设备与 birthday 传感器实体已注册（幂等）。
// webhook 失效（HA 侧删除设备）时自动重新注册，与设备传感器行为一致。
func (h *Birthdays) ensureReg(ctx context.Context, username string, rest *client.Rest) (string, error) {
	reg := h.readReg(ctx, username)
	if reg.WebhookID != "" && probeWebhookAlive(ctx, rest, reg.WebhookID) {
		return reg.WebhookID, nil
	}
	payload := map[string]any{
		"app_id":              "stickynuo",
		"app_name":            "stickynuo",
		"app_version":         "1.0.0",
		"device_id":           "stickynuo_birthday_" + username,
		"device_name":         username + " 的生日",
		"manufacturer":        "stickynuo",
		"model":               "birthday",
		"os_name":             "stickynuo",
		// os_version 必填：缺失时 HA 每次启动 async_setup_entry 抛 KeyError('os_version')，
		// 该虚拟设备与 webhook 全部不可用（历史版本缺此字段导致的报错由此修复）。
		"os_version":          Version,
		"supports_encryption": false,
	}
	var resp struct {
		WebhookID string `json:"webhook_id"`
	}
	if err := rest.PostJSON(ctx, "/api/mobile_app/registrations", payload, &resp); err != nil {
		return "", err
	}
	if resp.WebhookID == "" {
		return "", errors.New("mobile_app registration returned no webhook_id")
	}
	// 登记 birthday 传感器实体（幂等；已登记会被 HA 忽略）
	sensor := map[string]any{
		"type":                "sensor",
		"unique_id":           "birthday",
		"name":                "Birthday",
		"icon":                "mdi:cake-variant",
		"unit_of_measurement": "天",
	}
	if err := rest.PostJSON(ctx, "/api/webhook/"+resp.WebhookID,
		map[string]any{"type": "register_sensor", "data": sensor}, nil); err != nil {
		if !strings.Contains(err.Error(), "already_registered") {
			return "", err
		}
	}
	h.saveReg(ctx, username, bdReg{WebhookID: resp.WebhookID, Registered: true})
	slog.Info("birthday sensor registered", "user", username, "webhook_id", resp.WebhookID)
	return resp.WebhookID, nil
}

// SyncUser 把某账号的生日同步为 HA 传感器（幂等；无实例 / 未配 HA token 时静默跳过）。
func (h *Birthdays) SyncUser(ctx context.Context, username string) {
	rest, err := h.manager.RestForUser(ctx, 0, username)
	if err != nil {
		return // 无实例 / 未配 token：静默（生日功能依赖 HA 连接）
	}
	webhookID, err := h.ensureReg(ctx, username, rest)
	if err != nil {
		slog.Warn("birthday sync: register failed", "user", username, "err", err.Error())
		return
	}
	// 状态与属性：无生日 → unknown；有生日 → 天数 + 全量属性
	var state any = "unknown"
	var attrs map[string]any
	if items := parseBirthdays(h.userPrefs.Get(ctx, username, "birthdays")); len(items) > 0 {
		if days, a, ok := birthdaySnapshot(items, time.Now()); ok {
			state = days
			attrs = a
		}
	}
	// 倒计时未变化时跳过推送（HA 不必每小时收到一次相同状态）
	if s, ok := state.(int); ok {
		cur := bdLastPush{Days: s, Date: fmt.Sprint(attrs["next_date"])}
		if prev, loaded := h.lastPush.Load(username); loaded {
			if p, ok := prev.(bdLastPush); ok && p == cur {
				return
			}
		}
		h.lastPush.Store(username, cur)
	}
	entry := map[string]any{
		"unique_id": "birthday",
		"state":     state,
		"type":      "sensor",
		"icon":      "mdi:cake-variant",
	}
	if attrs != nil {
		entry["attributes"] = attrs
	}
	payload := map[string]any{"type": "update_sensor_states", "data": []map[string]any{entry}}
	if err := rest.PostJSON(ctx, "/api/webhook/"+webhookID, payload, nil); err != nil {
		slog.Warn("birthday sync: push failed", "user", username, "err", err.Error())
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
	// 异步同步 HA（不阻塞响应；注册+推送失败只记日志）
	go func(u string) {
		c, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		h.SyncUser(c, u)
	}(username)
	WriteJSON(w, 200, map[string]any{"ok": true, "count": len(p.Birthdays)})
}
