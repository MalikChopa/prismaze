// Validation d'un niveau (format 2, ARCHITECTURE_V2 F1 et F2, règles V1 à V15) et de l'index à chapitres (F3).
// Module pur : aucune clé d'objet ne vient de l'entrée (liste blanche par type, lecture des propriétés propres seulement).
// V14 (preuve) : le hachage sha256 est calculé par l'appelant (outils, tests) ; ce module fournit le texte canonique à hacher.
import { dirFromChar, orientFromChar } from './dirs.js';
import { maskFromLetters, maskToLetters } from './colors.js';
import { createState } from './state.js';
import { buildBoard } from './board.js';
import { trace } from './trace.js';

/** Codes d'erreur, un par règle (et par cas distinct d'une règle). Le préfixe `Vn` donne la règle de F2. */
export const CODES = Object.freeze({
  SHAPE: 'V0_SHAPE', // pas un objet, champ manquant ou de mauvais type (en amont des règles)
  FORMAT: 'V1_FORMAT', // `format: 1` (MVP) y est refusé, jamais converti
  ID: 'V2_ID', // id absent ou hors [a-z0-9-]{3,40}
  ID_NAME: 'V2_ID_NAME', // id différent du nom du fichier (livré) ou de « partage » (partageable)
  ID_DUPLICATE: 'V2_ID_DUPLICATE', // id déjà pris par un autre niveau
  SIZE: 'V3_SIZE',
  UNKNOWN_KEY: 'V4_UNKNOWN_KEY',
  OUT_OF_BOUNDS: 'V5_OUT_OF_BOUNDS',
  OVERLAP: 'V5_OVERLAP', // deux pièces sur la même case
  EMITTER_COUNT: 'V6_EMITTER_COUNT', // hors de 1 à 3
  NO_TARGET: 'V6_NO_TARGET', // aucune cible
  TARGET_COUNT: 'V6_TARGET_COUNT', // plus de 8 cibles
  GATE_COUNT: 'V6_GATE_COUNT', // plus de 4 portes
  PORTAL_PAIRS: 'V6_PORTAL_PAIRS', // plus de 4 paires de portails
  PIECE_COUNT: 'V6_PIECE_COUNT', // plus de 100 pièces
  ORIENTATION: 'V7_ORIENTATION',
  DIRECTION: 'V7_DIRECTION',
  MASK: 'V7_MASK', // masque absent, vide, hors RGB ou hors de l'ordre RGB ; filtre hors de 1 à 6
  PAIR: 'V7_PAIR', // pair hors de 0 à 3
  FIXED: 'V7_FIXED', // fixed n'est pas un booléen
  MOVABLE_COUNT: 'V8_MOVABLE_COUNT',
  NO_FREE_CELL: 'V9_NO_FREE_CELL',
  ALREADY_WON: 'V10_ALREADY_WON',
  CAPPED: 'V10_CAPPED', // le tracé de l'état initial atteint le plafond de pas
  PORTAL_PAIR: 'V11_PORTAL_PAIR', // une paire de portails n'a pas exactement 2 portails
  LINK: 'V12_LINK', // le lien d'une porte ne désigne pas une cible
  SOLUTIONS: 'V13_SOLUTIONS', // par ou solutions absents, mal formés ou rejoués sans victoire
  PROOF: 'V14_PROOF', // preuve absente, périmée ou non optimale
  NAME: 'V15_NAME',
});

export const ID_PATTERN = /^[a-z0-9-]{3,40}$/;
export const MIN_SIZE = 3;
export const MAX_COLS = 12;
export const MAX_ROWS = 10;
export const MAX_EMITTERS = 3;
export const MAX_TARGETS = 8;
export const MAX_GATES = 4;
export const MAX_PAIRS = 4;
export const MAX_PIECES = 100;
export const MIN_MOVABLE = 1;
export const MAX_MOVABLE = 8;
export const MAX_SOLUTIONS = 4;
export const SHARED_ID = 'partage';
export const MAX_NAME_SHIPPED = 40;
export const MAX_NAME_SHARED = 24;
export const RULES_VERSION = 2;
export const SOLVER_VERSION = 2;

/** Table T de F4 : les 64 signes autorisés dans le nom d'un niveau partageable (minuscules, formes composées NFC). */
export const NAME_TABLE = "abcdefghijklmnopqrstuvwxyz0123456789 -'.,!?:éèêàâçôîïûüöùëäœ+&æÿ";

/** V15 : ce que fait le champ de saisie (et le collage) avant tout contrôle : NFC d'abord, minuscules ensuite. */
export function normalizeName(s) {
  return String(s).normalize('NFC').toLowerCase();
}

/** true si `s` est un nom partageable : 0 à 24 signes, tous dans la table T (sans normalisation implicite). */
export function isShareableName(s) {
  if (typeof s !== 'string' || s.length > MAX_NAME_SHARED) return false;
  for (let i = 0; i < s.length; i++) if (NAME_TABLE.indexOf(s[i]) < 0) return false;
  return true;
}

const LEVEL_KEYS = ['format', 'id', 'name', 'size', 'pieces', 'par', 'solutions'];
const SHARED_LEVEL_KEYS = ['format', 'id', 'name', 'size', 'pieces'];
const PIECE_KEYS = {
  emitter: ['type', 'at', 'dir', 'mask'],
  wall: ['type', 'at'],
  target: ['type', 'at', 'need'],
  mirror: ['type', 'at', 'o', 'fixed'],
  splitter: ['type', 'at', 'o', 'fixed'],
  prism: ['type', 'at', 'fixed'],
  filter: ['type', 'at', 'mask', 'fixed'],
  portal: ['type', 'at', 'pair'],
  gate: ['type', 'at', 'link'],
};
// Pièces que le joueur peut déplacer quand `fixed` n'est pas vrai (E9).
const MOVABLE_TYPES = ['mirror', 'splitter', 'prism', 'filter'];
const PLACEMENT_KEYS = {
  mirror: ['type', 'at', 'o'],
  splitter: ['type', 'at', 'o'],
  prism: ['type', 'at'],
  filter: ['type', 'at', 'mask'],
};
const PROOF_KEYS = ['format', 'levelId', 'levelHash', 'rulesVersion', 'solverVersion', 'status', 'minimum', 'solutionsAtMin', 'witness', 'parking', 'metrics'];

function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasOwn(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

// Lecture d'une propriété propre seulement (jamais héritée du prototype).
function own(o, k) {
  return hasOwn(o, k) ? o[k] : undefined;
}

function isAt(at) {
  return Array.isArray(at) && at.length === 2 && Number.isInteger(at[0]) && Number.isInteger(at[1]);
}

/** Masque 1..7 depuis des lettres STRICTEMENT dans l'ordre RGB (« RG », jamais « GR ») ; -1 sinon. */
export function parseMask(s) {
  const m = maskFromLetters(s);
  return m > 0 && maskToLetters(m) === s ? m : -1;
}

/**
 * Valide un niveau (objet déjà analysé : fichier JSON, brouillon collé ou niveau décodé d'un lien).
 * @param {unknown} raw
 * @param {{mode?:'shipped'|'shared', expectedId?:string, takenIds?:Iterable<string>}} [options]
 *   mode `shipped` : niveau livré (V13 exigé : `par` et `solutions` rejoués ; nom 1 à 40) ;
 *   mode `shared` : niveau partageable (éditeur, lien, brouillon) : id `partage`, nom 0 à 24 signes de la table T,
 *   ni `par` ni `solutions` ; sans mode : niveau d'atelier (`par` et `solutions` facultatifs, rejoués s'ils sont là).
 *   expectedId : nom du fichier sans .json (V2) ; takenIds : ids déjà pris (V2).
 * @returns {{ok:boolean, errors:Array<{code:string, rule:string, path:string, message:string}>, level:object|null}}
 *   `level` est `raw` lui-même quand ok (jamais modifié), sinon null. Toutes les erreurs structurelles sont renvoyées ;
 *   V10 et V13 ne sont évaluées que si le reste passe. Ne lève jamais d'exception.
 */
export function validateLevel(raw, options = {}) {
  const errors = [];
  const err = (code, path, message) => errors.push({ code, rule: code.slice(0, code.indexOf('_')), path, message });
  const mode = options.mode === 'shipped' || options.mode === 'shared' ? options.mode : 'free';

  if (!isObject(raw)) {
    err(CODES.SHAPE, '', 'le niveau doit être un objet JSON');
    return { ok: false, errors, level: null };
  }

  // V4 : aucune clé inconnue (niveau)
  const levelKeys = mode === 'shared' ? SHARED_LEVEL_KEYS : LEVEL_KEYS;
  for (const k of Object.keys(raw)) {
    if (!levelKeys.includes(k)) err(CODES.UNKNOWN_KEY, k, `clé inconnue « ${k} »`);
  }

  // V1 : format 2 seulement ; le format 1 est refusé, jamais converti
  if (own(raw, 'format') !== 2) err(CODES.FORMAT, 'format', 'format doit valoir 2 (le format 1 n\'est plus lu)');

  // V2
  const id = own(raw, 'id');
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    err(CODES.ID, 'id', 'id doit respecter [a-z0-9-]{3,40}');
  } else {
    if (mode === 'shared' && id !== SHARED_ID) err(CODES.ID_NAME, 'id', `id « ${id} » : un niveau partageable porte l'id « ${SHARED_ID} »`);
    if (options.expectedId !== undefined && id !== options.expectedId) {
      err(CODES.ID_NAME, 'id', `id « ${id} » différent du nom du fichier « ${options.expectedId} »`);
    }
    if (options.takenIds !== undefined && new Set(options.takenIds).has(id)) {
      err(CODES.ID_DUPLICATE, 'id', `id « ${id} » déjà utilisé`);
    }
  }

  // V15
  const name = own(raw, 'name');
  if (name !== undefined && typeof name !== 'string') {
    err(CODES.SHAPE, 'name', 'name doit être un texte');
  } else if (mode === 'shipped') {
    if (name === undefined || name.length < 1 || name.length > MAX_NAME_SHIPPED) err(CODES.NAME, 'name', `name : 1 à ${MAX_NAME_SHIPPED} caractères`);
  } else if (mode === 'shared') {
    if (name !== undefined && !isShareableName(name)) err(CODES.NAME, 'name', `name : 0 à ${MAX_NAME_SHARED} signes de la table des noms (minuscules, lettres accentuées usuelles, chiffres, ponctuation simple)`);
  } else if (name !== undefined && name.length > MAX_NAME_SHIPPED) {
    err(CODES.NAME, 'name', `name : ${MAX_NAME_SHIPPED} caractères au plus`);
  }

  // V3
  let cols = 0;
  let rows = 0;
  let sizeOk = false;
  const size = own(raw, 'size');
  if (!Array.isArray(size) || size.length !== 2 || !size.every(Number.isInteger)) {
    err(CODES.SIZE, 'size', 'size doit être [colonnes, lignes] en entiers');
  } else {
    [cols, rows] = size;
    if (cols < MIN_SIZE || rows < MIN_SIZE || cols > MAX_COLS || rows > MAX_ROWS) {
      err(CODES.SIZE, 'size', `taille de ${MIN_SIZE}×${MIN_SIZE} à ${MAX_COLS}×${MAX_ROWS} seulement`);
    } else sizeOk = true;
  }

  const inBounds = (at) => sizeOk && at[0] >= 0 && at[1] >= 0 && at[0] < cols && at[1] < rows;

  // Pièces : V4 (clés), V5 (coordonnées), V6 (nombres), V7 (énumérations), V8 (mobiles), V9, V11, V12
  let emitters = 0;
  let targets = 0;
  let gates = 0;
  let movable = 0;
  let fixedCount = 0;
  let piecesOk = false;
  const occupied = new Set();
  const targetKeys = new Set();
  const gateLinks = [];
  const pairCount = new Map();
  const piecesRaw = own(raw, 'pieces');
  if (!Array.isArray(piecesRaw)) {
    err(CODES.SHAPE, 'pieces', 'pieces doit être une liste');
  } else {
    piecesOk = true;
    if (piecesRaw.length > MAX_PIECES) err(CODES.PIECE_COUNT, 'pieces', `${MAX_PIECES} pièces au plus (trouvé ${piecesRaw.length})`);
    const list = piecesRaw.length > MAX_PIECES ? piecesRaw.slice(0, MAX_PIECES) : piecesRaw;
    list.forEach((p, i) => {
      const where = `pieces[${i}]`;
      if (!isObject(p)) { err(CODES.SHAPE, where, 'une pièce doit être un objet'); return; }
      const type = own(p, 'type');
      if (typeof type !== 'string' || !hasOwn(PIECE_KEYS, type)) { err(CODES.SHAPE, `${where}.type`, 'type de pièce inconnu'); return; }
      for (const k of Object.keys(p)) {
        if (!PIECE_KEYS[type].includes(k)) err(CODES.UNKNOWN_KEY, `${where}.${k}`, `clé inconnue « ${k} » pour un ${type}`);
      }
      const at = own(p, 'at');
      if (!isAt(at)) {
        err(CODES.OUT_OF_BOUNDS, `${where}.at`, 'at doit être [colonne, ligne] en entiers');
      } else if (sizeOk) {
        if (!inBounds(at)) err(CODES.OUT_OF_BOUNDS, `${where}.at`, `case (${at[0]},${at[1]}) hors du plateau`);
        else {
          const key = at[0] + ',' + at[1];
          if (occupied.has(key)) err(CODES.OVERLAP, `${where}.at`, `deux pièces sur la case (${key})`);
          occupied.add(key);
        }
      }
      const fixed = own(p, 'fixed');
      if (fixed !== undefined && typeof fixed !== 'boolean') err(CODES.FIXED, `${where}.fixed`, 'fixed doit être un booléen');
      const isMovable = MOVABLE_TYPES.includes(type) && fixed !== true;
      if (isMovable) movable++; else fixedCount++;

      if (type === 'emitter') {
        emitters++;
        const dir = own(p, 'dir');
        if (typeof dir !== 'string' || dirFromChar(dir) < 0) err(CODES.DIRECTION, `${where}.dir`, 'dir doit valoir E, N, W ou S');
        if (parseMask(own(p, 'mask')) < 0) err(CODES.MASK, `${where}.mask`, 'mask : lettres R, G, B dans l\'ordre RGB (« RGB », « RG »…)');
      } else if (type === 'target') {
        targets++;
        if (isAt(at)) targetKeys.add(at[0] + ',' + at[1]);
        if (parseMask(own(p, 'need')) < 0) err(CODES.MASK, `${where}.need`, 'need : lettres R, G, B dans l\'ordre RGB');
      } else if (type === 'mirror' || type === 'splitter') {
        const o = own(p, 'o');
        if (typeof o !== 'string' || orientFromChar(o) < 0) err(CODES.ORIENTATION, `${where}.o`, 'o doit valoir -, /, | ou \\');
      } else if (type === 'filter') {
        const m = parseMask(own(p, 'mask'));
        if (m < 1 || m > 6) err(CODES.MASK, `${where}.mask`, 'mask d\'un filtre : de 1 à 6 (ni vide, ni RGB), lettres dans l\'ordre RGB');
      } else if (type === 'portal') {
        const pair = own(p, 'pair');
        if (!Number.isInteger(pair) || pair < 0 || pair > 3) err(CODES.PAIR, `${where}.pair`, 'pair doit être un entier de 0 à 3');
        else pairCount.set(pair, (pairCount.get(pair) || 0) + 1);
      } else if (type === 'gate') {
        gates++;
        gateLinks.push({ where, link: own(p, 'link') });
      }
    });
  }

  if (piecesOk) {
    // V6
    if (emitters < 1 || emitters > MAX_EMITTERS) err(CODES.EMITTER_COUNT, 'pieces', `de 1 à ${MAX_EMITTERS} émetteurs (trouvé ${emitters})`);
    if (targets < 1) err(CODES.NO_TARGET, 'pieces', 'il faut au moins 1 cible');
    if (targets > MAX_TARGETS) err(CODES.TARGET_COUNT, 'pieces', `${MAX_TARGETS} cibles au plus (trouvé ${targets})`);
    if (gates > MAX_GATES) err(CODES.GATE_COUNT, 'pieces', `${MAX_GATES} portes au plus (trouvé ${gates})`);
    if (pairCount.size > MAX_PAIRS) err(CODES.PORTAL_PAIRS, 'pieces', `${MAX_PAIRS} paires de portails au plus`);
    // V8
    if (movable < MIN_MOVABLE || movable > MAX_MOVABLE) {
      err(CODES.MOVABLE_COUNT, 'pieces', `de ${MIN_MOVABLE} à ${MAX_MOVABLE} pièces mobiles (trouvé ${movable})`);
    }
    // V9 : cases libres = cases sans pièce fixe (celles des mobiles comprises) ; il en faut au moins mobiles + 1
    if (sizeOk && cols * rows - fixedCount < movable + 1) {
      err(CODES.NO_FREE_CELL, 'pieces', `il faut au moins ${movable + 1} cases sans pièce fixe (mobiles + 1)`);
    }
    // V11 : chaque paire de portails a exactement 2 portails (un portail seul n'atteint jamais le moteur)
    for (const [pair, n] of pairCount) {
      if (n !== 2) err(CODES.PORTAL_PAIR, 'pieces', `la paire ${pair} compte ${n} portail(s) au lieu de 2`);
    }
    // V12 : chaque lien de porte désigne une cible
    for (const g of gateLinks) {
      if (!isAt(g.link) || !targetKeys.has(g.link[0] + ',' + g.link[1])) err(CODES.LINK, `${g.where}.link`, 'link doit être la case [colonne, ligne] d\'une cible');
    }
  }

  // par et solutions (V13), plus tard le rejeu ; ici seulement la forme
  const hasPar = hasOwn(raw, 'par');
  const hasSolutions = hasOwn(raw, 'solutions');
  const par = own(raw, 'par');
  const solutions = own(raw, 'solutions');
  if (mode !== 'shared') {
    if (mode === 'shipped' && !(hasPar && hasSolutions)) err(CODES.SOLUTIONS, 'par', 'un niveau livré porte `par` et `solutions`');
    if (hasPar && (!Number.isInteger(par) || par < 1)) err(CODES.SOLUTIONS, 'par', 'par doit être un entier ≥ 1');
    if (hasSolutions && (!Array.isArray(solutions) || solutions.length < 1 || solutions.length > MAX_SOLUTIONS)) {
      err(CODES.SOLUTIONS, 'solutions', `solutions : de 1 à ${MAX_SOLUTIONS} jeux de placements`);
    }
    if (hasPar !== hasSolutions) err(CODES.SOLUTIONS, hasPar ? 'solutions' : 'par', '`par` et `solutions` vont ensemble');
  }

  // V10 puis V13 : seulement si le reste est sain (il faut pouvoir tracer le faisceau)
  if (errors.length === 0) {
    const t = trace(buildBoard(createState(raw)));
    if (t.capped) err(CODES.CAPPED, 'pieces', 'le tracé de l\'état initial atteint le plafond de pas');
    else if (t.allLit) err(CODES.ALREADY_WON, 'pieces', 'l\'état initial est déjà gagnant');
  }
  if (errors.length === 0 && mode !== 'shared' && hasPar) {
    if (par > movable) err(CODES.SOLUTIONS, 'par', `par (${par}) dépasse le nombre de pièces mobiles (${movable})`);
    solutions.forEach((s, i) => {
      const r = replayPlacements(raw, s);
      if (!r.ok) err(CODES.SOLUTIONS, `solutions[${i}]`, r.message);
      else if (r.usedMovable !== par) err(CODES.SOLUTIONS, `solutions[${i}]`, `le jeu ${i} gagne avec ${r.usedMovable} pièces utilisées, par vaut ${par}`);
    });
  }

  return errors.length === 0 ? { ok: true, errors, level: raw } : { ok: false, errors, level: null };
}

/**
 * Rejoue un jeu de placements (F1 `solutions`, S6 `witness` + `parking`) sur un niveau valide : toutes les pièces mobiles
 * du niveau sont retirées (lemme E8 : les pièces inutiles ne changent rien), les placements sont posés, le moteur trace.
 * Les placements doivent puiser dans l'inventaire des pièces mobiles (même type, même masque de filtre), sur des cases
 * du plateau distinctes et sans pièce fixe.
 * @returns {{ok:boolean, message:string, allLit:boolean, usedMovable:number}} `ok` = bien formé ET gagnant
 */
export function replayPlacements(level, placements) {
  const fail = (message) => ({ ok: false, message, allLit: false, usedMovable: 0 });
  if (!Array.isArray(placements) || placements.length < 1) return fail('un jeu de placements est une liste non vide');
  const [cols, rows] = level.size;
  const fixedPieces = [];
  const stock = new Map(); // « type » ou « filter:mask » -> nombre de pièces mobiles
  const taken = new Set();
  for (const p of level.pieces) {
    if (MOVABLE_TYPES.includes(p.type) && p.fixed !== true) {
      const k = p.type === 'filter' ? 'filter:' + p.mask : p.type;
      stock.set(k, (stock.get(k) || 0) + 1);
    } else {
      fixedPieces.push(p);
      taken.add(p.at[0] + ',' + p.at[1]);
    }
  }
  if (placements.length > MAX_MOVABLE) return fail('trop de placements');
  const placed = [];
  const used = new Set();
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    if (!isObject(p)) return fail(`placement ${i} : doit être un objet`);
    const type = own(p, 'type');
    if (typeof type !== 'string' || !hasOwn(PLACEMENT_KEYS, type)) return fail(`placement ${i} : type inconnu`);
    for (const k of Object.keys(p)) if (!PLACEMENT_KEYS[type].includes(k)) return fail(`placement ${i} : clé inconnue « ${k} »`);
    const at = own(p, 'at');
    if (!isAt(at) || at[0] < 0 || at[1] < 0 || at[0] >= cols || at[1] >= rows) return fail(`placement ${i} : case hors du plateau`);
    const cell = at[0] + ',' + at[1];
    if (taken.has(cell) || used.has(cell)) return fail(`placement ${i} : case (${cell}) occupée`);
    used.add(cell);
    if (type === 'mirror' || type === 'splitter') {
      const o = own(p, 'o');
      if (typeof o !== 'string' || orientFromChar(o) < 0) return fail(`placement ${i} : orientation invalide`);
    }
    if (type === 'filter') {
      const m = parseMask(own(p, 'mask'));
      if (m < 1 || m > 6) return fail(`placement ${i} : masque de filtre invalide`);
    }
    const k = type === 'filter' ? 'filter:' + p.mask : type;
    const left = stock.get(k) || 0;
    if (left < 1) return fail(`placement ${i} : plus de pièce « ${k} » dans l'inventaire`);
    stock.set(k, left - 1);
    placed.push(type === 'prism' ? { type, at: [at[0], at[1]] } : type === 'filter' ? { type, at: [at[0], at[1]], mask: p.mask } : { type, at: [at[0], at[1]], o: p.o });
  }
  const t = trace(buildBoard(createState({ size: [cols, rows], pieces: fixedPieces.concat(placed) })));
  if (t.capped || !t.allLit) return { ok: false, message: 'le jeu de placements ne gagne pas', allLit: false, usedMovable: t.usedMovable };
  return { ok: true, message: '', allLit: true, usedMovable: t.usedMovable };
}

// ---------------------------------------------------------------------------------------------------------------
// Texte canonique (entrée du hachage de la preuve : « size + pieces canoniques », hors `par` et `solutions`, F1)

function canonicalPiece(p) {
  const at = [p.at[0], p.at[1]];
  switch (p.type) {
    case 'emitter': return { type: 'emitter', at, dir: p.dir, mask: p.mask };
    case 'target': return { type: 'target', at, need: p.need };
    case 'mirror': case 'splitter': return p.fixed === true ? { type: p.type, at, o: p.o, fixed: true } : { type: p.type, at, o: p.o };
    case 'prism': return p.fixed === true ? { type: 'prism', at, fixed: true } : { type: 'prism', at };
    case 'filter': return p.fixed === true ? { type: 'filter', at, mask: p.mask, fixed: true } : { type: 'filter', at, mask: p.mask };
    case 'portal': return { type: 'portal', at, pair: p.pair };
    case 'gate': return { type: 'gate', at, link: [p.link[0], p.link[1]] };
    default: return { type: 'wall', at };
  }
}

/** Texte à hacher en sha256 pour la preuve (V14) : taille et pièces dans l'ordre (ligne, colonne), clés dans un ordre fixe. Niveau valide requis. */
export function canonicalLevelText(level) {
  const pieces = level.pieces.slice().sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0]).map(canonicalPiece);
  return JSON.stringify({ size: [level.size[0], level.size[1]], pieces });
}

/**
 * V14 : contrôle un fichier de preuve (S6) contre un niveau livré valide.
 * @param {object} level  niveau valide, avec `par`
 * @param {unknown} proof  contenu du fichier `levels/proofs/<id>.proof.json`
 * @param {string} levelHashHex  sha256 (hexadécimal minuscule) de `canonicalLevelText(level)`, calculé par l'appelant
 * @returns {{ok:boolean, errors:Array<{code:string, rule:string, path:string, message:string}>}}
 */
export function validateProof(level, proof, levelHashHex) {
  const errors = [];
  const err = (path, message) => errors.push({ code: CODES.PROOF, rule: 'V14', path, message });
  if (!isObject(proof)) { err('', 'la preuve doit être un objet JSON'); return { ok: false, errors }; }
  for (const k of Object.keys(proof)) if (!PROOF_KEYS.includes(k)) err(k, `clé inconnue « ${k} »`);
  if (own(proof, 'format') !== 2) err('format', 'format doit valoir 2');
  if (own(proof, 'levelId') !== level.id) err('levelId', 'levelId différent de l\'id du niveau');
  if (own(proof, 'levelHash') !== 'sha256:' + levelHashHex) err('levelHash', 'le niveau a changé depuis la preuve (hachage différent)');
  if (own(proof, 'rulesVersion') !== RULES_VERSION) err('rulesVersion', `rulesVersion doit valoir ${RULES_VERSION}`);
  if (own(proof, 'solverVersion') !== SOLVER_VERSION) err('solverVersion', `solverVersion doit valoir ${SOLVER_VERSION}`);
  if (own(proof, 'status') !== 'proved-optimal') err('status', 'status doit valoir proved-optimal');
  const minimum = own(proof, 'minimum');
  if (!Number.isInteger(minimum) || minimum < 1) err('minimum', 'minimum doit être un entier ≥ 1');
  else if (minimum !== level.par) err('minimum', `minimum (${minimum}) différent de par (${level.par})`);
  if (errors.length === 0) {
    const witness = own(proof, 'witness');
    const parking = own(proof, 'parking');
    if (!Array.isArray(witness) || !Array.isArray(parking)) err('witness', 'witness et parking doivent être des listes');
    else {
      const r = replayPlacements(level, witness.concat(parking));
      if (!r.ok) err('witness', r.message);
      else if (r.usedMovable !== minimum) err('witness', `le rejeu utilise ${r.usedMovable} pièces, minimum vaut ${minimum}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------------------------------------------
// Index à chapitres (F3)

/** Codes d'erreur de l'index. */
export const INDEX_CODES = Object.freeze({
  FORMAT: 'I_FORMAT',
  CHAPTERS: 'I_CHAPTERS',
  CHAPTER: 'I_CHAPTER',
  LEVELS: 'I_LEVELS',
  ID: 'I_ID',
  DUPLICATE: 'I_DUPLICATE',
  UNKNOWN_KEY: 'I_UNKNOWN_KEY',
});

/**
 * Valide levels/index.json : `{"format":2,"chapters":[{"id":"miroirs","name":"Miroirs","levels":["m01-tourner", …]}, …]}`.
 * La liste de chapitres peut être vide (rien de livré encore) ; un chapitre a au moins un niveau ; un id de niveau
 * n'apparaît qu'une fois dans tout l'index ; un id de chapitre non plus.
 * @returns {{ok:boolean, errors:Array<{code:string,path:string,message:string}>, ids:string[], chapters:Array<{id:string,name:string,levels:string[]}>}}
 *   `ids` = tous les niveaux dans l'ordre de lecture ; `chapters` = copie propre (aucune clé de l'entrée).
 */
export function validateIndex(raw) {
  const errors = [];
  const err = (code, path, message) => errors.push({ code, path, message });
  const ids = [];
  const chapters = [];
  const fail = () => ({ ok: errors.length === 0, errors, ids: errors.length === 0 ? ids : [], chapters: errors.length === 0 ? chapters : [] });
  if (!isObject(raw)) {
    err(INDEX_CODES.FORMAT, '', 'l\'index doit être un objet JSON');
    return fail();
  }
  for (const k of Object.keys(raw)) {
    if (k !== 'format' && k !== 'chapters') err(INDEX_CODES.UNKNOWN_KEY, k, `clé inconnue « ${k} »`);
  }
  if (own(raw, 'format') !== 2) err(INDEX_CODES.FORMAT, 'format', 'format doit valoir 2');
  const list = own(raw, 'chapters');
  if (!Array.isArray(list)) {
    err(INDEX_CODES.CHAPTERS, 'chapters', 'chapters doit être une liste');
    return fail();
  }
  const seenLevels = new Set();
  const seenChapters = new Set();
  list.forEach((ch, i) => {
    const where = `chapters[${i}]`;
    if (!isObject(ch)) { err(INDEX_CODES.CHAPTER, where, 'un chapitre doit être un objet'); return; }
    for (const k of Object.keys(ch)) {
      if (k !== 'id' && k !== 'name' && k !== 'levels') err(INDEX_CODES.UNKNOWN_KEY, `${where}.${k}`, `clé inconnue « ${k} »`);
    }
    const cid = own(ch, 'id');
    const cname = own(ch, 'name');
    const clevels = own(ch, 'levels');
    if (typeof cid !== 'string' || !ID_PATTERN.test(cid)) err(INDEX_CODES.ID, `${where}.id`, 'id de chapitre invalide');
    else if (seenChapters.has(cid)) err(INDEX_CODES.DUPLICATE, `${where}.id`, `chapitre « ${cid} » en double`);
    else seenChapters.add(cid);
    if (typeof cname !== 'string' || cname.length < 1 || cname.length > MAX_NAME_SHIPPED) err(INDEX_CODES.CHAPTER, `${where}.name`, `name : 1 à ${MAX_NAME_SHIPPED} caractères`);
    const mine = [];
    if (!Array.isArray(clevels) || clevels.length === 0) {
      err(INDEX_CODES.LEVELS, `${where}.levels`, 'levels doit être une liste non vide');
    } else {
      clevels.forEach((lid, j) => {
        if (typeof lid !== 'string' || !ID_PATTERN.test(lid)) err(INDEX_CODES.ID, `${where}.levels[${j}]`, 'id invalide');
        else if (seenLevels.has(lid)) err(INDEX_CODES.DUPLICATE, `${where}.levels[${j}]`, `id « ${lid} » en double`);
        else { seenLevels.add(lid); mine.push(lid); ids.push(lid); }
      });
    }
    chapters.push({ id: typeof cid === 'string' ? cid : '', name: typeof cname === 'string' ? cname : '', levels: mine });
  });
  return fail();
}
