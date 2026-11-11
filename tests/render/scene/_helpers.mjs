// Aides communes des tests de la couche pure du rendu (scene/*) : niveaux livrés rejoués avec le VRAI moteur, plateaux aléatoires à graine fixe.
import { readFileSync, readdirSync } from 'node:fs';
import { createState } from '../../../src/engine/state.js';
import { buildBoard } from '../../../src/engine/board.js';
import { trace } from '../../../src/engine/trace.js';
import { createSegmentPost } from '../../../src/render/scene/segments.js';

const LEVELS = new URL('../../../levels/', import.meta.url);

/** Les niveaux livrés qui ont une solution, état gagné (pièces fixes + 1re solution), ou toutes les solutions. */
export function shippedBoards({ all = false } = {}) {
  const out = [];
  for (const f of readdirSync(LEVELS).filter((x) => /^[mcpsx]\d\d-.*\.json$/.test(x)).sort()) {
    const L = JSON.parse(readFileSync(new URL(f, LEVELS), 'utf8'));
    if (!L.solutions?.length) continue;
    const fixed = L.pieces.filter((p) => !(['mirror', 'splitter', 'prism', 'filter'].includes(p.type) && p.fixed !== true));
    for (const sol of all ? L.solutions : [L.solutions[0]]) out.push({ id: f.slice(0, 3), file: f, level: L, state: createState({ ...L, pieces: [...fixed, ...sol] }) });
  }
  return out;
}

/** Trace un état et passe le post-traitement : { b, res, post }. */
export function process(state, cellPx = 60, opt) {
  const b = buildBoard(state), res = trace(b), post = createSegmentPost(state.cols, state.rows);
  post.run(res.segments(), b.kind, res.in, res.out, cellPx, opt);
  return { b, res, post };
}

export function xorshift(seed) {
  let s = seed | 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/** Plateaux aléatoires à graine (le générateur de docs/proto-v3/crossings2.mjs : 7-12 colonnes, 6-10 rangées, 1-3 émetteurs, miroirs, séparateurs, prismes, filtres, cibles, murs). */
export function randomBoards(n, seed = 12345) {
  let s = seed; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const ri = (k) => Math.floor(rnd() * k);
  const BS = String.fromCharCode(92), MASKS = ['R', 'G', 'B', 'RG', 'RB', 'GB', 'RGB'];
  const boards = [];
  for (let t = 0; t < n; t++) {
    const cols = 7 + ri(6), rows = 6 + ri(5), used = new Set(), pieces = [];
    const add = (p) => { for (;;) { const c = ri(cols), r = ri(rows), k = `${c},${r}`; if (!used.has(k)) { used.add(k); pieces.push({ ...p, at: [c, r] }); return; } } };
    for (let i = 1 + ri(3); i > 0; i--) add({ type: 'emitter', dir: 'ENWS'[ri(4)], mask: MASKS[ri(7)] });
    for (let i = ri(8) + 3; i > 0; i--) add({ type: 'mirror', o: ri(2) ? '/' : BS });
    for (let i = ri(3); i > 0; i--) add({ type: 'splitter', o: ri(2) ? '/' : BS });
    for (let i = ri(2); i > 0; i--) add({ type: 'prism' });
    for (let i = ri(3); i > 0; i--) add({ type: 'filter', mask: MASKS[ri(6)] });
    for (let i = 1 + ri(3); i > 0; i--) add({ type: 'target', need: MASKS[ri(7)] });
    for (let i = ri(4); i > 0; i--) add({ type: 'wall' });
    try { boards.push(createState({ size: [cols, rows], pieces })); } catch { /* plateau refusé : on passe */ }
  }
  return boards;
}
