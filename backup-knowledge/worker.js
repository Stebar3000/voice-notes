// Cuore dell'estensione: mirroring a due vie tra la knowledge dei progetti claude.ai e /Projects/LLM-Mirroring/<Progetto>/.
import { ROOT, GUIDE, REPORT, INSTR, MAX_DOC, isText, isIgnored, isReserved, safeSegment, mapDocs, planSync, dbxHash, stamp } from './core.js';
import { pageListProjects, pageReadProject, pageAddDoc, pageDeleteDocById, pageSendMessage } from './claude.js';
import * as dbx from './dropbox.js';

const MIRROR_MIN = 15;                    // giro completo (anche per le modifiche fatte nella knowledge)
const PENDING_MS = 3600e3;                // un PDF/Word/Excel non ancora convertito dopo 1 ora diventa un problema
const NOTIFY_EVERY_MS = 12 * 3600e3;      // al massimo un avviso sul desktop ogni 12 ore
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = chrome.storage.local;
const enc = (s) => new TextEncoder().encode(s);

// ---------- icona (disegnata nel codice: l'estensione è fatta solo di file di testo) ----------
function drawIcon(size) {
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = '#2563eb';
  g.beginPath(); g.roundRect(0, 0, size, size, size / 6); g.fill();
  g.fillStyle = '#fff';
  const m = size / 5;
  g.fillRect(m, size / 4, size - 2 * m, size / 10);
  g.fillRect(m + size / 20, size / 4 + size / 8, size - 2 * m - size / 10, size / 2.2);
  g.fillStyle = '#2563eb';
  g.fillRect(size / 2 - size / 10, size / 4 + size / 5, size / 5, size / 14);
  return c;
}
async function setupIcon() {
  try {
    const imageData = {};
    for (const s of [16, 32]) imageData[s] = drawIcon(s).getContext('2d').getImageData(0, 0, s, s);
    await chrome.action.setIcon({ imageData });
  } catch {}
}
async function iconDataUrl() {
  const b = new Uint8Array(await (await drawIcon(128).convertToBlob({ type: 'image/png' })).arrayBuffer());
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return 'data:image/png;base64,' + btoa(s);
}
setupIcon();

// ---------- timer ----------
async function ensureAlarms() {
  if (!(await chrome.alarms.get('mirror'))) chrome.alarms.create('mirror', { delayInMinutes: 1, periodInMinutes: MIRROR_MIN });
  if (!(await chrome.alarms.get('cursor'))) chrome.alarms.create('cursor', { delayInMinutes: 1, periodInMinutes: 1 });
  if (await chrome.alarms.get('check')) chrome.alarms.clear('check');     // timer della vecchia versione (backup)
}
chrome.runtime.onInstalled.addListener(() => { ensureAlarms(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarms(); setupIcon(); setTimeout(() => runMirror('avvio di Chrome'), 60e3); });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'mirror') runMirror('timer');
  if (a.name === 'cursor') checkCursor();
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
ensureAlarms();

// Ogni minuto: c'è qualcosa di nuovo sotto /Projects/LLM-Mirroring? Se sì, giro subito.
async function checkCursor() {
  try {
    if (!(await dbx.isConnected()) || running) return;
    if (Date.now() - lastRunAt < 30e3) return;                     // appena fatto un giro: il cursore resta dov'è e riprova al prossimo minuto
    const { cursor } = await store.get('cursor');
    if (!cursor) { const c = await dbx.latestCursor(ROOT); if (c) await store.set({ cursor: c }); return; }
    const r = await dbx.changesSince(cursor);
    if (r.reset) { await store.set({ cursor: await dbx.latestCursor(ROOT) }); runMirror('cambio su Dropbox'); return; }
    await store.set({ cursor: r.cursor });
    if (r.changed > 0) runMirror('cambio su Dropbox');
  } catch { /* il giro completo ogni 15 minuti recupera comunque */ }
}

// ---------- scheda claude.ai ----------
async function waitComplete(tabId, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const t = await chrome.tabs.get(tabId); if (t.status === 'complete') return true; } catch { return false; }
    await sleep(500);
  }
  return false;
}
async function tryTab(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => location.host });
    return r && r.result === 'claude.ai';
  } catch { return false; }
}
async function claudeTab() {
  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  for (const t of tabs) if (!t.discarded && t.status === 'complete' && await tryTab(t.id)) return { tabId: t.id, created: false };
  let t;
  try { t = await chrome.tabs.create({ url: 'https://claude.ai/projects', active: false }); }
  catch { t = (await chrome.windows.create({ url: 'https://claude.ai/projects', focused: false, state: 'minimized' })).tabs[0]; }
  await waitComplete(t.id, 45e3);
  await sleep(1500);
  if (!(await tryTab(t.id))) { try { await chrome.tabs.remove(t.id); } catch {} throw new Error('impossibile aprire claude.ai'); }
  return { tabId: t.id, created: true };
}
async function inPage(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r ? r.result : null;
}
const loginError = () => Object.assign(new Error('sessione claude.ai non attiva: entra in claude.ai in questo Chrome'), { code: 'LOGIN' });

// ---------- progetti nel mirroring: quelli che hanno il file guida ----------
async function discover() {
  const out = [];
  for (const dir of await dbx.listDirs(ROOT)) {
    const bytes = await dbx.download(`${ROOT}/${dir}/${GUIDE}`);
    if (!bytes) { out.push({ dir, guide: null }); continue; }
    try { out.push({ dir, guide: JSON.parse(new TextDecoder().decode(bytes)) }); }
    catch { out.push({ dir, guide: null, broken: true }); }
  }
  return out;
}

// Legge la knowledge di un progetto e calcola le impronte (le stesse di Dropbox).
async function readKnowledge(tabId, orgId, pid) {
  const data = await inPage(tabId, pageReadProject, [orgId, pid]);
  if (!data || !data.ok) {
    if (data && data.code === 'LOGIN') throw loginError();
    throw new Error('lettura del progetto non riuscita: ' + (data ? data.error : 'nessuna risposta'));
  }
  const missing = data.docs.filter((d) => d.content == null).map((d) => d.file_name);
  if (missing.length) throw new Error('claude.ai non ha fornito il contenuto di: ' + missing.join(', ') + ' (nessuna modifica fatta)');
  const docs = [];
  for (const d of data.docs) {
    const bytes = enc(d.content);
    docs.push({ name: d.file_name, uuid: d.uuid, bytes, size: bytes.length, h: await dbxHash(bytes) });
  }
  return { data, docs };
}

function sortObj(o) { return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))); }

// ---------- scritture del giro in corso (per distinguerle dai cambiamenti fatti da altri nel frattempo) ----------
let ownWrites = new Set();
const upW = (path, data) => { ownWrites.add(path.toLowerCase()); return dbx.upload(path, data); };
const rmW = (path) => { ownWrites.add(path.toLowerCase()); return dbx.remove(path); };

// ---------- un giro di mirroring su un progetto ----------
async function syncProject(tabId, dir, guide, allowBig) {
  const root = `${ROOT}/${dir}`;
  const org = guide.progetto.orgId, pid = guide.progetto.uuid;
  const pr = { name: guide.progetto.nome || dir, changes: [], problems: [], pending: [] };
  const { data, docs } = await readKnowledge(tabId, org, pid);
  pr.name = data.name || pr.name;
  const dupNames = docs.map((d) => d.name).filter((n, i, a) => a.indexOf(n) !== i);
  if (dupNames.length) pr.problems.push('nella knowledge ci sono documenti con lo stesso nome: ' + [...new Set(dupNames)].join(', '));
  const state = guide.file || {};
  const kItems = mapDocs(docs, state);
  const all = await dbx.listAll(root);
  if (all === null) throw new Error(`la cartella ${root} non esiste più`);
  const dItems = [];
  const now = Date.now();
  for (const f of all) {
    if (isReserved(f.rel) || isIgnored(f.rel)) continue;
    if (isText(f.rel)) { dItems.push(f); continue; }
    if (now - Date.parse(f.modified || 0) > PENDING_MS) pr.problems.push(`file non di testo non convertito da più di un'ora: ${f.rel}`);
    else pr.pending.push(f.rel);
  }
  const { ops, problems } = planSync(kItems, dItems, state, { allowBig });
  pr.problems.push(...problems);
  const K = new Map(kItems.map((k) => [k.rel.toLowerCase(), k]));
  const next = { ...state };
  const delS = (rel) => { for (const r of Object.keys(next)) if (r.toLowerCase() === rel.toLowerCase()) delete next[r]; };
  const setS = (rel, nome, h) => { delS(rel); next[rel] = { nome, h }; };
  const order = { same: 0, up: 1, down: 1, delK: 2, delD: 2, gone: 3, keep: 3 };     // prima le scritture, poi le cancellazioni
  ops.sort((a, b) => order[a.op] - order[b.op]);
  for (const o of ops) {
    try {
      if (o.op === 'same') setS(o.rel, o.name, o.h);
      else if (o.op === 'gone') delS(o.rel);
      else if (o.op === 'up') {
        const k = K.get(o.rel.toLowerCase());
        const meta = await upW(`${root}/${o.rel}`, k.bytes);
        if (meta && meta.content_hash && meta.content_hash !== k.h) pr.problems.push(`impronta diversa dopo la scrittura di ${o.rel}`);
        setS(o.rel, k.name, k.h);
        pr.changes.push({ file: o.rel, tipo: state[o.rel] ? 'modificato' : 'nuovo', verso: 'dropbox', ...(o.conflict ? { conflitto: true } : {}) });
      } else if (o.op === 'down') {
        if (o.size > MAX_DOC) { pr.problems.push(`${o.rel} supera 1 MB: non copiato nella knowledge`); continue; }
        const bytes = await dbx.download(`${root}/${o.rel}`);
        if (!bytes) continue;                                     // sparito nel frattempo: il prossimo giro lo vede
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
        catch { pr.problems.push(`${o.rel} non è testo UTF-8: non copiato`); continue; }
        const h = await dbxHash(enc(text));
        const add = await inPage(tabId, pageAddDoc, [org, pid, o.name, text]);
        if (!add || !add.ok) {
          if (add && add.code === 'LOGIN') throw loginError();
          pr.problems.push(`${o.rel}: scrittura nella knowledge non riuscita (${add ? add.error : 'nessuna risposta'})`);
          continue;
        }
        if (o.oldUuid) {
          const del = await inPage(tabId, pageDeleteDocById, [org, pid, o.oldUuid]);
          if (!del || !del.ok) pr.problems.push(`${o.rel}: la versione vecchia nella knowledge non è stata tolta (${del ? del.error : 'nessuna risposta'})`);
        }
        setS(o.rel, o.name, h);
        pr.changes.push({ file: o.rel, tipo: o.oldUuid ? 'modificato' : 'nuovo', verso: 'knowledge' });
      } else if (o.op === 'delK') {
        const del = await inPage(tabId, pageDeleteDocById, [org, pid, o.uuid]);
        if (!del || !del.ok) {
          if (del && del.code === 'LOGIN') throw loginError();
          pr.problems.push(`${o.rel}: cancellazione nella knowledge non riuscita`);
          continue;
        }
        delS(o.rel);
        pr.changes.push({ file: o.rel, tipo: 'cancellato', verso: 'knowledge' });
      } else if (o.op === 'delD') {
        await rmW(`${root}/${o.rel}`);
        delS(o.rel);
        pr.changes.push({ file: o.rel, tipo: 'cancellato', verso: 'dropbox', ...(o.conflict ? { conflitto: true } : {}) });
      }
    } catch (e) {
      if (e.code === 'DBX' || e.code === 'LOGIN') throw e;
      pr.problems.push(`${o.rel}: ${e.message || e}`);
    }
  }
  // istruzioni di progetto: solo dalla knowledge verso Dropbox
  let instrH = guide.istruzioni_h || '';
  const instr = data.instructions || '';
  const ih = instr ? await dbxHash(enc(instr)) : '';
  if (ih !== instrH) {
    try {
      if (instr) await upW(`${root}/${INSTR}`, instr); else await rmW(`${root}/${INSTR}`);
      instrH = ih;
      pr.changes.push({ file: INSTR, tipo: instr ? 'modificato' : 'cancellato', verso: 'dropbox' });
    } catch (e) { if (e.code === 'DBX') throw e; pr.problems.push('istruzioni di progetto: ' + (e.message || e)); }
  }
  // resoconto leggibile e file guida: si riscrivono solo se è cambiato qualcosa
  const stateChanged = JSON.stringify(sortObj(next)) !== JSON.stringify(sortObj(state));
  const problemsKey = pr.problems.join('\n');
  const { lastProblems = {} } = await store.get('lastProblems');
  const problemsChanged = (lastProblems[pid] || '') !== problemsKey;
  if (pr.changes.length || problemsChanged) {
    const lines = [`Mirroring del progetto "${pr.name}"`, `Ultimo giro con novità: ${stamp(now)}`];
    if (pr.changes.length) lines.push('Modifiche:', ...pr.changes.map((c) => `- ${c.file}: ${c.tipo} → ${c.verso}${c.conflitto ? ' (conflitto: ha vinto la knowledge)' : ''}`));
    if (pr.pending.length) lines.push('In attesa di conversione:', ...pr.pending.map((p) => '- ' + p));
    lines.push(pr.problems.length ? 'PROBLEMI:\n- ' + pr.problems.join('\n- ') : 'Nessun problema.');
    try { await upW(`${root}/${REPORT}`, lines.join('\n') + '\n'); } catch (e) { if (e.code === 'DBX') throw e; }
    lastProblems[pid] = problemsKey;
    await store.set({ lastProblems });
  }
  if (pr.changes.length || stateChanged) {
    const iso = new Date(now).toISOString();
    const g = { ...guide, progetto: { ...guide.progetto, nome: pr.name }, file: sortObj(next), istruzioni_h: instrH,
      aggiornato: iso, ultimo_giro: { quando: iso, modifiche: pr.changes } };
    await upW(`${root}/${GUIDE}`, JSON.stringify(g, null, 2) + '\n');      // per ultimo: è il punto di conferma
  }
  return pr;
}

// ---------- giro completo ----------
let running = null;
let lastRunAt = 0;
function runMirror(why) {
  if (running) return running;
  running = doMirror(why).finally(() => { running = null; lastRunAt = Date.now(); });
  return running;
}

async function doMirror(why) {
  const now = Date.now();
  const report = { at: now, why, ok: true, projects: [], error: '', ignored: [] };
  if (!(await dbx.isConnected())) return null;
  ownWrites = new Set();
  let c0 = null;                                                    // cursore all'inizio del giro
  try { c0 = await dbx.latestCursor(ROOT); } catch {}
  let tab = null;
  try {
    const found = await discover();
    report.ignored = found.filter((f) => !f.guide).map((f) => f.dir + (f.broken ? ' (file guida illeggibile)' : ''));
    const active = found.filter((f) => f.guide);
    if (!active.length && why !== 'pulsante') return null;          // niente da fare: nessun rumore
    await store.set({ lastTryAt: now });
    await setBadge('…', '#6b7280', 'Mirroring in corso');
    const { allowBigCleanup } = await store.get('allowBigCleanup');
    if (active.length) tab = await claudeTab();
    for (const f of active) {
      try { report.projects.push(await syncProject(tab.tabId, f.dir, f.guide, !!allowBigCleanup)); }
      catch (e) {
        if (e.code === 'DBX' || e.code === 'LOGIN') throw e;
        report.projects.push({ name: f.guide.progetto.nome || f.dir, changes: [], problems: [String(e.message || e)], pending: [] });
      }
    }
    if (report.projects.some((p) => p.problems.length)) report.ok = false;
  } catch (e) {
    report.ok = false;
    report.error = String(e.message || e);
  } finally {
    if (tab && tab.created) { try { await chrome.tabs.remove(tab.tabId); } catch {} }
  }
  // Le nostre scritture non fanno ripartire il giro; i cambiamenti fatti da altri durante il giro
  // (es. lo script Google che scrive un .md) sì: un nuovo giro tra pochi secondi invece che tra 15 minuti.
  let foreign = false;
  try {
    if (c0) {
      const r = await dbx.changedEntries(c0);
      if (!r.reset) {
        foreign = r.entries.some((e) => e.tag !== 'folder' && !ownWrites.has(e.path)
          && !isIgnored(e.path) && !e.path.includes('/originali/'));
      }
    }
    const c = await dbx.latestCursor(ROOT);
    if (c) await store.set({ cursor: c });
  } catch {}
  if (foreign) setTimeout(() => runMirror('cambio su Dropbox durante il giro'), 5e3);
  const upd = { lastReport: report, allowBigCleanup: false };
  if (report.ok) upd.lastOkAt = now;
  await store.set(upd);
  await showResult(report);
  return report;
}

// ---------- ingresso di un progetto nel mirroring ----------
async function insertProject(pid) {
  const tab = await claudeTab();
  try {
    const list = await inPage(tab.tabId, pageListProjects);
    if (!list || !list.ok) { if (list && list.code === 'LOGIN') throw loginError(); throw new Error('elenco dei progetti non disponibile'); }
    const p = list.projects.find((x) => x.uuid === pid);
    if (!p) throw new Error('progetto non trovato');
    const found = await discover();
    const already = found.find((f) => f.guide && f.guide.progetto && f.guide.progetto.uuid === pid);
    if (already) throw new Error(`il progetto è già nel mirroring (cartella "${already.dir}")`);
    const dir = safeSegment(p.name);
    const root = `${ROOT}/${dir}`;
    const existing = await dbx.listAll(root);
    if (existing && existing.length) throw new Error(`la cartella ${root} esiste già e non è vuota: svuotala o rinominala prima`);
    const { data, docs } = await readKnowledge(tab.tabId, p.orgId, pid);
    const items = mapDocs(docs, {});
    const file = {};
    for (const k of items) {
      const meta = await dbx.upload(`${root}/${k.rel}`, k.bytes);
      if (meta && meta.content_hash && meta.content_hash !== k.h) throw new Error(`impronta diversa dopo la scrittura di ${k.rel}`);
      file[k.rel] = { nome: k.name, h: k.h };
    }
    const instr = data.instructions || '';
    if (instr) await dbx.upload(`${root}/${INSTR}`, instr);
    const name = data.name || p.name;
    const at = new Date().toISOString();
    await dbx.upload(`${root}/${REPORT}`, `Mirroring del progetto "${name}"\nInserito il ${stamp(Date.now())}: ${items.length} documenti copiati dalla knowledge.\n`);
    const guide = {
      versione: 1,
      progetto: { uuid: pid, orgId: p.orgId, nome: name },
      file: sortObj(file),
      istruzioni_h: instr ? await dbxHash(enc(instr)) : '',
      aggiornato: at,
      ultimo_giro: { quando: at, modifiche: items.map((k) => ({ file: k.rel, tipo: 'nuovo', verso: 'dropbox' })) },
    };
    await dbx.upload(`${root}/${GUIDE}`, JSON.stringify(guide, null, 2) + '\n');
    try { const c = await dbx.latestCursor(ROOT); if (c) await store.set({ cursor: c }); } catch {}
    return { ok: true, text: `"${name}" è nel mirroring: ${items.length} documenti in ${root}.` };
  } finally {
    if (tab.created) { try { await chrome.tabs.remove(tab.tabId); } catch {} }
  }
}

// ---------- prova: attivare una chat dall'interfaccia (apre la chat in secondo piano, scrive, invia) ----------
const CHAT_RE = /^https:\/\/claude\.ai\/chat\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let chatTesting = false;
async function testChat(url, text, closeAfter) {
  url = String(url || '').trim();
  text = String(text || '').trim();
  if (!CHAT_RE.test(url)) return { ok: false, error: 'indirizzo non valido: deve essere https://claude.ai/chat/<codice della chat>' };
  if (!text || text.length > 500) return { ok: false, error: 'testo vuoto o più lungo di 500 caratteri' };
  if (chatTesting) return { ok: false, error: 'una prova è già in corso' };
  chatTesting = true;
  const t0 = Date.now();
  let t;
  try {
    try { t = await chrome.tabs.create({ url, active: false }); }
    catch { t = (await chrome.windows.create({ url, focused: false, state: 'minimized' })).tabs[0]; }
    const loaded = await waitComplete(t.id, 45e3);
    const msLoad = Date.now() - t0;
    if (!loaded) return { ok: false, error: 'la pagina della chat non si è caricata in 45 s', ms_caricamento: msLoad };
    const r = (await inPage(t.id, pageSendMessage, [text, 30e3])) || { ok: false, error: 'nessuna risposta dalla pagina' };
    r.ms_caricamento = msLoad;
    r.ms_totale = Date.now() - t0;
    if (closeAfter) { try { await chrome.tabs.remove(t.id); r.scheda = 'chiusa dopo l\'invio'; } catch {} }
    else r.scheda = 'lasciata aperta';
    return r;
  } catch (e) {
    return { ok: false, error: String(e.message || e), ms_totale: Date.now() - t0 };
  } finally {
    chatTesting = false;
  }
}

// ---------- esito visibile ----------
async function setBadge(text, color, title) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setTitle({ title: 'Mirroring knowledge — ' + title });
}
function summary(r) {
  if (r.error) return r.error;
  const bad = r.projects.filter((p) => p.problems.length);
  if (bad.length) return bad.map((p) => `${p.name}: ${p.problems[0]}`).join(' · ');
  return `${r.projects.length} progetti allineati`;
}
async function showResult(r) {
  if (r.ok) { await setBadge('✓', '#15803d', `ultimo allineamento riuscito ${stamp(r.at)}`); return; }
  await setBadge('!', '#b91c1c', `PROBLEMA ${stamp(r.at)}: ${summary(r)}`);
  const { lastNotifyAt } = await store.get('lastNotifyAt');
  if (!lastNotifyAt || r.at - lastNotifyAt > NOTIFY_EVERY_MS) {
    chrome.notifications.create('mirror-error', {
      type: 'basic', iconUrl: await iconDataUrl(), title: 'Mirroring knowledge: problema', message: summary(r).slice(0, 300), priority: 2,
    });
    await store.set({ lastNotifyAt: r.at });
  }
}
chrome.notifications.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// ---------- comandi dalla pagina delle impostazioni ----------
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'startAuth': return { ok: true, url: await dbx.startAuth(msg.appKey) };
        case 'finishAuth': await dbx.finishAuth(msg.code); await store.remove('cursor'); return { ok: true };
        case 'listProjects': {
          const tab = await claudeTab();
          let list;
          try { list = await inPage(tab.tabId, pageListProjects); }
          finally { if (tab.created) { try { await chrome.tabs.remove(tab.tabId); } catch {} } }
          if (!list || !list.ok) return list || { ok: false, error: 'nessuna risposta' };
          const found = await discover();
          const inMirror = new Map(found.filter((f) => f.guide).map((f) => [f.guide.progetto.uuid, f.dir]));
          return { ok: true, projects: list.projects.map((p) => ({ ...p, dir: inMirror.get(p.uuid) || '' })) };
        }
        case 'insert': return await insertProject(msg.pid);
        case 'runNow': return { ok: true, report: await runMirror('pulsante') };
        case 'allowBig': await store.set({ allowBigCleanup: true }); return { ok: true };
        case 'testChat': return await testChat(msg.url, msg.text, !!msg.closeAfter);
        default: return { ok: false, error: 'comando sconosciuto' };
      }
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  })().then(reply);
  return true;
});
