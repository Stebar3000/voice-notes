package it.stebar.noteauto;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;

/** Compressione di un wav (PCM 16 kHz mono) in m4a AAC a 32 kbit/s: circa un ottavo dei dati, per il caricamento su Whisper. */
final class Aac {

    private static final int BITRATE = 32000;

    private Aac() { }

    /** Scrive {@code out}; se non riesce lancia IOException e il file di uscita non resta. */
    static void comprimi(File wav, File out) throws IOException {
        MediaCodec codec = null;
        MediaMuxer mux = null;
        boolean muxPartito = false;
        try (InputStream in = new BufferedInputStream(new FileInputStream(wav), 1 << 16)) {
            long salto = Wav.HEADER;
            while (salto > 0) {
                long k = in.skip(salto);
                if (k <= 0) throw new IOException("wav troppo corto");
                salto -= k;
            }
            MediaFormat f = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, Pcm.RATE, 1);
            f.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            f.setInteger(MediaFormat.KEY_BIT_RATE, BITRATE);
            f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384);
            codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
            codec.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            codec.start();
            mux = new MediaMuxer(out.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int track = -1;
            byte[] tmp = new byte[4096];
            long campioni = 0;
            boolean inDone = false, outDone = false;
            int idle = 0;
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            while (!outDone) {
                if (!inDone) {
                    int ii = codec.dequeueInputBuffer(10000);
                    if (ii >= 0) {
                        ByteBuffer b = codec.getInputBuffer(ii);
                        int want = b == null ? 0 : Math.min(b.capacity(), tmp.length);
                        int got = 0;
                        while (got < want) {
                            int r = in.read(tmp, got, want - got);
                            if (r < 0) break;
                            got += r;
                        }
                        got &= ~1;
                        if (got <= 0) {
                            codec.queueInputBuffer(ii, 0, 0, campioni * 1_000_000L / Pcm.RATE, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inDone = true;
                        } else {
                            b.clear();
                            b.put(tmp, 0, got);
                            codec.queueInputBuffer(ii, 0, got, campioni * 1_000_000L / Pcm.RATE, 0);
                            campioni += got / 2;
                        }
                    }
                }
                int oi = codec.dequeueOutputBuffer(info, 10000);
                if (oi >= 0) {
                    idle = 0;
                    ByteBuffer ob = codec.getOutputBuffer(oi);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) info.size = 0;
                    if (ob != null && info.size > 0 && muxPartito) {
                        ob.position(info.offset);
                        ob.limit(info.offset + info.size);
                        mux.writeSampleData(track, ob, info);
                    }
                    codec.releaseOutputBuffer(oi, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outDone = true;
                } else if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    track = mux.addTrack(codec.getOutputFormat());
                    mux.start();
                    muxPartito = true;
                } else if (oi == MediaCodec.INFO_TRY_AGAIN_LATER) {
                    if (++idle > 2000) throw new IOException("compressione bloccata");
                }
            }
            if (!muxPartito) throw new IOException("compressione senza uscita");
        } catch (RuntimeException e) {
            throw new IOException("compressione non riuscita: " + e);
        } finally {
            if (codec != null) {
                try { codec.stop(); } catch (RuntimeException ignored) { }
                try { codec.release(); } catch (RuntimeException ignored) { }
            }
            if (mux != null) {
                try { if (muxPartito) mux.stop(); } catch (RuntimeException ignored) { }
                try { mux.release(); } catch (RuntimeException ignored) { }
            }
        }
    }
}
