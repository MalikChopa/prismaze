// Écrit tests/daily/golden.json : 30 dates consécutives depuis 2026-11-08, produites par le code de PRODUCTION (src/engine/daily.js).
// À lancer UNE fois par version du défi (Q9) ; les anciennes valeurs restent dans git. Jamais recopié d'un prototype.
// Usage : node tests/daily/make-golden.mjs [--write]   (sans --write : affiche seulement)
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { generateDaily, addDays, dailyVersion } from '../../src/engine/daily.js';

const START = '2026-11-08';
const rows = [];
for (let i = 0; i < 30; i++) {
  const date = addDays(START, i);
  const d = generateDaily(date);
  if (d.fallback) throw new Error(`${date} : repli (ne doit pas arriver sur ces dates)`);
  rows.push({ date, v: dailyVersion(date), e: d.attempt, nodes: d.nodes, minimum: d.minimum, sha256: createHash('sha256').update(d.code, 'ascii').digest('hex') });
}
const out = { about: 'Empreintes d\'or du défi du jour (Q6) : sha256 du code F4 canonique du niveau accepté, tentative e acceptée, nœuds de la preuve. Produit par src/engine/daily.js.', start: START, count: 30, rows };
if (process.argv.includes('--write')) writeFileSync(new URL('./golden.json', import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify(out.rows.slice(0, 3)), `... ${rows.length} dates`);
