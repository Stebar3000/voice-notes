package it.stebar.noteauto;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;

/**
 * File .wav PCM 16 bit mono 16 kHz con intestazione fissa di 44 byte. Mentre si registra l'intestazione viene
 * aggiornata ogni pochi secondi; chi legge un wav deve comunque ricavare la lunghezza dalla dimensione del file
 * (se l'app muore a metà l'intestazione può essere indietro o a zero).
 */
final class Wav {

    static final int HEADER = 44;

    private Wav() { }

    /** Byte di audio nel file, ricavati dalla dimensione (mai dall'intestazione). */
    static long dataLen(File f) {
        long l = f.length() - HEADER;
        if (l < 0) l = 0;
        return l & ~1L;
    }

    static int durataSec(File f) {
        return (int) (dataLen(f) / Pcm.BYTES_PER_SEC);
    }

    static boolean isWav(File f) {
        return f.getName().endsWith(".wav");
    }

    /** Scrive l'intestazione con la lunghezza data (in testa al file). */
    static void scriviIntestazione(RandomAccessFile f, long dataLen) throws IOException {
        long pos = f.getFilePointer();
        f.seek(0);
        byte[] h = new byte[HEADER];
        put(h, 0, "RIFF");
        le32(h, 4, 36 + dataLen);
        put(h, 8, "WAVE");
        put(h, 12, "fmt ");
        le32(h, 16, 16);
        le16(h, 20, 1);                 // PCM
        le16(h, 22, 1);                 // mono
        le32(h, 24, Pcm.RATE);
        le32(h, 28, Pcm.BYTES_PER_SEC);
        le16(h, 32, 2);                 // byte per frame
        le16(h, 34, 16);                // bit
        put(h, 36, "data");
        le32(h, 40, dataLen);
        f.write(h);
        f.seek(Math.max(pos, HEADER));
    }

    /** Rimette a posto l'intestazione di un wav rimasto a metà (lunghezza dalla dimensione del file). */
    static void ripara(File f) {
        if (!f.exists() || f.length() < HEADER) return;
        try (RandomAccessFile r = new RandomAccessFile(f, "rw")) {
            long len = dataLen(f);
            if (r.length() != HEADER + len) r.setLength(HEADER + len); // byte dispari in coda
            scriviIntestazione(r, len);
        } catch (IOException ignored) {
            // il file resta leggibile dalla dimensione
        }
    }

    /** Ripara l'intestazione solo se non corrisponde alla dimensione del file. */
    static void riparaSeServe(File f) {
        if (f.length() < HEADER) return;
        try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
            byte[] b = new byte[4];
            r.seek(40);
            r.readFully(b);
            long dichiarata = (b[0] & 0xffL) | ((b[1] & 0xffL) << 8) | ((b[2] & 0xffL) << 16) | ((b[3] & 0xffL) << 24);
            if (dichiarata == dataLen(f) && f.length() % 2 == HEADER % 2) return;
        } catch (IOException e) {
            return;
        }
        ripara(f);
    }

    private static void put(byte[] b, int at, String s) {
        for (int i = 0; i < s.length(); i++) b[at + i] = (byte) s.charAt(i);
    }

    private static void le32(byte[] b, int at, long v) {
        b[at] = (byte) (v & 0xff);
        b[at + 1] = (byte) ((v >> 8) & 0xff);
        b[at + 2] = (byte) ((v >> 16) & 0xff);
        b[at + 3] = (byte) ((v >> 24) & 0xff);
    }

    private static void le16(byte[] b, int at, int v) {
        b[at] = (byte) (v & 0xff);
        b[at + 1] = (byte) ((v >> 8) & 0xff);
    }
}
