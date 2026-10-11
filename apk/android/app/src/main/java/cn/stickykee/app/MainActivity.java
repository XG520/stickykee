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
    }

    @Override
    public void onDestroy() {
        if (nativeBridge != null) {
            nativeBridge.release();
        }
        super.onDestroy();
    }
}
