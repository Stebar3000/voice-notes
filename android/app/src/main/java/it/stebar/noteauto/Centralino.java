package it.stebar.noteauto;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Chiamate al centralino di Nero (protocollo: docs/nero-3-protocollo.md §3). Tempo massimo 15 s per chiamata. */
final class Centralino {

    private static final int TIMEOUT_MS = 15000;

    private Centralino() { }

    private static Map<String, String> headers(Prefs p) {
        Map<String, String> h = new HashMap<>();
        h.put("Authorization", "Bearer " + p.centralinoKey());
        h.put("Content-Type", "application/json");
        return h;
    }

    /** Le risposte hanno sempre "ok": se è false il motivo sta in "errore". */
    private static JSONObject parse(String res) throws Http.ApiError {
        try {
            JSONObject j = new JSONObject(res);
            if (!j.optBoolean("ok", false)) throw new Http.ApiError(-1, j.optString("errore", "risposta negativa del centralino"));
            return j;
        } catch (Http.ApiError e) {
            throw e;
        } catch (Exception e) {
            throw new Http.ApiError(-1, "risposta del centralino non valida");
        }
    }

    /** Manda un lotto di direttive. Torna solo se il centralino ha risposto ok. */
    static void lotto(Prefs p, String testo) throws Http.ApiError {
        try {
            JSONObject body = new JSONObject().put("testo", testo).put("dispositivo", "android");
            parse(Http.call("POST", p.centralinoUrl() + "/lotto", headers(p), Http.utf8(body.toString()), TIMEOUT_MS));
        } catch (org.json.JSONException e) {
            throw new Http.ApiError(-1, e.toString());
        }
    }

    /** Il laptop di casa è acceso? Risposta {ok, vivo, ora, secondi}; tempo massimo 10 s. */
    static boolean vivo(Prefs p) throws Http.ApiError {
        return parse(Http.call("GET", p.centralinoUrl() + "/vivo", headers(p), null, 10000)).optBoolean("vivo", false);
    }

    /** I rapporti più recenti (al massimo n), quelli dopo l'id indicato se non è vuoto; i più nuovi per primi. */
    static List<Rapporti.Rapporto> rapporti(Prefs p, String dopo, int n) throws Http.ApiError {
        String url = p.centralinoUrl() + "/rapporti?n=" + n;
        try {
            if (!dopo.isEmpty()) url += "&dopo=" + URLEncoder.encode(dopo, "UTF-8");
        } catch (java.io.UnsupportedEncodingException ignored) {
            // UTF-8 esiste sempre
        }
        JSONObject j = parse(Http.call("GET", url, headers(p), null, TIMEOUT_MS));
        JSONArray a = j.optJSONArray("rapporti");
        List<Rapporti.Rapporto> out = new ArrayList<>();
        if (a != null) {
            for (int i = 0; i < a.length(); i++) {
                JSONObject r = a.optJSONObject(i);
                if (r != null) out.add(new Rapporti.Rapporto(r));
            }
        }
        return out;
    }
}
