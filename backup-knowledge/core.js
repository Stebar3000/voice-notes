// Funzioni pure (niente Chrome, niente rete): si provano in Node con `node --test`.

// Caratteri che Windows non accetta nei nomi: li sostituiamo con "_".
const UNSAFE = /[\\:*?"<>|\u0000-\u001f]/g;

// Estensioni che sono già testo: il documento si salva con il suo nome.
// Per le altre (es. .docx, .pdf caricati) claude.ai conserva solo il testo estratto,
// quindi si aggiunge ".txt" per non creare un falso file Word o PDF.
const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'text', 'json', 'csv', 'tsv', 'js', 'mjs', 'ts', 'py', 'html', 'htm', 'xml',
  'yml', 'yaml', 'sql', 'css', 'log', 'ini', 'toml', 'sh', 'bat', 'ps1', 'java', 'c', 'h', 'cpp', 'rs',
  'go', 'rb', 'php', 'tex', 'rtf', 'srt', 'vtt', 'gs',
]);

export function safeSegment(s) {
  let out = String(s == null ? '' : s).replace(UNSAFE, '_').trim();
  out = out.replace(/[. ]+$/, '');          // Windows non vuole punto o spazio finali
  if (out === '' || out === '.' || out === '..') out = '_';
  return out;
}

// "business/note/x.md" -> "business/note/x.md" (cartelle vere), ripulendo ogni pezzo.
export function safeRelPath(name, fallback = 'documento') {
  const parts = String(name == null ? '' : name).split('/').map((p) => p.trim()).filter((p) => p !== '');
  if (!parts.length) parts.push(fallback);
  const clean = parts.map(safeSegment);
  const last = clean[clean.length - 1];
  const dot = last.lastIndexOf('.');
  const ext = dot > 0 ? last.slice(dot + 1).toLowerCase() : '';
  if (!TEXT_EXT.has(ext)) clean[clean.length - 1] = `${last}.txt`;
  return clean.join('/');
}

// Due documenti con lo stesso nome: il secondo diventa "nome-2.md", e così via.
export function uniquePaths(names) {
  const used = new Set();
  return names.map((n) => {
    let p = n, i = 2;
    while (used.has(p.toLowerCase())) {          // Dropbox non distingue maiuscole e minuscole
      const slash = n.lastIndexOf('/');
      const dot = n.lastIndexOf('.');
      p = dot > slash + 1 ? `${n.slice(0, dot)}-${i}${n.slice(dot)}` : `${n}-${i}`;
      i++;
    }
    used.add(p.toLowerCase());
    return p;
  });
}

// Elenco dei file da scrivere per un progetto: [{path, content}].
export function planProject(base, project) {
  const root = `${base.replace(/\/+$/, '')}/${safeSegment(project.name || 'Progetto senza nome')}`;
  const docs = project.docs || [];
  const rel = uniquePaths(docs.map((d) => safeRelPath(d.file_name)));
  const files = docs.map((d, i) => ({ path: `${root}/knowledge/${rel[i]}`, content: d.content == null ? '' : String(d.content) }));
  if (project.instructions) files.push({ path: `${root}/istruzioni-progetto.md`, content: String(project.instructions) });
  return { root, files };
}

// Deve partire il backup automatico? Sì se non ce n'è mai stato uno riuscito o se sono passate ~24 ore;
// in caso di errore si riprova al giro successivo del timer (ogni ora), ma non più spesso.
export function isDue(state, now, { everyMs = 23.5 * 3600e3, retryMs = 55 * 60e3 } = {}) {
  const okAt = state && state.lastOkAt ? state.lastOkAt : 0;
  const tryAt = state && state.lastTryAt ? state.lastTryAt : 0;
  if (now - okAt < everyMs) return false;
  if (now - tryAt < retryMs) return false;
  return true;
}

// Le intestazioni HTTP devono essere ASCII: i caratteri accentati diventano \uXXXX.
export function asciiJson(obj) {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function two(n) { return String(n).padStart(2, '0'); }
export function stamp(ms) {
  const d = new Date(ms);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
