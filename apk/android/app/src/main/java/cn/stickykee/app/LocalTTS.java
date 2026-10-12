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
    private volatile boolean canceled = false;

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
        // 注意：jieba 词典必须走 setDictDir（dict_dir）。setDataDir 是 espeak-ng 数据目录，
        // 填错字段会导致 jieba 分词不加载、拼音全部错乱（合成出的语音无法听懂）。
        vitsConfig.setDictDir(dir + "/dict");

        OfflineTtsModelConfig modelConfig = new OfflineTtsModelConfig();
        modelConfig.setVits(vitsConfig);
        // 4 线程比 2 线程快约 1.8 倍（实测 RTF 0.75→0.41）；不宜更高：手机小核会拖慢调度
        modelConfig.setNumThreads(4);
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

    /**
     * 流式合成：按句生成，每句立即回调（含 WAV 头的独立 WAV 分片），
     * 前端可边合成边播放，首句出声无需等待全文合成完。
     * 回调在合成线程执行。合成过程中可随时 cancel() 中止剩余句子。
     */
    public interface ChunkSink {
        /** 一句合成完成，wav 为独立可播放的 WAV 分片（16bit mono）。 */
        void onChunk(byte[] wav);

        /** 全部句子合成完成（或被中止/失败）。 */
        void onDone();
    }

    /** 流式合成（阻塞至完成或被取消）。 */
    public void synthStream(final String text, final float speed, final ChunkSink sink) {
        if (text == null || text.trim().isEmpty()) {
            sink.onDone();
            return;
        }
        try {
            ensureInit();
            canceled = false;
            final int sr = tts.sampleRate();
            tts.generateWithCallback(text, 0, speed, new kotlin.jvm.functions.Function1<float[], Integer>() {
                @Override
                public Integer invoke(float[] samples) {
                    if (canceled) return 1; // sherpa-onnx 约定：回调返回 1 中止后续合成
                    if (samples != null && samples.length > 0) {
                        sink.onChunk(encodeWav(samples, sr));
                    }
                    return 0;
                }
            });
            sink.onDone();
        } catch (Exception e) {
            Log.e(TAG, "synthStream failed", e);
            sink.onDone();
        }
    }

    /** 请求中止当前合成（在下一句边界生效）。 */
    public void cancel() {
        canceled = true;
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
