// Uso: node test/attiva-chat.e2e.mjs <cartella dell'estensione>   (serve Playwright con Chromium e openssl)
// Prova simulata del pulsante "Prova attivazione chat" (estensione v1.0.1) con un claude.ai finto.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';

const EXT = process.argv[2];
const ID = 'jadbhjncdakibmflmidckmiiagkopipo';
const OK = '11111111-1111-1111-1111-111111111111';
const NOFIELD = '22222222-2222-2222-2222-222222222222';
const NOBTN = '33333333-3333-3333-3333-333333333333';
const STUCK = '44444444-4444-4444-4444-444444444444';

function chatPage(kind) {
  const field = kind === NOFIELD ? '' : `<div class="ProseMirror" contenteditable="true"></div>`;
  const button = (kind === NOBTN || kind === NOFIELD) ? '' : `<button aria-label="Invia messaggio" disabled>↑</button>`;
  return `<!doctype html><html><body><div id="msgs"><p>messaggio vecchio</p></div><fieldset id="box"></fieldset>
<script>
  // il campo compare dopo 2 s, come in un'app che si carica
  setTimeout(() => {
    document.getElementById('box').innerHTML = ${JSON.stringify(field + button)};
    const ed = document.querySelector('.ProseMirror'), b = document.querySelector('button');
    const send = () => { const t = ed.innerText.trim(); if (!t) return; const p = document.createElement('p'); p.textContent = t; document.getElementById('msgs').append(p); ed.innerHTML = ''; if (b) b.disabled = true; };
    if (ed) ed.addEventListener('input', () => { if (b) b.disabled = !ed.innerText.trim(); });
    if (b && ${JSON.stringify(kind)} !== '${STUCK}') b.addEventListener('click', send);
    if (ed && ${JSON.stringify(kind)} === '${NOBTN}') ed.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  }, 2000);
</script></body></html>`;
}

// claude.ai finto servito in locale: Chromium risolve claude.ai su 127.0.0.1 (le schede aperte dall'estensione non passano da ctx.route)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${tmp}/key.pem`, '-out', `${tmp}/cert.pem`, '-days', '2', '-subj', '/CN=claude.ai', '-addext', 'subjectAltName=DNS:claude.ai'], { stdio: 'ignore' });
const srv = https.createServer({ key: fs.readFileSync(`${tmp}/key.pem`), cert: fs.readFileSync(`${tmp}/cert.pem`) }, (req, res) => {
  const m = req.url.match(/^\/chat\/([^?]+)/);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  console.log('  [server finto] ' + req.url); res.end(m ? chatPage(m[1]) : '<html><body>altro</body></html>');
});
await new Promise((r) => srv.listen(8443, '127.0.0.1', r));
// proxy locale: claude.ai → server finto; tutto il resto rifiutato (nessun contatto con il vero claude.ai)
const prx = http.createServer((q, r) => { r.writeHead(403); r.end(); });
prx.on('connect', (req, sock) => {
  const host = req.url.split(':')[0];
  if (host !== 'claude.ai') { sock.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  const up = net.connect(8443, '127.0.0.1', () => { sock.write('HTTP/1.1 200 Connection Established\r\n\r\n'); up.pipe(sock); sock.pipe(up); });
  up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
});
await new Promise((r) => prx.listen(8899, '127.0.0.1', r));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prof-'));
const ctx = await chromium.launchPersistentContext(dir, {
  headless: false,
  proxy: { server: 'http://127.0.0.1:8899' },
  args: ['--headless=new', '--ignore-certificate-errors', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const opt = await ctx.newPage();
await opt.goto(`chrome-extension://${ID}/options.html`);
await opt.bringToFront();

async function run(name, url, text, close) {
  await opt.fill('#chatUrl', url);
  await opt.fill('#chatText', text);
  await opt.setChecked('#chatClose', close);
  const before = ctx.pages().length;
  await opt.click('#chatTest');
  await opt.waitForFunction(() => !document.querySelector('#chatTest').disabled, null, { timeout: 120000 });
  const out = await opt.textContent('#chatOut');
  const tabs = ctx.pages().length - before;
  console.log(`\n=== ${name} (schede in più rimaste: ${tabs}) ===\n${out}`);
  return { out, tabs };
}

const res = [];
let r;
r = await run('1. chat normale, scheda lasciata aperta', `https://claude.ai/chat/${OK}`, 'ping', false);
res.push(['1', r.out.startsWith('INVIATO') && /scheda in secondo piano: /.test(r.out) && r.tabs === 1]);  // Chromium headless segna ogni scheda come visibile: il secondo piano vero si prova solo sul PC
for (const p of ctx.pages()) if (p !== opt) await p.close();
r = await run('2. chat normale, scheda chiusa dopo l\'invio', `https://claude.ai/chat/${OK}`, 'elabora', true);
res.push(['2', r.out.startsWith('INVIATO') && /chiusa/.test(r.out) && r.tabs === 0]);
r = await run('3. indirizzo non valido', 'https://claude.ai/projects', 'ping', true);
res.push(['3', r.out.startsWith('NON RIUSCITO') && /indirizzo non valido/.test(r.out)]);
r = await run('4. pagina senza campo', `https://claude.ai/chat/${NOFIELD}`, 'ping', true);
res.push(['4', r.out.startsWith('NON RIUSCITO') && /campo di input non trovato/.test(r.out)]);
r = await run('5. senza pulsante: Invio sintetico', `https://claude.ai/chat/${NOBTN}`, 'ping', true);
res.push(['5', r.out.startsWith('INVIATO') && /Invio sintetico/.test(r.out)]);
r = await run('6. pulsante che non invia', `https://claude.ai/chat/${STUCK}`, 'ping', true);
res.push(['6', r.out.startsWith('NON RIUSCITO') && /rimasto nel campo/.test(r.out)]);
r = await run('7. testo vuoto', `https://claude.ai/chat/${OK}`, '', true);
res.push(['7', /testo vuoto/.test(r.out)]);

console.log('\nRISULTATI: ' + res.map(([n, ok]) => `${n}:${ok ? 'OK' : 'FALLITA'}`).join('  '));
await ctx.close();
srv.close(); prx.close();
process.exit(res.every(([, ok]) => ok) ? 0 : 1);
