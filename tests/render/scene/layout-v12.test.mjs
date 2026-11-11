// V12 (audit responsive G1, G2, C5) : rails du paysage bas, plateau tourné qui garde la dalle WebGL à l'écart des pastilles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, boardLayout, shouldRotate, isCompact, COMPACT, SLAB_PAD, GAP, ZOOM_MAX, overlaps } from '../../../src/render/scene/layout.js';

/** Rectangles des éléments flottants du paysage bas (CSS d'index.html, relevés à 568×320 : rail gauche 108 px, outils 54 px à 8 px du bord). */
function railsObstacles(w, h, { win = false, rail = Math.min(140, 0.19 * w) } = {}) {
  const tools = { x: w - 8 - 54, y: 66, w: 54, h: 236 };
  const obs = [{ x: 12, y: 12, w: rail, h: 70 }, { x: w - 8 - 54, y: 12, w: 54, h: 46 }];
  if (win) obs.push({ x: w - 8 - Math.min(220, 0.31 * w), y: 66, w: Math.min(220, 0.31 * w), h: 230 }); // le panneau prend la place du rail des outils ; la légende disparaît
  else obs.push(tools, { x: 12, y: h - 10 - 46, w: rail, h: 46 });
  return obs;
}
const zoomed = (L) => { const g = (ZOOM_MAX - 1) / 2; return { l: L.x0 - g * L.boardW, r: L.x0 + L.boardW * (1 + g), t: L.y0 - g * L.boardH, b: L.y0 + L.boardH * (1 + g) }; };
const slabBox = (L, pad) => { const z = zoomed(L), p = pad * L.cell; return { l: z.l - p, r: z.r + p, t: z.t - p, b: z.b + p }; };

test('V12 : isCompact suit la règle CSS (paysage, hauteur <= 499 px)', () => {
  assert.equal(isCompact(568, 320), true);
  assert.equal(isCompact(640, 400), true);
  assert.equal(isCompact(915, 412), true);
  assert.equal(isCompact(1280, 499), true);
  assert.equal(isCompact(1280, 500), false);
  assert.equal(isCompact(320, 568), false);
  assert.equal(isCompact(400, 400), false);
  assert.equal(COMPACT.MAX_H, 499);
});

test('V12 (G2) : 568×320, 10×8, rails : case >= 32 px en 2D (entière) et en WebGL (dalle 0,30), plateau et dalle hors des obstacles', () => {
  const obstacles = railsObstacles(568, 320);
  const before = layout({ w: 568, h: 320, cols: 10, rows: 8, obstacles, integerCell: true });
  const c2d = layout({ w: 568, h: 320, cols: 10, rows: 8, obstacles, integerCell: true, rails: true, slack: COMPACT.SLACK });
  const cgl = layout({ w: 568, h: 320, cols: 10, rows: 8, obstacles, pad: SLAB_PAD, rails: true, slack: COMPACT.SLACK });
  assert.ok(before.cell < 30, `sans rails : ${before.cell}`);
  assert.ok(c2d.cell >= 32, `2D : ${c2d.cell}`);
  assert.ok(cgl.cell >= 32, `GL : ${cgl.cell}`);
  for (const o of obstacles) {
    assert.equal(overlaps(zoomed(c2d), o, GAP - 0.5), false, '2D : écart GAP au zoom maximal');
    assert.equal(overlaps(slabBox(cgl, SLAB_PAD), o, 0), false, 'GL : dalle hors des obstacles');
  }
  assert.ok(c2d.y0 >= 0 && c2d.y0 + c2d.boardH <= 320 && c2d.x0 >= 0 && c2d.x0 + c2d.boardW <= 568);
});

test('V12 (G1) : victoire en paysage bas (568×320, 640×360, 640×400) : le plateau reste à >= 55 % de sa case, à côté du panneau', () => {
  for (const [w, h] of [[568, 320], [640, 360], [640, 400]]) {
    for (const [cols, rows] of [[6, 4], [8, 6]]) {
      const play = layout({ w, h, cols, rows, obstacles: railsObstacles(w, h), pad: SLAB_PAD, rails: true, slack: COMPACT.SLACK });
      const obs = railsObstacles(w, h, { win: true });
      const won = layout({ w, h, cols, rows, obstacles: obs, pad: SLAB_PAD, rails: true, slack: COMPACT.SLACK });
      assert.ok(won.cell >= 0.55 * play.cell, `${w}×${h} ${cols}×${rows} : ${play.cell.toFixed(1)} → ${won.cell.toFixed(1)}`);
      for (const o of obs) assert.equal(overlaps(zoomed(won), o, 0), false, `${w}×${h} : plateau hors du panneau`);
    }
  }
});

test('V12 : sans `rails`, la mise en page est strictement celle d\'avant (bureau, portrait)', () => {
  const obs = [{ x: 12, y: 12, w: 200, h: 46 }, { x: 1180, y: 12, w: 88, h: 46 }, { x: 520, y: 732, w: 240, h: 54 }];
  for (const pad of [0, SLAB_PAD]) {
    const a = layout({ w: 1280, h: 800, cols: 10, rows: 8, obstacles: obs, pad, cornerRetreat: pad > 0 });
    const b = layout({ w: 1280, h: 800, cols: 10, rows: 8, obstacles: obs, pad, cornerRetreat: pad > 0, rails: false });
    assert.deepEqual(a, b);
  }
});

test('V12 (C5) : plateau tourné (320×568, 360×640, 10×8, WebGL) : la dalle ne touche plus les pastilles ; décision de rotation inchangée', () => {
  for (const [w, h] of [[320, 568], [360, 640], [412, 915]]) {
    const obstacles = [{ x: 12, y: 12, w: 180, h: 46 }, { x: w - 12 - 92, y: 12, w: 92, h: 46 }, { x: (w - 240) / 2, y: h - 14 - 54, w: 240, h: 54 }, { x: 16, y: h - 76 - 40, w: w - 32, h: 40 }];
    const p = { w, h, cols: 10, rows: 8, obstacles, rotation: true, pad: SLAB_PAD };
    assert.equal(shouldRotate(p), shouldRotate({ ...p, pad: 0 }), 'la dalle ne décide pas de la rotation');
    const L = boardLayout(p);
    assert.equal(L.rot, 1, `${w}×${h} tourné`);
    for (const o of obstacles) assert.equal(overlaps(slabBox(L, SLAB_PAD), o, 0), false, `${w}×${h} : dalle hors de ${JSON.stringify(o)}`);
    const L2d = boardLayout({ ...p, pad: 0, integerCell: true });
    assert.ok(L2d.cell >= 32, `${w}×${h} 2D : ${L2d.cell}`);
    assert.ok(L.cell >= 0.9 * L2d.cell, `${w}×${h} GL ${L.cell.toFixed(1)} contre 2D ${L2d.cell}`);
  }
});
