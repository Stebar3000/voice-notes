# Backup knowledge (estensione Chrome)

Ogni giorno, da sola, copia istruzioni e documenti dei progetti claude.ai scelti su Dropbox:

- `/Projects/<nome progetto>/knowledge/…` — i documenti, con le cartelle vere e il testo esatto
- `/Projects/<nome progetto>/istruzioni-progetto.md` — le istruzioni del progetto
- `/Projects/<nome progetto>/ultimo-backup.txt` — data, conteggi, esito

Non cancella mai nulla su Dropbox. I documenti nati da Word o PDF caricati si salvano come `….docx.txt` (claude.ai conserva solo il testo).
Le immagini caricate non si copiano (claude.ai non fornisce gli originali): sono elencate in `ultimo-backup.txt`.

Funzionamento: un timer controlla ogni ora; se l'ultimo backup riuscito ha più di 24 ore lo rifà. Il controllo
riparte anche all'avvio di Chrome. Il lavoro gira in una scheda claude.ai (se non ce n'è una, ne apre una in
secondo piano e la richiude). Icona: ✓ verde = ultimo backup riuscito, ! rosso = problema (con avviso sul desktop).

Prove: `node --test test/` (funzioni pure). Prova completa con Chromium e servizi simulati fatta il 04/11/2026.
