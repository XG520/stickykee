package cn.stickykee.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;

/**
 * Doze 深睡唤醒心跳（位置空白期修复）。
 *
 * 根因：保活服务的心跳基于 Handler.postDelayed，熄屏 CPU suspend / 进入 Doze 后
 * 主线程定时被冻结，普通定时只在维护窗口补发——实测可出现约 50 分钟无上报，
 * 只剩用户点开 App（进程回到前台）才刷新位置。
 *
 * 方案：用 setExactAndAllowWhileIdle 精确闹钟（ELAPSED_REALTIME_WAKEUP）做链式兜底，
 * 闹钟投递时系统会短暂持有 wakelock，{@link HeartbeatReceiver} 收到后触发一次心跳。
 * 深度 Doze 下系统对每应用精确闹钟限频（约 9 分钟一次），仍远好于维护窗口级的空档。
 * 已加入电池优化白名单的应用在 Doze 下网络也放行，上报可即时完成。
 *
 * 精确闹钟权限：Android 12+ 需 SCHEDULE_EXACT_ALARM/USE_EXACT_ALARM；未授权时
 * 退化为 setAndAllowWhileIdle（非精确），NativeBridge.startKeepAlive 会引导用户授权。
 */
final class HeartbeatAlarm {

    static final String ACTION = "cn.stickykee.app.HEARTBEAT";

    private HeartbeatAlarm() {
    }

    private static PendingIntent pi(Context ctx) {
        Intent i = new Intent(ctx, HeartbeatReceiver.class);
        i.setAction(ACTION);
        return PendingIntent.getBroadcast(ctx, 0, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** 排程下一次心跳（intervalMs 后）；重复调用以最新间隔为准（同一 PI 覆盖）。 */
    static void schedule(Context ctx, long intervalMs) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            PendingIntent pi = pi(ctx);
            long at = SystemClock.elapsedRealtime() + Math.max(30_000L, intervalMs);
            if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
                // 未授精确闹钟权限：退化为非精确允许空闲触发（仍比冻结的 Handler 强），
                // 前端启动保活时会引导用户到系统设置开「闹钟与提醒」。
                am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi);
            } else {
                am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi);
            }
        } catch (Exception ignored) {
        }
    }

    static void cancel(Context ctx) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.cancel(pi(ctx));
        } catch (Exception ignored) {
        }
    }
}
