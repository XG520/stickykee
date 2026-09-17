// Package model 定义 Home Assistant 实体数据模型（对齐 HA REST API 字段）。
package model

import (
	"encoding/json"
	"time"
)

// EntityState 对应 HA 单个实体状态（GET /api/states 的一项，也用于 WS 事件）。
// attributes 采用自由 JSON（json.RawMessage），保留 HA 原始字段以便前端聚合。
type EntityState struct {
	EntityID    string          `json:"entity_id"`
	State       string          `json:"state"`
	Attributes  json.RawMessage `json:"attributes"`
	LastChanged time.Time       `json:"last_changed"`
	LastUpdated time.Time       `json:"last_updated"`
	Context     *Context        `json:"context,omitempty"`
}

// Context 实体状态上下文。
type Context struct {
	ID       string `json:"id"`
	ParentID string `json:"parent_id,omitempty"`
	UserID   string `json:"user_id,omitempty"`
}

// DisplayEntity 是给前端用的聚合实体：把 entity_state 与 registry
// （friendly_name/area/floor/icon/device_class）合并后的展示结构。
type DisplayEntity struct {
	EntityID     string          `json:"entity_id"`
	Domain       string          `json:"domain"`
	State        string          `json:"state"`
	FriendlyName string          `json:"friendly_name"`
	Icon         string          `json:"icon,omitempty"`
	DeviceClass  string          `json:"device_class,omitempty"`
	Unit         string          `json:"unit,omitempty"`
	Area         string          `json:"area,omitempty"`
	Floor        string          `json:"floor,omitempty"`
	Attributes   json.RawMessage `json:"attributes"`
	LastUpdated  time.Time       `json:"last_updated"`
}

// DisplayEntity 的 domain 从 entity_id 拆分。
func DomainOf(entityID string) string {
	for i := 0; i < len(entityID); i++ {
		if entityID[i] == '.' {
			return entityID[:i]
		}
	}
	return entityID
}

// attrView 帮助从 attributes 中读取 string 字段（缺省返回空串）。
func attrString(attrs map[string]any, key string) string {
	if v, ok := attrs[key].(string); ok {
		return v
	}
	return ""
}

// ParseDisplay 把原始实体状态转为前端用的展示实体。
func ParseDisplay(e EntityState) DisplayEntity {
	d := DisplayEntity{
		EntityID:    e.EntityID,
		Domain:      DomainOf(e.EntityID),
		State:       e.State,
		Attributes:  e.Attributes,
		LastUpdated: e.LastUpdated,
	}
	attrs := map[string]any{}
	if json.Unmarshal(e.Attributes, &attrs) == nil {
		d.FriendlyName = attrString(attrs, "friendly_name")
		d.Icon = attrString(attrs, "icon")
		d.DeviceClass = attrString(attrs, "device_class")
		d.Unit = attrString(attrs, "unit_of_measurement")
	}
	return d
}

// ParseDisplays 批量转换。
func ParseDisplays(in []EntityState) []DisplayEntity {
	out := make([]DisplayEntity, 0, len(in))
	for _, e := range in {
		out = append(out, ParseDisplay(e))
	}
	return out
}
