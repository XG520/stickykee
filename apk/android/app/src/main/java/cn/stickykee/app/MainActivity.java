package cn.stickykee.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 注册对所有源（壳页 + allowNavigation 远程页面）可用的极简原生桥，
        // 用于系统栏主题配色；远程页没有 Capacitor JS 运行时，只能走 JavascriptInterface。
        bridge.getWebView().addJavascriptInterface(new NativeBridge(this), "StickyKeeNative");
    }
}
