package it.stebar.noteauto;

import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.ShortBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Da audio compresso (.m4a) a PCM mono 16 kHz 16 bit su file, e taglio sulle pause in segmenti da dare al riconoscitore.
 * Niente resta tutto in memoria: il PCM va su un file temporaneo.
 */
final class Pcm {

    static final int RATE = 16000;
    static final int BYTES_PER_SEC = RATE * 2;

    private static final int WIN_SAMPLES = RATE / 50;        // finestre da 20 ms
    private static final int WIN_BYTES = WIN_SAMPLES * 2;
    private static final int MIN_PAUSE_WIN = 30;              // pausa che autorizza il taglio: 600 ms
    private static final int MIN_SEG_WIN = 150;               // segmento minimo prima di un taglio su pausa: 3 s
    private static final int MAX_SEG_WIN = 1250;              // taglio forzato: 25 s
    private static final int FORCED_LOOKBACK_WIN = 250;       // il taglio forzato cerca il punto più quieto negli ultimi 5 s
    private static final int MARGIN_WIN = 5;                  // 100 ms di margine prima dell'inizio del parlato
    private static final float MIN_ABS_THRESHOLD = 120f;      // sotto questo RMS è sempre silenzio

    private Pcm() { }

    /** Elimina i .pcm temporanei rimasti nella cache (da chiamare quando non si sta trascrivendo). */
    static void pulisciCache(Context c) {
        File[] fs = c.getCacheDir().listFiles((d, n) -> n.startsWith("tr-") && n.endsWith(".pcm"));
        if (fs == null) return;
        for (File f : fs) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    // ---------- decodifica ----------

    /** Ricampionatore lineare a flusso: media i canali e produce campioni a 16 kHz. */
    private static final class Resampler {
        private final OutputStream os;
        private final byte[] buf = new byte[8192];
        private int fill;
        private double ratio;      // campioni in ingresso per ogni campione in uscita
        private double pos;        // posizione (in campioni d'ingresso) del prossimo campione da produrre
        private long idx;          // indice del campione d'ingresso in arrivo
        private double prev;

        Resampler(OutputStream os, int inRate) {
            this.os = os;
            setRate(inRate);
        }

        void setRate(int inRate) {
            ratio = inRate / (double) RATE;
        }

        void feed(ShortBuffer sb, int ch) throws IOException {
            if (ch < 1) ch = 1;
            while (sb.remaining() >= ch) {
                int sum = 0;
                for (int k = 0; k < ch; k++) sum += sb.get();
                step(sum / (double) ch);
            }
        }

        private void step(double s) throws IOException {
            if (idx == 0) prev = s;
            while (pos <= idx) {
                double frac = pos - (idx - 1);
                if (frac < 0) frac = 0;
                if (frac > 1) frac = 1;
                put((int) Math.round(prev + (s - prev) * frac));
                pos += ratio;
            }
            prev = s;
            idx++;
        }

        private void put(int v) throws IOException {
            if (v > 32767) v = 32767;
            if (v < -32768) v = -32768;
            buf[fill++] = (byte) (v & 0xff);
            buf[fill++] = (byte) ((v >> 8) & 0xff);
            if (fill >= buf.length) flush();
        }

        void flush() throws IOException {
            if (fill > 0) {
                os.write(buf, 0, fill);
                fill = 0;
            }
        }
    }

    /** Decodifica la traccia audio di {@code in} e scrive PCM mono 16 kHz 16 bit little endian in {@code out}. */
    static void decodifica(File in, File out) throws IOException {
        MediaExtractor ex = new MediaExtractor();
        MediaCodec codec = null;
        try (OutputStream os = new BufferedOutputStream(new FileOutputStream(out), 1 << 16)) {
            ex.setDataSource(in.getAbsolutePath());
            int track = -1;
            MediaFormat fmt = null;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat f = ex.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    track = i;
                    fmt = f;
                    break;
                }
            }
            if (track < 0) throw new IOException("nessuna traccia audio");
            ex.selectTrack(track);
            int rate = fmt.containsKey(MediaFormat.KEY_SAMPLE_RATE) ? fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 44100;
            int ch = fmt.containsKey(MediaFormat.KEY_CHANNEL_COUNT) ? fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 1;
            codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME));
            codec.configure(fmt, null, null, 0);
            codec.start();

            Resampler rs = new Resampler(os, rate);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inDone = false, outDone = false;
            int idle = 0;
            while (!outDone) {
                if (!inDone) {
                    int ii = codec.dequeueInputBuffer(10000);
                    if (ii >= 0) {
                        ByteBuffer b = codec.getInputBuffer(ii);
                        int sz = b == null ? -1 : ex.readSampleData(b, 0);
                        if (sz < 0) {
                            codec.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inDone = true;
                        } else {
                            codec.queueInputBuffer(ii, 0, sz, ex.getSampleTime(), 0);
                            ex.advance();
                        }
                    }
                }
                int oi = codec.dequeueOutputBuffer(info, 10000);
                if (oi >= 0) {
                    idle = 0;
                    ByteBuffer ob = codec.getOutputBuffer(oi);
                    if (ob != null && info.size > 0) {
                        ob.position(info.offset);
                        ob.limit(info.offset + info.size);
                        ob.order(ByteOrder.LITTLE_ENDIAN);
                        rs.feed(ob.asShortBuffer(), ch);
                    }
                    codec.releaseOutputBuffer(oi, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outDone = true;
                } else if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat of = codec.getOutputFormat();
                    if (of.containsKey(MediaFormat.KEY_SAMPLE_RATE)) rs.setRate(of.getInteger(MediaFormat.KEY_SAMPLE_RATE));
                    if (of.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) ch = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                } else if (oi == MediaCodec.INFO_TRY_AGAIN_LATER) {
                    if (++idle > 2000) throw new IOException("decodifica bloccata");
                }
            }
            rs.flush();
        } catch (RuntimeException e) {
            throw new IOException("decodifica non riuscita: " + e);
        } finally {
            if (codec != null) {
                try { codec.stop(); } catch (RuntimeException ignored) { }
                try { codec.release(); } catch (RuntimeException ignored) { }
            }
            ex.release();
        }
    }

    // ---------- segmentazione ----------

    /** Energia (RMS) per finestre da 20 ms. */
    static float[] energie(File pcm) throws IOException {
        float[] e = new float[1024];
        int n = 0;
        byte[] b = new byte[WIN_BYTES];
        try (InputStream in = new BufferedInputStream(new FileInputStream(pcm), 1 << 16)) {
            while (true) {
                int len = 0;
                while (len < WIN_BYTES) {
                    int r = in.read(b, len, WIN_BYTES - len);
                    if (r < 0) break;
                    len += r;
                }
                if (len < 2) break;
                double sum = 0;
                int cnt = len / 2;
                for (int i = 0; i < cnt; i++) {
                    int v = (short) ((b[2 * i] & 0xff) | (b[2 * i + 1] << 8));
                    sum += (double) v * v;
                }
                if (n == e.length) e = Arrays.copyOf(e, n * 2);
                e[n++] = (float) Math.sqrt(sum / cnt);
                if (len < WIN_BYTES) break;
            }
        }
        return Arrays.copyOf(e, n);
    }

    /** Soglia di silenzio adattiva: relativa al rumore di fondo (10° percentile), con minimo assoluto. */
    static float soglia(float[] e) {
        if (e.length == 0) return MIN_ABS_THRESHOLD;
        float[] s = e.clone();
        Arrays.sort(s);
        float noise = s[(int) (s.length * 0.10)];
        float loud = s[Math.min(s.length - 1, (int) (s.length * 0.90))];
        return Math.max(MIN_ABS_THRESHOLD, Math.min(noise * 3f, loud * 0.3f));
    }

    /** Intervalli [inizio, fine) in byte del file PCM, da dare uno per volta al riconoscitore. */
    static List<long[]> segmenta(File pcm) throws IOException {
        return segmenta(energie(pcm));
    }

    static List<long[]> segmenta(float[] e) {
        List<long[]> out = new ArrayList<>();
        int n = e.length;
        float thr = soglia(e);
        int start = saltaSilenzio(e, thr, 0);
        int w = start;
        int runStart = -1;
        while (w < n) {
            if (e[w] < thr) {
                if (runStart < 0) runStart = w;
                if (w - runStart + 1 >= MIN_PAUSE_WIN && w - start >= MIN_SEG_WIN) {
                    int cut = runStart + MIN_PAUSE_WIN / 2;
                    aggiungi(out, e, thr, start, cut);
                    start = saltaSilenzio(e, thr, cut);
                    w = Math.max(start, cut);
                    runStart = -1;
                    continue;
                }
            } else {
                runStart = -1;
            }
            if (w - start >= MAX_SEG_WIN) {
                int from = Math.max(start + 1, w - FORCED_LOOKBACK_WIN);
                int best = from;
                float bestE = Float.MAX_VALUE;
                for (int i = from; i <= w; i++) {
                    if (e[i] < bestE) {
                        bestE = e[i];
                        best = i;
                    }
                }
                aggiungi(out, e, thr, start, best);
                start = saltaSilenzio(e, thr, best);
                w = Math.max(start, best);
                runStart = -1;
                continue;
            }
            w++;
        }
        if (start < n) aggiungi(out, e, thr, start, n);
        return out;
    }

    /** Primo indice non silenzioso a partire da {@code from}, meno un piccolo margine (mai prima di from); n se non c'è. */
    private static int saltaSilenzio(float[] e, float thr, int from) {
        int i = from;
        while (i < e.length && e[i] < thr) i++;
        if (i >= e.length) return e.length;
        return Math.max(from, i - MARGIN_WIN);
    }

    /** Aggiunge [s, t) se contiene parlato; toglie il silenzio in coda. */
    private static void aggiungi(List<long[]> out, float[] e, float thr, int s, int t) {
        if (t > e.length) t = e.length;
        int last = -1;
        for (int i = t - 1; i >= s; i--) {
            if (e[i] >= thr) {
                last = i;
                break;
            }
        }
        if (last < 0) return; // solo silenzio
        int end = Math.min(t, last + 1 + 15);
        out.add(new long[]{(long) s * WIN_BYTES, (long) end * WIN_BYTES});
    }
}
