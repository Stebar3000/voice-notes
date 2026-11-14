package it.stebar.noteauto;

import android.content.Context;
import android.content.Intent;
import android.media.AudioFormat;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingDeque;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Riconoscimento in diretta: gli stessi byte che vanno nel wav vanno anche al riconoscitore sul dispositivo, tramite pipe
 * (EXTRA_AUDIO_SOURCE), in sessioni segmentate. Chi registra consegna l'audio con {@link #offri} che non blocca mai:
 * un thread a parte svuota una coda in memoria nella pipe. Se la sessione finisce mentre si registra ne parte subito
 * un'altra (pipe nuova), l'audio intanto resta in coda. Se la diretta si rompe o si spegne, il wav non ne risente.
 */
final class Diretta {

    private static final long CODA_MAX = 24L * 1024 * 1024;   // circa 12 minuti di audio in attesa: oltre, la diretta si spegne
    private static final long PIPE_CAP = 65536;                // capienza di una pipe
    private static final long SESSIONE_BREVE_MS = 5000;        // una sessione che muore prima, senza testo, è "a vuoto"
    private static final int VUOTE_MAX = 3;
    private static final long ATTESA_FINALE_MS = 8000;

    private final Context app;
    private final LinkedBlockingDeque<byte[]> coda = new LinkedBlockingDeque<>();
    private final AtomicLong inCoda = new AtomicLong();
    private final StringBuilder testo = new StringBuilder();
    private volatile boolean attiva = true;
    private volatile boolean chiudendo;
    private Thread scrittore;
    private volatile boolean contata;
    private Sess corrente;      // toccata solo dal thread scrittore (e da chiudi() dopo che lo scrittore è finito)
    private int vuoteDiFila;
    volatile boolean sorgenteIgnorata;
    volatile int sessioni;
    volatile int riavvii;
    volatile String motivoStop = "";

    private Diretta(Context app) {
        this.app = app;
    }

    /** La diretta si può usare: Android 13+, interruttore acceso, riconoscitore sul dispositivo presente. */
    static boolean possibile(Context ctx) {
        if (Build.VERSION.SDK_INT < 33) return false;
        if (!new Prefs(ctx).getBool("voceLocale", true)) return false;
        if (VoceLocale.sorgenteIgnorata) return false;
        try {
            return SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx);
        } catch (RuntimeException e) {
            return false;
        }
    }

    static Diretta avvia(Context ctx) {
        Diretta d = new Diretta(ctx.getApplicationContext());
        VoceLocale.dirette.incrementAndGet(); // da ora la ritrascrizione da file cede il passo
        d.contata = true;
        d.scrittore = new Thread(d::ciclo, "diretta-pipe");
        d.scrittore.setDaemon(true);
        d.scrittore.start();
        return d;
    }

    boolean viva() { return attiva; }

    /** Non blocca mai. L'array non va modificato dopo la consegna. */
    void offri(byte[] c) {
        if (!attiva || chiudendo) return;
        if (inCoda.get() + c.length > CODA_MAX) {
            spegni("coda piena");
            coda.clear();
            return;
        }
        inCoda.addAndGet(c.length);
        coda.offerLast(c);
    }

    private void spegni(String motivo) {
        if (attiva) motivoStop = motivo;
        attiva = false;
    }

    // ---------- una sessione di riconoscimento ----------

    private final class Sess {
        SpeechRecognizer rec;
        ParcelFileDescriptor lettura, scrittura;
        OutputStream os;
        long inizio;
        final AtomicLong scritto = new AtomicLong();
        final CountDownLatch fine = new CountDownLatch(1);
        boolean finita;               // sotto synchronized(this)
        final StringBuilder suo = new StringBuilder();
        volatile String parziale = "";
        volatile boolean haSegmenti;

        synchronized void aggiungi(String t) {
            if (suo.length() > 0) suo.append(' ');
            suo.append(t);
        }

        synchronized void termina() {
            if (finita) return;
            finita = true;
            if (!parziale.isEmpty()) { // il segmento corrispondente non è arrivato: si usa l'ultimo parziale
                aggiungi(parziale);
                parziale = "";
            }
            fine.countDown();
        }

        synchronized boolean finitaOra() { return finita; }

        /**
         * Un testo arrivato senza che il riconoscitore abbia letto dalla pipe non vale (ascolta il microfono): si vede perché
         * la scrittura è ferma alla capienza della pipe e l'audio si accumula in coda.
         */
        boolean letto() {
            if (scritto.get() <= PIPE_CAP && inCoda.get() > Pcm.BYTES_PER_SEC) {
                sorgenteIgnorata = true;
                VoceLocale.sorgenteIgnorata = true;
                spegni("il riconoscitore non legge dalla pipe");
                synchronized (this) {
                    suo.setLength(0);
                    parziale = "";
                }
                termina();
                return false;
            }
            return true;
        }
    }

    private static String primo(Bundle b) {
        if (b == null) return "";
        ArrayList<String> l = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return l != null && !l.isEmpty() && l.get(0) != null ? l.get(0).trim() : "";
    }

    /** Apre una sessione nuova con una pipe nuova. Null se non si riesce. */
    private Sess apri() {
        final Sess s = new Sess();
        try {
            ParcelFileDescriptor[] p = ParcelFileDescriptor.createPipe();
            s.lettura = p[0];
            s.scrittura = p[1];
            s.os = new ParcelFileDescriptor.AutoCloseOutputStream(p[1]);
        } catch (IOException e) {
            return null;
        }
        // mai due sessioni insieme: se una ritrascrizione da file è ancora aperta (cede subito) si aspetta che chiuda
        long attesa = SystemClock.elapsedRealtime() + 6000;
        while (VoceLocale.fileInCorso && SystemClock.elapsedRealtime() < attesa) {
            try { Thread.sleep(50); } catch (InterruptedException e) { break; }
        }
        s.inizio = SystemClock.elapsedRealtime();
        final boolean[] ok = {false};
        VoceLocale.sulMain(() -> {
            try {
                if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(app)) return;
                SpeechRecognizer r = SpeechRecognizer.createOnDeviceSpeechRecognizer(app);
                s.rec = r;
                r.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(Bundle params) { }

                    @Override public void onBeginningOfSpeech() { }

                    @Override public void onRmsChanged(float rmsdB) { }

                    @Override public void onBufferReceived(byte[] buffer) { }

                    @Override public void onEndOfSpeech() { }

                    @Override
                    public void onError(int error) {
                        s.termina();
                    }

                    @Override
                    public void onResults(Bundle results) {
                        if (!s.haSegmenti) {
                            String t = primo(results);
                            if (!t.isEmpty() && s.letto()) {
                                s.aggiungi(t);
                                s.parziale = "";
                            }
                        }
                        s.termina();
                    }

                    @Override
                    public void onPartialResults(Bundle partialResults) {
                        String t = primo(partialResults);
                        if (!t.isEmpty() && s.letto()) s.parziale = t;
                    }

                    @Override
                    public void onSegmentResults(Bundle segmentResults) {
                        String t = primo(segmentResults);
                        if (!t.isEmpty() && s.letto()) {
                            s.aggiungi(t);
                            s.haSegmenti = true;
                        }
                        s.parziale = ""; // il parziale riguardava questo segmento
                    }

                    @Override
                    public void onEndOfSegmentedSession() {
                        s.termina();
                    }

                    @Override public void onEvent(int eventType, Bundle params) { }
                });
                Intent i = VoceLocale.intentBase(true);
                i.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE); // sessione a segmenti finché dura la sorgente
                i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, s.lettura);
                i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1);
                i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
                i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, Pcm.RATE);
                r.startListening(i);
                ok[0] = true;
            } catch (RuntimeException e) {
                ok[0] = false;
            }
        });
        if (!ok[0]) {
            distruggi(s);
            return null;
        }
        sessioni++;
        return s;
    }

    private void distruggi(final Sess s) {
        try { s.os.close(); } catch (IOException | RuntimeException ignored) { }
        VoceLocale.sulMain(() -> {
            SpeechRecognizer r = s.rec;
            if (r != null) {
                try { r.cancel(); } catch (RuntimeException ignored) { }
                try { r.destroy(); } catch (RuntimeException ignored) { }
            }
        });
        try { s.lettura.close(); } catch (IOException | RuntimeException ignored) { }
        try { s.scrittura.close(); } catch (IOException | RuntimeException ignored) { }
    }

    /** Prende il testo di una sessione conclusa e aggiorna il conto delle sessioni a vuoto. */
    private void raccogli(Sess s) {
        String t;
        synchronized (s) {
            t = s.suo.toString().trim();
        }
        if (!t.isEmpty()) {
            synchronized (testo) {
                if (testo.length() > 0) testo.append(' ');
                testo.append(t);
            }
            vuoteDiFila = 0;
        } else if (SystemClock.elapsedRealtime() - s.inizio < SESSIONE_BREVE_MS) {
            if (++vuoteDiFila >= VUOTE_MAX) spegni("tre sessioni di fila finite subito senza testo");
        } else {
            vuoteDiFila = 0;
        }
    }

    // ---------- thread che svuota la coda ----------

    private void ciclo() {
        try {
            while (true) {
                byte[] c;
                try {
                    c = coda.pollFirst(100, TimeUnit.MILLISECONDS);
                } catch (InterruptedException e) {
                    return;
                }
                if (!attiva) return;
                if (c == null) {
                    if (chiudendo) return;
                    continue;
                }
                inCoda.addAndGet(-c.length);
                if (corrente != null && corrente.finitaOra()) {
                    raccogli(corrente);
                    distruggi(corrente);
                    corrente = null;
                    if (!attiva) return;
                    riavvii++;
                    try { Thread.sleep(150); } catch (InterruptedException e) { return; }
                }
                if (corrente == null) {
                    corrente = apri();
                    if (corrente == null) {
                        spegni("riconoscitore non avviabile");
                        return;
                    }
                }
                try {
                    corrente.os.write(c);
                    corrente.scritto.addAndGet(c.length);
                } catch (IOException e) {
                    // pipe rotta: la sessione è finita o sta per finire; il blocco non si perde
                    inCoda.addAndGet(c.length);
                    coda.offerFirst(c);
                    corrente.termina();
                }
            }
        } catch (RuntimeException e) {
            spegni("errore: " + e.getClass().getSimpleName());
        }
    }

    // ---------- fine registrazione ----------

    /**
     * Fine dell'audio: svuota la coda, chiude la pipe, aspetta il risultato finale (pochi secondi), distrugge il riconoscitore.
     * Bloccante: mai dal thread principale. Restituisce il testo accumulato (vuoto se non c'è).
     */
    String chiudi() {
        chiudendo = true;
        try {
            if (scrittore != null) scrittore.join(4000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        final Sess s = corrente;
        if (s != null) {
            if (attiva && !scrittore.isAlive() && !s.finitaOra()) {
                try { s.os.close(); } catch (IOException ignored) { } // fine dell'audio
                // La sessione finisce da sola quando il riconoscitore ha smaltito l'audio rimasto: stopListening()
                // troppo presto tronca le ultime parole, quindi solo come ultima risorsa.
                try {
                    if (!s.fine.await(ATTESA_FINALE_MS - 2500, TimeUnit.MILLISECONDS)) {
                        VoceLocale.sulMain(() -> {
                            if (!s.finitaOra() && s.rec != null) {
                                try { s.rec.stopListening(); } catch (RuntimeException ignored) { }
                            }
                        });
                        s.fine.await(2500, TimeUnit.MILLISECONDS);
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            s.termina(); // se non è arrivato altro si usa l'ultimo parziale
            raccogli(s);
            distruggi(s);
            corrente = null;
        }
        attiva = false;
        coda.clear();
        rilascia();
        synchronized (testo) {
            return testo.toString().trim();
        }
    }

    private void rilascia() {
        synchronized (this) {
            if (!contata) return;
            contata = false;
        }
        VoceLocale.dirette.decrementAndGet();
    }

    String riepilogo() {
        return sessioni + " sessioni, " + riavvii + " riavvii" + (motivoStop.isEmpty() ? "" : ", spenta: " + motivoStop);
    }
}
