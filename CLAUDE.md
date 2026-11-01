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
- v4.1.0 verificata su iPhone (01/11): pulizia AI funzionante, nessun errore.
- **Da fare in auto** (auto disponibile dal 2/11/2026): suoni udibili con CarPlay; qualità della trascrizione
  con il rumore di marcia.

## Modifiche in attesa (NON applicare finché l'utente non dà il via: vanno fatte tutte insieme)
1. Mostrare il numero di versione anche nella schermata principale (in fondo alle note non si vede senza scorrere).
2. Ingrandire il pulsante "☰ Note" (si apre con pressione lunga, quindi non c'è rischio di tocchi accidentali).
3. Togliere dalle regole predefinite le parole chiave "ambito"/"tag": l'AI deduce l'argomento dal contenuto;
   l'utente può indicarlo in modo naturale, senza sintassi fissa.

## Secondo stadio (in progettazione, 01/11/2026)
Idea: l'app deposita le note in un luogo raggiungibile lato server; un agente Claude (a mano o con attività
pianificata) le interpreta come comandi in linguaggio naturale: task in Todoist, note nuove o modifiche in Joplin,
altro. Le note non interpretabili vanno in una coda di scarti per l'utente.

Regole Joplin (specifica dell'utente, vincolante):
- Joplin è sincronizzato con `/Notes` su Dropbox da uno script Google Apps Script (ogni 5 minuti).
  Mai toccare `/Applicazioni/Joplin` né generare metadati Joplin.
- NUOVA nota: solo in `/Notes/!VOCE-INBOX/<Titolo>.md` (niente `/ \ : * ? " < > |` nel nome).
  Riga 1 = titolo puro (uguale al nome file, senza `# `), riga 2 vuota, poi corpo Markdown.
  `!VOCE-INBOX` serve ESCLUSIVAMENTE a questo: mai usarla come coda delle note vocali grezze.
- MODIFICA di una nota esistente: trovare il `.md` in `/Notes/**` (indici per tag in `/Notes/_Tags/<tag>.txt`),
  scaricarlo, modificarlo e sovrascriverlo nello stesso percorso; riga 1 e nome file invariati.
- VIETATO in `/Notes`: spostare o rinominare file o cartelle (si fa solo da Joplin). Cancellare e ricreare
  una nota è ammesso solo per modificarne il contenuto, secondo la procedura sotto.
- Procedura modifica (verificata come sicura dall'utente): leggere tutta la nota, preparare il testo nuovo
  (stesso titolo, stesso nome file), poi cancellare il file vecchio e creare quello nuovo nello stesso percorso.
  Lo script allinea Joplin al giro successivo. Accorgimenti: il testo nuovo è pronto prima di cancellare;
  se la creazione fallisce, ricreare subito la nota con il testo letto all'inizio.
- Connettore Dropbox: crea file nuovi ma NON sovrascrive file esistenti, quindi la modifica avviene come
  cancellazione più creazione. Verificato il 01/11/2026 su una nota di prova: funziona in autonomia,
  senza richieste di conferma all'utente.
- Lo script di allineamento è responsabilità dell'utente: Claude non se ne occupa e non lo menziona.

Decisioni sul secondo stadio (01/11/2026):
- **Niente pianificazione**: l'elaborazione si lancia a mano (eventuali domande vanno fatte subito, a mente fresca).
- Cartella delle note dall'app: `/Applicazioni/VoceAgente/` (sottocartelle a scelta di Claude, es. `inbox/`, `elaborate/`, `scarti/`).
- L'app scrive su Dropbox via servizio online (una web app su iPhone non può accedere ai file dell'app Dropbox);
  offline le note restano in coda sul telefono e partono al ritorno della rete.

## Idea per una versione futura (non ora)
L'utente ha un Motorola Moto G35 5G (128 GB) senza SIM (solo Wi-Fi o hotspot dell'iPhone), oggi inutilizzato.
Potrebbe diventare un registratore dedicato in auto: stessa web app in Chrome senza modifiche; permesso microfono
ricordato; nessun conflitto con l'uso del telefono principale; blocco su una sola app integrato in Android.
Passo successivo possibile: piccola app Android installata direttamente (senza store) con un tasto fisico
(es. volume) per avvio/stop, cioè un vero tasto da sentire al tatto.
Nota: in chiamata il microfono del Moto G35 risulta ottimo (giudizio dell'utente).
Flusso desiderato dall'utente con l'app Android: in viaggio il Motorola resta senza rete e registra; alla sosta
l'utente attiva l'hotspot dell'iPhone per circa un minuto, l'app trascrive, ripulisce e consegna tutto a Dropbox
da sola, e **segnala chiaramente quando la sincronizzazione è completa** (suono distinto + schermata).
Poi il secondo stadio si lancia dall'iPhone. Su Claude non serve nulla sul Motorola.
Verificato 01/11/2026: nell'ambiente cloud di Claude gli strumenti Android (dl.google.com, maven.google.com,
services.gradle.org, Maven Central) sono bloccati dalla rete. Strada scelta per compilare: **GitHub Actions**
(gratuito su repo pubblico): Claude scrive il codice e lo pubblica, GitHub compila l'APK e lo mette nelle Release,
l'utente lo scarica sul Motorola. Per leggere l'esito della compilazione, il workflow deve riportare log/risultato
in un ramo git (le API Actions non sono raggiungibili dal proxy di Claude). Alternativa di riserva: scheda Code
dell'app desktop sul PC dell'utente. In ogni caso si usa solo l'abbonamento Pro, mai crediti API.

Decisione sul secondo stadio, dove stanno le regole (01/11/2026, informazione verificata dall'utente: non ricercarla):
- Il secondo stadio vive in un **progetto Claude**. Il protocollo e le regole stanno nella **knowledge del progetto**:
  una specie di file system di soli file di testo (si usano file `.md`), che **solo le chat create dentro il progetto**
  possono leggere e scrivere (l'utente li vede ma non li modifica; una chat esterna spostata nel progetto non può farlo).
- Perché una chat possa scrivere nella knowledge va creata con **Sonnet** e con il selettore su **"auto"**
  (con un modello inferiore il selettore resta forzato su "manuale"); dopo si può passare a Haiku.
- Dropbox serve solo per le note in arrivo (`/Applicazioni/VoceAgente/`) e per le note di Joplin (`/Notes`).
- Non fare ricerche web su come funzionano i prodotti dell'utente quando l'utente ha già dato l'informazione.
