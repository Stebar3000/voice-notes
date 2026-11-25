package it.stebar.noteauto;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Consegna delle direttive a Nero (protocollo: docs/nero-3-protocollo.md §2 e §3). Dalla 2.2.0 (C-05) la strada è una:
 * POST /lotto al centralino, con copia su Dropbox; è il centralino a mandare il lotto a casa (se viva) o al cloud.
 * Riserva: se il centralino non risponde, file in /Nero/lotti/in-arrivo/ su Dropbox. Una nota è consegnata solo
 * dopo una risposta positiva.
 */
final class Consegna {

    /** Cartelle di Nero: l'app Dropbox è "Full Dropbox", quindi i percorsi sono assoluti dalla radice. */
    static final String RADICE = "/Nero";

    private Consegna() { }

    static final class Esito {
        final String via, avviso;

        Esito(String via, String avviso) {
            this.via = via;
            this.avviso = avviso;
        }
    }

    /** Consegna il testo (forma del §2) e dice per quale strada è passato. Lancia l'ultimo errore se nessuna riesce. */
    static Esito invia(Prefs p, String testo) throws Http.ApiError {
        boolean dbx = p.dropboxConnected(), cloud = !p.centralinoKey().isEmpty();
        SimpleDateFormat f = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ITALY);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        Date now = new Date();
        String nome = f.format(now) + "-android";
        String mese = nome.substring(0, 4) + "-" + nome.substring(4, 6);
        String avviso = "";
        boolean casaPrima = false; // 2.2.0: prima il centralino; Dropbox solo se il centralino non risponde
        Http.ApiError last = null;
        for (int k = 0; k < 2; k++) {
            boolean casa = (k == 0) == casaPrima;
            if (casa ? !dbx : !cloud) continue;
            try {
                byte[] dati = Http.utf8(testo);
                if (casa) {
                    Dropbox.upload(p, RADICE + "/lotti/in-arrivo/" + nome + ".md", dati, false);
                } else {
                    Centralino.lotto(p, testo);
                    try { // la copia dell'app: se non riesce non è un errore di consegna
                        Dropbox.upload(p, RADICE + "/lotti/archivio/" + mese + "/" + nome + "-cloud.md", dati, false);
                    } catch (Http.ApiError e) {
                        RecService.log("Copia su Dropbox non riuscita (la consegna al centralino è andata): " + e.getMessage());
                    }
                }
                return new Esito(casa ? "Dropbox" : "centralino", avviso);
            } catch (Http.ApiError e) {
                last = e;
                RecService.log("Strada " + (casa ? "di casa (Dropbox)" : "del cloud (centralino)") + " non riuscita: " + e.getMessage());
                if (!casa && e.status == 401) avviso = "Chiave del centralino non valida";
            }
        }
        if (last == null) throw new Http.ApiError(-1, "nessuna strada di consegna configurata");
        if (!avviso.isEmpty()) throw new Http.ApiError(last.status, avviso + "; " + last.getMessage());
        throw last;
    }
}
