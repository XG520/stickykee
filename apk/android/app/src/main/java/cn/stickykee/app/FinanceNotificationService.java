package cn.stickykee.app;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONObject;

/**
 * 监听微信 / 支付宝的支付通知并转入记账队列。
 * 只处理白名单包名，其他应用通知直接忽略；是否支付通知由服务端解析决定。
 */
public class FinanceNotificationService extends NotificationListenerService {

    private static final String PKG_WECHAT = "com.tencent.mm";
    private static final String PKG_ALIPAY = "com.eg.android.AlipayGphone";

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) return;
        String pkg = sbn.getPackageName();
        if (!PKG_WECHAT.equals(pkg) && !PKG_ALIPAY.equals(pkg)) return;
        if (!FinanceAutoBridge.listenerEnabled(this)) return;

        Notification n = sbn.getNotification();
        Bundle extras = n.extras;
        if (extras == null) return;

        String title = textOf(extras.getCharSequence(Notification.EXTRA_TITLE));
        String text = textOf(extras.getCharSequence(Notification.EXTRA_TEXT));
        if (text.isEmpty()) {
            text = textOf(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
        }
        if (title.isEmpty() && text.isEmpty()) return;

        try {
            JSONObject payload = new JSONObject();
            payload.put("package_name", pkg);
            payload.put("app_name", PKG_WECHAT.equals(pkg) ? "微信" : "支付宝");
            payload.put("title", title);
            payload.put("text", text);
            payload.put("posted_at", String.valueOf(sbn.getPostTime()));
            FinanceAutoBridge.enqueue(this, payload);
        } catch (Exception ignored) {
        }
    }

    private static String textOf(CharSequence cs) {
        return cs == null ? "" : cs.toString().trim();
    }
}
