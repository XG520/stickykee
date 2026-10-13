package cn.stickykee.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * 前台保活服务：登录后启动，持有前台服务让系统（尤其 MIUI 等激进省电 ROM）
 * 不冻结/回收应用进程，保证后台时 WebSocket 不断、新消息通知与来电铃声可达。
 *
 * 通知为低重要性（IMPORTANCE_LOW）常驻通知，无提示音不打扰；点击回到应用。
 * 登出时由前端经 NativeBridge.stopKeepAlive() 停止。
 *
 * 传感器后台心跳：WebView 退后台后 JS 定时器全部冻结（pauseTimers），
 * 传感器停止更新——服务以可配置间隔（sensor_interval，默认 60s）调用
 * NativeBridge.tickSensorsFromService()，经 evaluateJavascript 注入
 * window.__skSensorTick 驱动前端采集上报（显式注入不受 pauseTimers 影响）。
 * 间隔经 NativeBridge.setSensorInterval 由前端设置页修改，持久化在
 * SharedPreferences("stickykee")，服务重启后沿用。
 *
 * 进程被杀自恢复：START_STICKY 下系统稍后重启服务时 intent 为 null，
 * 此时若主界面不在（MainActivity.alive == false，用户划掉/被杀），
 * 尝试拉起 MainActivity 重建 WebView 与连接——自启动恢复链路
 * （MIUI 需用户授予「自启动」权限，未授权时静默失败，用户点开即恢复）。
 */
public class KeepAliveService extends Service {

    private static final String CHANNEL_ID = "keepalive";
    private static final int NOTIF_ID = 20260101;
    private static final int DEFAULT_INTERVAL_SEC = 60;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private long intervalMs = DEFAULT_INTERVAL_SEC * 1000L;
    private boolean ticking = false;

    private final Runnable heartbeat = new Runnable() {
        @Override
        public void run() {
            try {
                NativeBridge.tickSensorsFromService();
            } catch (Exception ignored) {
            }
            if (ticking) handler.postDelayed(this, intervalMs);
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "后台保持连接",
                NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("保持消息与通话实时可达");
        ch.setShowBadge(false);
        ch.enableVibration(false);
        ch.setSound(null, null);
        nm.createNotificationChannel(ch);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 系统拉活（START_STICKY）或首次启动都会走到这里：立即转前台，
        // 否则 startForegroundService 后 5 秒内未 startForeground 会崩溃。
        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("Sticky Kee 运行中")
                .setContentText("保持连接，消息与来电实时可达")
                .setOngoing(true)
                .setContentIntent(PendingIntent.getActivity(this, 0,
                        new Intent(this, MainActivity.class),
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
        ServiceCompat.startForeground(this, NOTIF_ID, n,
                Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0);

        // 进程被杀后的服务自恢复：intent 为 null 说明是系统重启（非前端主动启动），
        // 主界面不在时尝试拉起——重建 WebView/连接后传感器与消息全部自动恢复。
        if (intent == null && !MainActivity.alive) {
            try {
                Intent it = new Intent(this, MainActivity.class);
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(it);
            } catch (Exception ignored) {
                // Android 10+ 后台启动 Activity 受限（未开自启动权限的 ROM 拦截）：
                // 服务仍存活保住进程，用户点开 App 后立即恢复
            }
        }

        // 心跳间隔：intent extra（前端改配置时传入）优先，其次持久化值
        int sec = intent != null ? intent.getIntExtra("interval_sec", 0) : 0;
        if (sec <= 0) {
            try {
                sec = getSharedPreferences("stickykee", Context.MODE_PRIVATE)
                        .getInt("sensor_interval", DEFAULT_INTERVAL_SEC);
            } catch (Exception ignored) {
                sec = DEFAULT_INTERVAL_SEC;
            }
        }
        intervalMs = Math.max(10, Math.min(3600, sec)) * 1000L;
        startHeartbeat();
        return START_STICKY;
    }

    /** 重排后台心跳（间隔变化/服务重启都会走到）。 */
    private void startHeartbeat() {
        handler.removeCallbacks(heartbeat);
        ticking = true;
        handler.postDelayed(heartbeat, intervalMs);
    }

    @Override
    public void onDestroy() {
        ticking = false;
        handler.removeCallbacks(heartbeat);
        super.onDestroy();
    }
}
