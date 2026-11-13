package it.stebar.noteauto;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * I rapporti di Nero: chiede al centralino quelli nuovi, tiene gli ultimi 5 sul telefono (nelle impostazioni, mai nel
 * repository), avvisa con notifica e suono quando ne arriva uno. L'id di un rapporto è trattato come testo opaco.
 */
final class Rapporti {

    private static final int KEEP = 5;
    private static final String CHANNEL = "nero";

    /** Cambia a ogni novità: la schermata si ridisegna solo allora. */
    static volatile int version = 0;
    /** Rapporto arrivato e non ancora aperto. */
    static volatile boolean unread = false;
    /** Esito dell'ultimo controllo chiesto a mano (vuoto = niente da dire). */
    static volatile String status = "";

    private static final AtomicBoolean CHECKING = new AtomicBoolean(false);

    private Rapporti() { }

    /** Un rapporto come lo manda il centralino (protocollo §4). */
    static final class Rapporto {
        final JSONObject j;

        Rapporto(JSONObject j) { this.j = j; }

        String id() { return j.optString("id", ""); }

        String chi() { return j.optString("chi", ""); }

        String chat() { return j.optString("chat", ""); }

        String lotto() { return j.optString("lotto", ""); }

        String sintesi() { return j.optString("sintesi", "").trim(); }

        List<String> elenco(String chiave) {
            List<String> out = new ArrayList<>();
            JSONArray a = j.optJSONArray(chiave);
            if (a == null) return out;
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                String s = o != null ? o.optString("testo", o.toString()) : a.optString(i, "");
                if (!s.trim().isEmpty()) out.add(s.trim());
            }
            return out;
        }

        /** Ciò che si legge ad alta voce: la sintesi, poi "Decisioni rapide:" e le decisioni se ci sono. */
        String daLeggere() {
            StringBuilder sb = new StringBuilder(sintesi());
            List<String> dec = elenco("decisioni");
            if (!dec.isEmpty()) {
                sb.append(" Decisioni rapide:");
                for (String d : dec) sb.append(' ').append(d.endsWith(".") ? d : d + ".");
            }
            return sb.toString().trim();
        }
    }

    /** Gli ultimi rapporti conservati sul telefono, i più nuovi per primi. */
    static List<Rapporto> salvati(Prefs p) {
        List<Rapporto> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(p.get("rapList", "[]"));
            for (int i = 0; i < a.length(); i++) out.add(new Rapporto(a.getJSONObject(i)));
        } catch (Exception ignored) {
            // elenco illeggibile: si riparte vuoti
        }
        return out;
    }

    /** Chiede i rapporti nuovi in un filo a parte. manual = l'utente ha toccato "Aggiorna": l'esito si mostra sempre. */
    static void check(final Context ctx, final boolean manual) {
        if (!CHECKING.compareAndSet(false, true)) return;
        final Context app = ctx.getApplicationContext();
        new Thread(() -> {
            try {
                run(app, manual);
            } catch (Throwable t) {
                RecService.log("Errore nel controllo dei rapporti: " + t);
            } finally {
                CHECKING.set(false);
                version++;
            }
        }, "rapporti").start();
    }

    private static void run(Context app, boolean manual) {
        Prefs p = new Prefs(app);
        if (p.centralinoKey().isEmpty()) {
            if (manual) status = "Manca la chiave del centralino: apri Impostazioni";
            return;
        }
        try {
            List<Rapporto> nuovi = Centralino.rapporti(p, p.get("rapSeen", ""), KEEP);
            boolean primoGiro = !p.getBool("rapInit", false); // i rapporti già esistenti la prima volta non fanno notifica
            p.putBool("rapInit", true);
            if (!nuovi.isEmpty()) {
                List<Rapporto> tutti = new ArrayList<>(nuovi);
                for (Rapporto v : salvati(p)) {
                    boolean doppio = false;
                    for (Rapporto n : nuovi) if (n.id().equals(v.id())) doppio = true;
                    if (!doppio) tutti.add(v);
                }
                JSONArray a = new JSONArray();
                for (int i = 0; i < tutti.size() && i < KEEP; i++) a.put(tutti.get(i).j);
                p.put("rapList", a.toString());
                p.put("rapSeen", nuovi.get(0).id());
                if (!primoGiro) {
                    unread = true;
                    avvisa(app, nuovi.get(0));
                    RecService.stopReportWatch();
                }
            }
            status = manual ? (nuovi.isEmpty() ? "Nessun rapporto nuovo" : nuovi.size() == 1 ? "Un rapporto nuovo" : nuovi.size() + " rapporti nuovi") : "";
        } catch (Http.ApiError e) {
            if (e.status == 401) status = "Chiave del centralino non valida";
            else if (manual) status = "Centralino non raggiungibile: " + e.getMessage();
        }
    }

    /** Notifica "Nero: rapporto pronto" con la sintesi, e suono di esito (non durante una registrazione). */
    private static void avvisa(Context app, Rapporto r) {
        NotificationManager nm = app.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Rapporti di Nero", NotificationManager.IMPORTANCE_DEFAULT));
        Intent open = new Intent(app, RapportoActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(app, 2, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String s = r.sintesi().isEmpty() ? "Apri l'app per leggerlo" : r.sintesi();
        nm.notify(2, new Notification.Builder(app, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Nero: rapporto pronto")
                .setContentText(s)
                .setStyle(new Notification.BigTextStyle().bigText(s))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build());
        if (!Sync.recording()) Tones.report();
    }
}
