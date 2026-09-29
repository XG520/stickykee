package ha

import (
	"sync"
	"time"
)

// 增量合并窗口：这段时间内的实体变化合并成一条 WS 消息，同一实体只保留最后值。
//
// 原实现是「每个 HA 事件 → 一条消息」，且 marshal 与广播都在 HA 读取循环里同步完成。
// 高频实体（功率、温度、电量等每秒数次）会把扇出量放大十倍以上，也会拖慢读取循环。
// 合并后读取循环只做一次 map 写入（不阻塞），推送量按窗口压缩。
const liveBatchInterval = 60 * time.Millisecond

// liveBatcher 按 (instance,user) 连接聚合实体增量。
type liveBatcher struct {
	mu      sync.Mutex
	pending map[string]struct{} // 待发实体 id 集合（天然去重，只发最后值）
	seq     uint64              // 自增序号：客户端据此判断是否漏帧
	done    chan struct{}
	once    sync.Once
}

func newLiveBatcher() *liveBatcher {
	return &liveBatcher{pending: make(map[string]struct{}), done: make(chan struct{})}
}

// add 记录一个待发实体。只加锁写 map，不阻塞、不分配大对象，可在 HA 读取循环里直接调用。
func (b *liveBatcher) add(entityID string) {
	b.mu.Lock()
	b.pending[entityID] = struct{}{}
	b.mu.Unlock()
}

// drain 取出并清空待发集合；无待发时返回 nil。
func (b *liveBatcher) drain() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.pending) == 0 {
		return nil
	}
	ids := make([]string, 0, len(b.pending))
	for id := range b.pending {
		ids = append(ids, id)
	}
	b.pending = make(map[string]struct{}, len(ids))
	return ids
}

// nextSeq 递增并返回本次推送的序号。
func (b *liveBatcher) nextSeq() uint64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.seq++
	return b.seq
}

// Seq 当前序号（WS 首帧快照带上它，客户端据此与新连接对齐）。
func (b *liveBatcher) Seq() uint64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.seq
}

func (b *liveBatcher) stop() { b.once.Do(func() { close(b.done) }) }

// run 周期性把累积的实体合并成一批交给 flush；flush 由单 goroutine 串行执行，
// 因此序号与广播顺序严格一致。
func (b *liveBatcher) run(flush func(ids []string)) {
	t := time.NewTicker(liveBatchInterval)
	defer t.Stop()
	for {
		select {
		case <-b.done:
			return
		case <-t.C:
			if ids := b.drain(); len(ids) > 0 {
				flush(ids)
			}
		}
	}
}