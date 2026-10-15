package cn.stickykee.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

/**
 * 开机自启动：手机重启后自动恢复常驻（微信/SOS 级保活的标配）。
 * ① 启动前台保活服务占住进程（防系统回收）；
 * ② 拉起主界面加载 WebView —— 前端检测本地令牌自动登录并重建 WebSocket，
 *    消息通知 / 来电铃声 / 传感器上报随之恢复。
 *    Android 10+ 后台启动 Activity 受限，部分 ROM（未开自启动权限）会静默拦截：
 *    此时保活服务仍会启动保住进程，用户点开 App 后立即恢复，故失败静默即可。
 * 注意：MIUI 等国产 ROM 还需用户在「应用详情 → 自启动」手动允许，设置页有引导入口。
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        // BOOT_COMPLETED / QUICKBOOT_POWERON（部分 ROM）/ MY_PACKAGE_REPLACED（覆盖更新后）
        String action = intent != null ? intent.getAction() : null;
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            return;
        }
        try {
            ContextCompat.startForegroundService(context,
                    new Intent(context, KeepAliveService.class));
        } catch (Exception ignored) {
        }
        try {
            Intent it = new Intent(context, MainActivity.class);
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(it);
        } catch (Exception ignored) {
        }
    }
}
