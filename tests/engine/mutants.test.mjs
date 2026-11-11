// Garde-fou du harnais de mutation (tests/engine/mutants/) : chaque mutant s'applique encore à src/engine/trace.js, une seule fois,
// et change le texte. Le harnais complet (7 copies mutées, tests relancés) est lent : node tests/engine/mutants/run-mutants.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MUTANTS, applyMutant } from './mutants/mutants.mjs';

const trace = readFileSync(new URL('../../src/engine/trace.js', import.meta.url), 'utf8');

test('E12 (g) : 7 mutants, chacun applicable une seule fois à src/engine/trace.js et différent de l\'original', () => {
  assert.equal(MUTANTS.length, 7);
  assert.deepEqual(MUTANTS.map((m) => m.id), [1, 2, 3, 4, 5, 6, 7]);
  for (const m of MUTANTS) {
    const mutated = applyMutant(m, trace);
    assert.notEqual(mutated, trace, `mutant ${m.id}`);
  }
});
