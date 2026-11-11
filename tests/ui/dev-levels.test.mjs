// Les niveaux de développement de J4 (src/dev-levels.js) sont les fixtures de tests/fixtures/ : aucune dérive, tous valides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEV_LEVELS } from '../../src/dev-levels.js';
import { validateLevel } from '../../src/engine/level.js';
import { createState } from '../../src/engine/state.js';
import { buildBoard } from '../../src/engine/board.js';
import { trace } from '../../src/engine/trace.js';

const FILES = { galerie: 'v2/valid/galerie.json', 'maquette-07': 'maquette-07.v2.json', 'x00-exemple': 'v2/valid/x00-exemple.json' };
const read = (f) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8'));
const strip = (lv) => ({ format: lv.format, id: lv.id, name: lv.name, size: lv.size, pieces: lv.pieces });

for (const [id, file] of Object.entries(FILES)) {
  test(`dev-levels : « ${id} » = ${file} (hors par et solutions), valide`, () => {
    assert.deepEqual(strip(DEV_LEVELS[id]), strip(read(file)));
    assert.equal(validateLevel(DEV_LEVELS[id]).ok, true);
  });
}

test('galerie : toutes les pièces, les 7 couleurs de lumière, tous les états de cible, une porte ouverte et une fermée', () => {
  const lv = DEV_LEVELS.galerie;
  const types = new Set(lv.pieces.map((p) => p.type));
  for (const t of ['emitter', 'wall', 'target', 'mirror', 'splitter', 'prism', 'filter', 'portal', 'gate']) assert.ok(types.has(t), t);
  const r = trace(buildBoard(createState(lv)));
  const seg = r.segments();
  const masks = new Set(Array.from(seg.mask.subarray(0, seg.count)));
  assert.deepEqual([...masks].sort(), [1, 2, 3, 4, 5, 6, 7], 'les 7 masques éclairent au moins une série');
  const needs = new Set(r.targets.map((t) => t.need));
  assert.deepEqual([...needs].sort(), [1, 2, 3, 4, 5, 6, 7], 'une cible par couleur');
  assert.ok(r.targets.some((t) => t.lit) && r.targets.some((t) => t.got !== 0 && !t.reached) && r.targets.some((t) => t.reached && !t.lit), 'allumée, partielle, trop');
  assert.deepEqual(r.gates.map((g) => g.open), [true, false]);
  assert.equal(r.allLit, false);
  assert.equal(new Set(lv.pieces.filter((p) => p.type === 'portal').map((p) => p.pair)).size, 4, '4 paires de portails');
});
