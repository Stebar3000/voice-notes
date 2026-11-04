// Funzioni che girano DENTRO una scheda claude.ai (iniettate con chrome.scripting.executeScript).
// Solo lì le chiamate portano la sessione dell'utente. Devono essere autosufficienti:
// Chrome le copia nella pagina come testo, quindi niente variabili o import esterni.
// Indirizzi interni di claude.ai (gli stessi che usa il sito; verificati con l'estensione Depot, 11/2026).

export function pageListProjects() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function get(path) {
    for (let i = 0; i < 4; i++) {
      let res;
      try { res = await fetch(path, { credentials: 'include' }); }
      catch (e) { if (i === 3) throw new Error('rete: ' + e.message); await sleep(1000 * 2 ** i); continue; }
      if (res.status === 401 || res.status === 403) { const e = new Error('sessione claude.ai non attiva'); e.code = 'LOGIN'; throw e; }
      if ([429, 500, 502, 503, 504].includes(res.status) && i < 3) { await sleep(1000 * 2 ** i); continue; }
      if (!res.ok) throw new Error(`${path} -> ${res.status}`);
      return res.json();
    }
  }
  const arr = (v, ...k) => (Array.isArray(v) ? v : (k.map((x) => v && v[x]).find(Array.isArray) || []));
  return (async () => {
    try {
      const orgs = arr(await get('/api/organizations'));
      const out = [];
      for (const o of orgs) {
        const org = o.uuid || o.id;
        if (!org) continue;
        let list = [];
        try { list = arr(await get(`/api/organizations/${org}/projects`), 'projects', 'data'); }
        catch (e) { if (e.code === 'LOGIN') throw e; continue; }   // organizzazione senza progetti
        for (const p of list) {
          const uuid = p.uuid || p.id;
          if (uuid && !out.some((x) => x.uuid === uuid)) out.push({ uuid, name: p.name || '(senza nome)', orgId: org, archived: !!p.archived_at });
        }
      }
      return { ok: true, projects: out };
    } catch (e) {
      return { ok: false, code: e.code || 'ERR', error: String(e.message || e) };
    }
  })();
}

export function pageReadProject(orgId, pid) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function get(path) {
    for (let i = 0; i < 4; i++) {
      let res;
      try { res = await fetch(path, { credentials: 'include' }); }
      catch (e) { if (i === 3) throw new Error('rete: ' + e.message); await sleep(1000 * 2 ** i); continue; }
      if (res.status === 401 || res.status === 403) { const e = new Error('sessione claude.ai non attiva'); e.code = 'LOGIN'; throw e; }
      if (res.status === 404) { const e = new Error('progetto non trovato'); e.code = 'GONE'; throw e; }
      if ([429, 500, 502, 503, 504].includes(res.status) && i < 3) { await sleep(1000 * 2 ** i); continue; }
      if (!res.ok) throw new Error(`${path} -> ${res.status}`);
      return res.json();
    }
  }
  const arr = (v, ...k) => (Array.isArray(v) ? v : (k.map((x) => v && v[x]).find(Array.isArray) || []));
  const base = `/api/organizations/${orgId}/projects/${pid}`;
  return (async () => {
    try {
      const project = await get(base);
      const docs = arr(await get(`${base}/docs`), 'docs', 'data');
      let files = [];
      try { files = arr(await get(`${base}/files`), 'files', 'data'); } catch (e) { if (e.code === 'LOGIN') throw e; }
      return {
        ok: true,
        name: project.name || '',
        instructions: project.prompt_template || project.instructions || '',
        docs: docs.map((d) => ({ file_name: d.file_name || d.name || '', content: d.content == null ? null : d.content })),
        files: files.map((f) => f.file_name || f.name || '(senza nome)'),
      };
    } catch (e) {
      return { ok: false, code: e.code || 'ERR', error: String(e.message || e) };
    }
  })();
}
