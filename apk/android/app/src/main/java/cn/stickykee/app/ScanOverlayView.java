package cn.stickykee.app;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.view.View;
import android.view.animation.AccelerateDecelerateInterpolator;

/**
 * 微信风格扫码取景层：外围暗色遮罩 + 透明取景框 + 白色四角 + 上下往复扫描线。
 * 纯 Canvas 绘制（不依赖图片资源），识别成功时四角变绿、扫描线隐藏，作为结束前的反馈。
 */
public class ScanOverlayView extends View {

    private static final int COLOR_ACCENT = 0xFF07C160; // 微信绿
    private static final int COLOR_DIM = 0xB3000000;    // 70% 黑

    private final Paint dimPaint = new Paint();
    private final Paint cornerPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint laserPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint glowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF frame = new RectF();

    private ValueAnimator animator;
    private float progress = 0f;
    private boolean success = false;

    public ScanOverlayView(Context context) {
        super(context);
        dimPaint.setColor(COLOR_DIM);
        dimPaint.setStyle(Paint.Style.FILL);

        cornerPaint.setColor(Color.WHITE);
        cornerPaint.setStyle(Paint.Style.STROKE);
        cornerPaint.setStrokeWidth(dp(3));
        cornerPaint.setStrokeCap(Paint.Cap.SQUARE);

        laserPaint.setColor(COLOR_ACCENT);
        laserPaint.setStyle(Paint.Style.FILL);

        glowPaint.setColor(0x4407C160);
        glowPaint.setStyle(Paint.Style.FILL);
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        float side = Math.min(w * 0.72f, dp(300));
        float cx = w / 2f;
        float cy = h * 0.44f; // 略高于正中，底部留给提示与取消按钮
        frame.set(cx - side / 2f, cy - side / 2f, cx + side / 2f, cy + side / 2f);
        // 扫描线两端淡出，中间高亮，贴近微信的镭射观感
        laserPaint.setShader(new LinearGradient(
                frame.left + dp(12), 0, frame.right - dp(12), 0,
                new int[]{0x0007C160, COLOR_ACCENT, 0x0007C160},
                new float[]{0f, 0.5f, 1f}, Shader.TileMode.CLAMP));
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (frame.isEmpty()) return;

        // 四块暗色遮罩围出取景框，避免整层 CLEAR 带来的兼容问题
        int w = getWidth();
        int h = getHeight();
        canvas.drawRect(0, 0, w, frame.top, dimPaint);
        canvas.drawRect(0, frame.bottom, w, h, dimPaint);
        canvas.drawRect(0, frame.top, frame.left, frame.bottom, dimPaint);
        canvas.drawRect(frame.right, frame.top, w, frame.bottom, dimPaint);

        cornerPaint.setColor(success ? COLOR_ACCENT : Color.WHITE);
        float len = dp(24);
        float l = frame.left, t = frame.top, r = frame.right, b = frame.bottom;
        canvas.drawLine(l, t, l + len, t, cornerPaint);
        canvas.drawLine(l, t, l, t + len, cornerPaint);
        canvas.drawLine(r - len, t, r, t, cornerPaint);
        canvas.drawLine(r, t, r, t + len, cornerPaint);
        canvas.drawLine(l, b - len, l, b, cornerPaint);
        canvas.drawLine(l, b, l + len, b, cornerPaint);
        canvas.drawLine(r - len, b, r, b, cornerPaint);
        canvas.drawLine(r, b - len, r, b, cornerPaint);

        if (!success) {
            float pad = dp(10);
            float y = frame.top + dp(8) + (frame.height() - dp(16)) * progress;
            canvas.drawRoundRect(new RectF(l + pad, y - dp(7), r - pad, y + dp(7)),
                    dp(7), dp(7), glowPaint);
            canvas.drawRoundRect(new RectF(l + pad, y - dp(1), r - pad, y + dp(1)),
                    dp(1), dp(1), laserPaint);
        }
    }

    /** 开始上下往复扫描。 */
    public void start() {
        if (animator != null && animator.isRunning()) return;
        animator = ValueAnimator.ofFloat(0f, 1f);
        animator.setDuration(1800);
        animator.setRepeatMode(ValueAnimator.REVERSE);
        animator.setRepeatCount(ValueAnimator.INFINITE);
        animator.setInterpolator(new AccelerateDecelerateInterpolator());
        animator.addUpdateListener(a -> {
            progress = (float) a.getAnimatedValue();
            invalidate();
        });
        animator.start();
    }

    /** 停止动画（页面暂停/销毁时调用，避免后台空转）。 */
    public void stop() {
        if (animator != null) {
            animator.cancel();
            animator = null;
        }
    }

    /** 识别成功：四角变绿并停止扫描线，随后由 Activity 延迟结束页面。 */
    public void markSuccess() {
        success = true;
        stop();
        invalidate();
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }
}
