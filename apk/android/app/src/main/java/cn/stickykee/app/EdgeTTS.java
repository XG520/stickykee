package cn.stickykee.app;

import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
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
    // 2026-10-10 起微软强制 v2 DRM token，版本号随 Edge 155
    private static final String CHROMIUM_FULL_VERSION = "155.0.4283.45";
    private static final String USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0";
    private static final String ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";

    private final OkHttpClient client;

    public EdgeTTS() {
        client = new OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .build();
    }

    /**
     * 计算 v2 Sec-MS-GEC 鉴权 token（"<16位hex>-<64位hex>"）。
     * 2026-10-10 起微软强制 v2 DRM：CS64 + 变体 SHA-256 双摘要。
     * 算法移植自 rany2/edge-tts PR #492（对 Edge 155 抓包逆向），
     * 已与 master drm.py 交叉验证（ts=1791000000 → D6C3700C244D8F70-76A5...）。
     * 注意：ticks 必须走 float64 路径（×1e7 后超出 double 精度，
     * 原生实现的舍入参与哈希，整数精确计算会得到不匹配的 CS64 半段）。
     */
    private static String secMsgGec() {
        try {
            double ticks = System.currentTimeMillis() / 1000L;
            ticks += 11644473600.0;
            ticks -= ticks % 300.0;
            ticks *= 1e7; // 转 100ns ticks
            String strToHash = String.format(Locale.US, "%.0f", ticks) + TRUSTED_TOKEN;
            byte[] data = strToHash.getBytes(StandardCharsets.US_ASCII);
            byte[] digest = drmSha256Digest(data);
            int[] cs = drmCs64(data, digest);
            return hexLE(cs[0]) + hexLE(cs[1]) + "-" + hexUpper(digest);
        } catch (Exception e) {
            return "";
        }
    }

    // ---- 变体 SHA-256 / CS64（DRM 专用，常量被微软篡改，不能用标准库）----

    private static final int[] SHA256_INITIAL = {
            0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
            0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19};
    private static final int[] SHA256_STATE = {
            0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A,
            0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2};
    // 首块消息字 words[16..29] 的预置调度常量（14 个）
    private static final int[] SHA256_SCHEDULE = {
            0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA,
            0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6,
            0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33,
            0xD258B060, 0x72766564};
    // 标准 SHA-256 轮常量 K
    private static final int[] K = {
            0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5,
            0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
            0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3,
            0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
            0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC,
            0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
            0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7,
            0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
            0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13,
            0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
            0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3,
            0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
            0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5,
            0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
            0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208,
            0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2};
    private static final int SHA256_ADJUSTMENT = 0xC9DC06A7; // 替换首块 K[14]
    private static final int SIGMA0_ADJUSTMENT = 0x059C0B80;
    private static final int SIGMA1_ADJUSTMENT = 0x000B92C0;
    private static final int[][] CS64_COEFFICIENTS = {
            {0xE82E91B1, 0xB32700D0}, {0x44DE24C6, 0x88DFF51D},
            {0x3BEB65BC, 0x29514038}, {0xC89C5933, 0xB328CBDF},
            {0x8D1EC211, 0xD405B4D5}, {0x314EF5D5, 0x26E55F3C},
            {0xE92491B1, 0x607801C6}, {0xF0A5B9D5, 0x82B2C1FB},
            {0x06064CF3, 0xFA51A3DA}, {0xDA79FA60, 0x207CC464},
            {0xBED20560, 0x3C3C74F3}, {0x89F9C9F8, 0xD2D14B61},
            {0x35FA38C6, 0xBB04A2C1}, {0xCB49E3C6, 0xC5626167}};
    private static final int CS64_FACTOR = 0x82893933;
    private static final int CS64_ADJUSTMENT0 = 0xF2F90B1A;
    private static final int CS64_ADJUSTMENT1 = 0x0B1A0000;

    private static int rol16(int v) { return (v << 16) | (v >>> 16); }

    // 小 sigma（单次截断变体）：先异或后截断，与标准 SHA-256 的逐项截断不同
    private static int sig0(int v) {
        return v >>> 7 ^ v << 25 ^ v >>> 18 ^ v << 14 ^ v >>> 3;
    }

    private static int sig1(int v) {
        return v >>> 17 ^ v << 15 ^ v >>> 19 ^ v << 13 ^ v >>> 10;
    }

    // 轮压缩（大 sigma 用循环移位 ROTR），返回纯压缩输出，由调用方决定加回谁
    private static int[] drmRounds(int[] state, int[] words, int firstRound, boolean blockConst) {
        int[] k = K.clone();
        if (blockConst) k[14] = SHA256_ADJUSTMENT;
        int a = state[0], b = state[1], c = state[2], d = state[3];
        int e = state[4], f = state[5], g = state[6], h = state[7];
        for (int i = firstRound; i < 64; i++) {
            int s1 = Integer.rotateRight(e, 6) ^ Integer.rotateRight(e, 11)
                    ^ Integer.rotateRight(e, 25);
            int t1 = h + s1 + (g ^ (e & (f ^ g))) + k[i] + words[i];
            int s0 = Integer.rotateRight(a, 2) ^ Integer.rotateRight(a, 13)
                    ^ Integer.rotateRight(a, 22);
            int t2 = s0 + ((a & b) | (c & (a | b)));
            h = g; g = f; f = e;
            e = d + t1;
            d = c; c = b; b = a;
            a = t1 + t2;
        }
        return new int[]{a, b, c, d, e, f, g, h};
    }

    // 用消息前 7 字节构造变体初始状态（特殊首块 + 修改版 IV）
    private static int[] drmSha256Init(byte[] prefix) {
        int[] words = new int[64];
        words[14] = (prefix[0] & 0xFF) << 16 | (prefix[1] & 0xFF) << 8 | (prefix[2] & 0xFF);
        words[15] = (prefix[3] & 0xFF) << 24 | (prefix[4] & 0xFF) << 16
                | (prefix[5] & 0xFF) << 8 | (prefix[6] & 0xFF);
        for (int index = 16; index < 30; index++) {
            int value = SHA256_SCHEDULE[index - 16];
            if (index - 2 >= 14) {
                value += (index == 16)
                        ? (sig1(words[index - 2]) ^ SIGMA1_ADJUSTMENT)
                        : sig1(words[index - 2]);
            }
            if (index - 7 >= 14) {
                value += words[index - 7];
            }
            if (index - 15 >= 14) {
                value += (index == 29)
                        ? (sig0(words[index - 15]) ^ SIGMA0_ADJUSTMENT)
                        : sig0(words[index - 15]);
            }
            words[index] = value;
        }
        words[30] = sig1(words[28]) + words[23] + sig0(words[15])
                + words[14] + SHA256_ADJUSTMENT - K[14];
        for (int index = 31; index < 64; index++) {
            int x = words[index - 2], y = words[index - 15];
            words[index] = sig1(x) + words[index - 7] + sig0(y) + words[index - 16];
        }
        int[] working = drmRounds(SHA256_STATE, words, 14, true);
        int[] out = new int[8];
        for (int i = 0; i < 8; i++) {
            out[i] = SHA256_INITIAL[i] + working[i];
        }
        return out;
    }

    // 变体 SHA-256 摘要（32 字节）
    private static byte[] drmSha256Digest(byte[] data) {
        int length = 57 + data.length;
        int pad = (55 - length) % 64;
        if (pad < 0) pad += 64;
        byte[] padded = new byte[data.length - 7 + 1 + pad + 8];
        System.arraycopy(data, 7, padded, 0, data.length - 7);
        padded[data.length - 7] = (byte) 0x80;
        long bitLen = (long) length * 8;
        int lenOff = padded.length - 8;
        for (int i = 0; i < 8; i++) {
            padded[lenOff + i] = (byte) (bitLen >>> (56 - 8 * i));
        }
        int[] state = drmSha256Init(Arrays.copyOf(data, 7));
        for (int off = 0; off < padded.length; off += 64) {
            int[] words = new int[64];
            for (int i = 0; i < 16; i++) {
                int j = off + i * 4;
                words[i] = (padded[j] & 0xFF) << 24 | (padded[j + 1] & 0xFF) << 16
                        | (padded[j + 2] & 0xFF) << 8 | (padded[j + 3] & 0xFF);
            }
            for (int index = 16; index < 64; index++) {
                int x = words[index - 2], y = words[index - 15];
                words[index] = sig1(x) + words[index - 7] + sig0(y) + words[index - 16];
            }
            int[] w = drmRounds(state, words, 0, false);
            for (int i = 0; i < 8; i++) {
                state[i] += w[i];
            }
        }
        byte[] out = new byte[32];
        for (int i = 0; i < 8; i++) {
            out[i * 4] = (byte) (state[i] >>> 24);
            out[i * 4 + 1] = (byte) (state[i] >>> 16);
            out[i * 4 + 2] = (byte) (state[i] >>> 8);
            out[i * 4 + 3] = (byte) state[i];
        }
        return out;
    }

    // CS64 摘要（两个 u32 字）
    private static int[] drmCs64(byte[] data, byte[] digest) {
        int keyA = (digest[0] & 0xFF) | (digest[1] & 0xFF) << 8
                | (digest[2] & 0xFF) << 16 | (digest[3] & 0xFF) << 24 | 1;
        int keyB = (digest[4] & 0xFF) | (digest[5] & 0xFF) << 8
                | (digest[6] & 0xFF) << 16 | (digest[7] & 0xFF) << 24 | 1;
        int f0 = keyA * CS64_FACTOR;
        int f1 = keyB * CS64_FACTOR;

        int[] terms = new int[28];
        int[] offsets = new int[28];
        int n = 0;
        for (int i = 0; i < 14; i++) {
            terms[n] = CS64_COEFFICIENTS[i][0] * ((i % 2 == 0) ? f0 : f1);
            offsets[n] = CS64_COEFFICIENTS[i][1];
            n++;
        }

        // b"\0"+data 按小端 u32 切词，补零至偶数个
        byte[] raw = new byte[data.length + 1];
        System.arraycopy(data, 0, raw, 1, data.length);
        int wordCount = (raw.length + 3) / 4;
        if (wordCount % 2 == 1) wordCount++;
        byte[] buf = Arrays.copyOf(raw, wordCount * 4);
        for (int i = 0; i < wordCount; i++) {
            int w = (buf[i * 4] & 0xFF) | (buf[i * 4 + 1] & 0xFF) << 8
                    | (buf[i * 4 + 2] & 0xFF) << 16 | (buf[i * 4 + 3] & 0xFF) << 24;
            int term, off;
            if (i % 2 == 0) {
                term = w * keyA;
                off = rol16(w) * 0xEF0569FB;
            } else {
                term = w * keyB;
                off = rol16(w) * 0xC31713DB;
            }
            if (i == 0) {
                term += CS64_ADJUSTMENT0 * f0;
                off += CS64_ADJUSTMENT1;
            }
            terms[n] = term;
            offsets[n] = off;
            n++;
        }

        int swapAcc = 0, swapLast = 0, st = 0, acc = 0;
        for (int i = 0; i < n; i += 2) {
            int x = terms[i], y = terms[i + 1];

            int t = rol16(offsets[i] + x);
            int q = t * 0x76F50F34;
            swapAcc += rol16(q) * 0xC3EFEA97 + q;
            t = rol16(offsets[i + 1] + y);
            q = t * 0x1881CE3C;
            swapLast = rol16(q) * 0x35BD1EC9 + q;
            swapAcc += swapLast;

            st = st * keyA + x;
            st = rol16(st) * 0xCF98B111;
            st = rol16(st) * 0x87085B9F;
            st = rol16(st) * 0x12CEB96D;
            st = rol16(st) * 0x257E1D83;
            acc += st;

            t = st * keyB + y;
            t = rol16(t) * 0xA27416F5;
            t = rol16(t) * 0xD38396FF;
            st = rol16(rol16(t) * 0x7C932B89) * 0xBFA49F69;
            acc += st;
        }
        return new int[]{swapLast ^ st, swapAcc ^ acc};
    }

    private static String hexLE(int w) {
        return String.format(Locale.US, "%02X%02X%02X%02X",
                w & 0xFF, (w >>> 8) & 0xFF, (w >>> 16) & 0xFF, (w >>> 24) & 0xFF);
    }

    private static String hexUpper(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.US, "%02X", b));
        }
        return sb.toString();
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
                + "&Sec-MS-GEC-Version=2-" + CHROMIUM_FULL_VERSION;

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
                // 二进制帧：[2字节大端头长度][头文本(含 Path:audio)][MP3 数据]。
                // 必须按头长度跳过整个头文本，否则 ASCII 头会混入 MP3 流导致解码失败。
                byte[] data = bytes.toByteArray();
                if (data.length > 2) {
                    int hdrLen = ((data[0] & 0xFF) << 8) | (data[1] & 0xFF);
                    if (2 + hdrLen <= data.length) {
                        audioBuf.write(data, 2 + hdrLen, data.length - 2 - hdrLen);
                    }
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
