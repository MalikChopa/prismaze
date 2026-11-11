// Contrôle croisé du solveur contre la force brute indépendante (S9, J3).
// Usage : node tests/solver/crosscheck.mjs <n> <graine> [--count-every N] [--quiet]
//         node tests/solver/crosscheck.mjs hunt <n> <graine> [mouvements]   (chasse locale sur plateaux 6x5 à 8x6, K jusqu'à 5)
//   n niveaux plantés (5x4 au plus, 1 à 3 pièces mobiles, miroir / séparateur / prisme / filtre, portes, portails, garage serré,
//   besoins changés pour des niveaux insolubles), comparés pour : statut et minimum ; témoin + garage rejoués par la force brute
//   (autre tracé) ET par le moteur ; tous les N niveaux, nombre de solutions relaxées et réelles à k = minimum.
// Code de sortie : 0 si aucun désaccord, 1 sinon.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { solve } from '../../src/engine/solver.js';
import { replayPlacements } from '../../src/engine/level.js';
import { bruteMin, bruteCounts, toJson, withPlacements, trace as bruteTrace } from './brute.mjs';
import { mulberry, plantedLevel } from './generate.mjs';
import { huntBelow } from './hunt.mjs';

// Familles de niveaux : chaque famille a ses options ; elles tournent en alternance.
const FAMILIES = [
  { types: ['mirror', 'mirror', 'splitter', 'prism', 'filter'], hard: true, portalPct: 30, gatePct: 40, maxK: 3 },
  { types: ['mirror', 'splitter', 'prism', 'filter'], hard: false, portalPct: 40, gatePct: 60, maxGates: 2, maxK: 3 },
  { types: ['prism', 'prism', 'filter', 'filter', 'mirror'], hard: true, portalPct: 20, gatePct: 30, maxK: 3, tight: true },
  { types: ['mirror', 'splitter'], hard: true, portalPct: 30, gatePct: 30, maxK: 3, cols: 5, rows: 4 },
  { types: ['mirror', 'mirror', 'splitter', 'prism', 'filter'], hard: true, portalPct: 30, gatePct: 40, maxK: 3, mutatePct: 40 },
  { types: ['mirror', 'splitter', 'prism', 'filter'], hard: true, portalPct: 50, gatePct: 50, maxGates: 2, maxK: 3, tight: true, minUsed: 2 },
  { types: ['mirror', 'mirror', 'splitter', 'prism', 'filter'], hard: true, portalPct: 25, gatePct: 35, maxK: 3, cols: 5, rows: 4, maxEmitters: 1, minUsed: 3 },
  { types: ['mirror', 'prism', 'filter', 'splitter'], hard: true, portalPct: 40, gatePct: 40, maxGates: 2, maxK: 3, cols: 5, rows: 4, maxEmitters: 1, minUsed: 2, mutatePct: 15 },
];

export function runCrosscheck({ n, seed, countEvery = 4, log = () => {} }) {
  const rnd = mulberry(seed);
  const st = {
    test: 'solver-vs-brute', levels: n, seed, disagreements: 0, solvable: 0, unsolvable: 0, unknown: 0, replayBruteKO: 0, replayEngineKO: 0,
    countsChecked: 0, countsKO: 0, withGate: 0, withPortal: 0, tightGarage: 0, minHist: {}, kHist: {}, typeLevels: {}, maxNodes: 0, bruteConfigs: 0,
  };
  let made = 0;
  while (made < n) {
    const fam = FAMILIES[made % FAMILIES.length];
    const pl = plantedLevel(rnd, fam);
    if (pl === null) continue;
    const L = pl.level;
    const mov = L.pieces.filter((p) => ['mirror', 'splitter', 'prism', 'filter'].includes(p.type) && p.fixed !== true);
    const fixedCount = L.pieces.length - mov.length;
    if (L.cols * L.rows - fixedCount < mov.length) continue; // pas assez de cases libres : niveau hors règles (V9)
    made++;
    const json = toJson(L, `bx-${seed}-${made}`);
    const s = solve(json, { maxNodes: 2000000, countAll: true });
    const b = bruteMin(L);
    st.bruteConfigs += b.configs;
    st.maxNodes = Math.max(st.maxNodes, s.nodesTotal);
    st.kHist[mov.length] = (st.kHist[mov.length] || 0) + 1;
    if (L.pieces.some((p) => p.type === 'gate')) st.withGate++;
    if (L.pieces.some((p) => p.type === 'portal')) st.withPortal++;
    for (const t of new Set(mov.map((p) => p.type))) st.typeLevels[t] = (st.typeLevels[t] || 0) + 1;
    if (s.parkingFails > 0) st.tightGarage++;
    if (s.status === 'unknown') { st.unknown++; continue; }
    const solverMin = s.status === 'proved-optimal' ? s.minimum : -1;
    if (solverMin !== b.min) {
      st.disagreements++;
      if (st.disagreements <= 3) log(`DESACCORD niveau ${made} : solveur ${s.status} ${s.minimum}, brute ${b.min} ${JSON.stringify(json)}`);
      continue;
    }
    if (b.min < 0) { st.unsolvable++; continue; }
    st.solvable++;
    st.minHist[b.min] = (st.minHist[b.min] || 0) + 1;
    // le témoin et son garage, rejoués par la force brute (tracé indépendant) et par le moteur
    for (const sol of s.solutions) {
      const placements = sol.witness.concat(sol.parking);
      const rb = bruteTrace(withPlacements(L, placements));
      if (!rb.allLit || rb.usedMovable !== b.min) { st.replayBruteKO++; log(`REJEU BRUTE KO niveau ${made} ${JSON.stringify(placements)}`); }
      const re = replayPlacements(json, placements);
      if (!re.ok || re.usedMovable !== b.min) { st.replayEngineKO++; log(`REJEU MOTEUR KO niveau ${made}`); }
    }
    if (b.min >= 1 && countEvery > 0 && made % countEvery === 0) {
      const c = bruteCounts(L, b.min);
      st.countsChecked++;
      if (c.relaxed !== s.solutionsRelaxed || c.real !== s.solutionsAtMin) {
        st.countsKO++;
        if (st.countsKO <= 3) log(`COMPTE KO niveau ${made} : solveur relaxées ${s.solutionsRelaxed} réelles ${s.solutionsAtMin}, brute ${c.relaxed} / ${c.real} ${JSON.stringify(json)}`);
      }
    }
  }
  return st;
}

/**
 * Chasse locale sur des plateaux moyens (6x5 à 8x6, jusqu'à 5 pièces mobiles) : niveau planté -> solveur (plafond 400 000 nœuds) ->
 * recherche locale d'une pose gagnante à moins de `minimum` pièces utilisées (tracé indépendant). Un contre-exemple est un désaccord.
 */
export function runHunt({ n, seed, iters = 20000, log = () => {} }) {
  const rnd = mulberry(seed);
  const st = { test: 'hunt', levels: n, seed, iters, proved: 0, unknown: 0, counterexamples: 0, searchFoundMinimum: 0, minHist: {} };
  let made = 0;
  while (made < n) {
    const pl = plantedLevel(rnd, { cols: 6 + rnd.int(3), rows: 5 + rnd.int(2), maxK: 5, minUsed: 3, gatePct: 50, maxGates: 2, portalPct: 40, hard: true });
    if (pl === null) continue;
    made++;
    const json = toJson(pl.level, `hunt-${seed}-${made}`);
    const r = solve(json, { maxNodes: 400000 });
    if (r.status !== 'proved-optimal') { st.unknown++; continue; }
    st.proved++;
    st.minHist[r.minimum] = (st.minHist[r.minimum] || 0) + 1;
    const h = huntBelow(json, { seed: seed * 1000 + made, restarts: 20, iters: iters / 20, par: r.minimum, start: r.witness.concat(r.parking) });
    if (h.bestWin < r.minimum) { st.counterexamples++; log(`CONTRE-EXEMPLE niveau ${made} : solveur ${r.minimum}, recherche ${h.bestWin} ${JSON.stringify(json)}`); }
    if (h.bestWin === r.minimum) st.searchFoundMinimum++;
  }
  return st;
}

function main(argv) {
  if (argv[0] === 'hunt') {
    const st = runHunt({ n: Number(argv[1]) || 100, seed: Number(argv[2]) || 1, iters: Number(argv[3]) || 20000, log: console.log });
    console.log(JSON.stringify(st));
    return st.counterexamples === 0 ? 0 : 1;
  }
  const n = Number(argv[0]) || 1000, seed = Number(argv[1]) || 1;
  const ci = argv.indexOf('--count-every');
  const countEvery = ci >= 0 ? Number(argv[ci + 1]) : 4;
  const t0 = performance.now();
  const st = runCrosscheck({ n, seed, countEvery, log: argv.includes('--quiet') ? () => {} : console.log });
  st.ms = Math.round(performance.now() - t0);
  console.log(JSON.stringify(st));
  return st.disagreements + st.replayBruteKO + st.replayEngineKO + st.countsKO === 0 && st.unknown === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
