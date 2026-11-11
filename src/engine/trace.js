// Tracé v2 : champ de lumière monotone (E3 à E8, E10). Module pur : même entrée, même sortie ; l'entrée n'est pas modifiée.
//
// L'état de la lumière est un masque RVB (3 bits) par couple (case, direction d'entrée). Le tracé calcule le PLUS PETIT
// point fixe d'une propagation : on dépile un état (case, d, masque), on garde les seuls bits nouveaux, on applique la
// règle de la pièce, on empile les sorties. Chaque pas utile ajoute au moins un bit parmi 12·cases : la boucle termine
// (au plus 12·cases pas utiles), un cycle de lumière converge, l'ordre de la pile n'influe pas sur le résultat.
import { DX, DY } from './dirs.js';
import { EMPTY, WALL, TARGET, MIRROR, EMITTER, SPLITTER, PRISM, FILTER, PORTAL, GATE } from './board.js';

/** Raisons d'arrêt d'un faisceau (tableau `endReason`). L'absorption par un filtre se lit sur `in` de la case du filtre. */
export const END_NONE = 0;
export const END_EDGE = 1;
export const END_WALL = 2;
export const END_EMITTER = 3;
export const END_GATE = 4;

/** Plafond de pas utiles (E7) : 12·cases + 16. Un tracé qui l'atteint a un bug (`capped`). */
export function stepLimit(board) {
  return 12 * board.n + 16;
}

// Envoie le masque m depuis le centre de `cell` vers la direction d (première arrivée : case voisine).
function send(b, cell, d, m) {
  const { cols, rows, kind, open, outM, endM, endR, stack } = b;
  outM[cell * 4 + d] |= m;
  const c = cell % cols, r = (cell / cols) | 0, nc = c + DX[d], nr = r + DY[d];
  if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) { endM[cell * 4 + d] |= m; endR[cell * 4 + d] = END_EDGE; return; }
  const n = nr * cols + nc, k = kind[n];
  if (k === WALL) { endM[cell * 4 + d] |= m; endR[cell * 4 + d] = END_WALL; return; }
  if (k === EMITTER) { endM[cell * 4 + d] |= m; endR[cell * 4 + d] = END_EMITTER; return; }
  if (k === GATE && open[n] === 0) { endM[cell * 4 + d] |= m; endR[cell * 4 + d] = END_GATE; return; }
  stack[b.sp++] = ((n * 4 + d) << 3) | m;
}

// E6 : la porte g s'ouvre ; la lumière arrêtée devant elle est renvoyée (elle est déjà mémorisée dans `out` du voisin).
function openGate(b, g) {
  const { cols, rows, open, outM, endM, endR, stack } = b;
  open[g] = 1;
  const gc = g % cols, gr = (g / cols) | 0;
  for (let dd = 0; dd < 4; dd++) {
    const pc = gc - DX[dd], pr = gr - DY[dd];
    if (pc < 0 || pr < 0 || pc >= cols || pr >= rows) continue;
    const p = pr * cols + pc, pm = outM[p * 4 + dd];
    if (pm !== 0 && endR[p * 4 + dd] === END_GATE) {
      endM[p * 4 + dd] = 0;
      endR[p * 4 + dd] = END_NONE;
      stack[b.sp++] = ((g * 4 + dd) << 3) | pm;
    }
  }
}

/**
 * Trace la lumière de tous les émetteurs du plateau (E5, E6).
 * @param {object} b  plateau de buildBoard
 * @param {number} [maxSteps]  plafond de pas utiles (défaut : stepLimit(b)) ; sert aux tests de `capped`
 * @returns la structure de sortie E10 : OBJET ET TABLEAUX RÉUTILISÉS, valables jusqu'au tracé suivant du même plateau.
 *   in, out : Uint8Array(4·cases), masque entrant / sortant par (case, direction), indice case·4 + d ;
 *   end, endReason : masque arrêté et raison (END_*) par (case d'où part le faisceau, direction) ;
 *   targets[i] = {cell, need, got, lit, reached} (ordre des cibles dans les pièces), gates[i] = {cell, open} ;
 *   used (Uint8Array par id de pièce), usedMovable, litCount, allLit, steps, capped, order + orderCount ;
 *   segments() : séries droites {count, x0, y0, x1, y1, mask} en unités de case.
 */
export function trace(b, maxSteps = 12 * b.n + 16) {
  const { kind, orient, aux, need, inM, outM, endM, endR, gotT, open, used, order, stack, gatesOf, pid } = b;
  inM.fill(0); outM.fill(0); endM.fill(0); endR.fill(0); gotT.fill(0); open.fill(0); used.fill(0);
  b.sp = 0;
  let steps = 0, nOrder = 0, capped = false;

  for (let e = 0; e < b.emitters.length; e++) if (b.emitters[e].mask !== 0) send(b, b.emitters[e].cell, b.emitters[e].d, b.emitters[e].mask); // masque 0 : n'émet rien (case opaque quand même)

  while (b.sp > 0) {
    const w = stack[--b.sp], m = w & 7, idx = w >> 3, nw = m & ~inM[idx];
    if (nw === 0) continue;
    if (steps >= maxSteps) { capped = true; break; }
    steps++;
    const cell = idx >> 2, d = idx & 3;
    if ((inM[cell * 4] | inM[cell * 4 + 1] | inM[cell * 4 + 2] | inM[cell * 4 + 3]) === 0) order[nOrder++] = cell;
    inM[idx] |= nw;
    switch (kind[cell]) {
      case EMPTY: send(b, cell, d, nw); break;
      case TARGET: {
        const t = aux[cell];
        gotT[t] |= nw;
        send(b, cell, d, nw);
        const gl = gatesOf[t];
        for (let j = 0; j < gl.length; j++) {
          // E6 : porte ouverte quand la cible est ATTEINTE (reçu ⊇ besoin), jamais refermée
          if (open[gl[j]] === 0 && (gotT[t] & need[cell]) === need[cell]) openGate(b, gl[j]);
        }
        break;
      }
      case MIRROR: {
        const nd = (orient[cell] - d) & 3;
        if (nd !== d) used[pid[cell]] = 1; // dévie ou renvoie de face ; parallèle : traverse sans sommet
        send(b, cell, nd, nw);
        break;
      }
      case SPLITTER: {
        send(b, cell, d, nw);
        const nd = (orient[cell] - d) & 3;
        if (nd !== d) { used[pid[cell]] = 1; send(b, cell, nd, nw); }
        break;
      }
      case PRISM: // R à gauche, G tout droit, B à droite, chaque bit seul
        if (nw & 1) { used[pid[cell]] = 1; send(b, cell, (d + 1) & 3, 1); }
        if (nw & 2) send(b, cell, d, 2);
        if (nw & 4) { used[pid[cell]] = 1; send(b, cell, (d + 3) & 3, 4); }
        break;
      case FILTER: {
        const f = orient[cell], pass = nw & f;
        if ((nw & ~f) !== 0) used[pid[cell]] = 1; // absorbe au moins un bit
        if (pass !== 0) send(b, cell, d, pass);
        break;
      }
      case PORTAL: { const q = aux[cell]; if (q >= 0) send(b, q, d, nw); break; } // sort du centre de l'autre portail, direction conservée
      case GATE: send(b, cell, d, nw); break; // porte ouverte = case vide
      default: break; // mur, émetteur : la lumière n'y entre jamais (send l'arrête avant)
    }
  }

  // résumé
  const res = b.result, T = b.targetCells.length;
  let litCount = 0;
  for (let t = 0; t < T; t++) {
    const x = res.targets[t], nd = need[x.cell], got = gotT[t];
    x.need = nd; x.got = got; x.reached = (got & nd) === nd; x.lit = got === nd;
    if (x.lit) litCount++;
  }
  for (let g = 0; g < res.gates.length; g++) res.gates[g].open = open[res.gates[g].cell] === 1;
  let usedMovable = 0;
  for (let id = 0; id < b.pieces.length; id++) if (used[id] === 1 && b.movable[id] === 1) usedMovable++;
  res.usedMovable = usedMovable;
  res.litCount = litCount;
  res.allLit = !capped && T > 0 && litCount === T; // E8 : au moins une cible, toutes allumées ; jamais de victoire si capped (E7)
  res.steps = steps;
  res.capped = capped;
  res.orderCount = nOrder;
  if (res.segments === null) res.segments = () => buildSegments(b);
  return res;
}

// Séries droites de même masque, en unités de case (E10). Les tableaux plats sont alloués une fois par plateau (≤ 4·cases séries).
function buildSegments(b) {
  const { cols, rows, outM, endM } = b;
  if (b.seg === null) {
    const cap = 4 * b.n + 8;
    b.seg = { count: 0, x0: new Float32Array(cap), y0: new Float32Array(cap), x1: new Float32Array(cap), y1: new Float32Array(cap), mask: new Uint8Array(cap) };
  }
  const out = b.seg;
  let n = 0;
  for (let cell = 0; cell < b.n; cell++) {
    const c = cell % cols, r = (cell / cols) | 0;
    for (let d = 0; d < 4; d++) {
      const m = outM[cell * 4 + d];
      if (m === 0) continue;
      const pc = c - DX[d], pr = r - DY[d];
      // pas un début de série : la case d'avant envoie le même masque vers nous sans s'être arrêtée
      if (pc >= 0 && pr >= 0 && pc < cols && pr < rows && outM[(pr * cols + pc) * 4 + d] === m && endM[(pr * cols + pc) * 4 + d] === 0) continue;
      let cc = c, rr = r, cur = cell, ex, ey;
      for (;;) {
        if (endM[cur * 4 + d] !== 0) { ex = cc + 0.5 + DX[d] * 0.5; ey = rr + 0.5 + DY[d] * 0.5; break; }
        const nc = cc + DX[d], nr = rr + DY[d], nx = nr * cols + nc;
        if (outM[nx * 4 + d] === m) { cc = nc; rr = nr; cur = nx; continue; }
        ex = nc + 0.5; ey = nr + 0.5;
        break;
      }
      out.x0[n] = c + 0.5; out.y0[n] = r + 0.5; out.x1[n] = ex; out.y1[n] = ey; out.mask[n] = m; n++;
    }
  }
  out.count = n;
  return out;
}
