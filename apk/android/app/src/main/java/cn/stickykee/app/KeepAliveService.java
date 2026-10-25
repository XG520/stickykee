package cn.stickykee.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * 前台保活服务：登录后启动，持有前台服务让系统（尤其 MIUI 等激进省电 ROM）
 * 不冻结/回收应用进程，保证后台时 WebSocket 不断、新消息通知与来电铃声可达。
 *
 * 通知为低重要性（IMPORTANCE_LOW）常驻通知，无提示音不打扰；点击回到应用。
 * 登出时由前端经 NativeBridge.stopKeepAlive() 停止。
 *
 * 传感器后台心跳：传感器采集与上报完全由原生 NativeSensorReporter 承担
 * （见 docs/传感器原生采集开发规范.md）。服务以可配置间隔（sensor_interval，默认 60s）
 * 每次心跳调用 NativeSensorReporter.report() 采集启用项并直连服务端上报——
 * 不依赖 WebView 存活，退后台/被划掉仍按周期刷新（与官方 App 同路）。
 * 间隔经 NativeBridge.setSensorInterval 由前端设置页修改，持久化在
 * SharedPreferences("stickykee")，服务重启后沿用。
 *
 * Doze 兜底（位置空白期修复）：Handler 心跳在熄屏 CPU suspend / Doze 下会被冻结到
 * 维护窗口（实测可空 ~50 分钟）。故另排一个 setExactAndAllowWhileIdle 链式精确闹钟
 * （见 HeartbeatAlarm / HeartbeatReceiver），深睡中也能唤醒触发心跳；两路心跳
 * 用 {@link #lastTickAt} 节流去重。
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

    /** 闹钟唤醒心跳的 action（见 HeartbeatReceiver）。 */
    static final String ACTION_TICK = "cn.stickykee.app.TICK";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private long intervalMs = DEFAULT_INTERVAL_SEC * 1000L;
    private boolean ticking = false;
    /** 上一次实际心跳的 elapsedRealtime，Handler 与精确闹钟两路触发共用去重。 */
    private static volatile long lastTickAt = 0L;

    private final Runnable heartbeat = new Runnable() {
        @Override
        public void run() {
            doTick();
            if (ticking) handler.postDelayed(this, intervalMs);
        }
    };

    /** 执行一次心跳（传感器上报 + WS 保活 + 持续定位监听保活），两路触发节流去重。 */
    private void doTick() {
        long now = android.os.SystemClock.elapsedRealtime();
        if (now - lastTickAt < Math.max(5_000L, intervalMs / 2)) return;
        lastTickAt = now;
        // 持续低频定位监听：追踪/位置传感器开启期间保持 GPS fix 新鲜，
        // 否则深睡中单次 8s 取星常失败 → 位置项整体缺失（空白期的另一半根因）。
        try {
            NativeSensorReporter.syncLocationTracking(getApplicationContext());
        } catch (Exception ignored) {
        }
        // 传感器采集与上报完全由原生统一采集器承担（不依赖 WebView 存活）：
        // 每次心跳按启用项采集并直连服务端上报（见 NativeSensorReporter / 开发规范）。
        try {
            NativeSensorReporter.report(getApplicationContext(), "periodic");
        } catch (Exception ignored) {
        }
        // 通话/消息 WebSocket 保活：后台 pauseTimers 冻结页面 JS 心跳与重连，
        // 经 evaluateJavascript（不被冻结）注入发送应用层 ping / 断线立即重建，
        // 否则服务端 90s 读超时注销连接后对端显示「离线」、来电判离线。
        try {
            NativeBridge.keepaliveWebSocket();
        } catch (Exception ignored) {
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        // NotificationChannel 是 API 26+ 的类：老车机（Android 6.0/API 23 等）上直接引用
        // 会 NoClassDefFoundError，onCreate 即崩溃。低版本无渠道概念，跳过即可。
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
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
                Build.VERSION.SDK_INT >= 29 ? foregroundType() : 0);

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
        // 闹钟唤醒：正常心跳外的 Doze 兜底（HeartbeatReceiver 链式自延续）。
        if (ACTION_TICK.equals(intent != null ? intent.getAction() : null)) {
            doTick();
        }
        return START_STICKY;
    }

    /** 重排后台心跳（间隔变化/服务重启都会走到）：Handler 正常心跳 + 精确闹钟 Doze 兜底。 */
    private void startHeartbeat() {
        handler.removeCallbacks(heartbeat);
        ticking = true;
        handler.postDelayed(heartbeat, intervalMs);
        HeartbeatAlarm.schedule(getApplicationContext(), intervalMs);
    }

    /**
     * 前台服务类型掩码：始终 dataSync；定位权限已授予时叠加 location
     * （geocoded_location 后台刷新需要）。未授予定位时只声明 dataSync——
     * Android 14 对 location 类型要求持有定位权限，否则启动前台服务会被拒绝。
     */
    private int foregroundType() {
        int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
        try {
            if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED
                    || ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_COARSE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED) {
                type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
            }
        } catch (Exception ignored) {
        }
        return type;
    }

    @Override
    public void onDestroy() {
        ticking = false;
        handler.removeCallbacks(heartbeat);
        HeartbeatAlarm.cancel(getApplicationContext());
        super.onDestroy();
    }
}
