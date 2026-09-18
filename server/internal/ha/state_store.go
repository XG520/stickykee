package ha

import (
	"sync"

	"stickynuo/server/internal/ha/model"
)

// StateStore 缓存单个 HA 实例的实体状态快照，并在更新时通知订阅者。
type StateStore struct {
	mu       sync.RWMutex
	entities map[string]model.EntityState
	onChange func(entityID string)
}

// NewStateStore 构造缓存。
func NewStateStore() *StateStore {
	return &StateStore{entities: map[string]model.EntityState{}}
}

// SetOnChange 设置实体变更回调（幂等覆盖）。回调不得阻塞 HA 读取循环。
func (s *StateStore) SetOnChange(fn func(string)) {
	s.mu.Lock()
	s.onChange = fn
	s.mu.Unlock()
}

// Replace 全量替换快照。
func (s *StateStore) Replace(all []model.EntityState) {
	s.mu.Lock()
	s.entities = make(map[string]model.EntityState, len(all))
	for _, e := range all {
		s.entities[e.EntityID] = e
	}
	s.mu.Unlock()
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
