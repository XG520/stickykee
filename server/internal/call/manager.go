// Package call 管理实时语音通话房间。
// 房间仅存内存：服务器重启即结束通话（可接受）。媒体流走 WebRTC P2P，
// 服务器只中继信令（SDP/ICE），不触碰语音数据，故无额外带宽压力。
// 多人通话采用 mesh：每个参与者与其余成员各建一条 P2P 连接（建议 ≤6 人）。
package call

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// 超时策略：
//   - ringingTimeout：创建后始终只有 owner 一人加入（无人接听）→ 判为未接通，清理并向全员推送 ended。
//     180s 而非 60s：后台端（Doze 掐网 / 原生保活心跳重建 WS）会漏掉实时 invite，
//     只能靠重连接时补发振铃；而重连接最坏耗时 = 服务端读超时 90s + 原生心跳周期 60s，
//     60s 的振铃窗口内房间往往已被回收，补发也就无从谈起。180s 留出足够重连余量。
//   - maxRoomTTL：房间存在上限（防止前端异常/断网导致房间永久泄漏）。
const (
	ringingTimeout = 180 * time.Second
	maxRoomTTL     = 30 * time.Minute
	sweepInterval  = 15 * time.Second
)

// PushFunc 由装配方注入：向指定用户的全部在线设备推送一个通话事件（JSON 文本帧）。
type PushFunc func(user string, ev map[string]any)

// PushBinaryFunc 由装配方注入：向指定用户的全部在线连接转发一帧语音二进制（WS Binary）。
type PushBinaryFunc func(user string, b []byte)

// Room 表示一个通话房间。
type Room struct {
	ID        string
	Owner     string // 发起人；owner 离开则房间解散
	CreatedAt time.Time
	mu        sync.RWMutex
	members   map[string]bool // 含 owner；被邀请即占名
	joined    map[string]bool // 实际已加入（接听）者；owner 创建即视为已加入
	joinedDev map[string]string // 按已加入者记录接听设备 id（多端语义补发时区分本设备/其它设备）
}

// Members 返回成员快照（含 owner）。
func (r *Room) Members() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.members))
	for u := range r.members {
		out = append(out, u)
	}
	return out
}

func (r *Room) has(u string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.members[u]
}

// markJoined 标记用户已接听，记录接听设备 id（可为空：未知发起设备）。
func (r *Room) markJoined(u, device string) {
	r.mu.Lock()
	r.joined[u] = true
	if device != "" {
		r.joinedDev[u] = device
	}
	r.mu.Unlock()
}

// joinedFor 判断用户已接听。
func (r *Room) joinedFor(u string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.joined[u]
}

// answered 是否有 owner 以外的人加入（接通）。owner 创建即算 joined，
// 因此不能用 joinedFor(owner) 判断"已有人接听"。
func (r *Room) answered() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for u := range r.joined {
		if u != r.Owner {
			return true
		}
	}
	return false
}

// deviceOf 返回该用户接听时的设备 id（未记录即空串，补发前端取本设备后恢复通话）。
func (r *Room) deviceOf(u string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.joinedDev[u]
}

// snapshot 返回成员与已加入快照，供超时扫描判断。
func (r *Room) snapshot() (members []string, onlyOwnerJoined bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	members = make([]string, 0, len(r.members))
	for u := range r.members {
		members = append(members, u)
	}
	// 除 owner 外无人加入 → 仍在振铃等待中
	onlyOwnerJoined = true
	for u := range r.joined {
		if u != r.Owner {
			onlyOwnerJoined = false
			break
		}
	}
	return
}

// Manager 是房间注册表。
type Manager struct {
	mu        sync.Mutex
	rooms     map[string]*Room
	push      PushFunc
	audioPush PushBinaryFunc
	stop      chan struct{}
}

// NewManager 构造房间管理器并启动超时清理协程。
// push 用于向成员推送 ended 等生命周期事件（可为 nil：仅回收不通知）；
// audioPush 用于通话语音帧中继（可为 nil：不转发音频）。
func NewManager(push PushFunc, audioPush PushBinaryFunc) *Manager {
	m := &Manager{rooms: map[string]*Room{}, push: push, audioPush: audioPush, stop: make(chan struct{})}
	go m.sweepLoop()
	return m
}

// sweepLoop 周期性回收超时/无人接听的房间，并通知全员。
func (m *Manager) sweepLoop() {
	t := time.NewTicker(sweepInterval)
	defer t.Stop()
	for {
		select {
		case <-m.stop:
			return
		case <-t.C:
			m.sweep()
		}
	}
}

func (m *Manager) sweep() {
	now := time.Now()
	type expired struct {
		room   string
		people []string
		reason string
	}
	var dead []expired

	m.mu.Lock()
	for id, r := range m.rooms {
		age := now.Sub(r.CreatedAt)
		members, ringing := r.snapshot()
		if (ringing && age > ringingTimeout) || age > maxRoomTTL {
			delete(m.rooms, id)
			reason := "timeout" // 无人接听超时
			if age > maxRoomTTL {
				reason = "ended" // 达到房间上限，强制结束
			}
			dead = append(dead, expired{id, members, reason})
		}
	}
	m.mu.Unlock()

	if m.push == nil {
		return
	}
	for _, e := range dead {
		for _, u := range e.people {
			m.push(u, map[string]any{
				"type": "call", "event": "ended",
				"room": e.room, "reason": e.reason,
			})
		}
	}
}

func newRoomID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Create 创建房间：owner + 去重后的被邀请成员；返回房间。
// device 为发起设备 id，owner 即视为已加入（振铃状态补发时识别本设备后恢复）。
func (m *Manager) Create(owner string, members []string, device string) *Room {
	r := &Room{
		ID:        newRoomID(),
		Owner:     owner,
		CreatedAt: time.Now(),
		members:   map[string]bool{owner: true},
		joined:    map[string]bool{owner: true},
		joinedDev: map[string]string{owner: device},
	}
	for _, u := range members {
		if u != "" && u != owner {
			r.members[u] = true
		}
	}
	m.mu.Lock()
	m.rooms[r.ID] = r
	m.mu.Unlock()
	return r
}

// Get 查询房间。
func (m *Manager) Get(id string) (*Room, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rooms[id]
	return r, ok
}

// HasMember 判断用户是否房间成员。
func (m *Manager) HasMember(id, user string) bool {
	m.mu.Lock()
	r, ok := m.rooms[id]
	m.mu.Unlock()
	if !ok {
		return false
	}
	return r.has(user)
}

// Join 标记用户已接听（记录设备 id），返回房间。
func (m *Manager) Join(id, user, device string) (*Room, bool) {
	m.mu.Lock()
	r, ok := m.rooms[id]
	m.mu.Unlock()
	if !ok {
		return nil, false
	}
	r.markJoined(user, device)
	return r, true
}

// PendingFor 按用户返回其占的通话房间状态消息列表，供 WS 连接时补发。
// 通话事件按推送「离线即丢弃、不补发」，后台端（Doze 掐网络 / 原生心跳重建连接）
// 时实时 invite 即永久丢失——该端不会响铃。补发让重连接后振铃/恢复通话。
//   joined=false 房间仍在振铃等待中（前端振铃并弹来电 UI）；
//   joined=true 本用户已接听，device 为接听设备（空即未知→前端本设备恢复通话中）；
//   answered=false 房间内尚无 owner 以外的人加入（呼叫方重连时据此恢复"呼叫中+彩铃"，
//   而不是误判成通话中直接开麦）。
func (m *Manager) PendingFor(user string) []map[string]any {
	m.mu.Lock()
	targets := make([]*Room, 0, len(m.rooms))
	for _, r := range m.rooms {
		if r.has(user) {
			targets = append(targets, r)
		}
	}
	m.mu.Unlock()
	out := make([]map[string]any, 0, len(targets))
	for _, r := range targets {
		out = append(out, map[string]any{
			"type": "call", "event": "resumed",
			"room": r.ID, "from": r.Owner, "owner": r.Owner, "members": r.Members(),
			"joined": r.joinedFor(user), "device": r.deviceOf(user),
			"answered": r.answered(),
		})
	}
	return out
}

// Reject 成员拒接：将其移出房间。若移出后除 owner 外无其他成员，解散房间（ended=true）。
func (m *Manager) Reject(id, user string) (owner string, ended bool) {
	m.mu.Lock()
	r, ok := m.rooms[id]
	if !ok {
		m.mu.Unlock()
		return "", false
	}
	r.mu.Lock()
	delete(r.members, user)
	delete(r.joined, user)
	end := len(r.members) == 1 && r.members[r.Owner]
	r.mu.Unlock()
	if end {
		delete(m.rooms, id)
	}
	m.mu.Unlock()
	return r.Owner, end
}

// Leave 成员离开。返回离开前的其他成员快照；若 owner 离开或房间空了则删除房间，deleted=true。
func (m *Manager) Leave(id, user string) (members []string, deleted bool) {
	m.mu.Lock()
	r, ok := m.rooms[id]
	m.mu.Unlock()
	if !ok {
		return nil, true
	}

	r.mu.Lock()
	delete(r.members, user)
	delete(r.joined, user)
	remain := make([]string, 0, len(r.members))
	for u := range r.members {
		remain = append(remain, u)
	}
	end := user == r.Owner || len(r.members) == 0
	r.mu.Unlock()

	if end {
		m.mu.Lock()
		delete(m.rooms, id)
		m.mu.Unlock()
	}
	return remain, end
}

// 音频帧头：1 字节版本 + 16 字节 roomID（ASCII，不足补 0），其后为 Opus 载荷。
const audioHeaderLen = 17

// AudioRoute 转发一帧通话语音：校验发送者是房间成员且帧内 roomID 匹配，
// 然后向房间内其他成员的全部在线连接广播（8080 WS 中继，媒体不经 P2P）。
// roomID 校验防伪造：非本房间成员/伪造房间号的帧直接丢弃。
func (m *Manager) AudioRoute(sender string, frame []byte) {
	if m.audioPush == nil || len(frame) < audioHeaderLen || frame[0] != 1 {
		return
	}
	roomID := string(frame[1:audioHeaderLen])
	m.mu.Lock()
	r, ok := m.rooms[roomID]
	if !ok {
		m.mu.Unlock()
		return
	}
	r.mu.RLock()
	inRoom := r.members[sender]
	r.mu.RUnlock()
	m.mu.Unlock()
	if !inRoom {
		return
	}
	for _, u := range r.Members() {
		if u != sender {
			m.audioPush(u, frame)
		}
	}
}
