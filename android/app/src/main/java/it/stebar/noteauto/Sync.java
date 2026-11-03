package it.stebar.noteauto;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.PowerManager;

import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Cuore dell'app: per ogni nota ancora da lavorare trascrive (Groq Whisper), ripulisce (Groq LLM),
 * poi consegna su Dropbox un file per sessione di dettatura. Alla fine segnala l'esito con suono e schermata.
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
        if (!p.dropboxConnected()) {
            fail("Dropbox non collegato: apri Impostazioni", true, false);
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
            // 1. trascrizione e pulizia
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

            // 2. consegna: un file per sessione di dettatura
            List<Note> ready = new ArrayList<>();
            for (Note n : work) if (Note.READY.equals(n.state)) ready.add(n);
            int delivered = 0, files = 0;
            long gap = p.sessionMinutes() * 60_000L;
            int i = 0;
            while (i < ready.size()) {
                List<Note> group = new ArrayList<>();
                group.add(ready.get(i));
                int j = i + 1;
                while (j < ready.size()) {
                    Note prev = ready.get(j - 1), cur = ready.get(j);
                    if (cur.startMs - (prev.startMs + prev.durSec * 1000L) > gap) break;
                    group.add(cur);
                    j++;
                }
                progress = total;
                message = "Consegno su Dropbox…";
                RecService.status(message);
                String name = new SimpleDateFormat("yyyy-MM-dd-HHmm", Locale.ITALY).format(group.get(0).startMs);
                try {
                    String resp = Dropbox.upload(p, "/inbox/" + name + ".md", format(group).getBytes(StandardCharsets.UTF_8), false);
                    RecService.log("Dropbox ha risposto: " + resp);
                } catch (Http.ApiError e) {
                    if (e.status == 0) throw new Abort("Nessuna rete verso Dropbox", manual, true);
                    throw new Abort("Dropbox: " + cut(e.getMessage()), true, e.retryable());
                }
                for (Note n : group) {
                    n.state = Note.DELIVERED;
                    n.session = name;
                    n.save();
                }
                delivered += group.size();
                files++;
                RecService.log("CONSEGNATO " + name + ".md (" + group.size() + " note)");
                i = j;
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
                done(delivered, files);
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
                n.text = "";
                n.error = "";
                n.save();
                return;
            }
            n.raw = raw;
            n.save(); // la trascrizione è al sicuro anche se la pulizia fallisce
        }
        try {
            Groq.Cleaned c = Groq.cleanup(n.raw, p);
            n.text = c.text;
            n.title = c.title;
            n.cleaned = true;
            n.error = "";
        } catch (Http.ApiError e) {
            throw e; // rete, 401, 429, 5xx: si riprova più tardi, la trascrizione resta salvata
        } catch (Exception e) {
            n.text = n.raw;
            n.title = "";
            n.cleaned = false;
            n.error = "Pulizia non riuscita: " + cut(e.getMessage());
        }
        n.state = Note.READY;
        n.tries = 0;
        n.save();
    }

    /** Testo del file consegnato per una sessione. */
    static String format(List<Note> g) {
        SimpleDateFormat day = new SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.ITALY);
        SimpleDateFormat hm = new SimpleDateFormat("HH:mm", Locale.ITALY);
        StringBuilder sb = new StringBuilder();
        sb.append("Sessione di dettatura del ").append(day.format(g.get(0).startMs)).append(" — ")
                .append(g.size()).append(g.size() == 1 ? " nota" : " note").append("\n\n");
        int k = 1;
        for (Note n : g) {
            sb.append("## Nota ").append(k++).append(" — ").append(hm.format(n.startMs));
            if (!n.title.isEmpty()) sb.append(" — ").append(n.title);
            sb.append("\n\n").append(n.text.trim()).append("\n\n");
            if (!n.cleaned) sb.append("(Pulizia automatica non riuscita: è la trascrizione grezza.)\n\n");
        }
        return sb.toString();
    }

    private static void done(int delivered, int files) {
        phase = DONE;
        message = delivered == 0 ? "Nessun parlato da consegnare"
                : "Consegnate " + delivered + (delivered == 1 ? " nota" : " note") + (files > 1 ? " in " + files + " file" : "");
        RecService.status("Tutto consegnato");
        RecService.resetRetry();
        RecService.log("TUTTO CONSEGNATO: " + message);
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

    private static boolean recording() {
        RecService s = RecService.instance;
        return s != null && s.isRecording();
    }

    private static String cut(String s) {
        if (s == null) return "";
        return s.length() > 300 ? s.substring(0, 300) : s;
    }
}
