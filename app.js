// Note Auto v5 (Nero) — registratore vocale per la guida.
// Tocco ovunque = avvia / ferma e salva. L'audio viene sempre salvato sul telefono; la trascrizione (Whisper, via Groq)
// avviene dopo, quando c'è rete. Il testo grezzo va al centralino di Nero (strada del cloud: la web app non ha Dropbox);
// se il centralino non risponde le note restano qui in attesa e si riprova.
'use strict';

const VERSION = '5.0.0';
const GROQ = 'https://api.groq.com/openai/v1';
const DEFAULT_CENTRALINO = 'https://nero-centralino.stebar3000.workers.dev';
const DEVICE = 'iphone';
const WATCH_EVERY_MS = 15000;   // dopo una consegna: controllo dei rapporti ogni 15 s...
const WATCH_FOR_MS = 6 * 60000; // ...per 6 minuti, finché la pagina è aperta
const KEEP_RAPPORTI = 5;
const LONG_PRESS_MS = 700;      // pressione lunga su "☰ Note" per aprire le note
const MIN_GAP_MS = 700;         // ignora tocchi troppo ravvicinati (rimbalzi)
const MIN_NOTE_SEC = 1;         // registrazioni più corte vengono scartate
const CHUNK_MS = 2000;          // l'audio viene scritto sul telefono ogni 2 s

const DEFAULTS = { key: '', vocab: '', sttModel: 'whisper-large-v3', centralino: DEFAULT_CENTRALINO, nkey: '' };
// Frasi che Whisper "inventa" su silenzio o rumore: se la nota contiene solo una di queste, non c'è parlato.
const HALLUCINATIONS = /^(grazie( a tutti| mille| per l'attenzione| per la visione)?|ciao( a tutti)?|buonasera|sottotitoli( creati dalla comunità amara\.org| a cura di .*)?|amara\.org|\.+)[.!?\s]*$/i;

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
    await putNote({ id, created: id, dur: 0, mime: current.mime, status: 'recording', raw: '', text: '', error: '' });
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
  const waiting = toDeliver(notes).length;
  const parts = [];
  $('menu').textContent = unread ? '☰ Note ●' : '☰ Note';
  if (!s.key) parts.push('Manca la chiave Groq: le note restano solo audio.');
  if (!s.nkey) parts.push('Manca la chiave del centralino: le note restano qui.');
  if (pend) parts.push(`${pend} da trascrivere${navigator.onLine ? '' : ' (senza rete)'}`);
  if (waiting) parts.push(`${waiting} da consegnare${navigator.onLine ? '' : ' (senza rete)'}`);
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

// ---------- coda di trascrizione e consegna ----------
let processing = false, delivering = false, nkeyBad = false;
class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function apiFetch(base, path, opts, key, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(base + path, { ...opts, signal: ctl.signal, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + key } });
    if (!r.ok) {
      let msg = '';
      try { const j = await r.json(); msg = (j.error && j.error.message) || j.errore || ''; } catch (e) {}
      throw new ApiError(r.status, msg || ('HTTP ' + r.status));
    }
    return r.json();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'rete non disponibile');
  } finally { clearTimeout(t); }
}
const groqFetch = (path, opts, key, timeoutMs) => apiFetch(GROQ, path, opts, key, timeoutMs);
const nero = (path, opts, s, timeoutMs = 15000) => apiFetch(s.centralino.replace(/\/+$/, ''), path, opts, s.nkey, timeoutMs);

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

// Trascrive la nota: il testo consegnato è quello grezzo di Whisper. Solo le note di questa versione (toSend) vengono consegnate.
async function processNote(n, s) {
  try {
    const raw = n.raw && n.raw.trim() ? n.raw.trim() : await transcribe(n, s);
    if (!raw || HALLUCINATIONS.test(raw)) { await updateNote(n.id, { status: 'done', raw: ' ', text: '(nessun parlato riconosciuto)', error: '', ver: VERSION }); return; }
    await updateNote(n.id, { status: 'done', raw, text: raw, toSend: true, error: '', tries: 0, ver: VERSION });
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
  if (!navigator.onLine) { refreshFoot(); return; }
  processing = true;
  try {
    if (s.key) {
      const now = Date.now();
      const todo = (await allNotes()).filter((n) => n.status === 'pending' && (force || !n.nextTry || n.nextTry <= now)).sort((a, b) => a.id - b.id);
      for (const n of todo) { await processNote(n, s); refreshFoot(); if (!$('panel').hidden) renderList(); }
    }
  } catch (e) { /* rete assente: riproveremo */ }
  finally { processing = false; }
  await deliverQueue();
  refreshFoot(); if (!$('panel').hidden) renderList();
}

// Testo del lotto (protocollo di Nero §2): una direttiva per nota, trascrizione grezza.
function formatLotto(notes, device, now) {
  const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const d = new Date(now);
  let out = `# Direttive ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm(now)} (${device})\n`;
  notes.forEach((n, i) => { out += `\n## Direttiva ${i + 1} — ${hm(n.created)}\n${n.text.trim()}\n`; });
  return out;
}

const toDeliver = (notes) => notes.filter((n) => n.status === 'done' && n.toSend && !n.sent && n.text && n.text.trim()).sort((a, b) => a.id - b.id);

// Un invio = una chiamata con tutte le direttive pronte. Nota consegnata solo dopo la risposta ok del centralino; se non risponde riprova al giro dopo.
async function deliverQueue() {
  if (delivering) return;
  const s = getSettings();
  if (!s.nkey || !navigator.onLine) return;
  delivering = true;
  try {
    const todo = toDeliver(await allNotes());
    if (!todo.length) return;
    const j = await nero('/lotto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testo: formatLotto(todo, DEVICE, Date.now()), dispositivo: DEVICE }) }, s);
    if (!j || j.ok !== true) throw new ApiError(-1, (j && j.errore) || 'risposta negativa del centralino');
    const at = Date.now();
    for (const n of todo) await updateNote(n.id, { sent: at });
    nkeyBad = false;
    startRapportoWatch();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && !nkeyBad) { nkeyBad = true; toast('Chiave del centralino non valida'); }
    // altri errori (rete, 5xx, tempo scaduto): le note restano in attesa e si riprova
  } finally { delivering = false; }
}

// ---------- rapporti di Nero ----------
let watchTimer = null, watchUntil = 0, checkingRapporti = false, unread = false, rapStatus = '';
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
function savedRapporti() { try { const a = JSON.parse(lsGet('noteauto.rapporti', '[]')); return Array.isArray(a) ? a : []; } catch (e) { return []; } }

const asList = (v) => (Array.isArray(v) ? v : []).map((x) => (x && typeof x === 'object' ? (x.testo ?? JSON.stringify(x)) : String(x ?? ''))).map((x) => x.trim()).filter(Boolean);
// Solo collegamenti web: il campo "chat" arriva dal centralino e non deve poter eseguire altro.
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');

// Ciò che si legge ad alta voce: la sintesi, poi "Decisioni rapide:" e le decisioni se ci sono.
function testoDaLeggere(r) {
  let t = String((r && r.sintesi) || '').trim();
  const dec = asList(r && r.decisioni);
  if (dec.length) t += ' Decisioni rapide: ' + dec.map((d) => (/[.!?]$/.test(d) ? d : d + '.')).join(' ');
  return t.trim();
}

// Il rapporto nell'ordine del protocollo: chi ha lavorato, fatto, decisioni rapide, da sapere, problemi; in fondo, separati, i dubbi.
function rapportoHtml(r) {
  const sec = (name, items) => (items.length ? `<h3>${name}</h3><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  const chat = safeUrl(r.chat);
  const dubbi = asList(r.dubbi);
  return `<div class="rap"><h3>Ha lavorato: ${esc(r.chi || 'Nero')}${r.lotto ? ` <span class="muted">(lotto ${esc(r.lotto)})</span>` : ''}</h3>`
    + (chat ? `<p><a href="${esc(chat)}" target="_blank" rel="noopener">Apri la chat</a></p>` : '')
    + (r.sintesi ? `<p class="text">${esc(r.sintesi)}</p>` : '')
    + sec('Fatto', asList(r.fatto)) + sec('Decisioni rapide', asList(r.decisioni)) + sec('Da sapere', asList(r.da_sapere)) + sec('Problemi', asList(r.problemi))
    + (dubbi.length ? `<div class="dubbi"><h3>Dubbi (quando vuoi)</h3><ul>${dubbi.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '')
    + '</div>';
}

// Chiede i rapporti nuovi. manual = tasto "Aggiorna" o apertura della sezione: l'esito si mostra sempre.
async function checkRapporti(manual) {
  const s = getSettings();
  if (checkingRapporti || !navigator.onLine) return;
  if (!s.nkey) { if (manual) { rapStatus = 'Manca la chiave del centralino: apri le Impostazioni.'; renderRapporto(); } return; }
  checkingRapporti = true;
  try {
    const seen = lsGet('noteauto.rapSeen', '');
    const j = await nero(`/rapporti?n=${KEEP_RAPPORTI}${seen ? '&dopo=' + encodeURIComponent(seen) : ''}`, { method: 'GET' }, s);
    const nuovi = (j && j.ok && Array.isArray(j.rapporti)) ? j.rapporti : [];
    const firstRound = lsGet('noteauto.rapInit', '') !== '1'; // i rapporti già esistenti la prima volta non fanno avviso
    lsSet('noteauto.rapInit', '1');
    if (nuovi.length) {
      const ids = new Set(nuovi.map((r) => String(r.id)));
      lsSet('noteauto.rapporti', JSON.stringify([...nuovi, ...savedRapporti().filter((r) => !ids.has(String(r.id)))].slice(0, KEEP_RAPPORTI)));
      lsSet('noteauto.rapSeen', String(nuovi[0].id));
      if (!firstRound) { unread = true; stopRapportoWatch(); toast('Nero: rapporto pronto'); refreshFoot(); }
    }
    rapStatus = manual ? (nuovi.length ? (nuovi.length === 1 ? 'Un rapporto nuovo' : nuovi.length + ' rapporti nuovi') : 'Nessun rapporto nuovo') : '';
  } catch (e) {
    if (e.status === 401) rapStatus = 'Chiave del centralino non valida';
    else if (manual) rapStatus = 'Centralino non raggiungibile: ' + (e.message || e);
  } finally { checkingRapporti = false; renderRapporto(); }
}

// Dopo una consegna: un controllo ogni 15 s per 6 minuti, finché la pagina è aperta.
function startRapportoWatch() {
  watchUntil = Date.now() + WATCH_FOR_MS;
  clearInterval(watchTimer);
  watchTimer = setInterval(() => {
    if (Date.now() > watchUntil) { stopRapportoWatch(); return; }
    if (document.visibilityState === 'visible') checkRapporti(false);
  }, WATCH_EVERY_MS);
}
function stopRapportoWatch() { clearInterval(watchTimer); watchTimer = null; }

let shownRap = 0;
function renderRapporto() {
  if ($('panel').hidden || $('rapView').hidden) return;
  $('rapStatus').textContent = rapStatus;
  const all = savedRapporti();
  if (!all.length) { $('rapBody').innerHTML = `<div class="empty">${getSettings().nkey ? 'Nessun rapporto ancora. Dopo una consegna arriva da solo; oppure tocca Aggiorna.' : 'Nessun rapporto. Scrivi la chiave del centralino nelle Impostazioni.'}</div>`; $('rapList').innerHTML = ''; return; }
  if (shownRap >= all.length) shownRap = 0;
  $('rapBody').innerHTML = rapportoHtml(all[shownRap]);
  $('rapList').innerHTML = '<h3>Ultimi rapporti</h3>' + all.map((r, i) => {
    const sint = String(r.sintesi || '').replace(/\s+/g, ' ');
    return `<button class="rapitem${i === shownRap ? ' on' : ''}" data-i="${i}">${esc(r.lotto || r.chi || 'Rapporto')} · ${esc(sint.length > 90 ? sint.slice(0, 90) + '…' : sint)}</button>`;
  }).join('');
}

// Lettura ad alta voce solo dal tasto; un secondo tocco la ferma.
function toggleSpeech() {
  const synth = window.speechSynthesis;
  if (!synth) { toast('Questo telefono non sa leggere ad alta voce.'); return; }
  if (synth.speaking || synth.pending) { synth.cancel(); $('rapRead').textContent = "Leggi l'ultimo rapporto"; return; }
  const all = savedRapporti();
  if (!all.length) { toast('Nessun rapporto da leggere.'); return; }
  const u = new SpeechSynthesisUtterance(testoDaLeggere(all[0]));
  u.lang = 'it-IT';
  const v = synth.getVoices().find((x) => /^it/i.test(x.lang));
  if (v) u.voice = v;
  u.onend = u.onerror = () => { $('rapRead').textContent = "Leggi l'ultimo rapporto"; };
  $('rapRead').textContent = 'Ferma la lettura';
  synth.speak(u);
}
function stopSpeech() { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {} const b = $('rapRead'); if (b) b.textContent = "Leggi l'ultimo rapporto"; }

// ---------- pannello note ----------
function openPanel() {
  $('panel').hidden = false; $('rec').hidden = true;
  showTab('notes');
}
function closePanel() {
  $('panel').hidden = true; $('rec').hidden = false;
  document.querySelectorAll('#list audio').forEach((a) => a.pause());
  stopSpeech();
  showScreen('idle');
}
function showTab(t) {
  $('tabNotes').classList.toggle('on', t === 'notes');
  $('tabRap').classList.toggle('on', t === 'rapporto');
  $('tabSettings').classList.toggle('on', t === 'settings');
  $('notesView').hidden = t !== 'notes';
  $('rapView').hidden = t !== 'rapporto';
  $('settingsView').hidden = t !== 'settings';
  $('panel').querySelector('h1').textContent = t === 'notes' ? 'Note' : t === 'rapporto' ? 'Rapporto' : 'Impostazioni';
  if (t !== 'rapporto') stopSpeech();
  if (t === 'notes') renderList();
  else if (t === 'rapporto') { unread = false; refreshFoot(); renderRapporto(); checkRapporti(true); }
  else loadSettingsForm();
}

function noteLabel(n) {
  if (n.status === 'done' && n.toSend) return n.sent ? ['consegnata', 'done'] : ['pronta, da consegnare', 'pending'];
  return ({ pending: ['in attesa di trascrizione', 'pending'], done: ['pronta', 'done'], error: ['errore', 'error'], recording: ['in registrazione', 'pending'] })[n.status] || [n.status, ''];
}

let exportCache = null;
async function renderList() {
  buildExport().then((x) => { exportCache = x; }).catch(() => {});
  const notes = (await allNotes()).filter((n) => n.status !== 'recording').sort((a, b) => b.id - a.id);
  const sent = notes.filter((n) => n.sent).length;
  $('summary').textContent = notes.length ? `${notes.length} note · ${sent} consegnate · ${notes.length - sent} in attesa o senza parlato` : '';
  if (!notes.length) { $('list').innerHTML = '<div class="empty">Nessuna nota. Torna al registratore e tocca lo schermo per registrare.</div>'; return; }
  $('list').innerHTML = notes.map((n) => {
    const [lab, cls] = noteLabel(n);
    const body = n.status === 'done' ? n.text : (n.raw && n.raw.trim() ? n.raw : '');
    return `<div class="note" data-id="${n.id}">
      <div class="meta"><span>${fmtDate(n.created)} · ${fmtDur(n.dur || 0)}</span><span class="badge ${cls}">${lab}</span></div>
      ${body ? `<div class="text">${esc(body)}</div>` : ''}
      ${n.error ? `<div class="err">${esc(n.error)}</div>` : ''}
      <div class="row">
        <button class="small" data-act="play">▶ Ascolta</button>
        ${n.status === 'done' ? '' : '<button class="small" data-act="redo">Riprova</button>'}
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
    await updateNote(id, { status: 'pending', nextTry: 0, tries: 0, error: '', raw: '' });
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
  for (const n of notes) {
    out += `## ${fmtDate(n.created)} (${fmtDur(n.dur || 0)})\n\n`;
    out += n.status === 'done' ? `${n.text}\n\n` : `(audio non ancora trascritto)\n\n`;
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
  $('key').value = s.key; $('vocab').value = s.vocab; $('sttModel').value = s.sttModel;
  $('centralino').value = s.centralino; $('nkey').value = s.nkey;
}
function readSettingsForm() {
  const s = getSettings();
  s.key = $('key').value.trim(); s.vocab = $('vocab').value; s.sttModel = $('sttModel').value.trim() || DEFAULTS.sttModel;
  s.centralino = $('centralino').value.trim() || DEFAULTS.centralino; s.nkey = $('nkey').value.trim();
  return s;
}
async function onSaveSettings() {
  const before = getSettings();
  const s = readSettingsForm();
  if (!saveSettings(s)) { toast('Salvataggio non riuscito.'); return; }
  if (s.key && s.key !== before.key) { // chiave nuova: riprova le note bloccate per chiave non valida
    for (const n of await allNotes()) if (n.status === 'error' && /Chiave/.test(n.error)) await updateNote(n.id, { status: 'pending', error: '', tries: 0, nextTry: 0 });
  }
  if (s.nkey !== before.nkey || s.centralino !== before.centralino) nkeyBad = false;
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
async function onTestCentralino() {
  const s = readSettingsForm();
  if (!s.nkey) { toast('Scrivi prima la chiave del centralino.'); return; }
  toast('Verifico…');
  try { await nero('/rapporti?n=1', { method: 'GET' }, s); toast('Centralino ✓'); }
  catch (e) { toast(e.status === 401 ? 'Chiave del centralino non valida.' : 'Verifica non riuscita: ' + e.message); }
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
  $('tabRap').onclick = () => showTab('rapporto');
  $('tabSettings').onclick = () => showTab('settings');
  $('rapRefresh').onclick = () => { rapStatus = 'Controllo…'; renderRapporto(); checkRapporti(true); };
  $('rapRead').onclick = toggleSpeech;
  $('rapList').addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) { shownRap = Number(b.dataset.i); renderRapporto(); } });
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
  $('testCentralino').onclick = onTestCentralino;
  $('resetModel').onclick = () => { $('sttModel').value = DEFAULTS.sttModel; toast('Modello predefinito ripristinato: premi Salva.'); };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (state === 'recording') stopRecording({ reason: 'interrupted' }); }
    else { keepAwake(); refreshFoot(); processQueue(); checkRapporti(false); }
  });
  window.addEventListener('online', () => processQueue(true));
  window.addEventListener('offline', refreshFoot);
  setInterval(() => { if (document.visibilityState === 'visible' && state !== 'recording') processQueue(); }, 60000);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  keepAwake();
  showScreen('idle');
  recoverOrphans().then(() => { refreshFoot(); processQueue(); checkRapporti(false); });
}

// Nel browser parte subito; sotto Node (prove) si esportano solo le funzioni pure.
if (typeof document !== 'undefined') init();
else module.exports = { formatLotto, testoDaLeggere, rapportoHtml, safeUrl, asList, toDeliver, HALLUCINATIONS };
