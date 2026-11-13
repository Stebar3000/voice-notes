package it.stebar.noteauto;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Suoni composti (più note di seguito). I bip semplici di avvio/stop restano in RecService. */
final class Tones {

    private static final int RATE = 22050;
    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();

    private Tones() { }

    /** Quattro note che salgono, lunghe: "tutto consegnato". Inconfondibile rispetto agli altri suoni. */
    static void done() {
        play(new int[]{523, 659, 784, 1047}, new int[]{170, 170, 170, 520}, 0.55f);
    }

    /** Tre note che salgono e una più alta: "rapporto di Nero pronto". Diverso da "tutto consegnato". */
    static void report() {
        play(new int[]{784, 988, 1175, 1568}, new int[]{140, 140, 140, 360}, 0.5f);
    }

    /** Due bip gravi: errore. */
    static void error() {
        play(new int[]{220, 0, 220}, new int[]{260, 120, 260}, 0.6f);
    }

    /** Due note che scendono: registrazione troppo breve, scartata. */
    static void tooShort() {
        play(new int[]{660, 440}, new int[]{140, 220}, 0.5f);
    }

    /** freq 0 = pausa. */
    private static void play(final int[] freq, final int[] ms, final float amp) {
        EXEC.execute(() -> {
            AudioTrack t = null;
            try {
                int total = 0;
                for (int m : ms) total += RATE * m / 1000;
                short[] pcm = new short[total];
                int pos = 0;
                for (int i = 0; i < freq.length; i++) {
                    int n = RATE * ms[i] / 1000;
                    int fade = Math.min(n / 4, RATE / 100); // 10 ms di dissolvenza: niente "click"
                    for (int k = 0; k < n; k++) {
                        double v = freq[i] == 0 ? 0 : Math.sin(2 * Math.PI * freq[i] * k / RATE);
                        double env = 1.0;
                        if (k < fade) env = (double) k / fade;
                        else if (k > n - fade) env = (double) (n - k) / fade;
                        pcm[pos++] = (short) (v * env * amp * 32767);
                    }
                }
                t = new AudioTrack.Builder()
                        .setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .build())
                        .setAudioFormat(new AudioFormat.Builder()
                                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .setSampleRate(RATE)
                                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                                .build())
                        .setBufferSizeInBytes(pcm.length * 2)
                        .setTransferMode(AudioTrack.MODE_STATIC)
                        .build();
                t.write(pcm, 0, pcm.length);
                t.play();
                long end = System.currentTimeMillis() + total * 1000L / RATE + 150;
                while (System.currentTimeMillis() < end) {
                    try { Thread.sleep(40); } catch (InterruptedException e) { break; }
                }
            } catch (Exception e) {
                RecService.log("Suono non riprodotto: " + e);
            } finally {
                if (t != null) {
                    try { t.release(); } catch (Exception ignored) { }
                }
            }
        });
    }
}
