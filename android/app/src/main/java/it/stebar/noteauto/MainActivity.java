package it.stebar.noteauto;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Schermata principale: stato grande (registro / sincronizzo / tutto consegnato), elenco delle note, comandi. */
public class MainActivity extends Activity {

    private static final int REQ = 1;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LinearLayout root;
    private TextView state, info, listView;
    private Button toggleView, report;
    private android.view.View menuRow1, menuRow2, listScroll; // spariscono mentre si registra
    private MediaPlayer player;
    private boolean showLog;
    private int shownVersion = -1;
    private int pending;
    private String listText = "";

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(32, 56, 32, 24);
        root.setBackgroundColor(Color.rgb(17, 24, 39));

        state = new TextView(this);
        state.setTextSize(40);
        state.setTextColor(Color.WHITE);
        state.setGravity(Gravity.CENTER);
        state.setPadding(0, 40, 0, 40);
        state.setOnClickListener(v -> {
            if (RecService.instance != null) RecService.instance.toggle("tocco sullo schermo");
        });
        root.addView(state, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 2f));

        info = new TextView(this);
        info.setTextSize(15);
        info.setTextColor(Color.LTGRAY);
        root.addView(info);

        LinearLayout row1 = new LinearLayout(this);
        Button now = button("Consegna ora", v -> Sync.request(this, true));
        Button settings = button("Impostazioni", v -> startActivity(new Intent(this, SettingsActivity.class)));
        row1.addView(now, weight());
        row1.addView(settings, weight());
        report = button("Rapporto", v -> startActivity(new Intent(this, RapportoActivity.class)));
        row1.addView(report, weight());
        root.addView(row1);
        menuRow1 = row1;

        LinearLayout row2 = new LinearLayout(this);
        Button play = button("Ascolta l'ultima", v -> playLast());
        toggleView = button("Registro", v -> {
            showLog = !showLog;
            shownVersion = -1;
        });
        Button close = button("Chiudi", v -> {
            stopService(new Intent(this, RecService.class));
            finishAndRemoveTask();
        });
        row2.addView(play, weight());
        row2.addView(toggleView, weight());
        row2.addView(close, weight());
        root.addView(row2);
        menuRow2 = row2;

        ScrollView sv = new ScrollView(this);
        listView = new TextView(this);
        listView.setTextSize(14);
        listView.setTextColor(Color.WHITE);
        listView.setPadding(0, 16, 0, 0);
        sv.addView(listView);
        root.addView(sv, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 3f));
        listScroll = sv;
        // mentre si registra tutto lo schermo è il pulsante: anche il bordo fuori dalla scritta prende il tocco
        root.setOnClickListener(v -> {
            if (RecService.instance != null && RecService.instance.isRecording()) RecService.instance.toggle("tocco sullo schermo");
        });

        setContentView(root);
        askPermissions();
    }

    private Button button(String text, android.view.View.OnClickListener l) {
        Button bt = new Button(this);
        bt.setText(text);
        bt.setAllCaps(false);
        bt.setTextSize(13);
        bt.setOnClickListener(l);
        return bt;
    }

    private LinearLayout.LayoutParams weight() {
        return new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
    }

    private void askPermissions() {
        List<String> need = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.RECORD_AUDIO);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.POST_NOTIFICATIONS);
        if (need.isEmpty()) startRecService();
        else requestPermissions(need.toArray(new String[0]), REQ);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            startRecService();
        } else {
            RecService.log("Permesso microfono negato: senza non si può registrare");
        }
    }

    private void startRecService() {
        if (RecService.instance == null) startForegroundService(new Intent(this, RecService.class));
    }

    // Tasto volume con l'app aperta e lo schermo acceso.
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            if (event.getRepeatCount() == 0 && RecService.instance != null) {
                RecService.instance.toggle("volume (app aperta)");
            }
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) return true;
        return super.onKeyUp(keyCode, event);
    }

    private void playLast() {
        RecService s = RecService.instance;
        if (s != null && s.isRecording()) return;
        List<Note> all = Note.loadAll(this);
        if (all.isEmpty()) return;
        File f = all.get(all.size() - 1).audio;
        try {
            if (player != null) player.release();
            player = new MediaPlayer();
            player.setDataSource(f.getAbsolutePath());
            player.prepare();
            player.start();
        } catch (Exception e) {
            RecService.log("Ascolto non riuscito: " + e);
        }
    }

    private void reloadList() {
        List<Note> all = Note.loadAll(this);
        SimpleDateFormat fmt = new SimpleDateFormat("dd/MM HH:mm", Locale.ITALY);
        StringBuilder sb = new StringBuilder();
        int p = 0;
        for (int i = all.size() - 1; i >= 0; i--) {
            Note n = all.get(i);
            if (Note.NEW.equals(n.state) || Note.READY.equals(n.state)) p++;
            if (Note.OLD.equals(n.state)) continue;
            if (sb.length() > 0) sb.append('\n');
            sb.append(fmt.format(n.startMs)).append(" · ").append(n.durSec / 60).append(':')
                    .append(String.format(Locale.ITALY, "%02d", n.durSec % 60)).append(" · ").append(label(n)).append('\n');
            String t = n.raw;
            if (!n.error.isEmpty() && !Note.ERROR.equals(n.state)) sb.append("   ⚠ ").append(n.error.length() > 160 ? n.error.substring(0, 160) + "…" : n.error).append('\n');
            if (!t.isEmpty()) sb.append("   ").append(t.length() > 90 ? t.substring(0, 90) + "…" : t.replace('\n', ' ')).append('\n');
        }
        pending = p;
        listText = sb.length() == 0 ? "Nessuna nota ancora." : sb.toString();
    }

    private String origine(Note n) {
        if ("locale".equals(n.via)) return " · locale";
        if ("whisper".equals(n.via) || !n.raw.isEmpty()) return " · Whisper";
        return "";
    }

    private String label(Note n) {
        switch (n.state) {
            case Note.NEW:
                if (CodaLocale.inCoda(n.id)) return "in trascrizione…";
                if (n.locTries >= CodaLocale.MAX_PROVE || !new Prefs(this).getBool("voceLocale", true)) return "in attesa di Whisper";
                return "da trascrivere";
            case Note.READY: return "pronta, da consegnare" + origine(n);
            case Note.DELIVERED: return "consegnata ✓" + origine(n);
            case Note.EMPTY: return "nessun parlato";
            case Note.ERROR: return "ERRORE: " + n.error;
            default: return n.state;
        }
    }

    private final Runnable refresh = new Runnable() {
        @Override
        public void run() {
            if (shownVersion != Note.version) {
                shownVersion = Note.version;
                reloadList();
            }
            RecService s = RecService.instance;
            boolean rec = s != null && s.isRecording();
            int bg = Color.rgb(17, 24, 39);
            float size = 40;
            String text;
            if (s == null) {
                text = "AVVIO…";
            } else if (rec) {
                long sec = s.recordingSeconds();
                text = String.format(Locale.ITALY, "REGISTRO\n%d:%02d", sec / 60, sec % 60);
                bg = Color.rgb(185, 28, 28);
            } else if (Sync.phase == Sync.RUNNING) {
                text = "SINCRONIZZO\n" + Sync.message;
                bg = Color.rgb(29, 78, 216);
                size = 28;
            } else if (Sync.phase == Sync.DONE) {
                text = "TUTTO CONSEGNATO ✓\n" + Sync.message;
                bg = Color.rgb(21, 128, 61);
                size = 30;
            } else if (Sync.phase == Sync.ERROR) {
                text = "ATTENZIONE\n" + Sync.message;
                bg = Color.rgb(180, 83, 9);
                size = 24;
            } else if (pending > 0) {
                text = "PRONTO\n" + pending + (pending == 1 ? " nota da consegnare" : " note da consegnare");
                size = 32;
            } else {
                text = "PRONTO\ntasto volume";
            }
            int vis = rec ? android.view.View.GONE : android.view.View.VISIBLE;
            info.setVisibility(vis);
            menuRow1.setVisibility(vis);
            menuRow2.setVisibility(vis);
            listScroll.setVisibility(vis);
            state.setText(text);
            state.setTextSize(size);
            root.setBackgroundColor(bg);
            info.setText("Da consegnare: " + pending + "   ·   versione " + BuildConfigInfo.VERSION);
            toggleView.setText(showLog ? "Note" : "Registro");
            report.setText(Rapporti.unread ? "Rapporto ●" : "Rapporto");
            if (showLog) {
                StringBuilder sb = new StringBuilder();
                synchronized (RecService.LOG) {
                    for (String line : RecService.LOG) sb.append(line).append('\n');
                }
                listView.setText(sb.toString());
            } else {
                listView.setText(listText);
            }
            handler.postDelayed(this, 400);
        }
    };

    @Override
    protected void onResume() {
        super.onResume();
        shownVersion = -1;
        Rapporti.check(this, false);
        handler.post(refresh);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(refresh);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (player != null) player.release();
        super.onDestroy();
    }
}
