package it.stebar.noteauto;

import android.util.Base64;

import org.json.JSONObject;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;

/**
 * Accesso a Dropbox dal telefono, solo per scrivere file. Autorizzazione OAuth con PKCE (senza segreti nell'app):
 * l'utente autorizza una volta nel browser, incolla il codice, e l'app conserva un "refresh token" che non scade.
 */
final class Dropbox {

    private static String accessToken = "";
    private static long accessExpiresAt = 0;

    private Dropbox() { }

    /** Prepara l'indirizzo di autorizzazione e ricorda il verificatore da usare al passo successivo. */
    static String startAuth(Prefs p) throws Exception {
        byte[] r = new byte[48];
        new SecureRandom().nextBytes(r);
        String verifier = Base64.encodeToString(r, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
        String challenge = Base64.encodeToString(digest, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
        p.put("dbxVerifier", verifier);
        return "https://www.dropbox.com/oauth2/authorize?client_id=" + URLEncoder.encode(p.dbxAppKey(), "UTF-8")
                + "&response_type=code&token_access_type=offline&code_challenge_method=S256&code_challenge=" + challenge;
    }

    /** Scambia il codice incollato dall'utente con il refresh token. */
    static void finishAuth(Prefs p, String code) throws Http.ApiError {
        String body = "code=" + enc(code.trim()) + "&grant_type=authorization_code&client_id=" + enc(p.dbxAppKey())
                + "&code_verifier=" + enc(p.get("dbxVerifier", ""));
        JSONObject j = tokenCall(body);
        String refresh = j.optString("refresh_token", "");
        if (refresh.isEmpty()) throw new Http.ApiError(-1, "Dropbox non ha restituito l'autorizzazione permanente");
        p.put("dbxRefresh", refresh);
        accessToken = j.optString("access_token", "");
        accessExpiresAt = System.currentTimeMillis() + j.optLong("expires_in", 14400) * 1000L;
    }

    private static JSONObject tokenCall(String form) throws Http.ApiError {
        Map<String, String> h = new HashMap<>();
        h.put("Content-Type", "application/x-www-form-urlencoded");
        String res = Http.call("POST", "https://api.dropboxapi.com/oauth2/token", h, Http.utf8(form), 30000);
        try {
            return new JSONObject(res);
        } catch (Exception e) {
            throw new Http.ApiError(-1, "risposta di Dropbox non valida");
        }
    }

    private static synchronized String token(Prefs p, boolean force) throws Http.ApiError {
        if (!force && !accessToken.isEmpty() && System.currentTimeMillis() < accessExpiresAt - 60000) return accessToken;
        if (!p.dropboxConnected()) throw new Http.ApiError(401, "Dropbox non collegato");
        try {
            JSONObject j = tokenCall("grant_type=refresh_token&refresh_token=" + enc(p.dbxRefresh()) + "&client_id=" + enc(p.dbxAppKey()));
            accessToken = j.optString("access_token", "");
            accessExpiresAt = System.currentTimeMillis() + j.optLong("expires_in", 14400) * 1000L;
        } catch (Http.ApiError e) {
            if (e.status == 400 || e.status == 401) throw new Http.ApiError(401, "autorizzazione Dropbox scaduta o revocata: collega di nuovo");
            throw e;
        }
        return accessToken;
    }

    /** Scrive un file di testo. path è relativo alla cartella di base delle impostazioni, es. "/inbox/2026-11-03-0815.md". */
    static void upload(Prefs p, String relPath, byte[] data, boolean overwrite) throws Http.ApiError {
        String full = p.dbxBase() + relPath;
        try {
            send(p, full, data, overwrite, false);
        } catch (Http.ApiError e) {
            if (e.status == 401) send(p, full, data, overwrite, true); // token scaduto: rinnova e riprova una volta
            else throw e;
        }
    }

    private static void send(Prefs p, String fullPath, byte[] data, boolean overwrite, boolean forceRefresh) throws Http.ApiError {
        try {
            JSONObject arg = new JSONObject();
            arg.put("path", fullPath);
            arg.put("mode", overwrite ? "overwrite" : "add");
            arg.put("autorename", !overwrite);
            arg.put("mute", true);
            Map<String, String> h = new HashMap<>();
            h.put("Authorization", "Bearer " + token(p, forceRefresh));
            h.put("Dropbox-API-Arg", asciiJson(arg.toString()));
            h.put("Content-Type", "application/octet-stream");
            Http.call("POST", "https://content.dropboxapi.com/2/files/upload", h, data, 60000);
        } catch (Http.ApiError e) {
            throw e;
        } catch (Exception e) {
            throw new Http.ApiError(-1, e.toString());
        }
    }

    /** Le intestazioni HTTP devono essere ASCII: i caratteri accentati diventano \\uXXXX. */
    private static String asciiJson(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c < 128) sb.append(c);
            else sb.append(String.format("\\u%04x", (int) c));
        }
        return sb.toString();
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }
}
