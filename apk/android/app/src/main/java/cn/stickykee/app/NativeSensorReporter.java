package cn.stickykee.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.telephony.TelephonyManager;

import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 原生传感器统一采集器 + 统一上报器（见 docs/传感器原生采集开发规范.md）。
 *
 * 规范要求：APK 端所有传感器的采集与上报必须由原生实现，前端只负责配置与展示。
 * 本类是唯一采集出口与唯一上报出口：由保活服务心跳按配置间隔调用 {@link #report}，
 * 采集当前启用项（前端同步过来的 key 清单）后直连服务端
 * POST /api/v1/instances/{id}/sensors/report。
 *
 * 关键点：上报由原生定时驱动，完全不依赖 WebView 存活——WebView 被系统节流/冻结、
 * 应用被划掉、渲染进程被杀时，前台服务仍在按周期上报（与官方 App 同路）。
 *
 * 上下文持久化于 SharedPreferences("stickykee")：
 *   sensor_ctx_url/token/inst/dev/devname/keys/track/on、sensor_last_report、sensor_last_loc。
 *
 * 异常与边界（强制）：逐项 try-catch（单项失败只跳过该项）、上报线程原子防重入、
 * 对外方法绝不抛出（保活服务不能被拖崩）、采不到的项整个键不出现、仅采集启用项、
 * 401/403 清上下文等前端重写、成功刷新 sensor_last_report。
 */
public final class NativeSensorReporter {

    private NativeSensorReporter() {
    }

    /** 上报线程原子防重入（保活心跳与手动上报共用）。 */
    private static final AtomicBoolean inFlight = new AtomicBoolean(false);

    // ---- 上下文（前端 setSensorContext 写入，保活服务同进程读取）----
    private static final String KEY_URL = "sensor_ctx_url";
    private static final String KEY_TOKEN = "sensor_ctx_token";
    private static final String KEY_INST = "sensor_ctx_inst";
    private static final String KEY_DEV = "sensor_ctx_dev";
    private static final String KEY_DEVNAME = "sensor_ctx_devname";
    private static final String KEY_KEYS = "sensor_ctx_keys";   // 启用项 CSV
    private static final String KEY_TRACK = "sensor_ctx_track"; // 1=设备追踪开启
    private static final String KEY_ON = "sensor_ctx_on";       // 1=至少启用一个传感器
    private static final String KEY_LAST = "sensor_last_report";  // 成功上报时间戳（链路健康判据）
    private static final String KEY_LAST_LOC = "sensor_last_loc"; // 上次逆地理坐标+地址缓存
    private static final String KEY_TRACK_LAT = "sensor_track_lat"; // 上次成功推送的 device_tracker 纬度
    private static final String KEY_TRACK_LNG = "sensor_track_lng"; // 上次成功推送的 device_tracker 经度
    private static final String KEY_TRACK_HAS = "sensor_track_has"; // 是否已有成功推送基线

    // ---- device_tracker 防抖动（修复「后台恢复瞬间旧缓存位置把在家误判为离家、几秒后又跳回」）----
    // device_tracker 的状态只应随真实位置变化（与 geocoded_location 同一尺度），
    // 不能被心跳里几分钟前的缓存 fix / 室内漂移点带着反复横跳。
    private static final long TRACK_CACHE_MAX_AGE_MS = 2 * 60 * 1000L; // 追踪只信 2 分钟内的缓存 fix
    private static final long TRACK_FRESH_MS = 30 * 1000L;             // fix 时间超过 30s 即视为非实时
    private static final float TRACK_MOVE_M = 50f;                     // 位移超过 50m 才重新推送（约 0.0005°）

    // ---- 公网 IP：多源探测 + 5 分钟缓存（避免频繁外网请求）----
    private static final int IP_CACHE_MS = 5 * 60 * 1000;
    private static final String[] IP_SOURCES = {
            "https://api.ipify.org?format=json",
            "https://ipinfo.io/ip",
            "https://myip.ipip.net",
            "https://4.ipw.cn",
    };
    private static volatile String cachedIp = "";
    private static volatile long cachedIpAt = 0;

    // ---- 环境光 / 接近：懒注册监听、缓存最近读数（避免每周期重复注册）----
    private static SensorManager sensorManager;
    private static Sensor lightSensor;
    private static Sensor proximitySensor;
    private static boolean lightOn;
    private static boolean proximityOn;
    private static volatile float lastLux = -1f;
    private static volatile float lastProximity = -1f;
    private static volatile float lastProximityMax = -1f;

    private static final SensorEventListener lightListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent e) {
            if (e != null && e.values != null && e.values.length > 0) lastLux = e.values[0];
        }

        @Override
        public void onAccuracyChanged(Sensor s, int a) {
        }
    };

    private static final SensorEventListener proximityListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent e) {
            if (e != null && e.values != null && e.values.length > 0) {
                lastProximity = e.values[0];
                lastProximityMax = e.sensor != null ? e.sensor.getMaximumRange() : -1f;
            }
        }

        @Override
        public void onAccuracyChanged(Sensor s, int a) {
        }
    };

    // ---- 持续低频定位监听：追踪/位置传感器开启时保 GPS fix 新鲜 ----
    // 深睡中 getLastKnownLocation 常为旧值、单次 8s 冷取星又常超时失败，
    // 是「熄屏后位置空白、点开 App 才刷新」的另一半根因（另一半是心跳被 Doze 冻结，
    // 由 HeartbeatAlarm 解决）。前台服务带 location 类型时，持续订阅可在后台持续出 fix。
    private static final long LOC_MIN_INTERVAL_MS = 60_000L;
    private static final long LOC_MAX_INTERVAL_MS = 300_000L;
    private static HandlerThread locThread;
    private static Handler locHandler;
    private static LocationManager locManager;
    private static LocationListener locListener;
    private static volatile boolean locTrackingOn = false;
    private static volatile Location latestFix;
    private static volatile long latestFixAt = 0L;

    /** 手动上报结果回调（在后台线程触发，调用方负责切回 UI 线程派发事件）。 */
    public interface ReportCallback {
        void onResult(boolean ok, int reported, String error);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext()
                .getSharedPreferences("stickykee", Context.MODE_PRIVATE);
    }

    // ==================== 上下文同步 ====================

    /**
     * 写入采集上下文（前端在登录、实例切换、启用项变化、追踪开关变化时调用）。
     * 写入后立即触发一次上报，保证开关变化即时生效。
     */
    public static void setContext(Context ctx, String baseUrl, String token, String instanceId,
                                  String deviceId, String deviceName, String enabledKeysCsv, boolean tracking) {
        try {
            String keys = enabledKeysCsv == null ? "" : enabledKeysCsv.trim();
            prefs(ctx).edit()
                    .putString(KEY_URL, trim(baseUrl))
                    .putString(KEY_TOKEN, trim(token))
                    .putString(KEY_INST, trim(instanceId))
                    .putString(KEY_DEV, trim(deviceId))
                    .putString(KEY_DEVNAME, trim(deviceName))
                    .putString(KEY_KEYS, keys)
                    .putInt(KEY_TRACK, tracking ? 1 : 0)
                    .putInt(KEY_ON, keys.length() > 0 ? 1 : 0)
                    .apply();
        } catch (Exception ignored) {
            return;
        }
        syncLocationTracking(ctx.getApplicationContext());
        report(ctx.getApplicationContext(), "event");
    }

    /** 登出/会话停止时清理上下文（前端经 NativeBridge.clearSensorContext 触发）。 */
    public static void clearContext(Context ctx) {
        try {
            prefs(ctx).edit()
                    .remove(KEY_URL).remove(KEY_TOKEN).remove(KEY_INST).remove(KEY_DEV)
                    .remove(KEY_DEVNAME).remove(KEY_KEYS)
                    .putInt(KEY_TRACK, 0)
                    .putInt(KEY_ON, 0)
                    .apply();
        } catch (Exception ignored) {
        }
        stopLocationTracking();
    }

    // ==================== 持续低频定位监听 ====================

    /**
     * 按当前配置启停持续定位监听（保活心跳每次调用，幂等）。
     * 仅当设备追踪开启或启用了 geocoded_location 传感器、且已授予定位权限时启动；
     * 其余情况（登出/关闭追踪/权限被撤）立即停止，避免无谓耗电。
     */
    public static void syncLocationTracking(Context ctx) {
        try {
            SharedPreferences p = prefs(ctx);
            boolean track = p.getInt(KEY_TRACK, 0) == 1;
            boolean needGeo = parseKeys(p.getString(KEY_KEYS, "")).contains("geocoded_location");
            boolean perm = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED
                    || ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
            if ((track || needGeo) && perm) {
                if (!locTrackingOn) startLocationTracking(ctx, p);
            } else if (locTrackingOn) {
                stopLocationTracking();
            }
        } catch (Exception ignored) {
        }
    }

    private static synchronized void startLocationTracking(Context ctx, SharedPreferences p) {
        if (locTrackingOn) return;
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return;
        long interval;
        try {
            interval = Math.max(LOC_MIN_INTERVAL_MS, Math.min(LOC_MAX_INTERVAL_MS,
                    p.getInt("sensor_interval", 60) * 1000L));
        } catch (Exception e) {
            interval = LOC_MIN_INTERVAL_MS;
        }
        LocationListener l = new LocationListener() {
            @Override
            public void onLocationChanged(Location loc) {
                if (loc == null) return;
                // 只采信卫星 fix：PASSIVE 也可能送来 network/fused 结果，
                // 本项目位置严禁网络定位顶替（地址/坐标一致性）。
                if (!LocationManager.GPS_PROVIDER.equals(loc.getProvider())) return;
                // requestLocationUpdates 注册瞬间系统可能投递几十分钟前的缓存 fix。
                // 一旦让它进 latestFix，latestFixAt 取的是「接收时刻」，后续 2 分钟
                // 新鲜度检查全部失效——出门后冷启动时旧的家坐标会被当实时点推给
                // device_tracker。只接受 fix 自身时间戳 10s 内的新鲜点。
                if (!isFreshGpsFix(loc)) return;
                Location prev = latestFix;
                if (prev == null || loc.getTime() >= prev.getTime()) {
                    latestFix = loc;
                    latestFixAt = System.currentTimeMillis();
                }
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {
            }

            @Override
            public void onProviderEnabled(String provider) {
            }

            @Override
            public void onProviderDisabled(String provider) {
            }
        };
        HandlerThread t = new HandlerThread("sk-loc");
        t.start();
        Looper looper = t.getLooper();
        boolean fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        boolean registered = false;
        try {
            // 卫星定位：本项目位置严禁网络定位顶替；FINE 才订阅 GPS。
            if (fine) {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, interval, 0f, l, looper);
                registered = true;
            }
            // PASSIVE：搭车其他 App/系统的定位结果（近乎零耗电），粗定位权限也可收。
            if (fine || coarse) {
                lm.requestLocationUpdates(LocationManager.PASSIVE_PROVIDER,
                        Math.max(30_000L, interval), 0f, l, looper);
                registered = true;
            }
        } catch (Exception e) {
            registered = false;
        }
        if (!registered) {
            t.quit();
            return;
        }
        locThread = t;
        locHandler = new Handler(looper);
        locManager = lm;
        locListener = l;
        locTrackingOn = true;
    }

    static synchronized void stopLocationTracking() {
        if (!locTrackingOn) return;
        locTrackingOn = false;
        try {
            if (locManager != null && locListener != null) {
                locManager.removeUpdates(locListener);
            }
        } catch (Exception ignored) {
        }
        locManager = null;
        locListener = null;
        locHandler = null;
        if (locThread != null) {
            locThread.quit();
            locThread = null;
        }
        latestFix = null;
        latestFixAt = 0L;
    }

    // ==================== 上报入口 ====================

    /**
     * 保活服务心跳入口：按周期采集并上报。非阻塞、不抛出，可在主线程直接调用。
     * 上下文不完整或未启用任何传感器时直接返回（不做任何网络请求）。
     */
    public static void report(Context ctx, final String trigger) {
        try {
            SharedPreferences p = prefs(ctx);
            // 追踪开关开启时即便未启用任何传感器也进入上报流程（仅做 device_tracker 位置上报）。
            if (p.getInt(KEY_ON, 0) != 1 && p.getInt(KEY_TRACK, 0) != 1) return;
            if (!contextComplete(p)) return;
            if (!inFlight.compareAndSet(false, true)) return; // 上一次仍在进行
            final Context app = ctx.getApplicationContext();
            try {
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            doReport(app, trigger, null, true);
                        } catch (Exception ignored) {
                            inFlight.set(false);
                        }
                    }
                }, "sk-sensor-report").start();
            } catch (Exception e) {
                inFlight.set(false);
            }
        } catch (Exception ignored) {
        }
    }

    /** 手动即时上报：结果经回调返回（前端经 stickykee-sensors 事件展示）。绝不抛出。 */
    public static void reportNow(Context ctx, final String trigger, final ReportCallback cb) {
        try {
            SharedPreferences p = prefs(ctx);
            if (!contextComplete(p)) {
                if (cb != null) cb.onResult(false, 0, "no_context");
                return;
            }
            if (!inFlight.compareAndSet(false, true)) {
                if (cb != null) cb.onResult(false, 0, "busy");
                return;
            }
            final Context app = ctx.getApplicationContext();
            try {
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            doReport(app, trigger, cb, false);
                        } catch (Exception e) {
                            inFlight.set(false);
                            if (cb != null) cb.onResult(false, 0, msgOf(e));
                        }
                    }
                }, "sk-sensor-report").start();
            } catch (Exception e) {
                inFlight.set(false);
                if (cb != null) cb.onResult(false, 0, msgOf(e));
            }
        } catch (Exception ignored) {
        }
    }

    private static boolean contextComplete(SharedPreferences p) {
        return nonEmpty(p.getString(KEY_URL, ""))
                && nonEmpty(p.getString(KEY_TOKEN, ""))
                && nonEmpty(p.getString(KEY_INST, ""))
                && nonEmpty(p.getString(KEY_DEV, ""));
    }

    /** 单次上报：采集 → 组装 payload → POST。成功刷时间戳 / 401、403 清上下文。绝不抛出。 */
    private static void doReport(Context ctx, String trigger, ReportCallback cb, boolean includeLocation) {
        HttpURLConnection conn = null;
        int reported = 0;
        try {
            SharedPreferences p = prefs(ctx);
            if (!contextComplete(p)) {
                if (cb != null) cb.onResult(false, 0, "no_context");
                return;
            }
            String base = p.getString(KEY_URL, "");
            String token = p.getString(KEY_TOKEN, "");
            String inst = p.getString(KEY_INST, "");
            String dev = p.getString(KEY_DEV, "");
            String devName = p.getString(KEY_DEVNAME, "");

            JSONObject sensors = collect(ctx, p, trigger);
            reported = sensors.length();

            if (reported > 0) {
                JSONObject body = new JSONObject();
                body.put("device_id", dev);
                if (nonEmpty(devName)) body.put("device_name", devName);
                body.put("manufacturer", safe(Build.MANUFACTURER));
                body.put("model", safe(Build.MODEL));
                body.put("os_name", "android");
                body.put("os_version", safe(Build.VERSION.RELEASE));
                body.put("sensors", sensors);

                conn = (HttpURLConnection) new URL(
                        base + "/api/v1/instances/" + inst + "/sensors/report").openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(15000);
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                OutputStream os = conn.getOutputStream();
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                os.flush();
                os.close();
                int code = conn.getResponseCode();
                if (code >= 200 && code < 300) {
                    prefs(ctx).edit().putLong(KEY_LAST, System.currentTimeMillis()).apply();
                    if (cb != null) cb.onResult(true, reported, null);
                } else if (code == 401 || code == 403) {
                    clearContext(ctx); // 会话失效：清上下文，等前端重新同步
                    if (cb != null) cb.onResult(false, reported, "auth");
                } else {
                    if (cb != null) cb.onResult(false, reported, "http_" + code);
                }
            }

            // 设备追踪位置上报（update_location webhook → HA device_tracker → zone 判定）。
            // geocoded_location 只是坐标型传感器，HA 不据其判定在家/离家；回家/离家自动化
            // 依赖 device_tracker 的 zone 状态。WebView 退后台 pauseTimers 冻结前端的
            // setInterval/watchPosition，后台无人上报 → 只有打开 APP 才触发回家自动化。
            // 故由原生后台心跳在此直连上报，不依赖 WebView 存活（失败静默不影响传感器结果）。
            if (includeLocation && p.getInt(KEY_TRACK, 0) == 1) {
                try {
                    reportDeviceLocation(ctx, base, token, inst, dev);
                } catch (Exception ignored) {
                }
            }
        } catch (Exception e) {
            if (cb != null) cb.onResult(false, reported, msgOf(e));
        } finally {
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored) {
                }
            }
            inFlight.set(false);
        }
    }

    // ==================== 采集（唯一采集出口）====================

    /** 按启用项清单逐项采集；每项独立 try-catch，采不到的项整个键不出现。 */
    private static JSONObject collect(Context ctx, SharedPreferences p, String trigger) {
        JSONObject s = new JSONObject();
        Set<String> keys = parseKeys(p.getString(KEY_KEYS, ""));
        if (keys.isEmpty()) return s;
        Context app = ctx.getApplicationContext();

        boolean needLight = keys.contains("light_sensor");
        boolean needProx = keys.contains("proximity");
        if (needLight || needProx) {
            try {
                ensureSensorListeners(app, needLight, needProx);
            } catch (Exception ignored) {
            }
        }

        // 电池电量
        if (keys.contains("battery_level")) {
            try {
                BatteryManager bm = (BatteryManager) app.getSystemService(Context.BATTERY_SERVICE);
                int level = bm != null ? bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) : Integer.MIN_VALUE;
                if (level >= 0 && level <= 100) {
                    s.put("battery_level", new JSONObject().put("state", level));
                }
            } catch (Exception ignored) {
            }
        }

        // 充电状态：charging / full / discharging（满电或电量 100 优先判满）
        if (keys.contains("battery_state")) {
            try {
                Intent bi = app.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                if (bi != null) {
                    int status = bi.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                    int level = bi.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                    int scale = bi.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
                    boolean full = status == BatteryManager.BATTERY_STATUS_FULL
                            || (level > 0 && scale > 0 && level >= scale);
                    boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING;
                    String state = full ? "full" : (charging ? "charging" : "discharging");
                    s.put("battery_state", new JSONObject().put("state", state));
                }
            } catch (Exception ignored) {
            }
        }

        // 网络：connection_type / network_quality / wifi_ssid / bssid 共用一次探测
        if (keys.contains("connection_type") || keys.contains("network_quality")
                || keys.contains("wifi_ssid") || keys.contains("bssid")) {
            String type = "unavailable";
            NetworkCapabilities caps = null;
            try {
                ConnectivityManager cm = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
                Network nw = cm != null ? cm.getActiveNetwork() : null;
                caps = nw != null ? cm.getNetworkCapabilities(nw) : null;
                if (caps != null) {
                    if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) type = "wifi";
                    else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) type = "cellular";
                    else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) type = "ethernet";
                }
            } catch (Exception ignored) {
            }

            if (keys.contains("connection_type")) {
                try {
                    s.put("connection_type", new JSONObject().put("state", type));
                } catch (Exception ignored) {
                }
            }

            if (keys.contains("network_quality")) {
                try {
                    String q = null;
                    if ("wifi".equals(type)) q = "wifi";
                    else if ("ethernet".equals(type)) q = "ethernet";
                    else if ("cellular".equals(type)) q = cellularQuality(app);
                    if (q != null) {
                        JSONObject o = new JSONObject().put("state", q);
                        JSONObject a = new JSONObject();
                        if (caps != null) {
                            int dn = caps.getLinkDownstreamBandwidthKbps();
                            int up = caps.getLinkUpstreamBandwidthKbps();
                            if (dn > 0) a.put("downlink_kbps", dn);
                            if (up > 0) a.put("upstream_kbps", up);
                        }
                        if (a.length() > 0) o.put("attributes", a);
                        s.put("network_quality", o);
                    }
                } catch (Exception ignored) {
                }
            }

            if ("wifi".equals(type) && (keys.contains("wifi_ssid") || keys.contains("bssid"))) {
                try {
                    WifiManager wm = (WifiManager) app.getSystemService(Context.WIFI_SERVICE);
                    WifiInfo wi = wm != null ? wm.getConnectionInfo() : null;
                    if (wi != null) {
                        if (keys.contains("wifi_ssid")) {
                            String ssid = wi.getSSID();
                            if (ssid != null) {
                                if (ssid.length() >= 2 && ssid.startsWith("\"") && ssid.endsWith("\"")) {
                                    ssid = ssid.substring(1, ssid.length() - 1);
                                }
                                if (ssid.length() > 0 && !"<unknown ssid>".equalsIgnoreCase(ssid)) {
                                    s.put("wifi_ssid", new JSONObject().put("state", ssid));
                                }
                            }
                        }
                        if (keys.contains("bssid")) {
                            String bssid = wi.getBSSID();
                            if (bssid != null && bssid.length() > 0
                                    && !"02:00:00:00:00:00".equalsIgnoreCase(bssid)) {
                                s.put("bssid", new JSONObject().put("state", bssid));
                            }
                        }
                    }
                } catch (Exception ignored) {
                }
            }
        }

        // 屏幕状态：应用在前台 / 退后台（原生静态标记）
        if (keys.contains("screen_state")) {
            try {
                s.put("screen_state", new JSONObject().put("state", MainActivity.foreground ? "on" : "off"));
            } catch (Exception ignored) {
            }
        }

        // 环境光（缓存最近读数；监听刚注册尚无读数时跳过本轮）
        if (needLight) {
            try {
                if (lastLux >= 0) s.put("light_sensor", new JSONObject().put("state", Math.round(lastLux)));
            } catch (Exception ignored) {
            }
        }

        // 接近感应（真实硬件接近传感器）
        if (needProx) {
            try {
                if (proximityOn && lastProximity >= 0) {
                    float max = lastProximityMax > 0 ? lastProximityMax : 1f;
                    String state = lastProximity < max * 0.5f ? "near" : "far";
                    JSONObject attrs = new JSONObject()
                            .put("distance", round1(lastProximity))
                            .put("max_range", round1(max));
                    s.put("proximity", new JSONObject().put("state", state).put("attributes", attrs));
                }
            } catch (Exception ignored) {
            }
        }

        // 公网 IP
        if (keys.contains("public_ip")) {
            try {
                String ip = fetchPublicIp();
                if (nonEmpty(ip)) s.put("public_ip", new JSONObject().put("state", ip));
            } catch (Exception ignored) {
            }
        }

        // 时区
        if (keys.contains("current_time_zone")) {
            try {
                TimeZone tz = TimeZone.getDefault();
                String id = tz != null ? tz.getID() : "";
                if (nonEmpty(id)) {
                    double off = tz.getOffset(System.currentTimeMillis()) / 3600000.0;
                    s.put("current_time_zone", new JSONObject().put("state", id)
                            .put("attributes", new JSONObject().put("offset", off)));
                }
            } catch (Exception ignored) {
            }
        }

        // 本次触发原因
        if (keys.contains("last_update_trigger")) {
            try {
                s.put("last_update_trigger",
                        new JSONObject().put("state", nonEmpty(trigger) ? trigger : "periodic"));
            } catch (Exception ignored) {
            }
        }

        // 应用版本
        if (keys.contains("app_version")) {
            try {
                String v = app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName;
                if (nonEmpty(v)) s.put("app_version", new JSONObject().put("state", v));
            } catch (Exception ignored) {
            }
        }

        // 所在位置（卫星定位 + 系统 Geocoder 逆地理；无 fix 则不上报）
        if (keys.contains("geocoded_location")) {
            try {
                collectGeocodedLocation(app, p, s);
            } catch (Exception ignored) {
            }
        }

        return s;
    }

    // ---- 环境光 / 接近：懒注册（只在启用时才注册，禁用时注销）----
    private static synchronized void ensureSensorListeners(Context app, boolean needLight, boolean needProx) {
        SensorManager sm = sensorManager;
        if (sm == null) {
            sm = (SensorManager) app.getSystemService(Context.SENSOR_SERVICE);
            sensorManager = sm;
        }
        if (sm == null) return;
        Handler handler = new Handler(Looper.getMainLooper());

        if (needLight && !lightOn) {
            Sensor s = sm.getDefaultSensor(Sensor.TYPE_LIGHT);
            if (s != null) {
                lightSensor = s;
                sm.registerListener(lightListener, s, SensorManager.SENSOR_DELAY_NORMAL, handler);
                lightOn = true;
            }
        } else if (!needLight && lightOn) {
            try {
                sm.unregisterListener(lightListener, lightSensor);
            } catch (Exception ignored) {
            }
            lightOn = false;
            lightSensor = null;
            lastLux = -1f;
        }

        if (needProx && !proximityOn) {
            Sensor s = sm.getDefaultSensor(Sensor.TYPE_PROXIMITY);
            if (s != null) {
                proximitySensor = s;
                lastProximityMax = s.getMaximumRange();
                sm.registerListener(proximityListener, s, SensorManager.SENSOR_DELAY_NORMAL, handler);
                proximityOn = true;
            }
        } else if (!needProx && proximityOn) {
            try {
                sm.unregisterListener(proximityListener, proximitySensor);
            } catch (Exception ignored) {
            }
            proximityOn = false;
            proximitySensor = null;
            lastProximity = -1f;
        }
    }

    /** 蜂窝制式 → 5g/4g/3g/2g；无法判定返回 null（该项跳过，不占位）。 */
    private static String cellularQuality(Context app) {
        try {
            TelephonyManager tm = (TelephonyManager) app.getSystemService(Context.TELEPHONY_SERVICE);
            if (tm == null) return null;
            int nt = tm.getDataNetworkType();
            switch (nt) {
                case TelephonyManager.NETWORK_TYPE_NR:
                    return "5g";
                case TelephonyManager.NETWORK_TYPE_LTE:
                    return "4g";
                case TelephonyManager.NETWORK_TYPE_HSPAP:
                case TelephonyManager.NETWORK_TYPE_HSPA:
                case TelephonyManager.NETWORK_TYPE_HSDPA:
                case TelephonyManager.NETWORK_TYPE_HSUPA:
                case TelephonyManager.NETWORK_TYPE_UMTS:
                case TelephonyManager.NETWORK_TYPE_EVDO_0:
                case TelephonyManager.NETWORK_TYPE_EVDO_A:
                case TelephonyManager.NETWORK_TYPE_EVDO_B:
                case TelephonyManager.NETWORK_TYPE_EHRPD:
                case TelephonyManager.NETWORK_TYPE_TD_SCDMA:
                case TelephonyManager.NETWORK_TYPE_1xRTT:
                    return "3g";
                case TelephonyManager.NETWORK_TYPE_EDGE:
                case TelephonyManager.NETWORK_TYPE_GPRS:
                case TelephonyManager.NETWORK_TYPE_GSM:
                case TelephonyManager.NETWORK_TYPE_CDMA:
                case TelephonyManager.NETWORK_TYPE_IDEN:
                    return "2g";
                default:
                    return null;
            }
        } catch (Throwable e) {
            return null;
        }
    }

    /** 公网 IP：多源回退 + 5 分钟缓存；全部失败沿用旧缓存（可能为空 → 该项跳过）。 */
    private static String fetchPublicIp() {
        long now = System.currentTimeMillis();
        String cur = cachedIp;
        if (nonEmpty(cur) && now - cachedIpAt < IP_CACHE_MS) return cur;
        for (String url : IP_SOURCES) {
            String ip = httpGetIp(url);
            if (nonEmpty(ip)) {
                cachedIp = ip;
                cachedIpAt = now;
                return ip;
            }
        }
        return cur;
    }

    private static String httpGetIp(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return "";
            BufferedReader r = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            int n = 0;
            while ((line = r.readLine()) != null && n < 32) {
                sb.append(line);
                n++;
            }
            r.close();
            Matcher m = Pattern.compile("\\d{1,3}(\\.\\d{1,3}){3}").matcher(sb.toString());
            return m.find() ? m.group() : "";
        } catch (Exception e) {
            return "";
        } finally {
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored) {
                }
            }
        }
    }

    /**
     * 所在位置：仅用卫星定位（GPS_PROVIDER）——严禁用网络定位顶替，避免
     * 「地址与坐标不一致」；无有效 fix（缓存过期且单次请求超时）时不上报该项。
     * 逆地理走系统 Geocoder（国内 ROM 系统定位与系统地理编码同坐标系，免转换）。
     * 坐标未移动（约 3 位小数 ≈ 100m）时复用上次地址，减少逆地理请求。
     */
    private static void collectGeocodedLocation(Context app, SharedPreferences p, JSONObject out) throws Exception {
        if (ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_COARSE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        Location loc = currentGpsLocation(app);
        if (loc == null) return;
        double lat = loc.getLatitude();
        double lng = loc.getLongitude();
        double rlat = round3(lat);
        double rlng = round3(lng);

        String cached = p.getString(KEY_LAST_LOC, "");
        if (nonEmpty(cached)) {
            try {
                JSONObject c = new JSONObject(cached);
                String addr = c.optString("address", "");
                if (nonEmpty(addr)
                        && Math.abs(c.optDouble("lat", Double.NaN) - rlat) < 0.0005
                        && Math.abs(c.optDouble("lng", Double.NaN) - rlng) < 0.0005) {
                    out.put("geocoded_location", new JSONObject().put("state", addr)
                            .put("attributes", new JSONObject().put("latitude", lat).put("longitude", lng)));
                    return;
                }
            } catch (Exception ignored) {
            }
        }

        String addr = reverseGeocode(app, lat, lng);
        if (!nonEmpty(addr)) return;
        out.put("geocoded_location", new JSONObject().put("state", addr)
                .put("attributes", new JSONObject().put("latitude", lat).put("longitude", lng)));
        try {
            p.edit().putString(KEY_LAST_LOC, new JSONObject()
                    .put("lat", rlat).put("lng", rlng).put("address", addr).toString()).apply();
        } catch (Exception ignored) {
        }
    }

    /** 取当前卫星定位：优先持续监听缓存的新鲜 fix / 近 10 分钟 GPS 缓存，否则单次 fix（8s）。 */
    private static Location currentGpsLocation(Context app) {
        // 持续低频监听（追踪开启时）缓存的最新卫星 fix——深睡中这是最可靠的来源。
        Location live = latestFix;
        if (live != null && latestFixAt > 0
                && System.currentTimeMillis() - latestFixAt < 10 * 60 * 1000) {
            return live;
        }
        LocationManager lm = (LocationManager) app.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return null;
        Location best = null;
        long age = Long.MAX_VALUE;
        try {
            best = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (best != null) age = System.currentTimeMillis() - best.getTime();
        } catch (Throwable ignored) {
        }
        if (best != null && age >= 0 && age < 10 * 60 * 1000) return best;

        Location fresh = requestSingleGpsFix(lm, 8000);
        if (fresh != null) return fresh;
        if (best != null && age >= 0 && age < 10 * 60 * 1000) return best;
        return null; // 无有效 fix：不上报（避免上报过期/错位地址）
    }

    /**
     * 设备追踪专用取位：比 {@link #currentGpsLocation} 更保守。
     * 只接受 2 分钟内的新鲜缓存 fix（持续监听缓存 / getLastKnownLocation），
     * 否则单次 GPS 冷取（8s）；都失败则返回 null——宁可不报，也不用几分钟前的
     * 旧位置触发 HA zone「在家→离家」误翻转（旧状态保留，等下个新鲜 fix 再变更）。
     */
    private static Location currentTrackGpsLocation(Context app) {
        long now = System.currentTimeMillis();
        // 持续低频监听缓存的最新卫星 fix
        Location live = latestFix;
        if (live != null && latestFixAt > 0
                && now - latestFixAt < TRACK_CACHE_MAX_AGE_MS) {
            return live;
        }
        LocationManager lm = (LocationManager) app.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return null;
        Location best = null;
        long age = Long.MAX_VALUE;
        try {
            best = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (best != null) age = now - best.getTime();
        } catch (Throwable ignored) {
        }
        if (best != null && age >= 0 && age < TRACK_CACHE_MAX_AGE_MS) return best;

        Location fresh = requestSingleGpsFix(lm, 8000);
        if (fresh != null) return fresh;
        return null; // 无新鲜 fix：本次跳过，下一心跳 / 前台 GPS watch（约 2s 一个）会补报
    }

    /** fix 是否为 10s 内的新鲜卫星定位（elapsedRealtimeNanos 基准，不受墙钟跳变影响）。 */
    private static boolean isFreshGpsFix(Location loc) {
        if (loc == null) return false;
        try {
            long fixNanos = loc.getElapsedRealtimeNanos();
            if (fixNanos <= 0L) return false;
            long ageMs = (SystemClock.elapsedRealtimeNanos() - fixNanos) / 1_000_000L;
            return ageMs >= 0L && ageMs <= 10_000L;
        } catch (Throwable t) {
            long ageMs = System.currentTimeMillis() - loc.getTime();
            return ageMs >= 0L && ageMs <= 10_000L;
        }
    }

    private static Location requestSingleGpsFix(LocationManager lm, long timeoutMs) {
        final CountDownLatch latch = new CountDownLatch(1);
        final Location[] holder = new Location[1];
        LocationListener l = new LocationListener() {
            @Override
            public void onLocationChanged(Location loc) {
                // requestSingleUpdate 也可能在注册瞬间投递最后已知缓存 fix（时间戳很旧）。
                // 追踪链路绝不能把这种点当「新鲜冷取结果」——只接受 10s 内的真新 fix，
                // 超时仍无新鲜 fix 则返回 null（调用方宁可不报，等下个周期）。
                if (!isFreshGpsFix(loc)) return;
                holder[0] = loc;
                latch.countDown();
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {
            }

            @Override
            public void onProviderEnabled(String provider) {
            }

            @Override
            public void onProviderDisabled(String provider) {
            }
        };
        try {
            lm.requestSingleUpdate(LocationManager.GPS_PROVIDER, l, Looper.getMainLooper());
        } catch (Throwable e) {
            return null;
        }
        try {
            latch.await(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
        }
        try {
            lm.removeUpdates(l);
        } catch (Throwable ignored) {
        }
        return holder[0];
    }

    private static String reverseGeocode(Context app, double lat, double lng) {
        try {
            Geocoder geo = new Geocoder(app, Locale.CHINA);
            List<Address> list = geo.getFromLocation(lat, lng, 1);
            if (list != null && !list.isEmpty()) {
                Address a = list.get(0);
                String addr = a.getAddressLine(0);
                if (!nonEmpty(addr)) {
                    StringBuilder sb = new StringBuilder();
                    if (a.getAdminArea() != null) sb.append(a.getAdminArea());
                    if (a.getLocality() != null) sb.append(a.getLocality());
                    if (a.getSubLocality() != null) sb.append(a.getSubLocality());
                    if (a.getThoroughfare() != null) sb.append(a.getThoroughfare());
                    if (a.getFeatureName() != null) sb.append(a.getFeatureName());
                    addr = sb.toString();
                }
                return addr == null ? "" : addr;
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    /**
     * 设备追踪位置上报：经服务端 /api/v1/instances/{id}/location 转 HA 官方 mobile_app
     * 的 update_location webhook，HA 据此更新 device_tracker 并按 zone 计算在家/离家
     * （回家/离家自动化的触发源）。与 {@link #collectGeocodedLocation} 的区别：
     * 后者只把坐标作为传感器值上报，HA 不据其判定 zone。
     * 供后台保活心跳调用，不依赖 WebView 存活；失败静默返回 false，绝不抛出。
     *
     * 防抖动：device_tracker 只随「真实位置变化」更新——
     *  1. 取位只用 2 分钟内的新鲜 fix（{@link #currentTrackGpsLocation}），旧缓存直接跳过；
     *  2. 与上次成功推送坐标位移不足 50m 不重复推送（静止时心跳不再引发任何 zone 变化）；
     *  3. 即便位移超过 50m，若 fix 已超过 30s（非实时点）也先压住，等新鲜 fix 确认，
     *     防止 App 从后台恢复瞬间用过期/漂移点把「在家」打成「离家」后又跳回。
     */
    private static boolean reportDeviceLocation(Context ctx, String base, String token,
                                                String inst, String dev) {
        if (!nonEmpty(base) || !nonEmpty(token) || !nonEmpty(inst) || !nonEmpty(dev)) return false;
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        Location loc = currentTrackGpsLocation(ctx);
        if (loc == null) return false;
        final double lat = loc.getLatitude();
        final double lng = loc.getLongitude();
        if (lat == 0 && lng == 0) return false;

        SharedPreferences p = prefs(ctx);
        if (p.getBoolean(KEY_TRACK_HAS, false)) {
            float lastLat = p.getFloat(KEY_TRACK_LAT, 0f);
            float lastLng = p.getFloat(KEY_TRACK_LNG, 0f);
            double moved = haversineM(lastLat, lastLng, lat, lng);
            if (moved < TRACK_MOVE_M) return true; // 静止：跳过推送，HA 保持原状态
            long age = System.currentTimeMillis() - loc.getTime();
            if (age > TRACK_FRESH_MS) return false; // 移动但点位非实时：等下个新鲜 fix 确认
        }

        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put("device_id", dev);
            body.put("lat", lat);
            body.put("lng", lng);
            body.put("accuracy", (double) loc.getAccuracy());
            conn = (HttpURLConnection) new URL(
                    base + "/api/v1/instances/" + inst + "/location").openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            OutputStream os = conn.getOutputStream();
            os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            os.flush();
            os.close();
            int code = conn.getResponseCode();
            if (code == 401 || code == 403) {
                clearContext(ctx); // 会话失效：清上下文，等前端重新同步（防止死 token 无限重试）
                return false;
            }
            if (code >= 200 && code < 300) {
                // 记录成功推送基线：后续心跳据此做 50m 去抖
                p.edit().putFloat(KEY_TRACK_LAT, (float) lat)
                        .putFloat(KEY_TRACK_LNG, (float) lng)
                        .putBoolean(KEY_TRACK_HAS, true).apply();
                return true;
            }
            return false;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored) {
                }
            }
        }
    }

    /** Haversine 两坐标距离（米），供 device_tracker 移动去抖。 */
    private static double haversineM(double lat1, double lng1, double lat2, double lng2) {
        final double R = 6371000d;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * R * Math.asin(Math.sqrt(a));
    }

    // ==================== 小工具 ====================

    private static Set<String> parseKeys(String csv) {
        Set<String> set = new HashSet<>();
        if (csv == null) return set;
        for (String k : csv.split(",")) {
            String t = k.trim();
            if (t.length() > 0) set.add(t);
        }
        return set;
    }

    private static boolean nonEmpty(String s) {
        return s != null && s.trim().length() > 0;
    }

    private static String trim(String s) {
        return s == null ? "" : s.trim();
    }

    private static String safe(String s) {
        return s == null ? "" : s;
    }

    private static String msgOf(Exception e) {
        return e == null || e.getMessage() == null ? "error" : e.getMessage();
    }

    private static double round3(double v) {
        return Math.round(v * 1000.0) / 1000.0;
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}
