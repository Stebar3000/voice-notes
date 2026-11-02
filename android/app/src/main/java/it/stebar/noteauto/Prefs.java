package it.stebar.noteauto;

import android.content.Context;
import android.content.SharedPreferences;

/** Impostazioni salvate solo sul telefono (mai nel repository). */
final class Prefs {

    static final String DEFAULT_BASE = "/Applicazioni/VoceAgente";

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

    String llmModel() { return get("llmModel", "openai/gpt-oss-120b"); }

    String rules() { return get("rules", ""); }

    String vocab() { return get("vocab", ""); }

    String dbxAppKey() { return get("dbxAppKey", "").trim(); }

    String dbxRefresh() { return get("dbxRefresh", ""); }

    /** Cartella di base su Dropbox, senza barra finale. */
    String dbxBase() {
        String b = get("dbxBase", DEFAULT_BASE).trim();
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        if (!b.isEmpty() && !b.startsWith("/")) b = "/" + b;
        return b;
    }

    /** Minuti di pausa dopo i quali una nuova nota apre una nuova sessione di dettatura. */
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
