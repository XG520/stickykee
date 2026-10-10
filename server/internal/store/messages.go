package store

import (
	"context"
	"database/sql"
	"encoding/json"
)

// Message 表示一条用户间消息。payload 为 share 时的完整仪表盘 JSON（对外不返回全文）。
type Message struct {
	ID        int64          `json:"id"`
	From      string         `json:"from"`
	To        string         `json:"to"`
	Type      string         `json:"type"`    // text | image | device | share
	Content   string         `json:"content"` // text 消息文本（share 为空）
	Status    string         `json:"status"`  // share: '' | pending | accepted | declined；撤回：recalled
	Read      bool           `json:"read"`
	CreatedAt string         `json:"created_at"`
	Device    map[string]any `json:"device,omitempty"` // device 类型：{entity_id,name,icon,domain,device_class,...}
	Image     map[string]any `json:"image,omitempty"`  // image 类型：{url,name}
	Audio     map[string]any `json:"audio,omitempty"`  // audio 类型：{url,name,duration}
}

// Conversation 表示一个对话的聚合视图。
type Conversation struct {
	User      string  `json:"user"`
	Unread    int     `json:"unread"`
	Pending   int     `json:"pending"`
	Last      Message `json:"last"`
	CardCount int     `json:"card_count"` // 最后一条为共享时统计的卡片数
}

// MessageRepo 提供用户间消息持久化访问。
type MessageRepo struct{ db *sql.DB }

// NewMessageRepo 构造仓储。
func NewMessageRepo(db *sql.DB) *MessageRepo { return &MessageRepo{db: db} }

const msgCols = `id, from_user, to_user, msg_type, status, read, created_at`

// fillMessage 依据类型回填 Content/Device/Image（share 不返回 payload 全文；
// 已撤回消息清空载荷，历史记录只留占位）。
func fillMessage(m *Message, msgType, payload string) {
	m.Type = msgType
	if m.Status == "recalled" {
		return
	}
	if msgType == "text" {
		m.Content = payload
	} else if msgType == "device" {
		_ = json.Unmarshal([]byte(payload), &m.Device)
	} else if msgType == "image" {
		_ = json.Unmarshal([]byte(payload), &m.Image)
	} else if msgType == "audio" {
		_ = json.Unmarshal([]byte(payload), &m.Audio)
	}
}

func scanMessage(row interface{ Scan(...any) error }) (Message, error) {
	var m Message
	var read int
	err := row.Scan(&m.ID, &m.From, &m.To, &m.Type, &m.Status, &read, &m.CreatedAt)
	m.Read = read != 0
	return m, err
}

// Create 写入一条消息，返回 id。
func (r *MessageRepo) Create(ctx context.Context, from, to, msgType, payload, status string) (int64, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO messages(from_user, to_user, msg_type, payload, status) VALUES(?,?,?,?,?)`,
		from, to, msgType, payload, status)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	return id, err
}

// GetFull 查询单条完整消息（含 payload）。
func (r *MessageRepo) GetFull(ctx context.Context, id int64) (Message, string, error) {
	var m Message
	var read int
	var payload string
	err := r.db.QueryRowContext(ctx,
		`SELECT id, from_user, to_user, msg_type, payload, status, read, created_at FROM messages WHERE id=?`, id).
		Scan(&m.ID, &m.From, &m.To, &m.Type, &payload, &m.Status, &read, &m.CreatedAt)
	m.Read = read != 0
	return m, payload, err
}

// History 返回 me 与 other 之间最近的 limit 条消息（升序），text/image 含内容、share 不含 payload 全文。
// before>0 时只取 id<before 的更早消息（向上翻页游标）。
func (r *MessageRepo) History(ctx context.Context, me, other string, limit int, before int64) ([]Message, error) {
	if limit <= 0 {
		limit = 50
	}
	q := `SELECT id, from_user, to_user, msg_type, payload, status, read, created_at FROM messages
		 WHERE (from_user=? AND to_user=?) OR (from_user=? AND to_user=?)`
	args := []any{me, other, other, me}
	if before > 0 {
		q += ` AND id < ?`
		args = append(args, before)
	}
	q += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	rev := []Message{}
	for rows.Next() {
		var m Message
		var read int
		var payload string
		if err := rows.Scan(&m.ID, &m.From, &m.To, &m.Type, &payload, &m.Status, &read, &m.CreatedAt); err != nil {
			return nil, err
		}
		m.Read = read != 0
		fillMessage(&m, m.Type, payload)
		rev = append(rev, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// 倒置为升序
	out := make([]Message, len(rev))
	for i, m := range rev {
		out[len(rev)-1-i] = m
	}
	return out, nil
}

// Conversations 返回与我相关的全部对话（聚合出对端、未读、待处理共享、最后一条）。
func (r *MessageRepo) Conversations(ctx context.Context, me string) ([]*Conversation, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, from_user, to_user, msg_type, status, read, created_at, payload
		 FROM messages
		 WHERE from_user=? OR to_user=?
		 ORDER BY id ASC`, me, me)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type raw struct {
		msg     Message
		payload string
	}
	list := []raw{}
	for rows.Next() {
		var m Message
		var read int
		var payload string
		if err := rows.Scan(&m.ID, &m.From, &m.To, &m.Type, &m.Status, &read, &m.CreatedAt, &payload); err != nil {
			return nil, err
		}
		m.Read = read != 0
		list = append(list, raw{msg: m, payload: payload})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	order := []string{}
	agg := map[string]*Conversation{}
	for _, raw := range list {
		other := raw.msg.From
		if raw.msg.From == me {
			other = raw.msg.To
		}
		c, ok := agg[other]
		if !ok {
			c = &Conversation{User: other}
			agg[other] = c
			order = append(order, other)
		}
		// 未读：对端 → 我 且 read=0（撤回占位不计未读）
		if raw.msg.To == me && !raw.msg.Read && raw.msg.Status != "recalled" {
			c.Unread++
		}
		// 待处理共享：对端 → 我 且 status=pending
		if raw.msg.Type == "share" && raw.msg.To == me && raw.msg.Status == "pending" {
			c.Pending++
		}
		// 最后一条按序累加（升序遍历，最后覆盖即最新）
		c.Last = raw.msg
		fillMessage(&c.Last, raw.msg.Type, raw.payload)
		if raw.msg.Type == "share" {
			c.CardCount = CardCount(raw.payload)
		}
	}
	// 按最后一条 id 降序（最新会话靠前）
	out := []*Conversation{}
	for _, user := range order {
		out = append(out, agg[user])
	}
	// 简单按 Last.ID 降序
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].Last.ID > out[j-1].Last.ID; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out, nil
}

// SetStatus 更新消息状态。
func (r *MessageRepo) SetStatus(ctx context.Context, id int64, status string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE messages SET status=? WHERE id=?`, status, id)
	return err
}

// SetFromRead 把 other 发给 me 的未读消息全部置为已读。
func (r *MessageRepo) SetFromRead(ctx context.Context, me, other string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE messages SET read=1 WHERE from_user=? AND to_user=? AND read=0`, other, me)
	return err
}

// CardCount 统计仪表盘 JSON 快照中的卡片数（解析失败返回 0）。
// 兼容两种结构：v1 顶层卡片数组；v2 { version, pages: [{ cards: [...] }] }。
func CardCount(dashboard string) int {
	var arr []json.RawMessage
	if json.Unmarshal([]byte(dashboard), &arr) == nil {
		return len(arr)
	}
	var v2 struct {
		Pages []struct {
			Cards []json.RawMessage `json:"cards"`
		} `json:"pages"`
	}
	if json.Unmarshal([]byte(dashboard), &v2) != nil {
		return 0
	}
	n := 0
	for _, p := range v2.Pages {
		n += len(p.Cards)
	}
	return n
}
