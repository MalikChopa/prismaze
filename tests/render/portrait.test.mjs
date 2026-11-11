// V7 : rotation du plateau en portrait (ARCHITECTURE_V3_RENDU §9, P1). Règle, gain de taille de case, vue tournée, clavier selon l'écran, Canvas 2D, second hôte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boardLayout, shouldRotate, layout, FLAGS, PORTRAIT } from '../../src/render/scene/layout.js';
import { makeView, cellAt, worldToScreen, screenToWorld, screenDirToBoard, viewCenter, cellAtClient } from '../../src/render/scene/camera.js';
import { createStage } from '../../src/ui/stage.js';
import { createKeyboardController } from '../../src/ui/input.js';
import { uiMode } from '../../src/ui/hud.js';
import { screenCellText } from '../../src/ui/a11y.js';
import { createRenderer } from '../../src/render/renderer.js';
import { createStaticLayer, staticKey } from '../../src/render/static-layer.js';
import { shippedBoards, process } from './scene/_helpers.mjs';

const P = (w, h, cols, rows, extra = {}) => ({ w, h, cols, rows, ...extra });

test('règle : portrait, plateau ≥ 1,2:1, gain ≥ 15 % ; sinon jamais', () => {
  for (const [w, h, c, r, want] of [
    [412, 915, 10, 8, true], [360, 640, 10, 8, true], [412, 915, 8, 6, true], [412, 915, 7, 5, true], [412, 915, 6, 4, true], [412, 915, 9, 7, true], [412, 915, 6, 5, true], [768, 1024, 10, 8, true],
    [412, 915, 9, 8, false], [412, 915, 5, 5, false], [412, 915, 8, 7, false], [412, 915, 4, 6, false], // carrés ou presque, plateau plus haut que large
    [915, 412, 10, 8, false], [1280, 800, 10, 8, false], [800, 800, 10, 8, false], [800, 840, 10, 8, false], // paysage, carré, à peine portrait (800 >= 0,95 × 840)
  ]) assert.equal(shouldRotate(P(w, h, c, r)), want, `${w}x${h} ${c}x${r}`);
  assert.equal(PORTRAIT.MIN_GAIN, 1.15);
});

test('règle : aucun gain assez grand (hauteur limitante) → pas de rotation', () => {
  const obstacles = [{ x: 0, y: 0, w: 412, h: 400 }, { x: 0, y: 700, w: 412, h: 215 }]; // obstacles haut et bas énormes : presque plus de hauteur
  assert.equal(shouldRotate(P(412, 915, 10, 8, { obstacles })), false);
});

test('drapeau FLAGS.portraitRotation : éteint → aucune rotation', () => {
  FLAGS.portraitRotation = false;
  try { assert.equal(shouldRotate(P(412, 915, 10, 8)), false); assert.equal(boardLayout(P(412, 915, 10, 8, { rotation: true })).rot, 0); } finally { FLAGS.portraitRotation = true; }
});

test('panneau de victoire large au-dessus du dock (360×640, 6×4 tourné) : il borne la hauteur, le plateau garde une taille raisonnable', () => {
  // cas réel mesuré : panneau 453-564 px, dock en dessous ; avant correction, `nearestSide` choisissait « gauche » et la case tombait à 1 px
  const obstacles = [{ x: 12, y: 453, w: 336, h: 111 }, { x: 12, y: 572, w: 336, h: 56 }, { x: 8, y: 8, w: 344, h: 44 }];
  const L = boardLayout(P(360, 640, 6, 4, { rotation: true, obstacles, rotationObstacles: [obstacles[1], obstacles[2]] }));
  assert.equal(L.rot, 1);
  assert.ok(L.cell > 40, `case ${L.cell}`);
  assert.ok(L.y0 + L.boardH <= 453, 'plateau au-dessus du panneau');
});

test("screenCellText : coordonnées vues à l'écran (colonne depuis la gauche, ligne depuis le haut), plateau tourné", () => {
  // 8 lignes, tourné : (c, r) = colonne 1 ligne 8 monde (index 0,7) → x écran = 8 − 7 = colonne 1, ligne 1
  assert.equal(screenCellText('filtre de colonne 1, ligne 8 vers colonne 10, ligne 2', 8), 'filtre de colonne 1, ligne 1 vers colonne 7, ligne 10');
});

test("screenCellText : la pente et la direction aussi sont celles vues à l'écran", () => {
  assert.equal(screenCellText('tourner le miroir de colonne 3, ligne 2 en oblique montante /', 6), 'tourner le miroir de colonne 5, ligne 3 en oblique descendante \\');
  assert.equal(screenCellText("en vertical |, émetteur blanc vers l'est", 6), 'en horizontal -, émetteur blanc vers le sud');
});

test('uiMode : joueur tourne ; ?debug ne tourne pas sauf &rot=1 ; ?rot=0 coupe', () => {
  const m = (q) => uiMode(new URLSearchParams(q));
  assert.equal(m('').rotation, true);
  assert.equal(m('?rot=0').rotation, false);
  assert.equal(m('?debug').rotation, false);
  assert.equal(m('?debug&camera=1').rotation, false);
  assert.equal(m('?debug&camera=1&rot=1').rotation, true);
});

test('gain mesuré à 412×915 (sans obstacles) : ≥ 35 % en 10×8, en GL et en 2D', () => {
  for (const integerCell of [false, true]) {
    const flat = layout(P(412, 915, 10, 8, { integerCell })), turned = boardLayout(P(412, 915, 10, 8, { integerCell, rotation: true }));
    assert.equal(turned.rot, 1);
    assert.ok(turned.cell / flat.cell >= 1.35, `${integerCell ? '2D' : 'GL'} ${flat.cell} → ${turned.cell}`);
    assert.equal(turned.boardW, turned.cell * 8);
    assert.equal(turned.boardH, turned.cell * 10);
  }
});

test('à la pose maximale (zoom 1,03) le plateau tourné reste dans la fenêtre', () => {
  const L = boardLayout(P(412, 915, 10, 8, { rotation: true }));
  assert.ok(L.boardW * 1.03 < 412 && L.x0 - (L.boardW * 0.03) / 2 >= 0);
});

test('vue tournée : colonne 0 en haut, ligne 0 à droite ; aller-retour monde → écran → case exact', () => {
  const L = boardLayout(P(412, 915, 10, 8, { rotation: true }));
  const V = makeView(L, 1.02, 3, -2, 10, 8);
  assert.equal(V.rot, 1);
  const a = worldToScreen(V, 0.5, 0.5), b = worldToScreen(V, 9.5, 0.5), c = worldToScreen(V, 0.5, 7.5);
  assert.ok(b[1] > a[1] && Math.abs(b[0] - a[0]) < 1e-6, 'colonne croissante : vers le bas de l\'écran');
  assert.ok(c[0] < a[0] && Math.abs(c[1] - a[1]) < 1e-6, 'ligne croissante : vers la gauche de l\'écran');
  const m = viewCenter(V);
  assert.ok(Math.abs(m[0] - (L.x0 + L.boardW / 2 + 3)) < 1e-6 && Math.abs(m[1] - (L.y0 + L.boardH / 2 - 2)) < 1e-6, 'centre du plateau');
  let bad = 0;
  for (let i = 0; i < 20000; i++) {
    const x = Math.random() * 10, y = Math.random() * 8;
    const s = worldToScreen(V, x, y), w = screenToWorld(V, s[0], s[1]);
    if (Math.abs(w[0] - x) > 1e-9 || Math.abs(w[1] - y) > 1e-9) bad++;
    const cell = cellAt(V, s[0], s[1]);
    if (cell === null || cell.c !== Math.floor(x) || cell.r !== Math.floor(y)) bad++;
  }
  assert.equal(bad, 0);
  assert.equal(cellAt(V, -100, -100), null);
});

test('cellAtClient : rectangle étiré pendant une transition, plateau tourné', () => {
  const L = boardLayout(P(412, 915, 10, 8, { rotation: true }));
  const V = makeView(L, 1, 0, 0, 10, 8);
  const s = worldToScreen(V, 2.5, 3.5);
  assert.deepEqual(cellAtClient(V, s[0] * 1.3, s[1] * 1.3, { left: 0, top: 0, width: 412 * 1.3, height: 915 * 1.3 }, { width: 412, height: 915 }), { c: 2, r: 3 });
});

test('sans rotation : `makeView` et `cellAt` inchangés', () => {
  const L = { cell: 60, x0: 40, y0: 30, boardW: 600, boardH: 480, w: 1280, h: 800 };
  const V = makeView(L, 1, 0, 0);
  assert.equal(V.rot, 0); assert.equal(V.tx, 40); assert.equal(V.ty, 30); assert.equal(V.cols, 10); assert.equal(V.rows, 8);
  assert.deepEqual(cellAt(V, 100, 100), { c: 1, r: 1 });
});

test('flèches selon l\'écran : haut à l\'écran → vers le haut de l\'écran, plateau tourné', () => {
  const V = makeView(boardLayout(P(412, 915, 10, 8, { rotation: true })), 1, 0, 0, 10, 8);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const d = screenDirToBoard(V, dx, dy);
    const a = worldToScreen(V, 5, 4), b = worldToScreen(V, 5 + d[0], 4 + d[1]);
    assert.ok(Math.abs(Math.sign(Math.round(b[0] - a[0])) - dx) === 0 && Math.abs(Math.sign(Math.round(b[1] - a[1])) - dy) === 0, `${dx},${dy}`);
  }
  assert.deepEqual(screenDirToBoard(null, 1, 0), [1, 0]);
});

test('contrôleur clavier : boardDir appliqué au curseur', () => {
  const state = { cols: 10, rows: 8, pieces: [] };
  const seen = [];
  const kb = createKeyboardController({ getState: () => state, boardDir: (dx, dy) => [dy, -dx] }, { onCursor: (c) => seen.push(c) });
  kb.setCursor(5, 4);
  kb.key({ key: 'ArrowUp' });
  assert.deepEqual(kb.cursor, { c: 4, r: 4 }, 'flèche haut : colonne -1 (haut de l\'écran, plateau tourné)');
  kb.key({ key: 'ArrowRight' });
  assert.deepEqual(kb.cursor, { c: 4, r: 3 }, 'flèche droite : ligne -1');
});

test('scène : relayout sans panneau de victoire décide ; le plateau ne bascule pas à la victoire', () => {
  const s = createStage({ gl: true, rotation: true, enabled: false });
  const win = { x: 12, y: 350, w: 388, h: 565 };
  s.relayout({ w: 412, h: 915, cols: 10, rows: 8, obstacles: [] });
  s.frame(1000);
  assert.equal(s.view.rot, 1);
  s.relayout({ w: 412, h: 915, cols: 10, rows: 8, obstacles: [win], rotationObstacles: [], morphAt: 1200 });
  s.frame(1300);
  assert.equal(s.view.rot, 1, 'à la victoire : toujours tourné');
  assert.ok(s.layout.y0 + s.layout.boardH <= 350, 'panneau mesuré : le plateau reste au-dessus');
});

test('scène : le passage jeu → gagné glisse depuis la pose affichée (plateau tourné)', () => {
  const s = createStage({ gl: true, rotation: true });
  s.relayout({ w: 412, h: 915, cols: 10, rows: 8, obstacles: [] });
  s.frame(1000);
  const before = viewCenter(s.view);
  s.relayout({ w: 412, h: 915, cols: 10, rows: 8, obstacles: [{ x: 12, y: 500, w: 388, h: 415 }], rotationObstacles: [], morphAt: 1500, morphMs: 400 });
  s.frame(1500);
  const after = viewCenter(s.view);
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 1, 'pas de saut à t = 0');
  assert.ok(s.moving);
});

test('rotation permise = false (stage par défaut) : layout plat', () => {
  const s = createStage({ gl: true });
  s.relayout({ w: 412, h: 915, cols: 10, rows: 8, obstacles: [] });
  assert.equal(s.layout.rot, 0);
});

// ---- Canvas 2D tourné ----
function fakeCtx(log) {
  return new Proxy({}, {
    get(t, k) { if (k in t) return t[k]; if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} }); return (...a) => { log.push([k, ...a]); }; },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const fakeCanvas = (w, h, log) => { const ctx = fakeCtx(log); return { width: w, height: h, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) }; };
const board = () => { const b = shippedBoards().find((x) => x.state.cols === 10 && x.state.rows === 8); return { state: b.state, result: process(b.state).res }; };

test('Canvas 2D : le repère est tourné d\'un quart de tour, contre-rotations équilibrées, cellAt exact', () => {
  const b = board(), log = [];
  const r = createRenderer(fakeCanvas(412, 915, log), { makeCanvas: (cw, ch) => fakeCanvas(cw, ch, []) });
  r.resize();
  const L = boardLayout(P(412, 915, 10, 8, { rotation: true, integerCell: true }));
  r.render(b.state, b.result, { now: 1000, layout: L, camera: { zoom: 1, dx: 0, dy: 0, floorDx: 0, floorDy: 0 } });
  assert.ok(log.some((c) => c[0] === 'rotate' && Math.abs(c[1] - Math.PI / 2) < 1e-9), 'contexte tourné de +90°');
  assert.ok(log.some((c) => c[0] === 'rotate' && Math.abs(c[1] + Math.PI / 2) < 1e-9), 'symboles contre-tournés');
  const saves = log.filter((c) => c[0] === 'save').length, restores = log.filter((c) => c[0] === 'restore').length;
  assert.equal(saves, restores, 'save/restore équilibrés');
  const V = makeView(L, 1, 0, 0, 10, 8), s = worldToScreen(V, 2.5, 6.5);
  assert.deepEqual(r.cellAt(s[0], s[1], b.state), { c: 2, r: 6 });
});

test('couche statique : la clé distingue le plateau tourné ; création sans erreur', () => {
  const b = board();
  assert.notEqual(staticKey(b.state, 49, 2), staticKey(b.state, 49, 2, 1));
  const layer = createStaticLayer(b.state, 49, 2, (cw, ch) => fakeCanvas(cw, ch, []), 1);
  assert.equal(layer.key, staticKey(b.state, 49, 2, 1));
});

// ---- correctif du second hôte (V7, tâche 0) ----
test('un seul hôte : main.js le crée d\'après le réglage du joueur, app.js n\'en recrée pas si on lui en donne un', () => {
  const main = fs.readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8'), app = fs.readFileSync(new URL('../../src/ui/app.js', import.meta.url), 'utf8');
  assert.match(main, /createHost\(\{ doc: document, win: window, params: rendererParams\(params, store\.settings\.renderer\) \}\)/);
  assert.match(app, /const host = deps\.host \|\| createHost\(/);
  assert.doesNotMatch(app, /deps\.host\.destroy/);
});
