// Solveur v2 (ARCHITECTURE_V2 S1 à S6) : minimum, statuts, témoin et garage, ordre canonique (Q9), plafond de nœuds, garage serré.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { solve, replaySolution, LimitError, DEFAULT_MAX_NODES, MAX_SOLUTIONS_AT_MIN, MAX_STORED, RULES_VERSION, SOLVER_VERSION } from '../../src/engine/solver.js';
import { validateLevel } from '../../src/engine/level.js';
import { bruteMin, fromJson } from './brute.mjs';
import { readFixture, fixtureUrl, v1ToV2, deepFreeze, corridor } from './helpers.mjs';

const maquette = () => readFixture('maquette-07.v2.json');
const exemple = () => readFixture('v2/valid/x00-exemple.json');

test('constantes : 2 M nœuds, 256 solutions minimales, 4 témoins stockés, versions 2', () => {
  assert.equal(DEFAULT_MAX_NODES, 2000000);
  assert.equal(MAX_SOLUTIONS_AT_MIN, 256);
  assert.equal(MAX_STORED, 4);
  assert.equal(RULES_VERSION, 2);
  assert.equal(SOLVER_VERSION, 2);
});

test('exemple de F1 (x00-exemple) : proved-optimal, minimum 1, 32 nœuds (valeur de l\'architecture), une solution', () => {
  const r = solve(exemple(), { countAll: true });
  assert.equal(r.status, 'proved-optimal');
  assert.equal(r.minimum, 1);
  assert.equal(r.nodes, 32);
  assert.deepEqual(r.witness, [{ type: 'mirror', at: [2, 0], o: '/' }]);
  assert.equal(r.solutionsAtMin, 1);
  assert.equal(r.parkingFails, 0);
});

test('maquette : minimum 3, 4 solutions minimales, 216 nœuds de preuve (592 avec le comptage), 279 feuilles, 4 relaxées', () => {
  const r = solve(maquette(), { countAll: true });
  assert.equal(r.status, 'proved-optimal');
  assert.equal(r.minimum, 3);
  assert.equal(r.K, 3);
  assert.equal(r.nodes, 216);
  assert.equal(r.nodesTotal, 592);
  assert.equal(r.leaves, 279);
  assert.equal(r.solutionsRelaxed, 4);
  assert.equal(r.solutionsAtMin, 4);
  assert.equal(r.counted, true);
  assert.equal(r.overflow, false);
  assert.equal(r.solutions.length, 4);
  assert.ok(r.solutions.some((s) => s.witness.some((p) => p.at[0] === 7 && p.at[1] === 1 && p.o === '\\')), 'contient « tourner (7,1) en \\ »');
});

test('maquette : chaque témoin (avec son garage) est rejoué par le moteur seul : victoire et score = minimum', () => {
  const lv = maquette();
  const r = solve(lv, { countAll: true });
  for (const s of r.solutions) {
    const rp = replaySolution(lv, s.witness.concat(s.parking));
    assert.equal(rp.ok, true);
    assert.equal(rp.usedMovable, 3);
  }
  assert.equal(new Set(r.solutions.map((s) => JSON.stringify(s.witness))).size, 4, 'témoins distincts');
});

test('sans countAll : le premier témoin seulement, mêmes nœuds de preuve, pas de comptage', () => {
  const a = solve(maquette());
  const b = solve(maquette(), { countAll: true });
  assert.equal(a.nodes, b.nodes);
  assert.equal(a.nodesTotal, a.nodes);
  assert.equal(a.solutionsAtMin, null);
  assert.equal(a.counted, false);
  assert.deepEqual(a.witness, b.witness);
  assert.equal(a.solutions.length, 1);
});

test('déterminisme et pureté : deux appels identiques, niveau gelé non modifié', () => {
  const lv = deepFreeze(maquette());
  assert.deepEqual(solve(lv, { countAll: true }), solve(lv, { countAll: true }));
});

test('ordre canonique (Q9) : l\'ordre des pièces du fichier ne change ni les nœuds, ni les témoins', () => {
  const lv = maquette();
  const ref = solve(lv, { countAll: true });
  for (let seed = 1; seed <= 5; seed++) {
    const shuffled = { ...lv, pieces: lv.pieces.slice() };
    let s = seed * 2654435761;
    for (let i = shuffled.pieces.length - 1; i > 0; i--) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; const j = s % (i + 1); [shuffled.pieces[i], shuffled.pieces[j]] = [shuffled.pieces[j], shuffled.pieces[i]]; }
    const r = solve(shuffled, { countAll: true });
    assert.equal(r.nodes, ref.nodes, `graine ${seed}`);
    assert.equal(r.nodesTotal, ref.nodesTotal);
    assert.deepEqual(r.solutions, ref.solutions);
  }
  const ex = exemple();
  const rev = { ...ex, pieces: ex.pieces.slice().reverse() };
  assert.equal(solve(rev).nodes, 32);
});

test('niveau d\'un seul miroir : minimum 1, une solution ; un miroir en trop est garé (minimum 1 sur 2 mobiles)', () => {
  const lv = { format: 2, id: 'un-miroir', name: 'x', size: [5, 4], pieces: [
    { type: 'emitter', at: [0, 0], dir: 'E', mask: 'RGB' }, { type: 'target', at: [3, 2], need: 'RGB' },
    { type: 'mirror', at: [3, 0], o: '|' }, { type: 'mirror', at: [4, 3], o: '-' }] };
  const r = solve(lv, { countAll: true });
  assert.equal(r.minimum, 1);
  assert.equal(r.K, 2);
  assert.equal(r.solutionsAtMin, 1);
  assert.deepEqual(r.witness, [{ type: 'mirror', at: [3, 0], o: '\\' }]);
  assert.equal(r.parking.length, 1, 'le deuxième miroir est garé');
  assert.equal(replaySolution(lv, r.witness.concat(r.parking)).usedMovable, 1);
});

test('miroir fixe : il sert la route sans compter dans le score', () => {
  const lv = { format: 2, id: 'fixe', name: 'x', size: [5, 4], pieces: [
    { type: 'emitter', at: [0, 0], dir: 'E', mask: 'RGB' }, { type: 'mirror', at: [3, 0], o: '\\', fixed: true },
    { type: 'target', at: [3, 3], need: 'RGB' }, { type: 'mirror', at: [1, 3], o: '/' }] };
  const r = solve(lv);
  assert.equal(r.status, 'proved-optimal');
  assert.equal(r.minimum, 0, 'le fixe suffit : 0 pièce mobile utile (niveau refusé par V10 ou par minimum >= 1)');
});

test('niveau insoluble : unsolvable-proved, aucun témoin, aucune solution', () => {
  const lv = { format: 2, id: 'insoluble', name: 'x', size: [3, 3], pieces: [
    { type: 'emitter', at: [0, 0], dir: 'E', mask: 'RGB' }, { type: 'wall', at: [1, 0] }, { type: 'wall', at: [0, 1] },
    { type: 'target', at: [2, 2], need: 'RGB' }, { type: 'mirror', at: [2, 1], o: '-' }] };
  const r = solve(lv, { countAll: true });
  assert.equal(r.status, 'unsolvable-proved');
  assert.equal(r.minimum, -1);
  assert.equal(r.witness, null);
  assert.deepEqual(r.solutions, []);
  assert.equal(r.solutionsAtMin, null);
});

test('plafond de nœuds : status unknown, nœuds = plafond + 1 ; LimitError exposée et portant un code', () => {
  const r = solve(maquette(), { maxNodes: 5 });
  assert.equal(r.status, 'unknown');
  assert.equal(r.witness, null);
  assert.equal(r.nodes, 6);
  const e = new LimitError(6, 5);
  assert.equal(e.code, 'MAX_NODES');
  assert.equal(e.maxNodes, 5);
  assert.ok(e instanceof Error);
});

test('plafond atteint pendant le comptage : le minimum reste prouvé, le comptage est tronqué (counted faux)', () => {
  const r = solve(maquette(), { countAll: true, countMaxNodes: 10 });
  assert.equal(r.status, 'proved-optimal');
  assert.equal(r.minimum, 3);
  assert.equal(r.counted, false);
  assert.ok(r.solutions.length >= 1 && r.solutions.length <= 4);
});

test('countLimit : au-delà de la limite le comptage s\'arrête (overflow)', () => {
  const r = solve(maquette(), { countAll: true, countLimit: 2 });
  assert.equal(r.overflow, true);
  assert.equal(r.solutionsAtMin, 3);
});

// ---- Garage exact (S3.3) : les 6 contre-exemples du MVP deviennent des cas du garage serré et le solveur donne le minimum réel

const TIGHT = readdirSync(fixtureUrl('')).filter((f) => f.startsWith('tight-'));

test('garage serré : les 6 fixtures du MVP (miroirs, plateau presque plein) donnent le minimum réel de la force brute (1), jamais « insoluble »', () => {
  assert.equal(TIGHT.length, 6);
  for (const f of TIGHT) {
    const lv = v1ToV2(readFixture(f));
    const r = solve(lv, { countAll: true });
    const b = bruteMin(fromJson(lv));
    assert.equal(b.min, 1, f);
    assert.equal(r.status, 'proved-optimal', f);
    assert.equal(r.minimum, 1, f);
    assert.ok(r.parkingFails > 0, `${f} : le chemin « échec de garage » est exercé`);
    assert.equal(replaySolution(lv, r.witness.concat(r.parking)).ok, true, f);
  }
});

test('garage en couloir (1 ligne) : cas de crosscheck2 « fixtures » contre la force brute', () => {
  const P = (at) => ({ type: 'prism', at });
  const cases = [
    ['blanc, prisme + miroir : insoluble', corridor(4, 'RGB', [{ type: 'mirror', at: [1, 0], o: '-' }, P([2, 0])]), -1],
    ['vert, un prisme : 1', corridor(4, 'G', [P([1, 0])]), 1],
    ['vert, deux prismes : 1 (le second se gare après le premier)', corridor(4, 'G', [P([1, 0]), P([2, 0])]), 1],
    ['blanc, filtre RG : insoluble (il absorbe B ou doit être garé)', corridor(4, 'RGB', [{ type: 'filter', at: [1, 0], mask: 'RG' }]), -1],
    ['blanc, filtre rouge : insoluble', corridor(4, 'RGB', [{ type: 'filter', at: [1, 0], mask: 'R' }]), -1],
  ];
  for (const [name, lv, expected] of cases) {
    const r = solve(lv, { countAll: true });
    const b = bruteMin(fromJson(lv));
    assert.equal(b.min, expected, `${name} (force brute)`);
    assert.equal(r.status === 'proved-optimal' ? r.minimum : -1, expected, name);
  }
});

test('garage : un prisme mobile est rangé sur une case où il n\'y a que du vert ou rien', () => {
  const lv = corridor(5, 'G', [{ type: 'prism', at: [1, 0] }, { type: 'prism', at: [2, 0] }, { type: 'prism', at: [3, 0] }]);
  const r = solve(lv, { countAll: true });
  assert.equal(r.minimum, 1);
  assert.equal(r.parking.length, 2);
  assert.equal(replaySolution(lv, r.witness.concat(r.parking)).usedMovable, 1);
});

test('niveaux livrés : tout niveau qui passe V1-V12 se résout sans erreur interne (fixtures valides)', () => {
  for (const f of ['v2/valid/x00-exemple.json', 'v2/valid/test-dense.json']) {
    const lv = readFixture(f);
    const probe = { ...lv };
    delete probe.par;
    delete probe.solutions;
    const v = validateLevel(probe, f.includes('dense') ? { mode: 'shared' } : {});
    assert.deepEqual(v.errors.filter((e) => e.code !== 'V2_ID_NAME'), [], f);
    const r = solve(lv, { maxNodes: 2000 });
    assert.ok(['proved-optimal', 'unsolvable-proved', 'unknown'].includes(r.status));
  }
});
