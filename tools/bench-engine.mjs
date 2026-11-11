// Mesure du VRAI moteur v2 (src/engine/), protocole de ARCHITECTURE_V2 E11 (d'après docs/proto-v2/bench2.mjs).
// Commande : node tools/bench-engine.mjs
// Plateau de référence 10x8 de 50 pièces (2 émetteurs, 5 cibles, 8 murs, 2 portes, 2 portails, 14 miroirs, 6 séparateurs, 6 prismes, 5 filtres,
// moitié des pièces mobiles fixes). Trois cas :
//   1. 2000 plateaux au hasard (graines fixes) : construction + tracé + séries `segments()` (sortie E10 complète), 20 000 recalculs ;
//   2. cas dense (celui qui demande le plus de pas, trouvé par mutation déterministe) : même mesure ;
//   3. tracé seul sur le cas dense, plateau déjà construit (ce que fera le solveur à chaque nœud).
// Seuil : p99 < 500 µs pour chaque cas ; code de sortie 1 sinon. Les temps valent pour cette machine, pas pour un mobile (non mesuré).
import { performance } from 'node:perf_hooks';
import { buildBoard } from '../src/engine/board.js';
import { trace } from '../src/engine/trace.js';
import { goldBoard, denseBoard } from '../tests/engine-crosscheck/generate.mjs';

const THRESHOLD_US = 500;
const SEED = 20261107;
const RECALCS = 20000;
const WARMUP = 3000;

const stepsOf = (st) => trace(buildBoard(st)).steps;
const states = [];
for (let i = 0; i < 2000; i++) states.push(goldBoard(SEED + i));
const dense = denseBoard(SEED, stepsOf);

function stats(values) {
  const a = Float64Array.from(values).sort();
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  return { median: q(0.5), p99: q(0.99), max: a[a.length - 1] };
}
const us = (ms) => (ms * 1000).toFixed(1).padStart(8) + ' µs';

let sink = 0; // empêche d'éliminer le calcul
function full(st) {
  const t0 = performance.now();
  const b = buildBoard(st);
  const r = trace(b);
  sink += r.steps + r.segments().count;
  return { dt: performance.now() - t0, steps: r.steps };
}

function measure(label, list) {
  for (let i = 0; i < WARMUP; i++) full(list[i % list.length]);
  const times = [], steps = [];
  for (let i = 0; i < RECALCS; i++) { const { dt, steps: s } = full(list[i % list.length]); times.push(dt); steps.push(s); }
  const t = stats(times), s = stats(steps);
  console.log(`${label} : ${RECALCS} recalculs, médiane ${us(t.median)}, p99 ${us(t.p99)}, max ${us(t.max)} ; pas médian ${s.median}, max ${s.max} (borne 12·cases = 960)`);
  return t.p99;
}

const p1 = measure('1. 50 pièces au hasard (build + trace + segments)', states);
const p2 = measure('2. cas dense (build + trace + segments)', [dense]);

const b = buildBoard(dense);
for (let i = 0; i < WARMUP; i++) sink += trace(b).steps;
const tt = [];
for (let i = 0; i < RECALCS; i++) { const t0 = performance.now(); sink += trace(b).steps; tt.push(performance.now() - t0); }
const t3 = stats(tt);
console.log(`3. tracé seul, cas dense, plateau déjà construit : ${RECALCS} tracés, médiane ${us(t3.median)}, p99 ${us(t3.p99)}, max ${us(t3.max)}`);

console.log(`Node ${process.version}, plateau 10x8, ${states[0].pieces.length} pièces`);
const ok = p1 * 1000 < THRESHOLD_US && p2 * 1000 < THRESHOLD_US && t3.p99 * 1000 < THRESHOLD_US;
console.log(`Seuil p99 < ${THRESHOLD_US} µs : ${ok ? 'RESPECTÉ' : 'DÉPASSÉ'} (contrôle ${sink > 0 ? 'ok' : 'nul'})`);
process.exit(ok ? 0 : 1);
