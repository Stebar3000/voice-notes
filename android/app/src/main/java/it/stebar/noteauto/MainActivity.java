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
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Schermata della prova: stato grande, registro eventi, ascolto dell'ultima registrazione. */
public class MainActivity extends Activity {

    private static final int REQ = 1;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LinearLayout root;
    private TextView state, info, log;
    private MediaPlayer player;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(32, 64, 32, 32);
        root.setBackgroundColor(Color.rgb(17, 24, 39));

        state = new TextView(this);
        state.setTextSize(44);
        state.setTextColor(Color.WHITE);
        state.setGravity(Gravity.CENTER);
        state.setPadding(0, 60, 0, 60);
        state.setOnClickListener(v -> {
            if (RecService.instance != null) RecService.instance.toggle("tocco sullo schermo");
        });
        root.addView(state, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 2f));

        info = new TextView(this);
        info.setTextSize(16);
        info.setTextColor(Color.LTGRAY);
        root.addView(info);

        LinearLayout row = new LinearLayout(this);
        Button play = new Button(this);
        play.setText("Ascolta l'ultima");
        play.setOnClickListener(v -> playLast());
        Button close = new Button(this);
        close.setText("Chiudi del tutto");
        close.setOnClickListener(v -> {
            stopService(new Intent(this, RecService.class));
            finishAndRemoveTask();
        });
        row.addView(play);
        row.addView(close);
        root.addView(row);

        ScrollView sv = new ScrollView(this);
        log = new TextView(this);
        log.setTextSize(14);
        log.setTextColor(Color.WHITE);
        sv.addView(log);
        root.addView(sv, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 3f));

        setContentView(root);
        askPermissions();
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
            RecService.log("Permesso microfono negato: la prova non può funzionare");
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

    private File lastRecording() {
        File dir = getExternalFilesDir(null);
        File[] files = dir == null ? null : dir.listFiles((d, n) -> n.endsWith(".m4a"));
        if (files == null || files.length == 0) return null;
        Arrays.sort(files, (a, c) -> c.getName().compareTo(a.getName()));
        return files[0];
    }

    private int recordingCount() {
        File dir = getExternalFilesDir(null);
        File[] files = dir == null ? null : dir.listFiles((d, n) -> n.endsWith(".m4a"));
        return files == null ? 0 : files.length;
    }

    private void playLast() {
        RecService s = RecService.instance;
        if (s != null && s.isRecording()) return;
        File f = lastRecording();
        if (f == null) return;
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

    private final Runnable refresh = new Runnable() {
        @Override
        public void run() {
            RecService s = RecService.instance;
            boolean rec = s != null && s.isRecording();
            if (s == null) {
                state.setText("AVVIO…");
                root.setBackgroundColor(Color.rgb(17, 24, 39));
            } else if (rec) {
                long sec = s.recordingSeconds();
                state.setText(String.format("REGISTRO\n%d:%02d", sec / 60, sec % 60));
                root.setBackgroundColor(Color.rgb(185, 28, 28));
            } else {
                state.setText("PRONTO\ntasto volume");
                root.setBackgroundColor(Color.rgb(17, 24, 39));
            }
            info.setText("Registrazioni salvate: " + recordingCount() + "   ·   versione " + BuildConfigInfo.VERSION);
            StringBuilder sb = new StringBuilder();
            synchronized (RecService.LOG) {
                for (String line : RecService.LOG) sb.append(line).append('\n');
            }
            log.setText(sb.toString());
            handler.postDelayed(this, 400);
        }
    };

    @Override
    protected void onResume() {
        super.onResume();
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

    @SuppressWarnings("unused")
    private static void unused(View v) { }
}
