# Note Auto

Registratore vocale per la guida, pensato per non dover guardare il telefono.

**App:** https://stebar3000.github.io/voice-notes/

## Come si usa

- **Tocco ovunque sullo schermo** → bip acuto → registra. Puoi fare tutte le pause che vuoi.
- **Nuovo tocco ovunque** → due note che salgono → nota salvata.
- **Due note che scendono:** registrazione troppo breve (meno di 1 secondo), non salvata.
- **Due bip gravi:** problema col microfono.
- **Tieni premuto "☰ Note"** (in alto a destra, solo da fermo) per vedere le note e le impostazioni.

## Cosa fa con le note

1. L'audio viene **sempre salvato sul telefono**, anche senza rete, e scritto a pezzi ogni 2 secondi: una chiusura improvvisa non fa perdere la registrazione.
2. Quando c'è connessione, l'audio viene **trascritto** con Whisper (Groq, gratuito).
3. Il testo viene **ripulito** da un modello AI (Groq, gratuito): errori di trascrizione, punteggiatura, esitazioni, titolo e ambito.
4. Le note si **condividono** in un unico file di testo raggruppato per ambito (Dropbox, File, Note, Mail…).

Le **regole personali** di pulizia e smistamento si modificano nelle Impostazioni, senza toccare il codice.

## Configurazione

Serve una chiave API gratuita di Groq (console.groq.com), da inserire in Impostazioni.
La chiave resta solo nel telefono: non è nel codice né nel repository.

## Struttura

- `index.html`: interfaccia
- `app.js`: registrazione, archivio (IndexedDB), coda di trascrizione e pulizia, esportazione
- `sw.js`: funzionamento senza rete
- `mic-test/`: pagina di prova del permesso microfono

Le versioni precedenti (v1–v3) sono nella cronologia git.
