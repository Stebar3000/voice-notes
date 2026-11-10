import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { safeRelPath, mapDocs, planSync, dbxHash, isReserved, isText, isIgnored, asciiJson, safeSegment } from '../core.js';

test('file ignorati (v1.0.2): coordinate e PDF in lavorazione del convertitore, temporanei, Excel', () => {
  for (const n of ['sub/doc.coord', 'doc.pdf.inlavorazione', 'doc.coord.tmp', 'Dati.xlsx', 'vecchio.XLS', 'macro.xlsm']) {
    assert.equal(isIgnored(n), true, n);
  }
  for (const n of ['doc.pdf', 'doc.pdf.md', 'note.json', 'tabella.csv', 'lettera.docx']) assert.equal(isIgnored(n), false, n);
});

test('nomi e percorsi', () => {
  assert.equal(safeRelPath('claude/sync-stato.md'), 'claude/sync-stato.md');
  assert.equal(safeRelPath('a:b?.md'), 'a_b_.md');
  assert.equal(safeRelPath('Cipolla - storia 1.docx'), 'Cipolla - storia 1.docx.txt');
  assert.equal(safeRelPath('../../etc/x.md'), '_/_/etc/x.md');
  assert.equal(safeSegment('Esegesi critica d’autore. '), 'Esegesi critica d’autore');
  assert.equal(isText('contratto.pdf.md'), true);
  assert.equal(isText('contratto.pdf'), false);
  assert.equal(isReserved('Originali/x.pdf'), true);
  assert.equal(isReserved('_mirroring.json'), true);
  assert.equal(isReserved('note/Originali.md'), false);
  assert.equal(asciiJson({ path: '/Così è' }), '{"path":"/Cos\\u00ec \\u00e8"}');
});

test('impronta come Dropbox (file piccoli: sha256 di sha256)', async () => {
  for (const s of ['', 'ciao', 'è così\n']) {
    const b = new TextEncoder().encode(s);
    const exp = createHash('sha256').update(createHash('sha256').update(b).digest()).digest('hex');
    assert.equal(await dbxHash(b), exp);
  }
});

test('corrispondenza nomi tramite file guida', () => {
  const state = { 'a_b.md': { nome: 'a:b.md', h: 'x' } };
  const m = mapDocs([{ name: 'a:b.md' }, { name: 'a_b.md' }], state);
  assert.deepEqual(m.map((d) => d.rel), ['a_b.md', 'a_b-2.md']);
});

const S = (o) => Object.fromEntries(Object.entries(o).map(([k, h]) => [k, { nome: k, h }]));
const ops = (p) => p.ops.map((o) => `${o.op}:${o.rel}${o.conflict ? '!' : ''}`).sort();

test('mirroring: tutti i casi', () => {
  const state = S({ 'a.md': '1', 'b.md': '1', 'c.md': '1', 'd.md': '1', 'e.md': '1', 'f.md': '1' });
  const K = [
    { rel: 'a.md', name: 'a.md', h: '1' },          // invariato
    { rel: 'b.md', name: 'b.md', h: '2' },          // modificato nella knowledge
    { rel: 'c.md', name: 'c.md', h: '1' },          // modificato su Dropbox
    { rel: 'd.md', name: 'd.md', h: '1' },          // cancellato su Dropbox
    { rel: 'f.md', name: 'f.md', h: '3' },          // conflitto
    { rel: 'n.md', name: 'n.md', h: '9' },          // nuovo nella knowledge
  ];
  const D = [
    { rel: 'a.md', h: '1' }, { rel: 'b.md', h: '1' }, { rel: 'c.md', h: '2' },
    { rel: 'e.md', h: '1' },                        // cancellato nella knowledge
    { rel: 'f.md', h: '4' }, { rel: 'x/nuovo.md', h: '7' },   // nuovo su Dropbox
  ];
  const p = planSync(K, D, state);
  assert.deepEqual(ops(p), ['delD:e.md', 'delK:d.md', 'down:c.md', 'down:x/nuovo.md', 'same:a.md', 'up:b.md', 'up:f.md!', 'up:n.md'].sort());
  assert.deepEqual(p.problems, []);
});

test('mirroring: spostamento su Dropbox = cancella + nuovo', () => {
  const state = S({ 'a.md': '1', 'b.md': '1', 'c.md': '1' });
  const K = [{ rel: 'a.md', name: 'a.md', h: '1' }, { rel: 'b.md', name: 'b.md', h: '1' }, { rel: 'c.md', name: 'c.md', h: '1' }];
  const D = [{ rel: 'a.md', h: '1' }, { rel: 'b.md', h: '1' }, { rel: 'sub/c.md', h: '1' }];
  assert.deepEqual(ops(planSync(K, D, state)), ['delK:c.md', 'down:sub/c.md', 'same:a.md', 'same:b.md']);
});

test('mirroring: protezioni', () => {
  const state = S({ 'a.md': '1', 'b.md': '1', 'c.md': '1' });
  const K3 = [{ rel: 'a.md', name: 'a.md', h: '1' }, { rel: 'b.md', name: 'b.md', h: '1' }, { rel: 'c.md', name: 'c.md', h: '1' }];
  // knowledge vuota: niente cancellazioni e niente scritture
  let p = planSync([], [{ rel: 'a.md', h: '1' }], state);
  assert.ok(p.ops.every((o) => o.op === 'keep' || o.op === 'gone'));
  assert.ok(p.problems[0].includes('knowledge risulta vuota'));
  // Dropbox vuoto: idem
  p = planSync(K3, [], state);
  assert.ok(p.ops.every((o) => o.op === 'keep'));
  // più di metà da cancellare: blocco, salvo consenso
  p = planSync(K3, [{ rel: 'a.md', h: '1' }], state);
  assert.deepEqual(ops(p), ['keep:b.md', 'keep:c.md', 'same:a.md']);
  assert.ok(p.problems[0].includes('bloccato'));
  p = planSync(K3, [{ rel: 'a.md', h: '1' }], state, { allowBig: true });
  assert.deepEqual(ops(p), ['delK:b.md', 'delK:c.md', 'same:a.md']);
  // maiuscole diverse: stesso file
  p = planSync([{ rel: 'A.md', name: 'A.md', h: '1' }], [{ rel: 'a.md', h: '1' }], S({ 'A.md': '1' }));
  assert.deepEqual(ops(p), ['same:A.md']);
});
