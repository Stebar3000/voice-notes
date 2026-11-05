# Mirroring knowledge (estensione Chrome)

Mirroring a due vie tra la knowledge dei progetti claude.ai e `/Projects/LLM-Mirroring/<Progetto>/` su Dropbox. Solo file di testo.

- Ingresso: pulsante "Inserisci nel mirroring" (copia completa knowledge → cartella vuota, poi file guida).
- Si allineano solo i progetti con il file guida `_mirroring.json` (stato dell'ultimo allineamento: per ogni file nome nella
  knowledge e impronta Dropbox; `ultimo_giro` con le modifiche). Riscritto per ultimo e solo se qualcosa è cambiato.
- Nomi riservati nella cartella del progetto: `Originali/`, `_mirroring.json`, `_resoconto.txt`, `_istruzioni-progetto.md`
  (istruzioni a senso unico, dalla knowledge a Dropbox).
- Regole: cambiato da una parte → copiato dall'altra; sparito da una parte (prima c'era) → cancellato dall'altra; cambiato da
  entrambe → vince la knowledge. Protezioni: niente cancellazioni se un lato è vuoto o se sparirebbe più di metà dei file.
- Tempi: cursore Dropbox controllato ogni minuto (giro subito se cambia qualcosa); giro completo ogni 15 minuti.
- File non di testo (PDF, Word, Excel) nella cartella: non copiati; "in attesa di conversione" per un'ora, poi segnalati.

- Prova (v1.0.1): pulsante "Prova attivazione chat" nelle impostazioni: apre una chat indicata in una scheda in secondo piano,
  scrive il testo nel campo e preme "Invia messaggio" (attivazione di una chat via interfaccia, senza chiamate interne).

Prove: `node --test test/core.test.mjs` (pianificatore); prova completa in Chromium con claude.ai e Dropbox simulati (05/11/2026);
`node test/attiva-chat.e2e.mjs <cartella estensione>` (pulsante di prova della chat, claude.ai finto dietro un proxy locale; serve Playwright).
