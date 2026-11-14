package it.stebar.noteauto;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

/** Trascrizione (Whisper) tramite Groq: il testo che esce è quello grezzo, nessuna pulizia. */
final class Groq {

    private static final String BASE = "https://api.groq.com/openai/v1";

    /** Frasi che Whisper "inventa" su silenzio o rumore. */
    private static final Pattern HALLUCINATIONS = Pattern.compile(
            "^(grazie( a tutti| mille| per l'attenzione| per la visione)?|ciao( a tutti)?|buonasera"
                    + "|sottotitoli( creati dalla comunità amara\\.org| a cura di .*| e revisione a cura di .*)?|amara\\.org"
                    + "|sigla|iscriviti al canale.*|alla prossima|a presto|\\.+)[.!?\\s]*$",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

    private Groq() { }

    static boolean isHallucination(String s) {
        return s == null || s.trim().isEmpty() || HALLUCINATIONS.matcher(s.trim()).matches();
    }

    private static Map<String, String> auth(Prefs p) {
        Map<String, String> h = new HashMap<>();
        h.put("Authorization", "Bearer " + p.groqKey());
        return h;
    }

    /** Verifica la chiave. Restituisce null se va bene, altrimenti il motivo. */
    static String test(Prefs p) {
        try {
            Http.call("GET", BASE + "/models", auth(p), null, 20000);
            return null;
        } catch (Http.ApiError e) {
            return e.status == 401 ? "chiave non valida" : e.getMessage();
        }
    }

    static String transcribe(File audio, Prefs p) throws Http.ApiError {
        byte[] data;
        try {
            data = readFile(audio);
        } catch (IOException e) {
            throw new Http.ApiError(-1, "file audio illeggibile: " + e.getMessage());
        }
        String boundary = "----NoteAuto" + System.currentTimeMillis();
        ByteArrayOutputStream b = new ByteArrayOutputStream(data.length + 2048);
        try {
            field(b, boundary, "model", p.sttModel());
            field(b, boundary, "language", "it");
            field(b, boundary, "temperature", "0");
            field(b, boundary, "response_format", "json");
            String vocab = p.vocab().trim();
            if (!vocab.isEmpty()) field(b, boundary, "prompt", vocab.length() > 600 ? vocab.substring(0, 600) : vocab);
            boolean wav = audio.getName().endsWith(".wav");
            b.write(Http.utf8("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + (wav ? "nota.wav" : "nota.m4a") + "\"\r\n"
                    + "Content-Type: " + (wav ? "audio/wav" : "audio/mp4") + "\r\n\r\n"));
            b.write(data);
            b.write(Http.utf8("\r\n--" + boundary + "--\r\n"));
        } catch (IOException e) {
            throw new Http.ApiError(-1, e.toString());
        }
        Map<String, String> h = auth(p);
        h.put("Content-Type", "multipart/form-data; boundary=" + boundary);
        String res = Http.call("POST", BASE + "/audio/transcriptions", h, b.toByteArray(), 180000);
        try {
            return new JSONObject(res).optString("text", "").trim();
        } catch (Exception e) {
            throw new Http.ApiError(-1, "risposta di trascrizione non valida");
        }
    }

    private static void field(ByteArrayOutputStream b, String boundary, String name, String value) throws IOException {
        b.write(Http.utf8("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + value + "\r\n"));
    }

    private static byte[] readFile(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream b = new ByteArrayOutputStream((int) Math.max(f.length(), 1024));
            byte[] buf = new byte[16384];
            int r;
            while ((r = in.read(buf)) > 0) b.write(buf, 0, r);
            return b.toByteArray();
        }
    }
}
