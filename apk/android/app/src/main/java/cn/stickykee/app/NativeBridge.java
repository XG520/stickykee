package cn.stickykee.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
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
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.AutomaticGainControl;
import android.media.audiofx.NoiseSuppressor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

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
    private TextToSpeech sysTts;
    // 系统 TTS 引擎可用标记：国产 ROM 默认引擎可能初始化失败或缺中文语音数据，
    // 此时 speak() 是静默无操作（用户只看到「没声音」），必须按失败上报前端换路线
    private volatile boolean sysTtsReady = false;
    private WebView webView;
    // 单线程线程池（newFixedThreadPool(1) 返回真实 ThreadPoolExecutor，
    // 以便 cancelTTS 时 clear 队列；newSingleThreadExecutor 的包装类不可取队列）
    private final ThreadPoolExecutor ttsPool = (ThreadPoolExecutor) Executors.newFixedThreadPool(1);
    // TTS 请求代次：cancelTTS() 自增，旧任务的合成结果按代次丢弃（切换引擎立即生效）
    private final AtomicInteger ttsGen = new AtomicInteger(0);

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
    }

    /** MainActivity 在注册桥后注入 WebView 引用，供异步 TTS 完成时回传 JS 事件。 */
    public void attachWebView(WebView wv) {
        this.webView = wv;
        activeBridge = this;
        scanWebView = new WeakReference<>(wv);
    }

    // 当前活跃桥：Activity 销毁时 release() 置空（供扩展的原生回调判定页面是否存活）
    private static volatile NativeBridge activeBridge;

    // 扫码回传用的 WebView 弱引用：BarcodeScannerActivity 独立于桥实例存活，
    // 用弱引用避免静态字段延长 WebView/Activity 生命周期造成内存泄漏。
    private static volatile WeakReference<WebView> scanWebView;

    /**
     * 后台 WebSocket 保活：由 KeepAliveService 每次心跳（默认 60s，主线程）调用。
     * WebView 退后台后 pauseTimers 冻结 JS 定时器，前端心跳/重连停摆，服务端
     * 90s 读超时后注销连接 → 对端通话显示离线。evaluateJavascript 的显式注入
     * 不受 pauseTimers 影响，由页面侧 window.__hcWsKeepalive 发应用层 ping
     * 或在连接已断时立即重建。桥/页面未就绪（壳页/未登录）时静默跳过。
     */
    static void keepaliveWebSocket() {
        final NativeBridge b = activeBridge;
        if (b == null) return;
        final WebView wv = b.webView;
        if (wv == null) return;
        try {
            wv.evaluateJavascript(
                    "(window.__hcWsKeepalive&&window.__hcWsKeepalive());", null);
        } catch (Exception ignored) {
        }
    }

    // ==================== 传感器上报间隔（后台心跳周期，前端可配） ====================
    // 前端设置页保存间隔时调用 setSensorInterval：落 SharedPreferences（跨进程持久），
    // 并重启保活服务传递新间隔（onStartCommand 按它重新排程心跳）。

    /** 设置传感器上报间隔（秒，10~3600）；同时通知保活服务重排心跳。 */
    @JavascriptInterface
    public void setSensorInterval(final int sec) {
        try {
            int v = Math.max(10, Math.min(3600, sec));
            activity.getApplicationContext()
                    .getSharedPreferences("stickykee", Context.MODE_PRIVATE)
                    .edit().putInt("sensor_interval", v).apply();
            ContextCompat.startForegroundService(activity,
                    new Intent(activity, KeepAliveService.class).putExtra("interval_sec", v));
        } catch (Exception ignored) {
        }
    }

    /** 读取传感器上报间隔（秒）；从未设置返回默认 60。 */
    @JavascriptInterface
    public int getSensorInterval() {
        try {
            return activity.getApplicationContext()
                    .getSharedPreferences("stickykee", Context.MODE_PRIVATE)
                    .getInt("sensor_interval", 60);
        } catch (Exception e) {
            return 60;
        }
    }

    // ==================== 传感器采集上下文（原生统一采集上报） ====================
    // 见 docs/传感器原生采集开发规范.md：APK 端传感器的采集与上报由原生
    // NativeSensorReporter 统一承担（前端只负责配置与展示）。前端在登录、实例切换、
    // 启用项变化、追踪开关变化时经 setSensorContext 写入采集上下文，原生据此采集
    // 启用项并在保活心跳中直连服务端上报——不依赖 WebView 存活。

    /** 能力版本号：前端据此判定原生侧支持「统一采集上报」（≥2 时启用原生模式）。 */
    @JavascriptInterface
    public int sensorApiVersion() {
        return 2;
    }

    /**
     * 写入采集上下文：服务器地址、Bearer token、实例ID、设备ID、设备名、启用项 CSV、追踪开关。
     * 写入后原生立即触发一次上报（开关变化即时生效）。壳页（localhost）不写由前端保障。
     */
    @JavascriptInterface
    public void setSensorContext(final String baseUrl, final String token, final String instanceId,
                                 final String deviceId, final String deviceName,
                                 final String enabledKeysCsv, final boolean tracking) {
        NativeSensorReporter.setContext(activity.getApplicationContext(), baseUrl, token,
                instanceId, deviceId, deviceName, enabledKeysCsv, tracking);
    }

    /** 登出/会话停止时清理采集上下文。 */
    @JavascriptInterface
    public void clearSensorContext() {
        NativeSensorReporter.clearContext(activity.getApplicationContext());
    }

    /** 手动即时上报：结果经 stickykee-sensors 事件回传 {req, ok, reported, error}。 */
    @JavascriptInterface
    public void reportSensorsNow(final String trigger, final String req) {
        try {
            NativeSensorReporter.reportNow(activity.getApplicationContext(), trigger,
                    new NativeSensorReporter.ReportCallback() {
                        @Override
                        public void onResult(boolean ok, int reported, String error) {
                            dispatchSensors(req, ok, reported, error);
                        }
                    });
        } catch (Exception ignored) {
        }
    }

    private static final int BG_LOC_CODE = 4102;

    /**
     * 申请后台定位权限：Android 11+ 需在系统设置里选「始终允许」，跳应用详情页引导；
     * Android 10 及以下与前台定位同一次运行时授权即可。授予后 geocoded_location 才能后台刷新。
     */
    @JavascriptInterface
    public void requestBackgroundLocation() {
        try {
            if (ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    == PackageManager.PERMISSION_GRANTED) {
                return;
            }
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + activity.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(i);
            } else {
                activity.runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            ActivityCompat.requestPermissions(activity,
                                    new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, BG_LOC_CODE);
                        } catch (Exception ignored) {
                        }
                    }
                });
            }
        } catch (Exception ignored) {
        }
    }

    /** 向 JS 派发传感器上报结果事件 stickykee-sensors。 */
    private void dispatchSensors(final String req, final boolean ok, final int reported, final String error) {
        final WebView wv = webView;
        if (wv == null) return;
        final String js = "window.dispatchEvent(new CustomEvent('stickykee-sensors',{detail:{"
                + "req:" + JSONObject.quote(req == null ? "" : req)
                + ",ok:" + ok
                + ",reported:" + reported
                + ",error:" + JSONObject.quote(error == null ? "" : error)
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
        final int gen = ttsGen.get();
        ttsPool.execute(new Runnable() {
            @Override
            public void run() {
                String b64 = "";
                try {
                    String r = edgeTTS.synth(text, voice);
                    b64 = r != null ? r : "";
                } catch (Exception ignored) {
                }
                if (gen == ttsGen.get()) dispatchTTS(req, b64, "audio/mpeg");
            }
        });
    }

    /**
     * 取消全部 TTS 任务：清空排队任务、递增代次使在途结果作废。
     * 切换引擎 / 停止朗读时由前端调用，保证新引擎立即生效。
     */
    @JavascriptInterface
    public void cancelTTS() {
        ttsGen.incrementAndGet();
        ttsPool.getQueue().clear();
    }

    /** 合成完成（或失败）后向 JS 派发结果事件；WebView 未就绪时静默丢弃。 */
    private void dispatchTTS(final String req, final String b64, final String mime) {
        dispatchTTS(req, b64, mime, 0, true);
    }

    /** 流式分片派发：seq 为分片序号（-1 表示结束标记），done=true 表示合成结束。 */
    private void dispatchTTS(final String req, final String b64, final String mime, final int seq, final boolean done) {
        final WebView wv = webView;
        if (wv == null) return;
        final String js = "window.dispatchEvent(new CustomEvent('stickykee-tts',{detail:{"
                + "req:" + JSONObject.quote(req == null ? "" : req)
                + ",ok:" + (b64 != null && !b64.isEmpty())
                + ",audio:" + JSONObject.quote(b64 == null ? "" : b64)
                + ",mime:" + JSONObject.quote(mime)
                + ",seq:" + seq
                + ",done:" + done
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
        speakSystem2(text, null);
    }

    /**
     * APK 系统 TTS（结果感知版）：初始化失败 / 缺中文语音数据 / 播报出错时，
     * 经 stickykee-tts 事件回 ok:false（req 配对），前端据此落到下一路线；
     * 旧版 speakSystem 在国产 ROM 默认引擎不可用时会静默无操作——
     * 用户听不到声音、看不到提示、切引擎也「没效果」，此接口即为此根因而加。
     * 成功路径在 onDone/onStop 后回 ok:true（播报被 stopSystem 打断也算已处理）。
     *
     * @param text 要朗读的文本
     * @param req  前端请求标识，配对 stickykee-tts 结果事件
     */
    @JavascriptInterface
    public void speakSystem2(final String text, final String req) {
        if (text == null || text.trim().isEmpty()) {
            dispatchTTS(req, "", "");
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (sysTts == null) {
                        sysTts = new TextToSpeech(activity.getApplicationContext(),
                                new TextToSpeech.OnInitListener() {
                                    @Override
                                    public void onInit(int status) {
                                        if (status != TextToSpeech.SUCCESS) {
                                            sysTtsReady = false;
                                            dispatchTTS(req, "", "");
                                            return;
                                        }
                                        setupSysTts(req, text);
                                    }
                                });
                    } else {
                        if (!sysTtsReady) {
                            dispatchTTS(req, "", "");
                            return;
                        }
                        setupSysTts(req, text);
                    }
                } catch (Exception e) {
                    sysTtsReady = false;
                    dispatchTTS(req, "", "");
                }
            }
        });
    }

    /** 系统 TTS 就绪后的语言检查 + 播报；结果经 UtteranceProgressListener 回传前端。 */
    private void setupSysTts(final String req, final String text) {
        try {
            int r = sysTts.setLanguage(Locale.CHINESE);
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                sysTtsReady = false;
                dispatchTTS(req, "", "");
                return;
            }
            sysTts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) { }
                @Override
                public void onDone(String utteranceId) {
                    dispatchTTS(utteranceId, "ok", "");
                }
                @Override
                public void onError(String utteranceId) {
                    sysTtsReady = false;
                    dispatchTTS(utteranceId, "", "");
                }
                @Override
                public void onError(String utteranceId, int errorCode) {
                    sysTtsReady = false;
                    dispatchTTS(utteranceId, "", "");
                }
                @Override
                public void onStop(String utteranceId, boolean interrupted) {
                    // stopSystem() 打断播报：对等待中的前端而言算「已处理」，立即解除等待
                    dispatchTTS(utteranceId, "ok", "");
                }
            });
            Bundle params = new Bundle();
            String uttId = req == null || req.isEmpty() ? "sys" + System.currentTimeMillis() : req;
            int q = sysTts.speak(text, TextToSpeech.QUEUE_FLUSH, params, uttId);
            if (q < 0) {
                sysTtsReady = false;
                dispatchTTS(req, "", "");
                return;
            }
            sysTtsReady = true;
            // 成功不在此处派发：等待 onDone/onStop/onError（前端 await 到结果为止）
        } catch (Exception e) {
            sysTtsReady = false;
            dispatchTTS(req, "", "");
        }
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

    // ==================== 服务器地址簿（跨源统一存储） ====================
    // 壳页(localhost 源)与远程页面(服务器源)不同源，localStorage 互不可见；
    // 地址簿经此桥落到 SharedPreferences，两端共用同一份数据，应用内增删改
    // 后冷启动壳页立即可见。JavascriptInterface 为同步调用，前端可当普通函数用。

    /** 读取地址簿 JSON（{addresses,activeId,lastConnectedId}）；无数据返回空串。 */
    @JavascriptInterface
    public String getServerConfig() {
        try {
            return activity.getApplicationContext()
                    .getSharedPreferences("stickykee", Context.MODE_PRIVATE)
                    .getString("server_config", "");
        } catch (Exception e) {
            return "";
        }
    }

    /** 写入地址簿 JSON；json 为空串时清除。 */
    @JavascriptInterface
    public void setServerConfig(final String json) {
        try {
            activity.getApplicationContext()
                    .getSharedPreferences("stickykee", Context.MODE_PRIVATE)
                    .edit()
                    .putString("server_config", json == null ? "" : json)
                    .apply();
        } catch (Exception ignored) {
        }
    }

    // ==================== 连接看门狗 ====================
    // 服务不可达（后端宕机/反代 502/断网）时自动退回壳页地址配置。
    // 壳页 go() 跳转服务器前调用 connWatch 启动；原生线程持续探测 /healthz，
    // 连续 2 次非 200（含连接异常）即 Toast 提示并 loadUrl 回壳页。
    // 注意：不能放在前端 JS 判断——502 错误页是网关返回的静态 HTML，前端脚本不会执行。
    // 生命周期：onPause 停看门狗（Doze 会掐断后台网络，探测必失败），
    // onResume 延迟 12 秒恢复（给移动数据/WS 重连足够时间从 Doze 恢复）。
    private final ScheduledExecutorService watchPool = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "conn-watch");
        t.setDaemon(true);
        return t;
    });
    private volatile String watchUrl = null;
    private volatile int watchFails = 0;
    private ScheduledFuture<?> watchFuture = null; // 当前运行中的定时任务，onPause 时 cancel

    /** 启动连接看门狗，base 为服务器根地址（如 http://192.168.1.10:8080）。重复调用会重置。 */
    @JavascriptInterface
    public void connWatch(final String base) {
        stopConnWatchInternal();
        if (base == null || base.isEmpty()) return;
        watchUrl = base.endsWith("/") ? base : base + "/";
        watchFails = 0;
        watchFuture = watchPool.scheduleWithFixedDelay(this::watchTick, 3, 4, TimeUnit.SECONDS);
    }

    /** 停止连接看门狗。 */
    @JavascriptInterface
    public void connWatchStop() {
        stopConnWatchInternal();
    }

    /** 生命周期：Activity 进入后台（onPause）时调用，停掉看门狗避免 Doze 网络掐断导致误判。 */
    public void onPause() {
        if (watchFuture != null) {
            watchFuture.cancel(false);
            watchFuture = null;
        }
        // watchUrl 保留：onResume 用它恢复看门狗
        watchFails = 0;
    }

    /** 生命周期：Activity 回到前台（onResume）时调用，延迟 12 秒恢复看门狗（给网络/WS 重连留时间）。 */
    public void onResume() {
        if (watchUrl == null) return;
        watchFails = 0;
        // 12 秒 grace：蜂窝数据从 Doze 恢复 + WS 重连 + 后端 ready 至少 8-10 秒
        watchFuture = watchPool.scheduleWithFixedDelay(this::watchTick, 12, 4, TimeUnit.SECONDS);
    }

    private void stopConnWatchInternal() {
        if (watchFuture != null) {
            watchFuture.cancel(false);
            watchFuture = null;
        }
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

    /** fix 是否为 10s 内的新鲜卫星定位（用 elapsedRealtimeNanos，不受墙钟跳变影响）。 */
    private static boolean isFreshGpsFix(Location loc) {
        return isFreshFix(loc, 10_000L);
    }

    /** fix 是否为 maxAgeMs 内的新鲜定位（网络定位更新频率低，闸门放宽到分钟级）。 */
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

    /** 接收运行时授权结果（由 MainActivity.onRequestPermissionsResult 转发），经 stickykee-gps 'perm' 事件回传。 */
    public void handlePermissionResult(int requestCode, String[] permissions, int[] grantResults) {
        boolean ok = false;
        if (requestCode == LOC_REQUEST_CODE && grantResults != null) {
            for (int r : grantResults) {
                if (r == PackageManager.PERMISSION_GRANTED) { ok = true; break; }
            }
        }
        dispatchGps("perm", ok, 0, 0, 0, ok ? "" : "denied");
    }

    /**
     * 单次卫星定位：只认 GPS_PROVIDER（卫星），只返回 10s 内的新鲜 fix；
     * 超时仍无新鲜 fix 则回 no_fix（前端按「暂无卫星信号」提示）。
     * 绝不用 getLastKnownLocation 缓存兜底——刚离家 2 分钟内缓存还是家坐标，
     * 返回它会把 device_tracker 先打成「在家」，等真 fix 到了再跳回「离家」。
     * 结果经 stickykee-gps 事件 {req,ok,lat,lng,acc,provider}。
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
            final Location[] best = { null };
            final Runnable[] finishRef = new Runnable[1];
            final boolean[] done = { false };
            final boolean[] gotFresh = { false };
            activity.runOnUiThread(() -> {
                final android.os.Handler handler = new android.os.Handler(activity.getMainLooper());
                final LocationListener listener = new LocationListener() {
                    @Override
                    public void onLocationChanged(Location loc) {
                        // requestLocationUpdates 注册成功后，系统可能立即投递一次「最后已知缓存位置」
                        // （getTime 是几十分钟前），冷启动时它会冒充新 fix：旧家坐标精度又高，
                        // 一旦采信就把 device_tracker 瞬间打成「在家」，等 GPS 冷搜星完成再跳「离家」。
                        // 故 listener 只采信 10s 内的新鲜卫星 fix，旧投递直接忽略继续等真 fix。
                        if (!isFreshGpsFix(loc)) return;
                        if (!gotFresh[0] || loc.getAccuracy() <= best[0].getAccuracy()) {
                            best[0] = loc;
                        }
                        gotFresh[0] = true;
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
                        // 卫星无 fix（室内常见）→ 网络定位兜底：官方 App 用融合定位，
                        // 室内可秒出点。此前这里直接回 no_fix，导致「在家打开 App 也不更新」。
                        networkOnce(req, lm, handler);
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

    /**
     * 网络定位兜底（Wi-Fi/基站）：卫星无 fix 时用，室内可立即出点。
     * 精度闸门 250m 以内的点才采信，避免粗点把「在家」误判为「离家」。
     */
    private void networkOnce(final String req, final LocationManager lm, final Handler handler) {
        final Location[] best = { null };
        final boolean[] done = { false };
        final Runnable[] finishRef = new Runnable[1];
        final LocationListener nl = new LocationListener() {
            @Override
            public void onLocationChanged(Location loc) {
                if (loc == null || !isFreshFix(loc, 120_000L)) return;
                if (loc.hasAccuracy() && loc.getAccuracy() > 250f) return;
                if (best[0] == null || loc.getAccuracy() < best[0].getAccuracy()) best[0] = loc;
                // 精度已到 Wi-Fi 级（≤100m）可提前结束
                if (best[0] != null && best[0].getAccuracy() <= 100f && finishRef[0] != null) {
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
            try { lm.removeUpdates(nl); } catch (Exception ignored) {}
            Location l = best[0];
            if (l != null) {
                dispatchGps(req, true, l.getLatitude(), l.getLongitude(),
                        l.getAccuracy(), "network");
            } else {
                dispatchGps(req, false, 0, 0, 0, "no_fix");
            }
        };
        try {
            lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 1000, 0, nl);
        } catch (SecurityException e) {
            dispatchGps(req, false, 0, 0, 0, "no_permission");
            return;
        } catch (Exception e) {
            dispatchGps(req, false, 0, 0, 0, "no_fix");
            return;
        }
        handler.postDelayed(finishRef[0], 5000);
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
                    // 同 gpsOnce：注册瞬间系统可能投递几十分钟前的缓存 fix，
                    // 旧坐标（如出门前的家坐标）进 watch 会立即把在家状态误翻一次。
                    if (!isFreshGpsFix(loc)) return;
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

    // ==================== 状态栏通知（IM 新消息） ====================
    // v2：旧渠道由历史版本创建，部分 ROM（MIUI）删除同 ID 渠道再重建会沿用旧的
    // 无声/无震动配置（渠道墓碑机制），导致「修复无声」不生效；升 ID 强制全新渠道，
    // 保证升级用户的消息通知恢复声音与震动
    private static final String NOTIF_CHANNEL_ID = "im_messages_v3";
    private static final int NOTIF_ID = 9001;
    private static final int NOTIF_PERM_CODE = 4301;

    // ==================== 前台保活服务 ====================

    /** 登录后启动前台保活服务：防后台冻结断连（消息通知/来电铃声依赖实时连接）。
     *  同时：① 主动申请通知权限（Android 13+ 消息/来电通知的前提，若等首条消息触发
     *  申请会丢掉该条通知）；② 请求电池优化豁免（SOS/微信级常驻）。
     *  用户拒绝后下次登录会再次引导。 */
    @JavascriptInterface
    public void startKeepAlive() {
        try {
            ContextCompat.startForegroundService(activity,
                    new Intent(activity, KeepAliveService.class));
        } catch (Exception ignored) {
        }
        try {
            PowerManager pm = (PowerManager) activity.getSystemService(Context.POWER_SERVICE);
            String pkg = activity.getPackageName();
            if (pm != null && !pm.isIgnoringBatteryOptimizations(pkg)) {
                activity.startActivity(new Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:" + pkg)));
            }
        } catch (Exception ignored) {
        }
        // 精确闹钟授权（Android 12+）：Doze 深睡下唤醒心跳的前提，未授权时熄屏久置
        // 仍会出现位置空白。安装时已声明 USE_EXACT_ALARM（13+ 通常即授予），
        // 走到这里说明被系统/用户关闭，引导到「闹钟与提醒」开关页。
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                AlarmManager am = (AlarmManager) activity.getSystemService(Context.ALARM_SERVICE);
                if (am != null && !am.canScheduleExactAlarms()) {
                    activity.startActivity(new Intent(
                            Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                            Uri.parse("package:" + activity.getPackageName())));
                }
            }
        } catch (Exception ignored) {
        }
        // 通知权限申请须在 UI 线程发起
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (android.os.Build.VERSION.SDK_INT >= 33
                            && ContextCompat.checkSelfPermission(activity.getApplicationContext(),
                                "android.permission.POST_NOTIFICATIONS")
                                != PackageManager.PERMISSION_GRANTED) {
                        ActivityCompat.requestPermissions(activity,
                                new String[]{"android.permission.POST_NOTIFICATIONS"}, NOTIF_PERM_CODE);
                    }
                } catch (Exception ignored) {
                }
            }
        });
    }

    /** 退出登录时停止保活服务。 */
    @JavascriptInterface
    public void stopKeepAlive() {
        try {
            activity.stopService(new Intent(activity, KeepAliveService.class));
        } catch (Exception ignored) {
        }
    }

    /** 弹出状态栏通知（旧接口，带声音震动）。点击通知拉应用到前台。Android 13+ 需先授权 POST_NOTIFICATIONS。 */
    @JavascriptInterface
    public void showNotification(final String title, final String body) {
        showNotification2(title, body, false);
    }

    /**
     * 弹出状态栏通知（可静默）。点击通知拉应用到前台。Android 13+ 需先授权 POST_NOTIFICATIONS。
     *
     * @param silent true = 消息免打扰：只显示在通知栏（IMPORTANCE_LOW，无横幅、无声、无震动）；
     *               false = 正常消息通知（系统通知音 + 震动）
     */
    @JavascriptInterface
    public void showNotification2(final String title, final String body, final boolean silent) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Context ctx = activity.getApplicationContext();
                    // Android 13+ 检查通知权限
                    if (android.os.Build.VERSION.SDK_INT >= 33) {
                        if (ContextCompat.checkSelfPermission(ctx, "android.permission.POST_NOTIFICATIONS")
                                != PackageManager.PERMISSION_GRANTED) {
                            // 未授权时先请求权限（通知本次不弹出，授权后后续生效）
                            ActivityCompat.requestPermissions(activity,
                                new String[]{"android.permission.POST_NOTIFICATIONS"}, NOTIF_PERM_CODE);
                            return;
                        }
                    }
                    NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                    if (nm == null) return;
                    final String chId;
                    // 创建通知渠道（Android 8+ 必需）。渠道创建后声音/震动不可改：
                    // 无声渠道删除重建一次（用户若自定义过会被重置，可接受）
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                        NotificationManager fNm = nm;
                        if (silent) {
                            // 免打扰渠道：低重要性——进通知栏不横幅、不响、不震
                            chId = NOTIF_CHANNEL_ID + "_dnd";
                            NotificationChannel dnd = fNm.getNotificationChannel(chId);
                            if (dnd == null) {
                                dnd = new NotificationChannel(chId, "消息通知（免打扰）",
                                    NotificationManager.IMPORTANCE_LOW);
                                dnd.setDescription("免打扰开启时新消息只显示不提醒");
                                dnd.setSound(null, null);
                                dnd.enableVibration(false);
                                fNm.createNotificationChannel(dnd);
                            }
                        } else {
                            chId = NOTIF_CHANNEL_ID;
                            AudioAttributes attrs = new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .build();
                            NotificationChannel ch = fNm.getNotificationChannel(chId);
                            if (ch == null) {
                                ch = new NotificationChannel(chId, "消息通知",
                                    NotificationManager.IMPORTANCE_HIGH);
                                ch.setDescription("收到新消息时通知");
                                ch.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, attrs);
                                ch.setVibrationPattern(new long[]{0, 350, 250, 350});
                                ch.enableVibration(true);
                                fNm.createNotificationChannel(ch);
                            } else {
                                // 渠道已存在但配置被系统/ROM/用户改坏：声音被关 或 重要性被降
                                // （IMPORTANCE_LOW 本身就是无声无横幅）。任一条件满足都删了重建。
                                boolean needRebuild = false;
                                if (ch.getSound() == null) needRebuild = true;
                                if (ch.getImportance() < NotificationManager.IMPORTANCE_HIGH) needRebuild = true;
                                if (!ch.shouldVibrate()) needRebuild = true;
                                if (needRebuild) {
                                    fNm.deleteNotificationChannel(chId);
                                    NotificationChannel fresh = new NotificationChannel(chId, "消息通知",
                                        NotificationManager.IMPORTANCE_HIGH);
                                    fresh.setDescription("收到新消息时通知");
                                    fresh.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, attrs);
                                    fresh.setVibrationPattern(new long[]{0, 350, 250, 350});
                                    fresh.enableVibration(true);
                                    fNm.createNotificationChannel(fresh);
                                }
                            }
                        }
                    } else {
                        chId = NOTIF_CHANNEL_ID; // Android 8 以下无渠道概念，setDefaults 走默认
                    }
                    // 点击通知拉应用到前台
                    Intent intent = new Intent(ctx, activity.getClass());
                    intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    PendingIntent pi = PendingIntent.getActivity(ctx, 0, intent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, chId)
                        .setSmallIcon(R.mipmap.ic_launcher)
                        .setContentTitle(title == null ? "新消息" : title)
                        .setContentText(body == null ? "" : body)
                        .setAutoCancel(true)
                        .setPriority(silent ? NotificationCompat.PRIORITY_LOW : NotificationCompat.PRIORITY_HIGH)
                        .setContentIntent(pi);
                    if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.O) {
                        // Android 8 以下：渠道不生效，直接在通知上指定声音/震动/静默
                        if (silent) {
                            b.setDefaults(0);
                        } else {
                            b.setDefaults(NotificationCompat.DEFAULT_ALL);
                        }
                    }
                    nm.notify(NOTIF_ID, b.build());
                } catch (Exception ignored) {
                }
            }
        });
    }

    // ==================== 来电通知（响铃期间状态栏常驻） ====================
    private static final int NOTIF_CALL_ID = 9002;
    private static final String PREFS_BRIDGE = "stickykee_bridge";

    /** 查询通知权限是否已授权（androidx 兼容全部版本，含 MIUI 独立通知开关）。 */
    @JavascriptInterface
    public boolean notifEnabled() {
        try {
            return NotificationManagerCompat.from(activity.getApplicationContext())
                    .areNotificationsEnabled();
        } catch (Exception e) {
            return false;
        }
    }

    /** 申请通知权限：首次弹系统授权框；再次调用仍未授权（用户已永久拒绝，系统不再弹）
     *  时自动跳应用详情页让用户手动开启。 */
    @JavascriptInterface
    public void requestNotifPermission() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (NotificationManagerCompat.from(activity.getApplicationContext())
                            .areNotificationsEnabled()) return;
                    String perm = "android.permission.POST_NOTIFICATIONS";
                    if (android.os.Build.VERSION.SDK_INT >= 33) {
                        boolean asked = activity.getSharedPreferences(PREFS_BRIDGE, Context.MODE_PRIVATE)
                                .getBoolean("notif_asked", false);
                        activity.getSharedPreferences(PREFS_BRIDGE, Context.MODE_PRIVATE)
                                .edit().putBoolean("notif_asked", true).apply();
                        if (!asked || ActivityCompat.shouldShowRequestPermissionRationale(activity, perm)) {
                            // 首次申请，或拒绝过一次（系统仍会弹框）
                            ActivityCompat.requestPermissions(activity, new String[]{perm}, NOTIF_PERM_CODE);
                        } else {
                            openAppDetailsInternal(); // 永久拒绝：系统不再弹，引导手动开启
                        }
                    } else {
                        // Android 13 以下无运行时通知权限（MIUI 有独立开关）：应用详情
                        openAppDetailsInternal();
                    }
                } catch (Exception ignored) {
                }
            }
        });
    }

    /** 打开系统应用详情页（MIUI 的自启动 / 通知 / 省电策略都在这里配置）。 */
    @JavascriptInterface
    public void openAppDetails() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                openAppDetailsInternal();
            }
        });
    }

    private void openAppDetailsInternal() {
        try {
            activity.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + activity.getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) {
        }
    }

    /** 来电状态栏通知：响铃期间常驻，点击拉应用回前台。
     *  提示音由铃声（playRing，铃声音量流）负责，通知渠道无声避免双重响铃。 */
    @JavascriptInterface
    public void callNotification(final String title, final String body) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Context ctx = activity.getApplicationContext();
                    if (android.os.Build.VERSION.SDK_INT >= 33
                            && ContextCompat.checkSelfPermission(ctx, "android.permission.POST_NOTIFICATIONS")
                                != PackageManager.PERMISSION_GRANTED) {
                        return; // 无权限静默（登录时已申请过）
                    }
                    NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                    if (nm == null) return;
                    String chId = "call_alert";
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                        NotificationChannel ch = nm.getNotificationChannel(chId);
                        if (ch == null) {
                            ch = new NotificationChannel(chId, "来电通知", NotificationManager.IMPORTANCE_HIGH);
                            ch.setDescription("来电时显示状态栏通知");
                            ch.setSound(null, null); // 声音走来电铃声，不重复
                            ch.enableVibration(false);
                            nm.createNotificationChannel(ch);
                        }
                    }
                    Intent intent = new Intent(ctx, activity.getClass());
                    intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    PendingIntent pi = PendingIntent.getActivity(ctx, 1, intent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, chId)
                        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                        .setContentTitle(title == null ? "来电" : title)
                        .setContentText(body == null ? "" : body)
                        .setOngoing(true)
                        .setPriority(NotificationCompat.PRIORITY_HIGH)
                        .setCategory(NotificationCompat.CATEGORY_CALL)
                        .setContentIntent(pi);
                    nm.notify(NOTIF_CALL_ID, b.build());
                } catch (Exception ignored) {
                }
            }
        });
    }

    /** 取消来电通知：接听/拒接/挂断/其他设备处理后由前端调用。 */
    @JavascriptInterface
    public void cancelCallNotification() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    NotificationManager nm = (NotificationManager) activity.getApplicationContext()
                            .getSystemService(Context.NOTIFICATION_SERVICE);
                    if (nm != null) nm.cancel(NOTIF_CALL_ID);
                } catch (Exception ignored) {
                }
            }
        });
    }

    // ==================== APK 应用内更新 ====================

    /**
     * 系统 Geocoder 逆地理：与官方 App 同源（国内 ROM 的系统定位与系统地理编码
     * 同一坐标系，传入设备原始坐标即可，前端无需做 WGS/GCJ 转换），且免高德 key。
     * 同步返回 JSON {ok, address}（JavascriptInterface 运行在 WebView 后台线程，可阻塞 IO）。
     */
    @JavascriptInterface
    public String geocode(double lat, double lng) {
        String addr = "";
        try {
            android.location.Geocoder geo = new android.location.Geocoder(
                    activity.getApplicationContext(), Locale.CHINA);
            java.util.List<android.location.Address> list = geo.getFromLocation(lat, lng, 1);
            if (list != null && !list.isEmpty()) {
                android.location.Address a = list.get(0);
                addr = a.getAddressLine(0);
                if (addr == null || addr.isEmpty()) {
                    StringBuilder sb = new StringBuilder();
                    if (a.getAdminArea() != null) sb.append(a.getAdminArea());
                    if (a.getLocality() != null) sb.append(a.getLocality());
                    if (a.getSubLocality() != null) sb.append(a.getSubLocality());
                    if (a.getThoroughfare() != null) sb.append(a.getThoroughfare());
                    if (a.getFeatureName() != null) sb.append(a.getFeatureName());
                    addr = sb.toString();
                }
            }
        } catch (Exception ignored) {
        }
        try {
            JSONObject o = new JSONObject();
            o.put("ok", addr != null && !addr.isEmpty());
            o.put("address", addr == null ? "" : addr);
            return o.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"address\":\"\"}";
        }
    }

    /** 返回当前 APK 版本名（build.gradle 的 versionName，如 "1.0.5"）。 */
    @JavascriptInterface
    public String getAppVersion() {
        try {
            return activity.getPackageManager()
                    .getPackageInfo(activity.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    /** 返回系统级设备标识 ANDROID_ID（Settings.Secure）。
     *  与应用签名+设备+用户绑定：卸载重装、清除应用数据后保持不变，
     *  前端用它作为 device_id，避免多次安装产生重复设备。取不到返回空串（前端回退 localStorage）。 */
    @JavascriptInterface
    public String deviceUid() {
        try {
            return android.provider.Settings.Secure.getString(
                    activity.getContentResolver(),
                    android.provider.Settings.Secure.ANDROID_ID);
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * 下载最新 APK 并自动拉起系统安装器。
     * 进度经 window 事件 stickykee-apk 回传：{req, phase:'progress'|'done'|'error', pct, path, message}。
     *
     * @param url   完整下载地址（location.origin + '/api/v1/app/download'）
     * @param token 登录令牌（下载接口需鉴权）
     * @param req   前端请求标识，事件回传用于配对
     */
    @JavascriptInterface
    public void downloadAndInstallApk(final String url, final String token, final String req) {
        final Context ctx = activity.getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                File dst = new File(ctx.getExternalFilesDir(null), "update" + File.separator + "update.apk");
                try {
                    dst.getParentFile().mkdirs();
                    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                    if (token != null && !token.isEmpty()) {
                        conn.setRequestProperty("Authorization", "Bearer " + token);
                    }
                    conn.setConnectTimeout(10000);
                    conn.setReadTimeout(30000);
                    int code = conn.getResponseCode();
                    if (code < 200 || code >= 300) {
                        dispatchApk(req, "error", 0, "服务端返回 " + code);
                        return;
                    }
                    long total = conn.getContentLength();
                    InputStream is = conn.getInputStream();
                    OutputStream os = new FileOutputStream(dst);
                    byte[] buf = new byte[8192];
                    long read = 0;
                    int n, lastPct = -1;
                    while ((n = is.read(buf)) > 0) {
                        os.write(buf, 0, n);
                        read += n;
                        if (total > 0) {
                            int pct = (int) (read * 100 / total);
                            if (pct != lastPct) {
                                lastPct = pct;
                                dispatchApk(req, "progress", pct, null);
                            }
                        }
                    }
                    os.close();
                    is.close();
                    dispatchApk(req, "done", 100, dst.getAbsolutePath());
                    installApkFile(ctx, dst); // 下载完成自动拉起系统安装器
                } catch (Exception e) {
                    dispatchApk(req, "error", 0, e.getMessage() == null ? "下载失败" : e.getMessage());
                }
            }
        }).start();
    }

    /** 向 JS 派发更新进度事件 stickykee-apk。 */
    private void dispatchApk(final String req, final String phase, final int pct, final String extra) {
        final WebView wv = webView;
        if (wv == null) return;
        final String js = "window.dispatchEvent(new CustomEvent('stickykee-apk',{detail:{"
                + "req:" + JSONObject.quote(req == null ? "" : req)
                + ",phase:" + JSONObject.quote(phase)
                + ",pct:" + pct
                + ",path:" + JSONObject.quote("done".equals(phase) && extra != null ? extra : "")
                + ",message:" + JSONObject.quote("error".equals(phase) && extra != null ? extra : "")
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

    /** 经 FileProvider 拉起系统安装器；未授权「安装未知应用」时引导到系统设置页。 */
    private void installApkFile(Context ctx, File apk) {
        try {
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
            Intent it = new Intent(Intent.ACTION_VIEW);
            it.setDataAndType(uri, "application/vnd.android.package-archive");
            it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(it);
        } catch (Exception e) {
            try {
                ctx.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + ctx.getPackageName()))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception ignored) {
            }
        }
    }

    // ==================== 通话铃声（铃声音量流 + 系统铃声选择器） ====================
    private MediaPlayer ringPlayer;
    private String pendingRingKind = ""; // 等待选择器结果的铃声类别（call | back）
    private static final int RING_PICK_CODE = 4401;

    /**
     * 循环播放通话铃声：走系统铃声音量流（USAGE_NOTIFICATION_RINGTONE），随铃声调节音量。
     * @param uri 铃声资源 URI；为空时用系统默认来电铃声
     */
    @JavascriptInterface
    public void playRing(final String uri, final boolean loop) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                stopRingInternal();
                try {
                    MediaPlayer mp = new MediaPlayer();
                    AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                    mp.setAudioAttributes(attrs);
                    String src = (uri == null || uri.trim().isEmpty())
                        ? Settings.System.DEFAULT_RINGTONE_URI.toString() : uri.trim();
                    mp.setDataSource(activity, Uri.parse(src));
                    mp.setLooping(loop);
                    mp.prepare();
                    mp.start();
                    ringPlayer = mp;
                } catch (Exception ignored) {
                    ringPlayer = null;
                }
            }
        });
    }

    /** 停止铃声播放。 */
    @JavascriptInterface
    public void stopRing() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() { stopRingInternal(); }
        });
    }

    private void stopRingInternal() {
        try {
            if (ringPlayer != null) {
                ringPlayer.stop();
                ringPlayer.release();
                ringPlayer = null;
            }
        } catch (Exception ignored) {
            ringPlayer = null;
        }
    }

    /** 拉起系统铃声选择器（来电铃声/彩铃共用）；结果经 stickykee-ring 事件 {kind,ok,uri,name} 回传。 */
    @JavascriptInterface
    public void pickRingtone(final String kind, final String currentUri) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Intent i = new Intent(RingtoneManager.ACTION_RINGTONE_PICKER);
                    i.putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_RINGTONE);
                    i.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true);
                    i.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, true);
                    if (currentUri != null && !currentUri.trim().isEmpty()) {
                        try {
                            i.putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI,
                                Uri.parse(currentUri.trim()));
                        } catch (Exception ignored) {
                        }
                    }
                    pendingRingKind = kind == null ? "" : kind;
                    activity.startActivityForResult(i, RING_PICK_CODE);
                } catch (Exception ignored) {
                }
            }
        });
    }

    /** 接收铃声选择器结果（由 MainActivity.onActivityResult 转发）。 */
    public void handleActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != RING_PICK_CODE) return;
        String kind = pendingRingKind;
        pendingRingKind = "";
        String uri = "";
        String name = "";
        boolean ok = resultCode == -1; // RESULT_OK：用户完成选择（含「无」=静音，uri 为空）；否则为取消
        if (ok && data != null) {
            Uri picked = data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI);
            if (picked != null) {
                uri = picked.toString();
                try {
                    Ringtone r = RingtoneManager.getRingtone(activity, picked);
                    if (r != null) {
                        name = r.getTitle(activity);
                        r.stop();
                    }
                } catch (Exception ignored) {
                }
            }
        }
        final boolean jsOk = ok;
        final String js = "window.dispatchEvent(new CustomEvent('stickykee-ring',{detail:{"
            + "kind:" + JSONObject.quote(kind)
            + ",ok:" + jsOk
            + ",uri:" + JSONObject.quote(uri)
            + ",name:" + JSONObject.quote(name)
            + "}}))";
        final WebView wv = webView;
        if (wv == null) return;
        wv.post(() -> wv.evaluateJavascript(js, null));
    }

    // ==================== 条码扫描（CameraX 预览 + ML Kit bundled） ====================

    /**
     * 拉起原生扫码页（全屏预览，识别到首个条码立即结束）。
     * 结果经 window 事件 stickykee-scan 回传：
     *   detail = {req, ok, value, format, message}
     * req 原样回传，供前端匹配请求；取消/权限拒绝/相机失败时 ok=false 并带 message。
     */
    @JavascriptInterface
    public void scanBarcode(final String req) {
        try {
            Intent intent = new Intent(activity, BarcodeScannerActivity.class);
            intent.putExtra(BarcodeScannerActivity.EXTRA_REQ, req == null ? "" : req);
            activity.startActivity(intent);
        } catch (Exception e) {
            deliverScan(req, false, "", "",
                    "无法启动扫码: " + (e.getMessage() == null ? "未知错误" : e.getMessage()));
        }
    }

    /** 扫码结果回传（BarcodeScannerActivity 调用）；WebView 已销毁时静默丢弃。 */
    static void deliverScan(final String req, final boolean ok, final String value,
                            final String format, final String message) {
        final WeakReference<WebView> ref = scanWebView;
        final WebView wv = ref == null ? null : ref.get();
        if (wv == null) return;
        final String js = "window.dispatchEvent(new CustomEvent('stickykee-scan',{detail:{"
                + "req:" + JSONObject.quote(req == null ? "" : req)
                + ",ok:" + ok
                + ",value:" + JSONObject.quote(value == null ? "" : value)
                + ",format:" + JSONObject.quote(format == null ? "" : format)
                + ",message:" + JSONObject.quote(message == null ? "" : message)
                + "}}))";
        wv.post(new Runnable() {
            @Override
            public void run() {
                try {
                    wv.evaluateJavascript(js, null);
                } catch (Exception ignored) {
                }
            }
        });
    }

    /** 支付通知自动记账：状态（是否支持 / 通知使用权 / 服务配置 / 待同步条数）。 */
    @JavascriptInterface
    public String autoFinanceStatus() {
        return FinanceAutoBridge.statusJson(activity);
    }

    /** 保存自动记账上报地址与登录令牌，并立即尝试同步积压通知。 */
    @JavascriptInterface
    public void configureAutoFinance(String baseUrl, String token) {
        FinanceAutoBridge.configure(activity, baseUrl, token);
        FinanceAutoBridge.flushAsync(activity);
    }

    /** 打开系统「通知使用权」设置页，引导用户开启微信 / 支付宝通知监听。 */
    @JavascriptInterface
    public void openNotificationAccessSettings() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    activity.startActivity(new Intent(
                            Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (Exception e) {
                    try {
                        activity.startActivity(new Intent(Settings.ACTION_SETTINGS)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    } catch (Exception ignored) {
                    }
                }
            }
        });
    }

    /** 立即上传待同步的支付通知。 */
    @JavascriptInterface
    public void flushAutoFinance() {
        FinanceAutoBridge.flushAsync(activity);
    }

    /** 退出登录时清空自动记账令牌与待同步队列。 */
    @JavascriptInterface
    public void resetAutoFinance() {
        FinanceAutoBridge.reset(activity);
    }

    /** 释放原生 TTS 资源 */
    public void release() {
        try {
            if (activeBridge == this) {
                activeBridge = null; // Activity 销毁：服务心跳不再注入
                scanWebView = null;
            }
            stopRingInternal();
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
            edgeTTS.shutdown();
        } catch (Exception ignored) {
        }
    }
}
