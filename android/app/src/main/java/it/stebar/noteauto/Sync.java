package it.stebar.noteauto;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.PowerManager;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Cuore dell'app: per ogni nota ancora da lavorare trascrive (Groq Whisper, testo grezzo), poi consegna a Nero
 * tutte le direttive pronte in un solo invio (strada scelta da Consegna). Alla fine segnala l'esito con suono e schermata.
 */
final class Sync {

    static final int IDLE = 0, RUNNING = 1, DONE = 2, ERROR = 3;

    static volatile int phase = IDLE;
    static volatile String message = "";
    static volatile int progress, total;

    private static final AtomicBoolean BUSY = new AtomicBoolean(false);
    private static long lastErrSoundMs;
    private static String lastErrMsg = "";

    private Sync() { }

    /** Interrompe il giro con un messaggio; retry = vale la pena riprovare da soli più tardi. */
    private static final class Abort extends Exception {
        final boolean sound, retry;

        Abort(String msg, boolean sound, boolean retry) {
            super(msg);
            this.sound = sound;
            this.retry = retry;
        }
    }

    static boolean isBusy() { return BUSY.get(); }

    /** manual = l'utente ha premuto "Consegna ora": errori sempre sonori e note in errore riprovate. */
    static void request(final Context ctx, final boolean manual) {
        if (!BUSY.compareAndSet(false, true)) return;
        final Context app = ctx.getApplicationContext();
        new Thread(() -> {
            PowerManager.WakeLock wl = null;
            try {
                PowerManager pm = app.getSystemService(PowerManager.class);
                wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "noteauto:sync");
                wl.acquire(30L * 60 * 1000);
                run(app, manual);
            } catch (Throwable t) {
                RecService.log("Errore imprevisto nella sincronizzazione: " + t);
                fail("Errore imprevisto: " + t.getClass().getSimpleName(), manual, false);
            } finally {
                if (wl != null && wl.isHeld()) wl.release();
                BUSY.set(false);
                Note.version++;
            }
        }, "sync").start();
    }

    private static void run(Context ctx, boolean manual) {
        Prefs p = new Prefs(ctx);
        Note.migrateOnce(ctx, p);
        List<Note> work = new ArrayList<>();
        for (Note n : Note.loadAll(ctx)) {
            if (manual && Note.ERROR.equals(n.state)) { // "Consegna ora" riprova anche quelle in errore
                n.state = Note.NEW;
                n.tries = 0;
                n.error = "";
                n.save();
            }
            if (Note.NEW.equals(n.state) || Note.READY.equals(n.state)) work.add(n);
        }
        if (work.isEmpty()) {
            if (manual) {
                phase = DONE;
                message = "Niente da consegnare";
            }
            return;
        }
        if (!manual && !hasInternet(ctx)) return; // in viaggio senza rete è normale: nessun avviso, riprova quando la rete torna
        int toTranscribe = 0;
        for (Note n : work) if (Note.NEW.equals(n.state)) toTranscribe++;

        if (toTranscribe > 0 && p.groqKey().isEmpty()) {
            fail("Manca la chiave Groq: apri Impostazioni", true, false);
            return;
        }
        if (!p.dropboxConnected() && p.centralinoKey().isEmpty()) {
            fail("Né Dropbox né centralino configurati: apri Impostazioni", true, false);
            return;
        }

        phase = RUNNING;
        progress = 0;
        total = toTranscribe;
        message = "Avvio…";
        RecService.status("Sincronizzo…");
        RecService.log("SINCRONIZZAZIONE: " + work.size() + " note da lavorare" + (manual ? " (manuale)" : ""));

        int bad = 0;
        try {
            // 1. trascrizione
            for (Note n : work) {
                if (!Note.NEW.equals(n.state)) continue;
                progress++;
                message = "Trascrivo la nota " + progress + " di " + total;
                RecService.status(message);
                try {
                    processNote(n, p);
                } catch (Http.ApiError e) {
                    if (e.status == 401 || e.status == 403) throw new Abort("Chiave Groq non valida: controlla Impostazioni", true, false);
                    if (e.status == 0) throw new Abort("Nessuna rete verso Groq", manual, true);
                    if (e.status == 429 || e.status >= 500) throw new Abort("Groq momentaneamente non disponibile (" + e.getMessage() + ")", manual, true);
                    n.tries++;
                    n.error = cut(e.getMessage());
                    if (e.status == 413 || n.tries >= 4) {
                        n.state = Note.ERROR;
                        if (e.status == 413) n.error = "Audio troppo lungo per Groq (oltre 25 MB)";
                        bad++;
                    }
                    n.save();
                    RecService.log("Nota " + n.id + " non lavorata: " + n.error);
                }
            }

            // 2. consegna: un solo invio con tutte le direttive pronte
            List<Note> ready = new ArrayList<>();
            for (Note n : work) if (Note.READY.equals(n.state)) ready.add(n);
            int delivered = 0;
            String via = "", warn = "";
            if (!ready.isEmpty()) {
                progress = total;
                message = "Consegno a Nero…";
                RecService.status(message);
                try {
                    Consegna.Esito es = Consegna.invia(p, format(ready));
                    via = es.via;
                    warn = es.avviso;
                } catch (Http.ApiError e) {
                    if (e.status == 0) throw new Abort("Nessuna rete verso Nero e Dropbox", manual, true);
                    throw new Abort("Consegna: " + cut(e.getMessage()), true, e.retryable());
                }
                for (Note n : ready) {
                    n.state = Note.DELIVERED;
                    n.error = "";
                    n.save();
                }
                delivered = ready.size();
                RecService.log("CONSEGNATO " + delivered + " direttive (" + via + ")" + (warn.isEmpty() ? "" : " · " + warn));
                RecService.watchReport();
            }

            // 3. esito
            int left = 0;
            for (Note n : work) if (Note.NEW.equals(n.state) || Note.READY.equals(n.state)) left++;
            if (left > 0 || bad > 0) {
                String m = (delivered > 0 ? "Consegnate " + delivered + ", ma " : "") + (left + bad)
                        + (left + bad == 1 ? " nota non è stata lavorata" : " note non sono state lavorate")
                        + " (audio conservato)";
                fail(m, true, left > 0);
            } else {
                done(delivered, via, warn);
            }
        } catch (Abort a) {
            RecService.log("SINCRONIZZAZIONE INTERROTTA: " + a.getMessage());
            fail(a.getMessage(), a.sound, a.retry);
        }
    }

    private static void processNote(Note n, Prefs p) throws Http.ApiError {
        if (n.raw.isEmpty()) {
            String raw = Groq.transcribe(n.audio, p);
            if (Groq.isHallucination(raw)) {
                n.state = Note.EMPTY;
                n.error = "";
                n.save();
                return;
            }
            n.raw = raw;
        }
        n.state = Note.READY;
        n.tries = 0;
        n.error = "";
        n.save();
    }

    /** Testo consegnato (forma del protocollo di Nero, §2): una direttiva per nota, trascrizione grezza. */
    static String format(List<Note> g) {
        SimpleDateFormat day = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ITALY);
        SimpleDateFormat hm = new SimpleDateFormat("HH:mm", Locale.ITALY);
        StringBuilder sb = new StringBuilder();
        sb.append("# Direttive ").append(day.format(System.currentTimeMillis())).append(" (android)\n");
        int k = 1;
        for (Note n : g) {
            sb.append("\n## Direttiva ").append(k++).append(" — ").append(hm.format(n.startMs))
                    .append('\n').append(n.raw.trim()).append('\n');
        }
        return sb.toString();
    }

    private static void done(int delivered, String via, String warn) {
        phase = DONE;
        message = delivered == 0 ? "Nessun parlato da consegnare"
                : "Consegnate " + delivered + (delivered == 1 ? " nota" : " note") + " (" + via + ")"
                + (warn.isEmpty() ? "" : "\n" + warn);
        RecService.status("Tutto consegnato");
        RecService.resetRetry();
        RecService.log("TUTTO CONSEGNATO: " + message.replace('\n', ' '));
        if (!recording()) Tones.done();
    }

    private static void fail(String msg, boolean sound, boolean retry) {
        if (retry && !sound) { // problema passeggero in un giro automatico: niente allarmi, si riprova da soli
            phase = IDLE;
            message = "";
            RecService.log("Riprovo più tardi: " + msg);
            RecService.status("Pronto");
            RecService.scheduleRetry();
            return;
        }
        phase = ERROR;
        message = msg;
        RecService.status("Errore: " + msg);
        long now = System.currentTimeMillis();
        boolean fresh = !msg.equals(lastErrMsg) || now - lastErrSoundMs > 5 * 60_000L;
        if (sound && fresh && !recording()) {
            Tones.error();
            lastErrSoundMs = now;
            lastErrMsg = msg;
        }
        if (retry) RecService.scheduleRetry();
    }

    private static boolean hasInternet(Context ctx) {
        try {
            ConnectivityManager cm = ctx.getSystemService(ConnectivityManager.class);
            Network n = cm.getActiveNetwork();
            NetworkCapabilities c = n == null ? null : cm.getNetworkCapabilities(n);
            return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        } catch (RuntimeException e) {
            return true; // nel dubbio si prova
        }
    }

    static boolean recording() {
        RecService s = RecService.instance;
        return s != null && s.isRecording();
    }

    private static String cut(String s) {
        if (s == null) return "";
        return s.length() > 300 ? s.substring(0, 300) : s;
    }
}
