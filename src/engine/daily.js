// Défi du jour (ARCHITECTURE_V2 F7 : Q1 à Q9) et générateur « témoin planté » (Q3). Module PUR : même entrée, même sortie, sur toute machine
// (entiers seulement : Math.imul, >>> 0 ; aucune horloge, aucun aléa de la plateforme).
// Le niveau d'une date est une fonction pure de (date, version) : Q2 à Q5, moteur (E) et solveur (S2, statut, comptage de nœuds) sont gelés par la
// version `vN` du préfixe de graine (Q9). Tout changement qui modifie une empreinte d'or (tests/daily/golden.json) impose une version de plus.
// Le repli (7 niveaux prouvés hors ligne, levels/daily-pool/) est lu par l'interface : ce module dit seulement QUAND il faut s'en servir.
import { createBoard, setCell, finalize, EMPTY } from './board.js';
import { trace } from './trace.js';
import { maskToLetters } from './colors.js';
import { ORIENT_CHARS, DIR_CHARS } from './dirs.js';
import { solve } from './solver.js';
import { encodeLevel } from './share.js';

// ---------------------------------------------------------------------------------------------------------------
// Nombres pseudo-aléatoires (Q2) : fnv1a32, splitmix32, sfc32 modifié ; maison, identique sur toute machine.

export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export function makeRng(seed32) {
  let s = seed32 | 0;
  const sm = () => { s = (s + 0x9e3779b9) | 0; let t = s ^ (s >>> 16); t = Math.imul(t, 0x21f0aaad); t ^= t >>> 15; t = Math.imul(t, 0x735a2d97); return (t ^ (t >>> 15)) >>> 0; };
  let a = sm(), b = sm(), c = sm(), d = sm();
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) next();
  const rng = { u32: next, int: (n) => Math.floor(next() * n / 4294967296) };
  rng.pick = (list) => list[rng.int(list.length)];
  return rng;
}

// ---------------------------------------------------------------------------------------------------------------
// Génération « témoin planté » (Q3)

const isRot = (t) => t === 'mirror' || t === 'splitter';
const sig = (b, cell) => b.inM[cell * 4] | (b.inM[cell * 4 + 1] << 3) | (b.inM[cell * 4 + 2] << 6) | (b.inM[cell * 4 + 3] << 9);
const lightOf = (b, cell) => b.inM[cell * 4] | b.inM[cell * 4 + 1] | b.inM[cell * 4 + 2] | b.inM[cell * 4 + 3];

// Évalue une liste de pièces (forme d'état) : plateau tracé et résumé. Le plateau est jetable.
function evaluate(cols, rows, pieces) {
  const list = pieces.map((p, id) => ({ id, o: 0, dir: 0, mask: 0, need: 0, pair: 0, link: null, fixed: false, ...p }));
  const b = createBoard(cols, rows, list.length);
  list.forEach((p, id) => setCell(b, id, p));
  finalize(b, list);
  const res = trace(b);
  return { b, res };
}

/**
 * Une tentative de génération (Q3, ordre des tirages normatif) : renvoie {pieces, planted} ou null (l'essai interne échoue).
 * `pieces` = pièces de la forme d'état, pièces mobiles à leur position DISPERSÉE.
 */
function tryPlant(rng, P) {
  const { cols, rows } = P;
  const statics = [];
  const occ = new Set();
  const cellOf = (p) => p.r * cols + p.c;
  const freeList = () => { const f = []; for (let i = 0; i < cols * rows; i++) if (!occ.has(i)) f.push(i); return f; };
  const put = (list, p) => { list.push(p); occ.add(cellOf(p)); };
  // 1. émetteurs sur le bord, tournés vers l'intérieur
  for (const mask of P.emitters) {
    const side = rng.int(4);
    let c, r, dir;
    if (side === 0) { c = 0; r = rng.int(rows); dir = 0; } else if (side === 1) { c = cols - 1; r = rng.int(rows); dir = 2; } else if (side === 2) { c = rng.int(cols); r = rows - 1; dir = 1; } else { c = rng.int(cols); r = 0; dir = 3; }
    if (occ.has(r * cols + c)) return null;
    put(statics, { type: 'emitter', c, r, dir, mask });
  }
  // 2. portails
  for (let i = 0; i < P.portalPairs; i++) {
    for (let k = 0; k < 2; k++) { const cell = rng.pick(freeList()); put(statics, { type: 'portal', c: cell % cols, r: (cell / cols) | 0, pair: i }); }
  }
  // 3. pièces mobiles posées sur la lumière, dans l'ordre du profil
  const planted = [];
  const asPieces = (list) => list.map((p) => ({ ...p, fixed: false }));
  for (const inv of P.inv) {
    let ok = false;
    for (let k = 0; k < 40 && !ok; k++) {
      const { b } = evaluate(cols, rows, statics.concat(asPieces(planted)));
      const lit = [];
      for (let cell = 0; cell < cols * rows; cell++) if (b.kind[cell] === EMPTY && lightOf(b, cell) !== 0) lit.push(cell);
      if (lit.length === 0) return null;
      const cell = rng.pick(lit);
      const cand = { type: inv.type, mask: inv.mask ?? 0, c: cell % cols, r: (cell / cols) | 0, o: isRot(inv.type) ? rng.int(4) : 0 };
      const { b: b2, res } = evaluate(cols, rows, statics.concat(asPieces(planted.concat([cand]))));
      const id = statics.length + planted.length;
      if (b2.used[id] === 1 && res.steps > 0) { planted.push(cand); ok = true; }
    }
    if (!ok) return null;
  }
  // 4. cibles : cases éclairées dans l'état final, mais pas avant la pièce j (donc les pièces servent)
  const finalEval = evaluate(cols, rows, statics.concat(asPieces(planted)));
  const b = finalEval.b;
  const stage = [];
  for (let i = 0; i <= planted.length; i++) {
    const e = evaluate(cols, rows, statics.concat(asPieces(planted.slice(0, i)))).b;
    const s = new Uint16Array(cols * rows);
    for (let cell = 0; cell < cols * rows; cell++) s[cell] = sig(e, cell);
    stage.push(s);
  }
  const K = planted.length;
  const nT = P.targets[0] + rng.int(P.targets[1] - P.targets[0] + 1);
  const targets = [];
  const taken = new Set();
  for (let i = 0; i < nT; i++) {
    const half = Math.max(1, Math.ceil(K / 2));
    const j = i === 0 ? K : half + rng.int(K - Math.ceil(K / 2) + 1);
    const cand = [];
    for (let cell = 0; cell < cols * rows; cell++) {
      if (b.kind[cell] === EMPTY && !taken.has(cell) && lightOf(b, cell) !== 0 && stage[Math.max(0, j - 1)][cell] !== sig(b, cell)) cand.push(cell);
    }
    if (cand.length === 0) { if (i === 0) return null; continue; }
    const cell = rng.pick(cand);
    taken.add(cell);
    targets.push({ type: 'target', c: cell % cols, r: (cell / cols) | 0, need: lightOf(b, cell) });
  }
  let ev = evaluate(cols, rows, statics.concat(targets, asPieces(planted)));
  if (!ev.res.allLit) return null;
  // 5. portes : sur une case éclairée libre, liées à une cible ; gardées si tout reste allumable
  for (let g = 0; g < P.gates; g++) {
    const bb = ev.b;
    const cand = [];
    for (let cell = 0; cell < cols * rows; cell++) if (bb.kind[cell] === EMPTY && lightOf(bb, cell) !== 0) cand.push(cell);
    if (cand.length === 0) break;
    const cell = rng.pick(cand);
    const t = rng.pick(targets);
    const gate = { type: 'gate', c: cell % cols, r: (cell / cols) | 0, link: [t.c, t.r] };
    statics.push(gate);
    occ.add(cell);
    const ev2 = evaluate(cols, rows, statics.concat(targets, asPieces(planted)));
    if (!ev2.res.allLit) { statics.pop(); occ.delete(cell); } else ev = ev2;
  }
  // 6. murs sur des cases sombres
  const dark = [];
  for (let cell = 0; cell < cols * rows; cell++) if (ev.b.kind[cell] === EMPTY && lightOf(ev.b, cell) === 0) dark.push(cell);
  for (let i = 0; i < P.walls && dark.length > 0; i++) {
    const cell = dark.splice(rng.int(dark.length), 1)[0];
    statics.push({ type: 'wall', c: cell % cols, r: (cell / cols) | 0 });
    occ.add(cell);
  }
  if (!evaluate(cols, rows, statics.concat(targets, asPieces(planted))).res.allLit) return null;
  // 7. dispersion des pièces mobiles (les cases des pièces plantées sont libres de nouveau)
  const base = new Set(statics.concat(targets).map(cellOf));
  for (let tryS = 0; tryS < 20; tryS++) {
    const used = new Set(base);
    const placed = [];
    for (const inv of P.inv) {
      const f = [];
      for (let i = 0; i < cols * rows; i++) if (!used.has(i)) f.push(i);
      const cell = rng.pick(f);
      used.add(cell);
      placed.push({ type: inv.type, mask: inv.mask ?? 0, c: cell % cols, r: (cell / cols) | 0, o: isRot(inv.type) ? rng.int(4) : 0, fixed: false });
    }
    const pieces = statics.concat(targets, placed);
    if (!evaluate(cols, rows, pieces).res.allLit) return { pieces, planted: K };
  }
  return null;
}

/** Plante un niveau : jusqu'à 60 essais internes avec le même générateur (Q3). Renvoie {pieces, planted} ou null. */
export function plant(rng, P) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const r = tryPlant(rng, P);
    if (r !== null) return r;
  }
  return null;
}

/** Pièces de la forme d'état -> niveau JSON v2 (pièces triées par ligne puis colonne). */
export function toLevel(P, pieces, id, name) {
  const sorted = pieces.slice().sort((a, b) => a.r - b.r || a.c - b.c);
  const js = sorted.map((p) => {
    const at = [p.c, p.r];
    switch (p.type) {
      case 'emitter': return { type: 'emitter', at, dir: DIR_CHARS[p.dir], mask: maskToLetters(p.mask) };
      case 'target': return { type: 'target', at, need: maskToLetters(p.need) };
      case 'mirror': case 'splitter': return { type: p.type, at, o: ORIENT_CHARS[p.o] };
      case 'prism': return { type: 'prism', at };
      case 'filter': return { type: 'filter', at, mask: maskToLetters(p.mask) };
      case 'portal': return { type: 'portal', at, pair: p.pair };
      case 'gate': return { type: 'gate', at, link: [p.link[0], p.link[1]] };
      default: return { type: 'wall', at };
    }
  });
  return { format: 2, id, name, size: [P.cols, P.rows], pieces: js };
}

// ---------------------------------------------------------------------------------------------------------------
// Profils par jour de semaine UTC (Q4) ; 0 = dimanche. Un émetteur blanc ; inventaire dans l'ordre de pose (ordre des tirages de Q3).
// `mMin` : minimum exigé ; le minimum accepté est aussi au plus le nombre de pièces mobiles.

const W = 7;
const Mi = (n) => Array.from({ length: n }, () => ({ type: 'mirror' }));
const Fi = (mask) => ({ type: 'filter', mask });
const prof = (o) => Object.freeze({ emitters: [W], gates: 0, portalPairs: 0, ...o });

export const WEEKDAY = Object.freeze([
  /* dim */ prof({ cols: 10, rows: 8, inv: [...Mi(3), { type: 'prism' }, { type: 'splitter' }, Fi(6)], targets: [3, 4], walls: 8, gates: 1, mMin: 4 }),
  /* lun */ prof({ cols: 7, rows: 6, inv: Mi(3), targets: [1, 2], walls: 4, mMin: 2 }),
  /* mar */ prof({ cols: 8, rows: 6, inv: [...Mi(3), { type: 'prism' }], targets: [2, 3], walls: 5, mMin: 2 }),
  /* mer */ prof({ cols: 8, rows: 7, inv: [...Mi(3), { type: 'prism' }, Fi(3)], targets: [2, 3], walls: 6, mMin: 3 }),
  /* jeu */ prof({ cols: 9, rows: 7, inv: [...Mi(3), { type: 'splitter' }, { type: 'prism' }], targets: [2, 4], walls: 7, gates: 1, mMin: 3 }),
  /* ven */ prof({ cols: 10, rows: 8, inv: [...Mi(3), { type: 'prism' }, { type: 'splitter' }, Fi(5)], targets: [3, 4], walls: 8, mMin: 4 }),
  /* sam */ prof({ cols: 10, rows: 8, inv: [...Mi(3), { type: 'prism' }, { type: 'splitter' }, Fi(3)], targets: [3, 5], walls: 8, gates: 1, portalPairs: 1, mMin: 4 }),
]);

/** Q5 : plafonds en nœuds (jamais en millisecondes) : décision identique sur toute machine. */
export const DAILY_ATTEMPT_CAP = 600000; // par tentative
export const DAILY_CUMUL_CAP = 3000000; // cumulé sur la journée
export const DAILY_MAX_ATTEMPTS = 40; // tentatives e = 0..39

/** Q9 : table des versions ; la version d'une date est lue DANS la table, par la date (comparaison de textes AAAA-MM-JJ). */
export const DAILY_VERSIONS = Object.freeze([Object.freeze({ v: 1, from: '2026-11-08' })]);
/** Version du code publié : la plus grande de la table. */
export const CURRENT_DAILY_VERSION = DAILY_VERSIONS[DAILY_VERSIONS.length - 1].v;

// ---------------------------------------------------------------------------------------------------------------
// Dates UTC AAAA-MM-JJ en arithmétique entière (aucun objet date : ce module reste pur)

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const pad = (n, w) => String(n).padStart(w, '0');

/** true si `s` est une date AAAA-MM-JJ du calendrier grégorien (année 1970 à 2999). */
export function isValidDay(s) {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (m === null) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1970 || y > 2999 || mo < 1 || mo > 12) return false;
  return d >= 1 && d <= MONTH_DAYS[mo - 1] + (mo === 2 && isLeap(y) ? 1 : 0);
}

/** Jours depuis 1970-01-01 (algorithme « days from civil »). */
function daysFromYmd(y, m, d) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Date AAAA-MM-JJ à `days` jours de 1970-01-01. */
function ymdFromDays(days) {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** Date AAAA-MM-JJ + n jours (n entier, négatif permis). */
export function addDays(date, n) {
  const m = DATE_RE.exec(date);
  if (m === null) throw new RangeError('addDays : date invalide');
  return ymdFromDays(daysFromYmd(Number(m[1]), Number(m[2]), Number(m[3])) + n);
}

/** Jour de semaine UTC d'une date : 0 = dimanche (le 1970-01-01 était un jeudi). */
export function weekdayOf(date) {
  const m = DATE_RE.exec(date);
  if (m === null) throw new RangeError('weekdayOf : date invalide');
  const days = daysFromYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  return (((days + 4) % 7) + 7) % 7;
}

/** Q9 : numéro de version d'une date (la ligne de la table dont `from` est le plus grand sans dépasser la date ; avant la première : la première). */
export function dailyVersion(date) {
  let v = DAILY_VERSIONS[0].v;
  for (const row of DAILY_VERSIONS) if (row.from <= date) v = row.v;
  return v;
}

// ---------------------------------------------------------------------------------------------------------------
// Défi d'une date

/**
 * Q2 à Q5 : génère le niveau du jour pour une date UTC.
 * @param {string} date  AAAA-MM-JJ
 * @param {{version?:number, cumulCap?:number, attemptCap?:number, maxAttempts?:number, onAttempt?:(info:object)=>void}} [options]
 *   cumulCap : plafond cumulé de nœuds (Q5, défaut 3 000 000 ; 1 sert à FORCER le repli dans les tests)
 * @returns {{date:string, version:number, weekday:number, fallback:boolean, reason:string|null, attempt:number, minimum:number, nodes:number,
 *   cumulNodes:number, attempts:Array<object>, level:object|null, code:string|null}}
 *   Repli (`fallback` vrai) : aucun niveau ; `reason` = 'cumul' (plafond cumulé) ou 'attempts' (40 tentatives sans acceptation).
 *   `nodes` = nœuds de la preuve du niveau accepté ; `cumulNodes` = nœuds de toutes les tentatives de la journée.
 *   Le niveau porte l'id `partage` et un nom vide ; `code` est son code F4 canonique.
 */
export function generateDaily(date, options = {}) {
  if (!isValidDay(date)) throw new RangeError('generateDaily : date invalide');
  const version = options.version ?? dailyVersion(date);
  const cumulCap = options.cumulCap ?? DAILY_CUMUL_CAP;
  const attemptCap = options.attemptCap ?? DAILY_ATTEMPT_CAP;
  const maxAttempts = options.maxAttempts ?? DAILY_MAX_ATTEMPTS;
  const weekday = weekdayOf(date);
  const P = WEEKDAY[weekday];
  const attempts = [];
  let cumul = 0;
  const base = { date, version, weekday };
  const note = (info) => { attempts.push(info); if (options.onAttempt) options.onAttempt(info); };
  const fallback = (reason) => ({ ...base, fallback: true, reason, attempt: -1, minimum: -1, nodes: 0, cumulNodes: cumul, attempts, level: null, code: null });
  for (let e = 0; e < maxAttempts; e++) {
    const budget = Math.min(attemptCap, cumulCap - cumul);
    if (budget <= 0) return fallback('cumul');
    const rng = makeRng(fnv1a32(`prismaze-daily-v${version}:${date}:${e}`));
    const g = plant(rng, P);
    if (g === null) { note({ e, planted: false, status: 'skipped', nodes: 0, cumul }); continue; }
    const level = toLevel(P, g.pieces, 'partage', '');
    const res = solve(level, { maxNodes: budget });
    cumul += res.nodes;
    const accepted = res.status === 'proved-optimal' && res.minimum >= P.mMin && res.minimum <= P.inv.length;
    note({ e, planted: true, status: res.status, minimum: res.minimum, nodes: res.nodes, cumul, accepted });
    if (accepted) return { ...base, fallback: false, reason: null, attempt: e, minimum: res.minimum, nodes: res.nodes, cumulNodes: cumul, attempts, level, code: encodeLevel(level) };
    if (res.status === 'unknown' && budget < attemptCap) return fallback('cumul'); // épuisée sur le reste du cumul : repli
  }
  return fallback('attempts');
}

/** Identifiant du niveau de repli d'une date (levels/daily-pool/<id>.json) : un par jour de semaine UTC. */
export const dailyPoolId = (date) => `daily-${weekdayOf(date)}`;
