// Parité du rendu Canvas 2D (V3-7, V3-8, V3-37) : l'anneau de croisement ne marque que les cases coupées ; les voies sont dessinées ; budget D5 tenu.
// Faux contexte 2D qui enregistre les appels (comme tests/render-draw.test.mjs) ; le rendu réel est jugé sur les captures de docs/qa/V2/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer } from '../../../src/render/renderer.js';
import { shippedBoards, process } from './_helpers.mjs';

function fakeCtx(log) {
  const st = {};
  return new Proxy(st, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...args) => { log.push([k, ...args]); };
    },
    set(t, k, v) { if (typeof v === 'number') assert.ok(Number.isFinite(v), `${String(k)} = ${v}`); t[k] = v; return true; },
  });
}
const fakeCanvas = (w, h, log) => { const ctx = fakeCtx(log); return { width: w, height: h, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) }; };

function drawLevel(state, res, w = 1280, h = 720) {
  const log = [], slog = [];
  const r = createRenderer(fakeCanvas(w, h, log), { makeCanvas: (cw, ch) => fakeCanvas(cw, ch, slog) });
  r.resize();
  r.render(state, res, { now: 1000 });
  return { r, log };
}
/** Cases (index) où un anneau de croisement (image carrée de 0,44 case) est posé. */
function ringCells(log, cell, cols) {
  const rs = 0.44 * cell, out = [];
  for (const c of log) if (c[0] === 'drawImage' && c.length === 6 && Math.abs(c[4] - rs) < 1e-6 && Math.abs(c[5] - rs) < 1e-6) {
    out.push(Math.round((c[2] + rs / 2) / cell - 0.5) + cols * Math.round((c[3] + rs / 2) / cell - 0.5));
  }
  return out.sort((a, b) => a - b);
}

test('2D : l\'anneau de croisement se pose sur les 3 cases coupées du jeu et nulle part ailleurs (50 niveaux)', () => {
  const found = [];
  for (const { id, state } of shippedBoards()) {
    const { b, res } = process(state);
    const { r, log } = drawLevel(state, res);
    const rings = ringCells(log, r.layout.cell, state.cols);
    if (rings.length) found.push(`${id}:${rings.map((c) => `(${c % state.cols},${(c / state.cols) | 0})`).join('')}`);
    void b;
  }
  assert.deepEqual(found, ['p09:(7,6)', 's10:(6,1)', 'x10:(4,6)']);
});

test('2D : budget D5 (≤ 500 drawImage par image) tenu sur les 50 niveaux gagnés, voies et coupures comprises, à 360×640 comme à 1920×1080', () => {
  let max = 0;
  for (const { id, state } of shippedBoards()) {
    const { res } = process(state);
    for (const [w, h] of [[360, 640], [1920, 1080]]) {
      const { log } = drawLevel(state, res, w, h);
      const n = log.filter((c) => c[0] === 'drawImage').length;
      max = Math.max(max, n);
      assert.ok(n <= 500, `${id} ${w}x${h} : ${n} drawImage`);
    }
  }
  assert.ok(max > 20);
});

test('2D : c02 dessine ses voies (bandes décalées de la case) et des biseaux en marches ; p09 : le faisceau horizontal est interrompu autour de la case coupée', () => {
  const c02 = shippedBoards().find((x) => x.id === 'c02'), { res } = process(c02.state);
  const { log } = drawLevel(c02.state, res);
  const cell0 = 88, steps = log.filter((c) => c[0] === 'drawImage' && c.length === 6 && Math.abs(c[4] - 0.0625 * cell0) < 1e-3 && Math.abs(c[5] - 0.92 * cell0) < 1e-3);
  assert.ok(steps.length >= 8, `marches de biseau (0,25 case en 4 marches) : ${steps.length}`);
  const p09 = shippedBoards().find((x) => x.id === 'p09');
  const { res: r2 } = process(p09.state);
  const env = drawLevel(p09.state, r2), cell = env.r.layout.cell;
  // bande large couchée (hauteur = beamWide·cell) : aucune ne couvre le centre de la case (7,6) à ±0,18 case
  const cx = 7.5 * cell, cy = 6.5 * cell, wide = 0.92 * cell;
  const covering = env.log.filter((c) => c[0] === 'drawImage' && c.length === 6 && Math.abs(c[5] - wide) < 1e-3 && Math.abs(c[3] + c[5] / 2 - cy) < 1e-3 && c[2] < cx + 0.17 * cell && c[2] + c[4] > cx - 0.17 * cell);
  assert.equal(covering.length, 0, 'plus de bande horizontale sur la case coupée');
});

test('2D : la coupure de p09 (7,6) a bien un bord à −0,18 case (non vacuité) et un fondu en trois tranches', () => {
  const p09 = shippedBoards().find((x) => x.id === 'p09'), { res } = process(p09.state);
  const env = drawLevel(p09.state, res), cell = env.r.layout.cell, cx = 7.5 * cell, cy = 6.5 * cell, wide = 0.92 * cell;
  const bands = env.log.filter((c) => c[0] === 'drawImage' && c.length === 6 && Math.abs(c[5] - wide) < 1e-3 && Math.abs(c[3] + c[5] / 2 - cy) < 1e-3);
  const left = bands.filter((c) => Math.abs(c[2] + c[4] - (cx - 0.18 * cell)) < 1e-3), right = bands.filter((c) => Math.abs(c[2] - (cx + 0.18 * cell)) < 1e-3);
  assert.equal(left.length, 1, 'bord gauche à −0,18'); assert.equal(right.length, 1, 'bord droit à +0,18');
  const fadeSlices = bands.filter((c) => Math.abs(c[4] - 0.02 * cell) < 1e-3);
  assert.equal(fadeSlices.length, 6, '3 tranches de fondu de 0,02 case de chaque côté');
});
