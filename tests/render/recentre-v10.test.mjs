// V10 : plateau tourné recentré verticalement entre la barre du haut et la légende / les outils (bande vide du test final, docs/qa/V8/12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardLayout, layout, recentreVertically, GAP, ZOOM_MAX } from '../../src/render/scene/layout.js';

// Rectangles mesurés dans Chrome (412×915 et 360×640, s09 11×8), arrondis : pastilles du haut, légende, outils.
const PHONE = {
  '412x915': [{ x: 12, y: 12, w: 202, h: 46 }, { x: 304, y: 12, w: 96, h: 46 }, { x: 134, y: 797, w: 144, h: 41 }, { x: 83, y: 848, w: 246, h: 55 }],
  '360x640': [{ x: 12, y: 12, w: 202, h: 46 }, { x: 252, y: 12, w: 96, h: 46 }, { x: 108, y: 522, w: 144, h: 41 }, { x: 57, y: 572, w: 246, h: 56 }],
};
const below = (obs, L) => Math.min(...obs.filter((o) => o.y > L.y0).map((o) => o.y));
const above = (obs, L) => Math.max(...obs.filter((o) => o.y < L.y0).map((o) => o.y + o.h));

for (const [size, obstacles] of Object.entries(PHONE)) {
  const [w, h] = size.split('x').map(Number);
  for (const integerCell of [true, false]) {
    test(`${size} ${integerCell ? '2D' : 'GL'} : plateau tourné centré entre la barre du haut et la légende, case inchangée`, () => {
      const p = { w, h, cols: 11, rows: 8, obstacles, rotationObstacles: obstacles, rotation: true, integerCell };
      const L = boardLayout(p);
      assert.equal(L.rot, 1);
      const top = above(obstacles, L), bottom = below(obstacles, L);
      const gapTop = L.y0 - top, gapBottom = bottom - (L.y0 + L.boardH);
      assert.ok(Math.abs(gapTop - gapBottom) < 1e-6, `écarts ${gapTop} / ${gapBottom}`);
      const grow = (ZOOM_MAX - 1) / 2 * L.boardH;
      assert.ok(gapTop >= GAP + grow - 1e-6 && gapBottom >= GAP + grow - 1e-6, 'au zoom maximal, le plateau reste à GAP des obstacles');
      // gain V7 intact : même case qu'avant la règle (seul y0 bouge), ≥ +35 % sur le plateau non tourné en 412×915
      const flat = layout({ w, h, cols: 11, rows: 8, obstacles, integerCell });
      if (size === '412x915') assert.ok(L.cell >= flat.cell * 1.35, `gain ${(L.cell / flat.cell).toFixed(3)}`);
      assert.ok(L.x0 >= 0 && L.x0 + L.boardW <= w + 1e-6, 'aucune case hors de la largeur');
    });
  }
}

test('412×915 : la bande du haut n’est plus le double de celle du bas (avant : 132 / 72 px)', () => {
  const obstacles = PHONE['412x915'];
  const L = boardLayout({ w: 412, h: 915, cols: 11, rows: 8, obstacles, rotationObstacles: obstacles, rotation: true, integerCell: false });
  const gapTop = L.y0 - 58, gapBottom = 797 - (L.y0 + L.boardH);
  assert.ok(gapTop < 110 && gapBottom > 85, `${gapTop} / ${gapBottom}`);
});

test('obstacle hors de la colonne du plateau : ignoré ; trop serré : mise en page inchangée ; sans obstacle : centré sur l’écran', () => {
  const base = { cell: 40, x0: 100, y0: 300, boardW: 200, boardH: 400, w: 400, h: 1000, free: { l: 0, t: 0, r: 400, b: 1000 }, zoomMax: ZOOM_MAX };
  const side = [{ x: 0, y: 0, w: 50, h: 900 }]; // à gauche de la colonne
  const a = recentreVertically({ ...base, free: { ...base.free } }, side, {}, 0);
  assert.equal(a.y0, 300);
  const tight = [{ x: 0, y: 0, w: 400, h: 295 }, { x: 0, y: 705, w: 400, h: 50 }]; // 410 px libres pour 400 + 2 × (8 + 6)
  const b = recentreVertically({ ...base, free: { ...base.free } }, tight, {}, 0);
  assert.equal(b.y0, 300);
  const c = recentreVertically({ ...base, y0: 100, free: { ...base.free } }, [], {}, 0);
  assert.equal(c.y0, 300);
  assert.equal(c.free.t, 200);
});

test('victoire : le panneau compte comme borne basse (plateau entre la barre du haut et le panneau)', () => {
  const obstacles = [...PHONE['412x915'], { x: 12, y: 640, w: 388, h: 200 }];
  const L = boardLayout({ w: 412, h: 915, cols: 11, rows: 8, obstacles, rotationObstacles: PHONE['412x915'], rotation: true, integerCell: false });
  assert.equal(L.rot, 1);
  assert.ok(L.y0 + L.boardH <= 640 - GAP, 'plateau au-dessus du panneau');
  assert.ok(Math.abs((L.y0 - 58) - (640 - (L.y0 + L.boardH))) < 1e-6 || L.y0 - 58 >= 0, 'centré ou laissé tel quel');
});
