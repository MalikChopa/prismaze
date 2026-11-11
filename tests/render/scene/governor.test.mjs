// Gouverneur de qualité (V3-5) : le code de référence du document, rejoué sur les traces simulées du document (durées en temps réel = somme des dt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernor, startLevel, GOVERNOR, HOLD_MS } from '../../../src/render/scene/governor.js';

/** Simule jusqu'à maxMs ; renvoie { final, at: [secondes des baisses] }. dtAt(i, t, niveau) → durée de l'image ; events : [{at, ms}] → hold. */
function run(dtAt, { maxMs = 60000, start = 0, events = [] } = {}) {
  const g = createGovernor(start), at = [];
  let t = 0, i = 0, prev = start, ev = 0;
  const sorted = events.slice().sort((a, b) => a.at - b.at);
  while (t < maxMs) {
    while (ev < sorted.length && t >= sorted[ev].at) { g.hold(t, sorted[ev].ms); ev++; }
    const dt = dtAt(i, t, g.level); t += dt; g.push(t, dt); i++;
    if (g.level !== prev) { at.push(+(t / 1000).toFixed(1)); prev = g.level; }
  }
  return { final: g.level, at };
}
const jitter = (i) => 16.7 + ((((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1) % 1) * 1.5;

test('V3-5 : constantes du document', () => {
  assert.deepEqual({ ...GOVERNOR }, { WINDOW_MS: 1500, MIN_FRAMES: 8, P95_MAX: 20, STRIKES: 3, WARMUP_MS: 500, START_WARMUP_MS: 1000, CAP_MS: 250 });
  assert.equal(startLevel(true), 1); assert.equal(startLevel(false), 0);
  assert.ok(HOLD_MS.victory >= 3600 + 1000);
});

test('V3-5 : AUCUNE baisse (gigue, images lentes isolées, compilation, onglet caché, victoire, 120 Hz)', () => {
  const none = (name, r) => assert.deepEqual(r, { final: 0, at: [] }, name);
  none('gigue', run(jitter));
  none('3 images de 32 ms par seconde', run((i) => (i % 20 === 0 ? 32 : 16.7)));
  none('image de 80 ms toutes les 0,5 s', run((i) => (i % 30 === 0 ? 80 : 16.7)));
  none('compilation de 400 ms', run((i) => (i === 5 ? 400 : 16.7)));
  none('onglet caché 1 s avec hold', run((i, t) => (t > 10000 && t < 10030 ? 1000 : 16.7), { events: [{ at: 10000, ms: 1000 }] }));
  none('onglet caché 60 s sans événement (une image plafonnée)', run((i, t) => (t > 10000 && t < 10030 ? 60000 : 16.7), { maxMs: 90000 }));
  none('victoire de 28 ms pendant 2 s avec hold', run((i, t) => (t > 9000 && t < 11000 ? 28 : 16.7), { events: [{ at: 9000, ms: HOLD_MS.victory }] }));
  none('victoire de 28 ms pendant 2 s sans hold', run((i, t) => (t > 9000 && t < 11000 ? 28 : 16.7)));
  none('120 Hz', run(() => 8.3));
});

const near = (got, want, tol, name) => assert.ok(Math.abs(got - want) <= tol, `${name} : ${got} attendu ${want} ± ${tol}`);

test('V3-5 : 24 ms constants → Moyen à 5,5 s et Bas à 10,5 s (critère V3-5, ± 0,5 s)', () => {
  const r = run(() => 24);
  assert.equal(r.final, 2); near(r.at[0], 5.5, 0.05, 'Moyen'); near(r.at[1], 10.5, 0.05, 'Bas');
});

test('V3-5 : les autres traces du document reproduisent leurs durées', () => {
  const cases = [
    ['33,3 ms', () => 33.3, 5.6, 10.7], ['62 ms', () => 62, 5.6, 10.8], ['300 ms', () => 300, 8.1, 15.6], ['416 ms', () => 416, 10.8, 21.2],
    ['SwiftShader 416/218/63', (i, t, lv) => [416, 218, 63][lv], 10.8, 16.5], ['4 images de 32 ms par seconde', (i) => (i % 15 === 0 ? 32 : 16.7), 5.5, 10.6],
  ];
  for (const [name, dt, a, b] of cases) {
    const r = run(dt, { maxMs: 120000 });
    assert.equal(r.final, 2, name); near(r.at[0], a, 0.05, `${name} Moyen`); near(r.at[1], b, 0.05, `${name} Bas`);
  }
});

test('V3-5 : tactile (départ Moyen) : 24 ms → Bas à 5,5 s ; 16,7 ms → reste Moyen ; 22 ms pendant 2 s toutes les 10 s → une baisse à 43 s', () => {
  const t24 = run(() => 24, { start: 1 }); assert.equal(t24.final, 2); near(t24.at[0], 5.5, 0.05, 'Bas');
  assert.deepEqual(run(() => 16.7, { start: 1 }), { final: 1, at: [] });
  const bruit = run((i, t) => (t % 10000 < 2000 ? 22 : 16.7)); assert.equal(bruit.final, 1); near(bruit.at[0], 43.2, 0.1, 'bruit externe');
});

test('V3-5 : jamais de remontée, jamais au-delà de Bas, durée plafonnée à 250 ms', () => {
  const g = createGovernor(0);
  let t = 0, last = 0;
  for (let i = 0; i < 6000; i++) { const dt = i < 2000 ? 100 : 5; t += dt; const l = g.push(t, dt); assert.ok(l >= last && l <= 2); last = l; }
  assert.equal(last, 2);
  const h = createGovernor(0); h.push(2000, 1e9); h.hold(2000, 100); assert.equal(h.level, 0, 'une durée énorme ne baisse pas toute seule');
});

test('V3-5 : hold oublie la fenêtre et suspend le comptage', () => {
  const g = createGovernor(0);
  let t = 0;
  for (let i = 0; i < 40; i++) { t += 24; g.push(t, 24); }
  g.hold(t, 5000);
  const until = t + 5000;
  while (t < until) { t += 24; g.push(t, 24); }
  assert.equal(g.level, 0, 'rien compté pendant le hold');
});
