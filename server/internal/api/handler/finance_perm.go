package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"stickykee/server/internal/auth"
	"stickykee/server/internal/store"
)

// 记账模块的用户级权限：存于 user_prefs 的 finance_perm（JSON）。
//   - 管理员恒有全部权限，无需配置；
//   - 普通用户默认无任何权限，必须由管理员显式授权后才能查看/操作；
//   - View 为查看（列表/详情/统计/报表/导出），Operate 为操作（增删改/导入/识别），
//     Operate 隐含 View。
const FinancePermPrefKey = "finance_perm"

// FinancePerm 记账权限位。
type FinancePerm struct {
	View    bool `json:"view"`
	Operate bool `json:"operate"`
}

// Allows 判断是否满足所需权限；needOperate=false 表示只要求查看权限。
func (p FinancePerm) Allows(needOperate bool) bool {
	if needOperate {
		return p.Operate
	}
	return p.View || p.Operate
}

// ReadFinancePerm 读取某用户的记账权限。管理员恒为全权限。
func ReadFinancePerm(ctx context.Context, prefs *store.UserPrefs, username string) FinancePerm {
	if auth.IsAdmin(ctx) {
		return FinancePerm{View: true, Operate: true}
	}
	return ReadStoredFinancePerm(ctx, prefs, username)
}

// ReadStoredFinancePerm 读取落到 user_prefs 的原始权限（不做管理员兜底）。
// 供管理员查看/修改他人权限时使用。
func ReadStoredFinancePerm(ctx context.Context, prefs *store.UserPrefs, username string) FinancePerm {
	raw := prefs.Get(ctx, username, FinancePermPrefKey)
	var p FinancePerm
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &p)
	}
	return p
}

// WriteFinancePerm 保存某用户的记账权限。
func WriteFinancePerm(ctx context.Context, prefs *store.UserPrefs, username string, p FinancePerm) error {
	b, err := json.Marshal(p)
	if err != nil {
		return err
	}
	return prefs.Set(ctx, username, FinancePermPrefKey, string(b))
}

// RequireFinance 返回记账权限中间件：needOperate=false 仅要求查看权限。
// 无权限一律 403，前端据此隐藏入口并进行路由拦截。
func RequireFinance(prefs *store.UserPrefs, needOperate bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			username, ok := auth.User(r.Context())
			if !ok {
				WriteErr(w, 401, "unauthorized", "missing token")
				return
			}
			if !ReadFinancePerm(r.Context(), prefs, username).Allows(needOperate) {
				WriteErr(w, 403, "forbidden", "未获得记账模块授权，请联系管理员")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// financeEntityNames 记账同步（finance_sync.go）注册到 HA 的传感器实体显示名。
// 这些实体的数据来自账本，无记账权限的用户不应在实体列表/详情/历史中看到。
var financeEntityNames = map[string]struct{}{
	"本月支出":   {},
	"本月收入":   {},
	"本月结余":   {},
	"本月预算剩余": {},
	"预算使用率":  {},
	"总资产":    {},
	"周期账单数":  {},
	"周期账单总额": {},
	"下次周期账单": {},
}

// IsFinanceEntityName 判断实体显示名是否属于记账相关实体。
func IsFinanceEntityName(name string) bool {
	_, ok := financeEntityNames[strings.TrimSpace(name)]
	return ok
}

// FinanceEntityVisible 判断某个实体对当前用户是否可见；非记账实体恒可见。
func FinanceEntityVisible(ctx context.Context, prefs *store.UserPrefs, friendlyName string) bool {
	if !IsFinanceEntityName(friendlyName) {
		return true
	}
	username, _ := auth.User(ctx)
	return ReadFinancePerm(ctx, prefs, username).Allows(false)
}
