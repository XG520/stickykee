package cn.stickykee.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 服务器地址簿共享存取。
 *
 * 数据与 Web 端 {@code app/src/utils/serverConfig.js} 共用同一份
 * SharedPreferences（"stickykee"/"server_config"），JSON 契约
 * {addresses:[{id,name,url,type}],activeId,lastConnectedId} 保持不变，
 * 原生页增删改后 Web 端 loadConfig() 立即可见，反之亦然。
 *
 * 供 {@link ServerConfigActivity}（原生配置页）与 {@link MainActivity}
 * （冷启动自动连接）共同使用，避免两份实现漂移。
 */
public final class ServerConfigStore {

    private static final String PREFS = "stickykee";
    private static final String KEY = "server_config";

    /** 地址簿项（与 Web 端 address 结构一致）。 */
    public static class Addr {
        public final String id, name, url, type; // type: lan | wan
        public Addr(String id, String name, String url, String type) {
            this.id = id; this.name = name; this.url = url; this.type = type;
        }
    }

    /** 整份地址簿（列表 + 当前使用指针 + 最近连接指针）。
     *  lastConnectedId 由 Web 端 switchTo 维护，原生端只读不主动改，
     *  但删除地址时需同步清理（与 Web 端 removeAddr 行为一致），避免数据漂移。 */
    public static class Config {
        public final List<Addr> addresses = new ArrayList<>();
        public String activeId = null;
        public String lastConnectedId = null;
    }

    private ServerConfigStore() {}

    /** 读取地址簿；无数据或 JSON 损坏返回空配置（与 Web 端一致）。 */
    public static Config load(Context context) {
        Config c = new Config();
        try {
            SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String raw = sp.getString(KEY, "");
            if (raw.isEmpty()) return c;
            JSONObject o = new JSONObject(raw);
            JSONArray arr = o.optJSONArray("addresses");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject a = arr.getJSONObject(i);
                    c.addresses.add(new Addr(
                            a.optString("id"), a.optString("name"),
                            a.optString("url"), a.optString("type", "lan")));
                }
            }
            String active = o.optString("activeId", "");
            c.activeId = active.isEmpty() ? null : active;
            String last = o.optString("lastConnectedId", "");
            c.lastConnectedId = last.isEmpty() ? null : last;
        } catch (Exception ignored) { /* JSON 损坏 → 空配置 */ }
        return c;
    }

    /** 写回地址簿（config 为 null 时清除）。 */
    public static void save(Context context, Config config) {
        try {
            SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (config == null) {
                sp.edit().putString(KEY, "").apply();
                return;
            }
            JSONObject o = new JSONObject();
            JSONArray arr = new JSONArray();
            for (Addr a : config.addresses) {
                JSONObject j = new JSONObject();
                j.put("id", a.id);
                j.put("name", a.name);
                j.put("url", a.url);
                j.put("type", a.type);
                arr.put(j);
            }
            o.put("addresses", arr);
            if (config.activeId != null) o.put("activeId", config.activeId);
            if (config.lastConnectedId != null) o.put("lastConnectedId", config.lastConnectedId);
            sp.edit().putString(KEY, o.toString()).apply();
        } catch (Exception ignored) { /* 存储失败静默，与 Web 端一致 */ }
    }

    /** 当前使用中的地址：activeId 优先，退回第一个；无则 null。 */
    public static Addr active(Config c) {
        if (c == null || c.addresses.isEmpty()) return null;
        for (Addr a : c.addresses) {
            if (a.id.equals(c.activeId)) return a;
        }
        return c.addresses.get(0);
    }

    /** /healthz 可达即视为在线（对齐 Web 端 no-cors：任何 HTTP 响应都算通，仅网络异常/超时算失败）。 */
    public static boolean probe(String url, int timeoutMs) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url + "/healthz").openConnection();
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setRequestProperty("Connection", "close");
            conn.getResponseCode();
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) {
                try { conn.disconnect(); } catch (Exception ignored) {}
            }
        }
    }

    /** 读取后端 /healthz 的 version 字段；拿不到返回 null。 */
    public static String fetchVersion(String url, int timeoutMs) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url + "/healthz").openConnection();
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            if (conn.getResponseCode() != 200) return null;
            InputStream in = conn.getInputStream();
            byte[] buf = new byte[4096];
            int n = in.read(buf);
            String body = n > 0 ? new String(buf, 0, n, StandardCharsets.UTF_8) : "";
            JSONObject j = new JSONObject(body);
            String v = j.optString("version", "");
            if (v.isEmpty()) {
                JSONObject data = j.optJSONObject("data");
                if (data != null) v = data.optString("version", "");
            }
            return v.isEmpty() ? null : v.replaceFirst("^[vV]", "");
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) {
                try { conn.disconnect(); } catch (Exception ignored) {}
            }
        }
    }

    /** 规范化目标 URL：去尾部斜杠补全为根地址（loadUrl 用）。 */
    public static String root(String url) {
        if (url == null) return null;
        return url.endsWith("/") ? url : url + "/";
    }
}
