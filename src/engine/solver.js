// Solveur v2 (ARCHITECTURE_V2 S1 à S6) : recherche par relaxation sur le champ de lumière monotone, garage exact.
// Module pur : même entrée, même sortie, entrée non modifiée, aucun chronomètre (arrêt par nombre de nœuds seulement, Q5/Q9).
//
// Principe (S2) : approfondissement itératif sur k = nombre de pièces POSÉES, les K - k autres étant absentes (relaxation).
// À chaque nœud : tracer ; si tout est allumé et que les k pièces servent, tester le garage (couplage biparti exact, S3.3) ;
// sinon prendre la première case éclairée, libre, non décidée (ordre `order` du tracé) et brancher : poser une pièce restante
// (chaque classe, chaque orientation) qui CHANGE un état d'arrivée courant, ou SAUTER la case. Sauter mémorise ses arrivées ;
// la case redevient décidable si ses arrivées changent, et ne peut alors recevoir qu'une pièce qui ne change aucune arrivée
// déjà sautée (sinon la même configuration serait énumérée deux fois).
//
// Ordre canonique (Q9, JOURNAL J1 ambiguïté 3) : les pièces fixes sont posées dans l'ordre (ligne, colonne) et les classes de
// pièces mobiles dans l'ordre (miroir, séparateur, prisme, filtre par masque croissant), quel que soit l'ordre du fichier :
// le comptage de nœuds ne dépend donc que du contenu du niveau.
import { createState } from './state.js';
import { createBoard, setCell, clearCell, finalize, EMPTY } from './board.js';
import { trace } from './trace.js';
import { maskToLetters } from './colors.js';
import { ORIENT_CHARS } from './dirs.js';
import { replayPlacements, RULES_VERSION, SOLVER_VERSION } from './level.js';

export { RULES_VERSION, SOLVER_VERSION };
/** Plafond d'un niveau livré (S4) et du solveur de l'éditeur / de l'indice (F6, S7). */
export const DEFAULT_MAX_NODES = 2000000;
/** Au plus 256 solutions minimales pour un niveau livré (S5). */
export const MAX_SOLUTIONS_AT_MIN = 256;
/** Jeux de placements gardés dans les fichiers (F1 : 4 au plus). */
export const MAX_STORED = 4;

/** Plafond de nœuds atteint (jamais un chronomètre). */
export class LimitError extends Error {
  constructor(nodes, maxNodes) {
    super(`plafond de ${maxNodes} nœuds atteint`);
    this.name = 'LimitError';
    this.code = 'MAX_NODES';
    this.nodes = nodes;
    this.maxNodes = maxNodes;
  }
}

const TYPE_RANK = { mirror: 0, splitter: 1, prism: 2, filter: 3 };
const isRot = (t) => t === 'mirror' || t === 'splitter';

/**
 * Plafond reçu de l'extérieur (Worker, outil, éditeur) : absent = défaut ; sinon un nombre fini strictement positif, sinon
 * RangeError (audit J3 point 6 : `maxNodes: NaN` supprimait le plafond, `x > NaN` étant toujours faux). Jamais d'Infinity.
 */
function limitOption(name, value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new RangeError(`option ${name} invalide : ${String(value)} (nombre fini > 0 attendu)`);
  return value;
}

/** Placement au format du fichier (F1, S6) : {type, at, o} / {type, at} / {type, at, mask}. */
function placement(type, mask, c, r, o) {
  if (type === 'mirror' || type === 'splitter') return { type, at: [c, r], o: ORIENT_CHARS[o] };
  if (type === 'prism') return { type, at: [c, r] };
  return { type, at: [c, r], mask: maskToLetters(mask) };
}

/**
 * Résout un niveau.
 * @param {object} input  niveau JSON v2 valide (`size`, `pieces`) ou état du moteur (`cols`, `rows`, `pieces`)
 * @param {{maxNodes?:number, countAll?:boolean, countMaxNodes?:number, countLimit?:number, maxStored?:number}} [options]
 *   maxNodes : plafond de la preuve (défaut 2 M) ; countAll : après le premier témoin au minimum, énumérer tout ce niveau de k
 *   (solutionsAtMin, solutionsRelaxed, feuilles) ; countMaxNodes : plafond de ce comptage (défaut maxNodes) ;
 *   countLimit : arrêt du comptage au-delà de ce nombre de solutions (défaut 256) ; maxStored : jeux gardés (défaut 4).
 * @returns {{status:'proved-optimal'|'unsolvable-proved'|'unknown', minimum:number, K:number, nodes:number,
 *   witness:object[]|null, parking:object[]|null, solutions:Array<{witness:object[], parking:object[]}>,
 *   solutionsAtMin:number|null, solutionsRelaxed:number|null, leaves:number|null, parkingFails:number,
 *   nodesTotal:number, counted:boolean, overflow:boolean, kTried:number}}
 *   `nodes` = nœuds jusqu'au premier témoin (la preuve) ; `nodesTotal` y ajoute le comptage. `minimum` = -1 sans témoin.
 *   `counted` : le comptage est allé au bout ; `overflow` : plus de `countLimit` solutions ; `solutionsTruncated` : le comptage n'est
 *   pas complet (plafond de nœuds : `solutionsAtMin` vaut null ; `overflow` : `solutionsAtMin` est une borne basse).
 *   Un plafond invalide (NaN, infini, <= 0, non numérique) lève RangeError.
 */
export function solve(input, options = {}) {
  const maxNodes = limitOption('maxNodes', options.maxNodes, DEFAULT_MAX_NODES);
  const countAll = options.countAll === true;
  const countMaxNodes = limitOption('countMaxNodes', options.countMaxNodes, maxNodes);
  const countLimit = limitOption('countLimit', options.countLimit, MAX_SOLUTIONS_AT_MIN);
  const maxStored = limitOption('maxStored', options.maxStored, MAX_STORED);
  const state = input.size !== undefined ? createState(input) : input;
  const { cols, rows } = state;

  // pièces fixes dans l'ordre (ligne, colonne) ; inventaire en classes interchangeables, ordre canonique
  const statics = [];
  const inv = [];
  for (const p of state.pieces) (p.fixed ? statics : inv).push(p);
  statics.sort((a, b) => a.r - b.r || a.c - b.c);
  const classes = [];
  for (const p of inv) {
    const mask = p.type === 'filter' ? p.mask : 0;
    let cl = classes.find((x) => x.type === p.type && x.mask === mask);
    if (cl === undefined) { cl = { type: p.type, mask, n: 0, left: 0, slots: [] }; classes.push(cl); }
    cl.n++;
  }
  classes.sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.mask - b.mask);
  const K = inv.length;

  // plateau : pièces fixes + un emplacement par pièce mobile (ids à la suite des fixes), posés au fil de la recherche
  const allPieces = statics.slice();
  const slotPieces = [];
  for (const cl of classes) {
    for (let i = 0; i < cl.n; i++) {
      const id = allPieces.length;
      const sp = { id, type: cl.type, c: 0, r: 0, o: 0, dir: 0, mask: cl.mask, need: 0, pair: 0, link: null, fixed: false };
      allPieces.push(sp);
      slotPieces.push(sp);
      cl.slots.push(id);
    }
  }
  const board = createBoard(cols, rows, allPieces.length);
  for (let id = 0; id < statics.length; id++) setCell(board, id, statics[id]);
  finalize(board, allPieces); // les emplacements non posés ne sont dans aucune case : ils n'ont aucun effet
  const b = board;
  const N = b.n;
  const skip12 = new Uint16Array(N); // arrivées (12 bits) de la case au moment où elle a été sautée
  const skipAcc = new Uint16Array(N); // union des arrivées sautées sur le chemin courant
  const cur12 = (cell) => b.inM[cell * 4] | (b.inM[cell * 4 + 1] << 3) | (b.inM[cell * 4 + 2] << 6) | (b.inM[cell * 4 + 3] << 9);
  const arr4 = new Uint8Array(4);

  let nodes = 0;
  let nodeCap = maxNodes;
  let nodesAtFirst = -1;
  let kBudget = 0;
  let relaxed = 0;
  let leaves = 0;
  let parkFail = 0;
  let parkFailTotal = 0;
  let solutionsAtMin = 0;
  let found = null;
  let stopped = false; // dépassement de countLimit : on remonte la récursion
  const stored = [];
  const placedList = []; // {cl, cell, o}

  // La pièce (cl, o) change-t-elle au moins un des états d'arrivée donnés (4 masques par direction) ?
  function alters(cl, o, a0, a1, a2, a3) {
    for (let d = 0; d < 4; d++) {
      const m = d === 0 ? a0 : d === 1 ? a1 : d === 2 ? a2 : a3;
      if (m === 0) continue;
      if (cl.type === 'mirror' || cl.type === 'splitter') { if (((o - d) & 3) !== d) return true; } else if (cl.type === 'prism') { if (m & 5) return true; } else if ((m & ~cl.mask) !== 0) return true;
    }
    return false;
  }
  // Une pièce de la classe peut-elle être garée ici sans rien changer (S3.3) ? Renvoie -1 (non) ou l'orientation à donner (0 ou 2).
  function parkOrientation(cl, cell) {
    let h = false;
    let v = false;
    for (let d = 0; d < 4; d++) {
      const m = b.inM[cell * 4 + d];
      if (m === 0) continue;
      if (cl.type === 'mirror' || cl.type === 'splitter') { if (d & 1) v = true; else h = true; } else if (cl.type === 'prism') { if (m & 5) return -1; } else if ((m & ~cl.mask) !== 0) return -1;
    }
    if (h && v) return -1;
    return v ? 2 : 0;
  }
  // Couplage biparti pièces restantes / cases libres où elles sont transparentes (Kuhn, déterministe). null si impossible.
  function parking() {
    const extras = [];
    for (const cl of classes) for (let i = 0; i < cl.left; i++) extras.push(cl);
    if (extras.length === 0) return [];
    const cells = [];
    for (let cell = 0; cell < N; cell++) if (b.kind[cell] === EMPTY) cells.push(cell);
    const adj = extras.map((cl) => { const a = []; for (let j = 0; j < cells.length; j++) if (parkOrientation(cl, cells[j]) >= 0) a.push(j); return a; });
    const matchCell = new Int32Array(cells.length).fill(-1);
    const tryAug = (i, seen) => {
      for (const j of adj[i]) {
        if (seen[j]) continue;
        seen[j] = 1;
        if (matchCell[j] < 0 || tryAug(matchCell[j], seen)) { matchCell[j] = i; return true; }
      }
      return false;
    };
    for (let i = 0; i < extras.length; i++) if (!tryAug(i, new Uint8Array(cells.length))) return null;
    const out = [];
    for (let j = 0; j < cells.length; j++) {
      if (matchCell[j] < 0) continue;
      const cl = extras[matchCell[j]], cell = cells[j];
      out.push(placement(cl.type, cl.mask, cell % cols, (cell / cols) | 0, parkOrientation(cl, cell)));
    }
    return out;
  }
  const witnessOf = () => placedList.map((x) => placement(x.cl.type, x.cl.mask, x.cell % cols, (x.cell / cols) | 0, x.o));

  function dfs(placed) {
    if (++nodes > nodeCap) throw new LimitError(nodes, nodeCap);
    const res = trace(b);
    if (placed === kBudget) {
      leaves++;
      if (res.allLit && res.usedMovable === placed) {
        relaxed++;
        const park = parking();
        if (park === null) { parkFail++; parkFailTotal++; } else {
          solutionsAtMin++;
          if (found === null) { found = { witness: witnessOf(), parking: park }; stored.push(found); nodesAtFirst = nodes; nodeCap = nodes + countMaxNodes; } else if (stored.length < maxStored) stored.push({ witness: witnessOf(), parking: park });
          if (!countAll) return true;
          if (solutionsAtMin > countLimit) { stopped = true; return true; }
        }
      }
      return false;
    }
    // prochaine case de décision : première case éclairée, libre, dont les arrivées diffèrent du cliché de saut
    let x = -1;
    const cnt = res.orderCount;
    for (let i = 0; i < cnt; i++) {
      const cell = b.order[i];
      if (b.kind[cell] === EMPTY && cur12(cell) !== skip12[cell]) { x = cell; break; }
    }
    if (x < 0) return false;
    arr4[0] = b.inM[x * 4]; arr4[1] = b.inM[x * 4 + 1]; arr4[2] = b.inM[x * 4 + 2]; arr4[3] = b.inM[x * 4 + 3];
    const a0 = arr4[0], a1 = arr4[1], a2 = arr4[2], a3 = arr4[3];
    const snap = cur12(x); // à lire AVANT les enfants : ils écrasent les tableaux du plateau
    const acc = skipAcc[x];
    for (const cl of classes) {
      if (cl.left === 0) continue;
      const rots = isRot(cl.type) ? 4 : 1;
      for (let o = 0; o < rots; o++) {
        if (!alters(cl, o, a0, a1, a2, a3)) continue;
        if (acc !== 0 && alters(cl, o, acc & 7, (acc >> 3) & 7, (acc >> 6) & 7, (acc >> 9) & 7)) continue; // doublon : posée plus tôt
        const slotId = cl.slots[cl.n - cl.left];
        const sp = slotPieces[slotId - statics.length];
        sp.c = x % cols; sp.r = (x / cols) | 0; sp.o = o;
        setCell(b, slotId, sp);
        cl.left--;
        placedList.push({ cl, cell: x, o });
        const r = dfs(placed + 1);
        placedList.pop();
        cl.left++;
        clearCell(b, x);
        if (r) return true;
      }
    }
    const old = skip12[x], oldAcc = skipAcc[x];
    skip12[x] = snap;
    skipAcc[x] = oldAcc | snap;
    const r = dfs(placed);
    skip12[x] = old;
    skipAcc[x] = oldAcc;
    return r;
  }

  let status = 'unknown';
  let minimum = -1;
  let kTried = -1;
  let counted = false;
  try {
    for (let k = 0; k <= K; k++) {
      kBudget = k; found = null; relaxed = 0; leaves = 0; parkFail = 0; solutionsAtMin = 0; stored.length = 0; stopped = false;
      for (const cl of classes) cl.left = cl.n;
      skip12.fill(0); skipAcc.fill(0);
      nodeCap = maxNodes;
      try {
        dfs(0);
      } catch (e) {
        // plafond atteint pendant le COMPTAGE (le témoin est déjà trouvé) : le minimum est prouvé, le comptage est tronqué
        if (e instanceof LimitError && found !== null) { kTried = k; status = 'proved-optimal'; minimum = k; break; }
        throw e;
      }
      kTried = k;
      if (found !== null) {
        status = 'proved-optimal'; minimum = k; counted = countAll && !stopped; break;
      }
    }
    if (status !== 'proved-optimal') status = 'unsolvable-proved';
  } catch (e) {
    if (!(e instanceof LimitError)) throw e;
    status = 'unknown';
  }
  const proved = status === 'proved-optimal';
  return {
    status,
    minimum,
    K,
    nodes: proved && nodesAtFirst >= 0 ? nodesAtFirst : nodes,
    nodesTotal: nodes,
    witness: proved ? stored[0].witness : null,
    parking: proved ? stored[0].parking : null,
    solutions: proved ? stored.slice() : [],
    // Comptage tronqué par le plafond de nœuds : nombre inconnu (null), jamais un nombre trompeur (audit J3 point 7). Dépassement de
    // countLimit : valeur = borne basse (countLimit + 1) et `overflow` vrai. Dans les deux cas `solutionsTruncated` est vrai.
    solutionsAtMin: proved && countAll && (counted || solutionsAtMin > countLimit) ? solutionsAtMin : null,
    solutionsTruncated: proved && countAll && !counted,
    solutionsRelaxed: proved && countAll ? relaxed : null,
    leaves: proved && countAll ? leaves : null,
    parkingFails: parkFailTotal,
    counted: proved && counted,
    overflow: proved && countAll && solutionsAtMin > countLimit,
    kTried,
  };
}

/** Rejoue un jeu de placements (témoin + garage) dans le moteur seul : {ok, message, allLit, usedMovable}. */
export function replaySolution(level, placements) {
  return replayPlacements(level, placements);
}
