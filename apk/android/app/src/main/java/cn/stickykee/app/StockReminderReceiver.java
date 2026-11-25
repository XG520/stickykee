package cn.stickykee.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 库存提醒闹钟接收器：RTC_WAKEUP 精确闹钟投递（Doze 可唤醒）。
 * 处理完立即把闹钟顺延到次日同一时刻（见 StockReminder.onAlarm 的链式重排），
 * 不依赖应用进程/保活服务存活。
 */
public class StockReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            StockReminder.onAlarm(context.getApplicationContext());
        } catch (Exception ignored) {
        }
    }
}
