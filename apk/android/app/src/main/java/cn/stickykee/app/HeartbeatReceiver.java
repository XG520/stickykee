package cn.stickykee.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

/**
 * 精确闹钟心跳接收器：Doze 深睡下被 AlarmManager 唤醒触发一次心跳。
 *
 * ① 先排程下一次闹钟（链式自延续，不依赖服务存活）；
 * ② 拉起保活服务执行心跳（服务本就前台存活时只复用现有实例，无 FGS 启动限制问题；
 *    被系统杀掉后由精确闹钟豁免路径重启）；
 * ③ 极端 ROM 禁止后台启服务时，在 goAsync 窗口内直接跑一次上报兜底。
 */
public class HeartbeatReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final Context app = context.getApplicationContext();
        // 链式排程：无论后续启服务是否成功，下一拍都不断。
        long intervalMs = 60_000L;
        try {
            int sec = app.getSharedPreferences("stickykee", Context.MODE_PRIVATE)
                    .getInt("sensor_interval", 60);
            intervalMs = Math.max(10, Math.min(3600, sec)) * 1000L;
        } catch (Exception ignored) {
        }
        HeartbeatAlarm.schedule(app, intervalMs);

        boolean started = false;
        try {
            ContextCompat.startForegroundService(app,
                    new Intent(app, KeepAliveService.class)
                            .setAction(KeepAliveService.ACTION_TICK));
            started = true;
        } catch (Exception ignored) {
        }
        if (started) return;

        // 兜底：服务起不来时直接在广播窗口（约 10s）内完成一次上报。
        final BroadcastReceiver.PendingResult pr = goAsync();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    NativeSensorReporter.report(app, "alarm");
                    NativeBridge.keepaliveWebSocket();
                } catch (Exception ignored) {
                } finally {
                    pr.finish();
                }
            }
        }, "sk-alarm-tick").start();
    }
}
