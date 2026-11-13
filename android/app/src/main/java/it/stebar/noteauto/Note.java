package it.stebar.noteauto;

import android.content.Context;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Una nota = un file audio (rec-AAAAMMGG-HHMMSS.m4a) e un file di dati accanto (stesso nome, .json)
 * con lo stato: new (da trascrivere), ready (trascrizione pronta, da consegnare), delivered (consegnata),
 * empty (nessun parlato), error (non recuperabile da sola), old (registrazione della versione di prova: ignorata).
 */
final class Note {

    static final String NEW = "new", READY = "ready", DELIVERED = "delivered", EMPTY = "empty", ERROR = "error", OLD = "old";

    /** Contatore che sale a ogni cambiamento: la schermata ricarica l'elenco solo quando cambia. */
    static volatile int version = 0;
    /** File in registrazione in questo momento (non va mai trattato come nota). */
    static volatile String recordingPath = null;

    final String id;
    final File audio;
    final File meta;
    long startMs;
    int durSec;
    String state = NEW;
    String raw = "";
    String error = "";
    int tries;
    /** Chi ha fatto il testo: "locale" (riconoscitore del telefono), "whisper" o vuoto (non ancora / note vecchie). */
    String via = "";
    /** Quante volte è stata provata la trascrizione locale senza successo (massimo 2). */
    int locTries;

    private Note(File audio) {
        this.audio = audio;
        String n = audio.getName();
        this.id = n.substring(0, n.length() - 4);
        this.meta = new File(audio.getParentFile(), id + ".json");
    }

    static File dir(Context c) {
        File d = c.getExternalFilesDir(null);
        return d != null ? d : c.getFilesDir();
    }

    static long parseStamp(String id) {
        try {
            Date d = new SimpleDateFormat("'rec-'yyyyMMdd-HHmmss", Locale.ITALY).parse(id);
            return d != null ? d.getTime() : 0;
        } catch (ParseException e) {
            return 0;
        }
    }

    /** Crea la scheda di una registrazione appena terminata. */
    static Note create(File audio, long startMs, int durSec) {
        Note n = new Note(audio);
        n.startMs = startMs;
        n.durSec = durSec;
        n.save();
        return n;
    }

    /** Tutte le note, dalla più vecchia. Non scrive nulla su disco. */
    static List<Note> loadAll(Context c) {
        List<Note> out = new ArrayList<>();
        File[] files = dir(c).listFiles((d, n) -> n.startsWith("rec-") && n.endsWith(".m4a"));
        if (files == null) return out;
        Arrays.sort(files, (a, b) -> a.getName().compareTo(b.getName()));
        for (File f : files) {
            if (recordingPath != null && recordingPath.equals(f.getAbsolutePath())) continue;
            out.add(load(f));
        }
        return out;
    }

    private static Note load(File audio) {
        Note n = new Note(audio);
        n.startMs = parseStamp(n.id);
        if (n.meta.exists()) {
            try {
                JSONObject j = new JSONObject(readText(n.meta));
                n.startMs = j.optLong("startMs", n.startMs);
                n.durSec = j.optInt("durSec", 0);
                n.state = j.optString("state", NEW);
                n.raw = j.optString("raw", "");
                n.error = j.optString("error", "");
                n.tries = j.optInt("tries", 0);
                n.via = j.optString("via", "");
                n.locTries = j.optInt("locTries", 0);
            } catch (Exception e) {
                // scheda illeggibile: si riparte da "da trascrivere", l'audio c'è
                n.state = NEW;
            }
        }
        return n;
    }

    /** Segna come "old" le registrazioni che esistono già, la prima volta con l'app completa. */
    static synchronized void migrateOnce(Context c, Prefs p) {
        if (p.getBool("migrated1", false)) return;
        File[] files = dir(c).listFiles((d, n) -> n.startsWith("rec-") && n.endsWith(".m4a"));
        if (files != null) {
            for (File f : files) {
                Note n = new Note(f);
                if (n.meta.exists()) continue;
                if (recordingPath != null && recordingPath.equals(f.getAbsolutePath())) continue;
                n.startMs = parseStamp(n.id);
                n.state = OLD;
                n.save();
            }
        }
        p.putBool("migrated1", true);
    }

    synchronized void save() {
        try {
            JSONObject j = new JSONObject();
            j.put("startMs", startMs);
            j.put("durSec", durSec);
            j.put("state", state);
            j.put("raw", raw);
            j.put("error", error);
            j.put("tries", tries);
            j.put("via", via);
            j.put("locTries", locTries);
            File tmp = new File(meta.getParentFile(), id + ".json.tmp");
            try (FileOutputStream o = new FileOutputStream(tmp)) {
                o.write(j.toString().getBytes(StandardCharsets.UTF_8));
                o.getFD().sync();
            }
            if (!tmp.renameTo(meta)) {
                // alcuni file system non sovrascrivono con rename: si cancella e si riprova
                //noinspection ResultOfMethodCallIgnored
                meta.delete();
                if (!tmp.renameTo(meta)) throw new IOException("rename fallito");
            }
        } catch (Exception e) {
            RecService.log("Errore nel salvare la scheda " + id + ": " + e);
        }
        version++;
    }

    private static String readText(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int r;
            while ((r = in.read(buf)) > 0) b.write(buf, 0, r);
            return b.toString("UTF-8");
        }
    }
}
