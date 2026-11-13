package it.stebar.noteauto;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Chiamate HTTPS minime, senza librerie esterne. */
final class Http {

    private Http() { }

    /** status 0 = rete non disponibile / nessuna risposta. */
    static class ApiError extends Exception {
        final int status;

        ApiError(int status, String msg) {
            super(msg);
            this.status = status;
        }

        /** Errori che passano da soli: conviene riprovare più tardi. */
        boolean retryable() { return status == 0 || status == 429 || status >= 500; }
    }

    static String call(String method, String url, Map<String, String> headers, byte[] body, int timeoutMs) throws ApiError {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod(method);
            c.setConnectTimeout(Math.min(20000, timeoutMs));
            c.setReadTimeout(timeoutMs);
            c.setRequestProperty("User-Agent", "NoteAuto/" + BuildConfigInfo.VERSION);
            if (headers != null) {
                for (Map.Entry<String, String> e : headers.entrySet()) c.setRequestProperty(e.getKey(), e.getValue());
            }
            if (body != null) {
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(body.length);
                try (OutputStream o = c.getOutputStream()) {
                    o.write(body);
                }
            }
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String s = in == null ? "" : readAll(in);
            if (code >= 400) throw new ApiError(code, message(s, code));
            return s;
        } catch (ApiError e) {
            throw e;
        } catch (IOException e) {
            throw new ApiError(0, "rete non disponibile (" + e.getClass().getSimpleName() + ")");
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String readAll(InputStream in) throws IOException {
        try (InputStream i = in) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int r;
            while ((r = i.read(buf)) > 0) b.write(buf, 0, r);
            return b.toString("UTF-8");
        }
    }

    /** Estrae il messaggio d'errore dalle risposte di Groq, Dropbox e del centralino di Nero. */
    private static String message(String s, int code) {
        try {
            JSONObject j = new JSONObject(s);
            JSONObject e = j.optJSONObject("error");
            if (e != null && !e.optString("message").isEmpty()) return e.optString("message");
            if (!j.optString("error_summary").isEmpty()) return j.optString("error_summary");
            if (!j.optString("error_description").isEmpty()) return j.optString("error_description");
            if (!j.optString("error").isEmpty()) return j.optString("error");
            if (!j.optString("errore").isEmpty()) return j.optString("errore");
        } catch (Exception ignored) {
            // non è JSON
        }
        String t = s == null ? "" : s.trim();
        if (t.length() > 200) t = t.substring(0, 200);
        return t.isEmpty() ? "HTTP " + code : "HTTP " + code + ": " + t;
    }

    static byte[] utf8(String s) { return s.getBytes(StandardCharsets.UTF_8); }
}
