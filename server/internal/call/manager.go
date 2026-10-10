// Package call 管理实时语音通话房间。
// 房间仅存内存：服务器重启即结束通话（可接受）。媒体流走 WebRTC P2P，
// 服务器只中继信令（SDP/ICE），不触碰语音数据，故无额外带宽压力。
// 多人通话采用 mesh：每个参与者与其余成员各建一条 P2P 连接（建议 ≤6 人）。
package call

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
)

// Room 表示一个通话房间。
type Room struct {
	ID    string
	Owner string // 发起人；owner 离开则房间解散
	mu    sync.RWMutex
	members map[string]bool // 含 owner；被邀请即占名，加入与否由前端状态区分
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

// Manager 是房间注册表。
type Manager struct {
	mu    sync.Mutex
	rooms map[string]*Room
}

// NewManager 构造房间管理器。
func NewManager() *Manager {
	return &Manager{rooms: map[string]*Room{}}
}

func newRoomID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Create 创建房间：owner + 去重后的被邀请成员；返回房间。
func (m *Manager) Create(owner string, members []string) *Room {
	r := &Room{
		ID:      newRoomID(),
		Owner:   owner,
		members: map[string]bool{owner: true},
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

// Leave 成员离开。返回离开后的成员快照；若 owner 离开或房间空了则删除房间，deleted=true。
func (m *Manager) Leave(id, user string) (members []string, deleted bool) {
	m.mu.Lock()
	r, ok := m.rooms[id]
	m.mu.Unlock()
	if !ok {
		return nil, true
	}

	r.mu.Lock()
	delete(r.members, user)
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
