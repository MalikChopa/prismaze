// Simulation de particules pure (V3-28, V3-29) : à graine, déterministe ; aucun Math.random ni Date.now dans src/render/scene/ ni dans renderer.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createParticleSim, makeRng, seedOf, STRIDE, F } from '../../../src/render/scene/particles-sim.js';

function scenario(seed, quality) {
  const sim = createParticleSim({ pool: 1500, seed, quantity: quality });
  for (let step = 0; step < 240; step++) {
    if (step % 30 === 0) sim.burst({ x: 3 + (step % 7), y: 2, mask: 1 + (step % 7), n: 80, speed: 3.2, ttl: 1.3 });
    sim.update(1 / 60);
  }
  return { sim, sum: sim.checksum() };
}

test('V3-29 : mêmes entrées, même graine → mêmes particules (deux victoires identiques)', () => {
  const a = scenario(seedOf('c02-melange'), 1), b = scenario(seedOf('c02-melange'), 1);
  assert.equal(a.sum, b.sum); assert.equal(a.sim.count, b.sim.count); assert.equal(a.sim.peak, b.sim.peak);
  assert.notEqual(scenario(seedOf('c03'), 1).sum, a.sum, 'une autre graine donne une autre gerbe');
});

test('V3-28 : plafonds : vivantes ≤ pool de la qualité ; quantité ×1 / ×0,5 / ×0,22 ; le réservoir plein écrase les plus anciennes', () => {
  const counts = [1, 0.5, 0.22].map((q) => { const s = createParticleSim({ pool: 100, seed: 1, quantity: q }); return s.burst({ x: 0, y: 0, n: 40 }); });
  assert.deepEqual(counts, [40, 20, 9]);
  const sim = createParticleSim({ pool: 100, seed: 1 });
  for (let i = 0; i < 20; i++) { sim.burst({ x: 0, y: 0, n: 40 }); assert.ok(sim.count <= 100 && sim.peak <= 100); }
  assert.equal(sim.count, 100);
  assert.equal(createParticleSim({ pool: 10 }).burst({ x: 0, y: 0, n: 0 }), 0);
  assert.equal(createParticleSim({ pool: 10, quantity: 0 }).burst({ x: 0, y: 0, n: 5 }), 0);
});

test('particules : 14 flottants par particule (84 Ko pour 1 500), vie qui s\'éteint, clear et reset', () => {
  assert.equal(STRIDE, 14);
  const sim = createParticleSim({ pool: 1500, seed: 9 });
  assert.equal(sim.data.byteLength, 84000);
  sim.burst({ x: 1, y: 1, n: 50, ttl: 0.5 });
  assert.equal(sim.count, 50);
  for (let i = 0; i < 60; i++) sim.update(1 / 60);
  assert.equal(sim.count, 0, 'toutes éteintes après leur durée de vie');
  sim.burst({ x: 1, y: 1, n: 5 }); sim.clear(); assert.equal(sim.count, 0);
  sim.reset(3); assert.equal(sim.peak, 0); assert.equal(sim.emitted, 0);
  for (const f of Object.values(F)) assert.ok(f >= 0 && f < STRIDE);
});

test('xorshift à graine : suite stable, dans [0, 1[ ; graine d\'un niveau = hachage de son identifiant', () => {
  const r = makeRng(42), seq = Array.from({ length: 5 }, () => r()), r2 = makeRng(42);
  assert.deepEqual(seq, Array.from({ length: 5 }, () => r2()));
  for (let i = 0; i < 10000; i++) { const v = r(); assert.ok(v >= 0 && v < 1); }
  assert.equal(seedOf('c02-melange'), seedOf('c02-melange')); assert.notEqual(seedOf('c02'), seedOf('c03')); assert.ok(seedOf('') > 0);
});

test('V3-29 : aucun Math.random, aucun Date.now, aucun performance.now dans src/render/scene/ ni dans renderer.js (commentaires ignorés)', () => {
  const dir = new URL('../../../src/render/scene/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => new URL(f, dir));
  files.push(new URL('../../../src/render/renderer.js', import.meta.url));
  assert.ok(files.length >= 9);
  for (const f of files) {
    const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(text, /Math\.random|Date\.now|performance\.now|new Date\(/, f.pathname);
    if (f.pathname.includes('/scene/')) assert.doesNotMatch(text, /\bdocument\b|\bwindow\b|getContext/,`${f.pathname} : couche pure sans DOM ni contexte`);
  }
});
