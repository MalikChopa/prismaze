// Données d'instances du rendu WebGL (pur : aucun appel GL, testable sous Node). Lit l'état et le tracé E10 en lecture seule et remplit des tableaux typés :
// `under` (pièces sous les faisceaux), `over` (portails : après les faisceaux, avant le bloom), `top` (après la composition, net et lisible hors bloom : jetons, états de cible, pastilles, anneaux, curseur, fantômes, V3-32), `fan` (dispersion du prisme).
// Une instance = 24 flottants : x, y, demi-taille, type | rotation, a, b, c | r, g, b, symbole | r, g, b, a(reçu) | p0..p3 | état, mobile, opacité, n.
// Aucune allocation par image une fois les tableaux à la bonne taille. V3-39 : mêmes pièces et mêmes états que le Canvas 2D.
import { COLOR_HUES } from '../../engine/colors.js';
import { THEME, GEOM } from '../theme.js';

export const FLOATS = 24;

/** Cible : 0 éteinte (pointillé), 1 partielle (anneau plein), 2 trop (croix), 3 allumée (plein + coche). Même règle que `drawTarget` du Canvas 2D (V3-32). */
export function targetVisualState(x) {
  if (x.lit) return 3;
  if (x.reached) return 2;
  return x.got !== 0 ? 1 : 0;
}
export const TARGET_STATE_NAMES = Object.freeze(['eteinte', 'partielle', 'trop', 'allumee']);

const hexToLinear = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255) ** 2.2); };
/** Teintes linéaires des 7 masques (COLOR_HUES du moteur : une couleur = une forme). */
export const LIN = Object.freeze(COLOR_HUES.map((h) => (h ? Object.freeze(hexToLinear(h)) : Object.freeze([0, 0, 0]))));
const PORTAL_LIN = THEME.portalHues.map(hexToLinear);
const GATE_LIN = hexToLinear(THEME.gate);
const ACCENT_LIN = hexToLinear(THEME.accentLight);
const WHITE = [1, 1, 1], PINK = [1, 0.25, 0.36];
const BITS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7].map((m) => [m & 1 ? 1 : 0, m & 2 ? 1 : 0, m & 4 ? 1 : 0])); // masque -> (R, V, B) pour l'éventail
/** Masque (1..7) -> symbole du shader (0 triangle, 1 disque, 2 carré, 3 croix, 4 losange, 5 étoile, 6 anneau). */
export const SYM_OF_MASK = Object.freeze([0, 0, 1, 3, 2, 4, 5, 6]);

export const T = Object.freeze({ WALL: 0, MIRROR: 1, PRISM: 2, FILTER: 3, EMITTER: 4, TARGET: 5, GATE: 6, LINK: 7, FRAME: 8, TOKEN: 9, SPLITTER: 10, PORTAL: 11, RING: 12, TARGET_OVER: 13, PASTILLES: 14, HINT_RING: 15, REFUSED: 16, BAR: 17 });

const QUARTER = Math.PI / 4;
const SLIDE_MS = 170, SHAKE_MS = 260, MARK_MS = 900, GATE_MS = 250, PULSE_S = 1.2;

function createList(cap) {
  const list = { data: new Float32Array(cap * FLOATS), count: 0, cap };
  return list;
}
function reserve(list, n) {
  if (n <= list.cap) return;
  while (list.cap < n) list.cap *= 2;
  list.data = new Float32Array(list.cap * FLOATS);
}

/**
 * @param {{reduced?:boolean}} [opts]
 */
export function createPieceBuilder(opts = {}) {
  let reduced = opts.reduced === true;
  let sig = '', decorFor = null;
  let order = [], targets = [], gates = [], portals = [], prisms = [];
  let ang = new Float64Array(0), angT = new Float64Array(0), shownO = new Int8Array(0), px = new Float64Array(0), py = new Float64Array(0), hit = new Float64Array(0);
  let tl = new Float64Array(0), tp = new Float64Array(0), litAt = new Float64Array(0), gateT = new Float64Array(0), prevLit = new Uint8Array(0);
  let linkMap = new Map(); // case de cible liée -> numéro de pastilles
  let links = [];
  let first = true, busy = false;
  const under = createList(160), over = createList(32), top = createList(120), fan = createList(16);

  function put(L, t, x, y, h, rot, a, b, c, col, sym, got, gotA, p0, p1, p2, p3, state, mv, alpha, n) {
    reserve(L, L.count + 1);
    const d = L.data; let o = L.count * FLOATS; L.count++;
    d[o++] = x; d[o++] = y; d[o++] = h; d[o++] = t; d[o++] = rot; d[o++] = a; d[o++] = b; d[o++] = c;
    d[o++] = col[0]; d[o++] = col[1]; d[o++] = col[2]; d[o++] = sym;
    d[o++] = got[0]; d[o++] = got[1]; d[o++] = got[2]; d[o++] = gotA;
    d[o++] = p0; d[o++] = p1; d[o++] = p2; d[o++] = p3; d[o++] = state; d[o++] = mv; d[o++] = alpha; d[o++] = n;
  }

  function resetFor(state) {
    const n = state.pieces.length;
    ang = new Float64Array(n); angT = new Float64Array(n); shownO = new Int8Array(n).fill(-1); px = new Float64Array(n); py = new Float64Array(n); hit = new Float64Array(n);
    for (let i = 0; i < n; i++) { const p = state.pieces[i]; px[p.id] = p.c + 0.5; py[p.id] = p.r + 0.5; }
    first = true;
  }

  function decor(state, nowS) {
    if (decorFor === state) return;
    const key = levelSignature(state);
    if (key !== sig) { sig = key; resetFor(state); }
    decorFor = state;
    order = []; targets = []; gates = []; portals = []; prisms = [];
    const rank = { wall: 0, gate: 1, filter: 2, prism: 3, mirror: 4, splitter: 5, emitter: 6 };
    const bucket = [[], [], [], [], [], [], []];
    for (let i = 0; i < state.pieces.length; i++) {
      const p = state.pieces[i];
      if (p.type === 'target') targets.push(p);
      else if (p.type === 'portal') portals.push(p);
      else if (rank[p.type] !== undefined) { bucket[rank[p.type]].push(p); if (p.type === 'prism') prisms.push(p); if (p.type === 'gate') gates.push(p); }
    }
    for (const b of bucket) for (const p of b) order.push(p);
    if (tl.length !== targets.length) { tl = new Float64Array(targets.length); tp = new Float64Array(targets.length); litAt = new Float64Array(targets.length).fill(-1e9); prevLit = new Uint8Array(targets.length); }
    if (gateT.length !== gates.length) gateT = new Float64Array(gates.length);
    linkMap = new Map(); links = [];
    for (let g = 0; g < gates.length; g++) {
      const lk = gates[g].link;
      if (lk) {
        const tgt = state.pieces.find((q) => q.type === 'target' && q.c === lk[0] && q.r === lk[1]);
        if (tgt !== undefined) { links.push({ gate: gates[g], target: tgt }); if (!linkMap.has(tgt.id)) linkMap.set(tgt.id, g + 1); }
      }
    }
    void nowS;
  }

  function refuseOffset(rf, cell, nowMs, rotated) { // retour d'un lâcher refusé (même chronologie que le Canvas 2D), en cases
    if (reduced) return [0, 0];
    const age = nowMs - rf.t0;
    if (age < 0) return [0, 0];
    if (rf.at !== null && age < SLIDE_MS) { const f = 1 - age / SLIDE_MS, e = f * f; return [(rf.at.c - rf.from.c) * e, (rf.at.r - rf.from.r) * e]; }
    const a = age - (rf.at !== null ? SLIDE_MS : 0);
    if (a < SHAKE_MS) { const s = Math.sin(a / 24) * 0.09 * (1 - a / SHAKE_MS); return rotated ? [0, s] : [s, 0]; } // V7 : tremblement horizontal à l'écran
    return [0, 0];
  }

  /**
   * @param {object} state  état (engine/state.js)
   * @param {object} result  sortie de trace() (lue seule)
   * @param {object} info  objet d'image de game.js
   * @param {{nowMs:number, dtS:number, snap:boolean, post:object, symbols:boolean, litAllowed?:Uint8Array|null}} f  horloge, durée, `snap` : plus aucune transition (gltest) ; post : tronçons traités (segments.js)
   */
  function build(state, result, info, f) {
    const nowMs = f.nowMs, dt = f.dtS, snap = f.snap || first || reduced, k14 = snap ? 1 : 1 - Math.exp(-dt * 14), k8 = snap ? 1 : 1 - Math.exp(-dt * 8), k22 = snap ? 1 : 1 - Math.exp(-dt * 22);
    decor(state, nowMs / 1000);
    under.count = 0; over.count = 0; top.count = 0; fan.count = 0;
    busy = false;
    const cols = state.cols, inM = result.in;
    const rf = info.refuse || null;
    const refuseAge = rf !== null && rf.t0 !== null && rf.t0 !== undefined ? nowMs - rf.t0 : Infinity;

    for (let l = 0; l < links.length; l++) {
      const a = links[l], gx = a.gate.c + 0.5, gy = a.gate.r + 0.5, tx = a.target.c + 0.5, ty = a.target.r + 0.5;
      if (a.gate.c === a.target.c && a.gate.r === a.target.r) continue;
      put(under, T.LINK, (gx + tx) / 2, (gy + ty) / 2, Math.hypot(gx - tx, gy - ty) / 2 + 0.4, 0, 0, 0, 0, GATE_LIN, 0, GATE_LIN, 0, tx, ty, gx, gy, 0, 0, 1, 0);
    }
    for (let i = 0; i < order.length; i++) {
      const p = order[i], cell = p.r * cols + p.c, b = cell * 4;
      const m = inM[b] | inM[b + 1] | inM[b + 2] | inM[b + 3];
      const hs = m !== 0 ? 1 : 0;
      const h = hit[p.id] += (hs - hit[p.id]) * k14;
      if (Math.abs(hs - hit[p.id]) > 0.01) busy = true;
      let cx = p.c + 0.5, cy = p.r + 0.5;
      px[p.id] += (cx - px[p.id]) * k22; py[p.id] += (cy - py[p.id]) * k22;
      if (Math.abs(cx - px[p.id]) + Math.abs(cy - py[p.id]) > 0.002) busy = true;
      if (!snap) { cx = px[p.id]; cy = py[p.id]; }
      if (rf !== null && rf.id === p.id) { const off = refuseOffset(rf, 1, nowMs, f.rot === 1); cx += off[0]; cy += off[1]; }
      const isLift = info.lift && info.lift.c === p.c && info.lift.r === p.r ? 1 : 0;
      const isCur = info.cursor && info.cursor.c === p.c && info.cursor.r === p.r ? 1 : 0;
      switch (p.type) {
        case 'wall': put(under, T.WALL, cx, cy, 0.62, 0, 0, 0, 0, WHITE, 0, WHITE, 0, 0, 0, 0, 0, 0, 0, 1, 0); break;
        case 'gate': {
          const g = gates.indexOf(p);
          const open = result.gates[g] && result.gates[g].open ? 1 : 0;
          if (snap) gateT[g] = open;
          else if (open === 1) gateT[g] = Math.min(1, gateT[g] + (dt * 1000) / GATE_MS); else gateT[g] = 0;
          if (open === 1 && gateT[g] < 1) busy = true;
          put(under, T.GATE, cx, cy, 0.62, 0, gateT[g], 0, 0, GATE_LIN, 0, GATE_LIN, 0, 0, 0, 0, 0, open, 0, 1, g + 1);
          break;
        }
        case 'filter': {
          put(under, T.FILTER, cx, cy, 0.62, 0, h, 0, 0, LIN[p.mask], 0, WHITE, 0, 0, 0, 0, 0, 0, p.fixed ? 0 : 1, 1, 0);
          put(top, T.TOKEN, cx, cy, 0.3, 0, 0, 0.145, 0, LIN[p.mask], SYM_OF_MASK[p.mask], WHITE, 0, 0, 0, 0, 0, 0, 0, 1, 0);
          break;
        }
        case 'prism': {
          put(under, T.PRISM, cx, cy, 0.85, 0, h, isCur, isLift, WHITE, 0, WHITE, 0, 0, 0, 0, 0, 0, p.fixed ? 0 : 1, 1, 0);
          if (m !== 0) {
            for (let d = 0; d < 4; d++) {
              const mi = inM[b + d];
              if (mi === 0) continue;
              reserve(fan, fan.count + 1);
              put(fan, 0, cx, cy, 1.25, -d * Math.PI / 2, 0, 0, 0, BITS[mi], 0, WHITE, 0, 0, 0, 0, 0, 0, 0, h, 0);
            }
          }
          break;
        }
        case 'mirror': case 'splitter': {
          if (shownO[p.id] === -1) { shownO[p.id] = p.o; angT[p.id] = -p.o * QUARTER; ang[p.id] = angT[p.id]; }
          else if (shownO[p.id] !== p.o) { const dd = ((p.o - shownO[p.id] + 2) & 3) - 2; angT[p.id] -= (dd === -2 ? 2 : dd) * QUARTER; shownO[p.id] = p.o; }
          ang[p.id] += (angT[p.id] - ang[p.id]) * k22;
          if (snap) ang[p.id] = angT[p.id]; else if (Math.abs(ang[p.id] - angT[p.id]) > 0.003) busy = true;
          put(under, p.type === 'mirror' ? T.MIRROR : T.SPLITTER, cx, cy, 0.8, ang[p.id], h, isCur, isLift, WHITE, 0, WHITE, 0, 0, 0, 0, 0, 0, p.fixed ? 0 : 1, 1, 0);
          put(top, T.BAR, cx, cy, 0.62, ang[p.id], h, 0, p.type === 'splitter' ? 1 : 0, WHITE, 0, WHITE, 0, 0, 0, 0, 0, 0, p.fixed ? 0 : 1, 1, 0); // l'orientation reste lisible sous le faisceau (V3-32)
          break;
        }
        case 'emitter': put(under, T.EMITTER, cx, cy, 0.85, -p.dir * Math.PI / 2, h, 0, 0, LIN[p.mask], SYM_OF_MASK[p.mask], WHITE, 0, 0, 0, 0, 0, 0, 0, 1, 0); break;
        default: break;
      }
    }
    // cibles : corps (sous les faisceaux) et état lisible (au-dessus)
    for (let t = 0; t < targets.length; t++) {
      const p = targets[t], x = result.targets[t], col = LIN[x.need], vs = targetVisualState(x), gotCol = LIN[x.got] || LIN[x.need];
      const cx = p.c + 0.5, cy = p.r + 0.5;
      const partT = x.lit || x.got === 0 ? 0 : 1, litT = x.lit ? 1 : 0;
      tl[t] += (litT - tl[t]) * k8; tp[t] += (partT - tp[t]) * k14;
      if (Math.abs(litT - tl[t]) > 0.01 || Math.abs(partT - tp[t]) > 0.01) busy = true;
      if (x.lit && prevLit[t] === 0 && !first && (f.litAllowed === undefined || f.litAllowed === null || f.litAllowed[t] === 1)) litAt[t] = nowMs / 1000; // V3-41 : pas d'éclat si le limiteur refuse
      prevLit[t] = x.lit ? 1 : 0;
      let pulse = 0;
      if (!reduced && !f.snap) { pulse = Math.max(0, 1 - (nowMs / 1000 - litAt[t]) / PULSE_S); if (pulse > 0) busy = true; }
      if (info.won && !reduced && !f.snap) pulse = 0.5 + 0.5 * Math.sin((nowMs / 1000) * 3.2 + t);
      put(under, T.TARGET, cx, cy, 1.0, 0, tl[t], pulse, 0, col, SYM_OF_MASK[x.need], gotCol, tp[t], 0, 0, 0, 0, vs, 0, 1, 0);
      put(top, T.TARGET_OVER, cx, cy, 0.42, 0, tl[t], 0, 0, col, SYM_OF_MASK[x.need], gotCol, 0, 0, 0, 0, 0, vs, 0, 1, 0);
      const n = linkMap.get(p.id);
      if (n !== undefined) put(top, T.PASTILLES, f.rot === 1 ? cx + 0.34 : cx, f.rot === 1 ? cy : cy + 0.34, 0.3, 0, 0, 0, 0, GATE_LIN, 0, WHITE, 0, 0, 0, 0, 0, 0, 0, 1, n);
    }
    // portails : au-dessus des faisceaux (les points de la paire restent lisibles)
    for (let i = 0; i < portals.length; i++) {
      const p = portals[i], b = (p.r * cols + p.c) * 4, on = (inM[b] | inM[b + 1] | inM[b + 2] | inM[b + 3]) !== 0 ? 1 : 0;
      hit[p.id] += (on - hit[p.id]) * k14;
      put(over, T.PORTAL, p.c + 0.5, p.r + 0.5, 0.6, 0, hit[p.id], 0, 0, PORTAL_LIN[p.pair & 3], 0, WHITE, 0, 0, 0, 0, 0, 0, 0, 1, (p.pair & 3) + 1);
    }
    // surimpressions dépendant du tracé (coupures, jetons) : remplies par `drawLater` via post
    if (f.post) {
      const P = f.post, tk = P.tokens;
      for (let q = 0; q < P.cutCount; q++) { const c = P.cuts[q]; put(top, T.RING, (c % cols) + 0.5, ((c / cols) | 0) + 0.5, 0.3, 0, 0, 0, 0, WHITE, 0, WHITE, 0, 0, 0, 0, 0, 0, 0, 1, 0); }
      if (f.symbols !== false) for (let i = 0; i < tk.count; i++) put(top, T.TOKEN, tk.x[i], tk.y[i], 0.3, tk.axis[i] === 1 ? Math.PI / 2 : 0, 0, 0, 0, LIN[tk.mask[i]], SYM_OF_MASK[tk.mask[i]], WHITE, 0, 0, 0, 0, 0, 0, 0, 1, 0);
    }
    // éléments d'interface sur le plateau : case refusée, indice, aperçu, curseur, éclair de sélection
    if (rf !== null && rf.t0 !== null && rf.t0 !== undefined && refuseAge < MARK_MS) {
      const m = rf.at !== null ? rf.at : rf.from, fade = reduced || refuseAge < MARK_MS * 0.6 ? 1 : 1 - (refuseAge - MARK_MS * 0.6) / (MARK_MS * 0.4);
      put(top, T.REFUSED, m.c + 0.5, m.r + 0.5, 0.62, 0, 0, 0, 0, PINK, 0, WHITE, 0, 0, 0, 0, 0, 0, 0, Math.max(0, fade), 0);
      busy = true;
    }
    const hintI = info.hint;
    if (hintI) {
      const gh = hintI.ghost, src = hintI.source;
      if (hintI.moves) put(top, T.LINK, (src.c + gh.c) / 2 + 0.5, (src.r + gh.r) / 2 + 0.5, Math.hypot(src.c - gh.c, src.r - gh.r) / 2 + 0.4, 0, 0, 0, 0, ACCENT_LIN, 0, WHITE, 0, src.c + 0.5, src.r + 0.5, gh.c + 0.5, gh.r + 0.5, 0, 0, 1, 0);
      put(top, T.HINT_RING, src.c + 0.5, src.r + 0.5, 0.6, 0, 0, 0, 0, ACCENT_LIN, 0, WHITE, 0, 0, 0, 0, 0, 0, 0, 1, 0);
      ghostPiece(gh.type || 'mirror', gh.c + 0.5, gh.r + 0.5, gh.o & 3, gh.mask, 0.5);
    }
    if (info.preview) { const q = info.preview; ghostPiece(q.type || 'mirror', q.c + 0.5, q.r + 0.5, q.o & 3, 0, 0.55); put(top, T.FRAME, q.c + 0.5, q.r + 0.5, 0.62, 0, 1, 0, 0, ACCENT_LIN, 0, WHITE, 0, 0, 0, 0, 0, 0, 0, 1, 0); }
    if (info.flash) put(top, T.FRAME, info.flash.c + 0.5, info.flash.r + 0.5, 0.62, 0, 0, 0, 0, WHITE, 0, WHITE, 0, 0, 0, 0, 0, 0, 0, 1, 0);
    if (info.lift) put(top, T.FRAME, info.lift.c + 0.5, info.lift.r + 0.5, 0.62, 0, 0, 0, 0.12, ACCENT_LIN, 0, WHITE, 0, 0, 0, 0, 0, 0, 0, 1, 0);
    if (info.cursor) put(top, T.FRAME, info.cursor.c + 0.5, info.cursor.r + 0.5, 0.62, 0, 0, info.cursor.holding ? 1 : 0, info.cursor.holding ? 0.1 : 0, ACCENT_LIN, 0, WHITE, 0, 0, 0, 0, 0, 0, 0, 1, 0);
    first = false;
    return builder;
  }

  function ghostPiece(type, cx, cy, o, mask, alpha) {
    if (type === 'filter') { put(top, T.FILTER, cx, cy, 0.62, 0, 0, 0, 0, LIN[mask || 7], 0, WHITE, 0, 0, 0, 0, 0, 0, 1, alpha, 0); return; }
    if (type === 'prism') { put(top, T.PRISM, cx, cy, 0.85, 0, 0, 0, 0, WHITE, 0, WHITE, 0, 0, 0, 0, 0, 0, 1, alpha, 0); return; }
    put(top, type === 'splitter' ? T.SPLITTER : T.MIRROR, cx, cy, 0.8, -o * QUARTER, 0, 0, 0, WHITE, 0, WHITE, 0, 0, 0, 0, 0, 0, 1, alpha, 0);
  }

  const builder = {
    under, over, top, fan, build,
    get busy() { return busy; },
    setReduced(on) { reduced = on === true; },
    /** Pour les tests de parité (V3-32) : états des cibles dessinées, dans l'ordre des cibles. */
    debugTargetStates(result) { return result.targets.map((x) => targetVisualState(x)); },
    debugTypes() { return targets.length; },
  };
  return builder;
}

/** Signature d'un niveau (hors position des pièces mobiles) : si elle change, tout repart de zéro. */
export function levelSignature(state) {
  let s = `${state.cols}x${state.rows}:${state.pieces.length}`;
  for (let i = 0; i < state.pieces.length; i++) {
    const p = state.pieces[i];
    if (p.fixed || p.type === 'wall' || p.type === 'emitter' || p.type === 'target') s += `|${p.type[0]}${p.c},${p.r}`;
  }
  return s;
}

/** Rayon de mouvement utile dans `GEOM` (référence croisée, évite un import orphelin dans les tests). */
export const ROTATE_MS = GEOM.rotateMs;
