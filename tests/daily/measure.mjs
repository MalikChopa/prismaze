// Mesure du défi du jour sur N jours consécutifs (Q6, Q7 ; critère de J6 : préparation maximale < 3 s sur ce PC).
// Usage : node tests/daily/measure.mjs [jours=365] [départ=2026-11-08] [--json] [--twice]
//   --twice : chaque date est générée deux fois, les deux résultats doivent être identiques (code F4, tentative, nœuds)
// Sortie : un résumé JSON (replis, tentatives, durées p50 / p90 / max, nœuds cumulés max) ; code 1 si une date n'est pas reproductible.
import { generateDaily, addDays, weekdayOf } from '../../src/engine/daily.js';
import { parseShareCode } from '../../src/engine/share.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const days = Number(args[0]) || 365;
const start = args[1] || '2026-11-08';
const twice = process.argv.includes('--twice');
const rows = [];
let diff = 0;
let invalid = 0;
for (let i = 0; i < days; i++) {
  const date = addDays(start, i);
  const t0 = performance.now();
  const a = generateDaily(date);
  const ms = performance.now() - t0;
  if (twice) {
    const b = generateDaily(date);
    if (a.code !== b.code || a.attempt !== b.attempt || a.nodes !== b.nodes || a.cumulNodes !== b.cumulNodes) diff++;
  }
  if (!a.fallback && !parseShareCode(a.code).ok) invalid++;
  rows.push({ date, weekday: weekdayOf(date), attempts: a.attempts.length, accepted: a.attempt, fallback: a.fallback, nodes: a.nodes, cumul: a.cumulNodes, ms });
}
const sorted = (f) => rows.map(f).sort((x, y) => x - y);
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
const ms = sorted((r) => r.ms);
const cum = sorted((r) => r.cumul);
const worst = rows.reduce((m, r) => (r.ms > m.ms ? r : m), rows[0]);
console.log(JSON.stringify({
  days, start, twice, notReproducible: diff, fallbacks: rows.filter((r) => r.fallback).length, invalidCodes: invalid,
  attemptsMean: Number((rows.reduce((s, r) => s + r.attempts, 0) / rows.length).toFixed(2)), attemptsMax: Math.max(...rows.map((r) => r.attempts)),
  msP50: Math.round(pct(ms, 0.5)), msP90: Math.round(pct(ms, 0.9)), msMax: Math.round(ms[ms.length - 1]), msTotal: Math.round(rows.reduce((s, r) => s + r.ms, 0)),
  cumulNodesMax: cum[cum.length - 1], cumulNodesTotal: rows.reduce((s, r) => s + r.cumul, 0), slowest: { date: worst.date, weekday: worst.weekday, ms: Math.round(worst.ms), cumul: worst.cumul },
}));
process.exit(diff === 0 && invalid === 0 ? 0 : 1);
