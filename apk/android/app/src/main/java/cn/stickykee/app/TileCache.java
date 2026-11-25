package cn.stickykee.app;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * 地图瓦片原生磁盘 LRU 缓存（P2）：替代 sw.js 的 Cache API——后者会被用户「清除缓存」
 * 清掉，原生文件落在 getExternalFilesDir 下，应用数据清除之外的任何清缓存都不影响。
 *
 * 覆盖两类瓦片（与 sw.js 一致）：
 *   *.autonavi.com  高德栅格瓦片（wprd、webst 等子域，img 标签加载，无 CORS）
 *   vdata.amap.com  高德 JS API 2.0 矢量瓦片（XHR/fetch，需要 CORS 头）
 *
 * 命中策略：content-addressed（SHA-1(完整 URL) 为文件名），读即 touch 更新时间戳；
 * 超上限按最旧访问淘汰。网络回源用 OkHttp 转发 WebView 原始请求的关键头
 * （Referer/Origin/Accept/UA），失败时回 504（与 sw.js 行为一致：留白不报错刷屏）。
 *
 * 线程模型：shouldInterceptRequest 运行在 WebView 的 IO 线程（非主线程），
 * 本类的文件与 OkHttp 操作均可在此同步执行；内部用 synchronized 护住 LRU 列表。
 */
public final class TileCache {

    private static final int MAX_ENTRIES = 4000;
    private static final long MAX_BYTES = 40L * 1024 * 1024; // 40MB

    private static final HostMatcher HOST_AUTONAVI = uri -> {
        String h = host(uri);
        return h != null && (h.equals("autonavi.com") || h.endsWith(".autonavi.com"));
    };
    private static final HostMatcher HOST_VDATA = uri -> {
        String h = host(uri);
        return h != null && h.equals("vdata.amap.com");
    };

    private interface HostMatcher { boolean match(Uri u); }

    private final File dir;
    private final OkHttpClient http;
    // LRU：hash -> 最近访问时间（SystemClock.elapsedRealtime，单调不受墙钟跳变）
    private final Map<String, Long> lru = new HashMap<>();
    private long totalBytes = 0;

    private TileCache(Context app) {
        this.dir = new File(app.getExternalFilesDir(null) == null
                ? app.getFilesDir() : app.getExternalFilesDir(null), "tilecache");
        if (!this.dir.exists()) this.dir.mkdirs();
        this.http = new OkHttpClient.Builder()
                .connectTimeout(8, TimeUnit.SECONDS)
                .readTimeout(8, TimeUnit.SECONDS)
                .build();
        loadIndex();
    }

    private static volatile TileCache instance;
    static TileCache get(Context app) {
        if (instance == null) {
            synchronized (TileCache.class) {
                if (instance == null) instance = new TileCache(app);
            }
        }
        return instance;
    }

    /** URL 是否为需拦截的瓦片源。 */
    public static boolean isTile(String url) {
        if (url == null) return false;
        try {
            Uri u = Uri.parse(url);
            return HOST_AUTONAVI.match(u) || HOST_VDATA.match(u);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 服务一次瓦片请求：命中直接返回；未命中回源（转发原始请求头）后写缓存返回；
     * 回源失败返回 504 空响应（前端按离线留白处理）。@return 始终非 null。
     */
    public WebResourceResponse serve(WebResourceRequestCompat req) {
        String url = req.url;
        String key = sha1(url);
        File f = file(key);
        byte[] body = null;
        String type = null;
        boolean hit;
        long t0 = android.os.SystemClock.elapsedRealtime();

        synchronized (this) {
            if (f.exists() && f.length() > 0) {
                hit = true;
                lru.put(key, t0);
                body = readFile(f);
                type = mimeFromUrl(url);
            } else {
                hit = false;
            }
        }

        if (!hit) {
            body = fetchFromNetwork(req);
            if (body != null) {
                type = mimeFromUrl(url);
                synchronized (this) {
                    long size = body.length;
                    if (f.exists()) totalBytes -= f.length();
                    writeCache(f, body);
                    lru.put(key, t0);
                    totalBytes += size;
                    evict();
                }
            } else {
                // 回源失败：离线且未缓存 → 504 空响应（与 sw.js 行为对齐：留白不报错刷屏）
                return new WebResourceResponse("text/plain", "utf-8", 504, "offline",
                        null, new ByteArrayInputStream(new byte[0]));
            }
        }

        return new WebResourceResponse(type, "binary", 200, "OK",
                corsHeaders(type), new ByteArrayInputStream(body));
    }

    /** 回源：转发 WebView 原始请求的关键头，Amap 瓦片接口需带 Referer/UA。 */
    private byte[] fetchFromNetwork(WebResourceRequestCompat req) {
        try {
            Request.Builder rb = new Request.Builder().url(req.url);
            if (req.referer != null) rb.header("Referer", req.referer);
            if (req.origin != null) rb.header("Origin", req.origin);
            rb.header("User-Agent", "Mozilla/5.0 (Linux; Android) StickyKee/TileCache");
            try (Response resp = http.newCall(rb.build()).execute()) {
                ResponseBody rb2 = resp.body();
                if (!resp.isSuccessful() || rb2 == null) return null;
                return rb2.bytes();
            }
        } catch (IOException e) {
            return null;
        }
    }

    // ---- LRU 维护 ----
    // 注意：LRU 时间戳统一用 SystemClock.elapsedRealtime（单调，不受墙钟跳变影响）。
    // 初始加载时磁盘文件的 lastModified 是墙钟毫秒，不能直接当 LRU 值混用
    // （否则老文件会被判成「更新」而永不淘汰），这里按 mtime 排好顺序后
    // 统一赋一个基于当前单调时钟、按序递增的基准值。
    private void loadIndex() {
        synchronized (this) {
            File[] files = dir.listFiles();
            if (files == null) return;
            java.util.List<File> sorted = java.util.Arrays.asList(files);
            sorted.sort((a, b) -> Long.compare(a.lastModified(), b.lastModified()));
            long base = android.os.SystemClock.elapsedRealtime();
            int i = 0;
            for (File f : sorted) {
                if (!f.exists() || f.length() == 0) continue;
                lru.put(f.getName(), base + (long) i);
                totalBytes += f.length();
                i++;
            }
            evict();
        }
    }

    private void evict() {
        if (lru.size() <= MAX_ENTRIES && totalBytes <= MAX_BYTES) return;
        java.util.List<Map.Entry<String, Long>> list = new java.util.ArrayList<>(lru.entrySet());
        list.sort((a, b) -> Long.compare(a.getValue(), b.getValue()));
        int i = 0;
        while (i < list.size() && (lru.size() - i > MAX_ENTRIES || totalBytes > MAX_BYTES)) {
            Map.Entry<String, Long> e = list.get(i);
            File f = file(e.getKey());
            totalBytes -= (f.exists() ? f.length() : 0);
            f.delete();
            lru.remove(e.getKey());
            i++;
        }
    }

    // ---- 工具 ----
    private File file(String key) {
        return new File(dir, key);
    }

    private byte[] readFile(File f) {
        try (InputStream in = new java.io.FileInputStream(f)) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } catch (IOException e) {
            return new byte[0];
        }
    }

    private void writeCache(File f, byte[] data) {
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(f)) {
            out.write(data);
        } catch (IOException ignored) {
        }
    }

    private static String mimeFromUrl(String url) {
        String u = url.toLowerCase();
        if (u.contains(".png")) return "image/png";
        if (u.contains(".jpg") || u.contains(".jpeg")) return "image/jpeg";
        if (u.contains(".webp")) return "image/webp";
        if (u.contains(".pbf")) return "application/octet-stream";
        if (u.contains("vdata") || u.contains("vector")) return "application/octet-stream";
        return "application/octet-stream";
    }

    private static Map<String, String> corsHeaders(String type) {
        Map<String, String> m = new HashMap<>();
        m.put("Access-Control-Allow-Origin", "*");
        m.put("Cache-Control", "public, max-age=604800");
        if (type != null) m.put("Content-Type", type);
        return m;
    }

    private static String host(Uri u) {
        try { return u.getHost(); } catch (Exception e) { return null; }
    }

    private static String sha1(String s) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-1");
            byte[] d = md.digest(s.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }

    /** WebResourceRequest 的轻量封装（跨 API 级别取 url/referer/origin，避免版本分支）。 */
    public static final class WebResourceRequestCompat {
        public final String url;
        public final String referer;
        public final String origin;
        public WebResourceRequestCompat(String url, String referer, String origin) {
            this.url = url;
            this.referer = referer;
            this.origin = origin;
        }
    }
}
