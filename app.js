// Note Auto v4 — registratore vocale per la guida.
// Tocco ovunque = avvia / ferma e salva. L'audio viene sempre salvato sul telefono;
// trascrizione (Whisper) e pulizia (LLM) via Groq avvengono dopo, quando c'è rete.
'use strict';

const VERSION = '4.1.0';
const GROQ = 'https://api.groq.com/openai/v1';
const LONG_PRESS_MS = 700;      // pressione lunga su "☰ Note" per aprire le note
const MIN_GAP_MS = 700;         // ignora tocchi troppo ravvicinati (rimbalzi)
const MIN_NOTE_SEC = 1;         // registrazioni più corte vengono scartate
const CHUNK_MS = 2000;          // l'audio viene scritto sul telefono ogni 2 s

const DEFAULT_RULES = [
  '- Se dico "ambito" seguito da un nome (es. "ambito lavoro"), usa quel nome come ambito e togli quelle parole dal testo.',
  '- Se dico "tag" seguito da un nome (es. "tag telefonata"), è un promemoria rapido: ambito = "Promemoria", titolo = quel nome.',
  '- Se non indico l\'ambito, deducilo dal contenuto con una o due parole.',
].join('\n');
const DEFAULTS = { key: '', cleanup: true, rules: DEFAULT_RULES, vocab: '',
  sttModel: 'whisper-large-v3', llmModel: 'openai/gpt-oss-120b' };
// Modelli di riserva per la pulizia, provati in ordine se quello scelto non risponde.
const LLM_FALLBACKS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
// Frasi che Whisper "inventa" su silenzio o rumore: se la nota contiene solo una di queste, non c'è parlato.
const HALLUCINATIONS = /^(grazie( a tutti| mille| per l'attenzione| per la visione)?|ciao( a tutti)?|buonasera|sottotitoli( creati dalla comunità amara\.org| a cura di .*)?|amara\.org|\.+)[.!?\s]*$/i;

const SYSTEM_PROMPT = `Ripulisci una nota dettata a voce mentre l'autore guida, trascritta automaticamente: può contenere errori di riconoscimento.
Regole:
1. Correggi gli errori di trascrizione evidenti deducendo dal contesto la parola giusta. Non inventare contenuti.
2. Aggiungi punteggiatura, maiuscole e, se serve, paragrafi.
3. Elimina esitazioni (ehm, allora, cioè ripetuti), false partenze e ripetizioni. Mantieni tutto il contenuto, il tono e la prima persona dell'autore.
4. Non aggiungere commenti, spiegazioni o riassunti. Se un passaggio è incomprensibile lascialo com'è tra [parentesi quadre].
Rispondi SOLO con un oggetto JSON con queste chiavi:
{"titolo": "titolo breve, massimo 8 parole", "ambito": "argomento in una o due parole", "testo": "il testo ripulito"}`;

// ---------- utilità ----------
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const fmtDur = (s) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;
const fmtDate = (ms) => { const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function getSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('noteauto.settings') || '{}') }; }
  catch (e) { return { ...DEFAULTS }; }
}
function saveSettings(s) {
  try { localStorage.setItem('noteauto.settings', JSON.stringify(s)); return true; } catch (e) { return false; }
}

// ---------- archivio (IndexedDB) ----------
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('noteauto', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('notes', { keyPath: 'id' });
      d.createObjectStore('chunks', { keyPath: ['noteId', 'i'] });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const putNote = (n) => tx('notes', 'readwrite', (s) => s.put(n));
const getNote = (id) => tx('notes', 'readonly', (s) => s.get(id));
const allNotes = () => tx('notes', 'readonly', (s) => s.getAll());
const delNote = (id) => tx('notes', 'readwrite', (s) => s.delete(id));
const putChunk = (c) => tx('chunks', 'readwrite', (s) => s.put(c));
const chunksOf = (noteId) => tx('chunks', 'readonly', (s) => s.getAll(IDBKeyRange.bound([noteId, 0], [noteId, Infinity])));
const delChunks = (noteId) => tx('chunks', 'readwrite', (s) => s.delete(IDBKeyRange.bound([noteId, 0], [noteId, Infinity])));

async function updateNote(id, patch) {
  const n = await getNote(id);
  if (!n) return null;
  Object.assign(n, patch);
  await putNote(n);
  return n;
}

// ---------- suoni ----------
let actx = null;
function unlockAudio() { // va chiamata dentro un tocco: iOS permette i suoni solo dopo un gesto
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state !== 'running') actx.resume();
  } catch (e) {}
}
function tone(freq, at, dur) {
  if (!actx || actx.state !== 'running' || document.visibilityState !== 'visible') return;
  try {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + at;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + dur + 0.05);
  } catch (e) {}
}
function play(fn) {
  if (!actx) return;
  if (actx.state === 'running') { fn(); return; }
  const asked = performance.now();
  try { actx.resume().then(() => { if (performance.now() - asked < 800) fn(); }).catch(() => {}); } catch (e) {}
}
const sound = {
  start: () => play(() => tone(880, 0, 0.25)),                                   // un bip acuto
  saved: () => play(() => { tone(523, 0, 0.18); tone(784, 0.2, 0.3); }),         // due note che salgono
  discard: () => play(() => { tone(440, 0, 0.18); tone(330, 0.2, 0.3); }),       // due note che scendono
  error: () => play(() => { tone(220, 0, 0.35); tone(220, 0.45, 0.35); }),       // due bip gravi
};

// ---------- schermo acceso ----------
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } } catch (e) { wakeLock = null; }
}

// ---------- registrazione ----------
let state = 'idle';           // idle | starting | recording | saving
let stream = null, recorder = null, current = null, tickTimer = null, lastTap = 0;
let writeChain = Promise.resolve();

function pickMime() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  for (const m of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'])
    if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

async function ensureStream() {
  if (stream && stream.getAudioTracks().some((t) => t.readyState === 'live')) return stream;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => {
    if (state === 'recording') stopRecording({ reason: 'interrupted' });
  }));
  return stream;
}

async function startRecording() {
  state = 'starting';
  showScreen('starting');
  try {
    await ensureStream();
    const mime = pickMime();
    try { recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined); }
    catch (e) { recorder = new MediaRecorder(stream); }
    const id = Date.now();
    current = { id, start: performance.now(), mime: recorder.mimeType || mime || 'audio/mp4', i: 0 };
    await putNote({ id, created: id, dur: 0, mime: current.mime, status: 'recording', raw: '', text: '', title: '', scope: '', error: '' });
    recorder.ondataavailable = (e) => {
      if (!e.data || !e.data.size || !current) return;
      const c = { noteId: current.id, i: current.i++ };
      const blob = e.data;
      writeChain = writeChain.then(async () => { c.buf = await blob.arrayBuffer(); await putChunk(c); }).catch(() => {});
    };
    recorder.start(CHUNK_MS);
    state = 'recording';
    sound.start();
    showScreen('recording');
    tickTimer = setInterval(() => { $('timer').textContent = fmtDur((performance.now() - current.start) / 1000); }, 250);
    $('timer').textContent = '0:00';
  } catch (e) {
    state = 'idle';
    recorder = null;
    if (current) { await delNote(current.id).catch(() => {}); current = null; }
    sound.error();
    const msg = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      ? 'Microfono non autorizzato. Chiudi e riapri l\'app, poi tocca "Consenti".'
      : 'Il microfono non risponde (' + (e && e.name || 'errore') + ').';
    showScreen('problem', msg);
  }
}

async function stopRecording({ reason } = {}) {
  if (state !== 'recording' || !recorder) return;
  state = 'saving';
  clearInterval(tickTimer);
  const note = current;
  const dur = (performance.now() - note.start) / 1000;
  await new Promise((res) => {
    recorder.onstop = res;
    try { recorder.stop(); } catch (e) { res(); }
    setTimeout(res, 3000); // non restare mai bloccati
  });
  recorder = null; current = null;
  await writeChain;
  const ok = await finalizeNote(note.id, dur);
  state = 'idle';
  if (reason === 'interrupted') { showScreen('idle'); }
  else if (ok) { sound.saved(); showScreen('saved'); setTimeout(() => state === 'idle' && showScreen('idle'), 1500); }
  else { sound.discard(); showScreen('problem', 'Registrazione troppo breve, non salvata.'); setTimeout(() => state === 'idle' && showScreen('idle'), 2000); }
  processQueue();
}

// Unisce i pezzi audio salvati in una nota completa (anche dopo una chiusura improvvisa).
async function finalizeNote(id, dur) {
  const n = await getNote(id);
  if (!n) return false;
  const chunks = (await chunksOf(id)).sort((a, b) => a.i - b.i);
  const size = chunks.reduce((a, c) => a + c.buf.byteLength, 0);
  if (dur == null) dur = chunks.length * CHUNK_MS / 1000;
  if (!size || dur < MIN_NOTE_SEC) { await delNote(id); await delChunks(id); return false; }
  const audio = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { audio.set(new Uint8Array(c.buf), off); off += c.buf.byteLength; }
  n.audio = audio.buffer; n.dur = Math.round(dur); n.status = 'pending'; n.nextTry = 0;
  await putNote(n);
  await delChunks(id);
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  return true;
}

async function recoverOrphans() { // registrazioni interrotte da una chiusura dell'app
  for (const n of await allNotes()) {
    if (n.status === 'recording' && (!current || n.id !== current.id)) await finalizeNote(n.id, null);
    // dopo un aggiornamento dell'app, ritenta una volta la pulizia delle note dove era fallita
    else if (n.status === 'done' && /^Pulizia non riuscita/.test(n.error || '') && n.ver !== VERSION) await updateNote(n.id, { status: 'pending', nextTry: 0, tries: 0, error: '' });
  }
}

// ---------- schermata del registratore ----------
let footTimer = null;
function showScreen(kind, msg) {
  const rec = $('rec');
  rec.className = kind === 'recording' ? 'recording' : kind === 'saved' ? 'saved' : kind === 'problem' ? 'problem' : '';
  const big = { idle: 'TOCCA<br>PER REGISTRARE', starting: '…', recording: 'REGISTRO<br><small style="font-size:.5em">tocca per salvare</small>',
    saved: 'SALVATA', problem: 'ATTENZIONE' }[kind];
  $('big').innerHTML = big;
  if (kind !== 'recording') $('timer').textContent = '';
  if (kind === 'problem') { $('foot').textContent = msg || ''; clearTimeout(footTimer); return; }
  refreshFoot();
}
async function refreshFoot() {
  if (state === 'recording') { $('foot').textContent = 'Parla pure, anche con pause. Tocca di nuovo per salvare.'; return; }
  if ($('rec').className === 'problem') return;
  const notes = await allNotes().catch(() => []);
  const s = getSettings();
  const pend = notes.filter((n) => n.status === 'pending').length;
  const err = notes.filter((n) => n.status === 'error').length;
  const parts = [];
  if (!s.key) parts.push('Manca la chiave Groq: le note restano solo audio.');
  if (pend) parts.push(`${pend} da trascrivere${navigator.onLine ? '' : ' (senza rete)'}`);
  if (err) parts.push(`${err} con errori`);
  parts.push('Tieni premuto ☰ per le note');
  $('foot').textContent = parts.join(' · ');
}

// Tocco breve ovunque = registra/salva. Pressione lunga su "☰ Note" (solo da fermo) = apri le note.
let pressTimer = null, pressOnMenu = false, longDone = false;
function onDown(e) {
  unlockAudio();
  const r = $('menu').getBoundingClientRect();
  const x = e.clientX, y = e.clientY;
  pressOnMenu = state === 'idle' && x >= r.left - 20 && x <= r.right + 20 && y >= r.top - 20 && y <= r.bottom + 20;
  longDone = false;
  if (pressOnMenu) pressTimer = setTimeout(() => { longDone = true; openPanel(); }, LONG_PRESS_MS);
}
function onUp() {
  clearTimeout(pressTimer);
  if (longDone) return;
  if (pressOnMenu) { toast('Tieni premuto più a lungo per aprire le note'); return; }
  unlockAudio();
  const now = Date.now();
  if (now - lastTap < MIN_GAP_MS) return;
  lastTap = now;
  if (state === 'idle') startRecording();
  else if (state === 'recording') stopRecording();
}

// ---------- coda di trascrizione e pulizia ----------
let processing = false;
class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function groqFetch(path, opts, key, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(GROQ + path, { ...opts, signal: ctl.signal, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + key } });
    if (!r.ok) {
      let msg = '';
      try { const j = await r.json(); msg = j.error && j.error.message || ''; } catch (e) {}
      throw new ApiError(r.status, msg || ('HTTP ' + r.status));
    }
    return r.json();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'rete non disponibile');
  } finally { clearTimeout(t); }
}

async function transcribe(n, s) {
  const ext = /webm/.test(n.mime) ? 'webm' : /ogg/.test(n.mime) ? 'ogg' : 'm4a';
  const fd = new FormData();
  fd.append('file', new Blob([n.audio], { type: n.mime.split(';')[0] }), `nota.${ext}`);
  fd.append('model', s.sttModel);
  fd.append('language', 'it');
  fd.append('temperature', '0');
  fd.append('response_format', 'json');
  if (s.vocab.trim()) fd.append('prompt', s.vocab.trim().slice(0, 600));
  const j = await groqFetch('/audio/transcriptions', { method: 'POST', body: fd }, s.key, 180000);
  return (j.text || '').trim();
}

function parseJsonLoose(txt) {
  const t = String(txt || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('risposta non in formato JSON');
}

async function cleanupWith(model, raw, s, jsonMode) {
  const body = {
    model, temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT + (s.rules.trim() ? '\n\nRegole personali dell\'autore (hanno la precedenza):\n' + s.rules.trim() : '') },
      { role: 'user', content: raw },
    ],
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  if (/gpt-oss/.test(model)) body.reasoning_effort = 'low';
  const j = await groqFetch('/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, s.key, 90000);
  const out = parseJsonLoose(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
  const text = String(out.testo || '').trim();
  if (!text) throw new Error('risposta senza testo');
  return { text, title: String(out.titolo || '').trim(), scope: String(out.ambito || '').trim() };
}

// Prova il modello scelto e poi quelli di riserva. Ricorda quello che funziona.
async function cleanup(raw, s) {
  const models = [...new Set([s.llmModel, ...LLM_FALLBACKS].filter(Boolean))];
  const errors = [];
  for (const m of models) {
    for (const jsonMode of [true, false]) {
      try {
        const r = await cleanupWith(m, raw, s, jsonMode);
        if (m !== s.llmModel) { const cur = getSettings(); cur.llmModel = m; saveSettings(cur); s.llmModel = m; }
        return r;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 0 || e.status === 401 || e.status === 429 || e.status >= 500)) throw e;
        errors.push(`${m}${jsonMode ? '' : ' (senza JSON)'}: ${e.message || e}`);
      }
    }
  }
  const err = new Error(errors.join(' | '));
  err.details = errors;
  throw err;
}

async function processNote(n, s) {
  try {
    if (!n.raw) {
      let raw = await transcribe(n, s);
      if (HALLUCINATIONS.test(raw)) raw = '';
      n = await updateNote(n.id, { raw: raw || ' ' });
      if (!raw) { await updateNote(n.id, { status: 'done', text: '(nessun parlato riconosciuto)', error: '' }); return; }
    }
    if (HALLUCINATIONS.test(n.raw.trim())) { await updateNote(n.id, { status: 'done', text: '(nessun parlato riconosciuto)', title: '', scope: '', error: '', ver: VERSION }); return; }
    let result = { text: n.raw.trim(), title: '', scope: '' };
    if (s.cleanup) {
      try { result = await cleanup(n.raw.trim(), s); }
      catch (e) { if (e instanceof ApiError && (e.status === 0 || e.status === 429 || e.status >= 500)) throw e; // ritenta più tardi
        result.error = 'Pulizia non riuscita, tenuta la trascrizione originale. Dettagli: ' + String(e.message || e).slice(0, 400); }
    }
    await updateNote(n.id, { status: 'done', text: result.text, title: result.title, scope: result.scope, error: result.error || '', tries: 0, ver: VERSION });
  } catch (e) {
    const st = e instanceof ApiError ? e.status : -1;
    const tries = (n.tries || 0) + 1;
    if (st === 401 || st === 403) await updateNote(n.id, { status: 'error', error: 'Chiave Groq non valida.', tries });
    else if (st === 413) await updateNote(n.id, { status: 'error', error: 'Audio troppo lungo per Groq (oltre 25 MB).', tries });
    else if (st === 0 || st === 429 || st >= 500) await updateNote(n.id, { status: 'pending', nextTry: Date.now() + Math.min(60000 * tries, 600000), tries, error: '' });
    else if (tries >= 4) await updateNote(n.id, { status: 'error', error: 'Errore: ' + (e.message || e), tries });
    else await updateNote(n.id, { status: 'pending', nextTry: Date.now() + 30000 * tries, tries, error: '' });
    if (st === 0) throw e; // senza rete: inutile provare le altre
  }
}

async function processQueue(force) {
  if (processing) return;
  const s = getSettings();
  if (!s.key || !navigator.onLine) { refreshFoot(); return; }
  processing = true;
  try {
    const now = Date.now();
    const todo = (await allNotes()).filter((n) => n.status === 'pending' && (force || !n.nextTry || n.nextTry <= now)).sort((a, b) => a.id - b.id);
    for (const n of todo) { await processNote(n, s); refreshFoot(); if (!$('panel').hidden) renderList(); }
  } catch (e) { /* rete assente: riproveremo */ }
  finally { processing = false; refreshFoot(); if (!$('panel').hidden) renderList(); }
}

// ---------- pannello note ----------
function openPanel() {
  $('panel').hidden = false; $('rec').hidden = true;
  showTab('notes');
}
function closePanel() {
  $('panel').hidden = true; $('rec').hidden = false;
  document.querySelectorAll('#list audio').forEach((a) => a.pause());
  showScreen('idle');
}
function showTab(t) {
  $('tabNotes').classList.toggle('on', t === 'notes');
  $('tabSettings').classList.toggle('on', t === 'settings');
  $('notesView').hidden = t !== 'notes';
  $('settingsView').hidden = t !== 'settings';
  $('panel').querySelector('h1').textContent = t === 'notes' ? 'Note' : 'Impostazioni';
  if (t === 'notes') renderList(); else loadSettingsForm();
}

const statusLabel = { pending: ['in attesa di trascrizione', 'pending'], done: ['pronta', 'done'], error: ['errore', 'error'], recording: ['in registrazione', 'pending'] };

let exportCache = null;
async function renderList() {
  buildExport().then((x) => { exportCache = x; }).catch(() => {});
  const notes = (await allNotes()).filter((n) => n.status !== 'recording').sort((a, b) => b.id - a.id);
  const done = notes.filter((n) => n.status === 'done').length;
  $('summary').textContent = notes.length ? `${notes.length} note · ${done} pronte · ${notes.length - done} in attesa o con errori` : '';
  if (!notes.length) { $('list').innerHTML = '<div class="empty">Nessuna nota. Torna al registratore e tocca lo schermo per registrare.</div>'; return; }
  $('list').innerHTML = notes.map((n) => {
    const [lab, cls] = statusLabel[n.status] || [n.status, ''];
    const body = n.status === 'done' ? n.text : (n.raw && n.raw.trim() ? n.raw : '');
    return `<div class="note" data-id="${n.id}">
      <div class="meta"><span>${fmtDate(n.created)} · ${fmtDur(n.dur || 0)}</span><span class="badge ${cls}">${lab}</span></div>
      ${n.title ? `<div class="title">${esc(n.title)}</div>` : ''}
      ${n.scope ? `<div class="scope">${esc(n.scope)}</div>` : ''}
      ${body ? `<div class="text">${esc(body)}</div>` : ''}
      ${n.error ? `<div class="err">${esc(n.error)}</div>` : ''}
      ${n.status === 'done' && n.raw && n.raw.trim() && n.raw.trim() !== n.text ? `<details><summary>Trascrizione originale</summary><div class="text">${esc(n.raw)}</div></details>` : ''}
      <div class="row">
        <button class="small" data-act="play">▶ Ascolta</button>
        <button class="small" data-act="redo">${n.status === 'done' ? 'Rielabora' : 'Riprova'}</button>
        <button class="small danger" data-act="del">Elimina</button>
      </div></div>`;
  }).join('');
}

async function onListClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = Number(b.closest('.note').dataset.id);
  const act = b.dataset.act;
  if (act === 'del') {
    if (await confirmBox('Eliminare questa nota e il suo audio?')) { await delNote(id); renderList(); refreshFoot(); }
  } else if (act === 'redo') {
    const n = await getNote(id);
    const keepRaw = n.status === 'done' && n.raw && n.raw.trim();
    await updateNote(id, { status: 'pending', nextTry: 0, tries: 0, error: '', ...(keepRaw ? {} : { raw: '' }) });
    renderList();
    if (!getSettings().key) toast('Inserisci prima la chiave Groq nelle Impostazioni.');
    else if (!navigator.onLine) toast('Nessuna rete: la nota verrà elaborata appena torna.');
    processQueue(true);
  } else if (act === 'play') {
    const n = await getNote(id);
    const box = b.closest('.note');
    let a = box.querySelector('audio');
    if (!a) {
      a = document.createElement('audio');
      a.controls = true;
      a.src = URL.createObjectURL(new Blob([n.audio], { type: n.mime.split(';')[0] }));
      box.appendChild(a);
    }
    a.play().catch(() => {});
  }
}

// ---------- esportazione ----------
async function buildExport() {
  const notes = (await allNotes()).filter((n) => n.status !== 'recording').sort((a, b) => a.id - b.id);
  const d = new Date();
  let out = `# Note Auto — ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}\n\n`;
  const groups = {};
  for (const n of notes) {
    const g = n.status === 'done' ? (n.scope || 'Generale') : 'Da trascrivere';
    (groups[g] = groups[g] || []).push(n);
  }
  for (const g of Object.keys(groups).sort((a, b) => (a === 'Da trascrivere') - (b === 'Da trascrivere') || a.localeCompare(b, 'it'))) {
    out += `## ${g}\n\n`;
    for (const n of groups[g]) {
      out += `### ${n.title || 'Nota'} — ${fmtDate(n.created)} (${fmtDur(n.dur || 0)})\n\n`;
      out += n.status === 'done' ? `${n.text}\n\n` : `(audio non ancora trascritto)\n\n`;
    }
  }
  return { text: out, count: notes.length };
}

async function shareAll() {
  const { text, count } = exportCache || await buildExport();
  if (!count) { toast('Nessuna nota da condividere.'); return; }
  const d = new Date();
  const name = `note-auto-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.txt`;
  try {
    const file = new File([text], name, { type: 'text/plain' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Note Auto' }); return; }
    if (navigator.share) { await navigator.share({ title: 'Note Auto', text }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name; a.click();
}

async function copyAll() {
  const { text, count } = exportCache || await buildExport();
  if (!count) { toast('Nessuna nota da copiare.'); return; }
  try { await navigator.clipboard.writeText(text); toast('Testo copiato.'); }
  catch (e) { toast('Copia non riuscita.'); }
}

// ---------- impostazioni ----------
function loadSettingsForm() {
  const s = getSettings();
  $('key').value = s.key; $('cleanup').checked = s.cleanup; $('rules').value = s.rules;
  $('vocab').value = s.vocab; $('sttModel').value = s.sttModel; $('llmModel').value = s.llmModel;
}
function readSettingsForm() {
  const s = getSettings();
  s.key = $('key').value.trim(); s.cleanup = $('cleanup').checked; s.rules = $('rules').value;
  s.vocab = $('vocab').value; s.sttModel = $('sttModel').value.trim() || DEFAULTS.sttModel; s.llmModel = $('llmModel').value.trim() || DEFAULTS.llmModel;
  return s;
}
async function onSaveSettings() {
  const before = getSettings().key;
  const s = readSettingsForm();
  if (!saveSettings(s)) { toast('Salvataggio non riuscito.'); return; }
  if (s.key && s.key !== before) { // chiave nuova: riprova le note bloccate per chiave non valida
    for (const n of await allNotes()) if (n.status === 'error' && /Chiave/.test(n.error)) await updateNote(n.id, { status: 'pending', error: '', tries: 0, nextTry: 0 });
  }
  toast('Impostazioni salvate.');
  processQueue(true);
}
async function onTestKey() {
  const key = $('key').value.trim();
  if (!key) { toast('Scrivi prima la chiave.'); return; }
  toast('Verifico…');
  try { await groqFetch('/models', { method: 'GET' }, key, 15000); toast('Chiave valida ✓'); }
  catch (e) { toast(e.status === 401 || e.status === 403 ? 'Chiave non valida.' : 'Verifica non riuscita: ' + e.message); }
}

// ---------- piccoli dialoghi ----------
let toastTimer = null;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3000); }
function confirmBox(msg) {
  return new Promise((res) => {
    $('confirmText').textContent = msg; $('confirm').hidden = false;
    const done = (v) => { $('confirm').hidden = true; $('confirmYes').onclick = $('confirmNo').onclick = null; res(v); };
    $('confirmYes').onclick = () => done(true); $('confirmNo').onclick = () => done(false);
  });
}

// ---------- avvio ----------
function init() {
  $('ver').textContent = 'Note Auto v' + VERSION;
  const rec = $('rec');
  rec.addEventListener('pointerdown', onDown);
  rec.addEventListener('pointerup', onUp);
  rec.addEventListener('pointercancel', () => clearTimeout(pressTimer));
  rec.addEventListener('contextmenu', (e) => e.preventDefault());

  $('back').onclick = closePanel;
  $('tabNotes').onclick = () => showTab('notes');
  $('tabSettings').onclick = () => showTab('settings');
  $('list').addEventListener('click', onListClick);
  $('share').onclick = shareAll;
  $('copy').onclick = copyAll;
  $('retryAll').onclick = () => {
    if (!getSettings().key) { toast('Inserisci prima la chiave Groq nelle Impostazioni.'); return; }
    if (!navigator.onLine) { toast('Nessuna rete al momento.'); return; }
    toast('Trascrizione in corso…'); processQueue(true);
  };
  $('deleteAll').onclick = async () => {
    if (!(await confirmBox('Eliminare TUTTE le note e i loro audio? Non si può annullare.'))) return;
    for (const n of await allNotes()) if (n.status !== 'recording') { await delNote(n.id); await delChunks(n.id); }
    renderList(); refreshFoot();
  };
  $('saveKey').onclick = onSaveSettings;
  $('saveSettings').onclick = onSaveSettings;
  $('testKey').onclick = onTestKey;
  $('resetRules').onclick = () => { $('rules').value = DEFAULTS.rules; $('sttModel').value = DEFAULTS.sttModel; $('llmModel').value = DEFAULTS.llmModel; toast('Valori predefiniti ripristinati: premi Salva.'); };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (state === 'recording') stopRecording({ reason: 'interrupted' }); }
    else { keepAwake(); refreshFoot(); processQueue(); }
  });
  window.addEventListener('online', () => processQueue(true));
  window.addEventListener('offline', refreshFoot);
  setInterval(() => { if (document.visibilityState === 'visible' && state !== 'recording') processQueue(); }, 60000);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  keepAwake();
  showScreen('idle');
  recoverOrphans().then(() => { refreshFoot(); processQueue(); });
}
init();
