// V5 : le rendu Canvas 2D applique `info.layout` et `info.camera` (V3-17, V3-18) ; sans eux, rien ne change (parité V2). Faux contexte qui enregistre les appels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer } from '../../src/render/renderer.js';
import { shippedBoards, process } from './scene/_helpers.mjs';

function fakeCtx(log) {
  return new Proxy({}, {
    get(t, k) { if (k in t) return t[k]; if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} }); return (...a) => { log.push([k, ...a]); }; },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const fakeCanvas = (w, h, log) => { const ctx = fakeCtx(log); return { width: w, height: h, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) }; };
function renderer(w = 1280, h = 800) { const log = []; const r = createRenderer(fakeCanvas(w, h, log), { makeCanvas: (cw, ch) => fakeCanvas(cw, ch, []) }); r.resize(); return { r, log }; }
const board = () => { const b = shippedBoards().find((x) => x.state.cols === 10 && x.state.rows === 8); return { state: b.state, result: process(b.state).res }; };
const LAYOUT = { cell: 60, x0: 40, y0: 30, boardW: 600, boardH: 480, w: 1280, h: 800 };

test('sans `info.camera` ni `info.layout` : aucun translate/scale de caméra (parité)', () => {
  const b = board();
  const { r, log } = renderer();
  r.render(b.state, b.result, { now: 1000 });
  assert.equal(log.filter((c) => c[0] === 'scale').length, 0);
  assert.notEqual(r.layout.x0, LAYOUT.x0);
});

test('`info.layout` : la mise en page donnée est utilisée telle quelle', () => {
  const b = board();
  const { r } = renderer();
  r.render(b.state, b.result, { now: 1000, layout: LAYOUT });
  assert.equal(r.layout, LAYOUT);
  assert.deepEqual(r.cellAt(40 + 90, 30 + 30, b.state), { c: 1, r: 0 });
});

test('`info.camera` : transformation autour du centre du plateau, puis cellAt inverse exactement', () => {
  const b = board();
  const { r, log } = renderer();
  const camera = { zoom: 1.2, dx: 15, dy: -10 };
  r.render(b.state, b.result, { now: 1000, layout: LAYOUT, camera });
  const scales = log.filter((c) => c[0] === 'scale');
  assert.deepEqual(scales[0].slice(1), [1.2, 1.2]);
  const cx = 40 + 300 + 15, cy = 30 + 240 - 10;
  const px = (c) => cx + (c + 0.5 - 5) * 60 * 1.2, py = (q) => cy + (q + 0.5 - 4) * 60 * 1.2;
  for (const [c, q] of [[0, 0], [9, 7], [4, 3]]) assert.deepEqual(r.cellAt(px(c), py(q), b.state), { c, r: q });
  assert.equal(r.cellAt(cx - 5.01 * 60 * 1.2, cy, b.state), null, 'hors plateau');
});

test('zoom 1 et décalage nul : aucune transformation', () => {
  const b = board();
  const { r, log } = renderer();
  r.render(b.state, b.result, { now: 1000, layout: LAYOUT, camera: { zoom: 1, dx: 0, dy: 0 } });
  assert.equal(log.filter((c) => c[0] === 'scale').length, 0);
});
