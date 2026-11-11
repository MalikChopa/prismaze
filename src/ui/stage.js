// Scène de jeu immersive (ARCHITECTURE_V3_RENDU V3-17, V3-18, V3-19, V3-38) : assemble la mise en page à obstacles, la caméra, la borne de pose
// et la vue présentée. Module PUR (aucun DOM, le temps est une entrée) : se teste sous `node --test`. Indépendant du rendu (2D ou GL).
import { boardLayout, GAP, gapBetween, SLAB_PAD, COMPACT, isCompact } from '../render/scene/layout.js';
import { createCamera, clampPose, makeView, viewCenter, cellAtClient } from '../render/scene/camera.js';
import { pushCeiling } from '../render/scene/victory.js';

/**
 * Plus grand zoom (autour du centre du plateau, recentrage par `clampPose` compris) sans sortir de la zone visible ni entrer dans un obstacle (V3-38). Pur.
 * @param {object} L  sortie de layout() ; @param {Array} obstacles  rectangles {x,y,w,h} ; @param {{l,t,r,b}} bounds  zone visible
 * @returns {number} zoom >= 1
 */
export function maxFreeZoom(L, obstacles, bounds, hi = 1.2) {
  const cx = L.x0 + L.boardW / 2, cy = L.y0 + L.boardH / 2;
  const base = { l: L.x0, t: L.y0, r: L.x0 + L.boardW, b: L.y0 + L.boardH };
  const ok = (z) => {
    const c = clampPose(L, z, 0, 0, obstacles, bounds), hw = (L.boardW * z) / 2, hh = (L.boardH * z) / 2;
    const b = { l: cx + c.dx - hw, r: cx + c.dx + hw, t: cy + c.dy - hh, b: cy + c.dy + hh };
    if (bounds && (b.l < bounds.l - 0.5 || b.t < bounds.t - 0.5 || b.r > bounds.r + 0.5 || b.b > bounds.b + 0.5)) return false;
    for (const o of obstacles) {
      const need = Math.min(GAP, Math.max(0, gapBetween(base, o)));
      if (Math.max(o.x - b.r, b.l - (o.x + o.w), o.y - b.b, b.t - (o.y + o.h)) < need - 0.5) return false;
    }
    return true;
  };
  if (!ok(1)) return 1;
  if (ok(hi)) return hi;
  let lo = 1;
  for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  return lo;
}

export const COMPACT_MORPH_MS = 1200, COMPACT_MORPH_PER_ZOOM = 1650; // V12 : glissement de victoire en paysage bas : durée ∝ (rapport des cases − 1), au plus 1,2 s (voir relayout)
export const MORPH_MS = 400; // passage jeu → gagné : le plateau glisse de sa pose d'avant à sa nouvelle pose (instantané en mouvement réduit ou caméra coupée)
const EPS_PX = 0.004, EPS_ZOOM = 0.0001; // en dessous, la caméra est posée : plus aucune image demandée

/**
 * @param {{gl?:boolean, reduced?:boolean, enabled?:boolean, touch?:boolean}} [opt]
 */
export function createStage(opt = {}) {
  const camera = createCamera(opt);
  let gl = opt.gl === true, reduced = opt.reduced === true, enabled = opt.enabled !== false;
  const rotation = opt.rotation === true; // V7 : rotation du plateau en portrait permise (règle : layout.js, shouldRotate)
  let L = null, obstacles = [], bounds = null, cols = 1, rows = 1, frameW = 1, frameH = 1;
  let view = null, morph = null, moving = false, compactNow = false;
  const pose = { zoom: 1, dx: 0, dy: 0, floorDx: 0, floorDy: 0 };
  let rawZ = 1, rawX = 0, rawY = 0;
  let zoomCeil = null; // plafond du zoom pendant la poussée de victoire (V3-38), null hors victoire

  return {
    camera,
    get layout() { return L; },
    /** V13b : la dernière mise en page est-elle en paysage bas (rails) ? */
    get compact() { return compactNow; },
    /** Vue de la dernière image présentée : { k, tx, ty, cols, rows, w, h } (null avant la première image). */
    get view() { return view; },
    get pose() { return pose; },
    /** true tant que la caméra ou le glissement jeu → gagné bouge encore : l'appelant redemande une image. */
    get moving() { return moving; },
    set(o) {
      if (o.gl !== undefined) gl = o.gl === true;
      if (o.reduced !== undefined) reduced = o.reduced === true;
      if (o.enabled !== undefined) enabled = o.enabled !== false;
      camera.set(o);
      if (reduced || !enabled) morph = null;
    },

    /**
     * Recalcule la mise en page (fenêtre, plateau, obstacles mesurés). Rendu 2D : case entière et origine entière (netteté).
     * @param {{w:number,h:number,cols:number,rows:number,safe?:object,obstacles?:Array,morphAt?:number}} p  morphAt : horodatage du passage jeu → gagné
     */
    relayout(p) {
      const safe = p.safe || {};
      const compact = typeof p.compact === 'boolean' ? p.compact : isCompact(p.w, p.h); // V13b : réponse de matchMedia(COMPACT_QUERY) donnée par game.js (source unique : la règle CSS) ; V12 : paysage bas, interface en deux rails (index.html), plateau entre les deux sur toute la hauteur
      const next = boardLayout({ w: p.w, h: p.h, cols: p.cols, rows: p.rows, safe, obstacles: p.obstacles || [], rotationObstacles: p.rotationObstacles, integerCell: !gl, rotation, pad: gl ? SLAB_PAD : 0, cornerRetreat: gl && !compact, rails: compact, slack: compact ? COMPACT.SLACK : undefined }); // V9b : la dalle WebGL tenue à l'écart des pastilles (915×412 : légende sur le coin)
      if (!gl) { next.x0 = Math.round(next.x0); next.y0 = Math.round(next.y0); }
      morph = null;
      if (p.morphAt !== undefined && view !== null && !reduced && enabled && p.w === frameW && p.h === frameH && view.rot === next.rot) {
        const c = viewCenter(view);
        // V12 : en paysage bas (rails), le plateau rétrécit nettement à la victoire : glissement en S d'autant plus long que le rapport des cases est grand, sinon le
        // balayage des faisceaux sur un grand tiers de l'écran fait un flash général (37 % mesuré en 400 ms, qualité Haut, V3-20) ; d'un coup, la luminance moyenne saute (0,07 > 0,05).
        const z = view.k / next.cell, base = p.morphMs > 0 ? p.morphMs : MORPH_MS;
        const ms = compact ? Math.max(base, Math.min(COMPACT_MORPH_MS, COMPACT_MORPH_PER_ZOOM * (z - 1))) : base;
        morph = { t0: p.morphAt, ms, smooth: compact, z: view.k / next.cell, x: c[0] - (next.x0 + next.boardW / 2), y: c[1] - (next.y0 + next.boardH / 2) };
      }
      if (zoomCeil !== null) zoomCeil = 1.03; // mise en page de victoire : le panneau compte désormais, la poussée finit dans la marge de V3-38
      compactNow = compact;
      L = next; obstacles = p.obstacles || []; cols = p.cols; rows = p.rows; frameW = p.w; frameH = p.h;
      bounds = { l: safe.left || 0, t: safe.top || 0, r: p.w - (safe.right || 0), b: p.h - (safe.bottom || 0) };
      return L;
    },

    /**
     * Pose de l'image `now` (ms), bornée pour que le plateau n'entre jamais dans un obstacle.
     * @param {{pointer?:{nx:number,ny:number}|null, dragging?:boolean, target?:{x:number,y:number}|null, dpr?:number}} io
     * @returns {{zoom:number,dx:number,dy:number,floorDx:number,floorDy:number}}
     */
    frame(now, io = {}) {
      const raw = camera.update(now, { w: L.w, h: L.h, pointer: io.pointer || null, dragging: io.dragging === true, target: io.target || null });
      let zoom = raw.zoom;
      if (zoomCeil !== null && zoom > zoomCeil) zoom = Math.max(zoomCeil, 1); // V3-38 : la poussée ne dépasse jamais ce que les obstacles permettent
      const c = clampPose(L, zoom, raw.dx, raw.dy, obstacles, bounds);
      let dx = c.dx, dy = c.dy;
      moving = Math.abs(raw.zoom - rawZ) > EPS_ZOOM || Math.abs(raw.dx - rawX) > EPS_PX || Math.abs(raw.dy - rawY) > EPS_PX;
      rawZ = raw.zoom; rawX = raw.dx; rawY = raw.dy;
      if (!gl && zoom === 1) { const d = io.dpr > 0 ? io.dpr : 1; dx = Math.round(dx * d) / d; dy = Math.round(dy * d) / d; } // 2D : décalage sur un pixel de l'écran
      if (morph !== null) {
        const t = (now - morph.t0) / morph.ms;
        if (t >= 1) morph = null;
        else {
          const u = Math.max(0, t), e = 1 - u, f = morph.smooth ? 1 - u * u * (3 - 2 * u) : e * e; // part restante, décélérée (V12, paysage bas : en S, vitesse maximale plus basse)
          zoom += (morph.z - zoom) * f; dx += (morph.x - dx) * f; dy += (morph.y - dy) * f;
          moving = true;
        }
      }
      pose.zoom = zoom; pose.dx = dx; pose.dy = dy; pose.floorDx = raw.floorDx; pose.floorDy = raw.floorDy;
      view = makeView(L, zoom, dx, dy, cols, rows);
      return pose;
    },

    /** Case sous un point de la fenêtre, d'après la dernière image présentée (V3-19), ou null. `rect` : rectangle courant du canvas. */
    cellAt(clientX, clientY, rect) {
      if (view === null) return null;
      return cellAtClient(view, clientX, clientY, rect, { width: frameW, height: frameH });
    },

    /** Poussée de victoire : le zoom est borné par la place libre mesurée (`free`, obstacles encore visibles à t = 0, sans le panneau pas encore affiché) ; jamais moins que 1,03 (V3-38). */
    victoryPush(now, free = obstacles) { zoomCeil = pushCeiling(maxFreeZoom(L, free, bounds)); camera.win(now); },
    clearVictoryPush() { zoomCeil = null; camera.clearWin(); },
    get zoomCeil() { return zoomCeil; },
  };
}
