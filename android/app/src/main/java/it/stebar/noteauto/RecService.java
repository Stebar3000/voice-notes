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
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
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
 * Servizio in primo piano: tiene il microfono, registra (tasto volume anche a schermo spento),
 * e lancia la sincronizzazione quando c'è rete o dopo una pausa di dettatura.
 */
public class RecService extends Service {

    static volatile RecService instance;
    static final List<String> LOG = Collections.synchronizedList(new ArrayList<>());

    private static final String CHANNEL = "noteauto";
    private static final long MIN_GAP_MS = 800;
    private static final long MIN_NOTE_MS = 1000;      // registrazioni più corte vengono scartate
    private static final long SILENT_CHECK_MS = 3000;  // dopo quanto, con microfono muto, si avvisa
    private static final long RETRY_MS = 5 * 60_000L;
    private static final int MAX_RETRIES = 6;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private MediaRecorder recorder;
    private File current;
    private long startMs;          // orologio di sistema, per la scheda della nota
    private long startElapsed;     // orologio monotono, per la durata
    private volatile boolean recording;
    private long lastToggle;
    private MediaSession session;
    private ToneGenerator tone;
    private PowerManager.WakeLock wakeLock;
    private ConnectivityManager cm;
    private ConnectivityManager.NetworkCallback netCallback;
    private int maxAmp;
    private boolean silentWarned;
    private int retries;
    private String lastStatus = "Pronto";

    static void log(String s) {
        String t = new SimpleDateFormat("HH:mm:ss", Locale.ITALY).format(new Date());
        synchronized (LOG) {
            LOG.add(0, t + "  " + s);
            while (LOG.size() > 60) LOG.remove(LOG.size() - 1);
        }
    }

    /** Aggiorna il testo della notifica fissa (usato dalla sincronizzazione). */
    static void status(String text) {
        RecService s = instance;
        if (s != null) s.handler.post(() -> s.updateNotification(text));
    }

    static void scheduleRetry() {
        RecService s = instance;
        if (s != null) s.handler.post(s::doScheduleRetry);
    }

    static void resetRetry() {
        RecService s = instance;
        if (s != null) s.retries = 0;
    }

    private void doScheduleRetry() {
        if (retries >= MAX_RETRIES) return;
        retries++;
        handler.removeCallbacks(retryRun);
        handler.postDelayed(retryRun, RETRY_MS);
    }

    private final Runnable retryRun = () -> {
        if (!recording) Sync.request(this, false);
    };

    private final Runnable idleSync = () -> {
        if (!recording) Sync.request(this, false);
    };

    boolean isRecording() { return recording; }

    long recordingSeconds() { return recording ? (SystemClock.elapsedRealtime() - startElapsed) / 1000 : 0; }

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
        try { tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 70); } catch (RuntimeException e) { log("Suoni non disponibili: " + e); }
        PowerManager pm = getSystemService(PowerManager.class);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "noteauto:rec");
        setupSession();
        Note.migrateOnce(this, new Prefs(this));
        watchNetwork();
        log("Servizio avviato (versione " + BuildConfigInfo.VERSION + ")");
    }

    // ---------- rete: quando torna (hotspot, Wi-Fi) parte la consegna ----------

    private void watchNetwork() {
        cm = getSystemService(ConnectivityManager.class);
        netCallback = new ConnectivityManager.NetworkCallback() {
            private long lastTry;

            @Override
            public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) return;
                long now = SystemClock.elapsedRealtime();
                if (now - lastTry < 20_000) return; // la rete segnala spesso piccoli cambi: una prova ogni 20 s
                lastTry = now;
                handler.postDelayed(() -> {
                    if (!recording && !Sync.isBusy()) Sync.request(RecService.this, false);
                }, 2000);
            }
        };
        try {
            cm.registerDefaultNetworkCallback(netCallback);
        } catch (RuntimeException e) {
            log("Controllo rete non disponibile: " + e);
        }
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
        handler.removeCallbacks(idleSync);
        handler.removeCallbacks(retryRun);
        try {
            File dir = Note.dir(this);
            String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ITALY).format(new Date());
            current = new File(dir, "rec-" + stamp + ".m4a");
            Note.recordingPath = current.getAbsolutePath();
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
            startMs = System.currentTimeMillis();
            startElapsed = SystemClock.elapsedRealtime();
            maxAmp = 0;
            silentWarned = false;
            Sync.phase = Sync.IDLE; // lo schermo "tutto consegnato" lascia il posto alla registrazione
            wakeLock.acquire(4L * 60 * 60 * 1000);
            beep(ToneGenerator.TONE_PROP_BEEP, 250);
            vibrate(150);
            updateNotification("Sto registrando");
            handler.postDelayed(ampCheck, 300);
            log("AVVIO da " + source + screenState());
        } catch (Exception e) {
            log("ERRORE avvio: " + e);
            releaseRecorder();
            recording = false;
            Note.recordingPath = null;
            if (current != null) { //noinspection ResultOfMethodCallIgnored
                current.delete();
            }
            Tones.error();
        }
    }

    /** Ogni 300 ms controlla che il microfono senta qualcosa: se Android lo silenzia, l'audio è tutto zero. */
    private final Runnable ampCheck = new Runnable() {
        @Override
        public void run() {
            if (!recording || recorder == null) return;
            try {
                maxAmp = Math.max(maxAmp, recorder.getMaxAmplitude());
            } catch (RuntimeException ignored) {
                // non ancora pronto
            }
            long elapsed = SystemClock.elapsedRealtime() - startElapsed;
            if (!silentWarned && elapsed >= SILENT_CHECK_MS && maxAmp == 0) {
                silentWarned = true;
                log("ATTENZIONE: il microfono non sente nulla (silenziato da Android?)");
                Tones.error();
                vibrate(400);
            }
            handler.postDelayed(this, 300);
        }
    };

    private void stopRec(String source) {
        handler.removeCallbacks(ampCheck);
        long elapsedMs = SystemClock.elapsedRealtime() - startElapsed;
        boolean stopOk = true;
        try {
            maxAmp = Math.max(maxAmp, recorder.getMaxAmplitude());
        } catch (RuntimeException ignored) { }
        try {
            recorder.stop();
        } catch (RuntimeException e) {
            stopOk = false; // succede con registrazioni brevissime: senza dati validi
        }
        releaseRecorder();
        recording = false;
        Note.recordingPath = null;
        if (wakeLock.isHeld()) wakeLock.release();
        updateNotification("Pronto");
        File f = current;
        long sec = elapsedMs / 1000;

        if (elapsedMs < MIN_NOTE_MS || !stopOk) {
            if (f != null) { //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
            vibrate(80);
            Tones.tooShort();
            log("STOP da " + source + screenState() + " · troppo breve, scartata");
            scheduleIdleSync();
            return;
        }
        if (elapsedMs >= 2000 && maxAmp == 0) {
            if (f != null) { //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
            vibrate(400);
            Tones.error();
            log("STOP da " + source + screenState() + " · " + sec + " s · MICROFONO MUTO: registrazione scartata");
            scheduleIdleSync();
            return;
        }
        Note.create(f, startMs, (int) sec);
        long kb = f != null && f.exists() ? f.length() / 1024 : 0;
        beep(ToneGenerator.TONE_PROP_ACK, 400);
        vibrate(80);
        log("STOP da " + source + screenState() + " · " + sec + " s · " + kb + " KB");
        scheduleIdleSync();
    }

    /** Dopo una nota, se non ne arriva un'altra entro la pausa di sessione, parte la consegna (se c'è rete). */
    private void scheduleIdleSync() {
        handler.removeCallbacks(idleSync);
        handler.postDelayed(idleSync, new Prefs(this).sessionMinutes() * 60_000L);
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
                .setContentTitle("Note Auto")
                .setContentText(text)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();
    }

    private void updateNotification(String text) {
        lastStatus = text;
        getSystemService(NotificationManager.class).notify(1, buildNotification(text));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (recording) stopRec("chiusura del servizio");
        if (cm != null && netCallback != null) {
            try { cm.unregisterNetworkCallback(netCallback); } catch (RuntimeException ignored) { }
        }
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

    @SuppressWarnings("unused")
    String lastStatus() { return lastStatus; }
}
