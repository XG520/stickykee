package cn.stickykee.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 库存扫码页：全屏 CameraX 预览 + ML Kit bundled 条码识别。
 *
 * 由 NativeBridge.scanBarcode(req) 拉起，识别到首个条码（或权限拒绝/取消/相机失败）后
 * 立即结束，并通过 NativeBridge.deliverScan 向 WebView 派发 stickykee-scan 事件：
 * detail = {req, ok, value, format, message}。
 */
public class BarcodeScannerActivity extends AppCompatActivity {

    public static final String EXTRA_REQ = "req";

    private static final int REQ_CAMERA = 5001;

    private final BarcodeScanner scanner = BarcodeScanning.getClient();
    private final ExecutorService analysisExecutor = Executors.newSingleThreadExecutor();
    // 只回传一次：识别成功、权限拒绝、取消可能先后触发
    private final AtomicBoolean finished = new AtomicBoolean(false);

    private String req = "";
    private PreviewView previewView;
    private ProcessCameraProvider cameraProvider;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        req = getIntent().getStringExtra(EXTRA_REQ);
        if (req == null) req = "";

        // 全屏取景：隐藏状态栏，黑色背景避免相机启动前白闪
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);

        previewView = new PreviewView(this);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        root.addView(previewView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        TextView hint = new TextView(this);
        hint.setText("将条码置于取景框内");
        hint.setTextColor(Color.WHITE);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        hint.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams hintParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        hintParams.topMargin = dp(72);
        root.addView(hint, hintParams);

        Button cancel = new Button(this);
        cancel.setText("取消");
        cancel.setAllCaps(false);
        cancel.setOnClickListener(v -> finishWithResult(false, "", "", "已取消"));
        FrameLayout.LayoutParams cancelParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        cancelParams.bottomMargin = dp(72);
        root.addView(cancel, cancelParams);

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            // 运行时申请相机权限；拒绝时 finishWithResult 回传失败
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_CAMERA) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            finishWithResult(false, "", "", "未授予相机权限");
        }
    }

    private void startCamera() {
        final ListenableFuture<ProcessCameraProvider> future =
                ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                cameraProvider = future.get();
                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());

                ImageAnalysis analysis = new ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build();
                analysis.setAnalyzer(analysisExecutor, this::analyze);

                cameraProvider.unbindAll();
                cameraProvider.bindToLifecycle(this,
                        CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis);
            } catch (Exception e) {
                finishWithResult(false, "", "", "相机启动失败: " + e.getMessage());
            }
        }, ContextCompat.getMainExecutor(this));
    }

    /** 分析单帧：识别到首个有效条码即结束回传；单帧失败静默跳过，继续下一帧。 */
    private void analyze(ImageProxy imageProxy) {
        if (finished.get() || imageProxy.getImage() == null) {
            imageProxy.close();
            return;
        }
        InputImage image = InputImage.fromMediaImage(
                imageProxy.getImage(), imageProxy.getImageInfo().getRotationDegrees());
        scanner.process(image)
                .addOnSuccessListener(barcodes -> {
                    if (finished.get()) return;
                    for (Barcode barcode : barcodes) {
                        String value = firstNonEmpty(barcode.getRawValue(), barcode.getDisplayValue());
                        if (value != null) {
                            finishWithResult(true, value, formatName(barcode.getFormat()), "");
                            return;
                        }
                    }
                })
                .addOnFailureListener(e -> { /* 单帧识别失败忽略 */ })
                .addOnCompleteListener(task -> imageProxy.close());
    }

    private static String firstNonEmpty(String a, String b) {
        if (a != null && !a.trim().isEmpty()) return a;
        if (b != null && !b.trim().isEmpty()) return b;
        return null;
    }

    @Override
    public void onBackPressed() {
        finishWithResult(false, "", "", "已取消");
    }

    /** 结束并回传（只生效一次）。回传统一走 NativeBridge 的静态事件派发。 */
    private void finishWithResult(final boolean ok, final String value,
                                  final String format, final String message) {
        if (!finished.compareAndSet(false, true)) return;
        NativeBridge.deliverScan(req, ok, value, format, message);
        runOnUiThread(this::finish);
    }

    private static String formatName(int format) {
        switch (format) {
            case Barcode.FORMAT_CODE_128: return "CODE_128";
            case Barcode.FORMAT_CODE_39: return "CODE_39";
            case Barcode.FORMAT_CODE_93: return "CODE_93";
            case Barcode.FORMAT_CODABAR: return "CODABAR";
            case Barcode.FORMAT_DATA_MATRIX: return "DATA_MATRIX";
            case Barcode.FORMAT_EAN_13: return "EAN_13";
            case Barcode.FORMAT_EAN_8: return "EAN_8";
            case Barcode.FORMAT_ITF: return "ITF";
            case Barcode.FORMAT_QR_CODE: return "QR_CODE";
            case Barcode.FORMAT_UPC_A: return "UPC_A";
            case Barcode.FORMAT_UPC_E: return "UPC_E";
            case Barcode.FORMAT_PDF417: return "PDF417";
            case Barcode.FORMAT_AZTEC: return "AZTEC";
            default: return "UNKNOWN";
        }
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    @Override
    protected void onDestroy() {
        if (cameraProvider != null) cameraProvider.unbindAll();
        try {
            scanner.close();
        } catch (Exception ignored) {
        }
        analysisExecutor.shutdown();
        super.onDestroy();
    }
}
