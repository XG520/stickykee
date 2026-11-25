package handler

import (
	"net/http"
	"strings"

	"stickykee/server/internal/store"
)

// Notification POST /finance/notification
// 安卓通知监听推送微信 / 支付宝支付通知；未识别或重复时也返回 200，避免客户端反复重试。
func (h *Finance) Notification(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var p store.FinNotificationInput
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	if strings.TrimSpace(p.Title) == "" && strings.TrimSpace(p.Text) == "" {
		WriteErr(w, 400, "bad_request", "通知内容为空")
		return
	}
	res, err := h.repo.RecordNotification(r.Context(), id, p, rUsername(r))
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	if res.Matched && !res.Duplicate {
		h.changed(id)
	}
	WriteJSON(w, 200, res)
}

// Import POST /finance/import
// 支付宝 / 微信官方账单 CSV：Commit=false 预览，Commit=true 写入（按交易单号去重）。
func (h *Finance) Import(w http.ResponseWriter, r *http.Request) {
	id, ok := h.active(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
	var p store.FinImportInput
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "参数格式错误")
		return
	}
	if strings.TrimSpace(p.Content) == "" {
		WriteErr(w, 400, "bad_request", "请先选择账单文件")
		return
	}
	res, err := h.repo.ImportBill(r.Context(), id, p, rUsername(r))
	if err != nil {
		WriteErr(w, 400, "bad_request", err.Error())
		return
	}
	if p.Commit && res.Imported > 0 {
		h.changed(id)
	}
	WriteJSON(w, 200, res)
}
