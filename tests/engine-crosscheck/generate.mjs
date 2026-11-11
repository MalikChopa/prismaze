// Générateurs de plateaux pour les tests croisés (port de docs/proto-v2/crosscheck2.mjs : mêmes tirages, donc mêmes plateaux
// que `node docs/proto-v2/crosscheck2.mjs trace <n> <graine>`). Format des pièces : voir reference.mjs.
import { makeRng } from './rng.mjs';

export function makeGenerator(seed) {
  const rng = makeRng(seed);
  const freeCells = (st) => {
    const occ = new Set(st.pieces.map((p) => p.c + ',' + p.r));
    const f = [];
    for (let r = 0; r < st.rows; r++) for (let c = 0; c < st.cols; c++) if (!occ.has(c + ',' + r)) f.push([c, r]);
    return f;
  };
  const addAt = (st, piece) => {
    const f = freeCells(st);
    if (!f.length) return false;
    const [c, r] = rng.pick(f);
    st.pieces.push({ c, r, ...piece });
    return true;
  };
  const rnd = {
    mirror: () => ({ type: 'mirror', o: rng.int(4) }),
    splitter: () => ({ type: 'splitter', o: rng.int(4) }),
    prism: () => ({ type: 'prism' }),
    filter: () => ({ type: 'filter', mask: 1 + rng.int(6) }),
  };
  // Plateau dense au hasard (3 à 7 colonnes, 3 à 6 lignes, 1-2 émetteurs, jusqu'à 10 pièces, portails et portes parfois).
  function randomFull() {
    const st = { cols: 3 + rng.int(5), rows: 3 + rng.int(4), pieces: [] };
    const ne = 1 + rng.int(2);
    for (let i = 0; i < ne; i++) addAt(st, { type: 'emitter', dir: rng.int(4), mask: 1 + rng.int(7) });
    const nt = 1 + rng.int(3);
    for (let i = 0; i < nt; i++) addAt(st, { type: 'target', need: 1 + rng.int(7) });
    const nw = rng.int(4);
    for (let i = 0; i < nw; i++) addAt(st, { type: 'wall' });
    const np = rng.int(10);
    for (let i = 0; i < np; i++) addAt(st, rnd[rng.pick(['mirror', 'splitter', 'prism', 'filter'])]());
    if (rng.chance(400)) { const pr = rng.int(3); addAt(st, { type: 'portal', pair: pr }); addAt(st, { type: 'portal', pair: pr }); }
    const tg = st.pieces.filter((p) => p.type === 'target');
    if (rng.chance(400)) { const t = rng.pick(tg); addAt(st, { type: 'gate', link: [t.c, t.r] }); }
    if (rng.chance(200)) { const t = rng.pick(tg); addAt(st, { type: 'gate', link: [t.c, t.r] }); }
    const cnt = {};
    st.pieces.forEach((p) => { if (p.type === 'portal') cnt[p.pair] = (cnt[p.pair] || 0) + 1; });
    st.pieces = st.pieces.filter((p) => p.type !== 'portal' || cnt[p.pair] === 2); // portail seul = niveau invalide (V11), exclu du test
    return st;
  }
  return { rng, randomFull };
}

/**
 * Plateau de référence 10x8 de 50 pièces (2 émetteurs blancs, 5 cibles, 8 murs, 2 portes, 2 portails, 14 miroirs, 6 séparateurs,
 * 6 prismes, 5 filtres, moitié des pièces mobiles fixes), tiré avec la graine donnée. Même construction que docs/proto-v2/bench2.mjs.
 */
export function goldBoard(seed = 20261107) {
  const rng = makeRng(seed);
  const COLS = 10, ROWS = 8;
  const occ = new Set(), pieces = [];
  const at = () => { for (;;) { const c = rng.int(COLS), r = rng.int(ROWS); if (!occ.has(c + ',' + r)) { occ.add(c + ',' + r); return [c, r]; } } };
  const add = (t, extra) => { const [c, r] = at(); pieces.push({ type: t, c, r, ...extra }); return pieces[pieces.length - 1]; };
  for (let i = 0; i < 2; i++) add('emitter', { dir: rng.int(4), mask: 7 });
  const tg = [];
  for (let i = 0; i < 5; i++) tg.push(add('target', { need: 1 + rng.int(7) }));
  for (let i = 0; i < 8; i++) add('wall');
  for (let i = 0; i < 2; i++) { const t = tg[i]; add('gate', { link: [t.c, t.r] }); }
  for (let i = 0; i < 2; i++) add('portal', { pair: 0 });
  for (let i = 0; i < 14; i++) add('mirror', { o: rng.int(4), fixed: i % 2 === 0 });
  for (let i = 0; i < 6; i++) add('splitter', { o: rng.int(4), fixed: i % 2 === 0 });
  for (let i = 0; i < 6; i++) add('prism', { fixed: i % 2 === 0 });
  for (let i = 0; i < 5; i++) add('filter', { mask: 1 + rng.int(6), fixed: i % 2 === 0 });
  return { cols: COLS, rows: ROWS, pieces };
}

/**
 * Plateau 10x8 de 50 pièces « dense » : parmi `tries` plateaux (graines seed, seed+1…), celui qui demande le plus de pas, puis
 * `mutations` essais de mutation (rotation d'une pièce, échange de deux pièces de même type) gardés s'ils n'abaissent pas le nombre
 * de pas. `stepsOf(état)` mesure les pas avec le moteur à tester : cette fonction reste indépendante du moteur. Déterministe.
 */
export function denseBoard(seed, stepsOf, tries = 2000, mutations = 4000) {
  let worst = null, worstSteps = -1;
  for (let i = 0; i < tries; i++) {
    const s = goldBoard(seed + i), k = stepsOf(s);
    if (k > worstSteps) { worstSteps = k; worst = s; }
  }
  const rng = makeRng(seed ^ 0x5bd1e995);
  for (let it = 0; it < mutations; it++) {
    const cand = { cols: worst.cols, rows: worst.rows, pieces: worst.pieces.map((p) => ({ ...p })) };
    const j = rng.int(cand.pieces.length), p = cand.pieces[j];
    if (p.type === 'mirror' || p.type === 'splitter') p.o = rng.int(4);
    else if (p.type === 'emitter') p.dir = rng.int(4);
    else if (p.type === 'prism' || p.type === 'filter') {
      const o = cand.pieces[rng.int(cand.pieces.length)];
      if (o.type === p.type) { const c = o.c; o.c = p.c; p.c = c; const r = o.r; o.r = p.r; p.r = r; }
    } else continue;
    const k = stepsOf(cand);
    if (k >= worstSteps) { worstSteps = k; worst = cand; }
  }
  return worst;
}
