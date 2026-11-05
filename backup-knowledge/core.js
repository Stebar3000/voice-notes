// Funzioni pure (niente Chrome, niente rete): si provano in Node con `node --test`.

export const ROOT = '/Projects/LLM-Mirroring';
export const GUIDE = '_mirroring.json';
export const REPORT = '_resoconto.txt';
export const INSTR = '_istruzioni-progetto.md';
export const ORIG = 'Originali';
export const MAX_DOC = 1000000;            // un documento della knowledge non può superare 1 MB

// Caratteri che Windows non accetta nei nomi: li sostituiamo con "_".
const UNSAFE = /[\\:*?"<>|\x00-\x1f]/g;

// Estensioni che sono testo: solo questi file passano nel mirroring.
const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'text', 'json', 'csv', 'tsv', 'js', 'mjs', 'ts', 'py', 'html', 'htm', 'xml',
  'yml', 'yaml', 'sql', 'css', 'log', 'ini', 'toml', 'sh', 'bat', 'ps1', 'java', 'c', 'h', 'cpp', 'rs',
  'go', 'rb', 'php', 'tex', 'rtf', 'srt', 'vtt', 'gs',
]);

export function extOf(name) {
  const last = String(name).split('/').pop();
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : '';
}
export const isText = (name) => TEXT_EXT.has(extOf(name));

export function safeSegment(s) {
  let out = String(s == null ? '' : s).replace(UNSAFE, '_').trim();
  out = out.replace(/[. ]+$/, '');          // Windows non vuole punto o spazio finali
  if (out === '' || out === '.' || out === '..') out = '_';
  return out;
}

// Nome di un documento della knowledge -> percorso relativo su Dropbox (cartelle vere, pezzi ripuliti).
// Un nome senza estensione di testo (es. un vecchio .docx caricato) riceve ".txt" per non creare un falso Word.
export function safeRelPath(name, fallback = 'documento') {
  const parts = String(name == null ? '' : name).split('/').map((p) => p.trim()).filter((p) => p !== '');
  if (!parts.length) parts.push(fallback);
  const clean = parts.map(safeSegment);
  if (!isText(clean[clean.length - 1])) clean[clean.length - 1] += '.txt';
  return clean.join('/');
}

// Percorsi riservati nella cartella del progetto: il mirroring non li tocca mai.
export function isReserved(rel) {
  const r = rel.toLowerCase();
  return r === GUIDE.toLowerCase() || r === REPORT.toLowerCase() || r === INSTR.toLowerCase()
    || r === ORIG.toLowerCase() || r.startsWith(ORIG.toLowerCase() + '/');
}

// Impronta di Dropbox (content_hash): SHA-256 dei blocchi da 4 MB, concatenati e di nuovo SHA-256.
// Permette di confrontare un testo della knowledge con un file Dropbox senza scaricarlo.
export async function dbxHash(bytes) {
  const subtle = globalThis.crypto.subtle;
  const B = 4 * 1024 * 1024;
  const parts = [];
  for (let i = 0; i < bytes.length || (i === 0 && bytes.length === 0); i += B) {
    parts.push(new Uint8Array(await subtle.digest('SHA-256', bytes.subarray(i, i + B))));
    if (bytes.length === 0) break;
  }
  const all = new Uint8Array(parts.length * 32);
  parts.forEach((p, k) => all.set(p, k * 32));
  return Array.from(new Uint8Array(await subtle.digest('SHA-256', all)), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Assegna a ogni documento della knowledge il suo percorso su Dropbox: quello già registrato nel file guida
// oppure uno nuovo, ripulito e senza collisioni (Dropbox non distingue maiuscole e minuscole).
export function mapDocs(docs, state) {
  const byName = new Map(Object.entries(state || {}).map(([rel, s]) => [s.nome, rel]));
  const taken = new Set();
  const out = [];
  const fresh = [];
  for (const d of docs) {
    const rel = byName.get(d.name);
    if (rel && !taken.has(rel.toLowerCase())) { taken.add(rel.toLowerCase()); out.push({ ...d, rel }); } else fresh.push(d);
  }
  for (const d of fresh) {
    const base = safeRelPath(d.name);
    let rel = base, i = 2;
    while (taken.has(rel.toLowerCase())) {
      const slash = base.lastIndexOf('/'), dot = base.lastIndexOf('.');
      rel = dot > slash + 1 ? `${base.slice(0, dot)}-${i}${base.slice(dot)}` : `${base}-${i}`;
      i++;
    }
    taken.add(rel.toLowerCase());
    out.push({ ...d, rel });
  }
  return out;
}

// Il cuore del mirroring: dato lo stato dell'ultimo allineamento (file guida) e i due lati di oggi, decide cosa fare.
// kItems: [{rel, name, uuid, h, size}] (knowledge) · dItems: [{rel, h, size}] (Dropbox, solo testo, niente riservati)
// state: {rel: {nome, h}}. Restituisce le operazioni e gli eventuali blocchi di sicurezza.
export function planSync(kItems, dItems, state, { allowBig = false } = {}) {
  const S = new Map(Object.entries(state || {}).map(([rel, s]) => [rel.toLowerCase(), { rel, ...s }]));
  const K = new Map(kItems.map((k) => [k.rel.toLowerCase(), k]));
  const D = new Map(dItems.map((d) => [d.rel.toLowerCase(), d]));
  const keys = new Set([...S.keys(), ...K.keys(), ...D.keys()]);
  const ops = [];
  const problems = [];
  for (const key of keys) {
    const s = S.get(key), k = K.get(key), d = D.get(key);
    if (k && d) {
      if (k.h === d.h) { ops.push({ op: 'same', rel: k.rel, name: k.name, h: k.h }); continue; }
      const kCh = !s || k.h !== s.h, dCh = !s || d.h !== s.h;
      if (kCh && dCh) ops.push({ op: 'up', rel: k.rel, name: k.name, uuid: k.uuid, conflict: true });
      else if (kCh) ops.push({ op: 'up', rel: k.rel, name: k.name, uuid: k.uuid });
      else ops.push({ op: 'down', rel: d.rel, name: k.name, oldUuid: k.uuid, h: d.h, size: d.size });
    } else if (k) {
      if (s && k.h === s.h) ops.push({ op: 'delK', rel: k.rel, name: k.name, uuid: k.uuid });   // cancellato su Dropbox
      else ops.push({ op: 'up', rel: k.rel, name: k.name, uuid: k.uuid, conflict: !!s });      // nuovo (o modificato e cancellato altrove: vince la knowledge)
    } else if (d) {
      if (s) ops.push({ op: 'delD', rel: d.rel, conflict: d.h !== s.h });                        // cancellato nella knowledge (vince la knowledge)
      else ops.push({ op: 'down', rel: d.rel, name: d.rel, h: d.h, size: d.size });               // nuovo su Dropbox
    } else {
      ops.push({ op: 'gone', rel: s.rel });                                                       // sparito da entrambe le parti
    }
  }
  // protezioni sulle cancellazioni
  const stateCount = S.size;
  const delK = ops.filter((o) => o.op === 'delK').length;
  const delD = ops.filter((o) => o.op === 'delD').length;
  let blockDeletes = false;
  if (stateCount > 0 && kItems.length === 0) { blockDeletes = true; problems.push(`la knowledge risulta vuota (prima c'erano ${stateCount} file): nessuna cancellazione`); }
  if (stateCount > 0 && dItems.length === 0) { blockDeletes = true; problems.push(`la cartella Dropbox risulta vuota (prima c'erano ${stateCount} file): nessuna cancellazione`); }
  if (!blockDeletes && !allowBig && (delK * 2 > stateCount || delD * 2 > stateCount) && (delK + delD) > 0) {
    blockDeletes = true;
    problems.push(`andrebbero cancellati ${delK} documenti nella knowledge e ${delD} file su Dropbox su ${stateCount}: bloccato per sicurezza. Se è voluto, premi "Consenti la prossima pulizia grande"`);
  }
  if (blockDeletes) {
    for (const o of ops) if (o.op === 'delK' || o.op === 'delD') o.op = 'keep';
    // se un lato è vuoto non si scrive nulla nemmeno verso l'altro: qualcosa non va
    if ((stateCount > 0 && kItems.length === 0) || (stateCount > 0 && dItems.length === 0)) {
      for (const o of ops) if (o.op === 'up' || o.op === 'down') o.op = 'keep';
    }
  }
  return { ops, problems };
}

// Le intestazioni HTTP devono essere ASCII: i caratteri accentati diventano sequenze di escape JSON.
export function asciiJson(obj) {
  return JSON.stringify(obj).replace(/[^ -~]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function two(n) { return String(n).padStart(2, '0'); }
export function stamp(ms) {
  const d = new Date(ms);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
