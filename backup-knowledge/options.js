import { stamp } from './core.js';

const $ = (id) => document.getElementById(id);
const store = chrome.storage.local;
const send = (msg) => chrome.runtime.sendMessage(msg);

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function reportText(r) {
  if (!r) return '';
  const out = [`${stamp(r.at)} (${r.why}) — ${r.ok ? 'OK' : 'PROBLEMI'}`];
  if (r.error) out.push('Errore: ' + r.error);
  for (const p of r.projects) {
    out.push(`• ${p.name}: ${p.docs} documenti · file scritti ${p.written}, invariati ${p.same}`);
    for (const e of p.errors) out.push('   ! ' + e);
  }
  return out.join('\n');
}

async function refresh() {
  const st = await store.get(['lastOkAt', 'lastReport', 'selected', 'dbxRefresh', 'dbxAppKey']);
  const n = Object.keys(st.selected || {}).length;
  const r = st.lastReport;
  let html = st.lastOkAt ? `Ultimo backup riuscito: <b>${stamp(st.lastOkAt)}</b>` : 'Nessun backup riuscito finora.';
  if (r && !r.ok) html += `<br><span class="bad">Ultimo tentativo ${stamp(r.at)}: problemi (dettaglio sotto).</span>`;
  html += `<br>Progetti scelti: ${n}. Controllo automatico ogni ora; backup se l'ultimo riuscito ha più di 24 ore.`;
  $('status').innerHTML = html;
  $('report').hidden = !r;
  $('report').textContent = reportText(r);
  $('dbxState').innerHTML = st.dbxRefresh ? '<span class="ok">Dropbox collegato.</span>' : '<span class="bad">Dropbox non collegato.</span>';
  if (st.dbxAppKey && !$('appKey').value) $('appKey').value = st.dbxAppKey;
}

$('auth').onclick = async () => {
  const key = $('appKey').value.trim();
  if (!key) { $('dbxMsg').textContent = 'Scrivi prima la App key.'; return; }
  const r = await send({ type: 'startAuth', appKey: key });
  if (!r.ok) { $('dbxMsg').textContent = r.error; return; }
  chrome.tabs.create({ url: r.url });
  $('dbxMsg').textContent = 'Nella scheda di Dropbox premi "Continua" e "Consenti", copia il codice e incollalo qui sopra, poi "Collega".';
};

$('link').onclick = async () => {
  const code = $('code').value.trim();
  if (!code) { $('dbxMsg').textContent = 'Incolla prima il codice.'; return; }
  const r = await send({ type: 'finishAuth', code });
  $('dbxMsg').innerHTML = r.ok ? '<span class="ok">Collegato.</span>' : `<span class="bad">${esc(r.error)}</span>`;
  $('code').value = '';
  refresh();
};

$('load').onclick = async () => {
  $('load').disabled = true;
  $('projects').textContent = 'Carico…';
  try {
    const r = await send({ type: 'listProjects' });
    if (!r || !r.ok) { $('projects').innerHTML = `<span class="bad">${esc((r && r.error) || 'nessuna risposta')}</span>`; return; }
    const { selected = {} } = await store.get('selected');
    const list = r.projects.slice().sort((a, b) => a.name.localeCompare(b.name, 'it'));
    $('projects').innerHTML = list.map((p) => `<label class="row"><input type="checkbox" data-id="${esc(p.uuid)}" ${selected[p.uuid] ? 'checked' : ''}>${esc(p.name)}${p.archived ? ' <small>archiviato</small>' : ''}</label>`).join('') || 'Nessun progetto.';
    $('projects').querySelectorAll('input').forEach((cb) => {
      cb.onchange = async () => {
        const p = list.find((x) => x.uuid === cb.dataset.id);
        const cur = (await store.get('selected')).selected || {};
        if (cb.checked) cur[p.uuid] = { name: p.name, orgId: p.orgId }; else delete cur[p.uuid];
        await store.set({ selected: cur });
        refresh();
      };
    });
  } finally { $('load').disabled = false; }
};

$('run').onclick = async () => {
  $('run').disabled = true;
  $('run').textContent = 'Backup in corso…';
  try {
    const r = await send({ type: 'runNow' });
    if (!r.ok) alertBox(r.error);
  } finally {
    $('run').disabled = false;
    $('run').textContent = 'Backup ora';
    refresh();
  }
};
function alertBox(t) { $('report').hidden = false; $('report').textContent = t; }

chrome.storage.onChanged.addListener(() => refresh());
refresh();
