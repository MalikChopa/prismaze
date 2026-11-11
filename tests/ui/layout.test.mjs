// Disposition de l'écran de jeu (J4) : outils, légende et texte de victoire SOUS le plateau et dans la fenêtre ; tailles de case (P6) ;
// le renderer dessine le curseur, la case candidate, l'aperçu de rotation et le contour des pièces fixes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, createRenderer } from '../../src/render/renderer.js';
import { buildBoard } from '../../src/engine/board.js';
import { trace } from '../../src/engine/trace.js';
import { THEME } from '../../src/render/theme.js';
import { maquette } from './helpers.mjs';

test('disposition : outils, légende et victoire sous le plateau, dans la fenêtre, pour des écrans courants', () => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [412, 915], [360, 640], [800, 500]]) {
    for (const [cols, rows] of [[10, 6], [10, 8], [5, 5], [12, 10]]) {
      const L = computeLayout(w, h, cols, rows);
      assert.ok(L.toolsY >= L.y0 + L.boardH, `${w}x${h} ${cols}x${rows} : outils sous le plateau`);
      assert.ok(L.winY >= L.y0 + L.boardH, `${w}x${h} : le texte de victoire est SOUS le plateau`);
      assert.ok(L.captionY >= L.toolsY + 40, `${w}x${h} : la légende est sous les outils`);
      if (h >= 640 && rows <= 8) assert.ok(L.captionY < h, `${w}x${h} ${cols}x${rows} : légende dans la fenêtre (${L.captionY})`);
    }
  }
});

test('P6 : taille de case mesurée par la disposition (valeurs relevées le 2026-11-07 ; pied de page de 150 px, 112 px sous 600 px de haut)', () => {
  assert.equal(computeLayout(412, 915, 10, 8).cell, 38);
  assert.equal(computeLayout(915, 412, 10, 8).cell, 31);
  assert.equal(computeLayout(915, 412, 10, 6).cell, 41);
  assert.equal(computeLayout(1920, 1080, 10, 8).cell, 88);
  assert.equal(computeLayout(1280, 720, 10, 8).cell, 64);
});

function fakeCanvas(w, h, log) {
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...a) => { log.push([k, t.strokeStyle, t.lineWidth, ...a]); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { width: w, height: h, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) };
}

test('renderer : curseur (2 px, accent clair), curseur en main (3 px), case candidate, contour blanc d\'une pièce fixe, aperçu de rotation', () => {
  const log = [], slog = [];
  const r = createRenderer(fakeCanvas(1280, 720, log), { makeCanvas: (w, h) => fakeCanvas(w, h, slog) });
  r.resize();
  const s = maquette();
  const result = trace(buildBoard(s));
  const rects = () => log.filter((c) => c[0] === 'strokeRect');
  const frame = (info) => { log.length = 0; r.render(s, result, { now: 1, ...info }); };

  frame({});
  const base = rects().length;
  frame({ cursor: { c: 3, r: 3, holding: false } });
  assert.equal(rects().length, base + 1, 'un cadre de plus pour le curseur');
  assert.deepEqual([rects().at(-1)[1], rects().at(-1)[2]], [THEME.accentLight, 2]);
  frame({ cursor: { c: 3, r: 3, holding: true } });
  assert.equal(rects().at(-1)[2], 3, 'cadre plus épais quand une pièce est en main');
  frame({ lift: { c: 4, r: 3 } });
  assert.equal(rects().length, base + 1, 'case candidate marquée');
  frame({ flash: { c: 7, r: 4 } });
  assert.equal(rects().at(-1)[1], THEME.white, 'contour blanc sur la pièce fixe touchée');
  frame({ preview: { c: 7, r: 1, o: 0, type: 'mirror' } });
  assert.equal(rects().length, base + 1, 'aperçu : cadre pointillé autour de la pièce');
  assert.ok(log.some((c) => c[0] === 'setLineDash' && c[3] && c[3].length === 2), 'cadre de l\'aperçu en pointillés');
  frame({});
  assert.equal(rects().length, base, 'sans info, aucun cadre de plus');
});
