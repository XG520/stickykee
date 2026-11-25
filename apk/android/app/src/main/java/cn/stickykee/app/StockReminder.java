package cn.stickykee.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.util.Calendar;

/**
 * 库存每日提醒（临期/过期/需补货）：数据在应用数据库里、由前端统计，触发靠
 * 系统级精确闹钟——WebView 退后台后 JS 定时器被冻结、熄屏进 Doze 后完全停摆，
 * 只有 AlarmManager 能在锁屏/后台按时弹出通知。
 *
 * 设计：
 * ① 前端每次打开库存页算好摘要，经 NativeBridge.setDailyStockReminder 写入；
 * ② 本类把配置 + 触发时刻持久化到 SharedPreferences("stickykee")，排一个
 *    RTC_WAKEUP 精确闹钟（Doze 豁免，深睡可唤醒；无精确闹钟权限时退化为
 *    setAndAllowWhileIdle，仍强于冻结的 JS 定时器）；
 * ③ 到点由 StockReminderReceiver 接住 → 弹状态栏通知（独立渠道 stock_reminders，
 *    HIGH 重要性带声音震动）→ 自动顺延到次日同一时刻（链式，不依赖进程存活）；
 * ④ 通知点击拉应用回前台（MainActivity），用户进库存页后摘要随之刷新。
 * 摘要为「最近一次打开库存页时」的统计，通知里已注明，避免数字陈旧误导。
 */
final class StockReminder {

    static final String ACTION = "cn.stickykee.app.STOCK_REMINDER";
    private static final String PREFS = "stickykee";
    private static final String KEY = "stock_reminder";
    private static final int NOTIF_ID = 9501;
    private static final String CH_ID = "stock_reminders";

    private StockReminder() {
    }

    /** 写入配置并排/撤闹钟。time 为 "HH:mm"（本地时区），summary 为空串时通知只显示标题。 */
    static void schedule(Context app, boolean enabled, String time, String summary) {
        try {
            int h = 9, m = 0;
            if (time != null && !time.trim().isEmpty()) {
                String[] p = time.trim().split(":");
                try {
                    h = Math.max(0, Math.min(23, Integer.parseInt(p[0])));
                    m = p.length > 1 ? Math.max(0, Math.min(59, Integer.parseInt(p[1]))) : 0;
                } catch (Exception ignored) {
                }
            }
            long due = nextDue(h, m);
            JSONObject o = new JSONObject();
            o.put("enabled", enabled);
            o.put("time", String.format("%02d:%02d", h, m));
            o.put("summary", summary == null ? "" : summary);
            o.put("dueAt", due);
            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putString(KEY, o.toString()).apply();

            AlarmManager am = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            if (enabled) {
                long at = Math.max(due, System.currentTimeMillis());
                if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi(h, m));
                } else {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi(h, m));
                }
            } else {
                am.cancel(pi(h, m));
            }
        } catch (Exception ignored) {
        }
    }

    /** 闹钟投递入口（StockReminderReceiver）：弹通知并把闹钟顺延到次日同一时刻。 */
    static void onAlarm(Context app) {
        try {
            String js = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "");
            if (js.isEmpty()) return;
            JSONObject o = new JSONObject(js);
            if (!o.optBoolean("enabled")) return;
            showNotification(app, o.optString("summary", ""));
            // 链式：立刻排下一天同一时刻，不依赖进程/服务存活
            schedule(app, true, o.optString("time", "09:00"), o.optString("summary", ""));
        } catch (Exception ignored) {
        }
    }

    /** 今天 h:m 的下一时刻；已过则推到明天。 */
    private static long nextDue(int h, int m) {
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, h);
        c.set(Calendar.MINUTE, m);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        if (c.getTimeInMillis() <= System.currentTimeMillis()) {
            c.add(Calendar.DAY_OF_MONTH, 1);
        }
        return c.getTimeInMillis();
    }

    /** 按「时刻」稳定生成 requestCode（h/m 编码进请求码）：同一时刻排/撤用同一 PI，
     *  改时间后旧闹钟的 PI 不同不会误取消；不用毫秒换算（int 会溢出）。 */
    private static PendingIntent pi(int h, int m) {
        Intent i = new Intent(null, StockReminderReceiver.class);
        i.setClassName("cn.stickykee.app", "cn.stickykee.app.StockReminderReceiver");
        i.setAction(ACTION);
        return PendingIntent.getBroadcast(null, h * 60 + m, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void showNotification(Context app, String summary) {
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                if (androidx.core.content.ContextCompat.checkSelfPermission(app,
                        "android.permission.POST_NOTIFICATIONS")
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    return; // 无权限静默（登录时 startKeepAlive 已引导授权）
                }
            }
            NotificationManager nm =
                    (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = nm.getNotificationChannel(CH_ID);
                if (ch == null) {
                    ch = new NotificationChannel(CH_ID, "库存提醒",
                            NotificationManager.IMPORTANCE_HIGH);
                    ch.setDescription("临期 / 过期 / 需补货物品的每日提醒");
                    ch.setSound(Settings.System.DEFAULT_NOTIFICATION_URI,
                            new AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                    .build());
                    ch.enableVibration(true);
                    nm.createNotificationChannel(ch);
                }
            }
            Intent it = new Intent(app, MainActivity.class);
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent tap = PendingIntent.getActivity(app, NOTIF_ID, it,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            String text = summary == null || summary.isEmpty() ? "查看库存" : summary;
            NotificationCompat.Builder b = new NotificationCompat.Builder(app, CH_ID)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle("库存提醒（数据截至最近一次打开库存页）")
                    .setContentText(text)
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setContentIntent(tap);
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                b.setDefaults(NotificationCompat.DEFAULT_ALL);
            }
            nm.notify(NOTIF_ID, b.build());
        } catch (Exception ignored) {
        }
    }
}
