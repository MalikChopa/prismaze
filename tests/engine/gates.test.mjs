// E6 : portes, plus petit point fixe, chaîne de portes. Contient le plateau DÉDIÉ du mutant « ré-envoi supprimé » (E12 g) :
// chaîne de deux portes dont la cible liée n'est atteinte qu'après l'ouverture de la porte précédente (vu 1 fois sur 3 000 plateaux au hasard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { END_NONE, END_GATE } from './engine.mjs';
import { run, P } from './helpers.mjs';

const E = 0;
const idx = (cols, c, r, d) => (r * cols + c) * 4 + d;

// 8x4. A (0,3) éclaire T0 (2,3). B (0,0) est collé à la porte G1 (1,0), liée à T0 : sa lumière est arrêtée DÈS L'ÉMISSION.
// Derrière G1, T1 (4,0) est liée à la porte G2 (1,1) ; C (0,1) est collé à G2, derrière laquelle T2 (4,1) est la dernière cible.
// Ordre de la chaîne : T0 atteinte -> G1 s'ouvre -> la lumière de B (déjà arrêtée) repart -> T1 atteinte -> G2 s'ouvre -> la lumière de C repart -> T2.
const CHAIN = () => [
  P.emitter(0, 3, E, 7), P.target(2, 3, 7),
  P.emitter(0, 0, E, 7), P.gate(1, 0, [2, 3]), P.target(4, 0, 7),
  P.emitter(0, 1, E, 7), P.gate(1, 1, [4, 0]), P.target(4, 1, 7),
];

test('E6 chaîne de deux portes (plateau dédié, mutant « ré-envoi supprimé ») : tout s\'allume, les deux portes sont ouvertes', () => {
  const { result } = run(8, 4, CHAIN());
  assert.deepEqual(result.gates.map((g) => g.open), [true, true]);
  assert.deepEqual(result.targets.map((t) => t.lit), [true, true, true]);
  assert.equal(result.allLit, true);
  assert.equal(result.endReason[idx(8, 0, 0, E)], END_NONE, 'plus rien n\'arrête B devant G1');
  assert.equal(result.endReason[idx(8, 0, 1, E)], END_NONE, 'ni C devant G2');
  assert.equal(result.in[idx(8, 4, 1, E)], 7, 'la lumière de C a atteint T2 après le ré-envoi');
  assert.equal(result.capped, false);
});

test('E6 chaîne : sans la lumière de A, rien ne s\'ouvre (la chaîne dépend bien de T0)', () => {
  const pieces = CHAIN();
  pieces[0] = P.emitter(0, 3, E, 0); // A éteint : masque 0
  const { result } = run(8, 4, pieces);
  assert.deepEqual(result.gates.map((g) => g.open), [false, false]);
  assert.equal(result.endReason[idx(8, 0, 0, E)], END_GATE);
  assert.equal(result.endReason[idx(8, 0, 1, E)], END_GATE);
  assert.deepEqual(result.targets.map((t) => t.got), [0, 0, 0]);
});

test('E6 chaîne : le résultat ne dépend pas de l\'ordre des pièces ni des émetteurs (toutes les permutations des 3 paires)', () => {
  const base = CHAIN();
  const groups = [[0, 1], [2, 3, 4], [5, 6, 7]];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const pm of perms) {
    const order = pm.flatMap((g) => groups[g]);
    const { result } = run(8, 4, order.map((i) => base[i]));
    assert.equal(result.allLit, true, `ordre ${order}`);
    assert.deepEqual(result.gates.map((g) => g.open), [true, true]);
  }
});

test('E6 deux portes liées à la même cible s\'ouvrent ensemble ; une porte sans cible liée reste fermée', () => {
  const { result } = run(6, 4, [
    P.emitter(0, 3, E, 7), P.target(3, 3, 7),
    P.emitter(0, 0, E, 7), P.gate(1, 0, [3, 3]), P.target(5, 0, 7),
    P.emitter(0, 1, E, 7), P.gate(1, 1, [3, 3]), P.target(5, 1, 7),
    P.emitter(0, 2, E, 7), P.gate(1, 2, [4, 2]), P.target(5, 2, 7), // (4,2) n'est pas une cible
  ]);
  assert.deepEqual(result.gates.map((g) => g.open), [true, true, false]);
  assert.deepEqual(result.targets.map((t) => t.lit), [true, true, true, false]);
});

test('E6 porte ouverte = case vide, y compris pour une lumière qui arrive de côté (autre direction)', () => {
  // la porte (2,1) s'ouvre ; un second faisceau descend du nord à travers elle
  const { result } = run(5, 4, [
    P.emitter(0, 3, E, 7), P.target(3, 3, 7), P.gate(2, 1, [3, 3]),
    P.emitter(2, 0, 3, 4), P.target(2, 2, 4),
  ]);
  assert.equal(result.gates[0].open, true);
  assert.equal(result.in[idx(5, 2, 1, 3)], 4, 'le bleu traverse la porte vers le sud');
  assert.equal(result.targets[1].lit, true);
});
