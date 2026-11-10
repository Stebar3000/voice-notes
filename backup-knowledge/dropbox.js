// Dropbox: autorizzazione una volta (PKCE, codice incollato, come l'app Android) e scrittura dei file.
import { asciiJson } from './core.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let access = { token: '', exp: 0 };

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function startAuth(appKey) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  await chrome.storage.local.set({ dbxAppKey: appKey.trim(), dbxVerifier: verifier });
  return 'https://www.dropbox.com/oauth2/authorize?client_id=' + encodeURIComponent(appKey.trim())
    + '&response_type=code&token_access_type=offline&code_challenge_method=S256&code_challenge=' + b64url(digest);
}

async function tokenCall(form) {
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  let j = {};
  try { j = JSON.parse(text); } catch {}
  if (!res.ok) { const e = new Error(`Dropbox ${res.status}: ${j.error_description || j.error || text.slice(0, 200)}`); e.status = res.status; throw e; }
  return j;
}

export async function finishAuth(code) {
  const { dbxAppKey, dbxVerifier } = await chrome.storage.local.get(['dbxAppKey', 'dbxVerifier']);
  if (!dbxAppKey || !dbxVerifier) throw new Error('premi prima "Autorizza"');
  const j = await tokenCall({ code: code.trim(), grant_type: 'authorization_code', client_id: dbxAppKey, code_verifier: dbxVerifier });
  if (!j.refresh_token) throw new Error('Dropbox non ha restituito l\'autorizzazione permanente');
  await chrome.storage.local.set({ dbxRefresh: j.refresh_token });
  await chrome.storage.local.remove('dbxVerifier');
  access = { token: j.access_token || '', exp: Date.now() + (j.expires_in || 14400) * 1000 };
}

export async function isConnected() {
  const { dbxAppKey, dbxRefresh } = await chrome.storage.local.get(['dbxAppKey', 'dbxRefresh']);
  return !!(dbxAppKey && dbxRefresh);
}

async function token(force) {
  if (!force && access.token && Date.now() < access.exp - 60e3) return access.token;
  const { dbxAppKey, dbxRefresh } = await chrome.storage.local.get(['dbxAppKey', 'dbxRefresh']);
  if (!dbxAppKey || !dbxRefresh) { const e = new Error('Dropbox non collegato'); e.code = 'DBX'; throw e; }
  try {
    const j = await tokenCall({ grant_type: 'refresh_token', refresh_token: dbxRefresh, client_id: dbxAppKey });
    access = { token: j.access_token || '', exp: Date.now() + (j.expires_in || 14400) * 1000 };
  } catch (e) {
    if (e.status === 400 || e.status === 401) { const x = new Error('autorizzazione Dropbox scaduta o revocata: collega di nuovo'); x.code = 'DBX'; throw x; }
    throw e;
  }
  return access.token;
}

// Scrive (o sovrascrive) un file di testo. Riprova da sola su errori passeggeri.
export async function upload(path, data) {
  const body = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let force = false;
  for (let i = 0; i < 5; i++) {
    let res;
    try {
      res = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + await token(force),
          'Dropbox-API-Arg': asciiJson({ path, mode: 'overwrite', autorename: false, mute: true }),
          'Content-Type': 'application/octet-stream',
        },
        body,
      });
    } catch (e) {
      if (e.code === 'DBX') throw e;
      if (i === 4) throw new Error('rete verso Dropbox: ' + e.message);
      await sleep(1500 * 2 ** i);
      continue;
    }
    if (res.ok) return res.json();
    const text2 = await res.text();
    if (res.status === 401 && text2.includes('missing_scope')) { const e = new Error('Dropbox: permessi mancanti. Premi "Ricollega Dropbox" e rifai Autorizza e Collega'); e.code = 'DBX'; throw e; }
    if (res.status === 401 && !force) { force = true; continue; }
    if ((res.status === 429 || res.status >= 500) && i < 4) {
      const ra = Number(res.headers.get('Retry-After'));
      await sleep(ra > 0 ? Math.min(ra, 60) * 1000 : 1500 * 2 ** i);
      continue;
    }
    throw new Error(`Dropbox ${res.status} su ${path}: ${text2.slice(0, 300)}`);
  }
  throw new Error('Dropbox non risponde su ' + path);
}

// Toglie un file (finisce nei "File eliminati" di Dropbox, recuperabile). Un file già assente non è un errore.
export async function remove(path) {
  for (let i = 0; i < 4; i++) {
    let res;
    try {
      res = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + await token(i > 0), 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
    } catch (e) {
      if (e.code === 'DBX') throw e;
      if (i === 3) throw new Error('rete verso Dropbox: ' + e.message);
      await sleep(1500 * 2 ** i);
      continue;
    }
    if (res.ok) return true;
    const t = await res.text();
    if (res.status === 409 && t.includes('not_found')) return true;
    if ((res.status === 429 || res.status >= 500 || res.status === 401) && i < 3) { await sleep(1500 * 2 ** i); continue; }
    throw new Error(`Dropbox ${res.status} cancellando ${path}: ${t.slice(0, 300)}`);
  }
  throw new Error('Dropbox non risponde cancellando ' + path);
}

// Chiamate "RPC" di Dropbox (JSON in, JSON out) con nuovi tentativi sugli errori passeggeri.
async function rpc(endpoint, args) {
  for (let i = 0; i < 4; i++) {
    let res;
    try {
      res = await fetch('https://api.dropboxapi.com/2/' + endpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + await token(i > 0), 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
    } catch (e) {
      if (e.code === 'DBX') throw e;
      if (i === 3) throw new Error('rete verso Dropbox: ' + e.message);
      await sleep(1500 * 2 ** i);
      continue;
    }
    const t = await res.text();
    if (res.ok) return JSON.parse(t);
    if (res.status === 401 && t.includes('missing_scope')) { const e = new Error('Dropbox: permessi mancanti. Premi "Ricollega Dropbox" e rifai Autorizza e Collega'); e.code = 'DBX'; throw e; }
    if (res.status === 409) { const e = new Error(`Dropbox ${endpoint}: ${t.slice(0, 300)}`); e.status = 409; e.body = t; throw e; }
    if ((res.status === 429 || res.status >= 500 || res.status === 401) && i < 3) { await sleep(1500 * 2 ** i); continue; }
    throw new Error(`Dropbox ${res.status} ${endpoint}: ${t.slice(0, 300)}`);
  }
  throw new Error('Dropbox non risponde: ' + endpoint);
}

// Elenco completo (ricorsivo) di una cartella: [{path, rel, h, size, modified}] per i file. null se la cartella non esiste.
export async function listAll(root) {
  let r;
  try { r = await rpc('files/list_folder', { path: root, recursive: true, include_deleted: false, limit: 2000 }); }
  catch (e) { if (e.status === 409 && e.body && e.body.includes('not_found')) return null; throw e; }
  const entries = [...r.entries];
  while (r.has_more) { r = await rpc('files/list_folder/continue', { cursor: r.cursor }); entries.push(...r.entries); }
  const base = root.toLowerCase().replace(/\/+$/, '') + '/';
  return entries.filter((e) => e['.tag'] === 'file').map((e) => ({
    path: e.path_display, rel: e.path_display.slice(base.length), h: e.content_hash, size: e.size, modified: e.server_modified,
  })).filter((e) => e.path.toLowerCase().startsWith(base));
}

// Sottocartelle dirette (nomi) di una cartella; [] se non esiste.
export async function listDirs(root) {
  let r;
  try { r = await rpc('files/list_folder', { path: root, recursive: false, limit: 2000 }); }
  catch (e) { if (e.status === 409 && e.body && e.body.includes('not_found')) return []; throw e; }
  const entries = [...r.entries];
  while (r.has_more) { r = await rpc('files/list_folder/continue', { cursor: r.cursor }); entries.push(...r.entries); }
  return entries.filter((e) => e['.tag'] === 'folder').map((e) => e.name);
}

// Cursore per sapere cosa cambia sotto una cartella (ricorsivo).
export async function latestCursor(root) {
  try { return (await rpc('files/list_folder/get_latest_cursor', { path: root, recursive: true })).cursor; }
  catch (e) { if (e.status === 409 && e.body && e.body.includes('not_found')) return null; throw e; }
}
// Novità dal cursore: {changed: numero di voci, cursor}. reset=true se il cursore non vale più.
export async function changesSince(cursor) {
  let n = 0, r;
  try { r = await rpc('files/list_folder/continue', { cursor }); }
  catch (e) { if (e.status === 409) return { reset: true }; throw e; }
  n += r.entries.length;
  while (r.has_more) { r = await rpc('files/list_folder/continue', { cursor: r.cursor }); n += r.entries.length; }
  return { changed: n, cursor: r.cursor };
}

// Cambiamenti dal cursore con i percorsi: {entries: [{tag, path}], cursor}. reset=true se il cursore non vale più.
export async function changedEntries(cursor) {
  const out = [];
  let r;
  try { r = await rpc('files/list_folder/continue', { cursor }); }
  catch (e) { if (e.status === 409) return { reset: true }; throw e; }
  const push = (es) => es.forEach((e) => out.push({ tag: e['.tag'], path: String(e.path_lower || '').toLowerCase() }));
  push(r.entries);
  while (r.has_more) { r = await rpc('files/list_folder/continue', { cursor: r.cursor }); push(r.entries); }
  return { entries: out, cursor: r.cursor };
}

// Scarica un file come byte. null se non esiste.
export async function download(path) {
  for (let i = 0; i < 4; i++) {
    let res;
    try {
      res = await fetch('https://content.dropboxapi.com/2/files/download', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + await token(i > 0), 'Dropbox-API-Arg': asciiJson({ path }) },
      });
    } catch (e) {
      if (e.code === 'DBX') throw e;
      if (i === 3) throw new Error('rete verso Dropbox: ' + e.message);
      await sleep(1500 * 2 ** i);
      continue;
    }
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    const t = await res.text();
    if (res.status === 409 && t.includes('not_found')) return null;
    if (res.status === 401 && t.includes('missing_scope')) { const e = new Error('Dropbox: permessi mancanti. Premi "Ricollega Dropbox" e rifai Autorizza e Collega'); e.code = 'DBX'; throw e; }
    if ((res.status === 429 || res.status >= 500 || res.status === 401) && i < 3) { await sleep(1500 * 2 ** i); continue; }
    throw new Error(`Dropbox ${res.status} scaricando ${path}: ${t.slice(0, 300)}`);
  }
  throw new Error('Dropbox non risponde scaricando ' + path);
}
