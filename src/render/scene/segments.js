// Post-traitement des séries de faisceau (ARCHITECTURE_V3_RENDU V3-7, V3-8, V3-37, V3-9). Module PUR, partagé par le rendu Canvas 2D et le rendu WebGL.
// Entrée : la sortie du moteur (E10) lue seule : `segments()`, `in`, `out`, plus le type de pièce de chaque case.
// Sortie : des tronçons droits ou obliques en unités de case, que les deux rendus dessinent tels quels, pour que l'image ne mente pas :
//  - COUPURE (V3-7) : sur une case SANS pièce déviante (vide, filtre, porte) où un trait droit passe sur chacun des deux axes et où l'union des
//    deux masques diffère de chacun, le faisceau HORIZONTAL est coupé sur ±0,18 case (fondu de 0,06 au bord) ; l'anneau de croisement se dessine par-dessus.
//  - VOIES (V3-8, V3-37) : deux faisceaux de sens opposés et de masques différents sur une même ligne sont décalés, chacun à droite de son sens,
//    sur leur section commune ; biseau de 0,25 case à chaque extrémité de la section (raccord au centre de la case) ; la coupure passe d'abord.
// Aucune allocation par image (tableaux alloués une fois par taille de plateau) ; aucun tronçon perdu en silence (`overflow` compte les pertes).
import { EMPTY, WALL, TARGET, MIRROR, EMITTER, SPLITTER, PRISM, FILTER, PORTAL, GATE } from '../../engine/board.js';

export const CUT_HALF = 0.18; // demi-largeur de la coupure (case)
export const CUT_FADE = 0.06; // fondu au bord de la coupure (case), dans le tronçon conservé
export const LANE_MIN = 0.07; // décalage d'une voie (case), plancher
export const LANE_MAX = 0.12; // plafond
export const LANE_MIN_PX = 3; // décalage minimal en pixels
export const LANE_BEVEL = 0.25; // biseau de raccord (case)
const EPS = 1e-6;

const KIND_OF_TYPE = { wall: WALL, target: TARGET, mirror: MIRROR, emitter: EMITTER, splitter: SPLITTER, prism: PRISM, filter: FILTER, portal: PORTAL, gate: GATE };

/** true pour les cases où une traversée trompeuse est coupée (V3-7) : aucune pièce qui dévie. Jamais miroir, prisme, séparateur, portail, émetteur, cible, mur. */
export function isCuttableKind(k) {
  return k === EMPTY || k === FILTER || k === GATE;
}

/** Remplit (ou crée) le tableau des types de case (numérotation de engine/board.js) d'un état. */
export function kindsOfState(state, out) {
  const n = state.cols * state.rows;
  const k = out && out.length === n ? out : new Uint8Array(n);
  k.fill(EMPTY);
  for (let i = 0; i < state.pieces.length; i++) {
    const p = state.pieces[i];
    k[p.r * state.cols + p.c] = KIND_OF_TYPE[p.type] ?? EMPTY;
  }
  return k;
}

/** Décalage d'une voie en cases, pour une case de `cellPx` pixels : max(0,07 case, 3 px), plafonné à 0,12 case. */
export function laneOffset(cellPx) {
  return Math.min(LANE_MAX, Math.max(LANE_MIN, LANE_MIN_PX / Math.max(1, cellPx)));
}

/** Classe une case (V3-7) : { thru, lie, cut }. Fonction pure sur les tableaux du moteur. */
export function classifyCell(kind, inM, outM, c) {
  const b = c * 4;
  const h = (inM[b] & outM[b]) | (inM[b + 2] & outM[b + 2]);
  const v = (inM[b + 1] & outM[b + 1]) | (inM[b + 3] & outM[b + 3]);
  const thru = h !== 0 && v !== 0;
  const u = h | v;
  const lie = thru && u !== h && u !== v;
  return { thru, lie, cut: lie && isCuttableKind(kind[c]) };
}

/** Capacité du tampon de tronçons (V3-9) : borne sûre après coupures et voies. */
export function segmentCapacity(cols, rows) {
  return 8 * cols * rows + 8;
}

/**
 * Prépare le post-traitement d'un plateau cols×rows (tableaux réutilisés à chaque `run`).
 * `post.out` : count, x0, y0, x1, y1 (croissants sur l'axe du tronçon), mask, axis (0 horizontal, 1 vertical),
 * glow (bit 0 : halo au début, bit 1 : à la fin ; seulement aux vraies extrémités d'un faisceau), fa, fb (fondu au début / à la fin, en cases).
 * `post.tokens` : positions des jetons-symboles (entre deux centres de cases, décalées avec leur voie).
 * `post.cuts` / `post.cutCount` : cases coupées (l'anneau de croisement se dessine sur elles et sur elles seules).
 */
export function createSegmentPost(cols, rows) {
  const n = cols * rows, cap = segmentCapacity(cols, rows), tcap = 2 * n + cap;
  const out = {
    count: 0, x0: new Float32Array(cap), y0: new Float32Array(cap), x1: new Float32Array(cap), y1: new Float32Array(cap),
    mask: new Uint8Array(cap), axis: new Uint8Array(cap), glow: new Uint8Array(cap), fa: new Float32Array(cap), fb: new Float32Array(cap),
  };
  const tokens = { count: 0, x: new Float32Array(tcap), y: new Float32Array(tcap), mask: new Uint8Array(tcap), axis: new Uint8Array(tcap) }; // axis (V10) : 0 faisceau horizontal, 1 vertical (sens du marqueur)
  const cuts = new Int32Array(n);
  const dead = new Uint8Array(cap);
  const IC = 2 * (cols + rows) + 8; // sections communes par tronçon brut (disjointes, ≥ 0,5 case)
  const ia = new Float64Array(IC), ib = new Float64Array(IC);
  const rAxis = new Uint8Array(cap), rDir = new Uint8Array(cap), rMask = new Uint8Array(cap);
  const rLine = new Float64Array(cap), rLo = new Float64Array(cap), rHi = new Float64Array(cap);

  const post = { cols, rows, out, tokens, cuts, cutCount: 0, overflow: 0, laneCount: 0, run };

  /** Ajoute un tronçon allant de (a0, l0) à (a1, l1), a = abscisse sur l'axe, l = position sur la ligne ; a1 > a0. Halo seulement aux extrémités [lo, hi] du tronçon brut. */
  function emit(axis, m, a0, l0, a1, l1, lo, hi) {
    const i = out.count;
    if (i >= cap) { post.overflow++; return; }
    out.count = i + 1;
    if (axis === 0) { out.x0[i] = a0; out.y0[i] = l0; out.x1[i] = a1; out.y1[i] = l1; } else { out.x0[i] = l0; out.y0[i] = a0; out.x1[i] = l1; out.y1[i] = a1; }
    out.mask[i] = m; out.axis[i] = axis;
    out.glow[i] = (Math.abs(a0 - lo) < EPS ? 1 : 0) | (Math.abs(a1 - hi) < EPS ? 2 : 0);
    out.fa[i] = 0; out.fb[i] = 0; dead[i] = 0;
  }

  /** Retire ±CUT_HALF autour de (cx, cy) des tronçons horizontaux de la case : coupe, raccourcit ou scinde. */
  function clipCut(cx, cy) {
    const gl = cx - CUT_HALF, gr = cx + CUT_HALF, N = out.count;
    for (let i = 0; i < N; i++) {
      if (out.axis[i] !== 0 || dead[i] === 1) continue;
      const xa = out.x0[i], xb = out.x1[i], ya = out.y0[i], yb = out.y1[i];
      if (Math.abs(ya - cy) > 0.5 || Math.abs(yb - cy) > 0.5) continue; // pas sur la rangée de la case
      if (xb <= gl + EPS || xa >= gr - EPS) continue; // ne touche pas la coupure
      const yAt = (x) => (xb === xa ? ya : ya + ((yb - ya) * (x - xa)) / (xb - xa));
      const keepL = xa < gl - EPS, keepR = xb > gr + EPS;
      const g0 = out.glow[i], f0b = out.fb[i], m = out.mask[i];
      if (!keepL && !keepR) { dead[i] = 1; continue; }
      if (keepL && keepR) { // scission : la partie droite est un nouveau tronçon
        const j = out.count;
        if (j >= cap) { post.overflow++; } else {
          out.count = j + 1;
          out.x0[j] = gr; out.y0[j] = yAt(gr); out.x1[j] = xb; out.y1[j] = yb; out.mask[j] = m; out.axis[j] = 0;
          out.glow[j] = g0 & 2; out.fa[j] = Math.min(CUT_FADE, xb - gr); out.fb[j] = f0b; dead[j] = 0;
        }
        out.x1[i] = gl; out.y1[i] = yAt(gl); out.glow[i] = g0 & 1; out.fb[i] = Math.min(CUT_FADE, gl - xa);
      } else if (keepL) {
        out.x1[i] = gl; out.y1[i] = yAt(gl); out.glow[i] = g0 & 1; out.fb[i] = Math.min(CUT_FADE, gl - xa);
      } else {
        out.x0[i] = gr; out.y0[i] = yAt(gr); out.glow[i] = g0 & 2; out.fa[i] = Math.min(CUT_FADE, xb - gr);
      }
    }
  }

  function compact() {
    let w = 0;
    for (let i = 0; i < out.count; i++) {
      if (dead[i] === 1) continue;
      if (w !== i) {
        out.x0[w] = out.x0[i]; out.y0[w] = out.y0[i]; out.x1[w] = out.x1[i]; out.y1[w] = out.y1[i];
        out.mask[w] = out.mask[i]; out.axis[w] = out.axis[i]; out.glow[w] = out.glow[i]; out.fa[w] = out.fa[i]; out.fb[w] = out.fb[i];
      }
      w++;
    }
    out.count = w;
  }

  /**
   * @param {{count:number,x0:Float32Array,y0:Float32Array,x1:Float32Array,y1:Float32Array,mask:Uint8Array}} raw  result.segments()
   * @param {Uint8Array} kind  types de case (kindsOfState)
   * @param {Uint8Array} inM  result.in
   * @param {Uint8Array} outM  result.out
   * @param {number} cellPx  taille de case en pixels CSS (décalage des voies)
   * @param {{cuts?:boolean, lanes?:boolean}} [opt]  désactivation d'une des deux règles (tests)
   */
  function run(raw, kind, inM, outM, cellPx, opt) {
    const doCuts = !opt || opt.cuts !== false, doLanes = !opt || opt.lanes !== false;
    out.count = 0; tokens.count = 0; post.overflow = 0; post.laneCount = 0; post.cutCount = 0;
    // 1. cases coupées (V3-7)
    if (doCuts) {
      for (let c = 0; c < n; c++) {
        const b = c * 4;
        if ((inM[b] | inM[b + 1] | inM[b + 2] | inM[b + 3]) === 0 || !isCuttableKind(kind[c])) continue;
        if (classifyCell(kind, inM, outM, c).cut) cuts[post.cutCount++] = c;
      }
    }
    // 2. tronçons bruts normalisés (croissants sur leur axe)
    const S = Math.min(raw.count, cap);
    for (let i = 0; i < S; i++) {
      const x0 = raw.x0[i], y0 = raw.y0[i], x1 = raw.x1[i], y1 = raw.y1[i];
      rMask[i] = raw.mask[i];
      if (y0 === y1) { rAxis[i] = 0; rLine[i] = y0; rLo[i] = Math.min(x0, x1); rHi[i] = Math.max(x0, x1); rDir[i] = x1 >= x0 ? 0 : 2; }
      else { rAxis[i] = 1; rLine[i] = x0; rLo[i] = Math.min(y0, y1); rHi[i] = Math.max(y0, y1); rDir[i] = y1 >= y0 ? 3 : 1; }
    }
    const off = laneOffset(cellPx);
    // 3. tronçons de sortie, voies comprises
    for (let i = 0; i < S; i++) {
      const axis = rAxis[i], m = rMask[i], d = rDir[i], line = rLine[i], lo = rLo[i], hi = rHi[i];
      let k = 0;
      if (doLanes) { // sections communes avec les tronçons de sens opposé et de masque différent (triées)
        for (let j = 0; j < S; j++) {
          if (j === i || rAxis[j] !== axis || rLine[j] !== line || rDir[j] !== ((d + 2) & 3) || rMask[j] === m) continue;
          const a = Math.max(lo, rLo[j]), b = Math.min(hi, rHi[j]);
          if (b - a <= EPS) continue;
          if (k >= IC) { post.overflow++; continue; }
          let p = k++;
          while (p > 0 && ia[p - 1] > a) { ia[p] = ia[p - 1]; ib[p] = ib[p - 1]; p--; }
          ia[p] = a; ib[p] = b;
        }
      }
      const lat = (d === 0 || d === 1 ? 1 : -1) * off; // à droite du sens de marche : E → +y, N → +x, W → −y, S → −x
      let cur = lo;
      for (let q = 0; q < k; q++) {
        const a = ia[q], b = ib[q], bv = Math.min(LANE_BEVEL, (b - a) / 2);
        if (a - cur > EPS) emit(axis, m, cur, line, a, line, lo, hi);
        post.laneCount++;
        emit(axis, m, a, line, a + bv, line + lat, lo, hi);
        if (b - a - 2 * bv > EPS) emit(axis, m, a + bv, line + lat, b - bv, line + lat, lo, hi);
        emit(axis, m, b - bv, line + lat, b, line, lo, hi);
        cur = b;
      }
      if (hi - cur > EPS) emit(axis, m, cur, line, hi, line, lo, hi);
      // jetons-symboles : entre deux centres de cases (abscisse entière), sur la voie le cas échéant
      for (let u = Math.abs(lo - Math.round(lo)) < EPS ? lo + 1 : lo + 0.5; u < hi - 0.2; u += 2) { // toujours sur une frontière de case (jamais au centre d'une case)
        let lt = 0;
        for (let q = 0; q < k; q++) {
          if (u >= ia[q] - EPS && u <= ib[q] + EPS) { const bv = Math.min(LANE_BEVEL, (ib[q] - ia[q]) / 2); lt = lat * Math.min(1, (u - ia[q]) / bv, (ib[q] - u) / bv); break; }
        }
        if (tokens.count < tcap) { const t = tokens.count++; tokens.x[t] = axis === 0 ? u : line + lt; tokens.y[t] = axis === 0 ? line + lt : u; tokens.mask[t] = m; tokens.axis[t] = axis; }
      }
    }
    // 4. coupures : ±0,18 case du faisceau horizontal autour du centre de chaque case coupée (après les voies : la coupure passe d'abord)
    for (let q = 0; q < post.cutCount; q++) clipCut((cuts[q] % cols) + 0.5, ((cuts[q] / cols) | 0) + 0.5);
    compact();
    return out;
  }
  return post;
}
