// Dessin des pièces du style B (D2) : verre facetté, dégradés linéaires, contour fin. Fonctions de `ctx` pures (aucun état) :
// elles servent à fabriquer les sprites (sprites.js) et la couche statique (static-layer.js). (x, y) = coin haut gauche de la case, s = taille.
import { THEME, GEOM } from './theme.js';
import { fillSymbol, symbolPath } from './symbols.js';

const TAU = Math.PI * 2;

function roundRectPath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/**
 * Mur : pyramide de cristal sombre, alignée sur le rendu WebGL (V10, `FS_PIECE` t < 1) : quatre faces (haut la plus claire, gauche, droite, bas la plus sombre ;
 * teintes relevées sur une capture WebGL), arêtes en X jusqu'à 0,34 case, bord éclairé en haut et à gauche (lumière venue du haut à gauche de l'ÉCRAN).
 * @param {number} [rot]  1 si le plateau est affiché tourné : l'éclairage reste lu depuis l'écran (comme en WebGL)
 */
export function drawWall(ctx, x, y, s, rot = 0) {
  const i = 0.06 * s, w = s - 2 * i, cx = x + s / 2, cy = y + s / 2, r = 0.08 * s, a = 0.34 * s;
  ctx.save();
  if (rot === 1) { ctx.translate(cx, cy); ctx.rotate(-Math.PI / 2); ctx.translate(-cx, -cy); } // contre-rotation : faces lues depuis l'écran
  roundRectPath(ctx, x + i, y + i, w, w, r);
  ctx.clip();
  const x0 = x + i, y0 = y + i, x1 = x + s - i, y1 = y + s - i;
  for (const [fill, ax, ay, bx, by] of [['#33375a', x0, y0, x1, y0], ['#262a49', x0, y0, x0, y1], ['#25273c', x1, y0, x1, y1], ['#191b2b', x0, y1, x1, y1]]) {
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ax, ay); ctx.lineTo(bx, by); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(cx - a, cy - a); ctx.lineTo(cx + a, cy + a); ctx.moveTo(cx + a, cy - a); ctx.lineTo(cx - a, cy + a);
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(150,160,255,0.20)'; ctx.stroke();
  ctx.restore();
  ctx.save();
  if (rot === 1) { ctx.translate(cx, cy); ctx.rotate(-Math.PI / 2); ctx.translate(-cx, -cy); }
  roundRectPath(ctx, x + i, y + i, w, w, r);
  ctx.lineWidth = 1; ctx.strokeStyle = THEME.wallStroke; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x0 + r, y0 + 0.75); ctx.lineTo(x1 - r, y0 + 0.75); ctx.moveTo(x0 + 0.75, y0 + r); ctx.lineTo(x0 + 0.75, y1 - r); // bord éclairé (haut, gauche)
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(170,176,240,0.55)'; ctx.stroke();
  ctx.restore();
}

/** Tuile de verre d'une pièce mobile : dégradé diagonal, deux facettes, contour 1,4 px. */
export function drawTile(ctx, x, y, s, selected = false) {
  const i = GEOM.tileInset * s, w = s - 2 * i, r = GEOM.tileRadius * s;
  const g = ctx.createLinearGradient(x + i, y + i, x + s - i, y + s - i);
  g.addColorStop(0, 'rgba(90,99,201,0.55)'); g.addColorStop(1, 'rgba(28,30,82,0.85)');
  roundRectPath(ctx, x + i, y + i, w, w, r);
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip(); // facettes : un reflet clair en haut à gauche, une ombre en bas à droite
  ctx.beginPath(); ctx.moveTo(x + i, y + i); ctx.lineTo(x + s * 0.62, y + i); ctx.lineTo(x + i, y + s * 0.62); ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + s - i, y + s - i); ctx.lineTo(x + s * 0.45, y + s - i); ctx.lineTo(x + s - i, y + s * 0.45); ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,12,0.2)'; ctx.fill();
  ctx.restore();
  roundRectPath(ctx, x + i, y + i, w, w, r);
  ctx.lineWidth = Math.max(1, 1.4 / 62 * s); ctx.strokeStyle = selected ? THEME.accentLight : THEME.glassContour; ctx.stroke();
}

/** Quatre points aux coins : marque d'une pièce fixe (pas de tuile). */
export function drawFixedDots(ctx, cx, cy, s) {
  ctx.fillStyle = THEME.fixedDot;
  const a = 25 / 62 * s, r = Math.max(1.2, 1.8 / 62 * s);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.arc(cx + sx * a, cy + sy * a, r, 0, TAU); ctx.fill(); }
}

const LINE = [[-1, 0, 1, 0], [-1, 1, 1, -1], [0, -1, 0, 1], [-1, -1, 1, 1]]; // '-' '/' '|' '\' (dirs.js ORIENT_CHARS)

/** Trait de miroir d'orientation o (0..3), centré en (cx, cy) : cœur blanc et halo large. */
export function drawMirrorLine(ctx, cx, cy, s, o, alpha = 1) {
  const [ax, ay, bx, by] = LINE[o & 3], h = GEOM.mirrorHalf * s;
  ctx.lineCap = 'round';
  ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.moveTo(cx + ax * h, cy + ay * h); ctx.lineTo(cx + bx * h, cy + by * h);
  ctx.strokeStyle = 'rgba(185,192,255,0.28)'; ctx.lineWidth = GEOM.mirrorHalo * s; ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, GEOM.mirrorWidth * s); ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Losange translucide du séparateur (la lumière traverse ET se réfléchit). */
export function drawSplitterBase(ctx, cx, cy, s) {
  const r = 17 / 62 * s;
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath();
  ctx.fillStyle = 'rgba(200,206,255,0.16)'; ctx.fill();
  ctx.lineWidth = Math.max(1, 1.4 / 62 * s); ctx.strokeStyle = '#cfd4ff'; ctx.stroke();
}

/** Prisme (aucune orientation, E4) : triangle de verre clair, reflets, bandes R/V/B qui rappellent la dispersion. */
export function drawPrism(ctx, cx, cy, s) {
  const u = s / 62;
  const g = ctx.createLinearGradient(cx - 24 * u, cy - 20 * u, cx + 26 * u, cy + 20 * u);
  g.addColorStop(0, 'rgba(217,221,255,0.7)'); g.addColorStop(0.5, 'rgba(143,148,232,0.55)'); g.addColorStop(1, 'rgba(60,63,146,0.8)');
  ctx.beginPath(); ctx.moveTo(cx - 24 * u, cy + 20 * u); ctx.lineTo(cx + 26 * u, cy); ctx.lineTo(cx - 24 * u, cy - 20 * u); ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.globalAlpha = 0.42;
  const h = [THEME.hues[1], THEME.hues[2], THEME.hues[4]];
  for (let k = 0; k < 3; k++) { ctx.fillStyle = h[k]; ctx.fillRect(cx + 4 * u, cy + (k - 1.5) * 6 * u, 24 * u, 6 * u); }
  ctx.restore();
  ctx.lineWidth = Math.max(1, 1.4 * u); ctx.strokeStyle = '#e8ebff';
  ctx.beginPath(); ctx.moveTo(cx - 24 * u, cy + 20 * u); ctx.lineTo(cx + 26 * u, cy); ctx.lineTo(cx - 24 * u, cy - 20 * u); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 24 * u, cy + 20 * u); ctx.lineTo(cx + 8 * u, cy - 4 * u); ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 26 * u, cy); ctx.lineTo(cx + 8 * u, cy - 4 * u); ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.stroke();
}

/** Filtre de couleur `mask` : plaque teintée, reflet, symbole de la couleur au centre (D6). */
export function drawFilter(ctx, x, y, s, mask) {
  const i = 7 / 62 * s, w = s - 2 * i, hue = THEME.hues[mask];
  roundRectPath(ctx, x + i, y + i, w, w, 7 / 62 * s);
  ctx.globalAlpha = 0.24; ctx.fillStyle = hue; ctx.fill(); ctx.globalAlpha = 1;
  ctx.save(); ctx.clip(); // V10 : vitrail comme en WebGL (verre teinté plus clair en haut à gauche, plombs en X) : un verre coloré que sa couleur traverse
  const sh = ctx.createLinearGradient(x + i, y + i, x + s - i, y + s - i); sh.addColorStop(0, 'rgba(255,255,255,0.10)'); sh.addColorStop(0.6, 'rgba(255,255,255,0)'); ctx.fillStyle = sh; ctx.fillRect(x, y, s, s);
  const a = 0.34 * s, cx = x + s / 2, cy = y + s / 2;
  ctx.beginPath(); ctx.moveTo(cx - a, cy - a); ctx.lineTo(cx + a, cy + a); ctx.moveTo(cx + a, cy - a); ctx.lineTo(cx - a, cy + a);
  ctx.lineWidth = Math.max(1, 1.4 / 62 * s); ctx.strokeStyle = 'rgba(6,7,20,0.45)'; ctx.stroke(); ctx.restore();
  roundRectPath(ctx, x + i, y + i, w, w, 7 / 62 * s);
  ctx.lineWidth = Math.max(1.2, 1.6 / 62 * s); ctx.strokeStyle = hue; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + i + 5 / 62 * s, y + i + 5 / 62 * s); ctx.lineTo(x + i + 17 / 62 * s, y + i + 5 / 62 * s);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = 'rgba(6,7,20,0.75)'; fillSymbol(ctx, mask, x + s / 2, y + s / 2, GEOM.glyph * s * 1.18); // liseré sombre du glyphe (contraste sur les plombs)
  ctx.fillStyle = hue; fillSymbol(ctx, mask, x + s / 2, y + s / 2, GEOM.glyph * s);
}

const DIRS = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // E, N, W, S : rotation du canevas (y vers le bas)

/** Émetteur de couleur `mask` tourné vers `dir` : boîte sombre au contour teinté, point blanc, symbole de la couleur. */
export function drawEmitter(ctx, cx, cy, s, dir, mask) {
  const u = s / 62, hue = THEME.hues[mask];
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(DIRS[dir & 3]);
  ctx.beginPath(); ctx.moveTo(-24 * u, -15 * u); ctx.lineTo(-4 * u, -22 * u); ctx.lineTo(10 * u, 0); ctx.lineTo(-4 * u, 22 * u); ctx.lineTo(-24 * u, 15 * u); ctx.closePath();
  ctx.fillStyle = '#0d0e2a'; ctx.fill();
  ctx.lineWidth = Math.max(1.4, 1.8 * u); ctx.strokeStyle = hue; ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(cx, cy, 4.6 * u, 0, TAU); ctx.fill();
  const bx = cx - Math.cos(DIRS[dir & 3]) * 14 * u, by = cy - Math.sin(DIRS[dir & 3]) * 14 * u; // symbole derrière le centre
  ctx.fillStyle = hue; fillSymbol(ctx, mask, bx, by, 5.2 * u);
}

/** Portail de la paire `pair` (0..3) : deux anneaux et pair+1 points (D6). */
export function drawPortal(ctx, cx, cy, s, pair) {
  const u = s / 62, hue = THEME.portalHues[pair & 3];
  ctx.beginPath(); ctx.arc(cx, cy, 23 * u, 0, TAU); ctx.fillStyle = 'rgba(8,8,30,0.7)'; ctx.fill();
  ctx.lineWidth = Math.max(1.6, 2.4 * u); ctx.strokeStyle = hue; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 14 * u, 0, TAU); ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1, 1.4 * u); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.fillStyle = hue;
  const n = (pair & 3) + 1;
  for (let k = 0; k < n; k++) { ctx.beginPath(); ctx.arc(cx + (k - (n - 1) / 2) * 6.5 * u, cy, 2.3 * u, 0, TAU); ctx.fill(); }
}

/** Pastilles (porte et cible liée, D6) : n petits points ambrés alignés sous le centre. */
export function drawPastilles(ctx, cx, y, s, n) {
  const u = s / 62;
  ctx.fillStyle = THEME.gate;
  for (let k = 0; k < n; k++) { ctx.beginPath(); ctx.arc(cx + (k - (n - 1) / 2) * 7 * u, y, 2.3 * u, 0, TAU); ctx.fill(); }
}

/**
 * Lien porte -> cible liée (couche statique, derrière faisceaux et pièces) : trait pointillé fin, couleur des pastilles. Il s'arrête à 0,4 case
 * des deux centres pour ne pas passer sous le panneau de la porte ni sous l'hexagone de la cible. Rien n'est dessiné si les deux sont dans la même case.
 */
export function drawGateLink(ctx, x0, y0, x1, y1, s) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), gap = 0.4 * s;
  if (!(len > 2 * gap + 0.05 * s)) return;
  const ux = dx / len, uy = dy / len, u = s / 62;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0 + ux * gap, y0 + uy * gap);
  ctx.lineTo(x1 - ux * gap, y1 - uy * gap);
  ctx.setLineDash([0.1, 6 * u]);
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.6, 2.2 * u);
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = THEME.gate;
  ctx.stroke();
  ctx.restore();
}

/** Porte n° n : fermée = panneau plein hachuré (un mur), ouverte = contour pointillé. `fade` (0..1) : opacité du panneau (dissolution). */
export function drawGate(ctx, x, y, s, n, open, fade = 1) {
  const u = s / 62, i = 9 * u, w = s - 2 * i;
  if (!open || fade > 0) {
    ctx.save();
    ctx.globalAlpha = open ? fade : 1;
    roundRectPath(ctx, x + i, y + i, w, w, 5 * u);
    ctx.fillStyle = 'rgba(255,180,84,0.2)'; ctx.fill();
    ctx.lineWidth = Math.max(1.4, 2 * u); ctx.strokeStyle = THEME.gate; ctx.stroke();
    ctx.clip();
    ctx.beginPath();
    for (let k = -w; k < w * 2; k += 9 * u) { ctx.moveTo(x + i + k, y + i); ctx.lineTo(x + i + k - w, y + i + w); }
    ctx.lineWidth = Math.max(1, 1.2 * u); ctx.strokeStyle = 'rgba(255,180,84,0.45)'; ctx.stroke();
    ctx.restore();
  }
  if (open) {
    ctx.save(); ctx.globalAlpha = 0.55; ctx.setLineDash([4 * u, 4 * u]);
    roundRectPath(ctx, x + i, y + i, w, w, 5 * u);
    ctx.lineWidth = Math.max(1, 1.4 * u); ctx.strokeStyle = THEME.gate; ctx.stroke(); ctx.restore();
  }
  drawPastilles(ctx, x + s / 2, y + s / 2 + 0.1 * s, s, n);
}

function hexPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; if (k === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  ctx.closePath();
}

/**
 * Cible (D6) : éteinte = cadre pointillé ; partielle (reçoit une partie) = cadre plein teinté de ce qui arrive ;
 * trop (reçoit ce qu'il faut ET plus) = cadre plein et croix barrée ; allumée = disque plein, glyphe foncé et coche.
 */
export function drawTarget(ctx, cx, cy, s, need, got, lit, reached) {
  const u = s / 62, hue = THEME.hues[need], r = GEOM.hex * s;
  hexPath(ctx, cx, cy, r);
  if (lit) {
    ctx.fillStyle = hue; ctx.fill();
    ctx.lineWidth = Math.max(1.4, 2 * u); ctx.strokeStyle = '#ffffff'; ctx.stroke();
    ctx.fillStyle = THEME.ink; fillSymbol(ctx, need, cx, cy, 9 * u);
    ctx.beginPath(); ctx.arc(cx + 14 * u, cy - 14 * u, 6 * u, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.fill(); // coche
    ctx.beginPath(); ctx.moveTo(cx + 11 * u, cy - 14 * u); ctx.lineTo(cx + 13.4 * u, cy - 11.5 * u); ctx.lineTo(cx + 17.4 * u, cy - 17 * u);
    ctx.lineWidth = Math.max(1.4, 1.8 * u); ctx.lineCap = 'round'; ctx.strokeStyle = THEME.ink; ctx.stroke();
    return;
  }
  if (got !== 0) { ctx.globalAlpha = 0.2; ctx.fillStyle = THEME.hues[got]; ctx.fill(); ctx.globalAlpha = 1; }
  ctx.lineWidth = Math.max(1.4, 2 * u);
  if (got === 0) ctx.setLineDash([4 * u, 3 * u]);
  ctx.strokeStyle = hue; ctx.globalAlpha = got === 0 ? 0.85 : 1; ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]);
  ctx.fillStyle = hue; fillSymbol(ctx, need, cx, cy, GEOM.glyph * s);
  if (reached) { // trop : croix barrée par-dessus le glyphe
    ctx.beginPath(); ctx.moveTo(cx - 10 * u, cy - 10 * u); ctx.lineTo(cx + 10 * u, cy + 10 * u); ctx.moveTo(cx + 10 * u, cy - 10 * u); ctx.lineTo(cx - 10 * u, cy + 10 * u);
    ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.6, 2.4 * u); ctx.strokeStyle = '#ffffff'; ctx.stroke();
  }
}

/** Jeton de symbole le long d'un faisceau : pastille de la teinte, glyphe foncé (D6). */
export function drawToken(ctx, cx, cy, s, mask, axis = 0) {
  // V10 (test final : les « ◎ » se lisaient comme des mini-cibles) : marqueur de faisceau = gélule plate couchée le long du faisceau (`axis` à l'écran : 0 horizontal,
  // 1 vertical), corps sombre teinté de la couleur du faisceau (il masque le scintillement du faisceau dessous : surface de flash V3-20 inchangée, mesurée),
  // liseré et glyphe de la couleur ; même dessin qu'en WebGL (`FS_PIECE`, t = 9, uB = 0).
  const hue = THEME.hues[mask], th = Math.max(0.095 * s, 4.5), L = 0.06 * s, ax = axis === 1 ? 0 : L, ay = axis === 1 ? L : 0;
  ctx.beginPath(); ctx.moveTo(cx - ax, cy - ay); ctx.lineTo(cx + ax, cy + ay); ctx.lineCap = 'round';
  ctx.lineWidth = 2 * th; ctx.strokeStyle = hue; ctx.stroke(); // liseré
  ctx.lineWidth = 2 * th - 2; ctx.strokeStyle = '#0b0c22'; ctx.stroke();
  ctx.globalAlpha = 0.22; ctx.strokeStyle = hue; ctx.stroke(); ctx.globalAlpha = 1; ctx.lineCap = 'butt'; // teinte du corps
  ctx.fillStyle = hue; fillSymbol(ctx, mask, cx, cy, 0.85 * th);
}

export { symbolPath };
