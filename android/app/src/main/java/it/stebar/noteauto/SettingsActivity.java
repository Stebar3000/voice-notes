package it.stebar.noteauto;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Impostazioni: chiave Groq, collegamento a Dropbox, pausa di sessione, regole di pulizia. Salva da sola. */
public class SettingsActivity extends Activity {

    private Prefs prefs;
    private EditText groqKey, appKey, base, code, sessionMin, rules, vocab;
    private TextView dbxStatus, result;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = new Prefs(this);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(32, 48, 32, 48);

        col.addView(title("Impostazioni"));

        col.addView(section("Groq (trascrizione e pulizia)"));
        groqKey = edit("Chiave Groq (inizia con gsk_)", false);
        col.addView(groqKey);
        col.addView(row(button("Incolla", v -> paste(groqKey)), button("Prova Groq", v -> testGroq())));

        col.addView(section("Dropbox (consegna delle note)"));
        col.addView(note("Una sola volta: crea l'app su Dropbox, scrivi qui la sua App key, tocca 1 e autorizza, "
                + "copia il codice che Dropbox ti mostra, incollalo qui sotto e tocca 2."));
        appKey = edit("App key di Dropbox", false);
        col.addView(appKey);
        col.addView(row(button("Incolla", v -> paste(appKey)), button("1 · Autorizza su Dropbox", v -> startAuth())));
        code = edit("Codice mostrato da Dropbox", false);
        col.addView(code);
        col.addView(row(button("Incolla", v -> paste(code)), button("2 · Collega", v -> finishAuth())));
        dbxStatus = new TextView(this);
        dbxStatus.setTextSize(15);
        dbxStatus.setPadding(0, 12, 0, 12);
        col.addView(dbxStatus);
        base = edit("Cartella su Dropbox", false);
        col.addView(base);
        col.addView(row(button("Prova Dropbox", v -> testDropbox())));

        col.addView(section("Sessioni di dettatura"));
        col.addView(note("Pausa (in minuti) dopo la quale una nota nuova apre un file nuovo; "
                + "dopo l'ultima nota la consegna parte da sola, se c'è rete, trascorso questo tempo."));
        sessionMin = edit("Minuti", false);
        sessionMin.setInputType(InputType.TYPE_CLASS_NUMBER);
        col.addView(sessionMin);

        col.addView(section("Pulizia del testo"));
        col.addView(note("Regole personali (facoltative), una per riga. Hanno la precedenza."));
        rules = edit("Es. Scrivi sempre \"Sara\" con una sola r", true);
        col.addView(rules);
        col.addView(note("Parole difficili da riconoscere (nomi, luoghi, sigle), separate da virgole."));
        vocab = edit("Es. Bargnani, Lisbona, Todoist, Joplin", true);
        col.addView(vocab);

        result = new TextView(this);
        result.setTextSize(15);
        result.setTextColor(Color.rgb(250, 204, 21));
        result.setPadding(0, 24, 0, 8);
        col.addView(result);

        TextView ver = note("Versione " + BuildConfigInfo.VERSION + " · le modifiche si salvano da sole.");
        col.addView(ver);

        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(Color.rgb(17, 24, 39));
        sv.addView(col);
        setContentView(sv);

        load();
    }

    private TextView title(String t) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextSize(26);
        v.setTextColor(Color.WHITE);
        return v;
    }

    private TextView section(String t) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextSize(18);
        v.setTextColor(Color.rgb(147, 197, 253));
        v.setPadding(0, 36, 0, 8);
        return v;
    }

    private TextView note(String t) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextSize(13);
        v.setTextColor(Color.LTGRAY);
        v.setPadding(0, 4, 0, 4);
        return v;
    }

    private EditText edit(String hint, boolean multi) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setTextColor(Color.WHITE);
        e.setHintTextColor(Color.GRAY);
        e.setTextSize(15);
        if (multi) {
            e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            e.setMinLines(2);
        } else {
            e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
            e.setSingleLine(true);
        }
        return e;
    }

    private Button button(String t, View.OnClickListener l) {
        Button bt = new Button(this);
        bt.setText(t);
        bt.setAllCaps(false);
        bt.setOnClickListener(l);
        return bt;
    }

    private LinearLayout row(View... views) {
        LinearLayout r = new LinearLayout(this);
        for (View v : views) r.addView(v, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        return r;
    }

    private void paste(EditText target) {
        ClipboardManager cb = getSystemService(ClipboardManager.class);
        ClipData d = cb == null ? null : cb.getPrimaryClip();
        if (d == null || d.getItemCount() == 0) {
            say("Gli appunti sono vuoti.");
            return;
        }
        CharSequence t = d.getItemAt(0).coerceToText(this);
        target.setText(t == null ? "" : t.toString().trim());
    }

    private void load() {
        groqKey.setText(prefs.get("groqKey", ""));
        appKey.setText(prefs.get("dbxAppKey", ""));
        base.setText(prefs.get("dbxBase", Prefs.DEFAULT_BASE));
        code.setText("");
        sessionMin.setText(prefs.get("sessionMin", "10"));
        rules.setText(prefs.get("rules", ""));
        vocab.setText(prefs.get("vocab", ""));
        updateStatus();
    }

    private void save() {
        String newKey = appKey.getText().toString().trim();
        if (!newKey.equals(prefs.get("dbxAppKey", ""))) prefs.put("dbxRefresh", ""); // altra app Dropbox: da ricollegare
        prefs.put("groqKey", groqKey.getText().toString().trim());
        prefs.put("dbxAppKey", newKey);
        prefs.put("dbxBase", base.getText().toString().trim());
        prefs.put("sessionMin", sessionMin.getText().toString().trim());
        prefs.put("rules", rules.getText().toString());
        prefs.put("vocab", vocab.getText().toString());
    }

    private void updateStatus() {
        if (prefs.dropboxConnected()) {
            dbxStatus.setText("Dropbox: COLLEGATO ✓");
            dbxStatus.setTextColor(Color.rgb(134, 239, 172));
        } else {
            dbxStatus.setText("Dropbox: non collegato");
            dbxStatus.setTextColor(Color.rgb(253, 186, 116));
        }
    }

    private void say(final String s) {
        runOnUiThread(() -> result.setText(s));
    }

    // ---------- azioni ----------

    private void testGroq() {
        save();
        say("Provo Groq…");
        new Thread(() -> {
            String err = prefs.groqKey().isEmpty() ? "scrivi prima la chiave" : Groq.test(prefs);
            say(err == null ? "Groq: tutto a posto ✓" : "Groq: " + err);
        }).start();
    }

    private void startAuth() {
        save();
        if (prefs.dbxAppKey().isEmpty()) {
            say("Scrivi prima l'App key di Dropbox.");
            return;
        }
        try {
            String url = Dropbox.startAuth(prefs);
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            say("Autorizza nella pagina di Dropbox, copia il codice, torna qui e incollalo.");
        } catch (Exception e) {
            say("Non riesco ad aprire Dropbox: " + e);
        }
    }

    private void finishAuth() {
        save();
        final String c = code.getText().toString().trim();
        if (c.isEmpty()) {
            say("Incolla prima il codice mostrato da Dropbox.");
            return;
        }
        say("Collego Dropbox…");
        new Thread(() -> {
            try {
                Dropbox.finishAuth(prefs, c);
                say("Dropbox collegato ✓. Ora tocca \"Prova Dropbox\".");
                runOnUiThread(() -> {
                    code.setText("");
                    updateStatus();
                });
            } catch (Http.ApiError e) {
                say("Collegamento non riuscito: " + e.getMessage());
            }
        }).start();
    }

    private void testDropbox() {
        save();
        if (!prefs.dropboxConnected()) {
            say("Dropbox non è ancora collegato.");
            return;
        }
        say("Provo a scrivere su Dropbox…");
        new Thread(() -> {
            try {
                String when = new SimpleDateFormat("dd/MM/yyyy HH:mm:ss", Locale.ITALY).format(new Date());
                String resp = Dropbox.upload(prefs, "/prova-connessione.txt", Http.utf8("Prova di Note Auto del " + when + "\n"), true);
                say("Dropbox ha risposto ✓\n" + resp);
            } catch (Http.ApiError e) {
                say("Dropbox: " + e.getMessage());
            }
        }).start();
    }

    @Override
    protected void onPause() {
        save();
        super.onPause();
    }
}
