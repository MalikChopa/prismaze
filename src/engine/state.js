// État d'une partie : la liste des pièces à un instant donné (E1, E9, MVP R3, R4, R11).
// Module pur. Un état est immuable (gelé) : chaque fonction renvoie un NOUVEL état,
// ou le même objet quand il n'y a rien à changer.
//
// Forme d'un état :
//   { cols, rows, pieces: [{ id, type, c, r, o, dir, mask, need, pair, link, fixed }] }
//   type : 'emitter' | 'wall' | 'target' | 'mirror' | 'splitter' | 'prism' | 'filter' | 'portal' | 'gate'
//   o    : orientation 0..3 (miroir et séparateur seulement, sinon 0)  -> dirs.js ORIENT_CHARS
//   dir  : direction 0..3 (émetteur seulement, sinon 0)                -> dirs.js DIR_CHARS
//   mask : couleur 1..7 (émetteur : lumière émise ; filtre : couleurs qui passent), sinon 0   -> colors.js
//   need : couleur 1..7 attendue par une cible, sinon 0
//   pair : numéro de paire d'un portail (0..3), sinon 0
//   link : [c, r] de la cible liée à une porte, sinon null
//   fixed: true pour tout ce qui n'est pas mobile (E9) : émetteur, mur, cible, portail, porte, et toute pièce marquée fixed
//   id   : indice de la pièce dans le tableau (= indice dans `pieces` du niveau JSON)
// Mobiles par défaut : miroir et séparateur (déplacer + tourner), prisme et filtre (déplacer seulement).
import { dirFromChar, orientFromChar, nextOrientation, prevOrientation } from './dirs.js';
import { maskFromLetters } from './colors.js';
import { isAlwaysFixed } from './board.js';

function freezePiece(p) {
  return Object.freeze(p);
}

function freezeState(cols, rows, pieces) {
  return Object.freeze({ cols, rows, pieces: Object.freeze(pieces) });
}

// Masque d'un niveau (lettres R, G, B) ; absent ou invalide : RangeError (jamais « blanc par défaut » : -1 & 7 vaudrait 7).
function maskOf(letters) {
  const m = maskFromLetters(letters);
  if (m < 0) throw new RangeError('createState : masque de couleur absent ou invalide (niveau du format 1 ?)');
  return m;
}

/**
 * Construit l'état initial d'un niveau déjà validé (format 2, ARCHITECTURE_V2 F1). Le format 1 n'est plus lu ici :
 * `level.js` le refuse (V1) avant toute construction ; un masque absent ou invalide n'est pas remplacé par du blanc.
 * @param {{size:[number,number], pieces:object[]}} level
 */
export function createState(level) {
  const [cols, rows] = level.size;
  const pieces = level.pieces.map((p, id) => freezePiece({
    id,
    type: p.type,
    c: p.at[0],
    r: p.at[1],
    o: p.type === 'mirror' || p.type === 'splitter' ? orientFromChar(p.o) : 0,
    dir: p.type === 'emitter' ? dirFromChar(p.dir) : 0,
    mask: p.type === 'emitter' ? maskOf(p.mask) : p.type === 'filter' ? maskOf(p.mask) : 0,
    need: p.type === 'target' ? maskOf(p.need) : 0,
    pair: p.type === 'portal' ? p.pair | 0 : 0,
    link: p.type === 'gate' && Array.isArray(p.link) ? Object.freeze([p.link[0], p.link[1]]) : null,
    fixed: isAlwaysFixed(p.type) || p.fixed === true,
  }));
  return freezeState(cols, rows, pieces);
}

/** Pièce d'identifiant id, ou undefined. */
export function getPiece(state, id) {
  return state.pieces[id];
}

/** Pièce posée sur la case (c, r), ou undefined. */
export function pieceAt(state, c, r) {
  return state.pieces.find((p) => p.c === c && p.r === r);
}

/** true si le joueur peut déplacer la pièce (E9) : miroir, séparateur, prisme, filtre non fixes. */
export function isMovable(piece) {
  return piece !== undefined && !piece.fixed;
}

/** true si un toucher tourne la pièce (miroir ou séparateur mobile ; prisme et filtre : non). */
export function isRotatable(piece) {
  return piece !== undefined && !piece.fixed && (piece.type === 'mirror' || piece.type === 'splitter');
}

/** true si la pièce est un miroir que le joueur peut tourner et déplacer (nom du MVP, gardé). */
export function isMovableMirror(piece) {
  return piece !== undefined && piece.type === 'mirror' && !piece.fixed;
}

function replacePiece(state, id, next) {
  const pieces = state.pieces.slice();
  pieces[id] = freezePiece(next);
  return freezeState(state.cols, state.rows, pieces);
}

/**
 * Tourne un miroir ou un séparateur mobile de `steps` crans (R4 : o -> (o + 1) & 3 par cran ; steps négatif = annuler).
 * Pièce fixe, prisme ou filtre mobile : renvoie le même état. Identifiant invalide, ou type qui ne tourne jamais : RangeError.
 */
export function rotatePiece(state, id, steps = 1) {
  const p = state.pieces[id];
  if (p === undefined || (p.type !== 'mirror' && p.type !== 'splitter' && p.type !== 'prism' && p.type !== 'filter')) {
    throw new RangeError(`rotatePiece : la pièce ${id} ne peut pas tourner`);
  }
  if (p.fixed || p.type === 'prism' || p.type === 'filter') return state;
  let o = p.o;
  const n = ((steps % 4) + 4) % 4;
  for (let i = 0; i < n; i++) o = nextOrientation(o);
  if (o === p.o) return state;
  return replacePiece(state, id, { ...p, o });
}

/** Miroir seulement (nom du MVP, gardé) : comme rotatePiece mais lève RangeError pour toute autre pièce. */
export function rotateMirror(state, id, steps = 1) {
  const p = state.pieces[id];
  if (p === undefined || p.type !== 'mirror') throw new RangeError(`rotateMirror : la pièce ${id} n'est pas un miroir`);
  return rotatePiece(state, id, steps);
}

/** Annule un cran de rotation (inverse exact de rotateMirror(state, id, 1)). */
export function unrotateMirror(state, id) {
  const p = state.pieces[id];
  if (p === undefined || p.type !== 'mirror') throw new RangeError(`unrotateMirror : la pièce ${id} n'est pas un miroir`);
  if (p.fixed) return state;
  return replacePiece(state, id, { ...p, o: prevOrientation(p.o) });
}

/**
 * Un clic sur la case (c, r) : tourne la pièce rotative mobile qui s'y trouve.
 * Case vide, pièce fixe, prisme, filtre : renvoie le même état.
 */
export function rotateAt(state, c, r) {
  const p = pieceAt(state, c, r);
  if (!isRotatable(p)) return state;
  return rotatePiece(state, p.id, 1);
}

/**
 * Déplace une pièce mobile vers la case libre (c, r). Case occupée, hors plateau ou pièce fixe :
 * renvoie le même état (le déplacement est refusé). Pièce qui n'existe pas ou qui est toujours fixe par type : RangeError.
 */
export function movePiece(state, id, c, r) {
  const p = state.pieces[id];
  if (p === undefined || isAlwaysFixed(p.type)) throw new RangeError(`movePiece : la pièce ${id} ne peut pas bouger`);
  if (p.fixed) return state;
  if (!Number.isInteger(c) || !Number.isInteger(r) || c < 0 || r < 0 || c >= state.cols || r >= state.rows) return state;
  if (p.c === c && p.r === r) return state;
  if (pieceAt(state, c, r) !== undefined) return state;
  return replacePiece(state, id, { ...p, c, r });
}

/** Miroir seulement (nom du MVP, gardé). */
export function moveMirror(state, id, c, r) {
  const p = state.pieces[id];
  if (p === undefined || p.type !== 'mirror') throw new RangeError(`moveMirror : la pièce ${id} n'est pas un miroir`);
  return movePiece(state, id, c, r);
}

/** Identifiants des pièces mobiles (E9), dans l'ordre. */
export function movableIds(state) {
  const ids = [];
  for (const p of state.pieces) if (isMovable(p)) ids.push(p.id);
  return ids;
}

/** Identifiants des miroirs mobiles, dans l'ordre (nom du MVP, gardé). */
export function movableMirrorIds(state) {
  const ids = [];
  for (const p of state.pieces) if (isMovableMirror(p)) ids.push(p.id);
  return ids;
}
