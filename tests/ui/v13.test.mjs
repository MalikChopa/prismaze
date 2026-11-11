// V13 (corrections du test joueur de l'accueil et des tailles) : fonctions pures.
// Échap du contrôleur clavier, progression de « Plein feu », marge du plateau aux bords (EDGE), centrage horizontal (défi du jour), grille de la scène très large.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createKeyboardController } from '../../src/ui/input.js';
import { computeAchievements, achievementRight } from '../../src/ui/achievements.js';
import { computeProgress } from '../../src/ui/progress.js';
import { layout, boardLayout, EDGE, GAP, ZOOM_MAX, SLAB_PAD, overlaps, CENTRE } from '../../src/render/scene/layout.js';
import { generateRoute, mulberry } from '../../src/ui/home-scene.js';

const INDEX = JSON.parse(readFileSync(new URL('../../levels/index.json', import.meta.url), 'utf8'));
const prog = (results) => computeProgress(INDEX.chapters, (id) => results[id] || null);

test('V13 (n° 1) : Échap sans pièce en main n\'est pas traité par le plateau (il devient « retour ») ; avec une prise, il l\'annule', () => {
  const state = { cols: 4, rows: 3, pieces: [{ id: 0, type: 'mirror', c: 1, r: 1, o: 0 }] };
  let cancels = 0;
  const kb = createKeyboardController({ getState: () => state }, { onCancel: () => { cancels++; } });
  assert.equal(kb.key({ key: 'Escape' }), false, 'rien à annuler : l\'appelant fait « retour »');
  kb.setCursor(1, 1);
  kb.key({ key: 'Enter' });
  assert.equal(kb.holding, true);
  assert.equal(kb.key({ key: 'Escape' }), true, 'prise annulée : une seule action');
  assert.equal(kb.holding, false);
  assert.equal(cancels, 1);
  assert.equal(kb.key({ key: 'Escape' }), false);
});

test('V13 (n° 11) : « Plein feu » montre sa progression (niveaux à 3 étoiles du chapitre le plus avancé)', () => {
  const m = INDEX.chapters[0].levels;
  const results = { [m[0]]: { done: true, best: 1, stars: 3 }, [m[1]]: { done: true, best: 1, stars: 3 }, [m[2]]: { done: true, best: 1, stars: 3 }, [m[3]]: { done: true, best: 3, stars: 2 } };
  const list = computeAchievements({ progress: prog(results), flags: { nohint: false, firsttry: false, shared: false }, dailyDates: [], today: '2026-11-11' });
  const full = list.find((a) => a.id === 'full-chapter');
  assert.equal(full.earned, false);
  assert.deepEqual(full.progress, [3, 10]);
  assert.equal(achievementRight(full), '3/10');
  const none = computeAchievements({ progress: prog({}), flags: { nohint: false, firsttry: false, shared: false }, dailyDates: [], today: '2026-11-11' }).find((a) => a.id === 'full-chapter');
  assert.equal(achievementRight(none), '—', 'rien encore : tiret');
});

const seen = (L, pad) => { const g = (ZOOM_MAX - 1) / 2, p = pad * L.cell; return { l: L.x0 - g * L.boardW - p, r: L.x0 + L.boardW * (1 + g) + p, t: L.y0 - g * L.boardH - p, b: L.y0 + L.boardH * (1 + g) + p }; };

test('V13 (n° 5) : plateau tourné en portrait (390×844, 412×915) : le plateau vu, dalle WebGL comprise, garde EDGE px jusqu\'aux bords', () => {
  for (const [w, h] of [[390, 844], [412, 915], [320, 568], [360, 640]]) {
    for (const gl of [true, false]) {
      const obstacles = [{ x: 12, y: 12, w: 140, h: 46 }, { x: w - 12 - 96, y: 12, w: 96, h: 46 }, { x: w / 2 - 120, y: h - 80, w: 240, h: 56 }];
      const L = boardLayout({ w, h, cols: 6, rows: 4, obstacles, rotation: true, pad: gl ? SLAB_PAD : 0, integerCell: !gl });
      assert.equal(L.rot, 1, `${w}×${h} : plateau tourné`);
      const s = seen(L, gl ? SLAB_PAD : 0);
      assert.ok(s.l >= EDGE - 0.01 && w - s.r >= EDGE - 0.01, `${w}×${h} ${gl ? 'GL' : '2D'} : bords ${s.l.toFixed(1)} / ${(w - s.r).toFixed(1)} px`);
    }
  }
});

test('V13 (n° 5) : bureau sans obstacle : la marge EDGE ne change rien (le jeu de 0,75 case suffit)', () => {
  const a = layout({ w: 1280, h: 800, cols: 8, rows: 7, pad: SLAB_PAD });
  const b = layout({ w: 1280, h: 800, cols: 8, rows: 7, pad: SLAB_PAD, edge: 0 });
  assert.equal(a.cell, b.cell);
  assert.equal(a.x0, b.x0);
});

test('V13 (n° 3) : longue pastille de titre en haut à gauche (défi du jour) : plateau centré si la case garde >= 90 %', () => {
  const w = 1280, h = 800;
  const pill = { x: 12, y: 12, w: 232, h: 46 };
  const obstacles = [pill, { x: w - 108, y: 12, w: 96, h: 46 }, { x: 360, y: 586, w: 560, h: 138 }, { x: 517, y: 732, w: 246, h: 54 }];
  const L = layout({ w, h, cols: 8, rows: 7, obstacles, pad: SLAB_PAD, cornerRetreat: true });
  const cx = L.x0 + L.boardW / 2;
  assert.ok(Math.abs(cx - w / 2) <= 1, `centre ${cx.toFixed(1)} (écran ${w / 2})`);
  const raw = layout({ w, h, cols: 8, rows: 7, obstacles, pad: SLAB_PAD, cornerRetreat: true, centre: false });
  assert.ok(L.cell >= raw.cell * CENTRE.KEEP - 1e-9, `case ${L.cell.toFixed(1)} >= 90 % de ${raw.cell.toFixed(1)}`);
  const g = (ZOOM_MAX - 1) / 2, p = SLAB_PAD * L.cell;
  const box = { l: L.x0 - g * L.boardW - p, r: L.x0 + L.boardW * (1 + g) + p, t: L.y0 - g * L.boardH - p, b: L.y0 + L.boardH * (1 + g) + p };
  for (const o of obstacles) assert.ok(!overlaps(box, o, GAP - 0.01), `aucun obstacle à moins de ${GAP} px`);
});

test('V13 (n° 3) : centrage trop coûteux : à case égale, le plateau se rapproche du centre sans toucher l\'obstacle', () => {
  const w = 1000, h = 800;
  const wide = { x: 12, y: 100, w: 300, h: 500 }; // grand obstacle à gauche, à mi-hauteur
  const raw = layout({ w, h, cols: 6, rows: 8, obstacles: [wide], centre: false });
  const L = layout({ w, h, cols: 6, rows: 8, obstacles: [wide] });
  assert.equal(L.cell, raw.cell, 'case gardée');
  const box = { l: L.x0 - ((ZOOM_MAX - 1) / 2) * L.boardW, r: L.x0 + L.boardW, t: L.y0, b: L.y0 + L.boardH };
  assert.ok(!overlaps(box, wide, GAP - 0.01), 'obstacle respecté');
  assert.ok(Math.abs(L.x0 + L.boardW / 2 - w / 2) <= Math.abs(raw.x0 + raw.boardW / 2 - w / 2), 'pas plus loin du centre qu\'avant');
});

test('V13 (n° 3) : paysage bas (rails) : centrage jamais appliqué (mise en page V12 inchangée)', () => {
  const obstacles = [{ x: 12, y: 12, w: 108, h: 70 }, { x: 506, y: 12, w: 54, h: 46 }, { x: 506, y: 66, w: 54, h: 236 }];
  const a = layout({ w: 568, h: 320, cols: 10, rows: 8, obstacles, rails: true, slack: 0.4 });
  const b = layout({ w: 568, h: 320, cols: 10, rows: 8, obstacles, rails: true, slack: 0.4, centre: false });
  assert.deepEqual([a.x0, a.y0, a.cell], [b.x0, b.y0, b.cell]);
});

test('V13 (n° 8) : grille très large (25 colonnes) : le parcours de la scène s\'étend sur au moins 8 colonnes', () => {
  const cols = 25, rows = 8;
  const grid = { cols, rows, ok: Array.from({ length: cols * rows }, (_, k) => (k % cols) >= 5) }; // le titre occupe les 5 premières colonnes
  let wide = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const r = generateRoute(grid, mulberry(seed), seed % 2 === 0);
    assert.ok(r !== null);
    const xs = r.map((p) => p.i);
    if (Math.max(...xs) - Math.min(...xs) + 1 >= 8) wide++;
  }
  assert.ok(wide >= 15, `${wide}/20 parcours sur au moins 8 colonnes`);
});
