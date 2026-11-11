// FIXTURE de test (V13b) : copie exacte de src/render/scene/layout.js au commit faf131e (V12), référence de la comparaison de tests/render/scene/layout-v13b.test.mjs. Ne pas modifier.
// Mise en page plein écran avec obstacles de l'interface (ARCHITECTURE_V3_RENDU V3-17, V3-38). Module PUR (ni DOM, ni GL).
// Le plateau occupe la fenêtre moins les marges de sécurité, moins 3 % du petit côté, moins les rectangles MESURÉS des éléments flottants
// (dock, barre du haut, légende, panneau de victoire). Tant que `FLAGS.immersiveLayout` est faux (jusqu'à V5), le jeu garde `computeLayout` de renderer.js.

/** Indicateurs de fonctionnalité de la refonte. `immersiveLayout` reste ÉTEINT jusqu'à V5 (activation avec ses tests). */
export const FLAGS = { immersiveLayout: false, portraitRotation: true };

/** Rotation du plateau en portrait (V7, §11 P1). Mis à false, `portraitRotation` coupe tout (fonction coupable). Règle : voir `shouldRotate`. */
export const PORTRAIT = Object.freeze({ MAX_ASPECT: 0.95, MIN_BOARD_RATIO: 1.2, MIN_GAIN: 1.15, MARGIN: 0.02, SLACK: 0 });

export const MARGIN = 0.03; // marge = 3 % du petit côté
export const ZOOM_MAX = 1.03; // zoom maximal de la caméra (repos 1,022 ± 0,008)
export const GAP = 8; // écart minimal plateau / obstacle (px), à tout zoom et toute pose
export const SLACK = 0.75; // demi-case de chaque côté, plus un quart : s = min(aw / (cols + 0,75), ah / (rows + 0,75))
export const MAX_ITER = 4;
/** V9b (test final, 915×412) : débord de la dalle WebGL autour du plateau, en cases (`slab()` de shaders.js : plateau + 0,30 case). Sans obstacle, la mise en page ne change pas. */
export const SLAB_PAD = 0.30;
/**
 * V12 (audit responsive G1, G2, G3) : téléphone couché ou fenêtre basse (hauteur <= 499 px, paysage : la règle CSS `max-height: 499px` et `orientation: landscape`).
 * L'interface y est rangée en deux RAILS (index.html) : à gauche la pastille du titre et la légende, à droite les réglages, les outils et le panneau de victoire.
 * Chaque obstacle (sauf une bande de plus de 60 % de la largeur) recule alors du côté de son rail (gauche si son centre est dans la moitié gauche) : le plateau
 * occupe toute la hauteur entre les rails. `SLACK` : jeu autour du plateau resserré (0,75 sinon) pour des cases d'au moins 32 px en 568×320 sur 10×8.
 */
export const COMPACT = Object.freeze({ MAX_H: 499, SLACK: 0.4 });
/** true si la fenêtre (px CSS) est en disposition « paysage bas » (mêmes bornes que la règle CSS). */
export const isCompact = (w, h) => w > h && h <= COMPACT.MAX_H + 0.5;

/** Rectangle {x, y, w, h}. Côté de l'écran le plus proche d'un obstacle : 'top' | 'bottom' | 'left' | 'right'. */
function nearestSide(o, w, h) {
  const dTop = o.y, dBottom = h - (o.y + o.h), dLeft = o.x, dRight = w - (o.x + o.w);
  if (o.w >= w * 0.6) return dBottom <= dTop ? 'bottom' : 'top'; // bande large (panneau de victoire au-dessus du dock) : elle borne la hauteur, jamais la largeur (V7 : sinon le plateau tourné est réduit à 1 px de large)
  const m = Math.min(dTop, dBottom, dLeft, dRight);
  if (m === dBottom) return 'bottom';
  if (m === dTop) return 'top';
  if (m === dRight) return 'right';
  return 'left';
}

/**
 * Autre côté possible pour un obstacle collé à un coin (aussi près d'un bord vertical que d'un bord horizontal, à 4 px près), sinon null.
 * Utilisé seulement avec `cornerRetreat` (jeu en WebGL, où la dalle déborde du plateau) : `layout()` sans ce drapeau garde les chiffres de V3-38.
 */
function cornerAlt(o, w, h, side) {
  if (o.w >= w * 0.6) return null;
  const dTop = o.y, dBottom = h - (o.y + o.h), dLeft = o.x, dRight = w - (o.x + o.w);
  if (Math.abs(Math.min(dLeft, dRight) - Math.min(dTop, dBottom)) > 4) return null;
  if (side === 'top' || side === 'bottom') return dLeft <= dRight ? 'left' : 'right';
  return dTop <= dBottom ? 'top' : 'bottom';
}
/** Zone libre après recul devant l'obstacle `o` du côté `side` (jamais agrandie). */
function retreat(free, o, side, gx, gy) {
  const f = { l: free.l, t: free.t, r: free.r, b: free.b };
  if (side === 'bottom') f.b = Math.min(f.b, o.y - GAP - gy);
  else if (side === 'top') f.t = Math.max(f.t, o.y + o.h + GAP + gy);
  else if (side === 'right') f.r = Math.min(f.r, o.x - GAP - gx);
  else f.l = Math.max(f.l, o.x + o.w + GAP + gx);
  return f;
}
const cellOf = (f, cols, rows, slack) => Math.min(Math.max(1, f.r - f.l) / (cols + slack), Math.max(1, f.b - f.t) / (rows + slack));

/** true si le rectangle a (bornes l, t, r, b) et l'obstacle o se recouvrent (au sens strict, après élargissement de `gap`). */
export function overlaps(box, o, gap = 0) {
  return o.x < box.r + gap && o.x + o.w > box.l - gap && o.y < box.b + gap && o.y + o.h > box.t - gap;
}

/**
 * @param {{w:number,h:number,cols:number,rows:number,safe?:{top?:number,right?:number,bottom?:number,left?:number},
 *   obstacles?:Array<{x:number,y:number,w:number,h:number}>, integerCell?:boolean, zoomMax?:number}} p
 *   w, h : fenêtre en pixels CSS ; safe : marges de sécurité (encoches) ; obstacles : rectangles mesurés (pixels CSS) ;
 *   integerCell : case entière (rendu 2D) ; zoomMax : zoom maximal de la caméra (1,03) ; pad : débord dessiné autour du plateau (cases), tenu à l'écart des obstacles ;
 *   cornerRetreat : devant un obstacle de coin, reculer du côté qui garde la plus grande case (V9b) ;
 *   rails : paysage bas (V12, `COMPACT`), chaque obstacle recule vers le côté gauche ou droit de son centre ; slack : jeu autour du plateau (défaut SLACK).
 * @returns {{cell:number,x0:number,y0:number,boardW:number,boardH:number,w:number,h:number,free:{l:number,t:number,r:number,b:number},zoomMax:number,iterations:number}}
 *   `free` : zone libre finale ; le plateau, agrandi à `zoomMax`, ne recouvre aucun obstacle et reste à ≥ GAP d'eux.
 */
export function layout(p) {
  const pad = p.pad ?? 0;
  const L0 = layoutCore(p, 0);
  if (!(pad > 0) || !p.obstacles || p.obstacles.length === 0) return L0;
  // V9b : la dalle (pad cases) touche-t-elle un obstacle ? Sinon, mise en page strictement inchangée. Si oui, on refait la mise en page
  // avec un débord FIXE en pixels (pad × case trouvée) : un débord recalculé à chaque essai, sur une case encore trop grande, ferait trop reculer.
  const padPx = pad * L0.cell, grow = (L0.zoomMax - 1) / 2, gx = grow * L0.boardW + padPx, gy = grow * L0.boardH + padPx;
  const slabBox = { l: L0.x0 - gx, r: L0.x0 + L0.boardW + gx, t: L0.y0 - gy, b: L0.y0 + L0.boardH + gy };
  if (!p.obstacles.some((o) => overlaps(slabBox, o, 0))) return L0;
  return layoutCore(p, padPx);
}

function layoutCore(p, padPx) {
  const { w, h, cols, rows } = p;
  const safe = p.safe || {}, obstacles = p.obstacles || [], zoomMax = p.zoomMax ?? ZOOM_MAX, slack = p.slack ?? SLACK;
  const m = Math.min(w, h) * (p.margin ?? MARGIN);
  const free = { l: (safe.left || 0) + m, t: (safe.top || 0) + m, r: w - (safe.right || 0) - m, b: h - (safe.bottom || 0) - m };
  const grow = (zoomMax - 1) / 2;
  let cell = 1, bw = 0, bh = 0, box = null, it = 0;
  for (; it < MAX_ITER + 1; it++) {
    const aw = Math.max(1, free.r - free.l), ah = Math.max(1, free.b - free.t);
    cell = Math.min(aw / (cols + slack), ah / (rows + slack));
    if (p.integerCell) cell = Math.max(1, Math.floor(cell));
    bw = cell * cols; bh = cell * rows;
    const cx = (free.l + free.r) / 2, cy = (free.t + free.b) / 2, gx = grow * bw + padPx, gy = grow * bh + padPx; // V9b : la dalle (padPx) compte face aux obstacles
    box = { l: cx - bw / 2 - gx, r: cx + bw / 2 + gx, t: cy - bh / 2 - gy, b: cy + bh / 2 + gy };
    if (it === MAX_ITER) break;
    let changed = false;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (!overlaps(box, o, 0)) continue; // « recouvre » (V3-38) : sans écart ; le retrait, lui, laisse GAP
      const rail = p.rails === true && o.w < w * 0.6; // V12 : rails du paysage bas, chaque obstacle recule vers son côté
      let side = rail ? (o.x + o.w / 2 < w / 2 ? 'left' : 'right') : nearestSide(o, w, h);
      const alt = p.cornerRetreat === true && !rail ? cornerAlt(o, w, h, side) : null;
      if (alt !== null) { // V9b : obstacle dans un coin (pastille d'état en paysage) : on recule du côté qui garde la plus grande case
        const a = retreat(free, o, side, gx, gy), b = retreat(free, o, alt, gx, gy), ca = cellOf(a, cols, rows, slack), cb = cellOf(b, cols, rows, slack);
        if (cb > ca) side = alt;
      }
      const next = retreat(free, o, side, gx, gy);
      if (next.l !== free.l || next.r !== free.r || next.t !== free.t || next.b !== free.b) { free.l = next.l; free.r = next.r; free.t = next.t; free.b = next.b; changed = true; }
    }
    if (!changed) break;
  }
  const cx = (free.l + free.r) / 2, cy = (free.t + free.b) / 2;
  return { cell, x0: cx - bw / 2, y0: cy - bh / 2, boardW: bw, boardH: bh, w, h, free, zoomMax, iterations: it };
}

/** Paramètres du plateau tourné d'un quart de tour : largeur et hauteur échangées, marge et jeu resserrés (la caméra reste bornée par `clampPose`). */
// V9b : décision de rotation sans la dalle (critère V7 « +35 % », règle inchangée) ; V12 (audit C5) : la mise en page finale du plateau tourné garde la dalle WebGL (`keepPad`)
// à l'écart des pastilles (elle ne change rien quand la dalle ne touche aucun obstacle).
const turned = (p, keepPad = false) => ({ ...p, cols: p.rows, rows: p.cols, margin: PORTRAIT.MARGIN, slack: PORTRAIT.SLACK, pad: keepPad ? p.pad : 0, cornerRetreat: false, rails: false });

/**
 * Faut-il tourner le plateau d'un quart de tour ? RÈGLE (V7) : fenêtre en portrait (largeur < 0,95 × hauteur, seuil de la maquette), plateau nettement plus large que haut
 * (colonnes ≥ 1,2 × lignes : 6×5 oui, 9×8 non) et case agrandie d'au moins 15 % à obstacles égaux. Jamais en paysage, jamais sur un plateau carré ou presque.
 * @param {{w:number,h:number,cols:number,rows:number,safe?:object,obstacles?:Array,integerCell?:boolean}} p  mêmes champs que layout()
 */
export function shouldRotate(p) {
  if (!FLAGS.portraitRotation) return false;
  if (!(p.w < p.h * PORTRAIT.MAX_ASPECT)) return false;
  if (p.cols * 5 < p.rows * 6) return false; // ratio entier : pas d'arrondi flottant à 1,2 pile
  return layout(turned(p)).cell >= layout(p).cell * PORTRAIT.MIN_GAIN;
}

/**
 * Mise en page du jeu : `layout()` tourné si `p.rotation` est vrai et que `shouldRotate` le veut (sinon strictement `layout()`).
 * `p.rotationObstacles` : obstacles qui décident la rotation (sans le panneau de victoire : le plateau ne bascule pas à la victoire).
 * @returns {object} sortie de layout() ; `rot` vaut 1 si le plateau est tourné (boardW et boardH sont alors les côtés À L'ÉCRAN, boardW = cell × lignes)
 */
export function boardLayout(p) {
  const rot = p.rotation === true && shouldRotate({ ...p, obstacles: p.rotationObstacles || p.obstacles });
  let L;
  if (rot) { const T = layout(turned(p, true)); L = recentreVertically(T, p.obstacles || [], p.safe || {}, PORTRAIT.MARGIN, (p.pad ?? 0) * T.cell); } else L = layout(p);
  L.rot = rot ? 1 : 0;
  return L;
}

/**
 * V10 (test final, bande vide au-dessus du plateau tourné) : RÈGLE : le plateau est recentré verticalement entre le bas des éléments flottants au-dessus de lui
 * (barre du haut) et le haut de ceux au-dessous (légende, sinon outils, ou panneau de victoire), parmi ceux qui le chevauchent horizontalement ; sans élément d'un côté,
 * la borne est le bord de l'écran moins la marge. La case et la largeur ne changent pas (gain de taille V7 intact) : seul `y0` (et `free`) bouge, et seulement si le plateau,
 * agrandi au zoom maximal et entouré de GAP, tient entre les deux bornes. Pur.
 * @param {object} L  sortie de layout() ; @param {Array<{x,y,w,h}>} obstacles ; @param {{top?:number,bottom?:number}} safe ; @param {number} margin  part du petit côté
 * @param {number} [padPx]  débord de la dalle WebGL (px) qui doit aussi tenir entre les deux bornes (V12)
 * @returns {object} L (modifié en place et renvoyé)
 */
export function recentreVertically(L, obstacles, safe, margin = PORTRAIT.MARGIN, padPx = 0) {
  const m = Math.min(L.w, L.h) * margin, grow = ((L.zoomMax ?? ZOOM_MAX) - 1) / 2 * L.boardH;
  const midY = L.y0 + L.boardH / 2, x0 = L.x0, x1 = L.x0 + L.boardW;
  let top = (safe.top || 0) + m, bottom = L.h - (safe.bottom || 0) - m;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (!(o.x < x1 && o.x + o.w > x0)) continue; // ne chevauche pas la colonne du plateau : ne compte pas (comme V3-38)
    if (o.y + o.h / 2 < midY) top = Math.max(top, o.y + o.h); else bottom = Math.min(bottom, o.y);
  }
  if (L.boardH + 2 * (GAP + grow + padPx) > bottom - top) return L; // ne tient pas (dalle WebGL comprise, V12) : mise en page inchangée
  const y0 = (top + bottom) / 2 - L.boardH / 2, d = y0 - L.y0;
  L.y0 = y0; L.free = { l: L.free.l, r: L.free.r, t: L.free.t + d, b: L.free.b + d };
  return L;
}

/** Obstacle d'un panneau de victoire (état `gagné`, V3-17) : bande de hauteur `panelH` en bas, sur toute la largeur utile. */
export function victoryObstacle(w, h, panelH, inset = 12) {
  return { x: inset, y: h - panelH, w: w - 2 * inset, h: panelH };
}

/** Plus petit écart (px) entre le plateau (rectangle {l,t,r,b}) et un obstacle ; négatif ou nul s'ils se recouvrent. */
export function gapBetween(box, o) {
  const dx = Math.max(o.x - box.r, box.l - (o.x + o.w)), dy = Math.max(o.y - box.b, box.t - (o.y + o.h));
  return Math.max(dx, dy);
}
