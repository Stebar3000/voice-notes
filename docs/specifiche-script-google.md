# Specifiche per lo script Google Apps — comandi, ingresso note, controllo giornaliero

Versione 2026-11-05. Documento autosufficiente: chi lo implementa non ha bisogno di altro contesto.
Lo script è di Stefano, fatto in casa, sviluppato in una cartella locale e pubblicato con `clasp push`.
Si può modificare liberamente, anche in ciò che fa oggi, se serve a rispettare queste specifiche.

### Stato dell'implementazione (aggiornamento 2026-11-10)
- **Implementato** nello script (progetto Apps Script UniversalDataRouter): §1 esclusioni (`04_Workflow_LLM_Mirror.gs`),
  §2 modulo Comandi e §3 controllo giornaliero (`06_Workflow_Comandi_e_Controllo.gs`). Il modulo Comandi gira a ogni giro
  del dispatcher e ogni ora; il controllo alle 08:00 di Lisbona. Trigger e autorizzazione mail: lanciare una volta a mano
  `InstallaTriggerComandiEControllo()`. Criteri C1–C8, C10–C14 e G1–G8 provati con un Dropbox simulato; C9 (due esecuzioni
  insieme) si affida al lock dello script e alla presa in carico con `move_v2`, da verificare dal vero.
- **Cambiato rispetto alla versione 2026-11-05** (decisioni di Stefano del 9-10/11/2026):
  - gli **Excel** (`.xls`, `.xlsx`) **non si convertono più**: restano come sono (l'estensione li ignora);
  - un **PDF** si converte solo quando accanto c'è il suo file coordinate `nome.coord`, scritto sul PC dal tasto destro
    "Crea coordinate per Markdown"; il risultato è `nome.pdf.md` con il layout ricostruito; PDF e `.coord` vanno in `Originali/`;
  - lo script lavora anche fuori da `/Projects/LLM-Mirroring` e `/Notes` (`/Applicazioni/OCR_Dropzone`, `/Applicazioni/Joplin`):
    §0.2 descriveva solo le cartelle che riguardano questo documento.

---

## 0. Quadro generale (leggere prima di tutto)

### 0.1 Chi fa cosa
- **Chat di Claude**: fanno il lavoro di qualità (interpretare note, scrivere testi). Quando serve un'operazione
  meccanica, scrivono un piccolo **file-comando** su Dropbox e aspettano un **file-risposta**.
- **Estensione Chrome "Mirroring knowledge"** (gira sul PC di Stefano): tiene allineata a due vie la knowledge dei
  progetti Claude con le cartelle `/Projects/LLM-Mirroring/<Progetto>/` su Dropbox, ed esegue i comandi della **propria**
  coda (`_comandi/estensione/`). **Lo script non la tocca e non ne esegue i comandi.**
- **Script Google** (questo documento): gira lato server. Moduli esistenti: Joplin (sincronizza `/Notes`), conversione
  dei binari dei progetti, più un terzo modulo non coinvolto qui. Questo documento aggiunge:
  1. **modulo Comandi** (nuovo): esegue i comandi della coda `_comandi/script/`;
  2. **controllo giornaliero** delle note vocali (nuovo): una mail se qualcosa è rimasto indietro;
  3. **piccole regole di esclusione** per i moduli esistenti.

### 0.2 Cartelle visibili allo script
L'app Dropbox dello script vede **solo** `/Projects/LLM-Mirroring/` (ricorsiva) e `/Notes`.
`/Applicazioni/VoceAgente/` NON è visibile e lo script non deve occuparsene in alcun modo.

### 0.3 Mappa di `/Projects/LLM-Mirroring/`
```
/Projects/LLM-Mirroring/
├── _comandi/                      ← NON è un progetto (inizia con "_")
│   ├── estensione/…               ← coda dell'estensione: lo script la IGNORA completamente
│   └── script/                    ← coda dello script (questo documento, §2)
│       ├── in/                    ← le chat creano qui i comandi
│       ├── in-corso/              ← comando preso in carico
│       ├── fatti/                 ← comando concluso (qualunque esito tranne "interrotto")
│       ├── interrotti/            ← comando rimasto troppo a lungo in in-corso
│       ├── risposte/              ← risposte per le chat esterne ai progetti
│       └── log/AAAA-MM.md         ← registro delle esecuzioni, uno per mese
├── Audio Notes/                   ← un progetto (cartella con il file _mirroring.json)
│   ├── _mirroring.json            ← file guida dell'estensione: NON toccare
│   ├── _resoconto.txt             ← resoconto dell'estensione: NON toccare
│   ├── _istruzioni-progetto.md    ← NON toccare
│   ├── _risposte/<id>.md          ← risposte ai comandi chiesti dalle chat di questo progetto
│   ├── Originali/…                ← originali dei binari convertiti (modulo conversione)
│   ├── business/inbox/AAAA-MM-GG-HHMM.md     ← sessioni di dettatura (le scrive l'app Android)
│   ├── business/registro/AAAA-MM-GG-HHMM.md  ← registro di ogni sessione (lo scrive la chat business)
│   └── … altri documenti del progetto
└── <Altro progetto>/…
```
Regola: una cartella diretta di `/Projects/LLM-Mirroring/` è un **progetto** solo se contiene `_mirroring.json`
e il suo nome **non** inizia con `_`.

### 0.4 Convenzioni comuni
- Percorsi Dropbox: confronti sempre su `path_lower` (Dropbox non distingue maiuscole/minuscole).
- Testi: UTF-8, fine riga `\n`.
- Date e ore: fuso **Europe/Lisbon**, formati `AAAA-MM-GG HH:MM:SS` (log, risposte) e `AAAA-MM-GG` (giorni).
- Nessuna cancellazione definitiva (`permanently_delete`) da nessun modulo.

---

## 1. Regole di esclusione per i moduli esistenti

**Scopo.** Evitare che i moduli attuali reagiscano a file che non li riguardano.

**Dispatcher (ricezione dei cambi da Dropbox).** Per ogni voce cambiata sotto `/Projects/LLM-Mirroring/`:
| Percorso (path_lower) | Modulo da chiamare |
|---|---|
| inizia con `/projects/llm-mirroring/_comandi/script/in/` ed è un file | **Comandi** (§2) |
| inizia con `/projects/llm-mirroring/_comandi/` (tutto il resto) | nessuno |
| dentro una cartella di primo livello che inizia con `_` | nessuno |
| dentro `<progetto>/originali/` o `<progetto>/_risposte/` | nessuno |
| file `.pdf .doc .docx` in un progetto (fuori dalle cartelle sopra); il PDF solo con il suo `.coord` accanto | Conversione |
| qualunque altra cosa | nessuno |

`/Notes` continua ad andare al modulo Joplin come oggi. Le scritture dell'estensione in `/Notes` (comando
`pubblica-joplin` dell'estensione: crea note in `/Notes/!VOCE-INBOX/` o sostituisce una nota nello stesso percorso)
sono cambi normali che il modulo Joplin tratta come oggi.

**Da rimuovere se esiste:** qualunque logica che sposta file da `acquisite/` a `elaborate/` o che legge
`/Applicazioni/VoceAgente/` (schema superato).

**Criteri di accettazione**
1. Un `.md`, `.txt`, `.json` comparso ovunque in LLM-Mirroring non attiva la conversione.
2. Un PDF messo in `_comandi/script/in/` non viene convertito (il modulo Comandi lo rifiuterà, §2.6).
3. Un PDF in `Audio Notes/sottocartella/` viene convertito come oggi.

---

## 2. Modulo Comandi (nuovo)

### 2.1 Descrizione
Le chat chiedono operazioni lato server scrivendo un file JSON in `_comandi/script/in/`. Il modulo lo prende in carico
una sola volta, lo esegue se è valido, scrive la risposta, registra l'esito nel log. **Aggiungere un comando in futuro
deve voler dire solo: aggiungere una voce all'elenco dei comandi (§2.7) con la sua funzione e i suoi limiti.**

### 2.2 Formato del file-comando
Percorso: `/Projects/LLM-Mirroring/_comandi/script/in/<id>.json`
```json
{
  "v": 1,
  "id": "20261105-203012-k7q2ab",
  "da": "chat-20261105-k7q2",
  "comando": "ping",
  "parametri": {},
  "risposta": "_comandi"
}
```
| Campo | Regola |
|---|---|
| `v` | numero intero, oggi solo `1` |
| `id` | regex `^[0-9]{8}-[0-9]{6}-[a-z0-9]{6}$` (data `AAAAMMGG`, ora `HHMMSS`, 6 caratteri casuali); **uguale al nome del file** senza `.json` |
| `da` | stringa 1–80 caratteri: identificativo della chat (es. `chat-20261105-k7q2`) o nome del progetto (es. `Audio Notes`). Solo informativo |
| `comando` | uno dei nomi in §2.7 |
| `parametri` | oggetto JSON; chiavi ammesse e limiti come in §2.7; **chiavi non previste = rifiuto** |
| `risposta` | `"_comandi"` (chat esterna) oppure il **nome esatto della cartella di un progetto** in LLM-Mirroring (es. `"Audio Notes"`) |
Dimensione massima del file: 64 KB.

### 2.3 Dove va la risposta
- `risposta = "_comandi"` → `/Projects/LLM-Mirroring/_comandi/script/risposte/<id>.md`
- `risposta = "<Progetto>"` → `/Projects/LLM-Mirroring/<Progetto>/_risposte/<id>.md`
  (vale solo se la cartella esiste e contiene `_mirroring.json`; altrimenti il comando è **rifiutato** e la risposta
  va in `_comandi/script/risposte/<id>.md`). L'estensione porterà poi la risposta nella knowledge del progetto.
- Le risposte si scrivono con `mode: add`, `autorename: false` (mai sovrascrivere). Se il file esiste già è un
  errore da registrare nel log (non deve succedere: l'id è unico).

### 2.4 Formato del file-risposta
```
id: 20261105-203012-k7q2ab
comando: ping
esito: ok
quando: 2026-11-05 20:30:15
da: chat-20261105-k7q2

ok
```
- Righe 1–5 di intestazione esattamente in quest'ordine, poi una riga vuota, poi il corpo in testo semplice.
- `esito` ∈ `ok` · `errore` (comando valido ma fallito nell'esecuzione) · `rifiutato` (non valido, fuori limiti,
  duplicato) · `interrotto` (vedi §2.8).
- Corpo: il risultato (per `ok`) oppure il motivo in una o due frasi (negli altri casi).
- Se l'`id` non è leggibile (file illeggibile, JSON rotto, nome non valido) **non si scrive nessuna risposta**:
  solo log.

### 2.5 Ciclo di esecuzione (una sola volta per comando)
Tutto il ciclo gira sotto `LockService.getScriptLock()` (attesa massima 30 s; se il lock non arriva, si esce e
ci penserà il giro successivo).
1. Elenca `_comandi/script/in/` (solo file). Ordina per nome (quindi per data).
2. Per ogni file `X`:
   a. **Presa in carico**: `files/move_v2` da `in/X` a `in-corso/X` (`autorename: false`).
      - errore `from_lookup/not_found` → qualcun altro l'ha preso: salta.
      - errore `to/conflict` → esiste già un file uguale in corso: sposta `in/X` in `fatti/X` con `autorename: true`,
        log `rifiutato · duplicato`, nessuna risposta. Passa al successivo.
   b. Salva in `PropertiesService` (Script) la chiave `presa:<nome file>` = istante attuale (ms).
   c. **Lettura e validazione** (§2.6). Se non valido → esito `rifiutato`, vai a (e).
   d. **Duplicato**: se l'`id` compare già nel log del mese corrente o del precedente → `rifiutato · id già eseguito`.
      Altrimenti esegui la funzione del comando (§2.7). Eccezione durante l'esecuzione → `errore` con il messaggio.
   e. Scrivi la risposta (§2.3–2.4), se l'id è leggibile.
   f. Sposta `in-corso/X` in `fatti/X` (`autorename: true`).
   g. Aggiungi la riga al log (§2.9) e cancella la chiave `presa:<nome file>`.
3. Esegui il controllo degli interrotti (§2.8).

**Quando gira il ciclo**
- Subito dopo un cambio sotto `_comandi/script/in/` (vedi §1): la funzione chiamata da Dropbox risponde subito e
  programma il lavoro pochi secondi dopo, come già fanno gli altri moduli.
- Come riserva, ogni 60 minuti con un trigger orario (stessa funzione).

### 2.6 Validazione (in quest'ordine; al primo errore → `rifiutato` con il motivo)
1. Estensione `.json` e dimensione ≤ 64 KB.
2. Contenuto UTF-8 e JSON valido, oggetto alla radice.
3. Presenti tutti e soli i campi `v, id, da, comando, parametri, risposta`.
4. `v === 1`; `id` conforme alla regex e uguale al nome del file; `da` stringa 1–80.
5. `comando` presente in §2.7.
6. `risposta` = `"_comandi"` o progetto valido (§2.3).
7. `parametri`: solo le chiavi previste dal comando, tipi e limiti rispettati.

### 2.7 Elenco chiuso dei comandi (versione 1)
Ogni comando è una funzione `(parametri, comando) → testo del corpo della risposta` che lancia un'eccezione in caso
di errore. Elenco in un unico oggetto, per esempio `COMANDI = { ping: {...}, 'invia-mail': {...} }` con
`{ parametri: {nome: {tipo, obbligatorio, min, max}}, esegui: function }`.

**`ping`** — prova la catena; non fa nulla.
- Parametri: nessuno (`{}`).
- Esito: `ok`, corpo `ok`.

**`invia-mail`** — manda una mail a Stefano.
- Parametri: `oggetto` (stringa obbligatoria, 1–150 caratteri, una riga), `testo` (stringa obbligatoria,
  1–20.000 caratteri, testo semplice).
- Destinatario: **sempre e solo** il proprietario dello script (`Session.getEffectiveUser().getEmail()`).
  Nessun parametro può cambiarlo.
- Oggetto inviato: `[Claude] ` + `oggetto`. In fondo al testo: riga vuota + `— Comando <id>, chiesto da <da>.`
- Tetto: **10 mail al giorno** (giorno di Lisbona), contatore in `PropertiesService` (`mail:<AAAA-MM-GG>`).
  Oltre il tetto → `rifiutato`, motivo `tetto giornaliero di 10 mail raggiunto`. La mail del controllo
  giornaliero (§3) non conta nel tetto.
- Esito `ok`, corpo `mail inviata`.

### 2.8 Comandi interrotti
- Per ogni file in `in-corso/`: se esiste `presa:<nome file>` ed è più vecchia di **15 minuti**, oppure se la chiave
  non esiste (in questo caso creala ora con l'istante attuale: scadrà fra 15 minuti), il comando è interrotto quando
  scade.
- Comando interrotto: spostalo in `interrotti/` (`autorename: true`), scrivi la risposta con esito `interrotto` e
  corpo `interrotto, non rieseguito` (se l'id è leggibile), riga di log con esito `interrotto`, cancella la chiave.
- **Mai rieseguire** un comando interrotto. I comandi interrotti delle ultime 24 ore finiscono nella mail giornaliera (§3).

### 2.9 Log
- File: `_comandi/script/log/AAAA-MM.md` (mese di Lisbona). Se manca, crealo con la riga di titolo
  `# Log comandi script — AAAA-MM` e una riga vuota.
- Una riga per comando, aggiunta in fondo (scarica, aggiungi, ricarica con `mode: overwrite`; sotto lock):
  `AAAA-MM-GG HH:MM:SS · <id o -> · <comando o -> · <da o -> · <esito> · <durata> s · <dettaglio breve>`
- Esempio: `2026-11-05 20:30:15 · 20261105-203012-k7q2ab · ping · chat-20261105-k7q2 · ok · 0.4 s · ok`
- Dettaglio: massimo 200 caratteri, a capo sostituiti da spazi.

### 2.10 Casi di errore e criteri di accettazione del modulo Comandi
| # | Prova | Risultato atteso |
|---|---|---|
| C1 | `ping` valido con `risposta: "_comandi"` | risposta `ok` in `_comandi/script/risposte/<id>.md`; file in `fatti/`; una riga di log `ok` |
| C2 | `ping` con `risposta: "Audio Notes"` | risposta in `Audio Notes/_risposte/<id>.md` |
| C3 | `risposta: "Inesistente"` | `rifiutato`; risposta in `_comandi/script/risposte/` |
| C4 | comando `cancella-tutto` | `rifiutato`, motivo "comando sconosciuto" |
| C5 | `ping` con `parametri: {"x":1}` | `rifiutato`, motivo "parametro non previsto: x" |
| C6 | nome file diverso dall'`id` | `rifiutato` |
| C7 | JSON rotto | nessuna risposta; file in `fatti/`; log con id `-` ed esito `rifiutato` |
| C8 | stesso comando ricaricato in `in/` dopo l'esecuzione | `rifiutato · id già eseguito`; nessuna seconda mail |
| C9 | due esecuzioni del ciclo partite insieme | il comando viene eseguito una volta sola |
| C10 | `invia-mail` valido | mail al proprietario con prefisso `[Claude] ` e riga finale con id |
| C11 | undicesima `invia-mail` nello stesso giorno | `rifiutato`, tetto raggiunto; nessuna mail |
| C12 | `invia-mail` con oggetto di 151 caratteri | `rifiutato` |
| C13 | file lasciato a mano in `in-corso/` | dopo 15 minuti (al giro successivo) in `interrotti/`, risposta `interrotto`, log |
| C14 | file in `_comandi/estensione/in/` | lo script non fa nulla |

---

## 3. Note vocali: ingresso e controllo giornaliero

### 3.1 Come arrivano le note (solo contesto: lo script non deve farci nulla)
- L'app Android scrive ogni sessione di dettatura in
  `/Projects/LLM-Mirroring/Audio Notes/business/inbox/AAAA-MM-GG-HHMM.md`. Se il nome esiste già, Dropbox aggiunge
  un suffisso: `AAAA-MM-GG-HHMM (1).md`.
- L'estensione porta la sessione nella knowledge; la chat business la elabora e scrive il registro nella knowledge;
  l'estensione porta il registro su Dropbox in `Audio Notes/business/registro/`.
- **Il registro ha esattamente lo stesso nome del file di sessione**, suffisso compreso
  (`2026-11-05-0830 (1).md` → registro `2026-11-05-0830 (1).md`).
- Nessuno sposta le sessioni: restano in `inbox/`. (L'archiviazione è un lavoro futuro, non ora.)

Formato di una sessione (esempio):
```
Sessione di dettatura del 05/11/2026 08:30 — 2 note

## Nota 1 — 08:30 — Chiamare il meccanico

Ricordami di chiamare il meccanico domani mattina per il tagliando.

## Nota 2 — 08:34 — Idea per l'orto

Provare a seminare le fave a fine novembre.

```
Formato di un registro (esempio, stesso nome della sessione):
```
- Nota 1 · attività · Chiamare il meccanico · creata · Todoist / Inbox, P4, 06/11
- Nota 2 · nota Joplin · Idea per l'orto · creata · /Notes/!VOCE-INBOX/Fave a novembre.md
```
Possibili righe speciali: `- Nota k · nessuna azione · <motivo>` e `- Nota k · <tipo> · <titolo> · IN SOSPESO: <motivo>`.
Nella cartella `registro/` possono esistere anche file `<nome sessione>-seguito.md`: **non sono registri di sessione**
e il controllo li ignora.

### 3.2 Controllo giornaliero (nuova funzione)
**Quando:** una volta al giorno alle **08:00 ora di Lisbona** (trigger giornaliero). Se il fuso del progetto Apps Script
non è `Europe/Lisbon`, impostare il trigger all'ora corrispondente; **non cambiare il fuso del progetto** senza aver
verificato gli effetti sul modulo Joplin.

**Costanti:** `PROGETTO_NOTE = "Audio Notes"`, `SOGLIA_ORE = 12`.

**Cosa controlla**
1. **Sessioni ferme**: ogni file `.md` in `Audio Notes/business/inbox/` (solo primo livello) con `server_modified`
   più vecchio di 12 ore e **senza** un file con lo stesso nome identico in `Audio Notes/business/registro/`.
2. **Registri incompleti**: per ogni sessione che ha il registro, contare le intestazioni `## Nota k` della sessione
   (regex di riga `^## Nota (\d+)\b`); il registro è incompleto se per qualche `k` da 1 al massimo non c'è almeno una
   riga che inizia con `- Nota k ·` (regex `^- Nota (\d+) ·`).
   Per contenere il lavoro, controllare solo le coppie in cui la sessione **o** il registro è cambiato negli ultimi
   7 giorni (`server_modified`).
3. **Comandi interrotti** nelle ultime 24 ore (righe di log con esito `interrotto`, mese corrente e precedente).

**Uscita**
- Se non c'è nulla da segnalare: **nessuna mail**.
- Altrimenti **una sola mail** al proprietario dello script, oggetto `[Audio Notes] Controllo del AAAA-MM-GG`,
  testo semplice con tre sezioni, ognuna presente solo se non vuota:
  ```
  Sessioni senza registro da più di 12 ore:
  - 2026-11-04-0815.md (arrivata il 04/11/2026 08:16)

  Registri incompleti:
  - 2026-11-03-1430.md: mancano le note 2, 4

  Comandi interrotti nelle ultime 24 ore:
  - 20261105-203012-k7q2ab (ping, da chat-20261105-k7q2)
  ```

**Criteri di accettazione**
| # | Prova | Risultato atteso |
|---|---|---|
| G1 | inbox con una sessione di 13 ore senza registro | mail con la sessione in elenco |
| G2 | sessione di 13 ore con registro dallo stesso nome | nessuna segnalazione |
| G3 | sessione `X (1).md` con registro `X.md` ma senza `X (1).md` | `X (1).md` segnalata |
| G4 | sessione con 3 note e registro con righe per Nota 1 e 3 | "mancano le note 2" |
| G5 | registro con riga `IN SOSPESO` per una nota | quella nota conta come presente |
| G6 | file `X-seguito.md` in registro/ | ignorato |
| G7 | tutto in ordine | nessuna mail |
| G8 | un comando interrotto ieri sera | compare nella mail |

---

## 4. Riepilogo delle cose da NON fare
- Non toccare `_comandi/estensione/`, `_mirroring.json`, `_resoconto.txt`, `_istruzioni-progetto.md`.
- Non spostare né rinominare nulla in `business/inbox/` e `business/registro/`.
- Non eseguire mai codice o percorsi ricevuti in un comando: solo i comandi dell'elenco, con i loro parametri.
- Non rieseguire comandi interrotti; non cancellare definitivamente nulla.
- Non mandare più di una mail di controllo al giorno.
