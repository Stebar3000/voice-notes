package it.stebar.noteauto;

import android.content.Context;
import android.content.Intent;
import android.media.AudioFormat;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.speech.RecognitionListener;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Trascrizione sul telefono (senza rete) con il riconoscitore vocale di Android, dal file registrato:
 * m4a -> PCM 16 kHz -> segmenti sulle pause -> un segmento per volta al riconoscitore, passato in una pipe
 * (RecognizerIntent.EXTRA_AUDIO_SOURCE, API 33+). Tutte le chiamate a SpeechRecognizer stanno sul thread principale.
 */
final class VoceLocale {

    private static final Object LOCK = new Object(); // mai due sessioni di riconoscimento insieme
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final int SILENCE_AFTER_MS = 800;
    private static final long STOP_DELAY_MS = 300;

    private VoceLocale() { }

    /** Esito di una nota intera. */
    static final class Esito {
        boolean ok;          // almeno un segmento con testo e nessun errore vero
        boolean vuoto;       // nessun errore ma nessun testo
        boolean nonDisponibile;
        String testo = "";
        String errore = "";
        int segmenti;
        int falliti;
        int durSec;
        long ms;
    }

    static boolean disponibile(Context ctx) {
        if (Build.VERSION.SDK_INT < 33) return false;
        try {
            return SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx) || SpeechRecognizer.isRecognitionAvailable(ctx);
        } catch (RuntimeException e) {
            return false;
        }
    }

    // ---------- thread principale ----------

    private static void sulMain(Runnable r) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            r.run();
            return;
        }
        final CountDownLatch l = new CountDownLatch(1);
        MAIN.post(() -> {
            try {
                r.run();
            } finally {
                l.countDown();
            }
        });
        try {
            l.await(10, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** Da chiamare sul thread principale. */
    private static SpeechRecognizer crea(Context ctx) {
        if (Build.VERSION.SDK_INT < 33) return null;
        if (SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)) return SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx);
        if (SpeechRecognizer.isRecognitionAvailable(ctx)) return SpeechRecognizer.createSpeechRecognizer(ctx);
        return null;
    }

    private static Intent intentBase() {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "it-IT");
        i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        if (Build.VERSION.SDK_INT >= 33) {
            i.putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY);
        }
        return i;
    }

    // ---------- un segmento ----------

    private static final int OK = 0, TIMEOUT = -2, NON_DISP = -1;

    /** Esito di un tentativo su un segmento: errore 0 = testo valido (anche vuoto). */
    private static final class Ris {
        int errore;
        String testo = "";
    }

    private static Ris riconosci(final Context ctx, final File pcm, final long da, final long a) {
        final Ris ris = new Ris();
        final CountDownLatch fine = new CountDownLatch(1);
        final SpeechRecognizer[] rec = new SpeechRecognizer[1];
        final AtomicBoolean finito = new AtomicBoolean(false);
        ParcelFileDescriptor[] pipe = null;
        Thread scrittore = null;
        try {
            pipe = ParcelFileDescriptor.createPipe();
            final ParcelFileDescriptor lettura = pipe[0];
            final ParcelFileDescriptor scrittura = pipe[1];
            final long durataMs = (a - da) * 1000L / Pcm.BYTES_PER_SEC;

            sulMain(() -> {
                SpeechRecognizer r = crea(ctx);
                if (r == null) {
                    ris.errore = NON_DISP;
                    finito.set(true);
                    fine.countDown();
                    return;
                }
                rec[0] = r;
                r.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(Bundle params) { }

                    @Override public void onBeginningOfSpeech() { }

                    @Override public void onRmsChanged(float rmsdB) { }

                    @Override public void onBufferReceived(byte[] buffer) { }

                    @Override public void onEndOfSpeech() { }

                    @Override
                    public void onError(int error) {
                        if (!finito.compareAndSet(false, true)) return;
                        ris.errore = error == 0 ? -3 : error;
                        fine.countDown();
                    }

                    @Override
                    public void onResults(Bundle results) {
                        if (!finito.compareAndSet(false, true)) return;
                        ArrayList<String> l = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        ris.testo = l != null && !l.isEmpty() && l.get(0) != null ? l.get(0).trim() : "";
                        fine.countDown();
                    }

                    @Override public void onPartialResults(Bundle partialResults) { }

                    @Override public void onEvent(int eventType, Bundle params) { }
                });
                Intent i = intentBase();
                i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, lettura);
                i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1);
                i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
                i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, Pcm.RATE);
                try {
                    r.startListening(i);
                } catch (RuntimeException e) {
                    if (finito.compareAndSet(false, true)) {
                        ris.errore = NON_DISP;
                        fine.countDown();
                    }
                }
            });

            if (!finito.get() || ris.errore == 0) {
                scrittore = new Thread(() -> {
                    try (OutputStream os = new ParcelFileDescriptor.AutoCloseOutputStream(scrittura);
                         RandomAccessFile raf = new RandomAccessFile(pcm, "r")) {
                        raf.seek(da);
                        byte[] buf = new byte[8192];
                        long left = a - da;
                        while (left > 0 && !finito.get()) {
                            int r = raf.read(buf, 0, (int) Math.min(buf.length, left));
                            if (r < 0) break;
                            os.write(buf, 0, r);
                            left -= r;
                        }
                        if (!finito.get()) os.write(new byte[Pcm.BYTES_PER_SEC * SILENCE_AFTER_MS / 1000]);
                    } catch (IOException ignored) {
                        // pipe chiusa dall'altro lato: l'esito arriva dal riconoscitore o dal limite di tempo
                    }
                    try {
                        Thread.sleep(STOP_DELAY_MS);
                    } catch (InterruptedException e) {
                        return;
                    }
                    if (!finito.get()) {
                        sulMain(() -> {
                            if (!finito.get() && rec[0] != null) {
                                try { rec[0].stopListening(); } catch (RuntimeException ignored) { }
                            }
                        });
                    }
                }, "voce-pipe");
                scrittore.setDaemon(true);
                scrittore.start();
            }

            boolean arrivato = false;
            try {
                arrivato = fine.await(durataMs * 3 + 20_000, TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            if (!arrivato) {
                finito.set(true);
                ris.errore = TIMEOUT;
            }
        } catch (IOException e) {
            finito.set(true);
            ris.errore = NON_DISP;
        } finally {
            finito.set(true);
            sulMain(() -> {
                SpeechRecognizer r = rec[0];
                if (r != null) {
                    try { r.cancel(); } catch (RuntimeException ignored) { }
                    try { r.destroy(); } catch (RuntimeException ignored) { }
                }
            });
            if (pipe != null) {
                try { pipe[0].close(); } catch (IOException ignored) { }
                try { pipe[1].close(); } catch (IOException ignored) { }
            }
            if (scrittore != null) {
                try { scrittore.join(2000); } catch (InterruptedException ignored) { }
            }
        }
        return ris;
    }

    // ---------- una nota ----------

    /** Bloccante: da chiamare fuori dal thread principale. Non cambia nulla nella scheda della nota. */
    static Esito trascrivi(Context ctx, File audio) {
        final Context app = ctx.getApplicationContext();
        Esito es = new Esito();
        long t0 = SystemClock.elapsedRealtime();
        File pcm = new File(app.getCacheDir(), "tr-" + System.nanoTime() + ".pcm");
        synchronized (LOCK) {
            try {
                if (!disponibile(app)) {
                    es.nonDisponibile = true;
                    es.errore = "riconoscitore non disponibile";
                    return es;
                }
                Pcm.decodifica(audio, pcm);
                es.durSec = (int) (pcm.length() / Pcm.BYTES_PER_SEC);
                List<long[]> segs = Pcm.segmenta(pcm);
                es.segmenti = segs.size();
                StringBuilder sb = new StringBuilder();
                for (long[] s : segs) {
                    Ris r = null;
                    for (int tentativo = 0; tentativo < 2; tentativo++) {
                        r = riconosci(app, pcm, s[0], s[1]);
                        if (r.errore == OK || r.errore == SpeechRecognizer.ERROR_NO_MATCH
                                || r.errore == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) break;
                        if (r.errore == NON_DISP && tentativo == 0) {
                            // riconoscitore sparito: una seconda prova lo ricrea
                        }
                        try { Thread.sleep(500); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                    }
                    if (r.errore == OK) {
                        if (!r.testo.isEmpty()) {
                            if (sb.length() > 0) sb.append(' ');
                            sb.append(r.testo);
                        }
                    } else if (r.errore != SpeechRecognizer.ERROR_NO_MATCH && r.errore != SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                        es.falliti++;
                        es.errore = "errore " + r.errore;
                        break;
                    }
                }
                es.testo = sb.toString().trim();
                es.ok = es.falliti == 0 && !es.testo.isEmpty();
                es.vuoto = es.falliti == 0 && es.testo.isEmpty();
            } catch (IOException | RuntimeException e) {
                es.falliti++;
                es.errore = e.getClass().getSimpleName();
            } finally {
                //noinspection ResultOfMethodCallIgnored
                pcm.delete();
                es.ms = SystemClock.elapsedRealtime() - t0;
            }
        }
        return es;
    }

    // ---------- diagnosi ----------

    /** Bloccante (fino a ~10 s): da chiamare fuori dal thread principale. */
    static String stato(Context ctx) {
        final Context app = ctx.getApplicationContext();
        StringBuilder sb = new StringBuilder();
        sb.append("Android API ").append(Build.VERSION.SDK_INT).append('\n');
        if (Build.VERSION.SDK_INT < 33) {
            sb.append("Troppo vecchio: la trascrizione locale richiede Android 13 o più.");
            return sb.toString();
        }
        boolean onDev = false, gen = false;
        try {
            onDev = SpeechRecognizer.isOnDeviceRecognitionAvailable(app);
            gen = SpeechRecognizer.isRecognitionAvailable(app);
        } catch (RuntimeException e) {
            sb.append("Errore: ").append(e).append('\n');
        }
        sb.append("Riconoscitore sul dispositivo: ").append(onDev ? "sì" : "no").append('\n');
        sb.append("Riconoscitore generico: ").append(gen ? "sì" : "no").append('\n');
        if (!onDev && !gen) return sb.toString();

        final StringBuilder lingua = new StringBuilder("lingua it-IT: nessuna risposta");
        final CountDownLatch l = new CountDownLatch(1);
        final SpeechRecognizer[] rec = new SpeechRecognizer[1];
        sulMain(() -> {
            try {
                SpeechRecognizer r = crea(app);
                if (r == null) {
                    l.countDown();
                    return;
                }
                rec[0] = r;
                r.checkRecognitionSupport(intentBase(), app.getMainExecutor(), new RecognitionSupportCallback() {
                    @Override
                    public void onSupportResult(RecognitionSupport s) {
                        lingua.setLength(0);
                        lingua.append("lingua it-IT: ").append(descrivi(s));
                        l.countDown();
                    }

                    @Override
                    public void onError(int error) {
                        lingua.setLength(0);
                        lingua.append("lingua it-IT: controllo non riuscito (errore ").append(error).append(')');
                        l.countDown();
                    }
                });
            } catch (RuntimeException e) {
                lingua.setLength(0);
                lingua.append("lingua it-IT: controllo non possibile (").append(e.getClass().getSimpleName()).append(')');
                l.countDown();
            }
        });
        try {
            l.await(8, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        sulMain(() -> {
            if (rec[0] != null) {
                try { rec[0].destroy(); } catch (RuntimeException ignored) { }
            }
        });
        sb.append(lingua);
        return sb.toString();
    }

    private static boolean contiene(List<String> l, String tag) {
        if (l == null) return false;
        for (String s : l) if (s != null && s.replace('_', '-').equalsIgnoreCase(tag)) return true;
        return false;
    }

    private static String descrivi(RecognitionSupport s) {
        if (contiene(s.getInstalledOnDeviceLanguages(), "it-IT")) return "installata sul telefono";
        if (contiene(s.getPendingOnDeviceLanguages(), "it-IT")) return "in scaricamento";
        if (contiene(s.getSupportedOnDeviceLanguages(), "it-IT")) return "scaricabile (non ancora installata)";
        if (contiene(s.getOnlineLanguages(), "it-IT")) return "disponibile solo in rete";
        return "non supportata";
    }
}
