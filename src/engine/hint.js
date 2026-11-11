// Indice v2 (ARCHITECTURE_V2 S7) : un pas d'un témoin. Module pur : même entrée, même sortie, entrée non modifiée.
//
// Un témoin est un jeu de placements des pièces UTILISÉES (format de `solutions` dans le fichier du niveau, F1/S6). L'indice :
//  1. plateau déjà gagné : aucun indice ;
//  2. témoin le plus proche (le moins de placements insatisfaits ; égalité : ordre du fichier). Un placement est satisfait par une
//     pièce de la même classe (type, masque du filtre) posée sur sa case, avec son orientation s'il y en a une ;
//  3. premier placement insatisfait (dans l'ordre du témoin = ordre de la première lumière) :
//     - une pièce de la bonne classe est sur la case : « tourner » (miroir, séparateur) ;
//     - une pièce d'une autre classe la bloque : « ranger » ce bloqueur (case libre où il est transparent, de préférence) ;
//     - sinon « déplacer » ici une pièce qui ne satisfait aucun placement (de préférence : pas posée sur la case d'un autre
//       placement manquant, puis celle qui gêne, puis la plus proche) ;
//  4. tous les placements sont satisfaits mais le niveau n'est pas gagné : « ranger » une pièce en trop qui change encore la
//     lumière, vers une case libre où elle est transparente (elle existe, S3.3 ; couplage biparti), ou la tourner sur place.
//
// Garantie testée : en appliquant chaque action en entier, on gagne en au plus 2·K indices (K = pièces mobiles).
import { ORIENT_CHARS, orientFromChar } from './dirs.js';
import { maskFromLetters, COLOR_NAMES } from './colors.js';
import { buildBoard } from './board.js';
import { trace } from './trace.js';
import { rotatePiece, movePiece, isMovable } from './state.js';
import { solve } from './solver.js';

const ORIENT_NAMES = ['horizontal', 'oblique montante', 'vertical', 'oblique descendante'];
const TYPE_NAMES = { mirror: 'miroir', splitter: 'séparateur', prism: 'prisme', filter: 'filtre' };
const ROTATES = (t) => t === 'mirror' || t === 'splitter';

/**
 * @typedef {{
 *   action: 'rotate'|'move'|'park',
 *   pieceId: number, type: string, mask: number,
 *   from: [number, number], at: [number, number],
 *   o: string|null, steps: number, solution: number, distance: number
 * }} Hint
 * rotate : tourner la pièce pieceId (en `from` = `at`) de `steps` crans jusqu'à l'orientation `o` ;
 * move : déplacer la pièce de `from` vers `at`, puis la tourner de `steps` crans jusqu'à `o` ;
 * park : comme move (ou rotate si from = at), pour ranger une pièce qui bloque ou qui gêne. `o` et `steps` : miroir et séparateur
 * seulement (null et 0 pour le prisme et le filtre, qui ne tournent pas). `mask` : masque du filtre (0 sinon).
 * solution = rang du témoin retenu ; distance = placements insatisfaits avant l'action.
 */

const manhattan = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

// Classe interchangeable d'une pièce de l'état ou d'un placement.
const classOfPiece = (p) => (p.type === 'filter' ? `filter:${p.mask}` : p.type);
const classOfPlacement = (q) => (q.type === 'filter' ? `filter:${maskFromLetters(q.mask)}` : q.type);

function satisfies(m, q) {
  return m.c === q.at[0] && m.r === q.at[1] && classOfPiece(m) === classOfPlacement(q) && (!ROTATES(m.type) || m.o === orientFromChar(q.o));
}

/** Champ de lumière du témoin seul (pièces fixes + placements) : arrivées par case et direction, et réponse « transparent ici ? ». */
function witnessField(state, solution) {
  const pieces = state.pieces.filter((p) => !isMovable(p)).map((p, i) => ({ ...p, id: i }));
  for (const q of solution) {
    pieces.push({
      id: pieces.length, type: q.type, c: q.at[0], r: q.at[1], o: ROTATES(q.type) ? orientFromChar(q.o) : 0, dir: 0,
      mask: q.type === 'filter' ? maskFromLetters(q.mask) : 0, need: 0, pair: 0, link: null, fixed: false,
    });
  }
  const board = buildBoard({ cols: state.cols, rows: state.rows, pieces });
  const t = trace(board);
  const inM = Uint8Array.from(board.inM); // copie : le plateau est jetable, mais le tracé est réutilisé par le moteur
  return { inM, cols: state.cols, allLit: t.allLit };
}

// Orientation (0 ou 2) qui rend la pièce transparente dans le champ du témoin à la case (c, r), ou -1 si elle ne peut pas l'être.
function parkOrientation(field, p, c, r) {
  const cell = r * field.cols + c;
  let h = false;
  let v = false;
  for (let d = 0; d < 4; d++) {
    const m = field.inM[cell * 4 + d];
    if (m === 0) continue;
    if (ROTATES(p.type)) { if (d & 1) v = true; else h = true; } else if (p.type === 'prism') { if (m & 5) return -1; } else if ((m & ~p.mask) !== 0) return -1;
  }
  if (h && v) return -1;
  return v ? 2 : 0;
}

// La pièce, dans l'état courant, change-t-elle encore la lumière du témoin là où elle est ?
function alters(field, p) {
  const cell = p.r * field.cols + p.c;
  for (let d = 0; d < 4; d++) {
    const m = field.inM[cell * 4 + d];
    if (m === 0) continue;
    if (ROTATES(p.type)) { if (((p.o - d) & 3) !== d) return true; } else if (p.type === 'prism') { if (m & 5) return true; } else if ((m & ~p.mask) !== 0) return true;
  }
  return false;
}

function makeHint(action, piece, at, o, meta) {
  const rot = ROTATES(piece.type);
  return {
    action, pieceId: piece.id, type: piece.type, mask: piece.type === 'filter' ? piece.mask : 0,
    from: [piece.c, piece.r], at: [at[0], at[1]],
    o: rot ? ORIENT_CHARS[o] : null, steps: rot ? (o - piece.o) & 3 : 0, ...meta,
  };
}

/**
 * Calcule l'indice du plateau courant.
 * @param {object} state  état du moteur (engine/state.js)
 * @param {Array<Array<{type:string, at:number[], o?:string, mask?:string}>>} solutions  témoins (jeux de placements utilisés)
 * @returns {Hint|null}  null : plateau gagné, ou aucun témoin, ou aucune action utile
 */
export function computeHint(state, solutions) {
  if (solutions.length === 0) return null;
  if (trace(buildBoard(state)).allLit) return null;
  const cols = state.cols;
  const movables = state.pieces.filter(isMovable);

  // 1. Témoin le plus proche (égalité : ordre donné)
  let best = -1;
  let bestDist = Infinity;
  for (let s = 0; s < solutions.length; s++) {
    let dist = 0;
    for (const q of solutions[s]) if (!movables.some((m) => satisfies(m, q))) dist++;
    if (dist < bestDist) { best = s; bestDist = dist; }
  }
  const sol = solutions[best];
  const meta = { solution: best, distance: bestDist };
  const field = witnessField(state, sol);
  const unsat = sol.filter((q) => !movables.some((m) => satisfies(m, q)));
  const satisfier = new Set();
  for (const q of sol) for (const m of movables) if (satisfies(m, q)) satisfier.add(m.id);
  const spare = movables.filter((m) => !satisfier.has(m.id)); // pièces qui ne satisfont aucun placement
  const occupied = new Set(state.pieces.map((p) => p.r * cols + p.c));
  const witnessCells = new Set(sol.map((q) => q.at[1] * cols + q.at[0]));
  const pendingCells = new Set(unsat.map((q) => q.at[1] * cols + q.at[0]));
  const litCell = (c, r) => (field.inM[(r * cols + c) * 4] | field.inM[(r * cols + c) * 4 + 1] | field.inM[(r * cols + c) * 4 + 2] | field.inM[(r * cols + c) * 4 + 3]) !== 0;

  // Cases libres où ranger une pièce : ni occupée, ni case d'un placement du témoin ; transparente d'abord, puis la plus proche.
  const parkCell = (piece) => {
    let bestCell = null;
    let bestKey = null;
    for (let i = 0; i < cols * state.rows; i++) {
      if (occupied.has(i)) continue;
      const c = i % cols, r = (i / cols) | 0;
      const po = parkOrientation(field, piece, c, r);
      const key = [pendingCells.has(i) ? 1 : 0, po >= 0 ? 0 : 1, manhattan([piece.c, piece.r], [c, r]), i];
      if (bestKey === null || compareKey(key, bestKey) < 0) { bestCell = [c, r, po]; bestKey = key; }
    }
    return bestCell;
  };

  if (unsat.length > 0) {
    const q = unsat[0];
    const target = ROTATES(q.type) ? orientFromChar(q.o) : 0;
    const there = movables.find((m) => m.c === q.at[0] && m.r === q.at[1]);
    if (there !== undefined && classOfPiece(there) === classOfPlacement(q)) return makeHint('rotate', there, q.at, target, meta);
    if (there !== undefined) { // une pièce d'une autre classe bloque la case : on la range d'abord
      const dest = parkCell(there);
      if (dest !== null) return makeHint('park', there, dest, dest[2] >= 0 ? dest[2] : there.o, meta);
      return null;
    }
    // pièce source : même classe, ne satisfait aucun placement ; rang : (1) pas sur la case d'un autre placement manquant,
    // (2) gêne (sur une case éclairée), (3) la plus proche, (4) le plus petit identifiant
    const cls = classOfPlacement(q);
    let src = null;
    let srcKey = null;
    for (const m of spare) {
      if (classOfPiece(m) !== cls) continue;
      const key = [pendingCells.has(m.r * cols + m.c) ? 1 : 0, litCell(m.c, m.r) ? 0 : 1, manhattan([m.c, m.r], q.at), m.id];
      if (srcKey === null || compareKey(key, srcKey) < 0) { src = m; srcKey = key; }
    }
    if (src === null) return null; // impossible : au moins une pièce de la classe ne satisfait rien tant qu'un placement manque
    return makeHint('move', src, q.at, target, meta);
  }

  // 4. Tous les placements sont satisfaits : une pièce en trop change encore la lumière du témoin
  const extras = spare;
  const bad = extras.filter((m) => alters(field, m));
  if (bad.length === 0) return null; // impossible si le témoin est exact
  // couplage extras -> cases libres où chaque extra est transparent (les extras déjà bien placés restent où ils sont)
  const free = [];
  for (let i = 0; i < cols * state.rows; i++) if (!occupied.has(i) && !witnessCells.has(i)) free.push(i);
  const adj = bad.map((m) => {
    const a = [];
    for (const i of free) if (parkOrientation(field, m, i % cols, (i / cols) | 0) >= 0) a.push(i);
    a.sort((x, y) => manhattan([m.c, m.r], [x % cols, (x / cols) | 0]) - manhattan([m.c, m.r], [y % cols, (y / cols) | 0]) || x - y);
    return a;
  });
  const owner = new Map();
  const tryAug = (i, seen) => {
    for (const cell of adj[i]) {
      if (seen.has(cell)) continue;
      seen.add(cell);
      if (!owner.has(cell) || tryAug(owner.get(cell), seen)) { owner.set(cell, i); return true; }
    }
    return false;
  };
  const matched = new Array(bad.length).fill(null);
  for (let i = 0; i < bad.length; i++) tryAug(i, new Set());
  for (const [cell, i] of owner) matched[i] = cell;
  // 1re préférence : tourner sur place (une seule action, rien à déplacer)
  for (let i = 0; i < bad.length; i++) {
    const m = bad[i];
    if (!ROTATES(m.type)) continue;
    const po = parkOrientation(field, m, m.c, m.r);
    if (po >= 0) return makeHint('park', m, [m.c, m.r], po, meta);
  }
  for (let i = 0; i < bad.length; i++) {
    if (matched[i] === null) continue;
    const cell = matched[i];
    const po = parkOrientation(field, bad[i], cell % cols, (cell / cols) | 0);
    return makeHint('park', bad[i], [cell % cols, (cell / cols) | 0], po >= 0 ? po : bad[i].o, meta);
  }
  // repli : une case libre quelconque hors des cases du témoin
  const m = bad[0];
  if (free.length > 0) {
    let bestCell = free[0];
    for (const i of free) if (manhattan([m.c, m.r], [i % cols, (i / cols) | 0]) < manhattan([m.c, m.r], [bestCell % cols, (bestCell / cols) | 0])) bestCell = i;
    return makeHint('park', m, [bestCell % cols, (bestCell / cols) | 0], m.o, meta);
  }
  return null;
}

function compareKey(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Applique une action en entier (déplacement puis rotation) et renvoie le nouvel état. */
export function applyHint(state, hint) {
  let next = state;
  if (hint.from[0] !== hint.at[0] || hint.from[1] !== hint.at[1]) next = movePiece(next, hint.pieceId, hint.at[0], hint.at[1]);
  return hint.steps === 0 ? next : rotatePiece(next, hint.pieceId, hint.steps);
}

/** « colonne 4, ligne 2 » (numérotation à partir de 1, comme les annonces de l'interface). */
function defaultCellName(c, r) {
  return `colonne ${c + 1}, ligne ${r + 1}`;
}

function pieceName(hint) {
  if (hint.type === 'filter') return `filtre ${COLOR_NAMES[hint.mask]}`;
  return TYPE_NAMES[hint.type];
}

/**
 * Phrase d'annonce (zone aria-live) d'un indice.
 * @param {Hint} hint
 * @param {(c:number,r:number)=>string} [cellName]
 */
export function hintMessage(hint, cellName = defaultCellName) {
  const name = pieceName(hint);
  const from = cellName(hint.from[0], hint.from[1]);
  const at = cellName(hint.at[0], hint.at[1]);
  const inPlace = hint.from[0] === hint.at[0] && hint.from[1] === hint.at[1];
  const orient = hint.o === null ? '' : `${ORIENT_NAMES[orientFromChar(hint.o)]} ${hint.o}`;
  if (hint.action === 'rotate') return `Indice : tourner le ${name} de ${from} en ${orient}`;
  if (hint.action === 'park') {
    if (inPlace) return `Indice : tourner le ${name} de ${from} en ${orient}, pour qu'il ne gêne plus`;
    return `Indice : ranger le ${name} de ${from} vers ${at}, il gêne`;
  }
  return orient === '' ? `Indice : déplacer le ${name} de ${from} vers ${at}` : `Indice : déplacer le ${name} de ${from} vers ${at}, orientation ${orient}`;
}

/** Phrases quand il n'y a pas d'indice. */
export const HINT_NONE = Object.freeze({
  won: 'Niveau déjà résolu : pas d\'indice',
  unavailable: 'Indice indisponible pour ce niveau',
});

/** Plafond de nœuds du solveur pour l'indice d'un niveau partagé ou du jour (S7). */
export const HINT_MAX_NODES = 600000;

/**
 * Générateur d'indices d'un niveau. Niveau livré : les témoins sont ceux du fichier (`solutions`, rejoués au chargement, V13),
 * aucun solveur. Autre niveau (partagé, du jour) : témoins calculés au premier appel par le solveur plafonné en nœuds, puis gardés.
 * @param {object} level  niveau JSON validé
 * @param {{maxNodes?:number}} [options]
 * @returns {{next:(state:object)=>{hint:Hint|null, reason:null|'won'|'unavailable'}, readonly solutions:Array|null}}
 */
export function createHinter(level, options = {}) {
  let solutions = Array.isArray(level.solutions) ? level.solutions : null; // null : pas encore calculé ; [] : indisponible
  return {
    next(state) {
      if (solutions === null) {
        const r = solve(level, { maxNodes: options.maxNodes ?? HINT_MAX_NODES, countAll: true, countMaxNodes: options.countMaxNodes ?? 50000, maxStored: 4 });
        solutions = r.status === 'proved-optimal' ? r.solutions.map((s) => s.witness) : [];
      }
      if (solutions.length === 0) return { hint: null, reason: 'unavailable' };
      const hint = computeHint(state, solutions);
      if (hint === null) return { hint: null, reason: trace(buildBoard(state)).allLit ? 'won' : 'unavailable' };
      return { hint, reason: null };
    },
    get solutions() { return solutions; },
  };
}
