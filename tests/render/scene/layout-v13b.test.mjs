// V13b (relecture V13, R1 et R2) : mise en page du plateau comparée à celle de V12 (fixture : layout.js de faf131e) sur une grille de fenêtres × plateaux × voies
// (2D sans dalle, WebGL avec la dalle de 0,30 case), avec des obstacles calqués sur le CSS (pastilles du haut, outils et légende en bas ; rails en paysage bas).
// Règles : la case ne perd jamais plus de 10 % par rapport à V12 ; ni le plateau (zoom maximal, écart GAP) ni sa dalle ne recouvrent un obstacle ;
// le plateau vu (zoom maximal, dalle comprise) reste dans l'écran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardLayout, isCompact, COMPACT, SLAB_PAD, ZOOM_MAX, GAP, EDGE, overlaps } from '../../../src/render/scene/layout.js';
import * as V12 from './fixtures/layout-v12.mjs';

const WINDOWS = [[960, 540], [1024, 600], [1024, 640], [1100, 620], [1152, 648], [1280, 650], [1280, 720], [1366, 768], [1920, 1080], [568, 320], [640, 360], [667, 375], [844, 390], [915, 412], [1000, 499], [768, 1024], [820, 1180], [390, 844], [412, 915], [360, 640]];
const BOARDS = [[6, 4], [6, 5], [7, 5], [8, 5], [8, 6], [9, 5], [9, 6], [9, 7], [10, 8], [12, 3], [10, 4], [8, 3], [10, 3], [11, 3], [12, 4], [12, 5]];
const HUD_TL = [150, 180];

/** Obstacles du jeu (index.html) : disposition ordinaire ou rails du paysage bas. */
function obstaclesFor(w, h, tl) {
  if (isCompact(w, h)) {
    const rail = Math.min(140, 0.19 * w);
    return [{ x: 12, y: 12, w: rail, h: 70 }, { x: w - 8 - 54, y: 12, w: 54, h: 46 }, { x: w - 8 - 54, y: 66, w: 54, h: 236 }, { x: 12, y: h - 10 - 46, w: rail, h: 46 }];
  }
  const tlw = Math.min(tl, w * 0.45), cw = Math.min(420, w * 0.92);
  return [{ x: 12, y: 12, w: tlw, h: 46 }, { x: w - 12 - 100, y: 12, w: 100, h: 46 }, { x: (w - 246) / 2, y: h - 14 - 54, w: 246, h: 54 }, { x: (w - cw) / 2, y: h - 14 - 62 - 34, w: cw, h: 34 }];
}
const params = (w, h, cols, rows, gl, obstacles) => {
  const compact = isCompact(w, h);
  return { w, h, cols, rows, safe: {}, obstacles, rotationObstacles: obstacles, integerCell: !gl, rotation: true, pad: gl ? SLAB_PAD : 0, cornerRetreat: gl && !compact, rails: compact, slack: compact ? COMPACT.SLACK : undefined };
};
/** Écart (px) entre une boîte et un obstacle (négatif : recouvrement). */
const gapOf = (b, o) => Math.max(o.x - b.r, b.l - (o.x + o.w), o.y - b.b, b.t - (o.y + o.h));
/**
 * Case de référence : celle de V12, plafonnée par la seule contrainte ajoutée en V13 (test joueur n° 5) : le plateau vu, dalle comprise, tient dans l'écran
 * à EDGE px des bords. Là où la dalle de V12 sortait de l'écran (téléphones en portrait, plateau tourné), aucune mise en page ne peut garder la case de V12.
 */
function reference(R, w, h, pad) {
  const nw = R.boardW / R.cell, nh = R.boardH / R.cell, z = ZOOM_MAX;
  return Math.min(R.cell, (w - 2 * EDGE) / (nw * z + 2 * pad), (h - 2 * EDGE) / (nh * z + 2 * pad));
}
const seen = (L, pad) => { const g = (ZOOM_MAX - 1) / 2, px = pad * L.cell; return { l: L.x0 - g * L.boardW - px, r: L.x0 + L.boardW * (1 + g) + px, t: L.y0 - g * L.boardH - px, b: L.y0 + L.boardH * (1 + g) + px }; };

test('V13b (R1, R2) : grille fenêtres × plateaux × voies : case >= 90 % de V12, plateau et dalle hors des obstacles et dans l\'écran', () => {
  const bad = [];
  let n = 0, worst = 1;
  for (const [w, h] of WINDOWS) for (const [cols, rows] of BOARDS) for (const gl of [false, true]) for (const tl of HUD_TL) {
    const obstacles = obstaclesFor(w, h, tl);
    const p = params(w, h, cols, rows, gl, obstacles);
    const L = boardLayout(p), R = V12.boardLayout({ ...p });
    n++;
    const tag = `${w}x${h} ${cols}x${rows} ${gl ? 'gl' : '2d'} tl${tl}`;
    const ref = reference(R, w, h, gl ? SLAB_PAD : 0);
    const ratio = L.cell / ref;
    worst = Math.min(worst, ratio);
    if (ratio < 0.9) bad.push(`${tag} : case ${R.cell.toFixed(1)} (référence ${ref.toFixed(1)}) -> ${L.cell.toFixed(1)} (${Math.round((ratio - 1) * 100)} %)`);
    const board = seen(L, 0), slab = seen(L, gl ? SLAB_PAD : 0), board12 = seen(R, 0);
    for (const o of obstacles) {
      // plateau : à GAP de chaque obstacle, ou au moins aussi loin qu'en V12 (quelques cas 2D de V12 sont à 2-6 px : hérités, jamais un recouvrement)
      const g = gapOf(board, o);
      if (g < 0 || g < Math.min(GAP, gapOf(board12, o)) - 0.5) bad.push(`${tag} : plateau à ${g.toFixed(1)} px d'un obstacle ${JSON.stringify(o)} (V12 : ${gapOf(board12, o).toFixed(1)})`);
      if (gl && overlaps(slab, o, 0)) bad.push(`${tag} : dalle sur un obstacle ${JSON.stringify(o)}`);
    }
    if (slab.l < -0.5 || slab.t < -0.5 || slab.r > w + 0.5 || slab.b > h + 0.5) bad.push(`${tag} : plateau vu hors de l'écran ${JSON.stringify(slab)}`);
  }
  if (process.env.V13B_LAYOUT_LOG) console.log(`pire rapport à la référence : ${worst.toFixed(3)} sur ${n} cas`);
  assert.deepEqual(bad, [], `${bad.length} cas sur ${n} (pire rapport ${worst.toFixed(3)})`);
});
