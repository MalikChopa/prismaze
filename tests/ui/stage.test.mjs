// V5 : câblage de la scène immersive (src/ui/stage.js) : mise en page à obstacles, caméra, borne de pose, projection pointeur → case (V3-17, V3-18, V3-19, V3-38).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStage, MORPH_MS } from '../../src/ui/stage.js';
import { CAMERA } from '../../src/render/scene/camera.js';

const SIZES = [[1280, 800], [1920, 1080], [412, 915], [360, 640], [915, 412], [1280, 720], [1024, 768]];
const DOCK = (w, h) => (h < 500 ? { x: w - 62, y: (h - 232) / 2, w: 54, h: 232 } : { x: (w - 244) / 2, y: h - 66, w: 244, h: 52 });
const obstaclesFor = (w, h) => [{ x: 12, y: 12, w: 160, h: 46 }, { x: w - 110, y: 12, w: 98, h: 46 }, DOCK(w, h), { x: (w - 180) / 2, y: h - 110, w: 180, h: 30 }];
const boardBox = (V) => ({ l: V.tx, t: V.ty, r: V.tx + V.k * V.cols, b: V.ty + V.k * V.rows });
const hit = (b, o) => o.x < b.r && o.x + o.w > b.l && o.y < b.b && o.y + o.h > b.t;

test('V3-38 : à aucune pose de la caméra, un élément flottant ne recouvre le plateau (7 tailles, 10×8 et 12×10)', () => {
  for (const [w, h] of SIZES) for (const [cols, rows] of [[10, 8], [12, 10]]) {
    const obstacles = obstaclesFor(w, h);
    const st = createStage({ gl: true });
    st.relayout({ w, h, cols, rows, obstacles });
    let t = 0, poses = 0;
    for (const nx of [-1, 1]) for (const ny of [-1, 1]) for (let i = 0; i < 30; i++) {
      t += 100;
      st.frame(t, { pointer: { nx, ny }, target: { x: 400 * nx, y: 300 * ny }, dragging: i > 20 });
      const V = st.view;
      assert.equal(obstacles.some((o) => hit(boardBox(V), o)), false, `${w}x${h} ${cols}x${rows} pose ${poses}`);
      const b = boardBox(V);
      assert.ok(b.l >= -1e-6 && b.t >= -1e-6 && b.r <= w + 1e-6 && b.b <= h + 1e-6, `${w}x${h} ${cols}x${rows} : plateau dans la fenêtre`);
      poses++;
    }
    assert.equal(poses, 120);
  }
});

test('rendu 2D : case et origine entières ; décalage aligné sur un pixel d\'écran', () => {
  const st = createStage({ gl: false });
  st.relayout({ w: 1280, h: 800, cols: 10, rows: 8, obstacles: obstaclesFor(1280, 800) });
  const L = st.layout;
  assert.ok(Number.isInteger(L.cell) && Number.isInteger(L.x0) && Number.isInteger(L.y0));
  st.frame(1000, { pointer: { nx: 0.7, ny: -0.3 }, dpr: 2 });
  st.frame(2000, { pointer: { nx: 0.7, ny: -0.3 }, dpr: 2 });
  assert.ok(Number.isInteger(st.pose.dx * 2) && Number.isInteger(st.pose.dy * 2));
});

test('parallaxe : amplitude ≤ 1,3 % du petit côté, zoom 1 en 2D, posée puis immobile', () => {
  const st = createStage({ gl: false });
  st.relayout({ w: 1280, h: 800, cols: 10, rows: 8 });
  let t = 0;
  for (let i = 0; i < 80; i++) { t += 16; st.frame(t, { pointer: { nx: 1, ny: 0 } }); }
  assert.ok(Math.abs(st.pose.dx - CAMERA.PARALLAX * 800) < 2, `dx = ${st.pose.dx}`);
  for (let i = 0; i < 60 * 8; i++) { t += 16; st.frame(t, { pointer: { nx: 1, ny: 0 } }); }
  assert.equal(st.moving, false, 'une fois posée, plus aucune image demandée');
  assert.equal(st.pose.zoom, 1);
});

test('mouvement réduit, caméra coupée : zoom 1, décalage 0, aucun passage animé', () => {
  for (const opt of [{ reduced: true }, { enabled: false }]) {
    const st = createStage({ gl: true, ...opt });
    st.relayout({ w: 1280, h: 800, cols: 10, rows: 8 });
    st.frame(1000, { pointer: { nx: 1, ny: 1 }, target: { x: 300, y: 200 }, dragging: true });
    assert.deepEqual([st.pose.zoom, st.pose.dx, st.pose.dy], [1, 0, 0]);
    st.relayout({ w: 1280, h: 800, cols: 10, rows: 8, obstacles: [{ x: 0, y: 600, w: 1280, h: 200 }], morphAt: 2000 });
    st.frame(2001, {});
    assert.equal(st.moving, false, 'passage jeu → gagné instantané');
  }
});

test('P13 : au toucher, aucune parallaxe', () => {
  const st = createStage({ gl: false, touch: true });
  st.relayout({ w: 412, h: 915, cols: 10, rows: 8 });
  let t = 0;
  for (let i = 0; i < 40; i++) { t += 16; st.frame(t, { pointer: { nx: 1, ny: 1 } }); }
  assert.deepEqual([st.pose.dx, st.pose.dy], [0, 0]);
});

test('V3-19 : gel du décalage dès la prise, 200 ms après le lâcher', () => {
  const st = createStage({ gl: false });
  st.relayout({ w: 1280, h: 800, cols: 10, rows: 8 });
  st.camera.hold();
  let t = 1000;
  for (let i = 0; i < 20; i++) { t += 16; st.frame(t, { pointer: { nx: 1, ny: 1 } }); }
  assert.deepEqual([st.pose.dx, st.pose.dy], [0, 0], 'gelée pendant la prise');
  st.camera.release(t);
  t += 100; st.frame(t, { pointer: { nx: 1, ny: 1 } });
  assert.deepEqual([st.pose.dx, st.pose.dy], [0, 0], 'gelée 200 ms après le lâcher');
  t += 800; st.frame(t, { pointer: { nx: 1, ny: 1 } });
  assert.ok(st.pose.dx > 0, 'dégelée ensuite');
});

test('V3-19 : pointeur → case exact sous la caméra, y compris pendant un étirement CSS', () => {
  const st = createStage({ gl: true });
  st.relayout({ w: 1000, h: 800, cols: 10, rows: 8 });
  let t = 0;
  for (let i = 0; i < 50; i++) { t += 16; st.frame(t, { pointer: { nx: 0.4, ny: -0.6 } }); }
  const V = st.view;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 10; c++) {
    const x = V.tx + (c + 0.5) * V.k, y = V.ty + (r + 0.5) * V.k;
    assert.deepEqual(st.cellAt(x, y, { left: 0, top: 0, width: 1000, height: 800 }), { c, r });
    assert.deepEqual(st.cellAt(x * 1.3, y * 1.3, { left: 0, top: 0, width: 1300, height: 1040 }), { c, r }, 'canvas étiré à 130 %');
  }
  assert.equal(st.cellAt(V.tx - 2, V.ty, { left: 0, top: 0, width: 1000, height: 800 }), null);
});

test('passage jeu → gagné : part de la vue d\'avant, arrive à la pose de la nouvelle mise en page', () => {
  const st = createStage({ gl: false });
  const obstacles = obstaclesFor(1280, 800);
  st.relayout({ w: 1280, h: 800, cols: 10, rows: 8, obstacles });
  st.frame(1000, {});
  const before = st.view;
  st.relayout({ w: 1280, h: 800, cols: 10, rows: 8, obstacles: [...obstacles, { x: 360, y: 610, w: 560, h: 110 }], morphAt: 2000 });
  st.frame(2000, {});
  assert.ok(Math.abs(st.view.k - before.k) < 1e-6 && Math.abs(st.view.tx - before.tx) < 1e-6, 'première image : la vue d\'avant');
  assert.equal(st.moving, true);
  st.frame(2000 + MORPH_MS + 1, {});
  assert.equal(st.pose.zoom, 1);
  assert.equal(st.view.k, st.layout.cell);
});

test('crochet de victoire (V4) : poussée de zoom, sans effet en mouvement réduit', () => {
  const st = createStage({ gl: false });
  st.relayout({ w: 1280, h: 800, cols: 10, rows: 8 });
  st.frame(1000, {}); st.victoryPush(1000); st.frame(1140, {});
  assert.ok(st.pose.zoom > 1.1, `zoom ${st.pose.zoom}`);
  st.clearVictoryPush(); st.frame(1200, {});
  assert.ok(st.pose.zoom < 1.01);
  const r = createStage({ gl: false, reduced: true });
  r.relayout({ w: 1280, h: 800, cols: 10, rows: 8 });
  r.frame(1000, {}); r.victoryPush(1000); r.frame(1140, {});
  assert.equal(r.pose.zoom, 1);
});
