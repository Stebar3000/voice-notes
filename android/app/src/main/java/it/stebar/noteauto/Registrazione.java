package it.stebar.noteauto;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;

/**
 * Una registrazione: un solo microfono (AudioRecord, 16 kHz mono 16 bit) e due uscite in diretta: il file .wav
 * (copia di sicurezza, scritto in continuo) e il riconoscitore ({@link Diretta}). Un guadagno digitale automatico
 * prudente alza i volumi bassi, senza clipping, per tutte e due le uscite.
 */
final class Registrazione {

    private static final int CHUNK = 1600;               // 100 ms
    private static final float TARGET = 16000f;          // picco obiettivo (circa metà della scala)
    private static final float MAX_GAIN = 8f;
    private static final float ENV_FLOOR = 1500f;        // il silenzio non viene gonfiato oltre MAX_GAIN
    private static final long HEADER_EVERY = 5L * Pcm.BYTES_PER_SEC;

    /** Numeri di una registrazione finita. */
    static final class Stats {
        int sec;
        int medio;           // livello medio (RMS) del segnale originale, su 32767
        int picco;           // picco del segnale originale
        float guadagnoMax;
        String guasto = "";
    }

    private final Context app;
    private final File wav;
    private AudioRecord ar;
    private RandomAccessFile raf;
    private Thread th;
    private Diretta diretta;
    private volatile boolean run;
    private volatile int piccoRecente;
    private volatile String guasto = "";

    // numeri scritti solo dal thread di registrazione, letti dopo il join
    private long totale;           // byte scritti nel wav
    private double sommaQuadrati;
    private long campioni;
    private int piccoTot;
    private float guadagnoMax = 1f;

    Registrazione(Context ctx, File wav) {
        this.app = ctx.getApplicationContext();
        this.wav = wav;
    }

    private static AudioRecord crea(int source, int buf) {
        try {
            AudioRecord r = new AudioRecord(source, Pcm.RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, buf);
            if (r.getState() == AudioRecord.STATE_INITIALIZED) return r;
            r.release();
        } catch (RuntimeException ignored) {
            // permesso o dispositivo non disponibile
        }
        return null;
    }

    /** Apre il microfono e il file e parte. Lancia IOException se non si riesce. */
    void avvia() throws IOException {
        int min = AudioRecord.getMinBufferSize(Pcm.RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        int buf = Math.max(min > 0 ? min * 4 : 0, Pcm.BYTES_PER_SEC * 2);
        ar = crea(MediaRecorder.AudioSource.VOICE_RECOGNITION, buf);
        if (ar == null) ar = crea(MediaRecorder.AudioSource.MIC, buf);
        if (ar == null) throw new IOException("microfono non disponibile");
        raf = new RandomAccessFile(wav, "rw");
        raf.setLength(0);
        Wav.scriviIntestazione(raf, 0);
        try {
            ar.startRecording();
        } catch (RuntimeException e) {
            chiudiTutto();
            throw new IOException("avvio del microfono non riuscito: " + e);
        }
        if (ar.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
            chiudiTutto();
            throw new IOException("il microfono non parte");
        }
        if (Diretta.possibile(app)) diretta = Diretta.avvia(app);
        run = true;
        th = new Thread(this::ciclo, "registrazione");
        th.start();
    }

    private void chiudiTutto() {
        if (ar != null) {
            try { ar.release(); } catch (RuntimeException ignored) { }
            ar = null;
        }
        if (raf != null) {
            try { raf.close(); } catch (IOException ignored) { }
            raf = null;
        }
    }

    private void ciclo() {
        short[] sb = new short[CHUNK];
        float env = 0f, gain = 1f;
        long ultimaIntestazione = 0;
        int errori = 0;
        try {
            while (run) {
                int n = ar.read(sb, 0, sb.length);
                if (n <= 0) {
                    if (!run) break;
                    if (n < 0 && ++errori > 20) {
                        guasto = "lettura del microfono fallita (" + n + ")";
                        break;
                    }
                    continue;
                }
                errori = 0;
                int p = 0;
                double sq = 0;
                for (int i = 0; i < n; i++) {
                    int v = sb[i];
                    int a = v < 0 ? -v : v;
                    if (a > p) p = a;
                    sq += (double) v * v;
                }
                sommaQuadrati += sq;
                campioni += n;
                if (p > piccoTot) piccoTot = p;
                if (p > piccoRecente) piccoRecente = p;

                // guadagno: verso il picco obiettivo, con limite massimo; scende subito, sale piano; mai oltre il fondo scala
                env = Math.max(p, env * 0.995f);
                float desiderato = Math.max(1f, Math.min(MAX_GAIN, TARGET / Math.max(env, ENV_FLOOR)));
                if (desiderato < gain) gain = desiderato; else gain += 0.05f * (desiderato - gain);
                float g = p > 0 ? Math.min(gain, 32000f / p) : gain;
                if (g > guadagnoMax) guadagnoMax = g;

                byte[] out = new byte[n * 2];
                for (int i = 0; i < n; i++) {
                    int v = Math.round(sb[i] * g);
                    if (v > 32767) v = 32767;
                    if (v < -32768) v = -32768;
                    out[2 * i] = (byte) (v & 0xff);
                    out[2 * i + 1] = (byte) ((v >> 8) & 0xff);
                }
                raf.write(out);
                totale += out.length;
                if (diretta != null) diretta.offri(out);
                if (totale - ultimaIntestazione >= HEADER_EVERY) {
                    ultimaIntestazione = totale;
                    Wav.scriviIntestazione(raf, totale);
                    raf.getFD().sync();
                }
            }
        } catch (IOException e) {
            guasto = "scrittura del file fallita: " + e.getMessage();
        } catch (RuntimeException e) {
            guasto = "errore: " + e;
        }
    }

    /** Il picco (0-32767) del segnale originale dall'ultima chiamata. */
    int ampMax() {
        int p = piccoRecente;
        piccoRecente = 0;
        return p;
    }

    String guasto() { return guasto; }

    /** Ferma il microfono e chiude il wav con l'intestazione giusta. Non tocca il riconoscitore. */
    Stats ferma() {
        run = false;
        if (ar != null) {
            try { ar.stop(); } catch (RuntimeException ignored) { }
        }
        if (th != null) {
            try { th.join(3000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        try {
            if (raf != null) {
                Wav.scriviIntestazione(raf, totale);
                raf.getFD().sync();
            }
        } catch (IOException e) {
            guasto = "chiusura del file: " + e.getMessage();
        }
        chiudiTutto();
        Stats s = new Stats();
        s.sec = (int) (totale / Pcm.BYTES_PER_SEC);
        s.medio = campioni > 0 ? (int) Math.sqrt(sommaQuadrati / campioni) : 0;
        s.picco = piccoTot;
        s.guadagnoMax = guadagnoMax;
        s.guasto = guasto;
        return s;
    }

    /** Bloccante (fino a ~10 s): fine dell'audio al riconoscitore e testo finale. Vuoto se la diretta non c'era o non ha dato testo. */
    String chiudiDiretta() {
        return diretta == null ? "" : diretta.chiudi();
    }

    String riepilogoDiretta() {
        return diretta == null ? "diretta non attiva" : diretta.riepilogo();
    }
}
