# Note Auto — memoria di progetto

Leggere all'inizio di ogni sessione su questo repository. Aggiornare a ogni cambiamento rilevante.

## Obiettivo
Registratore vocale da usare **guidando**, senza guardare il telefono e senza distrazioni.
Le note dettate vengono trascritte bene e ripulite (correzione errori di riconoscimento, punteggiatura, esitazioni),
poi raccolte per un post-processing successivo (smistamento, raggruppamenti, codici: da definire più avanti).

## Vincoli dell'utente (decisi, non riproporre alternative scartate)
- iPhone 12 Pro Max (niente tasto Azione), iOS 26, Safari. Auto con **CarPlay**: il telefono è collegato via cavo
  e appoggiato sul sedile o nel portaoggetti, non su un supporto.
- In viaggio lo schermo resta **acceso e sbloccato** (alimentato; blocco automatico su "Mai").
- **Niente comandi vocali** (Siri scomodo). **Niente stop automatico sul silenzio**: le pause per pensare
  devono essere libere, lo stop dev'essere **esplicito**.
- Scartati dopo prove: Comandi Rapidi (troppo lavoro manuale, non debuggabili), tocco sul retro per lo stop
  (accoda un altro comando), Accesso guidato (manualità inaccettabile), app nativa (sproporzionata).
- Soluzione scelta: **web app** su GitHub Pages, icona nel **Dock**, tutto lo schermo è il pulsante.
- Permesso microfono: iOS lo richiede a ogni avvio "a freddo"; se l'app resta in secondo piano non lo richiede.
  L'utente lo considera un compromesso accettabile.
- La funzione AMBITO/TAG a voce della vecchia app **non è una priorità** ora.

## Come lavorare con l'utente (Stefano)
- **Un passo alla volta.** Non anticipare i passi successivi né elencare alternative non richieste,
  salvo quando l'utente chiede esplicitamente l'elenco completo.
- Nomi di menu iOS: solo quelli in **italiano** e verificati; se incerti, dirlo e dare parole da cercare.
- Interessa il **cosa**, non il come. Risposte sintetiche in sessione interattiva.
- **Autonomia**: Claude pubblica da solo su GitHub (app GitHub di Claude installata). Non chiedere all'utente di caricare file.

## Architettura (v4)
- `index.html` (interfaccia), `app.js` (logica), `sw.js` (offline), `manifest.json`, `icons/`.
- Tocco breve ovunque = avvia / ferma e salva. Pressione lunga su "☰ Note" (solo da fermo) = note e impostazioni;
  un tocco breve su "☰ Note" non registra.
- Audio salvato sempre in IndexedDB, a pezzi ogni 2 s (recupero dopo chiusura improvvisa).
- Coda: trascrizione Groq Whisper (`whisper-large-v3`, it) + pulizia LLM Groq con modelli di riserva
  (`openai/gpt-oss-120b`, `llama-3.3-70b-versatile`, …). Groq accetta chiamate dirette dal browser (CORS `*`).
- Chiave Groq solo nel telefono (localStorage), mai nel repository (che è pubblico).
- Suoni: bip acuto = avvio; due note che salgono = salvata; che scendono = troppo breve; due bip gravi = errore.
  I suoni non vengono mai accodati (si suonano solo se l'audio è attivo).
- Esportazione: file di testo raggruppato per ambito tramite il pannello Condividi di iOS.
- Ogni rilascio: aggiornare `VERSION` in `app.js` e `CACHE` in `sw.js`.

## Stato delle prove
- 01/11/2026, v4.0.0 su iPhone: registrazione, salvataggio, ritorno dal secondo piano, interruzioni, offline,
  esportazione: **OK, nessuna nota persa**.
  Problemi trovati: pulizia AI sempre fallita; bip a raffica cambiando app e nessun bip di avvio offline;
  "Grazie." inventato da Whisper su una nota quasi vuota; registrazioni partite per pressioni troppo brevi su ☰.
- v4.1.0: corretti i quattro problemi (modelli di riserva e dettaglio dell'errore visibile; suoni non accodati;
  filtro delle frasi inventate; tocco breve su ☰ non registra). **Da verificare su iPhone.**
- **Da fare in auto** (auto disponibile dal 2/11/2026): suoni udibili con CarPlay; qualità della trascrizione
  con il rumore di marcia.
