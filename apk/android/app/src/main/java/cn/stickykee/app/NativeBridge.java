package cn.stickykee.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.AutomaticGainControl;
import android.media.audiofx.NoiseSuppressor;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.util.Base64;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 极简原生桥：通过 WebView.addJavascriptInterface 注册为 window.StickyKeeNative。
 * JavascriptInterface 对 WebView 中【任意源】（含 allowNavigation 远程页面）可用，
 * 不依赖 Capacitor 的 JS 运行时（其桥 JS 仅注入壳页 localhost 源）。
 *
 * 前端调用示例：
 *   window.StickyKeeNative.setBars('#0E0F12', false)
 *   window.StickyKeeNative.speakEdge('你好', 'zh-CN-XiaoxiaoNeural')  // 同步返回 base64 MP3（旧）
 *   window.StickyKeeNative.speakEdge2('你好', 'zh-CN-XiaoxiaoNeural', req) // 异步，结果经
 *     window 事件 stickykee-tts 回传 {req, ok, audio, mime}（新前端用此接口，合成在后台线程，
 *     不阻塞 WebView JS 线程——旧同步接口合成期间会冻结整页 1~30 秒）
 */
public class NativeBridge {

    private final AppCompatActivity activity;
    private final EdgeTTS edgeTTS;
    private final LocalTTS localTTS;
    private TextToSpeech sysTts;
    private WebView webView;
    private final ExecutorService ttsPool = Executors.newSingleThreadExecutor();

    // ---- 原生录音（http 非安全上下文下 WebView 不暴露 navigator.mediaDevices，
    //      getUserMedia/WebRTC 均不可用，语音消息与助手识别经此原生兜底）----
    private AudioRecord audioRecord;
    private Thread recThread;
    private final AtomicBoolean recActive = new AtomicBoolean(false);
    private final ByteArrayOutputStream recBuf = new ByteArrayOutputStream();
    private int recSampleRate = 16000;
    private static final int REC_REQUEST_CODE = 4101;

    // 环境光传感器（http WebView 下 JS Generic Sensor API 不可用，由原生兜底）
    private SensorManager sensorManager;
    private Sensor lightSensor;
    private SensorEventListener lightListener;
    private volatile float lastLux = -1f;
    private boolean lightRunning;

    public NativeBridge(AppCompatActivity activity) {
        this.activity = activity;
        this.edgeTTS = new EdgeTTS();
        this.localTTS = new LocalTTS(activity.getApplicationContext());
    }

    /** MainActivity 在注册桥后注入 WebView 引用，供异步 TTS 完成时回传 JS 事件。 */
    public void attachWebView(WebView wv) {
        this.webView = wv;
    }

    private int parseHex(String s) {
        try {
            String h = s == null ? "" : s.trim();
            if (h.startsWith("#")) h = h.substring(1);
            if (h.length() == 3) {
                StringBuilder sb = new StringBuilder("#");
                for (int i = 0; i < 3; i++) {
                    char c = h.charAt(i);
                    sb.append(c).append(c);
                }
                return Color.parseColor(sb.toString());
            }
            return Color.parseColor("#" + h);
        } catch (Exception e) {
            return Color.rgb(14, 15, 18);
        }
    }

    @JavascriptInterface
    public void setBars(final String hex, final boolean darkIcons) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    int color = parseHex(hex);
                    Window w = activity.getWindow();
                    w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
                    w.clearFlags(
                        WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                        | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION
                    );
                    w.setStatusBarColor(color);
                    w.setNavigationBarColor(color);
                    WindowInsetsControllerCompat c =
                        WindowCompat.getInsetsController(w, w.getDecorView());
                    c.setAppearanceLightStatusBars(darkIcons);
                    c.setAppearanceLightNavigationBars(darkIcons);
                } catch (Exception ignored) {
                }
            }
        });
    }

    /**
     * APK 原生 Edge TTS：直接调用微软免费在线语音合成，不依赖后端服务。
     * 返回 Base64 编码的 MP3 音频字符串；失败返回空串。
     *
     * 前端用法：
     *   const b64 = window.StickyKeeNative.speakEdge(text, voice)
     *   if (b64) { const audio = new Audio('data:audio/mpeg;base64,' + b64); audio.play() }
     *
     * @param text  要合成的文本
     * @param voice 微软音色名（如 zh-CN-XiaoxiaoNeural），为空默认晓晓
     */
    @JavascriptInterface
    public String speakEdge(String text, String voice) {
        try {
            String b64 = edgeTTS.synth(text, voice);
            return b64 != null ? b64 : "";
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * APK 本地离线 TTS：使用内置 MeloTTS 中文模型在设备本地推理，完全无需网络。
     * 返回 Base64 编码的 WAV 音频字符串；失败返回空串。
     *
     * 前端用法：
     *   const b64 = window.StickyKeeNative.speakLocal('你好', 1.0)
     *   if (b64) { const audio = new Audio('data:audio/wav;base64,' + b64); audio.play() }
     *
     * @param text  要合成的文本
     * @param speed 语速（1.0 = 正常，范围建议 0.5~2.0）
     */
    @JavascriptInterface
    public String speakLocal(String text, float speed) {
        try {
            String b64 = localTTS.synth(text, speed > 0 ? speed : 1.0f);
            return b64 != null ? b64 : "";
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * APK 原生 Edge TTS（异步版）：后台线程合成，立即返回不阻塞 JS 线程。
     * 完成后派发 window 事件 stickykee-tts：{req, ok, audio(base64|''), mime}。
     * 与旧同步 speakEdge 并存：旧前端继续用同步版，新前端按 speakEdge2 是否存在选择。
     *
     * @param text  要合成的文本
     * @param voice 微软音色名（如 zh-CN-XiaoxiaoNeural），为空默认晓晓
     * @param req   前端生成的请求标识，原样回传用于配对
     */
    @JavascriptInterface
    public void speakEdge2(final String text, final String voice, final String req) {
        ttsPool.execute(new Runnable() {
            @Override
            public void run() {
                String b64 = "";
                try {
                    String r = edgeTTS.synth(text, voice);
                    b64 = r != null ? r : "";
                } catch (Exception ignored) {
                }
                dispatchTTS(req, b64, "audio/mpeg");
            }
        });
    }

    /**
     * APK 本地离线 TTS（异步版）：后台线程用 MeloTTS 推理，立即返回不阻塞 JS 线程。
     * 事件协议同 speakEdge2，mime 为 audio/wav。
     *
     * @param text  要合成的文本
     * @param speed 语速（1.0 = 正常，范围建议 0.5~2.0）
     * @param req   前端生成的请求标识，原样回传用于配对
     */
    @JavascriptInterface
    public void speakLocal2(final String text, final float speed, final String req) {
        ttsPool.execute(new Runnable() {
            @Override
            public void run() {
                String b64 = "";
                try {
                    String r = localTTS.synth(text, speed > 0 ? speed : 1.0f);
                    b64 = r != null ? r : "";
                } catch (Exception ignored) {
                }
                dispatchTTS(req, b64, "audio/wav");
            }
        });
    }

    /** 合成完成（或失败）后向 JS 派发结果事件；WebView 未就绪时静默丢弃。 */
    private void dispatchTTS(final String req, final String b64, final String mime) {
        final WebView wv = webView;
        if (wv == null) return;
        final String js = "window.dispatchEvent(new CustomEvent('stickykee-tts',{detail:{"
                + "req:" + JSONObject.quote(req == null ? "" : req)
                + ",ok:" + (b64 != null && !b64.isEmpty())
                + ",audio:" + JSONObject.quote(b64 == null ? "" : b64)
                + ",mime:" + JSONObject.quote(mime)
                + "}}))";
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    wv.evaluateJavascript(js, null);
                } catch (Exception ignored) {
                }
            }
        });
    }

    /**
     * APK 系统 TTS（离线回退）：使用 Android 系统已安装的 TTS 引擎朗读。
     * 异步播放，不返回音频数据。适合 Edge TTS 不可用时的兜底。
     *
     * @param text 要朗读的文本
     */
    @JavascriptInterface
    public void speakSystem(final String text) {
        if (text == null || text.trim().isEmpty()) return;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (sysTts == null) {
                        sysTts = new TextToSpeech(activity.getApplicationContext(),
                                new TextToSpeech.OnInitListener() {
                                    @Override
                                    public void onInit(int status) {
                                        if (status == TextToSpeech.SUCCESS) {
                                            sysTts.setLanguage(Locale.CHINESE);
                                            HashMap<String, String> params = new HashMap<>();
                                            sysTts.speak(text, TextToSpeech.QUEUE_FLUSH, params);
                                        }
                                    }
                                });
                    } else {
                        sysTts.setLanguage(Locale.CHINESE);
                        HashMap<String, String> params = new HashMap<>();
                        sysTts.speak(text, TextToSpeech.QUEUE_FLUSH, params);
                    }
                } catch (Exception ignored) {
                }
            }
        });
    }

    /** 停止系统 TTS 朗读 */
    @JavascriptInterface
    public void stopSystem() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (sysTts != null) sysTts.stop();
                } catch (Exception ignored) {
                }
            }
        });
    }

    /** 返回支持的中文音色 JSON 字符串（供前端展示选择） */
    @JavascriptInterface
    public String edgeVoices() {
        try {
            Map<String, String> voices = EdgeTTS.voices();
            StringBuilder sb = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<String, String> e : voices.entrySet()) {
                if (!first) sb.append(",");
                first = false;
                sb.append("\"").append(e.getKey()).append("\":\"")
                        .append(e.getValue().replace("\"", "\\\"")).append("\"");
            }
            sb.append("}");
            return sb.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    // ================= 原生录音 =================

    /**
     * 开始原生录音：16kHz 单声道 16-bit PCM 采集，立即返回状态字符串。
     * 返回 "ok" 成功；"no_permission" 缺麦克风权限（已自动发起系统授权弹窗，授权后重试）；
     * "busy" 上一段录音未结束；"error:..." 初始化失败。
     */
    @JavascriptInterface
    public String startRec() {
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    ActivityCompat.requestPermissions(activity,
                            new String[]{Manifest.permission.RECORD_AUDIO}, REC_REQUEST_CODE);
                }
            });
            return "no_permission";
        }
        if (recActive.get()) return "busy";
        final int sr = 16000;
        int minBuf = AudioRecord.getMinBufferSize(sr, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT);
        if (minBuf <= 0) return "error:minBufferSize " + minBuf;
        try {
            // VOICE_COMMUNICATION 音源：平台自动启用回声消除(AEC)+降噪(NS)，
            // 外放时录音不再啸叫/杂音（MIC 音源无任何处理，杂音明显）
            audioRecord = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, sr,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                    Math.max(minBuf * 4, 8192));
            // 显式挂载 AEC/NS/AGC（部分机型音源不自动启用，可用则启用）
            int sid = audioRecord.getAudioSessionId();
            if (sid != 0) {
                try { if (AcousticEchoCanceler.isAvailable()) AcousticEchoCanceler.create(sid); } catch (Exception ignored) {}
                try { if (NoiseSuppressor.isAvailable()) NoiseSuppressor.create(sid); } catch (Exception ignored) {}
                try { if (AutomaticGainControl.isAvailable()) AutomaticGainControl.create(sid); } catch (Exception ignored) {}
            }
            audioRecord.startRecording();
        } catch (Exception e) {
            try { if (audioRecord != null) audioRecord.release(); } catch (Exception ignored) {}
            audioRecord = null;
            return "error:" + e.getMessage();
        }
        synchronized (recBuf) { recBuf.reset(); }
        recSampleRate = sr;
        recActive.set(true);
        recThread = new Thread(new Runnable() {
            @Override
            public void run() { captureLoop(); }
        });
        recThread.start();
        return "ok";
    }

    /** 采集循环：把 PCM 写入缓冲，直到 recActive 置 false。 */
    private void captureLoop() {
        final short[] buf = new short[1600]; // 100ms @16kHz
        while (recActive.get()) {
            int n = audioRecord == null ? -1 : audioRecord.read(buf, 0, buf.length);
            if (n > 0) {
                synchronized (recBuf) {
                    for (int i = 0; i < n; i++) {
                        recBuf.write(buf[i] & 0xff);
                        recBuf.write((buf[i] >> 8) & 0xff);
                    }
                }
            }
        }
    }

    /**
     * 结束录音并返回 Base64 编码的 WAV（16kHz 单声道 16-bit）；无数据返回空串。
     * 编码毫秒级完成，可同步返回。
     */
    @JavascriptInterface
    public String stopRec() {
        byte[] pcm = endCapture();
        if (pcm.length == 0) return "";
        return Base64.encodeToString(wavWrap(pcm, recSampleRate), Base64.NO_WRAP);
    }

    /** 中途取消：丢弃已采集数据。 */
    @JavascriptInterface
    public void cancelRec() {
        endCapture();
    }

    /** 停止采集并释放，返回已累积的 PCM 字节。 */
    private byte[] endCapture() {
        recActive.set(false);
        Thread t = recThread;
        if (t != null) {
            try { t.join(1000); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
            recThread = null;
        }
        try { if (audioRecord != null) { audioRecord.stop(); audioRecord.release(); } } catch (Exception ignored) {}
        audioRecord = null;
        byte[] pcm;
        synchronized (recBuf) {
            pcm = recBuf.toByteArray();
            recBuf.reset();
        }
        return pcm;
    }

    /** 裸 PCM 加 44 字节 WAV 头（单声道 16-bit）。 */
    private static byte[] wavWrap(byte[] pcm, int sampleRate) {
        int total = pcm.length;
        byte[] out = new byte[44 + total];
        out[0] = 'R'; out[1] = 'I'; out[2] = 'F'; out[3] = 'F';
        putIntLE(out, 4, 36 + total);
        out[8] = 'W'; out[9] = 'A'; out[10] = 'V'; out[11] = 'E';
        out[12] = 'f'; out[13] = 'm'; out[14] = 't'; out[15] = ' ';
        putIntLE(out, 16, 16);
        putShortLE(out, 20, (short) 1);            // PCM
        putShortLE(out, 22, (short) 1);            // 单声道
        putIntLE(out, 24, sampleRate);
        putIntLE(out, 28, sampleRate * 2);
        putShortLE(out, 32, (short) 2);
        putShortLE(out, 34, (short) 16);
        out[36] = 'd'; out[37] = 'a'; out[38] = 't'; out[39] = 'a';
        putIntLE(out, 40, total);
        System.arraycopy(pcm, 0, out, 44, total);
        return out;
    }

    private static void putIntLE(byte[] b, int off, int v) {
        b[off] = (byte) v; b[off + 1] = (byte) (v >> 8);
        b[off + 2] = (byte) (v >> 16); b[off + 3] = (byte) (v >> 24);
    }

    private static void putShortLE(byte[] b, int off, short v) {
        b[off] = (byte) v; b[off + 1] = (byte) (v >> 8);
    }

    // ==================== 环境光传感器与屏幕常亮 ====================
    // http 非安全上下文下 WebView 不暴露 AmbientLightSensor / WakeLock API，这里用原生能力兜底，
    // JS 侧通过 hasLightSensor/startLight/stopLight/lightLux 与 stickykee-light 事件消费。

    /** 设备是否具备环境光传感器。 */
    @JavascriptInterface
    public boolean hasLightSensor() {
        try {
            SensorManager sm = (SensorManager) activity.getApplicationContext()
                    .getSystemService(Context.SENSOR_SERVICE);
            return sm != null && sm.getDefaultSensor(Sensor.TYPE_LIGHT) != null;
        } catch (Exception e) {
            return false;
        }
    }

    /** 开始监听环境光：读数变化即向 JS 派发 stickykee-light 事件 {lux}。重复调用幂等。 */
    @JavascriptInterface
    public synchronized boolean startLight() {
        if (lightRunning) return true;
        try {
            SensorManager sm = (SensorManager) activity.getApplicationContext()
                    .getSystemService(Context.SENSOR_SERVICE);
            Sensor s = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_LIGHT);
            if (s == null) return false;
            sensorManager = sm;
            lightSensor = s;
            lightListener = new SensorEventListener() {
                @Override
                public void onSensorChanged(SensorEvent event) {
                    if (event == null || event.values == null || event.values.length == 0) return;
                    lastLux = event.values[0];
                    dispatchLight(lastLux);
                }

                @Override
                public void onAccuracyChanged(Sensor sensor, int accuracy) {
                }
            };
            sm.registerListener(lightListener, s, SensorManager.SENSOR_DELAY_UI);
            lightRunning = true;
            return true;
        } catch (Exception e) {
            lightRunning = false;
            return false;
        }
    }

    /** 停止监听环境光。 */
    @JavascriptInterface
    public synchronized void stopLight() {
        if (!lightRunning) return;
        try {
            if (sensorManager != null && lightListener != null) {
                sensorManager.unregisterListener(lightListener);
            }
        } catch (Exception ignored) {
        }
        lightListener = null;
        lightSensor = null;
        lightRunning = false;
    }

    /** 最近一次环境光读数（lux）；从未读到返回 -1。 */
    @JavascriptInterface
    public double lightLux() {
        return lastLux;
    }

    private void dispatchLight(final float lux) {
        final WebView wv = webView;
        if (wv == null) return;
        final String js = "window.dispatchEvent(new CustomEvent('stickykee-light',{detail:{lux:" + lux + "}}))";
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    wv.evaluateJavascript(js, null);
                } catch (Exception ignored) {
                }
            }
        });
    }

    /** 屏幕常亮开关（接近自动亮屏等场景；http 下 Web WakeLock 不可用，用 FLAG_KEEP_SCREEN_ON 兜底）。 */
    @JavascriptInterface
    public void keepScreenOn(final boolean on) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Window w = activity.getWindow();
                    if (on) w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else w.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } catch (Exception ignored) {
                }
            }
        });
    }

    // ==================== 连接看门狗 ====================
    // 服务不可达（后端宕机/反代 502/断网）时自动退回壳页地址配置。
    // 壳页 go() 跳转服务器前调用 connWatch 启动；原生线程持续探测 /healthz，
    // 连续 2 次非 200（含连接异常）即 Toast 提示并 loadUrl 回壳页。
    // 注意：不能放在前端 JS 判断——502 错误页是网关返回的静态 HTML，前端脚本不会执行。
    private final ScheduledExecutorService watchPool = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "conn-watch");
        t.setDaemon(true);
        return t;
    });
    private volatile String watchUrl = null;
    private volatile int watchFails = 0;

    /** 启动连接看门狗，base 为服务器根地址（如 http://192.168.1.10:8080）。重复调用会重置。 */
    @JavascriptInterface
    public void connWatch(final String base) {
        stopConnWatchInternal();
        if (base == null || base.isEmpty()) return;
        watchUrl = base.endsWith("/") ? base : base + "/";
        watchFails = 0;
        watchPool.scheduleWithFixedDelay(this::watchTick, 3, 4, TimeUnit.SECONDS);
    }

    /** 停止连接看门狗。 */
    @JavascriptInterface
    public void connWatchStop() {
        stopConnWatchInternal();
    }

    private void stopConnWatchInternal() {
        watchUrl = null;
        watchFails = 0;
    }

    private void watchTick() {
        final String base = watchUrl;
        if (base == null) return;
        int status = httpStatus(base + "healthz", 3000);
        if (status == 200) {
            watchFails = 0;
            return;
        }
        watchFails++;
        if (watchFails < 2) return; // 容忍单次抖动（后端重启/WiFi 切换）
        stopConnWatchInternal();
        bounceToShell();
    }

    /** 原生 HTTP 状态码探测；连接异常返回 -1。 */
    private int httpStatus(String urlStr, int timeoutMs) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestProperty("Connection", "close");
            return conn.getResponseCode();
        } catch (Exception e) {
            return -1;
        } finally {
            if (conn != null) {
                try { conn.disconnect(); } catch (Exception ignored) {
                }
            }
        }
    }

    /** 回退壳页（http://localhost/）：已在该页则静默停止，否则 Toast 提示并跳转。 */
    private void bounceToShell() {
        activity.runOnUiThread(() -> {
            try {
                WebView wv = webView;
                if (wv == null) return;
                String cur = wv.getUrl();
                if (cur != null && cur.startsWith("http://localhost")) return; // 已在壳页
                try {
                    Toast.makeText(activity, "无法连接服务器，已返回地址配置", Toast.LENGTH_LONG).show();
                } catch (Exception ignored) {
                }
                // 带 #connfail 标记回壳页：壳页 boot 识别后只展示地址列表、
                // 不再自动跳回故障服务器，避免 壳页↔502 页 整页重载循环（画面闪烁）
                wv.loadUrl("http://localhost/#connfail");
            } catch (Exception ignored) {
            }
        });
    }

    // ================= 原生 GPS/北斗定位 =================
    // WebView 的 navigator.geolocation 在 Android 上默认走 FUSED 网络混合定位（WiFi/基站，
    // 精度几十米）。这里直连 LocationManager 的 GPS_PROVIDER——国产手机的卫星通道
    // 自动包含北斗/GLONASS/Galileo 等星座，实现真正的卫星定位。
    private LocationManager locationManager;
    private LocationListener gpsListener;
    private boolean gpsWatching;

    private LocationManager locMgr() {
        if (locationManager == null) {
            locationManager = (LocationManager) activity.getSystemService(Context.LOCATION_SERVICE);
        }
        return locationManager;
    }

    private boolean hasLocPermission() {
        return ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    /** 原生卫星定位是否可用（有权限且有 GPS 硬件）。 */
    @JavascriptInterface
    public boolean hasGps() {
        try {
            boolean hw = activity.getPackageManager()
                    .hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS);
            return hasLocPermission() && hw;
        } catch (Exception e) {
            return false;
        }
    }

    /** 发起系统定位授权（配合 hasGps()==false 时前端调用；授权结果经 stickykee-gps 事件回传）。 */
    @JavascriptInterface
    public void requestGpsPermission() {
        if (hasLocPermission()) {
            dispatchGps("perm", true, 0, 0, 0, "");
            return;
        }
        activity.runOnUiThread(() -> ActivityCompat.requestPermissions(activity,
                new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION},
                LOC_REQUEST_CODE));
    }

    private static final int LOC_REQUEST_CODE = 4201;

    /**
     * 单次卫星定位：优先 GPS_PROVIDER（卫星），超时后回传最后一次定位；
     * 无 fix 时回传 lastKnownLocation。结果经 stickykee-gps 事件 {req,ok,lat,lng,acc,provider}。
     * @param timeoutMs 等待卫星 fix 的上限（建议 10000~30000）
     */
    @JavascriptInterface
    public void gpsOnce(final String req, final int timeoutMs) {
        if (!hasLocPermission()) {
            dispatchGps(req, false, 0, 0, 0, "no_permission");
            return;
        }
        final LocationManager lm = locMgr();
        try {
            // 先取缓存定位，卫星超时也能有结果
            Location last = null;
            for (String p : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
                try {
                    Location l = lm.getLastKnownLocation(p);
                    if (l != null && (last == null || l.getTime() > last.getTime())) last = l;
                } catch (SecurityException ignored) {
                }
            }
            final Location[] best = { last };
            final Runnable[] finishRef = new Runnable[1];
            final boolean[] done = { false };
            activity.runOnUiThread(() -> {
                final android.os.Handler handler = new android.os.Handler(activity.getMainLooper());
                final LocationListener listener = new LocationListener() {
                    @Override
                    public void onLocationChanged(Location loc) {
                        if (loc != null && (best[0] == null || loc.getAccuracy() <= best[0].getAccuracy())) {
                            best[0] = loc;
                        }
                        // 精度已达卫星级（≤15m）可提前结束
                        if (best[0] != null && best[0].getAccuracy() <= 15 && finishRef[0] != null) {
                            finishRef[0].run();
                        }
                    }
                    @Override public void onStatusChanged(String p, int s, Bundle e) {}
                    @Override public void onProviderEnabled(String p) {}
                    @Override public void onProviderDisabled(String p) {}
                };
                finishRef[0] = () -> {
                    if (done[0]) return;
                    done[0] = true;
                    try { lm.removeUpdates(listener); } catch (Exception ignored) {}
                    Location l = best[0];
                    if (l != null) {
                        dispatchGps(req, true, l.getLatitude(), l.getLongitude(),
                                l.getAccuracy(), l.getProvider());
                    } else {
                        dispatchGps(req, false, 0, 0, 0, "no_fix");
                    }
                };
                try {
                    lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, listener);
                } catch (SecurityException e) {
                    dispatchGps(req, false, 0, 0, 0, "no_permission");
                    return;
                }
                handler.postDelayed(finishRef[0], Math.max(3000, Math.min(timeoutMs, 60000)));
            });
        } catch (Exception e) {
            dispatchGps(req, false, 0, 0, 0, "error");
        }
    }

    /** 启动连续卫星监听：每次定位经 stickykee-gps 事件 {req:'watch',ok,lat,lng,acc,provider}。 */
    @JavascriptInterface
    public void startGpsWatch() {
        if (!hasLocPermission() || gpsWatching) return;
        try {
            gpsListener = new LocationListener() {
                @Override
                public void onLocationChanged(Location loc) {
                    if (loc == null) return;
                    dispatchGps("watch", true, loc.getLatitude(), loc.getLongitude(),
                            loc.getAccuracy(), loc.getProvider());
                }
                @Override public void onStatusChanged(String p, int s, Bundle e) {}
                @Override public void onProviderEnabled(String p) {}
                @Override public void onProviderDisabled(String p) {}
            };
            locMgr().requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000, 5, gpsListener);
            gpsWatching = true;
        } catch (SecurityException ignored) {
            gpsListener = null;
        }
    }

    /** 停止连续卫星监听。 */
    @JavascriptInterface
    public void stopGpsWatch() {
        if (!gpsWatching) return;
        gpsWatching = false;
        try {
            if (gpsListener != null) locMgr().removeUpdates(gpsListener);
        } catch (Exception ignored) {
        }
    }

    /** 派发定位结果事件；WebView 未就绪时静默丢弃。 */
    private void dispatchGps(final String req, final boolean ok, final double lat,
                             final double lng, final float acc, final String provider) {
        final WebView wv = webView;
        if (wv == null) return;
        final String js = "window.dispatchEvent(new CustomEvent('stickykee-gps',{detail:{"
                + "req:" + JSONObject.quote(req == null ? "" : req)
                + ",ok:" + ok
                + ",lat:" + lat
                + ",lng:" + lng
                + ",acc:" + acc
                + ",provider:" + JSONObject.quote(provider == null ? "" : provider)
                + "}}))";
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    wv.evaluateJavascript(js, null);
                } catch (Exception ignored) {
                }
            }
        });
    }

    /** 释放原生 TTS 资源 */
    public void release() {
        try {
            stopGpsWatch();
            stopConnWatchInternal();
            stopLight();
            recActive.set(false);
            if (audioRecord != null) {
                audioRecord.stop();
                audioRecord.release();
                audioRecord = null;
            }
            if (sysTts != null) {
                sysTts.stop();
                sysTts.shutdown();
            }
            ttsPool.shutdownNow();
            localTTS.release();
            edgeTTS.shutdown();
        } catch (Exception ignored) {
        }
    }
}
