// Aides de test (ce fichier n'est pas un test : son nom ne finit pas par .test.mjs).
import { createState, buildBoard, traceBoard, isAlwaysFixed } from './engine.mjs';

/** Gèle récursivement : toute écriture sur l'objet lève une TypeError (modules ES = mode strict). */
export function deepFreeze(o) {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/**
 * Niveau JSON à partir d'une carte ASCII, une chaîne par ligne (lumière blanche, cibles blanches).
 *   .  vide      #  mur      T  cible
 *   >  ^  <  v   émetteur vers E, N, W, S
 *   -  /  |  \   miroir mobile        a  b  c  d   miroir fixe  - / | \
 * Les pièces sont listées dans l'ordre de lecture (gauche à droite, haut en bas).
 */
export function levelFromAscii(rowsText, extra = {}) {
  const pieces = [];
  const rows = rowsText.length;
  const cols = rowsText[0].length;
  const EM = { '>': 'E', '^': 'N', '<': 'W', v: 'S' };
  const FIX = { a: '-', b: '/', c: '|', d: '\\' };
  rowsText.forEach((line, r) => {
    if (line.length !== cols) throw new Error('carte ASCII irrégulière');
    [...line].forEach((ch, c) => {
      if (ch === '.') return;
      if (ch === '#') pieces.push({ type: 'wall', at: [c, r] });
      else if (ch === 'T') pieces.push({ type: 'target', at: [c, r], need: 'RGB' });
      else if (EM[ch]) pieces.push({ type: 'emitter', at: [c, r], dir: EM[ch], mask: 'RGB' });
      else if ('-/|\\'.includes(ch)) pieces.push({ type: 'mirror', at: [c, r], o: ch });
      else if (FIX[ch]) pieces.push({ type: 'mirror', at: [c, r], o: FIX[ch], fixed: true });
      else throw new Error(`caractère inconnu « ${ch} »`);
    });
  });
  return { format: 2, id: 'test-level', size: [cols, rows], pieces, ...extra };
}

/** État à partir d'une carte ASCII. */
export function stateFromAscii(rowsText) {
  return createState(levelFromAscii(rowsText));
}

/** Plateau et tracé à partir d'une carte ASCII. */
export function runAscii(rowsText) {
  const state = stateFromAscii(rowsText);
  const board = buildBoard(state);
  return { state, board, result: traceBoard(board) };
}

/**
 * État à partir de pièces écrites directement sous la forme de l'état (nombres) : {type, c, r, o, dir, mask, need, pair, link, fixed}.
 * Valeurs absentes : 0 (null pour link) ; `fixed` vaut true pour les types toujours fixes. Pas de validation : sert aussi aux cas invalides.
 */
export function mkState(cols, rows, specs) {
  const pieces = specs.map((p, id) => Object.freeze({
    id, type: p.type, c: p.c, r: p.r, o: p.o ?? 0, dir: p.dir ?? 0, mask: p.mask ?? 0, need: p.need ?? 0, pair: p.pair ?? 0,
    link: p.link ? Object.freeze([...p.link]) : null, fixed: p.fixed === true || isAlwaysFixed(p.type),
  }));
  return Object.freeze({ cols, rows, pieces: Object.freeze(pieces) });
}

/** Plateau et tracé à partir de pièces (voir mkState). */
export function run(cols, rows, specs) {
  const state = mkState(cols, rows, specs);
  const board = buildBoard(state);
  return { state, board, result: traceBoard(board) };
}

// Fabriques de pièces (directions 0 E, 1 N, 2 W, 3 S ; orientations 0 '-', 1 '/', 2 '|', 3 '\').
export const P = {
  emitter: (c, r, dir, mask = 7) => ({ type: 'emitter', c, r, dir, mask }),
  wall: (c, r) => ({ type: 'wall', c, r }),
  target: (c, r, need = 7) => ({ type: 'target', c, r, need }),
  mirror: (c, r, o, fixed = false) => ({ type: 'mirror', c, r, o, fixed }),
  splitter: (c, r, o, fixed = false) => ({ type: 'splitter', c, r, o, fixed }),
  prism: (c, r, fixed = false) => ({ type: 'prism', c, r, fixed }),
  filter: (c, r, mask, fixed = false) => ({ type: 'filter', c, r, mask, fixed }),
  portal: (c, r, pair = 0) => ({ type: 'portal', c, r, pair }),
  gate: (c, r, link) => ({ type: 'gate', c, r, link }),
};

/** Séries du tracé sous forme de tableaux [x0, y0, x1, y1, masque], triées (comparaison stable). */
export function segList(result) {
  const s = result.segments();
  const out = [];
  for (let i = 0; i < s.count; i++) out.push([s.x0[i], s.y0[i], s.x1[i], s.y1[i], s.mask[i]]);
  return out.sort((a, b) => a.join().localeCompare(b.join()));
}

/**
 * Polyligne [x0, y0, x1, y1, …] d'un faisceau unique (une seule couleur, sans séparation) : les séries sont enchaînées
 * depuis (startX, startY) en suivant « la fin de l'une est le début de la suivante ».
 */
export function chain(result, startX, startY) {
  const s = result.segments();
  const pts = [startX, startY];
  let x = startX, y = startY;
  const used = new Uint8Array(s.count);
  for (;;) {
    let found = -1;
    for (let i = 0; i < s.count; i++) if (!used[i] && s.x0[i] === x && s.y0[i] === y) { found = i; break; }
    if (found < 0) break;
    used[found] = 1;
    x = s.x1[found]; y = s.y1[found];
    pts.push(x, y);
  }
  return pts;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Niveau aléatoire reproductible (sans garantie de validité V8/V10 : pour tester le moteur seulement). */
export function randomLevel(seed, cols, rows, nMirrors, nWalls, nTargets, fixedEvery = 5) {
  const R = rng(seed);
  const used = new Set();
  const cell = () => {
    for (;;) {
      const c = Math.floor(R() * cols);
      const r = Math.floor(R() * rows);
      const k = c + ',' + r;
      if (!used.has(k)) { used.add(k); return [c, r]; }
    }
  };
  const O = ['-', '/', '|', '\\'];
  const pieces = [{ type: 'emitter', at: cell(), dir: 'ENWS'[Math.floor(R() * 4)], mask: 'RGB' }];
  for (let i = 0; i < nWalls; i++) pieces.push({ type: 'wall', at: cell() });
  for (let i = 0; i < nTargets; i++) pieces.push({ type: 'target', at: cell(), need: 'RGB' });
  for (let i = 0; i < nMirrors; i++) {
    const m = { type: 'mirror', at: cell(), o: O[Math.floor(R() * 4)] };
    if (fixedEvery > 0 && i % fixedEvery === 0) m.fixed = true;
    pieces.push(m);
  }
  return { format: 2, id: 'random-' + seed, size: [cols, rows], pieces };
}
