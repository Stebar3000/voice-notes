// Cuore dell'estensione: timer, scheda claude.ai, lettura dei progetti, scrittura su Dropbox, esito.
import { planProject, isDue, stamp, cleanupPlan } from './core.js';
import { pageListProjects, pageReadProject, pageAddDoc, pageDeleteDoc } from './claude.js';
import * as dbx from './dropbox.js';

const BASE = '/Projects';
const FULL_EVERY_MS = 7 * 24 * 3600e3;    // una volta alla settimana si riscrive tutto, anche ciò che non è cambiato
const NOTIFY_EVERY_MS = 12 * 3600e3;      // al massimo un avviso di errore ogni 12 ore
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = chrome.storage.local;

// ---------- icona (disegnata nel codice: l'estensione è fatta solo di file di testo) ----------
function drawIcon(size) {
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d');
  const r = size / 6;
  g.fillStyle = '#2563eb';
  g.beginPath(); g.roundRect(0, 0, size, size, r); g.fill();
  g.fillStyle = '#fff';
  const m = size / 5;
  g.fillRect(m, size / 4, size - 2 * m, size / 10);              // coperchio della scatola
  g.fillRect(m + size / 20, size / 4 + size / 8, size - 2 * m - size / 10, size / 2.2);
  g.fillStyle = '#2563eb';
  g.fillRect(size / 2 - size / 10, size / 4 + size / 5, size / 5, size / 14); // maniglia
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
  const blob = await drawIcon(128).convertToBlob({ type: 'image/png' });
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return 'data:image/png;base64,' + btoa(s);
}
setupIcon();

// ---------- timer ----------
async function ensureAlarm() {
  const a = await chrome.alarms.get('check');
  if (!a) chrome.alarms.create('check', { delayInMinutes: 1, periodInMinutes: 60 });
}
chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); setupIcon(); setTimeout(() => maybeRun('avvio di Chrome'), 60e3); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'check') maybeRun('timer'); });
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
ensureAlarm();

async function maybeRun(why) {
  const st = await store.get(['lastOkAt', 'lastTryAt', 'selected']);
  if (!st.selected || !Object.keys(st.selected).length) return;
  if (!(await dbx.isConnected())) return;
  if (!isDue(st, Date.now())) return;
  await runBackup(why);
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
  catch {
    const w = await chrome.windows.create({ url: 'https://claude.ai/projects', focused: false, state: 'minimized' });
    t = w.tabs[0];
  }
  await waitComplete(t.id, 45e3);
  await sleep(1500);
  if (!(await tryTab(t.id))) { try { await chrome.tabs.remove(t.id); } catch {} throw new Error('impossibile aprire claude.ai'); }
  return { tabId: t.id, created: true };
}

async function inPage(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r ? r.result : null;
}

// ---------- backup ----------
async function sha(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

let running = null;
export function runBackup(why) {
  if (!running) running = doBackup(why).finally(() => { running = null; });
  return running;
}

async function doBackup(why) {
  const now = Date.now();
  await store.set({ lastTryAt: now, runningSince: now });
  await setBadge('…', '#6b7280', 'Backup in corso');
  const st = await store.get(['selected', 'hashes', 'fullAt', 'counts', 'allowBigCleanup']);
  const selected = st.selected || {};
  const hashes = st.hashes || {};
  const counts = st.counts || {};
  const full = !st.fullAt || now - st.fullAt > FULL_EVERY_MS;
  const report = { at: now, why, ok: true, projects: [], error: '' };
  let tab = null;
  try {
    if (!(await dbx.isConnected())) throw Object.assign(new Error('Dropbox non collegato'), { code: 'DBX' });
    if (!Object.keys(selected).length) throw new Error('nessun progetto scelto nelle impostazioni');
    tab = await claudeTab();
    for (const [pid, sel] of Object.entries(selected)) {
      const pr = { name: sel.name, docs: 0, written: 0, same: 0, deleted: 0, errors: [] };
      report.projects.push(pr);
      const data = await inPage(tab.tabId, pageReadProject, [sel.orgId, pid]);
      if (!data || !data.ok) {
        if (data && data.code === 'LOGIN') { report.projects.pop(); throw Object.assign(new Error('sessione claude.ai non attiva: entra in claude.ai in questo Chrome'), { code: 'LOGIN' }); }
        pr.errors.push('lettura non riuscita: ' + (data ? data.error : 'nessuna risposta'));
        continue;
      }
      pr.name = data.name || sel.name;
      const missing = data.docs.filter((d) => d.content == null).map((d) => d.file_name);
      if (missing.length) pr.errors.push('contenuto non fornito da claude.ai per: ' + missing.join(', '));
      const plan = planProject(BASE, { name: pr.name, instructions: data.instructions, docs: data.docs.filter((d) => d.content != null) });
      pr.docs = data.docs.length;
      if (pr.docs === 0 && (counts[pid] || 0) > 0) pr.errors.push(`claude.ai non ha restituito documenti (l'ultima volta erano ${counts[pid]}): nulla è stato toccato`);
      // file scritti nei backup precedenti (prima di scrivere quelli di oggi): servono alla copia allineata
      const prefix = plan.root.toLowerCase() + '/';
      const owned = Object.keys(hashes).filter((p) => p.toLowerCase().startsWith(prefix));
      for (const f of plan.files) {
        const h = await sha(f.content);
        if (!full && hashes[f.path] === h) { pr.same++; continue; }
        try { await dbx.upload(f.path, f.content); hashes[f.path] = h; pr.written++; }
        catch (e) { if (e.code === 'DBX') throw e; pr.errors.push(String(e.message || e)); }
      }
      // copia allineata: si tolgono da Dropbox i file scritti in passato che nel progetto non ci sono più
      const cp = cleanupPlan(owned, plan.files.map((f) => f.path), { hasErrors: pr.errors.length > 0, docs: pr.docs, allowBig: !!st.allowBigCleanup });
      if (cp.action === 'defer') pr.errors.push(`pulizia rinviata: ${cp.stale.length} file non più nel progetto restano su Dropbox finché la lettura non è senza errori`);
      if (cp.action === 'block') pr.errors.push(`pulizia bloccata per sicurezza: andrebbero tolti ${cp.stale.length} file su ${owned.length}. Se è voluto, premi "Consenti la prossima pulizia grande"`);
      if (cp.action === 'delete') {
        for (const p of cp.stale) {
          try { await dbx.remove(p); delete hashes[p]; pr.deleted++; }
          catch (e) { if (e.code === 'DBX') throw e; pr.errors.push(String(e.message || e)); }
        }
      }
      if (pr.docs > 0) counts[pid] = pr.docs;
      const lines = [
        `Backup della knowledge del progetto "${pr.name}"`,
        `Data: ${stamp(now)}`,
        `Documenti: ${pr.docs} · file scritti ora ${pr.written}, invariati ${pr.same} (istruzioni comprese), tolti ${pr.deleted}`,
        `Istruzioni di progetto: ${data.instructions ? 'salvate in istruzioni-progetto.md' : 'nessuna'}`,
      ];
      if (data.files.length) lines.push(`File caricati non copiati (claude.ai non fornisce gli originali): ${data.files.join(', ')}`);
      lines.push(pr.errors.length ? 'ESITO: PROBLEMI\n- ' + pr.errors.join('\n- ') : 'ESITO: OK');
      try { await dbx.upload(`${plan.root}/ultimo-backup.txt`, lines.join('\n') + '\n'); }
      catch (e) { if (e.code === 'DBX') throw e; pr.errors.push('ultimo-backup.txt: ' + (e.message || e)); }
      if (pr.errors.length) report.ok = false;
      await store.set({ hashes, counts });
    }
  } catch (e) {
    report.ok = false;
    report.error = String(e.message || e);
  } finally {
    if (tab && tab.created) { try { await chrome.tabs.remove(tab.tabId); } catch {} }
  }
  const upd = { lastReport: report, runningSince: 0, hashes, counts, allowBigCleanup: false };
  if (report.ok) { upd.lastOkAt = now; if (full) upd.fullAt = now; }
  await store.set(upd);
  await showResult(report);
  return report;
}

// ---------- esito visibile ----------
async function setBadge(text, color, title) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setTitle({ title: 'Backup knowledge — ' + title });
}

function summary(r) {
  if (r.error) return r.error;
  const bad = r.projects.filter((p) => p.errors.length);
  if (bad.length) return bad.map((p) => `${p.name}: ${p.errors[0]}`).join(' · ');
  return `${r.projects.length} progetti salvati`;
}

async function showResult(r) {
  if (r.ok) {
    await setBadge('✓', '#15803d', `ultimo backup riuscito ${stamp(r.at)}`);
    return;
  }
  await setBadge('!', '#b91c1c', `PROBLEMA ${stamp(r.at)}: ${summary(r)}`);
  const { lastNotifyAt } = await store.get('lastNotifyAt');
  if (!lastNotifyAt || r.at - lastNotifyAt > NOTIFY_EVERY_MS) {
    chrome.notifications.create('backup-error', {
      type: 'basic', iconUrl: await iconDataUrl(), title: 'Backup knowledge: problema', message: summary(r).slice(0, 300), priority: 2,
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
        case 'finishAuth': await dbx.finishAuth(msg.code); return { ok: true };
        case 'listProjects': {
          const tab = await claudeTab();
          try { return await inPage(tab.tabId, pageListProjects); }
          finally { if (tab.created) { try { await chrome.tabs.remove(tab.tabId); } catch {} } }
        }
        case 'runNow': return { ok: true, report: await runBackup('pulsante') };
        case 'allowBig': await store.set({ allowBigCleanup: true }); return { ok: true };
        case 'testWrite': return await testDoc('write');
        case 'testDelete': return await testDoc('delete');
        default: return { ok: false, error: 'comando sconosciuto' };
      }
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  })().then(reply);
  return true;
});

// ---------- prove di scrittura e cancellazione nella knowledge (solo progetto Audio Notes, solo il documento di prova) ----------
const TEST_PROJECT = 'Audio Notes';
const TEST_DOC = '_prova/scrittura/test.md';

async function testDoc(kind) {
  const { selected = {} } = await store.get('selected');
  const hit = Object.entries(selected).find(([, v]) => v.name === TEST_PROJECT);
  if (!hit) return { ok: false, error: `scegli prima "${TEST_PROJECT}" tra i progetti da salvare` };
  const [pid, sel] = hit;
  const tab = await claudeTab();
  try {
    if (kind === 'write') {
      const content = `Prova di scrittura dell'estensione Backup knowledge.\nCreato il ${stamp(Date.now())}.\n`;
      const r = await inPage(tab.tabId, pageAddDoc, [sel.orgId, pid, TEST_DOC, content]);
      if (!r || !r.ok) return { ok: false, error: 'scrittura non riuscita: ' + (r ? r.error : 'nessuna risposta') };
      const check = await inPage(tab.tabId, pageReadProject, [sel.orgId, pid]);
      const found = check && check.ok && check.docs.find((d) => d.file_name === TEST_DOC);
      if (!found) return { ok: false, error: 'scritto, ma rileggendo il progetto il documento non compare' };
      if (found.content !== content) return { ok: false, error: 'scritto, ma il contenuto riletto è diverso' };
      return { ok: true, text: `Creato "${TEST_DOC}" in ${TEST_PROJECT} e verificato rileggendolo (testo identico). Ricarica la pagina di claude.ai per vederlo.` };
    }
    const r = await inPage(tab.tabId, pageDeleteDoc, [sel.orgId, pid, TEST_DOC]);
    if (!r || !r.ok) return { ok: false, error: 'cancellazione non riuscita: ' + (r ? r.error : 'nessuna risposta') };
    const check = await inPage(tab.tabId, pageReadProject, [sel.orgId, pid]);
    if (!check || !check.ok) return { ok: false, error: 'cancellato, ma la verifica non è riuscita' };
    if (check.docs.some((d) => d.file_name === TEST_DOC)) return { ok: false, error: 'cancellato, ma il documento risulta ancora presente' };
    return { ok: true, text: `Cancellato "${TEST_DOC}" (${r.deleted}) e verificato: non c'è più. Ricarica la pagina di claude.ai.` };
  } finally {
    if (tab.created) { try { await chrome.tabs.remove(tab.tabId); } catch {} }
  }
}
