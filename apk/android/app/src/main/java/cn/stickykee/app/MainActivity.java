package cn.stickykee.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private NativeBridge nativeBridge;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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
        // 定位：navigator.geolocation 的授权弹窗与运行时权限由 Capacitor 的
        // BridgeWebChromeClient.onGeolocationPermissionsShowPrompt 处理，无需自定义包装；
        // 此前报 "User denied Geolocation" 的根因是 AndroidManifest 未声明定位权限，
        // 未声明的权限被系统直接拒绝。权限声明见 AndroidManifest.xml。
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
        if (nativeBridge != null) {
            nativeBridge.release();
        }
        super.onDestroy();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (nativeBridge != null) nativeBridge.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (nativeBridge != null) nativeBridge.onResume();
    }
}
