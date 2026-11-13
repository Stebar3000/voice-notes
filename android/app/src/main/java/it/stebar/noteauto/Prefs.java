package it.stebar.noteauto;

import android.content.Context;
import android.content.SharedPreferences;

/** Impostazioni salvate solo sul telefono (mai nel repository). */
final class Prefs {

    static final String DEFAULT_CENTRALINO = "https://nero-centralino.stebar3000.workers.dev";

    private final SharedPreferences p;

    Prefs(Context c) {
        p = c.getApplicationContext().getSharedPreferences("noteauto", Context.MODE_PRIVATE);
    }

    String get(String k, String d) { return p.getString(k, d); }

    void put(String k, String v) { p.edit().putString(k, v).apply(); }

    long getLong(String k, long d) { return p.getLong(k, d); }

    void putLong(String k, long v) { p.edit().putLong(k, v).apply(); }

    boolean getBool(String k, boolean d) { return p.getBoolean(k, d); }

    void putBool(String k, boolean v) { p.edit().putBoolean(k, v).apply(); }

    String groqKey() { return get("groqKey", "").trim(); }

    String sttModel() { return get("sttModel", "whisper-large-v3"); }

    String vocab() { return get("vocab", ""); }

    String dbxAppKey() { return get("dbxAppKey", "").trim(); }

    String dbxRefresh() { return get("dbxRefresh", ""); }

    /** Indirizzo del centralino di Nero, senza barra finale. */
    String centralinoUrl() {
        String u = get("centralinoUrl", DEFAULT_CENTRALINO).trim();
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        return u.isEmpty() ? DEFAULT_CENTRALINO : u;
    }

    /** Chiave del centralino: vuota = si consegna sempre su Dropbox. */
    String centralinoKey() { return get("centralinoKey", "").trim(); }

    /** Minuti di pausa dopo l'ultima nota, trascorsi i quali parte la consegna automatica. */
    int sessionMinutes() {
        try {
            int m = Integer.parseInt(get("sessionMin", "10").trim());
            return Math.max(1, Math.min(m, 240));
        } catch (NumberFormatException e) {
            return 10;
        }
    }

    boolean dropboxConnected() { return !dbxAppKey().isEmpty() && !dbxRefresh().isEmpty(); }
}
