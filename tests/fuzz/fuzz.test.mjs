// Fuzz réduit du codec de partage (inclus dans `npm test`). Version complète : node tests/fuzz/run.mjs 400000 2026
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFuzz } from './fuzz.mjs';

for (const seed of [2026, 7, 4242]) {
  test(`fuzz réduit (graine ${seed}, 12 000 chaînes) : 0 exception, 0 acceptation non canonique`, () => {
    const rep = runFuzz({ count: 12000, seed });
    assert.deepEqual(rep.exemplesProblemes, []);
    assert.equal(rep.exceptionsInattendues, 0);
    assert.equal(rep.acceptees_non_canoniques, 0);
    assert.equal(rep.encodeurDifferent, 0);
    assert.equal(rep.prototypeIntact, true);
    assert.ok(rep.chaines >= 12000);
    // le fuzz doit atteindre les contrôles de structure : des chaînes à CRC juste sont acceptées ET rejetées
    assert.ok(rep.acceptees > 1000, `acceptées : ${rep.acceptees}`);
    assert.ok(rep.parFamille['hostile-crc-juste'].acceptees > 0);
    assert.ok(rep.parFamille['hostile-crc-juste'].acceptees < rep.parFamille['hostile-crc-juste'].chaines);
    for (const code of ['LENGTH', 'PREFIX', 'NEWER', 'ALPHABET', 'FORMAT', 'BOUNDS', 'ORDER', 'TYPE', 'MASK', 'LINK', 'CRC', 'PADDING', 'TRAILING']) {
      assert.ok(rep.rejetsParCode[code] > 0, `aucun rejet « ${code} » atteint par le fuzz`);
    }
  });
}
