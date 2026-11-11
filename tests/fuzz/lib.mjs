// Aides du fuzz du codec de partage (F4/F5). Ce fichier n'est pas un test.
// Réécriture INDÉPENDANTE du format F4 (champs [valeur, largeur] écrits à la main, CRC-16/CCITT propre) : elle sert à la
// fois d'encodeur de référence (comparé à src/engine/share.js) et de fabrique de chaînes hostiles dont la somme de
// contrôle est JUSTE (sinon presque tout est rejeté par le CRC et les contrôles de structure ne sont jamais atteints).
import { makeRng } from '../engine-crosscheck/rng.mjs';
import { NAME_TABLE } from '../../src/engine/level.js';

export { makeRng };
export const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export const MAX_CHARS = 320;
const TYPE_NUM = { emitter: 1, wall: 2, target: 3, mirror: 4, splitter: 5, prism: 6, filter: 7, portal: 8, gate: 9 };
const DIRS = ['E', 'N', 'W', 'S'];
const ORIENTS = ['-', '/', '|', '\\'];
const MASK = (s) => (s.includes('R') ? 1 : 0) | (s.includes('G') ? 2 : 0) | (s.includes('B') ? 4 : 0);

/** CRC-16/CCITT (0x1021, départ 0xFFFF), bit par bit. */
export function crc16(bits) {
  let crc = 0xffff;
  for (const b of bits) { const top = ((crc >> 15) & 1) ^ b; crc = (crc << 1) & 0xffff; if (top) crc ^= 0x1021; }
  return crc;
}

/** Champs [valeur, largeur] -> suite de bits (MSB d'abord). */
export function bitsOf(fields) {
  const bits = [];
  for (const [v, n] of fields) for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1);
  return bits;
}

/** Bits -> `1.<base64url>` (remplissage de zéros jusqu'au caractère plein). */
export function codeOfBits(bitsIn, padOnes = false) {
  const bits = bitsIn.slice();
  while (bits.length % 6) bits.push(padOnes ? 1 : 0);
  let s = '1.';
  for (let i = 0; i < bits.length; i += 6) s += B64[(bits[i] << 5) | (bits[i + 1] << 4) | (bits[i + 2] << 3) | (bits[i + 3] << 2) | (bits[i + 4] << 1) | bits[i + 5]];
  return s;
}

/** Champs -> code avec un CRC juste après les champs. Renvoie aussi le nombre de bits du corps. */
export function codeOfFields(fields, opts = {}) {
  const body = bitsOf(fields);
  const crc = crc16(body);
  const bits = body.concat(bitsOf([[opts.badCrc ? (crc ^ 1) : crc, 16]]));
  return { code: codeOfBits(bits, opts.padOnes), bodyBits: body.length, fields };
}

/** Champs F4 d'un niveau (format 2) : réécriture de référence. */
export function fieldsOfLevel(level) {
  const f = [[1, 4], [level.size[0] - 3, 4], [level.size[1] - 3, 3], [level.name.length, 5], [level.pieces.length, 7]];
  for (const ch of level.name) f.push([NAME_TABLE.indexOf(ch), 6]);
  const ps = level.pieces.slice().sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0]);
  const targets = ps.filter((p) => p.type === 'target');
  for (const p of ps) {
    f.push([p.at[0], 4], [p.at[1], 4], [TYPE_NUM[p.type], 4]);
    if (p.type === 'emitter') f.push([DIRS.indexOf(p.dir), 2], [MASK(p.mask), 3]);
    else if (p.type === 'target') f.push([MASK(p.need), 3]);
    else if (p.type === 'mirror' || p.type === 'splitter') f.push([ORIENTS.indexOf(p.o), 2], [p.fixed ? 1 : 0, 1]);
    else if (p.type === 'prism') f.push([p.fixed ? 1 : 0, 1]);
    else if (p.type === 'filter') f.push([MASK(p.mask), 3], [p.fixed ? 1 : 0, 1]);
    else if (p.type === 'portal') f.push([p.pair, 2]);
    else if (p.type === 'gate') f.push([targets.findIndex((t) => t.at[0] === p.link[0] && t.at[1] === p.link[1]), 6]);
  }
  return f;
}

export const refEncode = (level) => codeOfFields(fieldsOfLevel(level)).code;

const LETTERS = ['R', 'G', 'RG', 'B', 'RB', 'GB', 'RGB']; // masques 1..7 dans l'ordre RGB

/**
 * Niveau aléatoire BIEN CODABLE (pas forcément jouable) : taille, nom de la table T, pièces de tous les types.
 * Profils 'small' (jusqu'à ~20 pièces) et 'big' (12x10, jusqu'à ~60 pièces).
 */
export function randomLevel(rng, profile = 'small') {
  const big = profile === 'big';
  const cols = big ? 10 + rng.int(3) : 3 + rng.int(10), rows = big ? 8 + rng.int(3) : 3 + rng.int(8);
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c, r]);
  for (let i = cells.length - 1; i > 0; i--) { const j = rng.int(i + 1); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  const nPieces = Math.min(cells.length, big ? 25 + rng.int(40) : 1 + rng.int(20));
  const name = Array.from({ length: rng.int(25) }, () => NAME_TABLE[rng.int(NAME_TABLE.length)]).join('');
  const pieces = [];
  const types = ['emitter', 'wall', 'wall', 'target', 'mirror', 'mirror', 'splitter', 'prism', 'filter', 'portal', 'gate'];
  for (let i = 0; i < nPieces; i++) {
    const type = types[rng.int(types.length)], at = cells[i];
    const fixed = rng.int(3) === 0;
    if (type === 'emitter') pieces.push({ type, at, dir: DIRS[rng.int(4)], mask: LETTERS[rng.int(7)] });
    else if (type === 'target') pieces.push({ type, at, need: LETTERS[rng.int(7)] });
    else if (type === 'mirror' || type === 'splitter') pieces.push(fixed ? { type, at, o: ORIENTS[rng.int(4)], fixed: true } : { type, at, o: ORIENTS[rng.int(4)] });
    else if (type === 'prism') pieces.push(fixed ? { type, at, fixed: true } : { type, at });
    else if (type === 'filter') pieces.push(fixed ? { type, at, mask: LETTERS[rng.int(6)], fixed: true } : { type, at, mask: LETTERS[rng.int(6)] });
    else if (type === 'portal') pieces.push({ type, at, pair: rng.int(4) });
    else if (type === 'gate') pieces.push({ type, at, link: null });
    else pieces.push({ type, at });
  }
  const targets = pieces.filter((p) => p.type === 'target');
  // une porte sans cible possible est remplacée par un mur (le lien doit désigner une cible)
  for (const p of pieces) if (p.type === 'gate') { if (targets.length) p.link = targets[rng.int(targets.length)].at.slice(); else { p.type = 'wall'; delete p.link; } }
  return { format: 2, id: 'partage', name, size: [cols, rows], pieces };
}

/**
 * Flux hostile à CRC juste : en-tête et pièces tirés au hasard (valeurs plausibles ou non), compte annoncé parfois
 * différent du compte écrit, remplissage parfois non nul, caractères en trop parfois.
 */
export function randomHostileFields(rng) {
  const f = [[rng.int(8) === 0 ? rng.int(16) : 1, 4], [rng.int(16), 4], [rng.int(8), 3]];
  const nameLen = rng.int(4) === 0 ? rng.int(32) : rng.int(8);
  const n = rng.int(6) === 0 ? rng.int(128) : rng.int(12);
  f.push([nameLen, 5], [n, 7]);
  for (let i = 0; i < nameLen; i++) f.push([rng.int(64), 6]);
  const written = rng.int(10) === 0 ? Math.max(0, n - 1 - rng.int(3)) : n;
  let key = -1;
  for (let i = 0; i < written; i++) {
    const r = Math.min(15, Math.max(0, (key >> 4) + (rng.int(4) === 0 ? 0 : rng.int(2))));
    const c = rng.int(3) === 0 ? rng.int(16) : rng.int(8);
    const t = rng.int(8) === 0 ? rng.int(16) : 1 + rng.int(9);
    key = r * 16 + c;
    f.push([c, 4], [r, 4], [t, 4]);
    if (t === 1) f.push([rng.int(4), 2], [rng.int(8), 3]);
    else if (t === 3) f.push([rng.int(8), 3]);
    else if (t === 4 || t === 5) f.push([rng.int(4), 2], [rng.int(2), 1]);
    else if (t === 6) f.push([rng.int(2), 1]);
    else if (t === 7) f.push([rng.int(8), 3], [rng.int(2), 1]);
    else if (t === 8) f.push([rng.int(4), 2]);
    else if (t === 9) f.push([rng.int(12), 6]);
  }
  return f;
}

/** Remplace une valeur de champ d'un niveau valide puis recalcule le CRC (mutation « à CRC juste »). */
export function perturbFields(rng, fields) {
  const g = fields.map((x) => x.slice());
  const k = rng.int(g.length), [, w] = g[k];
  g[k][0] = rng.int(2 ** w);
  if (rng.int(5) === 0 && g.length > 6) { // en retire un ou deux champs voisins (flux décalé)
    g.splice(rng.int(g.length), 1 + rng.int(2));
  }
  return g;
}
