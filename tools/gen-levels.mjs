// Générateur « témoin planté » de niveaux (ARCHITECTURE_V2 Q3, C3 étape 1) : remplace gen-candidates.mjs.
// Les pièces mobiles sont posées SUR la lumière (donc utiles), les cibles là où la lumière arrive avec ce qu'elle reçoit, puis
// portes, murs et dispersion des pièces mobiles : le niveau est résoluble par construction (le moteur le revérifie, puis le solveur
// donne le vrai minimum). Graine fixe : même graine et mêmes options = même sortie, octet pour octet (hors --timing).
//
// Usage : node tools/gen-levels.mjs --profile <nom> --count N --seed S [options]
//   --profile P      miroirs | miroirs-2e | couleurs | prismes | speciales | maitrise | maitrise-2e (--list-profiles les décrit)
//   --count N        nombre de tentatives (une graine par tentative : fnv1a32("prismaze-gen-v1:<profil>:<S>:<e>"))
//   --seed S         graine entière (défaut 1) ; --from E première tentative (défaut 0 : permet de couper un gros lot en tranches)
//   --min LO[-HI]    ne garder que les niveaux de minimum prouvé dans cette plage
//   --band ID        ne garder que ceux qui passent la bande de C1 de ID (m01..x10) : minimum, mobiles, nœuds, solutions
//   --max-nodes N    plafond de nœuds de la preuve (défaut 2 000 000)
//   --size CxR --targets LO-HI --walls N --gates N --portals N --inv "m6,p,s,fGB" --emitters "RGB,RGB"   surcharges du profil
//   --out DIR        écrit chaque niveau gardé dans DIR/<id>.json (avec par et solutions) ; sans --out, rien n'est écrit
//   --timing         ajoute les durées (la sortie n'est plus reproductible)
// Sortie : une ligne ACCEPT par niveau gardé, puis un résumé JSON (statuts, minimums). Code 0, ou 2 si l'usage est faux.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fnv1a32, makeRng, plant, toLevel, WEEKDAY } from '../src/engine/daily.js';
import { maskFromLetters } from '../src/engine/colors.js';
import { validateLevel } from '../src/engine/level.js';
import { solve, LimitError, DEFAULT_MAX_NODES, MAX_STORED } from '../src/engine/solver.js';
import { curveSlot, curveErrors, describeSolution, falseTrail, formatLevel } from './verify-levels.mjs';

// ---------------------------------------------------------------------------------------------------------------
// Nombres pseudo-aléatoires (Q2) : fnv1a32, splitmix32, sfc32 modifié ; maison, identique sur toute machine.

// Nombres pseudo-aléatoires (Q2), plantation (Q3) et conversion en niveau : UNE seule copie, src/engine/daily.js (gelée par la version du défi, Q9).
export { fnv1a32, makeRng, plant, toLevel };

// ---------------------------------------------------------------------------------------------------------------
// Profils

const W = 7; // émetteur blanc
const M = (n) => Array.from({ length: n }, () => ({ type: 'mirror' }));
const F = (mask) => ({ type: 'filter', mask });

/** Profils du défi du jour (Q4), un par jour de semaine UTC : `--profile daily-0` (dimanche) à `daily-6` ; ils servent au pool de repli (levels/daily-pool/). Hors de la liste des profils de chapitre. */
export const DAILY_PROFILES = Object.freeze(Object.fromEntries(WEEKDAY.map((p, j) => [`daily-${j}`, { ...p, about: `défi du jour, jour de semaine UTC ${j} (Q4), minimum exigé ${p.mMin}` }])));
const profileNamed = (name) => (Object.prototype.hasOwnProperty.call(PROFILES, name) ? PROFILES[name] : Object.prototype.hasOwnProperty.call(DAILY_PROFILES, name) ? DAILY_PROFILES[name] : null);

/** Profils par chapitre (points de départ ; mesures de S5 : voir JOURNAL J3). `emitters` = masques, `inv` = pièces mobiles dans l'ordre de pose. */
export const PROFILES = Object.freeze({
  miroirs: { cols: 10, rows: 8, emitters: [W], inv: M(8), targets: [4, 7], walls: 3, gates: 0, portalPairs: 0, about: 'chapitre 1, 8 miroirs, plateau dense' },
  'miroirs-2e': { cols: 10, rows: 8, emitters: [W, W], inv: M(8), targets: [4, 7], walls: 3, gates: 0, portalPairs: 0, about: 'chapitre 1, 8 miroirs, 2 émetteurs' },
  couleurs: { cols: 9, rows: 7, emitters: [1, 4], inv: [...M(3), F(3)], targets: [2, 3], walls: 5, gates: 0, portalPairs: 0, about: 'chapitre 2, émetteurs rouge et bleu, 3 miroirs + 1 filtre' },
  prismes: { cols: 9, rows: 7, emitters: [W], inv: [...M(3), { type: 'prism' }, F(5)], targets: [2, 4], walls: 6, gates: 0, portalPairs: 0, about: 'chapitre 3, 3 miroirs + prisme + filtre' },
  speciales: { cols: 9, rows: 7, emitters: [W], inv: [...M(3), { type: 'splitter' }, { type: 'prism' }], targets: [2, 4], walls: 6, gates: 1, portalPairs: 1, about: 'chapitre 4, séparateur, prisme, porte, portails' },
  maitrise: { cols: 10, rows: 8, emitters: [W], inv: [...M(3), { type: 'prism' }, { type: 'splitter' }, F(6)], targets: [3, 5], walls: 8, gates: 1, portalPairs: 0, about: 'chapitre 5, 6 mobiles mixtes + porte (X6 de measure3)' },
  'maitrise-2e': { cols: 10, rows: 8, emitters: [W, W], inv: [...M(3), { type: 'prism' }, { type: 'splitter' }, F(6)], targets: [4, 6], walls: 4, gates: 1, portalPairs: 0, about: 'chapitre 5, 6 mobiles mixtes + porte, 2 émetteurs (X6_dense_2e)' },
  // profils du défi du jour (Q4), un par jour de semaine UTC : daily-0 (dimanche) à daily-6 (samedi) ; servent au pool de repli (levels/daily-pool/)
});

// ---------------------------------------------------------------------------------------------------------------
// Ligne de commande

const USAGE = 'usage : node tools/gen-levels.mjs --profile <nom> --count N --seed S [--from E] [--min LO[-HI]] [--band ID] [--max-nodes N] [--out DIR] [--timing]\n  surcharges : --size CxR --targets LO-HI --walls N --gates N --portals N --inv "m6,p,s,fGB" --emitters "RGB,RGB"   (--list-profiles)';

function parseInv(text) {
  const out = [];
  for (const tok of text.split(',')) {
    const m = /^([mspf])([RGB]*)(\d*)$/.exec(tok.trim());
    if (m === null) return null;
    const count = Number(m[3] || 1);
    for (let i = 0; i < count; i++) {
      if (m[1] === 'f') { const mask = maskFromLetters(m[2]); if (mask < 1 || mask > 6) return null; out.push({ type: 'filter', mask }); } else out.push({ type: { m: 'mirror', s: 'splitter', p: 'prism' }[m[1]] });
    }
  }
  return out;
}

function parseArgs(argv) {
  const o = { profile: null, count: 100, seed: 1, from: 0, min: null, band: null, maxNodes: DEFAULT_MAX_NODES, out: null, timing: false, over: {} };
  const need = (i) => { if (i + 1 >= argv.length) throw new Error(`valeur manquante pour ${argv[i]}`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile') o.profile = need(i++);
    else if (a === '--count') o.count = Number(need(i++));
    else if (a === '--seed') o.seed = Number(need(i++));
    else if (a === '--from') o.from = Number(need(i++));
    else if (a === '--min') { const [lo, hi] = need(i++).split('-').map(Number); o.min = [lo, hi ?? 99]; } else if (a === '--band') o.band = need(i++);
    else if (a === '--max-nodes') o.maxNodes = Number(need(i++));
    else if (a === '--out') o.out = need(i++);
    else if (a === '--timing') o.timing = true;
    else if (a === '--size') { const [c, r] = need(i++).split('x').map(Number); o.over.cols = c; o.over.rows = r; } else if (a === '--targets') { const [lo, hi] = need(i++).split('-').map(Number); o.over.targets = [lo, hi ?? lo]; } else if (a === '--walls') o.over.walls = Number(need(i++));
    else if (a === '--gates') o.over.gates = Number(need(i++));
    else if (a === '--portals') o.over.portalPairs = Number(need(i++));
    else if (a === '--inv') { const inv = parseInv(need(i++)); if (inv === null) throw new Error('--inv invalide'); o.over.inv = inv; } else if (a === '--emitters') o.over.emitters = need(i++).split(',').map((s) => maskFromLetters(s.trim()));
    else if (a === '--list-profiles') o.list = true;
    else throw new Error(`option inconnue : ${a}`);
  }
  return o;
}

export function main(argv, write = (s) => console.log(s)) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(`${e.message}\n${USAGE}`); return 2; }
  if (o.list) {
    for (const [name, P] of Object.entries(PROFILES)) write(`${name.padEnd(12)} ${P.cols}x${P.rows}, ${P.emitters.length} émetteur(s), ${P.inv.length} mobiles, cibles ${P.targets.join('-')}, murs ${P.walls}, portes ${P.gates}, portails ${P.portalPairs} : ${P.about}`);
    return 0;
  }
  if (o.profile === null || profileNamed(o.profile) === null || !(o.count >= 0) || !Number.isInteger(o.seed) || !(o.maxNodes > 0) || !Number.isFinite(o.maxNodes)) { console.error(USAGE); return 2; }
  const P = { ...profileNamed(o.profile), ...o.over };
  if (P.emitters.some((m) => !(m >= 1 && m <= 7)) || P.inv.length < 1 || P.cols < 3 || P.rows < 3) { console.error(USAGE); return 2; }
  const aboveCeiling = o.maxNodes > DEFAULT_MAX_NODES;
  if (aboveCeiling) console.error(`!!! ATTENTION : --max-nodes ${o.maxNodes} dépasse le plafond de livraison (${DEFAULT_MAX_NODES}) : niveaux NON LIVRABLES tant que verify-levels ne les a pas acceptés sous les plafonds !!!`);
  let band = null;
  if (o.band !== null) {
    const slot = curveSlot(o.band);
    if (slot === null) { console.error(`--band attend un id m01..x10 (reçu « ${o.band} »)`); return 2; }
    band = o.band;
  }
  const stats = { profile: o.profile, seed: o.seed, from: o.from, attempts: o.count, planted: 0, skipped: 0, invalid: 0, status: {}, byMinimum: {}, accepted: 0 };
  const t0 = performance.now();
  for (let e = o.from; e < o.from + o.count; e++) {
    const rng = makeRng(fnv1a32(`prismaze-gen-v1:${o.profile}:${o.seed}:${e}`));
    const g = plant(rng, P);
    if (g === null) { stats.skipped++; continue; }
    stats.planted++;
    const id = `${o.profile}-${o.seed}-${e}`;
    const level = toLevel(P, g.pieces, id, id);
    if (!validateLevel(level).ok) { stats.invalid++; continue; }
    let res;
    try { res = solve(level, { maxNodes: o.maxNodes }); } catch (err) { if (err instanceof LimitError) res = { status: 'unknown' }; else throw err; }
    stats.status[res.status] = (stats.status[res.status] || 0) + 1;
    if (res.status !== 'proved-optimal') continue;
    stats.byMinimum[res.minimum] = (stats.byMinimum[res.minimum] || 0) + 1;
    if (o.min !== null && (res.minimum < o.min[0] || res.minimum > o.min[1])) continue;
    if (res.minimum < 1) continue;
    // niveau retenu pour l'examen : comptage des solutions (seconde passe, mêmes nœuds de preuve)
    let full;
    try { full = solve(level, { maxNodes: o.maxNodes, countAll: true }); } catch (err) { if (err instanceof LimitError) continue; throw err; }
    if (!full.counted) continue;
    if (band !== null) {
      const bad = curveErrors(band, { minimum: full.minimum, K: full.K, nodes: full.nodes, solutionsAtMin: full.solutionsAtMin });
      if (bad.length > 0) continue;
    }
    const shipped = { ...level, par: full.minimum, solutions: full.solutions.slice(0, MAX_STORED).map((s) => s.witness) };
    const d = describeSolution(level, full);
    stats.accepted++;
    write(`ACCEPT ${id} ${P.cols}x${P.rows} min=${full.minimum} K=${full.K} noeuds=${full.nodes} solutions=${full.solutionsAtMin} fausse-piste=${falseTrail(full)} D2=${d.D2}${o.timing ? ` ms=${Math.round(performance.now() - t0)}` : ''}`);
    if (o.out !== null) { mkdirSync(o.out, { recursive: true }); writeFileSync(path.join(o.out, `${id}.json`), formatLevel(shipped)); }
  }
  if (aboveCeiling) stats.deliverable = false;
  if (o.timing) stats.ms = Math.round(performance.now() - t0);
  write(JSON.stringify(stats));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
