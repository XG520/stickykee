package cn.stickykee.app;

import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/**
 * APK 原生 Edge TTS 客户端：直接调用微软免费在线语音合成（无需后端、无需 Key）。
 *
 * 协议与后端 server/internal/tts/edge.go 一致：
 *   WebSocket 连接 speech.platform.bing.com → 发 speech.config → 发 SSML → 收二进制音频帧
 *
 * 音质与 Azure TTS 一致（晓晓/云希等），接近豆包等商用语音。
 * 通过 NativeBridge.speakEdge() 暴露给前端。
 */
public class EdgeTTS {

    private static final String TAG = "EdgeTTS";
    private static final String TRUSTED_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
    // 鉴权所需浏览器指纹常量（与微软 Read Aloud 扩展一致，过旧值会被 403 拒绝）
    private static final String CHROMIUM_FULL_VERSION = "143.0.3650.75";
    private static final String USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
    private static final String ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";

    private final OkHttpClient client;

    public EdgeTTS() {
        client = new OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .build();
    }

    /**
     * 计算 Sec-MS-GEC 鉴权 token：取当前 UTC 时间 + Windows 纪元（11644473600s），
     * 向下对齐 5 分钟窗口，转 100ns ticks 后拼接受信 token 求 SHA-256，输出大写十六进制。
     * 该值必须随 URL 查询串传递（Sec-MS-GEC / Sec-MS-GEC-Version），放请求头会被 403 拒绝。
     */
    private static String secMsgGec() {
        try {
            long sec = System.currentTimeMillis() / 1000L + 11644473600L;
            sec -= sec % 300;
            String raw = sec + "0000000" + TRUSTED_TOKEN;
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(raw.getBytes(StandardCharsets.US_ASCII));
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString().toUpperCase(Locale.US);
        } catch (Exception e) {
            return "";
        }
    }

    private static String uuid() {
        return UUID.randomUUID().toString().replace("-", "");
    }

    private static String escapeXml(String s) {
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }

    /**
     * 合成语音，返回 Base64 编码的 MP3 音频（前端用 data:audio/mpeg;base64,... 播放）。
     * 失败返回 null。
     *
     * @param text  文本
     * @param voice 微软音色名（如 zh-CN-XiaoxiaoNeural），为空用晓晓
     */
    public String synth(String text, String voice) {
        if (text == null || text.trim().isEmpty()) return null;
        final String voiceName = (voice == null || voice.isEmpty()) ? "zh-CN-XiaoxiaoNeural" : voice;

        String connId = uuid();
        String ts = String.valueOf(System.currentTimeMillis());
        String gec = secMsgGec();

        String url = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1"
                + "?TrustedClientToken=" + TRUSTED_TOKEN
                + "&ConnectionId=" + connId
                + "&Sec-MS-GEC=" + gec
                + "&Sec-MS-GEC-Version=1-" + CHROMIUM_FULL_VERSION;

        Request request = new Request.Builder()
                .url(url)
                .header("User-Agent", USER_AGENT)
                .header("Accept-Encoding", "gzip, deflate, br, zstd")
                .header("Accept-Language", "en-US,en;q=0.9")
                .header("Pragma", "no-cache")
                .header("Cache-Control", "no-cache")
                .header("Origin", ORIGIN)
                .build();

        final ByteArrayOutputStream audioBuf = new ByteArrayOutputStream();
        final CountDownLatch latch = new CountDownLatch(1);
        final boolean[] failed = {false};

        WebSocket ws = client.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                // 1. 发送 speech.config
                try {
                    JSONObject audio = new JSONObject();
                    JSONObject meta = new JSONObject();
                    meta.put("sentenceBoundaryEnabled", false);
                    meta.put("wordBoundaryEnabled", false);
                    audio.put("metadataoptions", meta);
                    audio.put("outputFormat", "audio-24khz-48kbitrate-mono-mp3");
                    JSONObject synthesis = new JSONObject();
                    synthesis.put("audio", audio);
                    JSONObject context = new JSONObject();
                    context.put("synthesis", synthesis);
                    JSONObject cfg = new JSONObject();
                    cfg.put("context", context);

                    String header = "X-Timestamp:" + ts + "\r\n"
                            + "X-RequestId:" + connId + "\r\n"
                            + "Content-Type:application/json; charset=utf-8\r\n"
                            + "Path:speech.config\r\n\r\n";
                    webSocket.send(header + cfg.toString());

                    // 2. 发送 SSML
                    String ssml = "<speak xmlns=\"http://www.w3.org/2001/10/synthesis\" "
                            + "xmlns:mstts=\"http://www.w3.org/2001/mstts\" version=\"1.0\" xml:lang=\"zh-CN\">"
                            + "<voice name=\"" + voiceName + "\">"
                            + "<prosody rate=\"+0%\" pitch=\"+0Hz\" volume=\"medium\">"
                            + escapeXml(text)
                            + "</prosody></voice></speak>";
                    String ssmlHeader = "X-Timestamp:" + ts + "\r\n"
                            + "X-RequestId:" + connId + "\r\n"
                            + "Content-Type:application/ssml+xml\r\n"
                            + "Path:ssml\r\n\r\n";
                    webSocket.send(ssmlHeader + ssml);
                } catch (Exception e) {
                    Log.e(TAG, "send config/ssml failed", e);
                    failed[0] = true;
                    latch.countDown();
                }
            }

            @Override
            public void onMessage(WebSocket webSocket, ByteString bytes) {
                // 二进制帧：前 2 字节为头，之后是 MP3 数据
                byte[] data = bytes.toByteArray();
                if (data.length > 2) {
                    audioBuf.write(data, 2, data.length - 2);
                }
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                // 文本帧：turn.end 表示结束
                if (text != null && text.contains("Path:turn.end")) {
                    webSocket.close(1000, "done");
                    latch.countDown();
                }
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                Log.e(TAG, "websocket failure", t);
                failed[0] = true;
                latch.countDown();
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                latch.countDown();
            }
        });

        try {
            // 最多等 30 秒
            boolean ok = latch.await(30, TimeUnit.SECONDS);
            if (!ok) {
                ws.cancel();
                Log.e(TAG, "timeout");
                return null;
            }
        } catch (InterruptedException e) {
            ws.cancel();
            return null;
        }

        if (failed[0] || audioBuf.size() == 0) {
            return null;
        }

        byte[] audio = audioBuf.toByteArray();
        return Base64.encodeToString(audio, Base64.NO_WRAP);
    }

    /** 释放资源 */
    public void shutdown() {
        client.dispatcher().executorService().shutdown();
    }

    /** 常用中文音色列表（id -> 描述） */
    public static Map<String, String> voices() {
        Map<String, String> m = new HashMap<>();
        m.put("zh-CN-XiaoxiaoNeural", "晓晓（女声，温柔）");
        m.put("zh-CN-YunxiNeural", "云希（男声，阳光）");
        m.put("zh-CN-YunjianNeural", "云健（男声，沉稳）");
        m.put("zh-CN-XiaoyiNeural", "晓伊（女声，活泼）");
        m.put("zh-CN-YunyangNeural", "云扬（男声，新闻）");
        m.put("zh-CN-XiaohanNeural", "晓涵（女声，知性）");
        m.put("zh-CN-XiaomoNeural", "晓墨（女声，成熟）");
        m.put("zh-CN-YunxiaNeural", "云夏（男声，青年）");
        return m;
    }
}
