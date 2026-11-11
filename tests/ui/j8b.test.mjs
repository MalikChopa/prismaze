// J8b : disposition serrée de l'éditeur, retour visuel d'un lâcher refusé (rendu), date française du menu, icônes de la palette.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTightLayout, createRenderer } from '../../src/render/renderer.js';
import { buildBoard } from '../../src/engine/board.js';
import { trace } from '../../src/engine/trace.js';
import { frenchDate } from '../../src/ui/menu.js';
import { TOOLS, TOOL_ICONS } from '../../src/ui/editor.js';
import { shareFailureText } from '../../src/ui/share-ui.js';
import { maquette } from './helpers.mjs';

test('disposition serrée (éditeur) : le plateau remplit le canvas, centré, sans bandeau ni pied de page réservés', () => {
  for (const [w, h] of [[1100, 560], [360, 190], [412, 480], [560, 335], [1000, 700]]) {
    for (const [cols, rows] of [[8, 6], [4, 4], [12, 10]]) {
      const L = computeTightLayout(w, h, cols, rows);
      assert.ok(L.x0 >= 0 && L.y0 >= 0 && L.x0 + L.boardW <= w && L.y0 + L.boardH <= h, `${w}x${h} ${cols}x${rows} : dans le canvas`);
      assert.ok(L.cell >= 8, 'case minimale');
      const fillW = L.boardW / w, fillH = L.boardH / h;
      if (L.cell < 88) assert.ok(Math.max(fillW, fillH) > 0.82, `${w}x${h} ${cols}x${rows} : une dimension est presque pleine (${fillW.toFixed(2)} / ${fillH.toFixed(2)})`);
      assert.equal(Math.abs(L.x0 - (w - L.boardW) / 2) <= 0.5, true, 'centré en largeur');
      assert.equal(Math.abs(L.y0 - (h - L.boardH) / 2) <= 0.5, true, 'centré en hauteur');
      assert.equal(L.footH, 0);
    }
  }
  // le défaut de J8b : même taille d'écran, l'éditeur gagnait peu : 360x640 portrait, canvas de 340 x 200
  assert.ok(computeTightLayout(344, 200, 8, 6).cell >= 31, '344x200 : cases d\'au moins 31 px');
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

test('lâcher refusé : cadre rose et croix sur la case, mouvement de la pièce, fin au bout de 900 ms, statique en mouvement réduit', () => {
  const run = (reduced) => {
    const log = [], slog = [];
    const r = createRenderer(fakeCanvas(1280, 720, log), { makeCanvas: (w, h) => fakeCanvas(w, h, slog) });
    r.resize();
    r.setReducedMotion(reduced);
    const s = maquette();
    const result = trace(buildBoard(s));
    const mob = s.pieces.find((p) => p.type === 'mirror' && !p.fixed);
    const frame = (info) => { log.length = 0; r.render(s, result, info); return log.slice(); };
    const rects = (l) => l.filter((c) => c[0] === 'strokeRect' && c[1] === '#ff8aa0');
    const base = frame({ now: 1 });
    assert.equal(rects(base).length, 0, 'sans refus : aucun cadre rose');
    const refuse = { id: mob.id, from: { c: mob.c, r: mob.r }, at: { c: 2, r: 0 }, t0: null, reason: 'occupied' };
    const f0 = frame({ now: 1000, refuse });
    assert.equal(refuse.t0, 1000, 'la première image fixe l\'horloge du retour');
    assert.equal(rects(f0).length, 1, 'cadre rose sur la case refusée');
    assert.ok(f0.filter((c) => c[0] === 'lineTo').length >= 2, 'croix tracée');
    assert.equal(r.animating, true, 'des images sont demandées pendant le retour');
    const imgs = (l) => l.filter((c) => c[0] === 'drawImage').map((c) => c.slice(3).join(','));
    const early = imgs(frame({ now: 1050, refuse }));
    const mid = imgs(frame({ now: 1300, refuse }));
    const steady = imgs(frame({ now: 1000 + 950, refuse }));
    if (reduced) assert.deepEqual(early, steady, 'mouvement réduit : la pièce ne bouge pas');
    else { assert.notDeepEqual(early, steady, 'la pièce glisse au début'); assert.notDeepEqual(mid, steady, 'puis tremble'); }
    assert.equal(rects(frame({ now: 1000 + 950, refuse })).length, 0, 'au bout de 900 ms : plus de cadre');
    assert.equal(r.animating, false, 'plus aucune image demandée à la fin');
    // hors du plateau : la case marquée est celle d'origine
    const out = { id: mob.id, from: { c: mob.c, r: mob.r }, at: null, t0: null, reason: 'outside' };
    const fo = frame({ now: 5000, refuse: out });
    assert.equal(rects(fo).length, 1, 'hors du plateau : la case d\'origine est marquée');
    assert.deepEqual(fo.find((c) => c[0] === 'strokeRect' && c[1] === '#ff8aa0').slice(3, 5).map(Math.round), [mob.c * r.layout.cell + 3, mob.r * r.layout.cell + 3].map(Math.round));
  };
  run(false);
  run(true);
});

test('menu : date du défi en français (UTC), forme inconnue renvoyée telle quelle', () => {
  assert.equal(frenchDate('2026-11-08'), '8 novembre 2026');
  assert.equal(frenchDate('2027-01-01'), '1er janvier 2027');
  assert.equal(frenchDate('2026-12-31'), '31 décembre 2026');
  assert.equal(frenchDate('2026-13-01'), '2026-13-01');
  assert.equal(frenchDate('n\'importe quoi'), 'n\'importe quoi');
});

test('éditeur : une icône dessinée pour chaque outil, l\'outil d\'effacement s\'appelle « Effacer »', () => {
  for (const t of TOOLS) assert.ok(typeof TOOL_ICONS[t.id] === 'string' && TOOL_ICONS[t.id].length > 20, `icône de ${t.id}`);
  assert.equal(TOOLS.find((t) => t.id === 'erase').label, 'Effacer');
  assert.equal(TOOLS.length, 11);
  for (const svg of Object.values(TOOL_ICONS)) assert.ok(!/<script|on\w+=/i.test(svg), 'dessins constants, sans script');
});

test('lien invalide : message sans aucune partie du lien', () => {
  assert.equal(shareFailureText({ reason: 'invalid' }), 'Lien invalide.');
  assert.match(shareFailureText({ reason: 'newer' }), /plus récente/);
});
