// Résout un niveau et affiche le minimum, le statut et les solutions (ARCHITECTURE_V2 S2-S6, C3 étape 2).
// Usage : node tools/solve-level.mjs <fichier-niveau.json | id> [--metrics] [--ascii] [--max-nodes N] [--json]
//   --metrics   minimum, statut, nœuds, feuilles, solutions, fausse piste, D2 (C1)
//   --ascii     dessine le plateau de départ puis chaque solution (curation : lire le niveau d'un coup d'œil)
//   --json      une ligne JSON (statut, minimum, nœuds, solutions, témoin, garage)
// Un id (sans .json) est cherché dans levels/. Le niveau est validé (V1-V12) avant la résolution ; V13 et V14 ne sont pas exigées.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateLevel } from '../src/engine/level.js';
import { solve, LimitError, DEFAULT_MAX_NODES } from '../src/engine/solver.js';
import { describeSolution, falseTrail, levelWithPlacements } from './verify-levels.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage : node tools/solve-level.mjs <fichier-niveau.json | id> [--metrics] [--ascii] [--max-nodes N] [--json]';

const MASK_CHARS = { R: 'r', G: 'g', B: 'b', RG: 'y', RB: 'v', GB: 'c', RGB: 'w' };

/** Dessin ASCII d'un niveau (pièces fixes + placements donnés) : une case = 1 caractère. */
export function renderAscii(level, placements = null) {
  const [cols, rows] = level.size;
  const lv = placements === null ? level : levelWithPlacements(level, placements);
  const grid = Array.from({ length: rows }, () => Array(cols).fill('.'));
  for (const p of lv.pieces) {
    const [c, r] = p.at;
    let ch = '?';
    if (p.type === 'wall') ch = '#';
    else if (p.type === 'emitter') ch = { E: '>', N: '^', W: '<', S: 'v' }[p.dir];
    else if (p.type === 'target') ch = (MASK_CHARS[p.need] ?? 't').toUpperCase();
    else if (p.type === 'mirror') ch = p.o;
    else if (p.type === 'splitter') ch = { '-': '=', '/': '%', '|': '!', '\\': '&' }[p.o];
    else if (p.type === 'prism') ch = 'P';
    else if (p.type === 'filter') ch = `f${MASK_CHARS[p.mask] ?? '?'}`.charAt(1);
    else if (p.type === 'portal') ch = String.fromCharCode(48 + p.pair);
    else if (p.type === 'gate') ch = 'G';
    grid[r][c] = ch;
  }
  return grid.map((row) => row.join('')).join('\n');
}

function main(argv) {
  const args = argv.slice();
  const flag = (n) => { const i = args.indexOf(n); if (i >= 0) args.splice(i, 1); return i >= 0; };
  const metrics = flag('--metrics');
  const ascii = flag('--ascii');
  const asJson = flag('--json');
  let maxNodes = DEFAULT_MAX_NODES;
  const mi = args.indexOf('--max-nodes');
  if (mi >= 0) { maxNodes = Number(args[mi + 1]); args.splice(mi, 2); }
  if (args.length !== 1 || args[0].startsWith('--') || !(maxNodes > 0) || !Number.isFinite(maxNodes)) { console.error(USAGE); return 2; }
  const aboveCeiling = maxNodes > DEFAULT_MAX_NODES;
  if (aboveCeiling) console.error(`!!! ATTENTION : --max-nodes ${maxNodes} dépasse le plafond de livraison (${DEFAULT_MAX_NODES}) : résultat NON LIVRABLE (exploration seulement) !!!`);
  const target = args[0];
  const file = existsSync(target) ? target : path.join(ROOT, 'levels', `${target}.json`);
  if (!existsSync(file)) { console.error(`introuvable : ${target}`); return 2; }
  const level = JSON.parse(readFileSync(file, 'utf8'));
  // atelier : par et solutions du fichier ne sont pas exigés (et ne sont pas lus ici)
  const probe = { ...level };
  delete probe.par;
  delete probe.solutions;
  const v = validateLevel(probe);
  for (const e of v.errors) console.log(`${e.code} ${e.path} : ${e.message}`);
  if (v.errors.some((e) => e.code !== 'V10_ALREADY_WON')) return 1;
  let res;
  try {
    res = solve(probe, { maxNodes, countAll: true });
  } catch (e) {
    if (e instanceof LimitError) { console.error(e.message); return 1; }
    throw e;
  }
  if (asJson) {
    console.log(JSON.stringify({ id: level.id, status: res.status, minimum: res.minimum, K: res.K, nodes: res.nodes, nodesTotal: res.nodesTotal, solutionsAtMin: res.solutionsAtMin, solutionsTruncated: res.solutionsTruncated, deliverable: !aboveCeiling, witness: res.witness, parking: res.parking }));
    return res.status === 'proved-optimal' ? 0 : 1;
  }
  console.log(`${level.id} : ${level.size[0]}x${level.size[1]}, ${res.K} pièce(s) mobile(s), statut ${res.status}, minimum ${res.status === 'proved-optimal' ? res.minimum : 'aucun'}, nœuds ${res.nodes}${res.counted ? '' : ' (comptage non terminé)'}${aboveCeiling ? ' [NON LIVRABLE : plafond au-delà de la livraison]' : ''}`);
  if (res.status !== 'proved-optimal') return 1;
  console.log(`  solutions minimales ${res.overflow ? `plus de ${res.solutionsAtMin - 1} (TRONQUÉ)` : res.solutionsTruncated ? 'inconnues (COMPTAGE TRONQUÉ par le plafond de nœuds)' : res.solutionsAtMin} (relaxées ${res.solutionsTruncated ? 'tronqué' : res.solutionsRelaxed}, feuilles ${res.solutionsTruncated ? 'tronqué' : res.leaves}), garages impossibles pendant la recherche ${res.parkingFails}`);
  if (metrics) {
    const d = describeSolution(level, res);
    console.log(`  métriques : ${JSON.stringify({ chemin: d.pathLength, croisements: d.crossings, typesSpeciaux: d.specialTypes, faussePiste: falseTrail(res), nodesTotal: res.nodesTotal, D2: d.D2 })}`);
  }
  if (ascii) {
    console.log('départ :');
    console.log(renderAscii(probe));
  }
  res.solutions.forEach((s, i) => {
    const text = s.witness.map((p) => `${p.type}(${p.at[0]},${p.at[1]})${p.o ?? p.mask ?? ''}`).join('  ');
    console.log(`  ${String(i + 1).padStart(2)}. ${text}${s.parking.length > 0 ? `   garage : ${s.parking.map((p) => `(${p.at[0]},${p.at[1]})`).join(' ')}` : ''}`);
    if (ascii) console.log(renderAscii(probe, s.witness.concat(s.parking)));
  });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
