# Note Auto — memoria di progetto

Leggere all'inizio di ogni sessione su questo repository. Aggiornare a ogni cambiamento rilevante.

## REGOLA AUREA (04/11/2026, immutabile, prevale su tutto)
Si decide solo con **informazione completa**. Se manca qualcosa, di qualunque tipo, che potrebbe cambiare il risultato
(file non arrivati, dati assenti, un fatto non verificato), Claude **si ferma e lo segnala subito**, prima di qualunque
analisi o conclusione; si risolve il problema, poi si va avanti. Mai lavorare o concludere con informazione parziale.

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

Contesto di progetto (manuale dell'utente del 02/11/2026, fatti verificati: non ricercarli):
- Due aree: file caricati (solo l'utente, elenco piatto) e documenti di testo in cartelle (scritti dalle chat).
- Tecnicamente **ogni chat nata nel progetto** può creare, copiare, spostare, rinominare e cancellare documenti.
  Per **scelta operativa** dell'utente solo la chat tecnica lo fa; le chat business salvano solo documenti nuovi.
- La chat tecnica **non rilegge** i file scritti (rilettura = spreco): verifica che la scrittura sia andata a buon fine
  (dimensione del contesto, posizione nell'elenco), come da manuale.
- Scrivere su un percorso esistente sostituisce senza avviso. Un documento max 1 MB; tetto 2.000.000 token.
  Lettura ≈ 1 token ogni 3 byte di italiano: tenere i documenti di regole brevi.
- Una chat non riparte da sola; nessuna attività programmata senza ordine.
- Istruzioni di progetto a ruoli: prima riga del primo messaggio "Ruolo: tecnico" o "Ruolo: business".
  Il ruolo tecnico legge `claude/tecnico-avvio.md`.
- Conseguenza per le regole del secondo stadio: protocollo base in un documento; ogni modifica di regola
  decisa in una chat business diventa un **documento nuovo e datato** in una cartella di regole aggiuntive;
  la chat tecnica, su ordine, le consolida nel protocollo.

Flusso di ingresso delle note (deciso 02/11/2026):
- L'app consegna un **solo file per sessione di dettatura**: aspetta alcuni minuti (es. 10) senza nuove registrazioni,
  poi carica in `/Applicazioni/VoceAgente/inbox/AAAA-MM-GG-HHMM.md` tutte le note di quella sessione.
- La chat business, su "elabora": elenca `inbox`, **legge ogni file una sola volta**, lo elabora con quanto ha in memoria,
  poi lo **sposta** in `elaborate/` (operazione interna di Dropbox, il contenuto non passa dalla chat).
- `elaborate/` è solo archivio/backup: **nessuna chat ci torna mai**. Il testo delle note NON si copia nella knowledge.
- Nella knowledge va solo un **registro sintetico** (una riga per nota: data, titolo, azione, destinazione).
- Dropbox costa moltissimo (tempo e token): usarlo solo per l'ingresso delle note e per scrivere in Joplin.

Indice delle note di lavoro (deciso 02/11/2026):
- Solo le note "di lavoro" (identificate dall'utente), ognuna con un abstract iniziale.
- Lo **script** crea e aggiorna `/Notes/<indice>.md` (titolo, abstract ~200 caratteri, percorso completo). Gratis.
- Il nome del file indice contiene il timestamp dell'ultimo aggiornamento.
- Una **chat tecnica dedicata (Haiku)** porta l'indice nella knowledge: guarda il nome del file su Dropbox, se il
  timestamp è più recente dell'ultima copia lo copia, poi toglie la copia precedente. Mai a mano dall'utente.
  **Verificato 02/11/2026**: una chat tecnica pianificata funziona e può girare ogni ora. Copia a costo quasi zero,
  indipendente dalla dimensione: `download_link` (URL temporaneo, monouso, max 15 min, fino a 25 per chiamata)
  → `curl` sul disco della chat → `project_write` con `local_path`. Il contenuto non entra mai nel contesto.
  Verifica senza rilettura: dimensione su disco (`wc -c`) e aumento della dimensione del contesto, come da manuale.
  `*.dropboxusercontent.com` è consentito in modo permanente nelle impostazioni dell'account (fatto dall'utente il 02/11/2026).
- La **chat business NON legge mai l'indice da Dropbox**: per trovare una nota fa una **ricerca semantica nella
  knowledge**. Principio: la chat business va protetta e tenuta in vita il più a lungo possibile; la sua area di
  lavoro è il progetto, mai Dropbox.
- Con la copia da disco il costo non dipende dalla dimensione: niente patch, copia integrale a ogni cambiamento.

## Aggiornamento 02/11/2026 sera (prevale sulle sezioni precedenti in caso di contrasto)
- Progetto Claude da usare: quello ex "Evernote", rinominato **"Audio Notes"**. Ha già chat tecniche, attività
  orarie di copia e file di servizio (`claude/tecnico-avvio.md`, `claude/sync-dropbox.md`, `claude/sync-stato.md`).
  Istruzioni di progetto: parte tecnica valida; **parte business da riscrivere una sola volta, più avanti**.
- Sincronizzazione Dropbox → progetto (`claude/sync-dropbox.md`): niente timestamp nei nomi dei file; si confrontano
  `rev` e `content_hash` di Dropbox; il contenuto non passa mai nel contesto; verifica con dimensione e impronta.
  Le chat lavorano sempre una alla volta, mai due insieme.
- **Nuovo flusso di ingresso**: la chat tecnica oraria prende i file della sessione di dettatura da
  `/Applicazioni/VoceAgente/inbox/`, li copia nella knowledge e li sposta su Dropbox in `acquisite/`.
  La chat business lavora solo sulla knowledge: se trova note nuove le elabora, altrimenti non fa nulla.
  (Superato: "la chat business legge l'inbox su Dropbox".)
- **Una chat può risvegliarsi da sola con `send_later`** (verificato 02/11/2026): equivale a un messaggio scritto a mano.
  La chat business resta così la stessa finché non si esaurisce. Una chat non può avviarne un'altra esistente.
- Orari possibili (da definire): tecnica oraria in fasce definite, business poco dopo, sfalsate (mai insieme).
- Da definire: procedura tecnica per una cartella di file variabili (l'inbox), diversa dall'elenco fisso di
  `sync-stato.md`; come la chat business riconosce le note già elaborate (es. confronto con il registro).
- Chat tecnica oraria: **Haiku, ragionamento basso**; tutte le istruzioni nel prompt dell'attività (riscritto a ogni
  esecuzione, quindi sempre aggiornato).
- Uscite della chat business (Todoist, note Joplin su Dropbox): per ora **dirette via connettore**. Valutato il
  passaggio tramite la chat tecnica: il contenuto va scritto comunque dalla business (nella knowledge o su Dropbox,
  stesso costo), il connettore Dropbox non sa caricare file dal disco, e si aggiungerebbe fino a un'ora di ritardo.

## Nomi e documenti finali (02/11/2026, prevalgono su quanto sopra)
- Indice: `/Notes/_Indice.md` (lo crea lo script) → copia in `business/indice-note.md` (riga in `claude/sync-stato.md`).
- Dropbox: `/Applicazioni/VoceAgente/inbox/AAAA-MM-GG-HHMM.md` (scrive l'app) → `acquisite/` (dopo la copia).
- Knowledge: `business/protocollo.md`, `business/regole/AAAA-MM-GG-argomento.md`, `business/note/AAAA-MM-GG-HHMM.md`,
  `business/registro/AAAA-MM-GG-HHMM.md`. Una sessione è da elaborare se manca il registro con lo stesso nome.
- Ogni nota Joplin: riga 1 titolo, riga 2 vuota, riga 3 abstract (~200 caratteri), poi corpo.
- Risvegli business con `send_later` al minuto 20 (tecnica al minuto 0), solo se l'utente li attiva.
- Testi consegnati all'utente: `protocollo.md` e `avvio-progetto-audio-notes.md` (istruzioni di progetto,
  primo messaggio business, prompt orario tecnico, riga sync-stato, tabella nomi).
- Prossima fase dell'utente: riordino note (abstract) e task; poi prove reali.
- Lato app ancora da fare: consegna su Dropbox in `inbox/` a fine sessione di dettatura (+ modifiche in attesa).

## Passaggio di consegne
- `docs/prompt-clone.md`: prompt per la sessione che sostituirà quella corrente. **Non va mai modificato.**
- `docs/protocollo-business.md`, `docs/avvio-progetto-audio-notes.md`: copie dei testi consegnati all'utente.
  Se un testo cambia, aggiornare anche la copia in `docs/`.

## App Android (iniziata 02/11/2026)
- Codice in `android/` (Java, nessuna dipendenza esterna, firma fissa `android/app/debug.keystore`).
- Compilazione: `.github/workflows/android.yml` su ogni push in `android/**`. APK pubblicato nella Release
  `android-prova`: https://github.com/Stebar3000/voice-notes/releases/download/android-prova/note-auto-prova.apk
  Esito e log nel ramo `build-status` (`git fetch origin build-status; git show FETCH_HEAD:status.txt`).
- v0.1-prova compilata al primo colpo (02/11/2026, 43 s). Verifica da fare sul Motorola: installazione,
  tasto volume con app aperta, tasto volume a schermo spento (sessione multimediale), registrazione a schermo spento.
- Prova 02/11/2026 sera sul Motorola (v0.1-prova): installata (difficoltà: va toccato il nome del file nei
  download di Chrome e abilitate le installazioni da fonte esterna). Tasto volume con app aperta: OK.
  Con l'app chiusa dalle app recenti: il tasto volume arriva al servizio tramite la sessione multimediale (bip OK)
  ma l'interfaccia non si apre e le registrazioni risultano **vuote** (probabile silenziamento del microfono da parte
  di Android quando l'app non è visibile). Un "stop failed" su una registrazione di 0 s (innocuo: scartare < 1 s).
  **Schermo spento con app NON chiusa: FUNZIONA** (02/11 23:34): tasto volume, bip, voce registrata e riascoltata.
- **Offline (rete disattivata): registrazione OK** (02/11 23:39). Bip ben udibili (anche troppo: volume ridotto).
  Qualità voce ottima. L'utente considera il registratore Android **riuscito**: niente altri giri di prova sul solo
  registratore. Chiudere l'app per errore è di fatto impossibile; se succede la si riapre dalla Home.
- Correzioni minori da includere nell'app completa (senza un giro di prove a parte): scartare registrazioni < 1 s;
  rilevare il microfono silenziato da Android (errore sonoro, niente nota vuota); eventuale riapertura automatica.
- Prossimo passo: app Android completa (trascrizione Groq, pulizia, consegna su Dropbox `inbox/` a fine sessione,
  segnale di "tutto consegnato").

## App Android v1.0 (scritta e compilata 02/11/2026 notte; DA PROVARE sul Motorola)
- Registrazione offline confermata dall'utente (02/11 23:39). Registratore considerato riuscito.
- Codice completo in `android/` (Java, nessuna dipendenza): `RecService` (registra, tasto volume, rete, consegna dopo pausa),
  `Sync` (trascrive, ripulisce, consegna), `Groq`, `Dropbox` (OAuth PKCE, solo scrittura), `Note` (scheda .json accanto a ogni .m4a),
  `Tones` (suoni composti), `MainActivity`, `SettingsActivity`. APK nella Release `android-prova` (stesso indirizzo di prima, si installa sopra).
- Flusso: nota registrata -> scheda `new`; con rete valida (hotspot/Wi-Fi) parte la sincronizzazione da sola (e dopo `sessionMin` minuti,
  default 10, dall'ultima nota; "Consegna ora" è immediato). Stati: new -> ready -> delivered; empty (nessun parlato); error; old (prove vecchie, ignorate).
- Consegna: un file per sessione (note con pause < `sessionMin`) in `<cartella base>/inbox/AAAA-MM-GG-HHMM.md`, cartella base predefinita
  `/Applicazioni/VoceAgente`. Formato: riga "Sessione di dettatura del GG/MM/AAAA HH:MM — N note", poi per ogni nota `## Nota k — HH:MM — titolo` e testo.
  Niente ambito/tag: solo titolo breve. Se la pulizia fallisce c'è l'avviso "trascrizione grezza".
- Segnale "tutto consegnato": quattro note che salgono (lunghe) + schermata verde. Errore: due bip gravi + schermata arancione.
  Giri automatici senza rete o con errori passeggeri sono silenziosi (nessun allarme), si riprova alla rete / ogni 5 min (max 6).
- Dropbox: app di tipo "Full Dropbox", solo permesso `files.content.write`; autorizzazione una volta (App key + codice incollato).
  Il refresh token e la chiave Groq stanno solo nel telefono (SharedPreferences privato).
- Correzioni incluse: scartate registrazioni < 1 s (tono "troppo breve"); microfono muto rilevato (avviso dopo 3 s, registrazione scartata);
  bip di avvio/stop al 70% (volume del telefono resta il controllo principale). Riapertura automatica NON fatta (chiudere l'app è impossibile).
- Da verificare sul Motorola: installazione sopra la prova, Impostazioni (chiave Groq, collegamento Dropbox, "Prova Dropbox"),
  giro completo con Wi-Fi, giro offline poi hotspot, il percorso reale `/Applicazioni/VoceAgente/inbox/` creato da Dropbox.
- Non fatta la versione web con consegna su Dropbox né le "modifiche in attesa" della web app (aspettano il via dell'utente).

## Prima prova completa Android (03/11/2026, v1.0.1 sul Motorola) — FUNZIONA
- Configurazione fatta (chiave Groq creata dal laptop, app Dropbox "Full Dropbox" con `files.content.write`, autorizzazione con indirizzo
  copiato sul laptop e codice incollato sul Motorola). Verificato da Claude su Dropbox: `/Applicazioni/VoceAgente/prova-connessione.txt`
  e tre file in `inbox/` (2026-11-03-1430, -1440, -1447), formato e testi ripuliti corretti (titolo + testo, es. "Procedura sbrinamento frigorifero").
- Problemi incontrati: (1) l'aggiornamento sopra la v0.1-prova NON ha funzionato (restava la vecchia): è stato necessario disinstallare
  e reinstallare, perdendo le impostazioni (da rifare: chiave Groq + collegamento Dropbox). Evitare aggiornamenti non necessari e dire
  all'utente che potrebbero richiedere la disinstallazione. (2) Dopo la reinstallazione va riattivato "Consenti l'utilizzo in background"
  (Impostazioni > App > Note Auto > Batteria) per lo schermo spento. (3) Su Motorola accensione + volume giù (screenshot) avvia la registrazione:
  per lo screenshot usare tre dita sullo schermo (lo ha dettato lui stesso in una nota). (4) Whisper ha inventato "SIGLA" su una registrazione
  quasi vuota e la pulizia non è riuscita su quella sola parola: aggiunti "sigla", "iscriviti al canale", "alla prossima", "a presto" al filtro (v1.0.2,
  NON ancora installata: aggiornare solo quando servono altre modifiche). L'elenco note ora mostra l'errore di pulizia (⚠).
- Ancora da provare: giro offline poi hotspot; pausa di sessione (10 min) con più note; suoni in auto.

## Script Google Apps (Joplin.js) — proposte di nuove funzioni (03/11/2026, IN ATTESA di decisione dell'utente)
- L'utente ha chiesto una riflessione su funzioni da aggiungere allo script (gratuito, ogni 5 min di giorno). Il divieto
  "non occuparsi dello script" è superato per questa analisi su sua richiesta. Copia letta: `/Google Apps/OCR/Joplin.js` (Dropbox, 01/11).
- Limiti Apps Script (account gmail): 6 min per esecuzione, 90 min/giorno di trigger, 20.000 chiamate URL/giorno, 100 email/giorno.
  Stima uso attuale ~10 min/giorno: margine ampio.
- **Principio dell'utente (vincolante)**: nessun lavoro di qualità a un modello più debole (Groq): riassunti/abstract,
  rielaborazione o strutturazione delle note e interpretazione delle note le fa solo Claude, con modello capace e impegno alto.
  Allo script solo lavoro meccanico. Scartate quindi: abstract con Groq, corsia veloce con Groq.
- Proposta 2 (scrittura sicura) SCARTATA 03/11: valore nullo. Nuove note: lo script fa già tutto. Modifiche: cancella+ricrea è già sicuro
  perché lo script ignora le cancellazioni in /Notes (Joplin non perde la nota) e la notte rigenera le note mancanti.
- L'utente gestisce lo script altrove; con Claude si definiscono solo le specifiche, UNA funzione alla volta.
  Sentinella a controlli multipli SCARTATA (troppo complessa, rischio di mail a raffica). Regola dell'utente: o è semplice o non si fa.
  Analisi dei rischi (03/11): perdite vere solo se (a) la chat tecnica sposta in `acquisite/` senza aver copiato, (b) la business
  segna una sessione come fatta saltando qualcosa, (c) l'app viene uccisa durante una registrazione. Il resto sono ritardi.
  Proposta in discussione: un solo controllo di fine catena: la chat tecnica sposta in `elaborate/` le sessioni di `acquisite/`
  che hanno il registro; lo script una volta al giorno manda UNA mail se in `inbox/` o `acquisite/` c'è un file più vecchio di 12 ore.
- L'indice `_Indice.md` è sospeso in attesa di decidere il modo migliore.
- Rischio trovato: `nightlyConsolidation` cancella ogni file in /Notes che non conosce (salvo stato, _Tags, !VOCE-INBOX, tree.txt):
  verificare che `_Indice.md` sia escluso se aggiunto dopo il 01/11; i file delle nuove funzioni vanno fuori da /Notes.

## Registro e stati delle sessioni (03/11/2026 sera)
- Precisazione dell'utente sul principio Dropbox: vietato usare Dropbox come AREA DI LAVORO (ricerche, sfogliare, indice consultato lì);
  letture e scritture secche, una tantum, sono ammesse anche alla chat business.
- Il registro solo nella knowledge è un limite: nessun agente esterno (script o altro) può leggere la knowledge. Le informazioni
  di workflow devono stare anche su Dropbox.
- Registro "nota per nota": ogni riga inizia con `Nota k · tipo · titolo · azione · dove`; ogni "## Nota k" della sessione deve comparire.
- Schema CONFERMATO 03/11: la business scrive il registro in due posti (knowledge `business/registro/` e Dropbox
  `/Applicazioni/VoceAgente/registro/AAAA-MM-GG-HHMM.md`); lo script sposta da `acquisite/` a `elaborate/` le sessioni che hanno il registro
  e una volta al giorno manda UNA mail se ci sono file in `inbox/`/`acquisite/` da oltre 12 ore o registri incompleti.
  Fatto: `docs/protocollo-business.md` punto 6 (versione 2026-11-03) e tabella nomi in `docs/avvio-progetto-audio-notes.md`.
  La chat tecnica non cambia (sposta solo in `acquisite/`); lo spostamento in `elaborate/` e la mail giornaliera sono dello script.
- Idea dell'utente: verifica con Groq del numero/tipo di richieste per nota, solo come controllo. Valutazione Claude: rischio di
  falsi allarmi (contare le richieste è soggettivo); proposto di rimandare e, se serve, provarla a ritroso sull'archivio
  (`elaborate/` + `registro/` su Dropbox) per misurare quanti scarti veri trova, prima di accenderla.

## Ordine delle cartelle e backup della knowledge (04/11/2026)
- Regola dell'utente: niente cartelle nuove nella radice di Dropbox; un'unica radice di progetti, **`/Projects/`**,
  con sottocartelle chiamate per **obiettivo**, mai per strumento (niente "Claude", "Gemini", "Agente", "Lavoro").
  Questo progetto: **`/Projects/Audio Notes/`** (stesso nome del progetto Claude). Dati che l'utente passa a Claude: lì dentro.
- `/Applicazioni/VoceAgente/` resta per ora (per non toccare l'app Android); lo spostamento si farà più avanti.
- Nuova linea di sviluppo in analisi: **estensione Chrome** per il backup automatico della knowledge dei progetti Claude
  su Dropbox, byte per byte, senza chat e senza token. Modello di partenza: estensione "Depot: Context Manager for Claude
  Projects" v1.5.0, sorgente in chiaro in `/Projects/Audio Notes/Depot/`.
- Analisi Depot (04/11, file completi): lavora dallo script dentro la scheda claude.ai con la sessione dell'utente; endpoint interni
  `/api/organizations`, `/api/organizations/{org}/projects`, `…/projects/{pid}` (istruzioni = `prompt_template`), `…/docs`, `…/files`;
  scritture: POST `…/docs`, DELETE `…/docs/{id}`, PUT `…/projects/{pid}`. Verificato sul backup reale dell'utente (tutti i progetti, 22 s):
  `/docs` include i documenti nelle cartelle (il percorso sta nel nome), testo esatto; Depot sostituisce "/" con "_" (struttura persa).
  File caricati: solo anteprima webp, non l'originale. Fattibile un'estensione nostra: backup automatico su Dropbox con cartelle vere.
- **Estensione `backup-knowledge/` v0.1.0 scritta e provata (04/11/2026)**, DA INSTALLARE sul PC dell'utente. Solo file di testo
  (icona disegnata nel codice). ID fisso `jadbhjncdakibmflmidckmiiagkopipo` (chiave pubblica nel manifest). Timer orario + controllo
  all'avvio; backup se l'ultimo riuscito ha più di 24 h; scheda claude.ai esistente o aperta in secondo piano; Dropbox con PKCE a
  codice incollato (stessa App key dell'app Android); scrive solo, mai cancella; cache delle impronte (riscrive solo i cambiati,
  tutto una volta a settimana); allarme se i documenti risultano 0 dopo essere stati >0. Prove: test Node + Chromium con claude.ai e
  Dropbox simulati (backup, invariati, lista vuota, sessione scaduta, scatto del timer, riuso della scheda): tutto OK.
  Copia installabile su Dropbox: `/Projects/Audio Notes/backup-knowledge/` (da caricare in Chrome come "non pacchettizzata").
  Non provato dal vivo: claude.ai reale e autorizzazione Dropbox reale.
- 04/11 sera: prima prova reale dell'estensione RIUSCITA (3 progetti, struttura corretta in `/Projects/<nome>/knowledge/`).
  **v0.2.0 (04/11 notte, pubblicata su Dropbox, verificata per impronta; DA RICARICARE in Chrome e provare):**
  1. FATTA. Copia allineata: cancellare da Dropbox i file scritti dall'estensione che nel progetto non ci sono più (spostati o
     cancellati); mai se la lettura ha errori, se i documenti sono 0, o se si cancellerebbe più di metà dei file (allora
     avviso rosso). Il permesso `files.content.write` basta. Prova solo in simulazione: l'utente non vuole spostare file veri.
  Aggiornamento per l'utente: Claude sostituisce i .js in `/Projects/Audio Notes/backup-knowledge/`, lui preme "Ricarica"
  in chrome://extensions. Nient'altro.
- Decisione 04/11 sera (utente): l'estensione diventerà il motore di TUTTE le operazioni meccaniche (Dropbox ↔ knowledge,
  spostamenti, cancellazioni, scritture Joplin via "cassetta d'uscita" nella knowledge), a costo zero; le chat solo per il lavoro
  di qualità. Niente protocollo JSON di comandi: i compiti si scrivono come moduli JavaScript (Claude li aggiunge, l'utente
  ricarica). La progettazione si fa da fuori, non dentro il progetto Claude. Per ora solo Audio Notes.
  Fatti dall'utente: la scrittura nella knowledge con Depot ("aggiungi da altro progetto") funziona; nell'interfaccia serve
  ricaricare la pagina per vedere i file nuovi; la chat tecnica ha un comando "tree /f" per verificare la struttura.
  Prossimo: prova di scrittura e cancellazione dall'estensione nel progetto Audio Notes (`_prova/scrittura/test.md`).
  v0.2.0 contiene anche i pulsanti "Prova scrittura"/"Prova cancellazione" (solo `_prova/scrittura/test.md` in Audio Notes,
  con verifica per rilettura) e "Consenti la prossima pulizia grande" (sblocco una tantum). Prove simulate tutte OK.
- 04/11 23:06 PROVA REALE v0.2.0 RIUSCITA: l'estensione ha creato `_prova/scrittura/test.md` nel progetto Audio Notes (testo letto
  identico dall'utente) e l'ha cancellato. Scrittura e cancellazione nella knowledge dall'estensione: FUNZIONANO.
  Verificato anche: una chat GIÀ APERTA (chat tecnica, da iPhone) vede il documento creato dall'estensione, ma dopo qualche
  secondo (al primo tentativo immediato non lo trovava, al secondo sì). Conseguenza: la chat business può restare viva e trovare
  le note nuove; tra scrittura dell'estensione e lettura della chat serve un margine (i risvegli al minuto 20 lo danno).
- Idea utente 04/11 23:35: ingresso note con cursore Dropbox (list_folder + longpoll, come lo script Joplin) invece del timer orario.
  Valutazione Claude: fattibile; vincolo MV3 (il service worker viene chiuso se una risposta fetch tarda > 30 s, il longpoll dura 30-480 s):
  longpoll vero solo con documento "offscreen"; alternativa KISS: stesso cursore controllato ogni minuto con chrome.alarms
  (list_folder/continue, chiamata leggerissima). Serve comunque il permesso Dropbox di lettura (files.metadata.read + content.read).
  La latenza finale la decide il risveglio della chat business, non la copia.
- 05/11 notte: v0.3.0 pubblicata (impronte verificate): pulsante "Prova messaggio" che manda un messaggio a una chat esistente
  con il vecchio indirizzo JSON `POST /api/organizations/{org}/chat_conversations/{uuid}/completion` (dopo GET della chat per
  `current_leaf_message_uuid`). Scoperta dell'utente con DevTools: l'interfaccia attuale usa anche `claudeai-rpc/anthropic.bard.api.
  v1alpha.ConversationService/*` in formato binario (application/proto); la chiamata d'invio vera non è stata individuata.
  Se il POST JSON non va, ripiego: l'estensione apre la chat in secondo piano, scrive "elabora" e invia.
  ESITO 05/11 00:20: lettura della chat OK (200, 183 messaggi); invio RIFIUTATO 409 `conversation_upgraded` ("Questa chat è disponibile
  nella nuova esperienza di Claude", campo `workspace_upgraded`). Il vecchio indirizzo JSON non vale per le chat della nuova esperienza
  (tutte quelle nuove, inclusa la futura business): strada POST CHIUSA. Resta il ripiego dell'interfaccia (scrivere e inviare).
  Nota: l'utente ha incollato in chat i cookie di sessione; avvisato, ha scelto consapevolmente di non chiudere la sessione.

## Metodo di consegna dei file sul PC (05/11/2026, regola dell'utente)
- Mai usare il connettore Dropbox per scrivere file che stanno nella copia locale di Dropbox sul PC: lento e costoso (rispedisce
  tutto il testo). Si lavora sulle cartelle locali via collegamento al PC (app desktop); Dropbox poi sincronizza da solo.
- Cartella locale concessa (05/11): `C:\Users\steba\Dropbox (Personale)\Projects\Audio Notes` (nel terminale del PC: `$HOME/mnt/Audio Notes`).
- Aggiornare l'estensione: commit e push su GitHub, poi sul PC `curl` dei file da raw.githubusercontent.com/Stebar3000/voice-notes/main/
  backup-knowledge/<file> dentro `$HOME/mnt/Audio Notes/backup-knowledge/`, e verifica con sha256sum contro la copia di lavoro.
  Verificato 05/11: il terminale del PC raggiunge GitHub; copia v0.3.0 sul PC identica (sha256) al repository.
- **Regola 05/11 (sostituisce quella sul dispositivo): codice e modifiche SOLO su ordine esplicito dell'utente** ("fallo", "procedi").
  Fino ad allora si progetta e basta. Claude non sa da quale dispositivo scrive l'utente; decide lui quando è il momento. Mai fretta.

## Mirroring a due vie knowledge ↔ Dropbox (progettazione 05/11/2026, NON ancora da scrivere)
- Prassi dell'utente: tutti i documenti dei progetti in Markdown (Word solo come editor). Mirroring a due vie tra
  `/Projects/<nome>/knowledge/` e la knowledge del progetto; il backup attuale diventa il lato Dropbox del mirroring.
- Regole: solo file di testo (.md, .txt; il resto ignorato ed elencato); modifica nella knowledge = crea il nuovo poi cancella il vecchio;
  conflitto (cambiato da entrambe le parti, ritenuto impossibile) → vince la knowledge (Dropbox conserva la versione precedente);
  protezioni sulle cancellazioni come ora. Dropbox → knowledge con cursore (quasi tempo reale); knowledge → Dropbox ogni 15-30 min.
- Istruzioni di progetto: SOLO a senso unico (knowledge → Dropbox). Si modificano a mano dall'interfaccia. Fatto verificato dall'utente:
  le chat già aperte NON rileggono le istruzioni cambiate; valgono solo per le chat nuove.
- "File guida" (idea dell'utente): lo stato dell'ultimo allineamento sta in un file SOLO su Dropbox, in `/Projects/<nome>/`,
  fuori da `knowledge/` (non va nella knowledge). L'estensione lo legge all'inizio, confronta i due lati, applica, e lo riscrive
  per ultimo. Lo script Google si aggancia alla modifica di quel solo file per sapere cosa è cambiato, senza guardare tutti i file.
  Da definire il protocollo minimo (formato, sezione "ultime modifiche").
- **REGOLA ESPLICITA (05/11, utente): nei progetti si caricano SOLO file di testo** (.md di norma; .txt, .csv ammessi).
  Niente PDF, Word, Excel o immagini nella knowledge né nell'area dei file caricati. La conversione si fa FUORI dal progetto:
  PDF → testo con l'OCR dello script Google Apps (stesse chiamate di Lens, già collaudato, migliore di Tesseract);
  Word → Markdown; Excel → CSV. Motivi: le cartelle della knowledge accettano solo testo; il testo è ciò che viene tokenizzato,
  interrogato e letto dalle chat; fuori costa zero ed è più affidabile. Il mirroring tratta solo testo: un file non di testo nella
  cartella Dropbox del progetto è un ERRORE da segnalare nel resoconto (non si ignora in silenzio).
  Precisazione 05/11: con il mirroring i file binari nella knowledge sono IMPOSSIBILI per costruzione (l'estensione scrive solo
  documenti di testo; l'unica via per un binario è il caricamento a mano dall'interfaccia, che l'utente non farà). Osservazione
  dell'utente: un PDF caricato pesa in token più del suo testo (circa 2 caratteri per token invece di ~3 per l'italiano): overhead inutile.
  Un file non di testo nella cartella Dropbox resta solo su Dropbox: il resoconto lo elenca come "non copiato".
- Idea utente 05/11 (da progettare): lo script Google, che già fa OCR dei PDF da una cartella-inbox con convenzione di nomi,
  può convertire anche i file non di testo trovati nella cartella Dropbox di un progetto (PDF con OCR; Word e Excel da verificare,
  l'utente non l'ha mai provato) e scrivere accanto il testo con lo stesso nome ed estensione diversa. Il mirroring tratta solo il testo
  e ignora il resto. Punti aperti segnalati da Claude: dove va l'originale (proposta: fuori da `knowledge/`), collisioni di nome
  (es. `x.pdf` e `x.docx` → stesso `x.md`), cosa succede se si modifica il testo derivato e poi cambia l'originale, formato Markdown
  dall'export Google (da verificare).
  DECISO 05/11: il testo estratto si chiama con la doppia estensione `nome.pdf.md`, `nome.docx.md`, `nome.xlsx.csv`: niente collisioni
  e la fonte è dichiarata nel nome. Conversione SOLO in ingresso (input only): mai rigenerare automaticamente PDF/Word da un .md modificato.
  Produrre documenti binari da testo (es. Word da un .md) è un'attività separata, a richiesta, indipendente dalla fonte e dal mirroring.
  Ancora aperti: dove va l'originale; cosa fare se l'originale viene sostituito dopo che il testo derivato è stato modificato.
- DECISO 05/11 (utente): unico albero per tutti i progetti mirrorati: `/Projects/LLM-Mirroring/<NomeProgetto>/…` (radice osservata dal
  cursore Dropbox dello script, ricorsivo). Lo script Google (sviluppato ALTROVE dall'utente, non in questa conversazione) converte
  PDF/Word/Excel trovati in un progetto: testo accanto con doppia estensione (`contratto.pdf.md`, `budget.xlsx.md`: anche Excel → .md),
  originale spostato in `<NomeProgetto>/Originali/` (ignorata dal convertitore e dal mirroring). Due funzioni nello script: quella
  chiamata da Dropbox risponde subito, un'altra fa il lavoro pochi secondi dopo. Conversione tramite Google Docs/Sheets (Word→MD già
  verificato perfetto dall'utente; Excel da verificare, intestazione per foglio). Il mirroring vede solo testo.
  Proposte di Claude (da confermare): Originali/ conserva i sottopercorsi; Excel in .md con `## Foglio: nome` + blocco ```csv per foglio;
  file guida con nome riservato nella cartella del progetto, escluso dal mirroring, con l'uuid del progetto Claude (regge i cambi di nome);
  l'estensione ignora i binari "in attesa di conversione" e li segnala solo se restano lì a lungo. Le cartelle `/Projects/<nome>/knowledge/`
  del backup attuale andranno migrate nel nuovo albero.
- DECISO 05/11 (utente): ingresso nel mirroring con un PULSANTE per progetto ("Inserisci nel mirroring"): copia completa
  knowledge → `/Projects/LLM-Mirroring/<NomeProgetto>/` (crea cartelle), poi scrive il file guida. Da lì il progetto è allineato per
  definizione e il mirroring a due vie parte. Proposta Claude: si allineano SOLO i progetti con file guida; il pulsante funziona solo se
  la cartella non esiste o è vuota (altrimenti avvisa); niente regola di "unione" al primo giro. Le vecchie cartelle `/Projects/<nome>/
  knowledge/` non servono più (l'utente può cancellarle a mano).
  Permessi Dropbox: l'utente ha aggiunto i permessi di lettura (05/11) e ricaricato l'estensione; serve però RIFARE "Autorizza/Collega"
  perché il vecchio token ha solo i permessi di prima (da verificare alla prima prova).
- **Estensione v1.0.0 "Mirroring knowledge" (05/11/2026, scritta su ordine dell'utente, commit 62c1e67), copiata sul PC con impronte
  verificate.** Sostituisce il backup: albero `/Projects/LLM-Mirroring/<Progetto>/`, pulsante "Inserisci nel mirroring" (cartella deve
  essere assente o vuota), file guida `_mirroring.json` {versione, progetto{uuid,orgId,nome}, file{rel:{nome,h}}, istruzioni_h,
  aggiornato, ultimo_giro{quando, modifiche[{file,tipo,verso,conflitto?}]}} (h = content_hash Dropbox, calcolato anche sul testo
  della knowledge), `_resoconto.txt` e guida riscritti solo se cambia qualcosa, cursore Dropbox ogni minuto (non consumato se un giro
  è appena finito), giro completo ogni 15 min, istruzioni a senso unico, protezioni (lato vuoto, più di metà), binari "in attesa" 1 ora.
  Prove simulate tutte OK (ingresso, rifiuto secondo ingresso, invariato, modifica K, modifica D, nuovo D in sottocartella, spostamento D,
  cancellazione K, PDF in attesa, Originali ignorata, conflitto, nomi ripuliti senza doppioni, cursore, permessi Dropbox mancanti).
  DA FARE dall'utente: Ricarica, "Ricollega Dropbox" (Autorizza+Collega), "Inserisci nel mirroring" su Audio Notes. Prova reale: DA FARE.
