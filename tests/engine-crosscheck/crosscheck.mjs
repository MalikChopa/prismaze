// Tracé du moteur (src/engine/) contre la référence indépendante, sur des plateaux aléatoires denses.
// Usage : node tests/engine-crosscheck/crosscheck.mjs trace <n> <graine>      (équivalent de `node docs/proto-v2/crosscheck2.mjs trace 50000 7`)
// Sortie : une ligne JSON {levels, desaccords, ...} ; code de sortie 1 s'il y a au moins un désaccord ou un tracé plafonné.
import { makeGenerator } from './generate.mjs';
import { compareBoard } from './compare.mjs';

const n = +process.argv[3] || 1000, seed = +process.argv[4] || 1;
if (process.argv[2] !== 'trace') { console.error('usage : node tests/engine-crosscheck/crosscheck.mjs trace <n> <graine>'); process.exit(2); }
const { randomFull } = makeGenerator(seed);
let bad = 0, caps = 0, maxRatio = 0, withGate = 0, gatesOpen = 0, withPortal = 0, won = 0;
const t0 = performance.now();
for (let i = 0; i < n; i++) {
  const st = randomFull();
  const { ok, res, board, br, mine } = compareBoard(st);
  if (res.capped) caps++;
  maxRatio = Math.max(maxRatio, res.steps / (12 * board.n));
  if (st.pieces.some((p) => p.type === 'gate')) { withGate++; if (mine.open.length) gatesOpen++; }
  if (st.pieces.some((p) => p.type === 'portal')) withPortal++;
  if (res.allLit) won++;
  if (!ok) { bad++; if (bad <= 3) console.log('DESACCORD', JSON.stringify(st), JSON.stringify(mine), JSON.stringify(br)); }
}
console.log(JSON.stringify({
  test: 'trace', levels: n, seed, desaccords: bad, capped: caps, maxStepsOver12N: +maxRatio.toFixed(3),
  avecPorte: withGate, avecPorteOuverte: gatesOpen, avecPortail: withPortal, gagnants: won, ms: Math.round(performance.now() - t0),
}));
process.exit(bad === 0 && caps === 0 ? 0 : 1);
