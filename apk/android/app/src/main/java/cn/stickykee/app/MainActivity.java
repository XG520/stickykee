package cn.stickykee.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private NativeBridge nativeBridge;

    // 原生「服务器地址」配置页直达目标（ServerConfigActivity.EXTRA_TARGET_URL）。
    // 非空时 bridge 就绪后 loadUrl(target)，跳过 Web 壳页的 JS 探测与整页跳转往返。
    private String targetUrl = null;

    // 主界面存活标记：KeepAliveService 被系统重启（进程被杀后 START_STICKY 拉活）时
    // 据此判断主界面是否需要重建——alive=false 说明用户划掉/进程被杀，尝试拉起自恢复
    public static volatile boolean alive = false;

    // 应用前台标记：原生传感器采集器据此上报 screen_state（on=前台 / off=退后台）
    public static volatile boolean foreground = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        alive = true;
        foreground = true;
        // 注册对所有源（壳页 + allowNavigation 远程页面）可用的极简原生桥，
        // 用于系统栏主题配色与 APK 原生 TTS；远程页没有 Capacitor JS 运行时，只能走 JavascriptInterface。
        nativeBridge = new NativeBridge(this);
        bridge.getWebView().addJavascriptInterface(nativeBridge, "StickyKeeNative");
        // 注入 WebView 引用：异步 TTS（speakEdge2/speakLocal2）完成后经 evaluateJavascript
        // 向页面派发 stickykee-tts 结果事件。
        nativeBridge.attachWebView(bridge.getWebView());
        // 允许无手势自动播放：TTS 朗读助手回复走 new Audio().play()，默认
        // mediaPlaybackRequiresUserGesture=true 时自动朗读（无用户手势）会在合成回到
        // 前端后被 WebView 拒绝，导致自定义 TTS 引擎无声、只能回退系统 TTS。
        bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
        // P2：地图瓦片请求经原生磁盘 LRU 缓存（TileCache）——SW 的 Cache API 会被清缓存清掉，
        // 原生文件落在 getExternalFilesDir/tilecache，清缓存/重启都不受影响；且 http 源下
        // SW 根本不会注册（需 https），APK 内离线地图此前实际没有缓存。
        // 在 Capacitor 默认的 BridgeWebViewClient 之上重写 shouldInterceptRequest：
        // 瓦片域名走 TileCache；其余返回 super（壳页本地资源等逻辑由 Capacitor 处理）。
        bridge.setWebViewClient(new com.getcapacitor.BridgeWebViewClient(bridge) {
            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(
                    android.webkit.WebView view, android.webkit.WebResourceRequest request) {
                try {
                    String url = request.getUrl().toString();
                    if (TileCache.isTile(url)) {
                        java.util.Map<String, String> h = request.getRequestHeaders();
                        return TileCache.get(getApplicationContext()).serve(
                                new TileCache.WebResourceRequestCompat(url, h.get("Referer"), h.get("Origin")));
                    }
                } catch (Exception ignored) {
                }
                return super.shouldInterceptRequest(view, request);
            }
        });
        // APK 覆盖安装后，WebView 可能仍命中旧内置前端的缓存。版本号变化时清一次
        // 资源缓存并重载，保证直接用上新 APK 里的前端，无需用户手动清除应用数据。
        refreshWebCacheOnUpgrade();
        // 定位：navigator.geolocation 的授权弹窗与运行时权限由 Capacitor 的
        // BridgeWebChromeClient.onGeolocationPermissionsShowPrompt 处理，无需自定义包装；
        // 此前报 "User denied Geolocation" 的根因是 AndroidManifest 未声明定位权限，
        // 未声明的权限被系统直接拒绝。权限声明见 AndroidManifest.xml。
        // 支付通知自动记账：启动时尝试同步上次离线积压的微信/支付宝通知。
        FinanceAutoBridge.flushAsync(this);
        // Android 13+：通知栏通知（HA notify.mobile_app / IM 新消息）是运行时权限，
        // 启动时请求一次；拒绝后通知静默丢弃（NativeBridge.showNotification2 有兜底检查）。
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 4201);
        }
        // 直达目标在 super.onCreate → load() → onNewIntent(getIntent()) 里已经处理
        // （applyTarget 读 target_url 并 loadUrl）。nativeBridge 此刻已创建，
        // 若为原生直达（targetUrl 非空）则重启连接看门狗（原链路靠 Web 壳页 JS 调
        // connWatch；直达跳过了壳页，不改则服务器掉线无兜底退回）。
        restartConnWatchIfTarget();
    }

    /** 若 intent 携带 target_url，bridge 就绪后直达目标服务器。
     *  注意：super.onCreate → load() → onNewIntent(getIntent()) 调用本方法时
     *  nativeBridge 尚未创建，故此处只做 loadUrl；连接看门狗在 nativeBridge
     *  就绪后由 restartConnWatchIfTarget() 启动（见 onCreate 尾部与 onNewIntent）。 */
    private void applyTarget(Intent intent) {
        if (intent == null) return;
        String t = intent.getStringExtra(ServerConfigActivity.EXTRA_TARGET_URL);
        if (t == null || t.isEmpty()) return;
        targetUrl = t;
        try {
            bridge.getWebView().loadUrl(t);
        } catch (Exception ignored) {
            // bridge/webview 尚未就绪：理论上 load() 在 super.onCreate 已创建，此处兜底静默
        }
    }

    /** 原生直达场景下重启连接看门狗。
     *  原链路是 Web 壳页 JS 调 connWatch；直达跳过了壳页，不改这里则服务器
     *  掉线时无兜底退回。nativeBridge 与 targetUrl 都就绪时调用。 */
    private void restartConnWatchIfTarget() {
        if (nativeBridge == null || targetUrl == null) return;
        String base = targetUrl.endsWith("/")
                ? targetUrl.substring(0, targetUrl.length() - 1) : targetUrl;
        nativeBridge.connWatch(base);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // CLEAR_TOP 复用既有实例时系统重新投递 intent（看门狗退回/配置页再次连接）：
        // 重新直达目标服务器并重启连接看门狗（此时 nativeBridge 已就绪）。
        if (intent != null) {
            applyTarget(intent);
            restartConnWatchIfTarget();
        }
    }

    // APK 版本号变化（覆盖安装）时清理 WebView 资源缓存并重载一次。
    // 不清 Cookie / localStorage，登录态与服务器地址簿不受影响。
    private void refreshWebCacheOnUpgrade() {
        try {
            android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            String cur = pi.versionName + "#" + pi.versionCode;
            android.content.SharedPreferences sp = getSharedPreferences("hc_web_cache", MODE_PRIVATE);
            String last = sp.getString("version", "");
            if (cur.equals(last)) return;
            final android.webkit.WebView wv = bridge.getWebView();
            wv.clearCache(true);
            wv.clearHistory();
            sp.edit().putString("version", cur).apply();
            // 覆盖安装：清完缓存主动重载，避免首屏已用旧缓存渲染。
            // 直达场景（配置页带 target 进来）：重载目标服务器而非 localhost 壳页，
            // 避免升级安装后 400ms 的重载把刚加载的服务器页冲回壳页。
            wv.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (targetUrl != null) {
                        wv.loadUrl(targetUrl);
                    } else {
                        wv.reload();
                    }
                }
            }, 400);
        } catch (Exception ignored) {
            // 取版本失败不影响主流程，下次启动会重试。
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        // 先让 Capacitor 处理自身插件的授权，再转发给自定义桥（定位授权结果 → 'perm' 事件）
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (nativeBridge != null) {
            nativeBridge.handlePermissionResult(requestCode, permissions, grantResults);
        }
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {
        // 先让 Capacitor 处理自身插件的结果，再转发给自定义桥（铃声选择器结果 → 'stickykee-ring' 事件）
        super.onActivityResult(requestCode, resultCode, data);
        if (nativeBridge != null) {
            nativeBridge.handleActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onDestroy() {
        alive = false;
        if (nativeBridge != null) {
            nativeBridge.release();
        }
        super.onDestroy();
    }

    @Override
    public void onPause() {
        super.onPause();
        foreground = false;
        if (nativeBridge != null) nativeBridge.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        foreground = true;
        if (nativeBridge != null) nativeBridge.onResume();
    }
}
