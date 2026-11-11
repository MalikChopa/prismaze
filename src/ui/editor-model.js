// Modèle de l'éditeur (ARCHITECTURE_V2 F6) : le niveau en cours (nom, taille, pièces au format JSON de F1), les commandes
// `place`, `erase`, `rotate`, `toggleFixed`, `resize` avec annuler / refaire, les plafonds de F2 en direct et la conversion en niveau partageable.
// Module pur (aucun DOM) : se teste sous Node. Aucune clé ne vient d'une entrée : les pièces sont des objets littéraux à champs fixes.
import { validateLevel, normalizeName, NAME_TABLE, MAX_NAME_SHARED, MAX_COLS, MAX_ROWS, MIN_SIZE, MAX_EMITTERS, MAX_TARGETS, MAX_GATES, MAX_PAIRS, MAX_PIECES, MAX_MOVABLE, SHARED_ID } from '../engine/level.js';
import { ORIENT_CHARS, DIR_CHARS } from '../engine/dirs.js';
import { maskToLetters } from '../engine/colors.js';

export const EDITOR_LIMITS = Object.freeze({ minCols: MIN_SIZE, maxCols: MAX_COLS, minRows: MIN_SIZE, maxRows: MAX_ROWS, emitters: MAX_EMITTERS, targets: MAX_TARGETS, gates: MAX_GATES, pairs: MAX_PAIRS, pieces: MAX_PIECES, mobiles: MAX_MOVABLE, name: MAX_NAME_SHARED });
export const DEFAULT_SIZE = Object.freeze([8, 6]);
export const MAX_HISTORY = 200;

const MOVABLE_TYPES = ['mirror', 'splitter', 'prism', 'filter'];
const KEYS = { emitter: ['dir', 'mask'], wall: [], target: ['need'], mirror: ['o', 'fixed'], splitter: ['o', 'fixed'], prism: ['fixed'], filter: ['mask', 'fixed'], portal: ['pair'], gate: ['link'] };
const TYPE_LABEL = { emitter: 'émetteur', wall: 'mur', target: 'cible', mirror: 'miroir', splitter: 'séparateur', prism: 'prisme', filter: 'filtre', portal: 'portail', gate: 'porte' };
export const typeLabel = (t) => TYPE_LABEL[t] ?? 'pièce';

/** Copie propre d'une pièce (champs de la liste blanche seulement). */
function clonePiece(p) {
  const out = { type: p.type, at: [p.at[0], p.at[1]] };
  for (const k of KEYS[p.type]) {
    if (!Object.prototype.hasOwnProperty.call(p, k) || p[k] === undefined) continue;
    if (k === 'fixed' && p[k] !== true) continue;
    out[k] = k === 'link' ? [p.link[0], p.link[1]] : p[k];
  }
  return out;
}

const isMovableType = (t) => MOVABLE_TYPES.includes(t);
const isMobile = (p) => isMovableType(p.type) && p.fixed !== true;
const bySort = (a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0];

/**
 * Nom saisi ou collé -> nom partageable : NFC puis minuscules (V15), signes hors de la table T retirés (P13), 24 signes au plus.
 * @returns {{value:string, rejected:string[], truncated:boolean}}
 */
export function sanitizeName(raw) {
  const text = normalizeName(typeof raw === 'string' ? raw : '');
  let value = '';
  const rejected = [];
  for (const ch of text) {
    if (NAME_TABLE.includes(ch) && ch.length === 1) value += ch;
    else if (!rejected.includes(ch)) rejected.push(ch);
  }
  const truncated = value.length > MAX_NAME_SHARED;
  return { value: value.slice(0, MAX_NAME_SHARED), rejected, truncated };
}

/** Décompte des pièces et plafonds de F2 pour une liste de pièces. */
export function countPieces(pieces, cols, rows) {
  const c = { emitters: 0, targets: 0, gates: 0, portals: 0, pieces: pieces.length, mobiles: 0, fixedCells: 0, pairs: 0, freeCells: 0 };
  const pairCount = new Map();
  for (const p of pieces) {
    if (p.type === 'emitter') c.emitters++;
    else if (p.type === 'target') c.targets++;
    else if (p.type === 'gate') c.gates++;
    else if (p.type === 'portal') { c.portals++; pairCount.set(p.pair, (pairCount.get(p.pair) || 0) + 1); }
    if (isMobile(p)) c.mobiles++; else c.fixedCells++;
  }
  c.pairs = pairCount.size;
  c.freeCells = cols * rows - c.fixedCells;
  c.pairCount = pairCount;
  return c;
}

/** Premier plafond de F2 dépassé par cette liste de pièces, ou null. */
function limitViolation(pieces, cols, rows) {
  const c = countPieces(pieces, cols, rows);
  if (c.emitters > MAX_EMITTERS) return `${MAX_EMITTERS} émetteurs au plus`;
  if (c.targets > MAX_TARGETS) return `${MAX_TARGETS} cibles au plus`;
  if (c.gates > MAX_GATES) return `${MAX_GATES} portes au plus`;
  if (c.pairs > MAX_PAIRS) return `${MAX_PAIRS} paires de portails au plus`;
  for (const [pair, n] of c.pairCount) if (n > 2) return `la paire de portails ${pair + 1} a déjà ses 2 portails`;
  if (c.pieces > MAX_PIECES) return `${MAX_PIECES} pièces au plus`;
  if (c.mobiles > MAX_MOVABLE) return `${MAX_MOVABLE} pièces mobiles au plus (verrouille-en avec le cadenas)`;
  return null;
}

const COLOR_LETTERS = ['R', 'G', 'B', 'RG', 'RB', 'GB', 'RGB'];
/** Valeurs d'énumération de F2 (V7) d'une pièce à poser : message de refus, ou null. Les clés ne viennent jamais d'une entrée. */
function specError(p) {
  switch (p.type) {
    case 'emitter': return DIR_CHARS.includes(p.dir) && COLOR_LETTERS.includes(p.mask) ? null : 'émetteur : direction ou couleur invalide';
    case 'target': return COLOR_LETTERS.includes(p.need) ? null : 'cible : couleur invalide';
    case 'mirror': case 'splitter': return ORIENT_CHARS.includes(p.o) ? null : 'orientation invalide';
    case 'filter': return COLOR_LETTERS.slice(0, 6).includes(p.mask) ? null : 'filtre : couleur invalide (6 couleurs, pas le blanc)';
    case 'portal': return Number.isInteger(p.pair) && p.pair >= 0 && p.pair <= 3 ? null : 'portail : paire de 1 à 4';
    default: return null;
  }
}

/**
 * @param {{name?:string, size?:[number,number], pieces?:object[]}} [initial]  niveau de départ (format de F1, sans id)
 */
export function createEditorModel(initial = {}) {
  let cols = Array.isArray(initial.size) ? initial.size[0] : DEFAULT_SIZE[0];
  let rows = Array.isArray(initial.size) ? initial.size[1] : DEFAULT_SIZE[1];
  let name = typeof initial.name === 'string' ? initial.name : '';
  let pieces = Array.isArray(initial.pieces) ? initial.pieces.map(clonePiece) : [];
  const undoStack = [];
  const redoStack = [];
  let version = 0; // augmente à chaque changement du niveau (le témoin de l'auteur en dépend)

  const snapshot = () => ({ cols, rows, pieces: pieces.map(clonePiece) });
  const restore = (s) => { cols = s.cols; rows = s.rows; pieces = s.pieces.map(clonePiece); };
  const indexAt = (c, r) => pieces.findIndex((p) => p.at[0] === c && p.at[1] === r);
  const inside = (c, r) => Number.isInteger(c) && Number.isInteger(r) && c >= 0 && r >= 0 && c < cols && r < rows;

  /** Applique un changement : `next` = nouvelle liste de pièces (ou null si refus), `kind` pour l'historique. */
  function commit(kind, nextCols, nextRows, nextPieces) {
    const before = snapshot();
    cols = nextCols; rows = nextRows; pieces = nextPieces.map(clonePiece);
    undoStack.push({ kind, before });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    version++;
    return { ok: true, kind };
  }
  const refuse = (message) => ({ ok: false, message });

  /** Retire de `list` les portes dont la cible liée n'existe plus (cascade). */
  function pruneGates(list) {
    const targets = new Set(list.filter((p) => p.type === 'target').map((p) => `${p.at[0]},${p.at[1]}`));
    return list.filter((p) => p.type !== 'gate' || targets.has(`${p.link[0]},${p.link[1]}`));
  }

  const api = {
    get cols() { return cols; },
    get rows() { return rows; },
    get name() { return name; },
    get pieces() { return pieces.map(clonePiece); },
    get version() { return version; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    pieceAt(c, r) { const i = indexAt(c, r); return i < 0 ? null : clonePiece(pieces[i]); },

    /** Nom : normalisé (NFC, minuscules) et réduit à la table T ; ne fait pas partie de l'historique. */
    setName(raw) { const s = sanitizeName(raw); name = s.value; version++; return s; },

    /**
     * Pose `spec` (type + paramètres, sans `at`) sur la case (c, r) ; remplace la pièce qui s'y trouve. Une porte demande `spec.link` =
     * case [c, r] d'une cible existante. Remplacer ou effacer une cible retire les portes qui la visaient (une seule commande annulable).
     */
    place(c, r, spec) {
      if (!inside(c, r)) return refuse('case hors du plateau');
      if (spec === null || typeof spec !== 'object' || !Object.prototype.hasOwnProperty.call(KEYS, spec.type)) return refuse('pièce inconnue');
      const piece = clonePiece({ ...spec, at: [c, r] });
      const bad0 = specError(piece);
      if (bad0 !== null) return refuse(bad0);
      if (piece.type === 'gate') {
        const t = Array.isArray(spec.link) ? pieces.find((p) => p.type === 'target' && p.at[0] === spec.link[0] && p.at[1] === spec.link[1]) : undefined;
        if (t === undefined) return refuse('une porte doit être liée à une cible : pose d\'abord une cible');
      }
      const i = indexAt(c, r);
      if (i >= 0 && JSON.stringify(pieces[i]) === JSON.stringify(piece)) return refuse('cette pièce est déjà là');
      let next = pieces.filter((_, k) => k !== i);
      next.push(piece);
      next = pruneGates(next);
      const bad = limitViolation(next, cols, rows);
      if (bad !== null) return refuse(bad);
      return commit('place', cols, rows, next);
    },

    erase(c, r) {
      if (!inside(c, r)) return refuse('case hors du plateau');
      const i = indexAt(c, r);
      if (i < 0) return refuse('rien à effacer ici');
      return commit('erase', cols, rows, pruneGates(pieces.filter((_, k) => k !== i)));
    },

    /** Tourne la pièce de la case d'un cran : miroir et séparateur (orientation), émetteur (direction). `steps` = +1 ou -1. */
    rotate(c, r, steps = 1) {
      const i = indexAt(c, r);
      if (i < 0) return refuse('aucune pièce ici');
      const p = pieces[i];
      let next;
      if (p.type === 'mirror' || p.type === 'splitter') {
        const k = (ORIENT_CHARS.indexOf(p.o) + steps + 4) % 4;
        next = { ...p, o: ORIENT_CHARS[k] };
      } else if (p.type === 'emitter') {
        const k = (DIR_CHARS.indexOf(p.dir) + steps + 4) % 4;
        next = { ...p, dir: DIR_CHARS[k] };
      } else return refuse(`un ${typeLabel(p.type)} ne tourne pas`);
      const list = pieces.slice();
      list[i] = next;
      return commit('rotate', cols, rows, list);
    },

    /** Cadenas : une pièce mobile devient fixe et inversement (miroir, séparateur, prisme, filtre seulement). */
    toggleFixed(c, r) {
      const i = indexAt(c, r);
      if (i < 0) return refuse('aucune pièce ici');
      const p = pieces[i];
      if (!isMovableType(p.type)) return refuse(`un ${typeLabel(p.type)} est toujours fixe`);
      const next = p.fixed === true ? clonePiece({ ...p, fixed: undefined }) : { ...p, fixed: true };
      const list = pieces.slice();
      list[i] = next;
      const bad = limitViolation(list, cols, rows);
      if (bad !== null) return refuse(bad);
      return commit('toggleFixed', cols, rows, list);
    },

    /** Change la taille (3 à 12 x 3 à 10) ; refuse de perdre une pièce. */
    resize(nc, nr) {
      if (!Number.isInteger(nc) || !Number.isInteger(nr) || nc < MIN_SIZE || nr < MIN_SIZE || nc > MAX_COLS || nr > MAX_ROWS) return refuse(`taille de ${MIN_SIZE}×${MIN_SIZE} à ${MAX_COLS}×${MAX_ROWS}`);
      if (nc === cols && nr === rows) return refuse('même taille');
      const lost = pieces.filter((p) => p.at[0] >= nc || p.at[1] >= nr);
      if (lost.length > 0) return refuse(`${lost.length} pièce${lost.length > 1 ? 's seraient perdues' : ' serait perdue'} : efface-${lost.length > 1 ? 'les' : 'la'} d'abord`);
      return commit('resize', nc, nr, pieces);
    },

    undo() {
      const e = undoStack.pop();
      if (e === undefined) return refuse('rien à annuler');
      redoStack.push({ kind: e.kind, before: snapshot() });
      restore(e.before);
      version++;
      return { ok: true, kind: e.kind };
    },
    redo() {
      const e = redoStack.pop();
      if (e === undefined) return refuse('rien à refaire');
      undoStack.push({ kind: e.kind, before: snapshot() });
      restore(e.before);
      version++;
      return { ok: true, kind: e.kind };
    },

    /** Niveau partageable (F1 / F2 mode `shared`) : id `partage`, pièces triées par (ligne, colonne). */
    level() {
      return { format: 2, id: SHARED_ID, name, size: [cols, rows], pieces: pieces.map(clonePiece).sort(bySort) };
    },
    /** Remplace tout par un niveau (import, brouillon) ; vide l'historique. Le niveau doit être déjà validé par l'appelant. */
    load(level) {
      cols = level.size[0]; rows = level.size[1];
      name = typeof level.name === 'string' ? level.name : '';
      pieces = level.pieces.map(clonePiece);
      undoStack.length = 0; redoStack.length = 0;
      version++;
    },

    /** Décompte et plafonds pour l'affichage en direct. */
    counts() { return countPieces(pieces, cols, rows); },
    /** Messages de F2 (mode `shared`) : vide = niveau jouable et partageable. */
    problems() {
      const v = validateLevel(api.level(), { mode: 'shared' });
      return v.errors.map((e) => ({ code: e.code, message: e.message }));
    },
    get valid() { return api.problems().length === 0; },
  };
  return api;
}

/**
 * Témoin de l'auteur (S4, F6) : les pièces mobiles UTILISÉES dans la configuration gagnante, au format des placements de F1 / S6
 * (`{type, at, o}`, `{type, at}`, `{type, at, mask}`). L'appelant les rejoue avec `replayPlacements` (le moteur seul décide).
 * @param {{pieces:object[]}} state  état du moteur (engine/state.js)
 * @param {ArrayLike<number>} used  `used` du résultat de trace() (1 = la pièce a changé la lumière)
 */
export function witnessPlacements(state, used) {
  const out = [];
  for (const p of state.pieces) {
    if (p.fixed || !isMovableType(p.type) || used[p.id] !== 1) continue;
    if (p.type === 'mirror' || p.type === 'splitter') out.push({ type: p.type, at: [p.c, p.r], o: ORIENT_CHARS[p.o] });
    else if (p.type === 'prism') out.push({ type: 'prism', at: [p.c, p.r] });
    else out.push({ type: 'filter', at: [p.c, p.r], mask: maskToLetters(p.mask) });
  }
  return out;
}
