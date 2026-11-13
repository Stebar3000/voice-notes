package it.stebar.noteauto;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.List;
import java.util.Locale;

/**
 * Schermata "Rapporto": l'ultimo rapporto di Nero nell'ordine del protocollo (chi ha lavorato, fatto, decisioni rapide,
 * da sapere, problemi, in fondo i dubbi "quando vuoi") e l'elenco degli ultimi 5. La lettura ad alta voce parte solo
 * dal tasto; un secondo tocco la ferma.
 */
public class RapportoActivity extends Activity {

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Prefs prefs;
    private LinearLayout content;
    private TextView statusView;
    private Button readBtn;
    private TextToSpeech tts;
    private boolean ttsReady, speaking;
    private int shown;            // quale degli ultimi rapporti è aperto (0 = il più recente)
    private int shownVersion = -1;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = new Prefs(this);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(32, 48, 32, 48);

        TextView title = text("Rapporto di Nero", 26, Color.WHITE);
        col.addView(title);

        LinearLayout row = new LinearLayout(this);
        row.addView(button("← Indietro", v -> finish()), weight());
        row.addView(button("Aggiorna", v -> {
            Rapporti.status = "Controllo…";
            Rapporti.check(this, true);
            shownVersion = -1;
        }), weight());
        col.addView(row);

        readBtn = button("Leggi l'ultimo rapporto", v -> toggleSpeech());
        col.addView(readBtn, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        statusView = text("", 14, Color.rgb(250, 204, 21));
        statusView.setPadding(0, 12, 0, 4);
        col.addView(statusView);

        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        col.addView(content);

        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(Color.rgb(17, 24, 39));
        sv.addView(col);
        setContentView(sv);

        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            int r = tts.setLanguage(Locale.ITALIAN);
            ttsReady = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED;
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }

                @Override public void onDone(String id) { speechEnded(); }

                @Override public void onError(String id) { speechEnded(); }
            });
        });
    }

    private void speechEnded() {
        speaking = false;
        handler.post(() -> readBtn.setText("Leggi l'ultimo rapporto"));
    }

    private void toggleSpeech() {
        if (speaking) {
            tts.stop();
            speechEnded();
            return;
        }
        List<Rapporti.Rapporto> all = Rapporti.salvati(prefs);
        if (all.isEmpty()) {
            Rapporti.status = "Nessun rapporto da leggere";
            shownVersion = -1;
            return;
        }
        if (!ttsReady) {
            Rapporti.status = "Voce italiana non disponibile sul telefono";
            shownVersion = -1;
            return;
        }
        String t = all.get(0).daLeggere();
        int max = TextToSpeech.getMaxSpeechInputLength();
        if (t.length() > max) t = t.substring(0, max);
        speaking = true;
        readBtn.setText("Ferma la lettura");
        tts.speak(t, TextToSpeech.QUEUE_FLUSH, null, "nero");
    }

    private void draw() {
        content.removeAllViews();
        List<Rapporti.Rapporto> all = Rapporti.salvati(prefs);
        if (all.isEmpty()) {
            content.addView(text(prefs.centralinoKey().isEmpty()
                    ? "Nessun rapporto. Scrivi la chiave del centralino nelle Impostazioni."
                    : "Nessun rapporto ancora. Dopo una consegna arriva da solo; oppure tocca Aggiorna.", 15, Color.LTGRAY));
            return;
        }
        if (shown >= all.size()) shown = 0;
        Rapporti.Rapporto r = all.get(shown);

        String chi = r.chi().isEmpty() ? "Nero" : r.chi();
        content.addView(heading("Ha lavorato: " + chi + (r.lotto().isEmpty() ? "" : " (lotto " + r.lotto() + ")")));
        if (!r.chat().isEmpty()) {
            final String url = r.chat();
            content.addView(button("Apri la chat", v -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (ActivityNotFoundException | SecurityException e) {
                    Rapporti.status = "Non riesco ad aprire il collegamento";
                    shownVersion = -1;
                }
            }));
        }
        if (!r.sintesi().isEmpty()) content.addView(text(r.sintesi(), 16, Color.WHITE));
        section("Fatto", r.elenco("fatto"));
        section("Decisioni rapide", r.elenco("decisioni"));
        section("Da sapere", r.elenco("da_sapere"));
        section("Problemi", r.elenco("problemi"));
        List<String> dubbi = r.elenco("dubbi");
        if (!dubbi.isEmpty()) {
            TextView sep = heading("Dubbi (quando vuoi)");
            sep.setPadding(0, 72, 0, 8); // staccati dal resto: non sono urgenti
            sep.setTextColor(Color.rgb(156, 163, 175));
            content.addView(sep);
            for (String d : dubbi) content.addView(text("• " + d, 15, Color.rgb(209, 213, 219)));
        }

        TextView hist = heading("Ultimi rapporti");
        hist.setPadding(0, 72, 0, 8);
        content.addView(hist);
        for (int i = 0; i < all.size(); i++) {
            final int idx = i;
            Rapporti.Rapporto x = all.get(i);
            String s = x.sintesi().replace('\n', ' ');
            if (s.length() > 90) s = s.substring(0, 90) + "…";
            Button bt = button((i == shown ? "▶ " : "") + (x.lotto().isEmpty() ? x.chi() : x.lotto()) + " · " + s, v -> {
                shown = idx;
                shownVersion = -1;
            });
            bt.setGravity(android.view.Gravity.START | android.view.Gravity.CENTER_VERTICAL);
            content.addView(bt, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        }
    }

    private void section(String name, List<String> items) {
        if (items.isEmpty()) return;
        content.addView(heading(name));
        for (String s : items) content.addView(text("• " + s, 15, Color.WHITE));
    }

    private TextView heading(String t) {
        TextView v = text(t, 18, Color.rgb(147, 197, 253));
        v.setPadding(0, 28, 0, 6);
        return v;
    }

    private TextView text(String t, int size, int color) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextSize(size);
        v.setTextColor(color);
        v.setPadding(0, 4, 0, 4);
        return v;
    }

    private Button button(String t, android.view.View.OnClickListener l) {
        Button bt = new Button(this);
        bt.setText(t);
        bt.setAllCaps(false);
        bt.setOnClickListener(l);
        return bt;
    }

    private LinearLayout.LayoutParams weight() {
        return new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
    }

    private final Runnable refresh = new Runnable() {
        @Override
        public void run() {
            if (shownVersion != Rapporti.version) {
                shownVersion = Rapporti.version;
                Rapporti.unread = false;
                draw();
            }
            statusView.setText(Rapporti.status);
            handler.postDelayed(this, 500);
        }
    };

    @Override
    protected void onResume() {
        super.onResume();
        shownVersion = -1;
        Rapporti.check(this, true);
        handler.post(refresh);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(refresh);
        if (speaking && tts != null) tts.stop(); // niente lettura che continua fuori dalla schermata
        speaking = false;
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        super.onDestroy();
    }
}
