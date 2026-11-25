package cn.stickykee.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * 原生「服务器地址」配置页（App 启动入口）。
 *
 * 设计要点：
 *  - 数据与 Web 端 {@code app/src/utils/serverConfig.js} 共用同一份 SharedPreferences
 *    （"stickykee"/"server_config"），JSON 契约 {addresses,activeId,lastConnectedId} 保持不变，
 *    原生页增删改后 Web 端 loadConfig() 立即可见，反之亦然。
 *  - 在线探测：固定 3 线程池并发探测 /healthz（与 Web 端 probeAll 限流策略一致）。
 *  - 连接跳转：探测成功后写 activeId/lastConnectedId，带 target_url 启动 MainActivity，
 *    由其在 bridge 就绪后 loadUrl(target) 直达目标服务器，不再经 localhost Web 壳页整页跳。
 */
public class ServerConfigActivity extends AppCompatActivity {

    /** 直达目标：MainActivity 读取此 extra，在 bridge 就绪后 loadUrl 目标服务器。 */
    public static final String EXTRA_TARGET_URL = "target_url";

    /** 地址簿项（与 Web 端 address 结构一致）。 */
    static class Addr {
        final String id, name, url, type; // type: lan | wan
        Addr(String id, String name, String url, String type) {
            this.id = id; this.name = name; this.url = url; this.type = type;
        }
    }

    private SharedPreferences sp;
    private final List<Addr> addresses = new ArrayList<>();
    private String activeId = null;

    // 探测/连接状态（仅 UI 线程读写）
    private final Map<String, String> statuses = new HashMap<>();   // on | off | checking
    private final Map<String, String> versions = new HashMap<>();
    private String connectingId = null;

    // 线程池：probePool 限 3 并发（对齐 Web 端 probeAll 限流）；
    // actionPool 单线程跑一次性动作（连接/保存并连接/自动识别的外层循环），
    // 自动识别的内层批量探测仍走 probePool，互不阻塞（get 带超时兜底）。
    private final ExecutorService probePool = Executors.newFixedThreadPool(3, r -> {
        Thread t = new Thread(r, "sc-probe");
        t.setDaemon(true);
        return t;
    });
    private final ExecutorService actionPool = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "sc-act");
        t.setDaemon(true);
        return t;
    });

    // 表单
    private View listView, formView;
    private LinearLayout rowContainer;
    private TextView emptyHint, listHint, listErr, formMsg, formErr, formTitle;
    private TextView schemeHttp, schemeHttps, typeLan, typeWan;
    private EditText formName, formHost;
    private Button addBtn, saveConnect, saveOnly, autoDetect;
    private String editId = null;      // 非空 = 编辑模式
    private String formScheme = "http";
    private String formType = "lan";
    private boolean busy = false;
    private boolean detecting = false;

    @Override
    protected void onCreate(@NonNull Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_server_config);
        sp = getSharedPreferences("stickykee", Context.MODE_PRIVATE);
        bindViews();
        loadConfig();
        renderList();
        refreshNetworkHint();
        probeAll();
    }

    private void bindViews() {
        listView = findViewById(R.id.list_view);
        formView = findViewById(R.id.form_view);
        rowContainer = findViewById(R.id.row_container);
        emptyHint = findViewById(R.id.empty_hint);
        listHint = findViewById(R.id.list_hint);
        listErr = findViewById(R.id.list_err);
        formMsg = findViewById(R.id.form_msg);
        formErr = findViewById(R.id.form_err);
        formTitle = findViewById(R.id.form_title);
        schemeHttp = findViewById(R.id.scheme_http);
        schemeHttps = findViewById(R.id.scheme_https);
        typeLan = findViewById(R.id.type_lan);
        typeWan = findViewById(R.id.type_wan);
        formName = findViewById(R.id.form_name);
        formHost = findViewById(R.id.form_host);
        addBtn = findViewById(R.id.add_btn);
        saveConnect = findViewById(R.id.save_connect);
        saveOnly = findViewById(R.id.save_only);
        autoDetect = findViewById(R.id.auto_detect);

        formHost.setInputType(InputType.TYPE_CLASS_TEXT
                | InputType.TYPE_TEXT_VARIATION_URI
                | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);

        addBtn.setOnClickListener(v -> openForm(null));
        saveConnect.setOnClickListener(v -> saveAndConnect());
        saveOnly.setOnClickListener(v -> saveOnly());
        autoDetect.setOnClickListener(v -> autoDetect());
        ((TextView) findViewById(R.id.form_back)).setOnClickListener(v -> showList());
        schemeHttp.setOnClickListener(v -> setScheme("http"));
        schemeHttps.setOnClickListener(v -> setScheme("https"));
        typeLan.setOnClickListener(v -> setFormType("lan"));
        typeWan.setOnClickListener(v -> setFormType("wan"));
    }

    // ==================== 数据读写（与 Web 端同一契约） ====================
    private void loadConfig() {
        addresses.clear();
        statuses.clear();
        versions.clear();
        activeId = null;
        try {
            String raw = sp.getString("server_config", "");
            if (!raw.isEmpty()) {
                JSONObject o = new JSONObject(raw);
                JSONArray arr = o.optJSONArray("addresses");
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject a = arr.getJSONObject(i);
                        addresses.add(new Addr(
                                a.optString("id"), a.optString("name"),
                                a.optString("url"), a.optString("type", "lan")));
                    }
                }
                activeId = optStrOrNull(o, "activeId");
            }
        } catch (Exception ignored) { /* JSON 损坏 → 空配置，与 Web 端一致 */ }
    }

    private void saveConfig() {
        try {
            JSONObject o = new JSONObject();
            JSONArray arr = new JSONArray();
            for (Addr a : addresses) {
                JSONObject j = new JSONObject();
                j.put("id", a.id);
                j.put("name", a.name);
                j.put("url", a.url);
                j.put("type", a.type);
                arr.put(j);
            }
            o.put("addresses", arr);
            if (activeId != null) o.put("activeId", activeId);
            sp.edit().putString("server_config", o.toString()).apply();
        } catch (Exception ignored) { /* 存储失败静默 */ }
    }

    private static String optStrOrNull(JSONObject o, String k) {
        String v = o.optString(k, "");
        return v.isEmpty() ? null : v;
    }

    // ==================== 列表渲染 ====================
    private void renderList() {
        rowContainer.removeAllViews();
        if (addresses.isEmpty()) {
            emptyHint.setVisibility(View.VISIBLE);
            return;
        }
        emptyHint.setVisibility(View.GONE);
        for (Addr a : addresses) rowContainer.addView(buildRow(a));
    }

    private View buildRow(final Addr a) {
        View row = getLayoutInflater().inflate(R.layout.row_server, rowContainer, false);
        row.setTag(a.id);
        TextView name = row.findViewById(R.id.row_name);
        TextView url = row.findViewById(R.id.row_url);
        TextView active = row.findViewById(R.id.row_active);
        TextView type = row.findViewById(R.id.row_type);
        name.setText(a.name);
        url.setText(a.url);
        boolean lan = "lan".equals(a.type);
        type.setText(lan ? "内网" : "外网");
        int c = lan ? cSuccess() : cPrimary();
        type.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.setAlpha(c, 0x24)));
        type.setTextColor(c);
        active.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.setAlpha(cPrimary(), 0x24)));
        active.setTextColor(cPrimary());
        if (a.id.equals(activeId)) active.setVisibility(View.VISIBLE);
        row.setOnClickListener(v -> connectTo(a));
        row.findViewById(R.id.row_edit).setOnClickListener(v -> openForm(a));
        row.findViewById(R.id.row_del).setOnClickListener(v -> confirmDelete(a));
        updateRow(a);
        return row;
    }

    private View findRow(String id) {
        int n = rowContainer.getChildCount();
        for (int i = 0; i < n; i++) {
            View row = rowContainer.getChildAt(i);
            if (id.equals(row.getTag())) return row;
        }
        return null;
    }

    /** 按当前状态刷新某地址的行（状态点/使用中/版本/连接中提示）。仅 UI 线程调用。 */
    private void updateRow(Addr a) {
        View row = findRow(a.id);
        if (row == null) return;
        TextView dot = row.findViewById(R.id.row_dot);
        TextView ver = row.findViewById(R.id.row_ver);
        TextView conn = row.findViewById(R.id.row_conn);
        String st = statuses.get(a.id);
        if ("on".equals(st)) dot.setBackgroundResource(R.drawable.sc_status_on);
        else if ("checking".equals(st)) dot.setBackgroundResource(R.drawable.sc_status_check);
        else dot.setBackgroundResource(R.drawable.sc_status_off);
        String v = versions.get(a.id);
        if (v != null && !v.isEmpty()) {
            ver.setVisibility(View.VISIBLE);
            ver.setText("v" + v);
            ver.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.setAlpha(cSurface(), 0xFF)));
        } else {
            ver.setVisibility(View.GONE);
        }
        conn.setVisibility(a.id.equals(connectingId) ? View.VISIBLE : View.GONE);
    }

    // ==================== 探测（与 Web 端同策略：并发 3，/healthz 可达即在线） ====================
    private void probeAll() {
        listErr.setVisibility(View.GONE);
        for (Addr a : addresses) {
            statuses.put(a.id, "checking");
            updateRow(a);
        }
        for (final Addr a : addresses) {
            probePool.submit(() -> {
                boolean ok = probe(a.url, 3500);
                String v = ok ? fetchVersion(a.url, 3000) : null;
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    statuses.put(a.id, ok ? "on" : "off");
                    if (v != null) versions.put(a.id, v);
                    updateRow(a);
                });
            });
        }
    }

    /** /healthz 可达即视为在线（对齐 Web 端 no-cors fetch：任何 HTTP 响应都算通，
     *  仅网络层异常/超时算失败）。 */
    private boolean probe(String url, int timeoutMs) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url + "/healthz").openConnection();
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setRequestProperty("Connection", "close");
            conn.getResponseCode(); // 抛异常即不可达
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) {
                try { conn.disconnect(); } catch (Exception ignored) {}
            }
        }
    }

    /** 读取后端 /healthz 的 version 字段（需 CORS/直接可达；拿不到返回 null）。 */
    private String fetchVersion(String url, int timeoutMs) {
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

    // ==================== 连接 ====================
    private void connectTo(final Addr a) {
        if (connectingId != null || busy) return;
        connectingId = a.id;
        updateRow(a);
        actionPool.submit(() -> {
            boolean ok = probe(a.url, 4000);
            runOnUiThread(() -> {
                connectingId = null;
                if (isFinishing()) return;
                if (ok) {
                    activeId = a.id;
                    saveConfig();
                    launchApp(a.url);
                } else {
                    listErr.setText("无法连接到「" + a.name + "」（" + a.url + "），请检查服务器与当前网络");
                    listErr.setVisibility(View.VISIBLE);
                    updateRow(a);
                }
            });
        });
    }

    /** 带 target_url 启动 MainActivity（bridge 就绪后直达服务器），并关闭本页。 */
    private void launchApp(String url) {
        String base = url.endsWith("/") ? url : url + "/";
        Intent it = new Intent(this, MainActivity.class);
        it.putExtra(ServerConfigActivity.EXTRA_TARGET_URL, base);
        it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(it);
        finish();
    }

    private void confirmDelete(final Addr a) {
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog)
                .setTitle("删除「" + a.name + "」？")
                .setPositiveButton("删除", (d, w) -> {
                    addresses.remove(a);
                    if (a.id.equals(activeId)) activeId = addresses.isEmpty() ? null : addresses.get(0).id;
                    saveConfig();
                    renderList();
                    probeAll();
                })
                .setNegativeButton("取消", null)
                .show();
    }

    // ==================== 表单 ====================
    private void openForm(Addr a) {
        editId = a == null ? null : a.id;
        formName.setText(a == null ? "" : a.name);
        if (a != null) {
            formHost.setText(stripScheme(a.url));
            formScheme = a.url.toLowerCase().startsWith("https://") ? "https" : "http";
            formType = "wan".equals(a.type) ? "wan" : "lan";
        } else {
            formHost.setText("");
            formScheme = "http";
            formType = currentNet() == ConnectivityManager.TYPE_MOBILE ? "wan" : "lan";
        }
        setScheme(formScheme);
        setFormType(formType);
        formTitle.setText(editId == null ? "添加服务器" : "编辑地址");
        formMsg.setVisibility(View.GONE);
        formErr.setVisibility(View.GONE);
        listView.setVisibility(View.GONE);
        formView.setVisibility(View.VISIBLE);
    }

    private void showList() {
        formView.setVisibility(View.GONE);
        listView.setVisibility(View.VISIBLE);
        loadConfig();
        renderList();
        probeAll();
    }

    private void setScheme(String s) {
        formScheme = s;
        schemeHttp.setTextColor(s.equals("http") ? cPrimary() : cMuted());
        schemeHttps.setTextColor(s.equals("https") ? cPrimary() : cMuted());
    }

    private void setFormType(String t) {
        formType = t;
        typeLan.setTextColor(t.equals("lan") ? cSuccess() : cMuted());
        typeWan.setTextColor(t.equals("wan") ? cPrimary() : cMuted());
    }

    private void saveAndConnect() {
        if (busy) return;
        final Addr a = collect();
        if (a == null) return;
        busy = true;
        setBusyUI(true);
        formMsg.setText("正在探测服务器…");
        formMsg.setVisibility(View.VISIBLE);
        formErr.setVisibility(View.GONE);
        actionPool.submit(() -> {
            boolean ok = probe(a.url, 4000);
            runOnUiThread(() -> {
                busy = false;
                setBusyUI(false);
                if (isFinishing()) return;
                if (ok) {
                    formMsg.setText("连接成功，正在进入…");
                    launchApp(a.url);
                } else {
                    formMsg.setVisibility(View.GONE);
                    formErr.setText("无法连接到 " + a.url + "，请检查地址、端口与当前网络");
                    formErr.setVisibility(View.VISIBLE);
                }
            });
        });
    }

    private void saveOnly() {
        Addr a = collect();
        if (a == null) return;
        showList();
    }

    /** 校验并收集表单写入地址簿。合法返回新/改后的 Addr，非法返回 null 并显示 formErr。 */
    private Addr collect() {
        formErr.setVisibility(View.GONE);
        formMsg.setVisibility(View.GONE);
        String name = formName.getText().toString().trim();
        if (name.isEmpty()) {
            showFormErr("请填写名称");
            return null;
        }
        String host = cleanInput(formHost.getText().toString()).replaceAll("/+$", "");
        if (host.isEmpty()) {
            showFormErr("请填写服务器地址");
            return null;
        }
        // 允许用户直接粘贴完整 URL（如 https://x.com:8443/）
        String url;
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("^(https?)://(.+)$", java.util.regex.Pattern.CASE_INSENSITIVE)
                .matcher(host);
        if (m.matches()) {
            url = m.group(1).toLowerCase() + "://" + m.group(2).replaceAll("^/+", "");
        } else {
            url = formScheme + "://" + host;
        }
        try {
            java.net.URI u = new java.net.URI(url);
            if (!("http".equals(u.getScheme()) || "https".equals(u.getScheme())) || u.getHost() == null) {
                showFormErr("地址格式不正确（冒号、斜杠用半角，需含地址与端口）");
                return null;
            }
        } catch (Exception e) {
            showFormErr("地址格式不正确（冒号、斜杠用半角，需含地址与端口）");
            return null;
        }

        int idx = -1;
        if (editId != null) {
            for (int i = 0; i < addresses.size(); i++) {
                if (addresses.get(i).id.equals(editId)) { idx = i; break; }
            }
            if (idx >= 0) {
                addresses.set(idx, new Addr(editId, name, url, formType));
                saveConfig();
                return addresses.get(idx);
            }
        }
        String id = genId();
        addresses.add(new Addr(id, name, url, formType));
        activeId = id; // 新增即可用：与 Web 端「保存并连接」一致，新增即指向
        saveConfig();
        return new Addr(id, name, url, formType);
    }

    private void showFormErr(String msg) {
        formErr.setText(msg);
        formErr.setVisibility(View.VISIBLE);
    }

    private void setBusyUI(boolean on) {
        saveConnect.setEnabled(!on);
        saveOnly.setEnabled(!on);
        autoDetect.setEnabled(!on);
        saveConnect.setAlpha(on ? 0.5f : 1f);
        saveOnly.setAlpha(on ? 0.5f : 1f);
        autoDetect.setAlpha(on ? 0.5f : 1f);
    }

    // ==================== 自动识别（与 Web 端同策略：抽样探测常见网段与端口） ====================
    private void autoDetect() {
        if (detecting) return;
        detecting = true;
        autoDetect.setEnabled(false);
        autoDetect.setAlpha(0.5f);
        formErr.setVisibility(View.GONE);
        formMsg.setText("正在识别内网服务器…");
        formMsg.setVisibility(View.VISIBLE);
        actionPool.submit(() -> {
            String found = detectLanServer();
            runOnUiThread(() -> {
                detecting = false;
                autoDetect.setEnabled(true);
                autoDetect.setAlpha(1f);
                if (isFinishing()) return;
                if (found != null) {
                    formHost.setText(stripScheme(found));
                    setScheme("http");
                    formMsg.setText("发现服务器：" + found + "，请填写名称后保存");
                } else {
                    formMsg.setVisibility(View.GONE);
                    showFormErr("未识别到内网服务器，请手动填写地址");
                }
            });
        });
    }

    private String detectLanServer() {
        String[] prefixes = {"192.168.1", "192.168.0", "10.0.0", "172.16.0"};
        int[] ports = {8080, 8123, 80};
        List<String> candidates = new ArrayList<>();
        for (String p : prefixes) {
            for (int i = 1; i <= 254; i += 25) {
                for (int port : ports) candidates.add("http://" + p + "." + i + ":" + port);
            }
        }
        // 每批 5 个走 3 线程池并发探测（对齐 Web 端 autoDetect 的批次策略）
        for (int i = 0; i < candidates.size(); i += 5) {
            int end = Math.min(i + 5, candidates.size());
            List<String> batch = candidates.subList(i, end);
            List<Future<Boolean>> fs = new ArrayList<>();
            for (String u : batch) fs.add(probePool.submit(() -> probe(u, 2000)));
            for (int k = 0; k < fs.size(); k++) {
                try {
                    if (fs.get(k).get(8, TimeUnit.SECONDS)) return batch.get(k);
                } catch (Exception ignored) { /* 超时/池忙：视为未发现，继续下一批 */ }
            }
        }
        return null;
    }

    // ==================== 网络类型 ====================
    private int currentNet() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return -1;
            NetworkInfo ni = cm.getActiveNetworkInfo();
            return ni == null ? -1 : ni.getType();
        } catch (Exception e) {
            return -1;
        }
    }

    private void refreshNetworkHint() {
        listHint.setText(currentNet() == ConnectivityManager.TYPE_MOBILE
                ? "当前使用移动数据，优先连接外网地址"
                : "当前使用 WiFi，优先连接内网地址");
    }

    // ==================== 工具 ====================
    private String stripScheme(String u) {
        return u == null ? "" : u.replaceAll("^https?://", "");
    }

    /** 全角转半角、去空白（与 Web 端 cleanInput 一致，兼容中文输入法）。 */
    private String cleanInput(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c >= 0xFF01 && c <= 0xFF5E) c = (char) (c - 0xFEE0);
            else if (c == 0x3000) c = ' ';
            sb.append(c);
        }
        return sb.toString().replaceAll("\\s+", "");
    }

    private String genId() {
        return "srv_" + System.currentTimeMillis() + "_"
                + Integer.toHexString((int) (Math.random() * 0x100000000));
    }

    private int cPrimary() { return ContextCompat.getColor(this, R.color.sc_primary); }
    private int cSuccess() { return ContextCompat.getColor(this, R.color.sc_success); }
    private int cMuted() { return ContextCompat.getColor(this, R.color.sc_muted); }
    private int cSurface() { return ContextCompat.getColor(this, R.color.sc_surface); }

    @Override
    protected void onDestroy() {
        probePool.shutdownNow();
        actionPool.shutdownNow();
        super.onDestroy();
    }
}
