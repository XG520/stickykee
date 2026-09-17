// Package model 定义 Home Assistant 实体数据模型（对齐 HA REST API 字段）。
package model

import "encoding/json"

// RegistryDevice 是设备注册表中的一台设备（config/device_registry/list 的一项）。
// 仅保留前端设备管理页需要的字段，其余原样保留在 Raw 中。
type RegistryDevice struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	NameByUser    string          `json:"name_by_user"`
	Manufacturer  string          `json:"manufacturer"`
	Model         string          `json:"model"`
	Identifiers   [][]string      `json:"identifiers"`
	ConfigEntries []string        `json:"config_entries"`
	Connections   [][]string      `json:"connections"`
	AreaID        string          `json:"area_id"`
	EntryType     string          `json:"entry_type"`
	DisabledBy    string          `json:"disabled_by"`
	ViaDeviceID   string          `json:"via_device_id"`
	IsNew         bool            `json:"is_new"`
	Raw           json.RawMessage `json:"-"`
}

// RegistryEntity 是实体注册表中的一项（config/entity_registry/list）。
type RegistryEntity struct {
	EntityID     string          `json:"entity_id"`
	DeviceID     string          `json:"device_id"`
	Platform     string          `json:"platform"`
	UniqueID     string          `json:"unique_id"`
	DisabledBy   string          `json:"disabled_by"`
	HiddenBy     string          `json:"hidden_by"`
	AreaID       string          `json:"area_id"`
	OriginalName string          `json:"original_name"`
	Name         string          `json:"name"`
	Icon         string          `json:"icon"`
	DeviceClass  string          `json:"device_class"`
	Raw          json.RawMessage `json:"-"`
}

// RegistryArea 是区域注册表中的一项（config/area_registry/list）。
type RegistryArea struct {
	AreaID  string `json:"area_id"`
	Name    string `json:"name"`
	Icon    string `json:"icon"`
	FloorID string `json:"floor_id"`
}

// DeviceGraph 是供前端「设备管理」页展示的以设备为单位的聚合结构。
// 一台物理设备聚合其下所有实体，并附带每个实体的实时状态。
type DeviceGraph struct {
	Device       RegistryDevice    `json:"device"`
	DisplayName  string            `json:"display_name"`  // NameByUser || Name || 厂商+型号兜底
	AreaID       string            `json:"area_id"`
	AreaName     string            `json:"area_name"`
	Domain       string            `json:"domain"`        // 由主要实体推断
	Entities     []GraphEntity     `json:"entities"`
	Disabled     bool              `json:"disabled"`
	EntityCount  int               `json:"entity_count"`
	ActiveCount  int               `json:"active_count"`  // 当前"开启"的实体数
	MainFriendly string            `json:"main_friendly"`
	MainIcon     string            `json:"main_icon"`
	MainState    string            `json:"main_state"`
}

// GraphEntity 设备详情抽屉中的实体行：实体注册信息 + 实时状态。
type GraphEntity struct {
	EntityID     string          `json:"entity_id"`
	Domain       string          `json:"domain"`
	FriendlyName string          `json:"friendly_name"`
	Icon         string          `json:"icon"`
	DeviceClass  string          `json:"device_class"`
	Unit         string          `json:"unit"`
	State        string          `json:"state"`
	Attributes   json.RawMessage `json:"attributes"`
	Disabled     bool            `json:"disabled"`
	Platform     string          `json:"platform"`
}