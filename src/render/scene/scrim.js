// Voile de lisibilité du texte flottant (ARCHITECTURE_V3_RENDU V3-23). Module PUR.
// Plaque de verre à 0,30 d'opacité au repos, 0,70 dès qu'un tronçon de faisceau (marge 0,6 case) recouvre le rectangle d'un élément.
// Calculé SEULEMENT quand la vue ou le tracé changent ; la transition de l'opacité dure 200 ms (appliquée par `step`, ou en CSS).
export const SCRIM = Object.freeze({ LOW: 0.3, HIGH: 0.7, MARGIN_CASES: 0.6, TRANSITION_MS: 200, VEIL: '#060714', TEXT: '#eef0ff' });

/**
 * Pour chaque rectangle {x, y, w, h} (pixels CSS du canvas), true si un tronçon touche le rectangle élargi de MARGIN_CASES cases.
 * @param {Array<{x:number,y:number,w:number,h:number}>} rects
 * @param {{count:number,x0:Float32Array,y0:Float32Array,x1:Float32Array,y1:Float32Array}} segs  tronçons en unités de case (scene/segments.js ou result.segments())
 * @param {{k:number,tx:number,ty:number}} view  vue (camera.makeView)
 * @param {Uint8Array} [out]  réutilisé si fourni
 */
export function scrimHits(rects, segs, view, out) {
  const hit = out && out.length >= rects.length ? out : new Uint8Array(rects.length);
  const m = SCRIM.MARGIN_CASES * view.k;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i], l = r.x - m, t = r.y - m, rr = r.x + r.w + m, b = r.y + r.h + m;
    let h = 0;
    for (let s = 0; s < segs.count && h === 0; s++) {
      const ax = view.k * segs.x0[s] + view.tx, ay = view.k * segs.y0[s] + view.ty, bx = view.k * segs.x1[s] + view.tx, by = view.k * segs.y1[s] + view.ty;
      // tronçon (segment de droite) contre rectangle élargi : boîte englobante puis test de Liang-Barsky
      if (Math.max(ax, bx) < l || Math.min(ax, bx) > rr || Math.max(ay, by) < t || Math.min(ay, by) > b) continue;
      let t0 = 0, t1 = 1;
      const dx = bx - ax, dy = by - ay, P = [-dx, dx, -dy, dy], Q = [ax - l, rr - ax, ay - t, b - ay];
      let ok = true;
      for (let e = 0; e < 4 && ok; e++) {
        if (P[e] === 0) { if (Q[e] < 0) ok = false; } else {
          const u = Q[e] / P[e];
          if (P[e] < 0) { if (u > t1) ok = false; else if (u > t0) t0 = u; } else if (u < t0) ok = false; else if (u < t1) t1 = u;
        }
      }
      if (ok) h = 1;
    }
    hit[i] = h;
  }
  return hit;
}

/** Opacités cibles (0,30 ou 0,70) d'après `scrimHits`. */
export function scrimTargets(hits, n, out) {
  const o = out && out.length >= n ? out : new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = hits[i] ? SCRIM.HIGH : SCRIM.LOW;
  return o;
}

/** État de transition : `opacity[i]` rejoint `target[i]` linéairement en TRANSITION_MS. */
export function createScrim(n) {
  const opacity = new Float32Array(n).fill(SCRIM.LOW);
  return {
    opacity,
    step(target, dtMs) {
      const d = ((SCRIM.HIGH - SCRIM.LOW) * dtMs) / SCRIM.TRANSITION_MS;
      for (let i = 0; i < n; i++) {
        const diff = target[i] - opacity[i];
        opacity[i] = Math.abs(diff) <= d ? target[i] : opacity[i] + Math.sign(diff) * d;
      }
      return opacity;
    },
  };
}

// --- contraste (WCAG 2.x) ---
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
/** Rapport de contraste WCAG entre deux luminances relatives. */
export function contrast(l1, l2) { const a = Math.max(l1, l2), b = Math.min(l1, l2); return (a + 0.05) / (b + 0.05); }
/** Contraste du texte SCRIM.TEXT posé sur un fond `bgHex` recouvert du voile SCRIM.VEIL à l'opacité `alpha`. */
export function textContrast(bgHex, alpha) {
  const v = rgb(SCRIM.VEIL), bg = rgb(bgHex), mix = bg.map((c, i) => alpha * v[i] + (1 - alpha) * c);
  // mélange fait en valeurs sRGB (comme le compositeur du navigateur)
  return contrast(luminance(rgb(SCRIM.TEXT)), luminance(mix));
}
