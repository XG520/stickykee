package cn.stickykee.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * 支付通知自动记账：配置、待同步队列与上传。
 * 通知服务在 WebView 关闭时也可能回调，因此配置与队列都落在 SharedPreferences。
 */
final class FinanceAutoBridge {

    private static final String PREFS = "finance_auto";
    private static final String KEY_BASE = "base_url";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_PENDING = "pending";
    private static final int MAX_PENDING = 200;

    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(12, TimeUnit.SECONDS)
            .build();
    private static final ExecutorService POOL = Executors.newSingleThreadExecutor();
    private static final Object LOCK = new Object();
    private static volatile boolean flushing = false;

    private FinanceAutoBridge() {
    }

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void configure(Context c, String baseUrl, String token) {
        prefs(c).edit()
                .putString(KEY_BASE, trimSlash(baseUrl))
                .putString(KEY_TOKEN, token == null ? "" : token)
                .apply();
    }

    /** 退出登录：清空令牌与待同步队列，避免下一位登录用户看到上一位的待入账通知。 */
    static void reset(Context c) {
        synchronized (LOCK) {
            prefs(c).edit()
                    .putString(KEY_BASE, "")
                    .putString(KEY_TOKEN, "")
                    .putString(KEY_PENDING, "[]")
                    .apply();
        }
    }

    private static String trimSlash(String s) {
        if (s == null) return "";
        s = s.trim();
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    /** 系统「通知使用权」是否已授予本应用。 */
    static boolean listenerEnabled(Context c) {
        try {
            String flat = Settings.Secure.getString(c.getContentResolver(),
                    "enabled_notification_listeners");
            if (flat == null || flat.isEmpty()) return false;
            String pkg = c.getPackageName();
            ComponentName cn = new ComponentName(c, FinanceNotificationService.class);
            return flat.contains(pkg + "/" + FinanceNotificationService.class.getName())
                    || flat.contains(cn.flattenToString())
                    || flat.contains(cn.flattenToShortString());
        } catch (Exception e) {
            return false;
        }
    }

    private static JSONArray pendingArray(Context c) {
        try {
            return new JSONArray(prefs(c).getString(KEY_PENDING, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static void savePending(Context c, JSONArray arr) {
        prefs(c).edit().putString(KEY_PENDING, arr.toString()).apply();
    }

    static int pendingCount(Context c) {
        synchronized (LOCK) {
            return pendingArray(c).length();
        }
    }

    /** 入队一条通知负载（NotificationListenerService 调用）。 */
    static void enqueue(Context c, JSONObject payload) {
        boolean saved = false;
        synchronized (LOCK) {
            try {
                JSONArray arr = pendingArray(c);
                arr.put(payload);
                while (arr.length() > MAX_PENDING) arr.remove(0);
                savePending(c, arr);
                saved = true;
            } catch (Exception ignored) {
            }
        }
        if (saved) flushAsync(c);
    }

    static String statusJson(Context c) {
        JSONObject o = new JSONObject();
        try {
            o.put("supported", true);
            o.put("enabled", listenerEnabled(c));
            String base = prefs(c).getString(KEY_BASE, "");
            String token = prefs(c).getString(KEY_TOKEN, "");
            o.put("configured", !base.isEmpty() && !token.isEmpty());
            o.put("pending", pendingCount(c));
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    static void flushAsync(Context c) {
        final Context app = c.getApplicationContext();
        POOL.execute(new Runnable() {
            @Override
            public void run() {
                flush(app);
            }
        });
    }

    private static void flush(Context c) {
        synchronized (LOCK) {
            if (flushing) return;
            flushing = true;
        }
        try {
            String base = prefs(c).getString(KEY_BASE, "");
            String token = prefs(c).getString(KEY_TOKEN, "");
            if (base.isEmpty() || token.isEmpty()) return;
            while (true) {
                JSONObject item;
                synchronized (LOCK) {
                    JSONArray arr = pendingArray(c);
                    if (arr.length() == 0) break;
                    item = arr.optJSONObject(0);
                    if (item == null) {
                        arr.remove(0);
                        savePending(c, arr);
                        continue;
                    }
                }
                if (!post(base + "/finance/notification", token, item)) break;
                synchronized (LOCK) {
                    JSONArray arr = pendingArray(c);
                    if (arr.length() > 0) arr.remove(0);
                    savePending(c, arr);
                }
            }
        } finally {
            synchronized (LOCK) {
                flushing = false;
            }
        }
    }

    private static boolean post(String url, String token, JSONObject payload) {
        try {
            Request req = new Request.Builder()
                    .url(url)
                    .header("Authorization", "Bearer " + token)
                    .post(RequestBody.create(payload.toString(), JSON))
                    .build();
            try (Response res = CLIENT.newCall(req).execute()) {
                if (res.isSuccessful()) return true;
                int code = res.code();
                // 4xx（通知无法识别 / 内容为空）重试也无意义，直接丢弃；401/403 说明令牌失效，
                // 保留在队列中等待下次打开 App 更新令牌后再同步。
                return code >= 400 && code < 500 && code != 401 && code != 403;
            }
        } catch (Exception e) {
            return false;
        }
    }
}
