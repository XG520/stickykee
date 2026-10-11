package cn.stickykee.app;

import android.content.Context;
import android.util.Base64;
import android.util.Log;

import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;

/**
 * APK 本地离线 TTS：基于 sherpa-onnx + MeloTTS 中文模型。
 *
 * 模型文件打包在 assets/sherpa-onnx-tts/，sherpa-onnx 的 Android 构造函数
 * 接收 AssetManager，可直接从 assets 读取模型，无需复制到内部存储。
 * 所有推理在设备本地完成，完全无需网络。
 *
 * 通过 NativeBridge.speakLocal() 暴露给前端。
 */
public class LocalTTS {

    private static final String TAG = "LocalTTS";
    private static final String MODEL_DIR = "sherpa-onnx-tts";

    private final Context context;
    private OfflineTts tts;

    public LocalTTS(Context context) {
        this.context = context.getApplicationContext();
    }

    /** 初始化 TTS 引擎（懒加载，首次调用时创建实例）。 */
    private synchronized void ensureInit() throws Exception {
        if (tts != null) return;

        // 模型路径相对于 assets 目录
        String dir = MODEL_DIR;
        OfflineTtsVitsModelConfig vitsConfig = new OfflineTtsVitsModelConfig();
        vitsConfig.setModel(dir + "/model.onnx");
        vitsConfig.setTokens(dir + "/tokens.txt");
        vitsConfig.setLexicon(dir + "/lexicon.txt");
        vitsConfig.setDataDir(dir + "/dict");

        OfflineTtsModelConfig modelConfig = new OfflineTtsModelConfig();
        modelConfig.setVits(vitsConfig);
        modelConfig.setNumThreads(2);
        modelConfig.setDebug(false);

        // MeloTTS 中文需要 phone/date/number/heteronym 规则 FST
        String ruleFsts = dir + "/phone.fst," + dir + "/date.fst,"
                + dir + "/number.fst," + dir + "/new_heteronym.fst";

        OfflineTtsConfig config = new OfflineTtsConfig();
        config.setModel(modelConfig);
        config.setRuleFsts(ruleFsts);

        // Android 构造函数接收 AssetManager，直接从 assets 读取模型
        tts = new OfflineTts(context.getAssets(), config);
        Log.i(TAG, "LocalTTS initialized, sampleRate=" + tts.sampleRate()
                + ", numSpeakers=" + tts.numSpeakers());
    }

    /**
     * 合成语音，返回 Base64 编码的 WAV 音频。
     *
     * @param text  文本
     * @param speed 语速（1.0 = 正常）
     * @return Base64 WAV 字符串，失败返回空串
     */
    public String synth(String text, float speed) {
        if (text == null || text.trim().isEmpty()) return "";
        try {
            ensureInit();
            int sid = 0; // MeloTTS zh_en 只有 1 个说话人
            GeneratedAudio audio = tts.generate(text, sid, speed);
            float[] samples = audio.getSamples();
            int sampleRate = audio.getSampleRate();
            byte[] wav = encodeWav(samples, sampleRate);
            return Base64.encodeToString(wav, Base64.NO_WRAP);
        } catch (Exception e) {
            Log.e(TAG, "synth failed", e);
            return "";
        }
    }

    /** 将 float[] 采样编码为 WAV 字节数组（16-bit PCM mono）。 */
    private byte[] encodeWav(float[] samples, int sampleRate) {
        int numChannels = 1;
        int bytesPerSample = 2;
        int blockAlign = numChannels * bytesPerSample;
        int byteRate = sampleRate * blockAlign;
        int dataSize = samples.length * bytesPerSample;
        byte[] buffer = new byte[44 + dataSize];

        buffer[0] = 'R'; buffer[1] = 'I'; buffer[2] = 'F'; buffer[3] = 'F';
        writeInt(buffer, 4, 36 + dataSize);
        buffer[8] = 'W'; buffer[9] = 'A'; buffer[10] = 'V'; buffer[11] = 'E';

        buffer[12] = 'f'; buffer[13] = 'm'; buffer[14] = 't'; buffer[15] = ' ';
        writeInt(buffer, 16, 16);
        writeShort(buffer, 20, (short) 1);
        writeShort(buffer, 22, (short) numChannels);
        writeInt(buffer, 24, sampleRate);
        writeInt(buffer, 28, byteRate);
        writeShort(buffer, 32, (short) blockAlign);
        writeShort(buffer, 34, (short) 16);

        buffer[36] = 'd'; buffer[37] = 'a'; buffer[38] = 't'; buffer[39] = 'a';
        writeInt(buffer, 40, dataSize);

        int offset = 44;
        for (float s : samples) {
            int v = (int) (Math.max(-1, Math.min(1, s)) * 32767);
            buffer[offset++] = (byte) (v & 0xFF);
            buffer[offset++] = (byte) ((v >> 8) & 0xFF);
        }
        return buffer;
    }

    private void writeInt(byte[] b, int off, int val) {
        b[off] = (byte) (val & 0xFF);
        b[off + 1] = (byte) ((val >> 8) & 0xFF);
        b[off + 2] = (byte) ((val >> 16) & 0xFF);
        b[off + 3] = (byte) ((val >> 24) & 0xFF);
    }

    private void writeShort(byte[] b, int off, short val) {
        b[off] = (byte) (val & 0xFF);
        b[off + 1] = (byte) ((val >> 8) & 0xFF);
    }

    /** 释放 TTS 资源。 */
    public void release() {
        if (tts != null) {
            try { tts.release(); } catch (Exception ignored) {}
            tts = null;
        }
    }
}
