// Plateau v2 : grille de tableaux typés construite à partir d'un état (E1, E3, E9, E10).
// Module pur. buildBoard ne modifie pas son entrée.
//
// Un plateau porte aussi les tableaux de travail du tracé (trace.js) : ils sont alloués ici, une seule fois,
// et réutilisés à chaque tracé (E10). Construire coûte O(cases + pièces).

export const EMPTY = 0;
export const WALL = 1;
export const TARGET = 2;
export const MIRROR = 3;
export const EMITTER = 4;
export const SPLITTER = 5;
export const PRISM = 6;
export const FILTER = 7;
export const PORTAL = 8;
export const GATE = 9;

const KIND = {
  wall: WALL, target: TARGET, mirror: MIRROR, emitter: EMITTER, splitter: SPLITTER, prism: PRISM, filter: FILTER, portal: PORTAL, gate: GATE,
};

/** Types toujours fixes (E9) : jamais comptés comme pièces mobiles. */
export function isAlwaysFixed(type) {
  return type === 'wall' || type === 'target' || type === 'emitter' || type === 'portal' || type === 'gate';
}

/**
 * Plateau vide. Les listes dérivées (émetteurs, cibles, portes, portails) sont remplies par `finalize`.
 * `maxPieces` : nombre d'identifiants de pièces (taille du tableau `used`).
 */
export function createBoard(cols, rows, maxPieces = 0) {
  const n = cols * rows;
  return {
    cols, rows, n,
    kind: new Uint8Array(n), orient: new Uint8Array(n), pid: new Int16Array(n).fill(-1),
    aux: new Int16Array(n).fill(-1), need: new Uint8Array(n),
    pieces: [], emitters: [], targetCells: [], gateCells: [], gatesOf: [], movable: new Uint8Array(maxPieces),
    // tableaux de travail et sortie du tracé (E10), réutilisés
    inM: new Uint8Array(n * 4), outM: new Uint8Array(n * 4), endM: new Uint8Array(n * 4), endR: new Uint8Array(n * 4),
    gotT: new Uint8Array(n), open: new Uint8Array(n), used: new Uint8Array(maxPieces), order: new Int16Array(n),
    stack: new Int32Array(40 * n + 64), sp: 0,
    seg: null, result: null,
  };
}

/**
 * Pose la pièce `id` (forme de l'état : type, c, r, o, mask, need) dans sa case. Ne touche pas aux listes dérivées :
 * appeler `finalize` ensuite. Renvoie l'indice de la case.
 */
export function setCell(b, id, p) {
  const i = p.r * b.cols + p.c, k = KIND[p.type];
  b.kind[i] = k;
  b.pid[i] = id;
  if (k === MIRROR || k === SPLITTER) b.orient[i] = p.o & 3;
  else if (k === FILTER) b.orient[i] = p.mask & 7;
  else if (k === TARGET) b.need[i] = p.need & 7;
  return i;
}

/** Vide une case (la pièce qui s'y trouvait disparaît du plateau ; `finalize` à rappeler si la liste de pièces change). */
export function clearCell(b, i) {
  b.kind[i] = EMPTY;
  b.pid[i] = -1;
  b.orient[i] = 0;
  b.need[i] = 0;
}

/** Recalcule les listes dérivées (émetteurs, cibles, portails, portes, pièces mobiles) et la structure de sortie du tracé (E10). */
export function finalize(b, pieces) {
  const { cols } = b;
  b.pieces = pieces;
  b.emitters = [];
  b.targetCells = [];
  b.gateCells = [];
  b.gatesOf = [];
  b.aux.fill(-1);
  if (b.movable.length < pieces.length) { b.movable = new Uint8Array(pieces.length); b.used = new Uint8Array(pieces.length); }
  b.movable.fill(0);
  const portals = new Map();
  const gatePieces = [];
  for (let id = 0; id < pieces.length; id++) {
    const p = pieces[id], i = p.r * cols + p.c;
    if (!isAlwaysFixed(p.type) && p.fixed !== true) b.movable[id] = 1;
    if (p.type === 'emitter') b.emitters.push({ cell: i, d: p.dir & 3, mask: p.mask & 7 });
    else if (p.type === 'target') { b.aux[i] = b.targetCells.length; b.targetCells.push(i); }
    else if (p.type === 'portal') { if (!portals.has(p.pair)) portals.set(p.pair, []); portals.get(p.pair).push(i); }
    else if (p.type === 'gate') { b.gateCells.push(i); gatePieces.push(p); }
  }
  // paire de portails : exactement 2 cases (V11) ; sinon le portail reste muet (la lumière qui y entre s'arrête)
  for (const cells of portals.values()) if (cells.length === 2) { b.aux[cells[0]] = cells[1]; b.aux[cells[1]] = cells[0]; }
  for (let t = 0; t < b.targetCells.length; t++) b.gatesOf[t] = [];
  for (let g = 0; g < gatePieces.length; g++) {
    const link = gatePieces[g].link;
    const ti = link ? b.targetCells.indexOf(link[1] * cols + link[0]) : -1; // porte sans cible liée : reste fermée
    if (ti >= 0) b.gatesOf[ti].push(b.gateCells[g]);
  }
  // structure de sortie (E10) : objets créés une fois, mis à jour à chaque tracé
  b.result = {
    in: b.inM, out: b.outM, end: b.endM, endReason: b.endR, order: b.order, used: b.used,
    targets: b.targetCells.map((cell) => ({ cell, need: b.need[cell], got: 0, lit: false, reached: false })),
    gates: b.gateCells.map((cell) => ({ cell, open: false })),
    usedMovable: 0, litCount: 0, allLit: false, steps: 0, capped: false, orderCount: 0,
    segments: null,
  };
}

/**
 * @param {{cols:number, rows:number, pieces:Array<object>}} state  voir state.js
 * @returns le plateau (tableaux typés + listes dérivées). Lève RangeError si l'état est incohérent
 *          (taille, type inconnu, pièce hors du plateau, deux pièces dans une case).
 */
export function buildBoard(state) {
  const { cols, rows, pieces } = state;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    throw new RangeError('buildBoard : taille de plateau invalide');
  }
  const b = createBoard(cols, rows, pieces.length);
  for (let id = 0; id < pieces.length; id++) {
    const p = pieces[id];
    if (!Object.prototype.hasOwnProperty.call(KIND, p.type)) throw new RangeError(`buildBoard : type de pièce inconnu « ${p.type} »`);
    if (!Number.isInteger(p.c) || !Number.isInteger(p.r) || p.c < 0 || p.r < 0 || p.c >= cols || p.r >= rows) {
      throw new RangeError(`buildBoard : pièce ${id} hors du plateau`);
    }
    if (b.kind[p.r * cols + p.c] !== EMPTY) throw new RangeError(`buildBoard : deux pièces sur la case (${p.c},${p.r})`);
    setCell(b, id, p);
  }
  finalize(b, pieces);
  return b;
}
