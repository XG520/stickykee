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
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * 前台保活服务：登录后启动，持有前台服务让系统（尤其 MIUI 等激进省电 ROM）
 * 不冻结/回收应用进程，保证后台时 WebSocket 不断、新消息通知与来电铃声可达。
 *
 * 通知为低重要性（IMPORTANCE_LOW）常驻通知，无提示音不打扰；点击回到应用。
 * 登出时由前端经 NativeBridge.stopKeepAlive() 停止。
 */
public class KeepAliveService extends Service {

    private static final String CHANNEL_ID = "keepalive";
    private static final int NOTIF_ID = 20260101;

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
        return START_STICKY;
    }
}
