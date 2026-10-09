package ha

import (
	"sync"

	"stickynuo/server/internal/ha/model"
)

// StateStore 缓存单个 HA 实例的实体状态快照，并在更新时通知订阅者。
type StateStore struct {
	mu       sync.RWMutex
	entities map[string]model.EntityState
	notifs   map[string]model.EntityState // 合成的 persistent_notification 实体（见 SetNotifications）
	onChange func(entityID string)
}

// NewStateStore 构造缓存。
func NewStateStore() *StateStore {
	return &StateStore{
		entities: map[string]model.EntityState{},
		notifs:   map[string]model.EntityState{},
	}
}

// SetOnChange 设置实体变更回调（幂等覆盖）。回调不得阻塞 HA 读取循环。
func (s *StateStore) SetOnChange(fn func(string)) {
	s.mu.Lock()
	s.onChange = fn
	s.mu.Unlock()
}

// Replace 全量替换快照。合成通知独立于 get_states，重灌进新快照避免被清掉。
func (s *StateStore) Replace(all []model.EntityState) {
	s.mu.Lock()
	s.entities = make(map[string]model.EntityState, len(all)+len(s.notifs))
	for _, e := range all {
		s.entities[e.EntityID] = e
	}
	for id, e := range s.notifs {
		s.entities[id] = e
	}
	s.mu.Unlock()
}

// SetNotifications 全量更新合成通知集合。HA 2022.3 起 persistent_notification
// 不再是实体，由 Realtime 经 HA WS API（persistent_notifications/get）拉取后
// 合成为实体注入，使其像普通实体一样进入快照与增量推送，前端零改动。
// 新增/变化触发 onChange（驱动前端增量）；被清除的直接移除（前端 dismiss 后
// 的全量刷新会感知，HA 侧他途清除依赖下次全量同步）。
func (s *StateStore) SetNotifications(list []model.EntityState) {
	s.mu.Lock()
	newMap := make(map[string]model.EntityState, len(list))
	for _, e := range list {
		newMap[e.EntityID] = e
	}
	changed := make([]string, 0, len(newMap))
	for id, e := range newMap {
		if prev, ok := s.notifs[id]; !ok || !sameState(prev, e) {
			changed = append(changed, id)
		}
	}
	for id := range s.notifs {
		if _, ok := newMap[id]; !ok {
			delete(s.notifs, id)
			delete(s.entities, id)
		}
	}
	for id, e := range newMap {
		s.notifs[id] = e
		s.entities[id] = e
	}
	fn := s.onChange
	s.mu.Unlock()
	if fn != nil {
		for _, id := range changed {
			fn(id)
		}
	}
}

// sameState 判定两个实体状态是否等价（通知重灌时避免无谓的推送）。
func sameState(a, b model.EntityState) bool {
	return a.EntityID == b.EntityID && a.State == b.State &&
		a.LastUpdated.Equal(b.LastUpdated) && string(a.Attributes) == string(b.Attributes)
}

// Apply 应用单实体状态。
func (s *StateStore) Apply(e model.EntityState) {
	s.mu.Lock()
	s.entities[e.EntityID] = e
	fn := s.onChange
	s.mu.Unlock()
	if fn != nil {
		fn(e.EntityID)
	}
}

// Get 读取单个实体状态。
func (s *StateStore) Get(id string) (model.EntityState, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	e, ok := s.entities[id]
	return e, ok
}

// Snapshot 返回全部实体状态（拍快）。
func (s *StateStore) Snapshot() []model.EntityState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]model.EntityState, 0, len(s.entities))
	for _, e := range s.entities {
		out = append(out, e)
	}
	return out
}

// GetMany 按 id 批量读取（只取一次读锁）；不存在的 id 跳过。
// 供增量合并器一次取齐一批实体，避免逐个加锁。
func (s *StateStore) GetMany(ids []string) []model.EntityState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]model.EntityState, 0, len(ids))
	for _, id := range ids {
		if e, ok := s.entities[id]; ok {
			out = append(out, e)
		}
	}
	return out
}
