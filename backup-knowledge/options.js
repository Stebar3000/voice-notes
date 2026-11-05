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
    out.push(`• ${p.name}: ${p.changes.length ? p.changes.length + ' modifiche' : 'nessuna modifica'}`);
    for (const c of p.changes) out.push(`   ${c.file}: ${c.tipo} → ${c.verso}${c.conflitto ? ' (conflitto: vince la knowledge)' : ''}`);
    for (const x of p.pending) out.push('   in attesa di conversione: ' + x);
    for (const e of p.problems) out.push('   ! ' + e);
  }
  if (r.ignored && r.ignored.length) out.push('Cartelle senza file guida (ignorate): ' + r.ignored.join(', '));
  return out.join('\n');
}

async function refresh() {
  const st = await store.get(['lastOkAt', 'lastReport', 'dbxRefresh', 'dbxAppKey']);
  const r = st.lastReport;
  let html = st.lastOkAt ? `Ultimo allineamento riuscito: <b>${stamp(st.lastOkAt)}</b>` : 'Nessun allineamento riuscito finora.';
  if (r && !r.ok) html += `<br><span class="bad">Ultimo tentativo ${stamp(r.at)}: problemi (dettaglio sotto).</span>`;
  html += '<br>Automatico: subito dopo ogni cambio su Dropbox, e comunque ogni 15 minuti.';
  $('status').innerHTML = html;
  $('report').hidden = !r;
  $('report').textContent = reportText(r);
  $('dbxState').innerHTML = st.dbxRefresh ? '<span class="ok">Dropbox collegato.</span> ' : '<span class="bad">Dropbox non collegato.</span> ';
  if (!st.dbxRefresh) $('dbxBox').hidden = false;
  if (st.dbxAppKey && !$('appKey').value) $('appKey').value = st.dbxAppKey;
}

$('toggleDbx').onclick = () => { $('dbxBox').hidden = !$('dbxBox').hidden; };

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

async function loadProjects() {
  $('load').disabled = true;
  $('projects').textContent = 'Carico…';
  try {
    const r = await send({ type: 'listProjects' });
    if (!r || !r.ok) { $('projects').innerHTML = `<span class="bad">${esc((r && r.error) || 'nessuna risposta')}</span>`; return; }
    const list = r.projects.slice().sort((a, b) => a.name.localeCompare(b.name, 'it'));
    $('projects').innerHTML = list.map((p) => `<div class="row">${esc(p.name)}${p.archived ? ' <small>archiviato</small>' : ''}${p.dir
      ? ` <small class="ok">nel mirroring ✓</small>`
      : ` <button class="small" data-id="${esc(p.uuid)}">Inserisci nel mirroring</button>`}</div>`).join('') || 'Nessun progetto.';
    $('projects').querySelectorAll('button').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        b.textContent = 'Copio…';
        const x = await send({ type: 'insert', pid: b.dataset.id });
        if (!x.ok) { b.disabled = false; b.textContent = 'Inserisci nel mirroring'; alertBox('NON INSERITO: ' + x.error); return; }
        alertBox(x.text);
        loadProjects();
      };
    });
  } finally { $('load').disabled = false; }
}
$('load').onclick = loadProjects;

$('run').onclick = async () => {
  $('run').disabled = true;
  $('run').textContent = 'Allineamento in corso…';
  try {
    const r = await send({ type: 'runNow' });
    if (!r.ok) alertBox(r.error);
    else if (!r.report) alertBox('Dropbox non collegato.');
  } finally {
    $('run').disabled = false;
    $('run').textContent = 'Allinea ora';
    refresh();
  }
};
$('allowBig').onclick = async () => {
  await send({ type: 'allowBig' });
  $('allowMsg').textContent = 'Consentito una volta: vale per il prossimo allineamento, poi torna il blocco.';
};
// voci del risultato, nell'ordine in cui avvengono
const CHAT_LABELS = [
  ['error', 'errore'], ['url', 'indirizzo'], ['scheda_nascosta', 'scheda in secondo piano'], ['ms_caricamento', 'caricamento pagina (ms)'],
  ['campo', 'campo trovato con'], ['ms_campo', 'campo pronto dopo (ms)'], ['testo_nel_campo', 'testo nel campo'],
  ['pulsante', 'pulsante trovato con'], ['etichetta', 'etichetta del pulsante'], ['campo_svuotato', 'campo svuotato'],
  ['messaggio_comparso', 'messaggio comparso nella chat'], ['ms', 'lavoro nella pagina (ms)'], ['ms_totale', 'totale (ms)'], ['scheda', 'scheda'],
];
(async () => {
  const st = await store.get(['testChatUrl', 'testChatText', 'testChatClose']);
  if (st.testChatUrl) $('chatUrl').value = st.testChatUrl;
  if (st.testChatText) $('chatText').value = st.testChatText;
  $('chatClose').checked = !!st.testChatClose;
})();
$('chatTest').onclick = async () => {
  const url = $('chatUrl').value.trim(), text = $('chatText').value.trim(), closeAfter = $('chatClose').checked;
  await store.set({ testChatUrl: url, testChatText: text, testChatClose: closeAfter });
  $('chatTest').disabled = true;
  $('chatTest').textContent = 'Prova in corso…';
  $('chatOut').hidden = false;
  $('chatOut').textContent = 'Apro la chat in secondo piano…';
  try {
    const r = await send({ type: 'testChat', url, text, closeAfter });
    const lines = [r && r.ok ? 'INVIATO ✓' : 'NON RIUSCITO'];
    for (const [k, label] of CHAT_LABELS) if (r && r[k] !== undefined) lines.push(`${label}: ${r[k]}`);
    $('chatOut').textContent = lines.join('\n');
    $('chatOut').className = r && r.ok ? 'ok' : 'bad';
  } finally {
    $('chatTest').disabled = false;
    $('chatTest').textContent = 'Prova attivazione chat';
  }
};
function alertBox(t) { $('report').hidden = false; $('report').textContent = t; }

chrome.storage.onChanged.addListener(() => refresh());
refresh();
