// Caméra, borne de pose et projection pointeur → case (ARCHITECTURE_V3_RENDU V3-18, V3-19, V3-38). Module PUR : le temps est une entrée, aucun DOM.
// Valeurs de la maquette vivante (MC) : respiration, parallaxe, recentrage, poussée de victoire.
import { GAP, gapBetween } from './layout.js';

export const CAMERA = Object.freeze({
  REST_ZOOM_GL: 1.022, REST_ZOOM_2D: 1.0, BREATH: 0.008, BREATH_PERIOD_S: 18,
  PARALLAX: 0.013, // fraction du petit côté
  PARALLAX_TAU_S: 0.31, FLOOR_FOLLOW: 0.55, // le sol suit à 55 %
  RECENTER: 0.035, RECENTER_TAU_S: 2.6, // 3,5 % du vecteur centre du plateau → dernière cible allumée (pixels écran)
  DRAG_ZOOM: 0.02, DRAG_TAU_S: 0.2, // zoom en plus pendant un glissement
  WIN_PUSH: 0.14, WIN_RISE_MS: 140, WIN_DECAY: 2.6, // poussée de victoire
  FREEZE_AFTER_MS: 200, // le décalage reste gelé 200 ms après le lâcher (V3-19)
});

/**
 * Caméra : renvoie à chaque appel de `update` une pose { zoom, dx, dy, floorDx, floorDy } (décalage du plateau en pixels CSS, le sol suit à 55 %).
 * Mouvement réduit ou caméra coupée : zoom 1, décalage 0, aucune poussée. Tactile : pas de parallaxe (P13).
 * @param {{gl?:boolean, reduced?:boolean, enabled?:boolean, touch?:boolean}} [opt]
 */
export function createCamera(opt = {}) {
  let gl = opt.gl === true, reduced = opt.reduced === true, enabled = opt.enabled !== false, touch = opt.touch === true;
  let last = null, px = 0, py = 0, rx = 0, ry = 0, drag = 0, winAt = null;
  let frozenUntil = -1, held = false;
  const pose = { zoom: 1, dx: 0, dy: 0, floorDx: 0, floorDy: 0 };
  const k = (dt, tau) => 1 - Math.exp(-dt / tau);
  return {
    pose,
    set(o) {
      if (o.gl !== undefined) gl = o.gl === true;
      if (o.reduced !== undefined) reduced = o.reduced === true;
      if (o.enabled !== undefined) enabled = o.enabled !== false;
      if (o.touch !== undefined) touch = o.touch === true;
    },
    /** Poussée de victoire : démarre à `now` (ms). */
    win(now) { winAt = now; },
    clearWin() { winAt = null; },
    /** Gèle le décalage dès un appui sur une pièce, pendant tout glissement ou prise au clavier (V3-19). */
    hold() { held = true; },
    /** Lâcher : le décalage reste gelé 200 ms de plus. */
    release(now) { held = false; frozenUntil = now + CAMERA.FREEZE_AFTER_MS; },
    get frozen() { return held; },
    /**
     * @param {number} now  ms (horloge de l'image)
     * @param {{w:number,h:number,pointer?:{nx:number,ny:number}|null,dragging?:boolean,target?:{x:number,y:number}|null}} io
     *   pointer : position normalisée -1..1 (centre = 0) ; target : vecteur (px) du centre du plateau vers la dernière cible allumée
     */
    update(now, io) {
      const dt = last === null ? 0 : Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;
      if (!enabled || reduced) { pose.zoom = 1; pose.dx = pose.dy = pose.floorDx = pose.floorDy = 0; px = py = rx = ry = drag = 0; return pose; }
      const small = Math.min(io.w, io.h), frozen = held || now < frozenUntil;
      if (!frozen) {
        const p = !touch && io.pointer ? io.pointer : null;
        const tx = p ? p.nx * CAMERA.PARALLAX * small : 0, ty = p ? p.ny * CAMERA.PARALLAX * small : 0;
        const a = k(dt, CAMERA.PARALLAX_TAU_S);
        px += (tx - px) * a; py += (ty - py) * a;
        const t = io.target, gx = t ? t.x * CAMERA.RECENTER : 0, gy = t ? t.y * CAMERA.RECENTER : 0, b = k(dt, CAMERA.RECENTER_TAU_S);
        rx += (gx - rx) * b; ry += (gy - ry) * b;
      }
      drag += ((io.dragging ? CAMERA.DRAG_ZOOM : 0) - drag) * k(dt, CAMERA.DRAG_TAU_S);
      const rest = gl ? CAMERA.REST_ZOOM_GL : CAMERA.REST_ZOOM_2D;
      let push = 0;
      if (winAt !== null) {
        const s = Math.max(0, now - winAt);
        push = s < CAMERA.WIN_RISE_MS ? (CAMERA.WIN_PUSH * s) / CAMERA.WIN_RISE_MS : CAMERA.WIN_PUSH * Math.exp(-CAMERA.WIN_DECAY * ((s - CAMERA.WIN_RISE_MS) / 1000));
      }
      pose.zoom = rest + (gl ? CAMERA.BREATH * Math.sin((2 * Math.PI * now) / (CAMERA.BREATH_PERIOD_S * 1000)) : 0) + drag + push;
      pose.dx = px + rx; pose.dy = py + ry;
      pose.floorDx = pose.dx * CAMERA.FLOOR_FOLLOW; pose.floorDy = pose.dy * CAMERA.FLOOR_FOLLOW;
      return pose;
    },
  };
}

/** Décalage maximal de la caméra, en pixels (marge de calcul V3-18) : parallaxe + recentrage (3,5 % du vecteur de longueur `vec`). */
export function maxShift(w, h, vec) {
  return CAMERA.PARALLAX * Math.min(w, h) + CAMERA.RECENTER * vec;
}

/**
 * Borne la pose : le plateau (zoom, décalage) ne sort jamais de la zone `view` {l,t,r,b} (aucune case rognée) et ne s'approche d'aucun obstacle
 * à moins de min(GAP, son écart à pose neutre à ce zoom). `layout` : sortie de layout(). Renvoie { dx, dy, clamped }.
 */
/** Écart (px) sous lequel un plateau est dit « remplir » un axe de la zone visible : il y est alors centré (V8). */
export const FILL_EDGE = 12;

export function clampPose(L, zoom, dx, dy, obstacles, view) {
  const hw = (L.boardW * zoom) / 2, hh = (L.boardH * zoom) / 2, cx = L.x0 + L.boardW / 2, cy = L.y0 + L.boardH / 2;
  const box = (ox, oy) => ({ l: cx + ox - hw, r: cx + ox + hw, t: cy + oy - hh, b: cy + oy + hh });
  const ox0 = dx, oy0 = dy;
  const base = box(0, 0);
  for (let pass = 0; pass < 3; pass++) {
    let b = box(dx, dy);
    if (view) { // zone visible
      if (b.l < view.l && b.r - b.l <= view.r - view.l) dx += view.l - b.l;
      if (b.r > view.r && b.r - b.l <= view.r - view.l) dx -= b.r - view.r;
      if (b.t < view.t && b.b - b.t <= view.b - view.t) dy += view.t - b.t;
      if (b.b > view.b && b.b - b.t <= view.b - view.t) dy -= b.b - view.b;
      // V8 : plateau qui remplit presque un axe (portrait tourné : ≈ 2 px de chaque côté) : centré sur cet axe plutôt que poussé contre un bord par le recentrage
      if (b.r - b.l > view.r - view.l - 2 * FILL_EDGE) dx = (view.l + view.r) / 2 - cx;
      if (b.b - b.t > view.b - view.t - 2 * FILL_EDGE) dy = (view.t + view.b) / 2 - cy;
      b = box(dx, dy);
    }
    if (obstacles) {
      for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i], need = Math.min(GAP, Math.max(0, gapBetween(base, o)));
        const sepX = Math.max(o.x - b.r, b.l - (o.x + o.w)), sepY = Math.max(o.y - b.b, b.t - (o.y + o.h));
        if (Math.max(sepX, sepY) >= need - 1e-9) continue;
        if (sepY >= sepX) { const below = o.y + o.h / 2 > (b.t + b.b) / 2; dy += (below ? -1 : 1) * (need - sepY); }
        else { const right = o.x + o.w / 2 > (b.l + b.r) / 2; dx += (right ? -1 : 1) * (need - sepX); }
        b = box(dx, dy);
      }
    }
  }
  return { dx, dy, clamped: dx !== ox0 || dy !== oy0 };
}

/**
 * Vue = matrice monde (cases) → pixels CSS du rectangle du canvas. Zoom autour du centre du plateau. `rot` (V7) :
 * 0 : p = (k·x + tx, k·y + ty) ; 1 : quart de tour horaire, p = (tx − k·y, ty + k·x) (la colonne 0 est en haut, la ligne 0 à droite).
 */
export function makeView(L, zoom = 1, dx = 0, dy = 0, cols, rows) {
  const rot = L.rot === 1 ? 1 : 0;
  const nx = cols !== undefined ? cols : Math.round((rot ? L.boardH : L.boardW) / L.cell), ny = rows !== undefined ? rows : Math.round((rot ? L.boardW : L.boardH) / L.cell);
  const k = L.cell * zoom, cx = L.x0 + L.boardW / 2 + dx, cy = L.y0 + L.boardH / 2 + dy;
  if (rot) return { k, tx: cx + (k * ny) / 2, ty: cy - (k * nx) / 2, cols: nx, rows: ny, w: L.w, h: L.h, rot };
  return { k, tx: cx - (k * nx) / 2, ty: cy - (k * ny) / 2, cols: nx, rows: ny, w: L.w, h: L.h, rot };
}
export const worldToScreen = (V, x, y, out = [0, 0]) => {
  if (V.rot === 1) { out[0] = V.tx - V.k * y; out[1] = V.ty + V.k * x; } else { out[0] = V.k * x + V.tx; out[1] = V.k * y + V.ty; }
  return out;
};
export const screenToWorld = (V, px, py, out = [0, 0]) => {
  if (V.rot === 1) { out[0] = (py - V.ty) / V.k; out[1] = (V.tx - px) / V.k; } else { out[0] = (px - V.tx) / V.k; out[1] = (py - V.ty) / V.k; }
  return out;
};

/** Centre du plateau à l'écran, d'après la vue. */
export function viewCenter(V) {
  return worldToScreen(V, V.cols / 2, V.rows / 2);
}

/** Direction sur le plateau (colonnes, lignes) d'une flèche donnée à l'écran : la flèche « haut » va vers le haut de l'écran (V7). */
export function screenDirToBoard(V, dx, dy) {
  return V !== null && V.rot === 1 ? [dy, -dx] : [dx, dy];
}

/** Case (c, r) sous le point (px, py) en pixels CSS du canvas, ou null hors plateau. */
export function cellAt(V, px, py) {
  const w = screenToWorld(V, px, py), x = w[0], y = w[1];
  if (!(x >= 0 && y >= 0 && x < V.cols && y < V.rows)) return null;
  return { c: Math.floor(x), r: Math.floor(y) };
}

/**
 * Case sous un point de la fenêtre (V3-19) : `view` est celle de la dernière image PRÉSENTÉE, calculée sur le rectangle `frameRect` du canvas ;
 * si le canvas a été étiré en CSS depuis (rectangle courant `rect`), le point est ramené au rectangle de cette image.
 * @param {{left:number,top:number,width:number,height:number}} rect  rectangle courant du canvas (getBoundingClientRect)
 * @param {{width:number,height:number}} frameRect  rectangle du canvas lors de la dernière image
 */
export function cellAtClient(V, clientX, clientY, rect, frameRect) {
  const sx = rect.width > 0 ? frameRect.width / rect.width : 1, sy = rect.height > 0 ? frameRect.height / rect.height : 1;
  return cellAt(V, (clientX - rect.left) * sx, (clientY - rect.top) * sy);
}

