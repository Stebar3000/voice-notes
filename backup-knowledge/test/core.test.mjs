import test from 'node:test';
import assert from 'node:assert/strict';
import { safeRelPath, uniquePaths, planProject, isDue, asciiJson, safeSegment } from '../core.js';

test('cartelle vere e nomi puliti', () => {
  assert.equal(safeRelPath('claude/sync-stato.md'), 'claude/sync-stato.md');
  assert.equal(safeRelPath('business/note/2026-11-03-1430.md'), 'business/note/2026-11-03-1430.md');
  assert.equal(safeRelPath('_prova2/_sync_state.json'), '_prova2/_sync_state.json');
  assert.equal(safeRelPath('a:b?.md'), 'a_b_.md');
  assert.equal(safeRelPath('Cipolla - storia 1.docx'), 'Cipolla - storia 1.docx.txt');
  assert.equal(safeRelPath('senza estensione'), 'senza estensione.txt');
  assert.equal(safeRelPath('../../etc/x.md'), '_/_/etc/x.md');
  assert.equal(safeRelPath(''), 'documento.txt');
  assert.equal(safeSegment('Esegesi critica di un romanzo erotico d’autore. '), 'Esegesi critica di un romanzo erotico d’autore');
});

test('nomi doppi', () => {
  assert.deepEqual(uniquePaths(['a.md', 'A.md', 'a.md', 'x/b']), ['a.md', 'A-2.md', 'a-3.md', 'x/b']);
});

test('piano di un progetto', () => {
  const p = planProject('/Projects', { name: 'Audio Notes', instructions: 'ISTR', docs: [{ file_name: 'claude/x.md', content: 'X' }, { file_name: 'y.md', content: '' }] });
  assert.equal(p.root, '/Projects/Audio Notes');
  assert.deepEqual(p.files.map((f) => f.path), ['/Projects/Audio Notes/knowledge/claude/x.md', '/Projects/Audio Notes/knowledge/y.md', '/Projects/Audio Notes/istruzioni-progetto.md']);
});

test('quando parte', () => {
  const h = 3600e3, now = 100 * h;
  assert.equal(isDue({}, now), true);
  assert.equal(isDue({ lastOkAt: now - 2 * h, lastTryAt: now - 2 * h }, now), false);
  assert.equal(isDue({ lastOkAt: now - 25 * h, lastTryAt: now - 25 * h }, now), true);
  assert.equal(isDue({ lastOkAt: now - 25 * h, lastTryAt: now - 0.5 * h }, now), false);
  assert.equal(isDue({ lastOkAt: now - 25 * h, lastTryAt: now - 1 * h }, now), true);
});

test('intestazione ASCII', () => {
  assert.equal(asciiJson({ path: '/Projects/Così è' }), '{"path":"/Projects/Cos\\u00ec \\u00e8"}');
});

import { cleanupPlan } from '../core.js';
test('copia allineata', () => {
  const owned = ['/P/A/knowledge/a.md', '/P/A/knowledge/b.md', '/P/A/knowledge/c.md', '/P/A/istruzioni-progetto.md'];
  assert.deepEqual(cleanupPlan(owned, owned, { docs: 3 }), { action: 'none', stale: [] });
  // b spostato in x/, c cancellato: 2 su 4, non più di metà -> si tolgono
  const cur = ['/P/A/knowledge/a.md', '/P/A/knowledge/x/b.md', '/P/A/istruzioni-progetto.md'];
  assert.deepEqual(cleanupPlan(owned, cur, { docs: 2 }), { action: 'delete', stale: ['/P/A/knowledge/b.md', '/P/A/knowledge/c.md'] });
  assert.equal(cleanupPlan(owned, cur, { docs: 2, hasErrors: true }).action, 'defer');
  assert.equal(cleanupPlan(owned, [], { docs: 0 }).action, 'defer');
  // tutto riorganizzato: 3 su 4 -> blocco, salvo consenso
  const moved = ['/P/A/knowledge/n/a.md', '/P/A/knowledge/n/b.md', '/P/A/knowledge/n/c.md', '/P/A/istruzioni-progetto.md'];
  assert.equal(cleanupPlan(owned, moved, { docs: 3 }).action, 'block');
  assert.equal(cleanupPlan(owned, moved, { docs: 3, allowBig: true }).action, 'delete');
  // solo maiuscole diverse: non è un file da togliere
  assert.equal(cleanupPlan(['/P/A/knowledge/A.md'], ['/p/a/knowledge/a.md'], { docs: 1 }).action, 'none');
});
