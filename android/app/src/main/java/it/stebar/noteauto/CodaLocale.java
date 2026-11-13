package it.stebar.noteauto;

import android.content.Context;
import android.os.PowerManager;
import android.os.SystemClock;

import java.util.LinkedHashSet;
import java.util.List;

/**
 * Coda della trascrizione locale: una nota per volta, in un filo suo, con un wake lock suo (funziona a schermo spento).
 * Le note entrano subito dopo la registrazione, all'avvio del servizio e prima di ogni consegna.
 * Il microfono non c'entra: si legge dal file, quindi si può registrare mentre si trascrive.
 */
final class CodaLocale {

    static final int MAX_PROVE = 2;

    private static final LinkedHashSet<String> CODA = new LinkedHashSet<>();
    private static String inCorso;
    private static boolean attivo;

    private CodaLocale() { }

    static boolean abilitata(Context ctx) {
        return new Prefs(ctx).getBool("voceLocale", true) && VoceLocale.disponibile(ctx);
    }

    static synchronized boolean inCoda(String id) {
        return CODA.contains(id) || id.equals(inCorso);
    }

    static synchronized boolean occupata() {
        return !CODA.isEmpty() || inCorso != null;
    }

    private static boolean idonea(Note n) {
        return Note.NEW.equals(n.state) && n.raw.isEmpty() && n.via.isEmpty()
                && n.locTries < MAX_PROVE && n.audio.exists();
    }

    /** Mette in coda una nota appena salvata. */
    static void accoda(Context ctx, Note n) {
        if (!abilitata(ctx) || !idonea(n)) return;
        aggiungi(ctx.getApplicationContext(), n.id);
    }

    /** Mette in coda tutte le note ancora da trascrivere e non provate (o provate meno di 2 volte). */
    static void scansiona(Context ctx) {
        if (!abilitata(ctx)) return;
        for (Note n : Note.loadAll(ctx)) {
            if (idonea(n)) aggiungi(ctx.getApplicationContext(), n.id);
        }
    }

    private static void aggiungi(final Context app, String id) {
        boolean avvia;
        synchronized (CodaLocale.class) {
            if (!CODA.add(id)) return;
            avvia = !attivo;
            if (avvia) attivo = true;
        }
        Note.version++;
        if (avvia) {
            Thread t = new Thread(() -> lavora(app), "trascrizione-locale");
            t.start();
        }
    }

    /** Aspetta che la coda si svuoti, al massimo maxMs. Vero se è vuota. */
    static boolean aspetta(long maxMs) {
        long fine = SystemClock.elapsedRealtime() + maxMs;
        while (occupata()) {
            if (SystemClock.elapsedRealtime() > fine) return false;
            try {
                Thread.sleep(500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return true;
    }

    private static void lavora(Context app) {
        PowerManager.WakeLock wl = null;
        try {
            PowerManager pm = app.getSystemService(PowerManager.class);
            wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "noteauto:locale");
            wl.acquire(90L * 60 * 1000);
        } catch (RuntimeException e) {
            RecService.log("Wake lock della trascrizione locale non ottenuto: " + e);
        }
        try {
            while (true) {
                String id;
                synchronized (CodaLocale.class) {
                    if (CODA.isEmpty()) {
                        attivo = false;
                        inCorso = null;
                        break;
                    }
                    id = CODA.iterator().next();
                    CODA.remove(id);
                    inCorso = id;
                }
                Note.version++;
                try {
                    una(app, id);
                } catch (Throwable t) {
                    RecService.log("Errore imprevisto nella trascrizione locale: " + t);
                }
                synchronized (CodaLocale.class) {
                    inCorso = null;
                }
                Note.version++;
            }
        } finally {
            if (wl != null && wl.isHeld()) wl.release();
            Note.version++;
        }
    }

    private static void una(Context app, String id) {
        Note n = null;
        List<Note> tutte = Note.loadAll(app);
        for (Note x : tutte) if (x.id.equals(id)) n = x;
        if (n == null || !idonea(n)) return;
        VoceLocale.Esito es = VoceLocale.trascrivi(app, n.audio);
        String esito;
        if (es.ok) {
            // la scheda può essere cambiata nel frattempo (non dovrebbe): si rilegge prima di scrivere
            Note f = null;
            for (Note x : Note.loadAll(app)) if (x.id.equals(id)) f = x;
            if (f != null && Note.NEW.equals(f.state) && f.raw.isEmpty()) {
                f.raw = es.testo;
                f.via = "locale";
                f.state = Note.READY;
                f.tries = 0;
                f.error = "";
                f.save();
            }
            esito = "riuscita";
        } else if (es.vuoto) {
            n.locTries = MAX_PROVE; // resta a Whisper, che controlla le allucinazioni
            n.save();
            esito = "nessun testo, passa a Whisper";
        } else if (es.nonDisponibile) {
            esito = "riconoscitore non disponibile, passa a Whisper";
            n.locTries = MAX_PROVE;
            n.save();
        } else {
            n.locTries++;
            n.save();
            esito = "fallita (" + es.errore + "), prova " + n.locTries + " di " + MAX_PROVE;
        }
        RecService.log("LOCALE " + n.id + " · audio " + es.durSec + " s · " + es.segmenti + " segmenti · "
                + String.format(java.util.Locale.ITALY, "%.1f", es.ms / 1000.0) + " s · " + esito);
    }
}
