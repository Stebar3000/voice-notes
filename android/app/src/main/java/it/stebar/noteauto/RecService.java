package it.stebar.noteauto;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.media.MediaRecorder;
import android.media.ToneGenerator;
import android.media.VolumeProvider;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.KeyEvent;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Servizio in primo piano che tiene il microfono e registra.
 * Prova tre modi di comando: tasto volume con l'app aperta (dalla MainActivity),
 * tasto volume tramite sessione multimediale (per lo schermo spento), tasti multimediali Bluetooth.
 */
public class RecService extends Service {

    static volatile RecService instance;
    static final List<String> LOG = Collections.synchronizedList(new ArrayList<>());

    private static final String CHANNEL = "noteauto";
    private static final long MIN_GAP_MS = 800;

    private MediaRecorder recorder;
    private File current;
    private long startMs;
    private volatile boolean recording;
    private long lastToggle;
    private MediaSession session;
    private ToneGenerator tone;
    private PowerManager.WakeLock wakeLock;

    static void log(String s) {
        String t = new SimpleDateFormat("HH:mm:ss", Locale.ITALY).format(new Date());
        synchronized (LOG) {
            LOG.add(0, t + "  " + s);
            while (LOG.size() > 40) LOG.remove(LOG.size() - 1);
        }
    }

    boolean isRecording() { return recording; }

    long recordingSeconds() { return recording ? (SystemClock.elapsedRealtime() - startMs) / 1000 : 0; }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Registratore", NotificationManager.IMPORTANCE_LOW));
        Notification n = buildNotification("Pronto");
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(1, n);
        }
        try { tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 100); } catch (RuntimeException e) { log("Suoni non disponibili: " + e); }
        PowerManager pm = getSystemService(PowerManager.class);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "noteauto:rec");
        setupSession();
        log("Servizio avviato");
    }

    private void setupSession() {
        session = new MediaSession(this, "NoteAuto");
        session.setCallback(new MediaSession.Callback() {
            @Override
            public boolean onMediaButtonEvent(Intent intent) {
                KeyEvent ev = intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                if (ev != null && ev.getAction() == KeyEvent.ACTION_DOWN && ev.getRepeatCount() == 0) {
                    toggle("tasto multimediale " + KeyEvent.keyCodeToString(ev.getKeyCode()));
                }
                return true;
            }
        });
        session.setPlaybackToRemote(new VolumeProvider(VolumeProvider.VOLUME_CONTROL_RELATIVE, 100, 50) {
            @Override
            public void onAdjustVolume(int direction) {
                if (direction != 0) toggle("volume (sessione multimediale)");
            }
        });
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE)
                .setState(PlaybackState.STATE_PLAYING, 0, 1f)
                .build());
        session.setActive(true);
    }

    synchronized void toggle(String source) {
        long now = SystemClock.elapsedRealtime();
        if (now - lastToggle < MIN_GAP_MS) return;
        lastToggle = now;
        if (recording) stopRec(source); else startRec(source);
    }

    private String screenState() {
        PowerManager pm = getSystemService(PowerManager.class);
        return pm.isInteractive() ? "" : " [schermo spento]";
    }

    private void startRec(String source) {
        try {
            File dir = getExternalFilesDir(null);
            String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ITALY).format(new Date());
            current = new File(dir, "rec-" + stamp + ".m4a");
            recorder = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioChannels(1);
            recorder.setAudioSamplingRate(44100);
            recorder.setAudioEncodingBitRate(64000);
            recorder.setOutputFile(current.getAbsolutePath());
            recorder.prepare();
            recorder.start();
            recording = true;
            startMs = SystemClock.elapsedRealtime();
            wakeLock.acquire(4L * 60 * 60 * 1000);
            beep(ToneGenerator.TONE_PROP_BEEP, 250);
            vibrate(150);
            updateNotification("Sto registrando");
            log("AVVIO da " + source + screenState());
        } catch (Exception e) {
            log("ERRORE avvio: " + e);
            releaseRecorder();
            recording = false;
            beep(ToneGenerator.TONE_SUP_ERROR, 600);
        }
    }

    private void stopRec(String source) {
        long sec = recordingSeconds();
        try {
            recorder.stop();
        } catch (RuntimeException e) {
            log("ERRORE stop: " + e);
        }
        releaseRecorder();
        recording = false;
        if (wakeLock.isHeld()) wakeLock.release();
        long kb = current != null && current.exists() ? current.length() / 1024 : 0;
        beep(ToneGenerator.TONE_PROP_ACK, 400);
        vibrate(80);
        updateNotification("Pronto");
        log("STOP da " + source + screenState() + " · " + sec + " s · " + kb + " KB");
    }

    private void releaseRecorder() {
        if (recorder != null) {
            try { recorder.release(); } catch (RuntimeException ignored) { }
            recorder = null;
        }
    }

    private void beep(int type, int ms) {
        if (tone != null) {
            try { tone.startTone(type, ms); } catch (RuntimeException ignored) { }
        }
    }

    private void vibrate(int ms) {
        Vibrator v = getSystemService(Vibrator.class);
        if (v != null && v.hasVibrator()) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Note Auto prova")
                .setContentText(text)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();
    }

    private void updateNotification(String text) {
        getSystemService(NotificationManager.class).notify(1, buildNotification(text));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (recording) stopRec("chiusura del servizio");
        if (session != null) session.release();
        if (tone != null) tone.release();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        instance = null;
        log("Servizio fermato");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
