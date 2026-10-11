package cn.stickykee.app;

import android.graphics.Color;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/**
 * 极简原生桥：通过 WebView.addJavascriptInterface 注册为 window.StickyKeeNative。
 * JavascriptInterface 对 WebView 中【任意源】（含 allowNavigation 远程页面）可用，
 * 不依赖 Capacitor 的 JS 运行时（其桥 JS 仅注入壳页 localhost 源）。
 *
 * 前端调用：window.StickyKeeNative.setBars('#0E0F12', false)
 * 同时设置状态栏与导航栏底色；darkIcons=true 时系统图标变深色（浅色主题用）。
 */
public class NativeBridge {

    private final AppCompatActivity activity;

    public NativeBridge(AppCompatActivity activity) {
        this.activity = activity;
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
}
