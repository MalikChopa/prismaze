// Lien de partage (ARCHITECTURE_V2 F4 et F5) : un niveau tient dans le fragment d'URL `#l=1.<charge>`.
// Module pur. Charge = flux de bits (MSB d'abord) en base64url sans remplissage :
//   version(4) colonnes-3(4) lignes-3(3) longueurNom(5) nombrePièces(7) | nom : 6 bits par signe (table T) |
//   pièces triées par (ligne, colonne) : colonne(4) ligne(4) type(4) + paramètres | CRC-16/CCITT(16) | zéros jusqu'au caractère plein.
// Entrée hostile (F5) : aucune clé d'objet ne vient de l'entrée (objets littéraux à champs fixes), ni JSON.parse, ni eval ;
// bornes, ordre strictement croissant, somme de contrôle, remplissage nul, rien après le CRC. La forme est canonique :
// pour toute chaîne `s` acceptée, `encodeLevel(decodeShare(s)) === s` (testé par le fuzz, tests/fuzz/).
import { DIR_CHARS, ORIENT_CHARS } from './dirs.js';
import { maskFromLetters, maskToLetters } from './colors.js';
import { NAME_TABLE, MAX_NAME_SHARED, MAX_COLS, MAX_ROWS, MAX_PIECES, SHARED_ID, validateLevel } from './level.js';

/** Longueur maximale du code `1.<charge>` (limite dure de F4 / F5), contrôlée avant toute lecture. */
export const MAX_CODE_LENGTH = 320;
/** Préfixe du fragment d'URL. */
export const FRAGMENT_PREFIX = '#l=';

/** Erreur de codec : `code` parmi LENGTH, PREFIX, NEWER, ALPHABET, FORMAT, BOUNDS, ORDER, TYPE, MASK, LINK, CRC, PADDING, TRAILING, ENCODE. */
export class ShareError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ShareError';
    this.code = code;
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
// Valeur d'un caractère base64url ; -1 hors alphabet (tableau indexé par code de caractère < 128)
const B64_VALUE = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64_VALUE[B64.charCodeAt(i)] = i;
// Indice 0 = inutilisé : un type 0 est refusé.
const TYPES = [null, 'emitter', 'wall', 'target', 'mirror', 'splitter', 'prism', 'filter', 'portal', 'gate'];
const TYPE_INDEX = new Map(TYPES.map((t, i) => [t, i]));

/** CRC-16/CCITT (polynôme 0x1021, départ 0xFFFF) d'une suite de bits (octets non nécessaires). */
function crc16(bits, n) {
  let crc = 0xffff;
  for (let i = 0; i < n; i++) {
    const top = ((crc >> 15) & 1) ^ bits[i];
    crc = (crc << 1) & 0xffff;
    if (top) crc ^= 0x1021;
  }
  return crc;
}

// ---------------------------------------------------------------------------------------------------------------
// Encodage

class BitWriter {
  constructor() { this.bits = []; }
  /** Écrit `v` sur `n` bits ; une valeur non entière ou hors de [0, 2^n) est une erreur d'encodage. */
  put(v, n) {
    if (!Number.isInteger(v) || v < 0 || v >= 2 ** n) throw new ShareError('ENCODE', 'valeur non représentable');
    for (let i = n - 1; i >= 0; i--) this.bits.push((v >> i) & 1);
  }
}

const bySort = (a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0];

function asAt(p) {
  const at = p === null || typeof p !== 'object' ? undefined : p.at;
  if (!Array.isArray(at) || at.length !== 2) throw new ShareError('ENCODE', 'case invalide');
  return at;
}

function maskBits(letters) {
  const m = maskFromLetters(letters);
  if (m < 1) throw new ShareError('ENCODE', 'masque invalide');
  return m;
}

/**
 * Encode un niveau (format 2) en code `1.<charge>`. Lève ShareError('ENCODE') si le niveau n'est pas représentable
 * (nom hors table T ou trop long, taille, case, type, masque, lien de porte, deux pièces dans une case…).
 * N'écrit ni `id`, ni `par`, ni `solutions`. Les pièces sont triées par (ligne, colonne) ; le nom doit être déjà
 * normalisé (NFC puis minuscules, `normalizeName` de level.js) : aucune normalisation silencieuse.
 * @param {{name?:string, size:[number,number], pieces:object[]}} level
 * @returns {string}
 */
export function encodeLevel(level) {
  if (level === null || typeof level !== 'object' || !Array.isArray(level.size) || !Array.isArray(level.pieces)) throw new ShareError('ENCODE', 'niveau invalide');
  const [cols, rows] = level.size;
  const name = level.name === undefined ? '' : level.name;
  if (typeof name !== 'string' || name.length > MAX_NAME_SHARED) throw new ShareError('ENCODE', 'nom invalide');
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 3 || rows < 3 || cols > MAX_COLS || rows > MAX_ROWS) throw new ShareError('ENCODE', 'taille invalide');
  if (level.pieces.length > MAX_PIECES) throw new ShareError('ENCODE', 'trop de pièces');
  const w = new BitWriter();
  w.put(1, 4); w.put(cols - 3, 4); w.put(rows - 3, 3); w.put(name.length, 5); w.put(level.pieces.length, 7);
  for (let i = 0; i < name.length; i++) {
    const k = NAME_TABLE.indexOf(name[i]);
    if (k < 0) throw new ShareError('ENCODE', 'signe de nom interdit');
    w.put(k, 6);
  }
  for (const p of level.pieces) asAt(p);
  const ps = level.pieces.slice().sort(bySort);
  const targets = ps.filter((p) => p.type === 'target');
  let prev = -1;
  for (const p of ps) {
    const [c, r] = p.at;
    if (!Number.isInteger(c) || !Number.isInteger(r) || c < 0 || r < 0 || c >= cols || r >= rows) throw new ShareError('ENCODE', 'case hors du plateau');
    if (r * 16 + c <= prev) throw new ShareError('ENCODE', 'deux pièces dans une case');
    prev = r * 16 + c;
    const t = typeof p.type === 'string' ? TYPE_INDEX.get(p.type) : undefined;
    if (t === undefined || t === 0) throw new ShareError('ENCODE', 'type inconnu');
    w.put(c, 4); w.put(r, 4); w.put(t, 4);
    switch (p.type) {
      case 'emitter': w.put(DIR_CHARS.indexOf(p.dir), 2); w.put(maskBits(p.mask), 3); break;
      case 'target': w.put(maskBits(p.need), 3); break;
      case 'mirror': case 'splitter': w.put(ORIENT_CHARS.indexOf(p.o), 2); w.put(p.fixed === true ? 1 : 0, 1); break;
      case 'prism': w.put(p.fixed === true ? 1 : 0, 1); break;
      case 'filter': {
        const m = maskBits(p.mask);
        if (m === 7) throw new ShareError('ENCODE', 'masque de filtre invalide');
        w.put(m, 3); w.put(p.fixed === true ? 1 : 0, 1);
        break;
      }
      case 'portal': w.put(p.pair, 2); break;
      case 'gate': {
        const link = p.link;
        const rank = Array.isArray(link) ? targets.findIndex((q) => q.at[0] === link[0] && q.at[1] === link[1]) : -1;
        if (rank < 0) throw new ShareError('ENCODE', 'lien de porte sans cible');
        w.put(rank, 6);
        break;
      }
      default: break;
    }
  }
  w.put(crc16(w.bits, w.bits.length), 16);
  while (w.bits.length % 6 !== 0) w.bits.push(0);
  let s = '';
  for (let i = 0; i < w.bits.length; i += 6) {
    s += B64[(w.bits[i] << 5) | (w.bits[i + 1] << 4) | (w.bits[i + 2] << 3) | (w.bits[i + 3] << 2) | (w.bits[i + 4] << 1) | w.bits[i + 5]];
  }
  return '1.' + s;
}

// ---------------------------------------------------------------------------------------------------------------
// Décodage

/**
 * Décode un code `1.<charge>` en niveau (format 2, id synthétique « partage »). Ne valide PAS les règles de jeu
 * (nombre d'émetteurs, case libre, état gagnant… : `validateLevel` en mode `shared`, ou `parseShareCode`).
 * Lève ShareError (jamais une autre exception) pour toute entrée invalide, quelle qu'elle soit.
 * @param {unknown} str
 * @returns {{format:2, id:string, name:string, size:[number,number], pieces:object[]}}
 */
export function decodeShare(str) {
  if (typeof str !== 'string' || str.length > MAX_CODE_LENGTH || str.length < 4) throw new ShareError('LENGTH', 'longueur');
  if (str.charCodeAt(1) !== 46 /* . */ || str.charCodeAt(0) !== 49 /* 1 */) {
    // « 2. », « 17. »… : un lien d'une version plus récente ; tout autre préfixe : lien invalide
    const m = /^([0-9]{1,9})\./.exec(str);
    if (m !== null && Number(m[1]) >= 2) throw new ShareError('NEWER', 'version plus récente');
    throw new ShareError('PREFIX', 'préfixe');
  }
  const n6 = str.length - 2;
  const bits = new Uint8Array(n6 * 6);
  for (let i = 0; i < n6; i++) {
    const code = str.charCodeAt(i + 2);
    const k = code < 128 ? B64_VALUE[code] : -1;
    if (k < 0) throw new ShareError('ALPHABET', 'caractère');
    for (let b = 0; b < 6; b++) bits[i * 6 + b] = (k >> (5 - b)) & 1;
  }
  let pos = 0;
  const get = (n) => {
    if (pos + n > bits.length) throw new ShareError('FORMAT', 'fin de données');
    let v = 0;
    for (let k = 0; k < n; k++) v = (v << 1) | bits[pos++];
    return v;
  };
  if (get(4) !== 1) throw new ShareError('FORMAT', 'version interne');
  const cols = get(4) + 3, rows = get(3) + 3;
  if (cols > MAX_COLS || rows > MAX_ROWS) throw new ShareError('BOUNDS', 'taille');
  const nameLen = get(5), n = get(7);
  if (nameLen > MAX_NAME_SHARED || n > MAX_PIECES) throw new ShareError('BOUNDS', 'compte');
  let name = '';
  for (let i = 0; i < nameLen; i++) {
    const k = get(6);
    if (k >= NAME_TABLE.length) throw new ShareError('FORMAT', 'nom');
    name += NAME_TABLE[k];
  }
  const pieces = [];
  const gateRanks = [];
  let prev = -1, nTargets = 0;
  for (let i = 0; i < n; i++) {
    const c = get(4), r = get(4), t = get(4);
    if (c >= cols || r >= rows) throw new ShareError('BOUNDS', 'hors plateau');
    const key = r * 16 + c;
    if (key <= prev) throw new ShareError('ORDER', 'ordre ou doublon');
    prev = key;
    const type = t < TYPES.length ? TYPES[t] : null;
    if (type === null) throw new ShareError('TYPE', 'type');
    const at = [c, r];
    switch (type) {
      case 'emitter': {
        const dir = get(2), mask = get(3);
        if (mask === 0) throw new ShareError('MASK', 'masque');
        pieces.push({ type, at, dir: DIR_CHARS[dir], mask: maskToLetters(mask) });
        break;
      }
      case 'target': {
        const need = get(3);
        if (need === 0) throw new ShareError('MASK', 'masque');
        nTargets++;
        pieces.push({ type, at, need: maskToLetters(need) });
        break;
      }
      case 'mirror': case 'splitter': {
        const o = get(2), fixed = get(1) === 1;
        pieces.push(fixed ? { type, at, o: ORIENT_CHARS[o], fixed: true } : { type, at, o: ORIENT_CHARS[o] });
        break;
      }
      case 'prism': pieces.push(get(1) === 1 ? { type, at, fixed: true } : { type, at }); break;
      case 'filter': {
        const mask = get(3), fixed = get(1) === 1;
        if (mask === 0 || mask === 7) throw new ShareError('MASK', 'masque');
        pieces.push(fixed ? { type, at, mask: maskToLetters(mask), fixed: true } : { type, at, mask: maskToLetters(mask) });
        break;
      }
      case 'portal': pieces.push({ type, at, pair: get(2) }); break;
      case 'gate': gateRanks.push(get(6)); pieces.push({ type, at, link: null }); break;
      default: pieces.push({ type, at }); break; // wall
    }
  }
  const bodyBits = pos;
  const crc = get(16);
  if (crc !== crc16(bits, bodyBits)) throw new ShareError('CRC', 'somme de contrôle');
  for (let k = pos; k < bits.length; k++) if (bits[k] !== 0) throw new ShareError('PADDING', 'remplissage');
  if (bits.length - pos >= 6) throw new ShareError('TRAILING', 'caractères en trop');
  if (nTargets > 0 || gateRanks.length > 0) {
    const targets = pieces.filter((p) => p.type === 'target');
    let g = 0;
    for (const p of pieces) {
      if (p.type !== 'gate') continue;
      const rank = gateRanks[g++];
      if (rank >= targets.length) throw new ShareError('LINK', 'lien');
      p.link = [targets[rank].at[0], targets[rank].at[1]];
    }
  }
  return { format: 2, id: SHARED_ID, name, size: [cols, rows], pieces };
}

// ---------------------------------------------------------------------------------------------------------------
// Fragment d'URL et validation complète

/** Fragment d'URL d'un niveau : `#l=1.<charge>`. */
export function shareFragment(level) {
  return FRAGMENT_PREFIX + encodeLevel(level);
}

/**
 * Extrait le code d'un fragment d'URL (`location.hash`). Renvoie null si le fragment n'est pas un lien de partage ou
 * si sa longueur dépasse la limite (sans le lire plus loin).
 */
export function codeFromFragment(hash) {
  if (typeof hash !== 'string' || hash.length > FRAGMENT_PREFIX.length + MAX_CODE_LENGTH) return null;
  if (!hash.startsWith(FRAGMENT_PREFIX)) return null;
  return hash.slice(FRAGMENT_PREFIX.length);
}

/**
 * Décode puis valide complètement (mode `shared` de validateLevel) un code de partage. Ne lève jamais d'exception.
 * @returns {{ok:true, level:object, errors:[]}|{ok:false, reason:'invalid'|'newer'|'rules', level:null, errors:Array}}
 *   `invalid` = « lien invalide » (aucun détail à montrer), `newer` = « lien d'une version plus récente »,
 *   `rules` = bien codé mais le niveau enfreint une règle de F2 (`errors` en donne les codes).
 */
export function parseShareCode(code) {
  let level;
  try {
    level = decodeShare(code);
  } catch (e) {
    if (e instanceof ShareError) return { ok: false, reason: e.code === 'NEWER' ? 'newer' : 'invalid', level: null, errors: [] };
    return { ok: false, reason: 'invalid', level: null, errors: [] };
  }
  const v = validateLevel(level, { mode: 'shared' });
  return v.ok ? { ok: true, level: v.level, errors: [] } : { ok: false, reason: 'rules', level: null, errors: v.errors };
}
