// Test différentiel sur les niveaux du format 1 (miroirs, lumière blanche) : le moteur v2 contre la référence indépendante
// (tests/engine-crosscheck/reference.mjs : autre algorithme, rien d'importé du moteur). Les plateaux denses v2 sont dans
// tests/engine-crosscheck/crosscheck.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, buildBoard, traceBoard } from './engine.mjs';
import { bruteTrace } from '../engine-crosscheck/reference.mjs';
import { randomLevel } from './helpers.mjs';

test('différentiel : 400 plateaux 16x12 de 50 pièces (miroirs), moteur = référence (cibles, score, pièces utilisées)', () => {
  let lit = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const state = createState(randomLevel(seed, 16, 12, 39, 6, 4));
    const r = traceBoard(buildBoard(state));
    const br = bruteTrace(state);
    assert.deepEqual(r.targets.map((t) => t.got), br.got, `graine ${seed}`);
    assert.equal(r.allLit, br.allLit, `graine ${seed}`);
    assert.equal(r.usedMovable, br.usedMovable, `graine ${seed}`);
    assert.deepEqual([...r.used].map((u, id) => (u ? id : -1)).filter((x) => x >= 0), br.used, `graine ${seed}`);
    lit += r.litCount;
  }
  assert.ok(lit >= 30, `le jeu de plateaux allume des cibles (${lit})`);
});
