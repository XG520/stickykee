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
import android.util.Log;
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
    private static final String KEY_TRACK_AT = "sensor_track_at";   // 上次成功推送 device_tracker 的时间
    private static final String KEY_DRIVING = "sensor_driving";     // 行驶中滞回状态（上次判定结果）

    // ---- 今日行驶里程（trip_today）：GPS 位移累计，按日持久化，跨天清零 ----
    private static final String KEY_TRIP_KM = "trip_km";   // 当日累计公里
    private static final String KEY_TRIP_DAY = "trip_day"; // 累计所属日（yyyyMMdd，本地时区）
    private static final String KEY_TRIP_LAT = "trip_lat"; // 上次计入的基准点
    private static final String KEY_TRIP_LNG = "trip_lng";
    private static final String KEY_TRIP_AT = "trip_at";   // 上次计入的 fix 时间

    /** 汽车组传感器判定：启用任一项即启动 GPS 持续监听（车机高频档位）。 */
    private static boolean hasCarKeys(Set<String> keys) {
        return keys.contains("car_speed") || keys.contains("car_heading")
                || keys.contains("driving") || keys.contains("trip_today")
                || keys.contains("altitude") || keys.contains("gps_accuracy")
                || keys.contains("gps_satellites");
    }

    // ---- 汽车传感器（车机场景）：车速/行驶方向/行驶中，全部取自 GPS fix ----
    // 启用汽车传感器时定位监听提速到 10s（车机常供电，行车中需要及时刷新车速）；
    // 未启用时沿用全局上报间隔（60-300s）。fix 超过 2 分钟视为失效（停车熄火后不再上报）。
    private static final long CAR_LOC_INTERVAL_MS = 10_000L;
    private static final long CAR_FIX_MAX_AGE_MS = 2 * 60 * 1000L;
    private static final float DRIVING_ON_KMH = 5f;   // ≥5km/h 判行驶
    private static final float DRIVING_OFF_KMH = 2f;  // <2km/h 判停车（滞回防抖）

    // 设备追踪诊断日志（logcat 过滤 StickyTrack 即可看取位 provider/精度/推送结果）
    private static final String TAG_TRACK = "StickyTrack";

    // ---- device_tracker 防抖动（修复「后台恢复瞬间旧缓存位置把在家误判为离家、几秒后又跳回」）----
    // device_tracker 的状态只应随真实位置变化（与 geocoded_location 同一尺度），
    // 不能被心跳里几分钟前的缓存 fix / 室内漂移点带着反复横跳。
    private static final long TRACK_CACHE_MAX_AGE_MS = 2 * 60 * 1000L; // 追踪只信 2 分钟内的缓存 fix
    private static final long TRACK_FRESH_MS = 30 * 1000L;             // 卫星 fix 超过 30s 即视为非实时
    private static final float TRACK_MOVE_M = 50f;                     // 位移超过 50m 才重新推送（约 0.0005°）
    // 静止时也定期重推一次：HA 重启/集成重载后 device_tracker 可能停在旧状态（如「离家」），
    // 而坐标没变时此前的去抖逻辑永远不再推送 → 状态永久卡住。定期对齐可自愈。
    private static final long TRACK_RECONCILE_MS = 10 * 60 * 1000L;
    // 网络定位兜底（Wi-Fi/基站）：室内卫星常年拿不到 fix，只认卫星就等于「到家永远不更新」。
    // 官方 App 用融合定位，室内可秒出点；这里补同一条兜底，但用精度闸门限制粗点误判。
    // 注意：Android 的 NETWORK_PROVIDER 不是「公网 IP 定位」，而是系统定位服务基于
    // Wi-Fi 接入点/基站算出的点；按 Wi-Fi 级精度（≤100m）才采信，基站粗点直接丢弃。
    private static final float NET_ACC_MAX_M = 100f;                   // 网络定位精度差于 100m 不采信
    // 网络点可信性：最近 10 分钟内有过卫星/融合定位时，网络点偏离该锚点超过 300m 视为错误定位。
    // 常见成因：Wi-Fi/基站库把某个 AP 映射到几公里外的地址，但仍回报较好精度，HA 只按坐标
    // 算 zone（不看精度），于是一次错误网络点即可把「离家」翻成「在家」，下次 GPS 心跳再翻回来。
    private static final long GPS_ANCHOR_KEEP_MS = 10 * 60 * 1000L;
    private static final float NET_JUMP_MAX_M = 300f;

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
    private static volatile Location latestNetFix; // 网络/融合定位缓存（卫星无 fix 时兜底）
    private static volatile long latestNetFixAt = 0L;
    private static volatile Location lastGpsFix;   // 最近一次卫星/融合定位（网络点可信性锚点）
    private static volatile long lastGpsFixAt = 0L;
    private static volatile boolean locCarMode = false; // 当前监听的定位档位（汽车高频/常规）

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
            Set<String> keys = parseKeys(p.getString(KEY_KEYS, ""));
            boolean needGeo = keys.contains("geocoded_location");
            boolean needCar = hasCarKeys(keys);
            boolean perm = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED
                    || ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
            // 汽车档位变化（10s 高频 ↔ 常规间隔）：重启监听让新 interval 生效
            if (locTrackingOn && needCar != locCarMode) stopLocationTracking();
            if ((track || needGeo || needCar) && perm) {
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
        Set<String> keys = parseKeys(p.getString(KEY_KEYS, ""));
        boolean carMode = hasCarKeys(keys);
        long interval;
        if (carMode) {
            interval = CAR_LOC_INTERVAL_MS; // 车机场景常供电，行车中按 10s 刷新车速
        } else {
            try {
                interval = Math.max(LOC_MIN_INTERVAL_MS, Math.min(LOC_MAX_INTERVAL_MS,
                        p.getInt("sensor_interval", 60) * 1000L));
            } catch (Exception e) {
                interval = LOC_MIN_INTERVAL_MS;
            }
        }
        LocationListener l = new LocationListener() {
            @Override
            public void onLocationChanged(Location loc) {
                if (loc == null) return;
                // 高精度点（卫星 / 系统融合）：作为首选；融合定位可在室内出点，
                // 与 HA 官方 App 的 fused provider 一致（Android 12+ 才存在）。
                if (LocationManager.GPS_PROVIDER.equals(loc.getProvider())
                        || isFusedProvider(loc.getProvider())) {
                    // requestLocationUpdates 注册瞬间系统可能投递几十分钟前的缓存 fix。
                    // 一旦让它进 latestFix，latestFixAt 取的是「接收时刻」，后续 2 分钟
                    // 新鲜度检查全部失效——出门后冷启动时旧的家坐标会被当实时点推给
                    // device_tracker。只接受 fix 自身时间戳 30s 内的新鲜点。
                    if (!isFreshFix(loc, TRACK_FRESH_MS)) return;
                    Location prev = latestFix;
                    if (prev == null || loc.getTime() >= prev.getTime()) {
                        latestFix = loc;
                        latestFixAt = System.currentTimeMillis();
                    }
                    // 卫星/融合点作为网络点的可信性锚点（判断网络点是否跳飞）
                    lastGpsFix = loc;
                    lastGpsFixAt = System.currentTimeMillis();
                    return;
                }
                if (!isFreshFix(loc, TRACK_CACHE_MAX_AGE_MS)) return;
                if (!accuracyOk(loc)) return;
                if (!networkTrusted(loc)) return;
                Location prevNet = latestNetFix;
                if (prevNet == null || loc.getTime() >= prevNet.getTime()) {
                    latestNetFix = loc;
                    latestNetFixAt = System.currentTimeMillis();
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
            // 卫星定位：精度最高，优先。
            if (fine) {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, interval, 0f, l, looper);
                registered = true;
            }
            // 系统融合定位（Android 12+）：与 HA 官方 App 同一通道，室内也能出点。
            if (fine || coarse) {
                try {
                    if (lm.getAllProviders().contains("fused")) {
                        lm.requestLocationUpdates("fused", interval, 0f, l, looper);
                        registered = true;
                    }
                } catch (Throwable ignored) {
                    // 部分机型/无 GMS 环境没有 fused provider，忽略
                }
            }
            // 网络定位（Wi-Fi/基站）：室内卫星没有 fix 时唯一能及时出点的高频通道。
            // 不是公网 IP 定位；精度由 accuracyOk 闸门限制（>100m 的基站粗点不采信）。
            if (fine || coarse) {
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,
                        Math.max(60_000L, interval), 0f, l, looper);
                registered = true;
            }
            // PASSIVE：搭车其他 App/系统的定位结果（近乎零耗电），粗定位权限也可收。
            if (fine || coarse) {
                lm.requestLocationUpdates(LocationManager.PASSIVE_PROVIDER,
                        Math.max(30_000L, interval), 0f, l, looper);
                registered = true;
            }
        } catch (Exception e) {
            // 单个 provider 注册失败不影响已成功的通道（registered 保持原值）
        }
        if (!registered) {
            t.quit();
            return;
        }
        locThread = t;
        locHandler = new Handler(looper);
        locManager = lm;
        locListener = l;
        locCarMode = carMode;
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
        latestNetFix = null;
        latestNetFixAt = 0L;
        locCarMode = false;
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

        // 汽车传感器（车机）：车速 / 行驶方向 / 行驶中，取自持续监听的最新 GPS/融合 fix。
        // fix 超过 2 分钟（熄火停车后 GPS 停发）视为失效，本轮整组跳过。
        boolean needCar = hasCarKeys(keys);
        if (needCar) {
            try {
                Location fix = latestFix;
                if (fix == null || System.currentTimeMillis() - fix.getTime() > CAR_FIX_MAX_AGE_MS) {
                    fix = null;
                }
                if (fix != null) {
                    float speedKmh = fix.hasSpeed() ? fix.getSpeed() * 3.6f : 0f;
                    if (speedKmh < 0f) speedKmh = 0f;

                    if (keys.contains("car_speed")) {
                        JSONObject attrs = new JSONObject();
                        if (fix.hasAccuracy()) attrs.put("accuracy", Math.round(fix.getAccuracy()));
                        s.put("car_speed", new JSONObject()
                                .put("state", round1(speedKmh))
                                .put("attributes", attrs));
                    }

                    if (keys.contains("car_heading") && fix.hasBearing()) {
                        float b = fix.getBearing();
                        s.put("car_heading", new JSONObject()
                                .put("state", Math.round(b))
                                .put("attributes", new JSONObject().put("direction", headingName(b))));
                    }

                    if (keys.contains("driving")) {
                        // 滞回防抖：≥5km/h 判行驶，<2km/h 判停车，区间保持上次状态
                        boolean prev = p.getBoolean(KEY_DRIVING, false);
                        boolean on = speedKmh >= DRIVING_ON_KMH || (speedKmh >= DRIVING_OFF_KMH && prev);
                        if (on != prev) p.edit().putBoolean(KEY_DRIVING, on).apply();
                        s.put("driving", new JSONObject()
                                .put("state", on ? "on" : "off")
                                .put("attributes", new JSONObject().put("speed_kmh", round1(speedKmh))));
                    }

                    // 今日行驶里程：相邻 fix 位移累计，跨天清零；仅采纳精度≤50m 且间隔≤30s 的点，
                    // 单次跳变 >2km（GPS 漂移/重启）不计入，基准点持久化防重启丢里程。
                    if (keys.contains("trip_today")) {
                        String today = new java.text.SimpleDateFormat("yyyyMMdd", java.util.Locale.US)
                                .format(new java.util.Date());
                        float km = p.getFloat(KEY_TRIP_KM, 0f);
                        if (!today.equals(p.getString(KEY_TRIP_DAY, ""))) km = 0f; // 跨天清零
                        long lastAt = p.getLong(KEY_TRIP_AT, 0L);
                        float lastLat = p.getFloat(KEY_TRIP_LAT, 999f);
                        float lastLng = p.getFloat(KEY_TRIP_LNG, 999f);
                        boolean accOk = fix.hasAccuracy() && fix.getAccuracy() <= 50f;
                        if (accOk) {
                            if (lastAt > 0 && lastLat != 999f
                                    && fix.getTime() - lastAt > 0 && fix.getTime() - lastAt <= 30_000L) {
                                float[] d = new float[1];
                                Location.distanceBetween(lastLat, lastLng,
                                        fix.getLatitude(), fix.getLongitude(), d);
                                if (d[0] > 2f && d[0] < 2000f) km += d[0] / 1000f;
                            }
                            p.edit().putFloat(KEY_TRIP_KM, km).putString(KEY_TRIP_DAY, today)
                                    .putFloat(KEY_TRIP_LAT, (float) fix.getLatitude())
                                    .putFloat(KEY_TRIP_LNG, (float) fix.getLongitude())
                                    .putLong(KEY_TRIP_AT, fix.getTime()).apply();
                        }
                        s.put("trip_today", new JSONObject()
                                .put("state", round2(km))
                                .put("attributes", new JSONObject().put("date", today)));
                    }

                    if (keys.contains("altitude") && fix.hasAltitude()) {
                        s.put("altitude", new JSONObject().put("state", Math.round(fix.getAltitude())));
                    }

                    if (keys.contains("gps_accuracy") && fix.hasAccuracy()) {
                        s.put("gps_accuracy", new JSONObject().put("state", round1(fix.getAccuracy())));
                    }

                    if (keys.contains("gps_satellites")) {
                        int sat = -1;
                        if (fix.getExtras() != null) sat = fix.getExtras().getInt("satellites", -1);
                        if (sat >= 0) s.put("gps_satellites", new JSONObject().put("state", sat));
                    }
                }
            } catch (Exception ignored) {
            }
        }

        return s;
    }

    /** 方位角 → 中文八方位（北/东北/东/…），供 car_heading 属性。 */
    private static String headingName(float bearing) {
        String[] names = {"北", "东北", "东", "东南", "南", "西南", "西", "西北"};
        int idx = (int) Math.floor(((bearing % 360f) + 22.5f) / 45f) % 8;
        if (idx < 0) idx = 0;
        return names[idx];
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

        Location fresh = requestSingleFix(lm, LocationManager.GPS_PROVIDER, 8000, 10_000L, 0f);
        if (fresh != null) return fresh;
        if (best != null && age >= 0 && age < 10 * 60 * 1000) return best;
        return null; // 无有效 fix：不上报（避免上报过期/错位地址）
    }

    /**
     * 设备追踪取位：卫星优先，室内无卫星 fix 时回退网络定位——这是「到家后 device_tracker
     * 不更新、打开 App 也不变、只有官方 App 才更新」的根因修复。
     * 官方 App 用系统融合定位（Wi-Fi/基站参与），室内可秒出点；此前本实现只认
     * GPS_PROVIDER，室内永远拿不到 fix，等于永远不上报。
     *
     * 取位顺序：
     *  1. 持续监听缓存的高精度点（卫星/融合，2 分钟内，精度最高）
     *  2. 系统最后已知卫星/融合点（2 分钟内）
     *  3. 卫星单次冷取（8s，室外有效）
     *  4. 网络定位缓存 / 最后已知 / 单次取（5s，精度 ≤100m 才采信；基站粗点直接丢弃）
     * 全部失败返回 null——宁可不报也不拿几分钟前的旧点误翻 zone。
     */
    private static Location currentTrackLocation(Context app) {
        long now = System.currentTimeMillis();
        // 1) 持续低频监听缓存的最新高精度点
        Location live = latestFix;
        if (live != null && latestFixAt > 0
                && now - latestFixAt < TRACK_CACHE_MAX_AGE_MS) {
            return live;
        }
        LocationManager lm = (LocationManager) app.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return null;

        // 2) 系统最后已知卫星 / 融合点
        Location gps = lastKnownFresh(lm, LocationManager.GPS_PROVIDER, TRACK_CACHE_MAX_AGE_MS, 0f);
        if (gps != null) return gps;
        Location fusedKnown = lastKnownFresh(lm, FUSED_PROVIDER, TRACK_CACHE_MAX_AGE_MS, 0f);
        if (fusedKnown != null) return fusedKnown;

        // 3) 卫星单次冷取
        Location fresh = requestSingleFix(lm, LocationManager.GPS_PROVIDER,
                8000, TRACK_FRESH_MS, 0f);
        if (fresh != null) return fresh;
        if (supportsFused(lm)) {
            Location fused = requestSingleFix(lm, FUSED_PROVIDER,
                    6000, TRACK_FRESH_MS, 0f);
            if (fused != null) return fused;
        }

        // 4) 网络定位兜底（室内唯一可用的即时通道；Wi-Fi 级精度才采信）
        Location netLive = latestNetFix;
        if (netLive != null && latestNetFixAt > 0
                && now - latestNetFixAt < TRACK_CACHE_MAX_AGE_MS
                && accuracyOk(netLive) && networkTrusted(netLive)) {
            return netLive;
        }
        Location net = lastKnownFresh(lm, LocationManager.NETWORK_PROVIDER,
                TRACK_CACHE_MAX_AGE_MS, NET_ACC_MAX_M);
        if (net != null && networkTrusted(net)) return net;
        Location netSingle = requestSingleFix(lm, LocationManager.NETWORK_PROVIDER,
                5000, TRACK_CACHE_MAX_AGE_MS, NET_ACC_MAX_M);
        return (netSingle != null && networkTrusted(netSingle)) ? netSingle : null;
    }

    /**
     * 网络点可信性校验：最近 {@link #GPS_ANCHOR_KEEP_MS} 内有卫星/融合定位时，
     * 网络点偏离该锚点超过 {@link #NET_JUMP_MAX_M} 视为错误定位（Wi-Fi/基站库把 AP
     * 映射到远处地址仍回报较好精度），丢弃本周期，宁可不报也不跳飞。
     */
    private static boolean networkTrusted(Location net) {
        Location g = lastGpsFix;
        long at = lastGpsFixAt;
        long now = System.currentTimeMillis();
        if (g == null || at <= 0 || now - at > GPS_ANCHOR_KEEP_MS) return true;
        double d = haversineM(g.getLatitude(), g.getLongitude(), net.getLatitude(), net.getLongitude());
        if (d <= NET_JUMP_MAX_M) return true;
        Log.d(TAG_TRACK, "net fix " + Math.round(d) + "m from last gps, reject");
        return false;
    }

    /** Android 12+ 的系统融合 provider（部分机型/无 GMS 环境不存在）。 */
    private static final String FUSED_PROVIDER = "fused";

    private static boolean isFusedProvider(String provider) {
        return FUSED_PROVIDER.equals(provider);
    }

    private static boolean supportsFused(LocationManager lm) {
        try {
            return lm.getAllProviders().contains(FUSED_PROVIDER);
        } catch (Throwable ignored) {
            return false;
        }
    }

    /** 精度闸门：无精度字段时放行，有精度则须优于 NET_ACC_MAX_M。 */
    private static boolean accuracyOk(Location loc) {
        if (loc == null) return false;
        return !loc.hasAccuracy() || loc.getAccuracy() <= NET_ACC_MAX_M;
    }

    /** 取系统最后已知位置，并按「自身时间戳新鲜度 + 精度」过滤。 */
    private static Location lastKnownFresh(LocationManager lm, String provider,
                                           long maxAgeMs, float maxAcc) {
        try {
            Location l = lm.getLastKnownLocation(provider);
            if (l == null) return null;
            long age = System.currentTimeMillis() - l.getTime();
            if (age < 0 || age >= maxAgeMs) return null;
            if (maxAcc > 0 && l.hasAccuracy() && l.getAccuracy() > maxAcc) return null;
            return l;
        } catch (Throwable ignored) {
            return null;
        }
    }

    /** fix 是否为 maxAgeMs 内的新鲜定位（elapsedRealtimeNanos 基准，不受墙钟跳变影响）。 */
    private static boolean isFreshFix(Location loc, long maxAgeMs) {
        if (loc == null) return false;
        try {
            long fixNanos = loc.getElapsedRealtimeNanos();
            if (fixNanos > 0L) {
                long ageMs = (SystemClock.elapsedRealtimeNanos() - fixNanos) / 1_000_000L;
                return ageMs >= 0L && ageMs <= maxAgeMs;
            }
        } catch (Throwable ignored) {
        }
        long ageMs = System.currentTimeMillis() - loc.getTime();
        return ageMs >= 0L && ageMs <= maxAgeMs;
    }

    /** 单次定位（指定 provider）。只接受 freshMs 内的新鲜 fix，超时返回 null。 */
    private static Location requestSingleFix(LocationManager lm, String provider,
                                            long timeoutMs, long freshMs, float maxAcc) {
        final CountDownLatch latch = new CountDownLatch(1);
        final Location[] holder = new Location[1];
        LocationListener l = new LocationListener() {
            @Override
            public void onLocationChanged(Location loc) {
                // requestSingleUpdate 也可能在注册瞬间投递最后已知缓存 fix（时间戳很旧）。
                // 追踪链路绝不能把这种点当「新鲜冷取结果」——超时仍无新鲜 fix 则返回 null。
                if (!isFreshFix(loc, freshMs)) return;
                if (maxAcc > 0 && loc.hasAccuracy() && loc.getAccuracy() > maxAcc) return;
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
            lm.requestSingleUpdate(provider, l, Looper.getMainLooper());
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
     *  1. 取位只用新鲜点位（卫星 2 分钟内，网络 2 分钟内且精度 ≤250m），旧缓存直接跳过；
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
        Location loc = currentTrackLocation(ctx);
        if (loc == null) {
            Log.d(TAG_TRACK, "no fresh fix, skip tracker push");
            return false;
        }
        final double lat = loc.getLatitude();
        final double lng = loc.getLongitude();
        if (lat == 0 && lng == 0) return false;

        SharedPreferences p = prefs(ctx);
        long now = System.currentTimeMillis();
        long lastAt = p.getLong(KEY_TRACK_AT, 0L);
        if (p.getBoolean(KEY_TRACK_HAS, false)) {
            float lastLat = p.getFloat(KEY_TRACK_LAT, 0f);
            float lastLng = p.getFloat(KEY_TRACK_LNG, 0f);
            double moved = haversineM(lastLat, lastLng, lat, lng);
            // 静止时也定期重推（HA 重启/重载后状态可能停在旧值，靠重推自愈）
            boolean reconcile = now - lastAt >= TRACK_RECONCILE_MS;
            if (moved < TRACK_MOVE_M && !reconcile) {
                Log.d(TAG_TRACK, "stationary " + Math.round(moved) + "m, skip");
                return true;
            }
            // 移动了但点位非实时：高精度点要求 30s 内，网络点放宽到 2 分钟（更新频率低）
            long freshLimit = LocationManager.GPS_PROVIDER.equals(loc.getProvider())
                    || isFusedProvider(loc.getProvider())
                    ? TRACK_FRESH_MS : TRACK_CACHE_MAX_AGE_MS;
            long age = System.currentTimeMillis() - loc.getTime();
            if (moved >= TRACK_MOVE_M && age > freshLimit) {
                Log.d(TAG_TRACK, "stale fix age=" + age + "ms, wait next");
                return false;
            }
            Log.d(TAG_TRACK, "push moved=" + Math.round(moved) + "m reconcile=" + reconcile
                    + " provider=" + loc.getProvider() + " acc=" + Math.round(loc.getAccuracy()));
        } else {
            Log.d(TAG_TRACK, "first push provider=" + loc.getProvider()
                    + " acc=" + Math.round(loc.getAccuracy()));
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
                Log.d(TAG_TRACK, "push auth failed code=" + code);
                clearContext(ctx); // 会话失效：清上下文，等前端重新同步（防止死 token 无限重试）
                return false;
            }
            if (code >= 200 && code < 300) {
                // 记录成功推送基线与时间：后续心跳据此做 50m 去抖 + 定期重推对齐
                p.edit().putFloat(KEY_TRACK_LAT, (float) lat)
                        .putFloat(KEY_TRACK_LNG, (float) lng)
                        .putBoolean(KEY_TRACK_HAS, true)
                        .putLong(KEY_TRACK_AT, System.currentTimeMillis()).apply();
                Log.d(TAG_TRACK, "push ok code=" + code + " lat=" + lat + " lng=" + lng);
                return true;
            }
            Log.d(TAG_TRACK, "push failed code=" + code);
            return false;
        } catch (Exception e) {
            Log.d(TAG_TRACK, "push error " + e);
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

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
