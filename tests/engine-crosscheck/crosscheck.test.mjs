// E12 (f) : le tracé du moteur égale celui de la référence indépendante (tests/engine-crosscheck/reference.mjs), à taille réduite.
// Pleine taille : node tests/engine-crosscheck/crosscheck.mjs trace 50000 7  (0 désaccord, mesuré le 2026-11-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGenerator, goldBoard } from './generate.mjs';
import { compareBoard } from './compare.mjs';

for (const [seed, n] of [[7, 5000], [8, 3000], [20261107, 2000]]) {
  test(`tracé du moteur = référence indépendante : ${n} plateaux aléatoires, graine ${seed}, 0 désaccord, jamais plafonné`, () => {
    const { randomFull } = makeGenerator(seed);
    let bad = 0, caps = 0, gatesOpen = 0, portals = 0, won = 0;
    for (let i = 0; i < n; i++) {
      const st = randomFull();
      const { ok, res, mine } = compareBoard(st);
      if (!ok) { bad++; if (bad <= 2) assert.deepEqual(mine, compareBoard(st).br, JSON.stringify(st)); }
      if (res.capped) caps++;
      if (mine.open.length) gatesOpen++;
      if (st.pieces.some((p) => p.type === 'portal')) portals++;
      if (res.allLit) won++;
    }
    assert.equal(bad, 0);
    assert.equal(caps, 0);
    // le jeu de plateaux exerce vraiment les portes ouvertes, les portails et les victoires (sinon le test ne prouverait rien)
    assert.ok(gatesOpen >= n * 0.01, `portes ouvertes : ${gatesOpen}`);
    assert.ok(portals >= n * 0.2, `plateaux à portails : ${portals}`);
    assert.ok(won >= 1, `victoires : ${won}`);
  });
}

test('plateau d\'or 10x8 de 50 pièces (graines 20261107 à 20261117) : moteur = référence', () => {
  for (let s = 20261107; s <= 20261117; s++) {
    const st = goldBoard(s);
    assert.equal(st.pieces.length, 50);
    const { ok, mine, br } = compareBoard(st);
    assert.ok(ok, `graine ${s} : ${JSON.stringify(mine)} contre ${JSON.stringify(br)}`);
  }
});
