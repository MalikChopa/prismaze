// La force brute indépendante (tests/solver/brute.mjs) est elle-même contrôlée : son tracé contre le moteur et contre la
// référence du tracé de J1, ses énumérations sur des cas calculés à la main, puis le solveur contre elle sur un échantillon
// (le grand contrôle, 20 000+ niveaux, est tests/solver/crosscheck.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../../src/engine/state.js';
import { buildBoard } from '../../src/engine/board.js';
import { trace } from '../../src/engine/trace.js';
import { solve } from '../../src/engine/solver.js';
import { bruteTrace } from '../engine-crosscheck/reference.mjs';
import { trace as bTrace, bruteMin, bruteCounts, fromJson, toJson, isMovable } from './brute.mjs';
import { mulberry, plantedLevel } from './generate.mjs';
import { runCrosscheck } from './crosscheck.mjs';
import { readFixture } from './helpers.mjs';

test('tracé de la force brute = moteur = référence de J1, sur 1 500 niveaux plantés aux pièces dispersées au hasard', () => {
  const rnd = mulberry(77);
  let boards = 0;
  let wins = 0;
  while (boards < 1500) {
    const pl = plantedLevel(rnd, { types: ['mirror', 'splitter', 'prism', 'filter'], portalPct: 40, gatePct: 50, maxGates: 2, maxK: 3, cols: 5, rows: 4 });
    if (pl === null) continue;
    boards++;
    // on déplace les pièces mobiles au hasard (cases quelconques sans pièce fixe, orientations quelconques)
    const L = pl.level;
    const mov = L.pieces.filter(isMovable);
    const fixed = new Set(L.pieces.filter((p) => !isMovable(p)).map((p) => p.x + ',' + p.y));
    const free = [];
    for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) if (!fixed.has(x + ',' + y)) free.push([x, y]);
    if (free.length < mov.length) continue;
    for (let i = free.length - 1; i > 0; i--) { const j = rnd.int(i + 1); [free[i], free[j]] = [free[j], free[i]]; }
    mov.forEach((p, i) => { p.x = free[i][0]; p.y = free[i][1]; p.o = rnd.int(4); });
    const mine = bTrace(L);
    const t = trace(buildBoard(createState(toJson(L))));
    assert.equal(mine.allLit, t.allLit, `allLit ${JSON.stringify(toJson(L))}`);
    assert.equal(mine.usedMovable, t.usedMovable, `usedMovable ${JSON.stringify(toJson(L))}`);
    assert.deepEqual(mine.got, t.targets.map((x) => x.got), 'lumière reçue par cible');
    // référence de J1 (format d'état : c, r, dir, mask, need, pair, link, fixed)
    const st = { cols: L.cols, rows: L.rows, pieces: L.pieces.map((p) => ({ type: p.type, c: p.x, r: p.y, o: p.o ?? 0, dir: p.dir ?? 0, mask: p.mask ?? 0, need: p.need ?? 0, pair: p.pair ?? 0, link: p.link ?? null, fixed: p.fixed === true })) };
    const ref = bruteTrace(st);
    assert.equal(mine.allLit, ref.allLit);
    assert.equal(mine.usedMovable, ref.usedMovable);
    if (mine.allLit) wins++;
  }
  assert.ok(boards >= 1500);
  assert.ok(wins >= 0);
});

test('force brute : maquette (format 2) minimum 3 ; relaxées 4 et réelles 4 à k = 3', () => {
  const L = fromJson(readFixture('maquette-07.v2.json'));
  assert.equal(bruteMin(L).min, 3);
  assert.deepEqual(bruteCounts(L, 3), { relaxed: 4, real: 4 });
});

test('force brute : exemple de F1 (porte, portails, prisme fixe) minimum 1, une solution', () => {
  const L = fromJson(readFixture('v2/valid/x00-exemple.json'));
  assert.equal(bruteMin(L).min, 1);
  assert.deepEqual(bruteCounts(L, 1), { relaxed: 1, real: 1 });
});

test('force brute : niveau insoluble -> -1 ; pièces identiques énumérées en cases croissantes (même minimum que sans réduction)', () => {
  const lv = { format: 2, id: 'insoluble', name: 'x', size: [3, 3], pieces: [
    { type: 'emitter', at: [0, 0], dir: 'E', mask: 'RGB' }, { type: 'wall', at: [1, 0] }, { type: 'wall', at: [0, 1] },
    { type: 'target', at: [2, 2], need: 'RGB' }, { type: 'mirror', at: [2, 1], o: '-' }] };
  assert.equal(bruteMin(fromJson(lv)).min, -1);
});

test('contrôle croisé réduit (400 niveaux plantés, graine 7) : 0 désaccord, 0 rejeu raté, comptages relaxés et réels égaux', (t) => {
  const st = runCrosscheck({ n: 400, seed: 7, countEvery: 4 });
  t.diagnostic(JSON.stringify({ levels: st.levels, solvable: st.solvable, unsolvable: st.unsolvable, countsChecked: st.countsChecked, minHist: st.minHist }));
  assert.equal(st.disagreements, 0);
  assert.equal(st.replayBruteKO, 0);
  assert.equal(st.replayEngineKO, 0);
  assert.equal(st.countsKO, 0);
  assert.equal(st.unknown, 0);
  assert.ok(st.solvable > 200 && st.unsolvable > 30, 'les deux cas sont couverts');
  assert.ok(st.withGate > 100 && st.withPortal > 80, 'portes et portails couverts');
  for (const type of ['mirror', 'splitter', 'prism', 'filter']) assert.ok(st.typeLevels[type] > 50, type);
});

test('le solveur détecte un mutant : sans le garage exact (pièce en trop jamais garée), la force brute le contredit', () => {
  // Niveau où le garage est obligatoire : couloir d'une ligne, vert, deux prismes. Un solveur sans garage dirait « insoluble » ou « 2 ».
  const lv = { format: 2, id: 'garage', name: 'x', size: [4, 1], pieces: [
    { type: 'emitter', at: [0, 0], dir: 'E', mask: 'RGB' }, { type: 'target', at: [3, 0], need: 'G' }, { type: 'prism', at: [1, 0] }, { type: 'prism', at: [2, 0] }] };
  const real = bruteMin(fromJson(lv)).min;
  assert.equal(real, 1);
  const r = solve(lv);
  assert.equal(r.minimum, real);
  assert.equal(r.parking.length, 1);
});
