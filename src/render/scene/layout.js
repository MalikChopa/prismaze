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
/**
 * V13 (test joueur n° 5) : marge minimale (px CSS, 4 : garde le gain de la rotation ≥ 35 % à 412×915 exigé par tests/render/portrait.test.mjs) entre le bord de l'écran (zone sûre) et le plateau VU : agrandi au zoom maximal de la caméra,
 * dalle WebGL comprise (`pad`). Avant, le plateau tourné (sans jeu) touchait les bords à 390×844 et 412×915 (≈ 2,6 px), et la dalle était coupée.
 */
export const EDGE = 4;
/**
 * V13 (test joueur n° 3) : centrage horizontal. Quand un obstacle (pastille du titre, longue pour le défi du jour) fait reculer le plateau d'un seul côté,
 * on essaie la même réserve des deux côtés : gardée si la case reste ≥ `KEEP` × la case décentrée ; sinon le plateau, à case égale, se rapproche du centre
 * autant que les obstacles le permettent. Jamais en paysage bas (rails) ni pour le plateau tourné (règle du portrait inchangée).
 */
export const CENTRE = Object.freeze({ KEEP: 0.9 });
/**
 * V13b (revue n° 2) : requête média du paysage bas, la MÊME que la règle CSS d'index.html (vérifié par tests/ui/v13b.test.mjs).
 * Dans le navigateur, game.js demande la réponse à `matchMedia(COMPACT_QUERY)` : CSS et JS ne peuvent plus diverger (hauteur fractionnaire, 499,2 px).
 */
export const COMPACT_QUERY = '(max-height: 499px) and (orientation: landscape)';
/** Repli sans matchMedia (essais sous Node) : mêmes bornes que la règle CSS (hauteur <= 499 px exactement, paysage). */
export const isCompact = (w, h) => w > h && h <= COMPACT.MAX_H;

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
/** Zone libre après recul devant l'obstacle `o` du côté `side` (jamais agrandie). `mirror` (V13) : abscisse du centre ; le recul gauche/droite est alors
 * reporté symétriquement de l'autre côté (le plateau reste centré). */
function retreat(free, o, side, gx, gy, mirror = null) {
  const f = { l: free.l, t: free.t, r: free.r, b: free.b };
  if (side === 'bottom') f.b = Math.min(f.b, o.y - GAP - gy);
  else if (side === 'top') f.t = Math.max(f.t, o.y + o.h + GAP + gy);
  else if (side === 'right') { const x = o.x - GAP - gx; f.r = Math.min(f.r, x); if (mirror !== null) f.l = Math.max(f.l, 2 * mirror - x); }
  else { const x = o.x + o.w + GAP + gx; f.l = Math.max(f.l, x); if (mirror !== null) f.r = Math.min(f.r, 2 * mirror - x); }
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
  if (!(pad > 0) || !p.obstacles || p.obstacles.length === 0) return layoutCore(p, 0);
  // V9b : la dalle (pad cases) touche-t-elle un obstacle ? Sinon, mise en page inchangée. Si oui, on refait la mise en page
  // avec un débord FIXE en pixels (pad × case trouvée) : un débord recalculé à chaque essai, sur une case encore trop grande, ferait trop reculer.
  // V13b (relecture V13, R1) : le recentrage (V13) tient compte de la dalle (il ne la pousse plus sur une pastille), et le contact est jugé sur la mise en page
  // obtenue ainsi : avant, le décalage sans dalle provoquait le second passage et la case perdait 20 à 25 % (1024×640, 7×5 : 86 -> 68 px).
  const L0 = layoutCore(p, 0);
  if (!slabTouches(L0, pad, p.obstacles)) return L0;
  // V13b (R2) : deux remèdes, la plus grande case gagne : (1) tout refaire avec la dalle (recul devant les obstacles, V9b) ; (2) garder la place trouvée
  // et réduire un peu la case jusqu'à ce que la dalle se dégage (paysage bas, 568×320 en 12×3 : le recul de tout le rail coûtait 31 %).
  const C1 = layoutCore(p, pad * L0.cell);
  const C2 = shrinkToFit(L0, p);
  return C2 !== null && C2.cell > C1.cell ? C2 : C1;
}

/** true si la dalle (pad cases autour du plateau agrandi au zoom maximal) recouvre un obstacle. */
function slabTouches(L, pad, obstacles) {
  const grow = (L.zoomMax - 1) / 2, px = pad * L.cell, gx = grow * L.boardW + px, gy = grow * L.boardH + px;
  const box = { l: L.x0 - gx, r: L.x0 + L.boardW + gx, t: L.y0 - gy, b: L.y0 + L.boardH + gy };
  return obstacles.some((o) => overlaps(box, o, 0));
}
/** v bornée à [lo, hi] ; null si l'intervalle est vide. */
const clampInto = (v, lo, hi) => (lo <= hi + 1e-9 ? Math.min(Math.max(v, lo), hi) : null);

/**
 * V13b (R2) : réduit la case (pas de 0,5 %, au plus 20 %) autour de la place trouvée sans dalle, jusqu'à ce que la dalle ne touche plus aucun obstacle ;
 * le plateau reste dans sa zone libre (écart GAP aux obstacles) et le plateau vu garde EDGE px jusqu'au bord de la zone sûre. Renvoie null si rien ne convient.
 */
function shrinkToFit(L, p) {
  const pad = p.pad ?? 0, safe = p.safe || {}, edge = p.edge ?? EDGE, grow = (L.zoomMax - 1) / 2, cols = L.boardW / L.cell, rows = L.boardH / L.cell;
  const cx0 = L.x0 + L.boardW / 2, cy0 = L.y0 + L.boardH / 2;
  for (let k = 1; k <= 40; k++) {
    let cell = L.cell * (1 - k * 0.005);
    if (p.integerCell) cell = Math.max(1, Math.floor(cell));
    const bw = cell * cols, bh = cell * rows, ex = grow * bw + pad * cell + edge, ey = grow * bh + pad * cell + edge;
    const x = clampInto(cx0, Math.max((safe.left || 0) + ex, L.free.l) + bw / 2, Math.min(p.w - (safe.right || 0) - ex, L.free.r) - bw / 2);
    const y = clampInto(cy0, Math.max((safe.top || 0) + ey, L.free.t) + bh / 2, Math.min(p.h - (safe.bottom || 0) - ey, L.free.b) - bh / 2);
    if (x === null || y === null) continue;
    const C = { ...L, cell, x0: x - bw / 2, y0: y - bh / 2, boardW: bw, boardH: bh };
    if (!slabTouches(C, pad, p.obstacles || [])) return C;
  }
  return null;
}

function layoutCore(p, padPx) {
  const A = layoutPass(p, padPx, false);
  if (p.rails === true || p.centre === false) return A;
  const safe = p.safe || {}, m = Math.min(p.w, p.h) * (p.margin ?? MARGIN);
  const lo = (safe.left || 0) + m, hi = p.w - (safe.right || 0) - m;
  if (Math.abs((A.free.l - lo) - (hi - A.free.r)) <= 1) return A; // déjà centré
  const pad = p.pad ?? 0, obs = p.obstacles || [];
  const S = layoutPass(p, padPx, true);
  // V13b (R1) : la réserve symétrique n'est gardée que si elle ne pose pas la dalle sur un obstacle (quand A l'en tenait écartée)
  if (S.cell >= A.cell * CENTRE.KEEP && (!(pad > 0) || !slabTouches(S, pad, obs) || slabTouches(A, pad, obs))) return S;
  return nudgeToCentre(A, p, Math.max(padPx, pad * A.cell)); // V13b (R1) : le décalage garde la dalle hors des obstacles
}

/**
 * V13 : à case égale, rapproche le plateau du centre de l'écran (zone sûre) tant qu'il ne s'approche pas à moins de GAP d'un obstacle qu'il croise
 * verticalement (zoom maximal et dalle compris), ni à moins de la marge (et du demi-jeu) d'un bord. Pur ; renvoie L modifié.
 */
function nudgeToCentre(L, p, padPx) {
  const safe = p.safe || {}, obstacles = p.obstacles || [], slack = p.slack ?? SLACK, m = Math.min(L.w, L.h) * (p.margin ?? MARGIN);
  const grow = (L.zoomMax - 1) / 2, gx = grow * L.boardW + padPx, gy = grow * L.boardH + padPx;
  const t = L.y0 - gy, b = L.y0 + L.boardH + gy, mid = L.x0 + L.boardW / 2;
  let minX = (safe.left || 0) + m + (slack * L.cell) / 2, maxX = L.w - (safe.right || 0) - m - (slack * L.cell) / 2 - L.boardW;
  for (const o of obstacles) {
    if (!(o.y < b && o.y + o.h > t)) continue; // ne croise pas la bande du plateau
    if (o.x + o.w / 2 < mid) minX = Math.max(minX, o.x + o.w + GAP + gx); else maxX = Math.min(maxX, o.x - GAP - gx - L.boardW);
  }
  if (!(minX <= L.x0 + 0.5 && L.x0 - 0.5 <= maxX)) return L; // position actuelle hors des bornes calculées : on ne touche à rien
  const target = ((safe.left || 0) + L.w - (safe.right || 0)) / 2 - L.boardW / 2;
  const x0 = Math.min(Math.max(target, minX), Math.max(minX, maxX)), d = x0 - L.x0;
  L.x0 = x0; L.free = { l: L.free.l + d, r: L.free.r + d, t: L.free.t, b: L.free.b };
  return L;
}

function layoutPass(p, padPx, centred) {
  const { w, h, cols, rows } = p;
  const safe = p.safe || {}, obstacles = p.obstacles || [], zoomMax = p.zoomMax ?? ZOOM_MAX, slack = p.slack ?? SLACK;
  const m = Math.min(w, h) * (p.margin ?? MARGIN);
  const free = { l: (safe.left || 0) + m, t: (safe.top || 0) + m, r: w - (safe.right || 0) - m, b: h - (safe.bottom || 0) - m };
  const grow = (zoomMax - 1) / 2;
  const mirror = centred ? ((safe.left || 0) + w - (safe.right || 0)) / 2 : null;
  // V13 : le plateau vu (zoom maximal, dalle de `pad` cases) garde EDGE px jusqu'au bord de la zone sûre
  const edge = p.edge ?? EDGE, padC = p.pad ?? 0;
  const edgeCell = Math.min((w - (safe.left || 0) - (safe.right || 0) - 2 * edge) / (cols * (1 + 2 * grow) + 2 * padC), (h - (safe.top || 0) - (safe.bottom || 0) - 2 * edge) / (rows * (1 + 2 * grow) + 2 * padC));
  let cell = 1, bw = 0, bh = 0, box = null, it = 0;
  for (; it < MAX_ITER + 1; it++) {
    const aw = Math.max(1, free.r - free.l), ah = Math.max(1, free.b - free.t);
    cell = Math.min(aw / (cols + slack), ah / (rows + slack), Math.max(1, edgeCell));
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
        const a = retreat(free, o, side, gx, gy, mirror), b = retreat(free, o, alt, gx, gy, mirror), ca = cellOf(a, cols, rows, slack), cb = cellOf(b, cols, rows, slack);
        if (cb > ca) side = alt;
      }
      const next = retreat(free, o, side, gx, gy, mirror);
      if (next.l !== free.l || next.r !== free.r || next.t !== free.t || next.b !== free.b) { free.l = next.l; free.r = next.r; free.t = next.t; free.b = next.b; changed = true; }
    }
    if (!changed) break;
  }
  let cx = (free.l + free.r) / 2, cy = (free.t + free.b) / 2;
  // V13 : le plateau vu ne sort jamais de la zone sûre moins EDGE (zone libre décentrée par un obstacle, jeu nul du plateau tourné).
  // V13b (relecture V13, R2) : cette borne ne fait plus sortir le plateau de sa zone libre (elle le poussait sur l'obstacle d'en face : dalle sur la légende
  // à 768×1024 en 10×4) : si les deux contraintes ne tiennent pas ensemble, la case diminue (pas de 0,5 %, ou 1 px en 2D) jusqu'à ce qu'elles tiennent.
  for (let k = 0; k <= 60; k++) {
    const ex = grow * bw + padC * cell + edge, ey = grow * bh + padC * cell + edge;
    const loX = (safe.left || 0) + ex + bw / 2, hiX = w - (safe.right || 0) - ex - bw / 2, loY = (safe.top || 0) + ey + bh / 2, hiY = h - (safe.bottom || 0) - ey - bh / 2;
    const x = clampInto(cx, Math.max(loX, free.l + bw / 2), Math.min(hiX, free.r - bw / 2)), y = clampInto(cy, Math.max(loY, free.t + bh / 2), Math.min(hiY, free.b - bh / 2));
    if (x !== null && y !== null) { cx = x; cy = y; break; }
    if (k === 60) { if (loX <= hiX) cx = Math.min(Math.max(cx, loX), hiX); if (loY <= hiY) cy = Math.min(Math.max(cy, loY), hiY); break; } // repli (jamais vu) : comportement V13
    cell = p.integerCell ? Math.max(1, Math.floor(cell) - 1) : cell * 0.995;
    bw = cell * cols; bh = cell * rows;
  }
  return { cell, x0: cx - bw / 2, y0: cy - bh / 2, boardW: bw, boardH: bh, w, h, free, zoomMax, iterations: it };
}

/** Paramètres du plateau tourné d'un quart de tour : largeur et hauteur échangées, marge et jeu resserrés (la caméra reste bornée par `clampPose`). */
// V9b : décision de rotation sans la dalle (critère V7 « +35 % », règle inchangée) ; V12 (audit C5) : la mise en page finale du plateau tourné garde la dalle WebGL (`keepPad`)
// à l'écart des pastilles (elle ne change rien quand la dalle ne touche aucun obstacle).
const turned = (p, keepPad = false) => ({ ...p, cols: p.rows, rows: p.cols, margin: PORTRAIT.MARGIN, slack: PORTRAIT.SLACK, pad: keepPad ? p.pad : 0, cornerRetreat: false, rails: false, centre: false });

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
  // V13b (relecture V13, R2) : la colonne qui compte est celle du plateau VU (zoom maximal et dalle compris) : une pastille qui ne touche que la dalle
  // compte aussi (768×1024, 9×5 tourné : la dalle passait sur la pastille du titre)
  const gw = ((L.zoomMax ?? ZOOM_MAX) - 1) / 2 * L.boardW + padPx;
  const midY = L.y0 + L.boardH / 2, x0 = L.x0 - gw, x1 = L.x0 + L.boardW + gw;
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
