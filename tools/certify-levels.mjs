// Certificat INDEPENDANT des minimums (`par`) des niveaux livres.
//
// Usage : node tools/certify-levels.mjs [--level <id>]... [--all] [--max-seconds N] [--workers N] [--count-par] [--check]
//                                        [--levels-dir <dossier>] [--json] [--out <fichier>]
//   --level <id>     certifie ce niveau (repetable) ; --all : tous les niveaux de levels/index.json
//   --max-seconds N  budget par niveau (defaut 900 s = 15 min) ; atteint : « non confirme (budget) » avec une fraction estimee
//   --workers N      --all : N niveaux en parallele (processus enfants) ; --level seul : le niveau est coupe en N tranches
//   --count-par      en plus, enumere aussi les victoires a exactement `par` pieces (comparaison avec solutionsAtMin, informatif)
//   --check          mode paranoiaque : chaque piece posee est verifiee « utilisee » par le moteur (leve en cas de desaccord)
//   --split i/n      (interne) ne descend que dans les branches de premier niveau j avec j % n == i
// Code de sortie : 0 si tout est confirme ; 1 si un niveau est refute, a un temoin invalide ou une erreur ; 3 si aucun refute mais
//   au moins un « non confirme » (budget) ; 2 si l'usage est faux.
//
// INDEPENDANCE : ce fichier n'importe que le moteur de faisceau (state, board, trace, colors, dirs). Il n'importe NI solver.js, NI hint.js,
// NI level.js : la recherche, le garage et le rejeu sont ecrits ici, sur un autre principe que le solveur (voir docs/CERTIF_NIVEAUX.md).
//
// PRINCIPE (« marcheur de faisceau », resume ; justification complete dans docs/CERTIF_NIVEAUX.md) :
//   on explore des ensembles S de pieces mobiles posees, un a la fois, UNIQUEMENT sur une case ECLAIREE par le trace de S ET qui
//   AGIT sur la lumiere qui y arrive (une piece transparente a toutes ses arrivees ne change rien : lemme E8). Chaque ensemble est
//   genere une seule fois par l'ordre « plus petit candidat valide d'abord » (les candidats valides ecartes deviennent interdits dans la
//   suite). Profondeur maximale par - 1 : si aucune victoire (avec garage possible) n'existe a moins de `par` pieces utilisees,
//   le minimum n'est pas plus bas que `par`.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { createState } from '../src/engine/state.js';
import { buildBoard, finalize, setCell, clearCell } from '../src/engine/board.js';
import { trace } from '../src/engine/trace.js';
import { ORIENT_CHARS } from '../src/engine/dirs.js';
import { maskFromLetters, maskToLetters } from '../src/engine/colors.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_MAX_SECONDS = 900;
const SEARCHABLE = new Set(['mirror', 'splitter', 'prism', 'filter']);
const BUDGET = { budget: true };

// ---------------------------------------------------------------------------------------------------------------------
// Contexte d'un niveau : pieces fixes, inventaire par classe, options (classe, orientation)
// ---------------------------------------------------------------------------------------------------------------------
export function makeContext(level) {
  const st = createState(level);
  const fixedPieces = st.pieces.filter((p) => p.fixed);
  const mov = st.pieces.filter((p) => !p.fixed);
  for (const p of mov) if (!SEARCHABLE.has(p.type)) throw new Error(`type mobile inattendu : ${p.type}`);
  const classes = [];
  for (const p of mov) {
    let c = classes.find((x) => x.type === p.type && x.mask === p.mask);
    if (!c) { c = { type: p.type, mask: p.mask, count: 0 }; classes.push(c); }
    c.count++;
  }
  classes.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.mask - b.mask)); // ordre stable, independant du fichier
  const options = []; // option = (classe, orientation) ; l'ordre fixe l'ordre canonique de l'enumeration
  classes.forEach((c, ci) => {
    const rots = c.type === 'mirror' || c.type === 'splitter' ? 4 : 1;
    for (let o = 0; o < rots; o++) options.push({ ci, o });
  });
  const n = st.cols * st.rows;
  const occ = new Uint8Array(n);
  for (const p of fixedPieces) occ[p.r * st.cols + p.c] = 1;
  return { st, cols: st.cols, rows: st.rows, n, fixedPieces, K: mov.length, classes, options, occ0: occ };
}

const pieceFor = (ctx, opt, cell) => ({
  type: ctx.classes[opt.ci].type, c: cell % ctx.cols, r: (cell / ctx.cols) | 0, o: opt.o, dir: 0,
  mask: ctx.classes[opt.ci].mask, need: 0, pair: 0, link: null, fixed: false,
});

// Plateau de travail : pieces fixes + `extra` places libres (identifiants nF .. nF+extra-1, mobiles). Les cases se posent avec setCell.
function makeWorkBoard(ctx, extra, placed = []) {
  const nF = ctx.fixedPieces.length;
  const base = ctx.fixedPieces.map((p, id) => ({ ...p, id }));
  const placedPieces = placed.map((pl, i) => ({ ...pieceFor(ctx, pl.opt, pl.cell), id: nF + i }));
  const b = buildBoard({ cols: ctx.cols, rows: ctx.rows, pieces: base.concat(placedPieces) });
  const holders = [];
  for (let i = 0; i < extra; i++) holders.push({ type: 'mirror', c: 0, r: 0, o: 0, dir: 0, mask: 0, need: 0, pair: 0, link: null, fixed: false, id: nF + placed.length + i });
  finalize(b, base.concat(placedPieces, holders)); // marque les identifiants supplementaires comme mobiles
  return b;
}

// La piece (type, orientation, masque) AGIT-elle sur ces arrivees (masques par direction d'arrivee) ? Meme definition que « utilisee » (E8).
function acts(type, o, mask, a0, a1, a2, a3) {
  if (type === 'mirror' || type === 'splitter') {
    return (a0 !== 0 && ((o - 0) & 3) !== 0) || (a1 !== 0 && ((o - 1) & 3) !== 1) || (a2 !== 0 && ((o - 2) & 3) !== 2) || (a3 !== 0 && ((o - 3) & 3) !== 3);
  }
  const u = a0 | a1 | a2 | a3;
  if (type === 'prism') return (u & 5) !== 0; // R ou B devie ; G seul traverse
  return (u & ~mask & 7) !== 0; // filtre : absorbe au moins un bit
}

// ---------------------------------------------------------------------------------------------------------------------
// Garage : les pieces non utilisees doivent tenir ailleurs, sur des cases ou elles sont transparentes (S1, E8)
// ---------------------------------------------------------------------------------------------------------------------
/** placed : [{opt, cell}] (pieces utilisees). Renvoie [{opt, cell}] (garees) ou null. Verifie par un rejeu complet du moteur. */
export function findGarage(ctx, placed) {
  const left = ctx.classes.map((c) => c.count);
  for (const pl of placed) left[pl.opt.ci]--;
  const need = []; // une entree par piece a garer : indice de classe
  left.forEach((cnt, ci) => { for (let i = 0; i < cnt; i++) need.push(ci); });
  if (need.length === 0) return [];
  const b = makeWorkBoard(ctx, 1, placed);
  const id = ctx.fixedPieces.length + placed.length;
  trace(b);
  const occ = Uint8Array.from(ctx.occ0);
  for (const pl of placed) occ[pl.cell] = 1;
  // cases ou la classe est transparente (une orientation suffit ; on garde la premiere qui l'est)
  const where = ctx.classes.map(() => []);
  for (let cell = 0; cell < ctx.n; cell++) {
    if (occ[cell]) continue;
    for (let ci = 0; ci < ctx.classes.length; ci++) {
      if (left[ci] === 0) continue;
      const rots = ctx.options.filter((o) => o.ci === ci);
      for (const opt of rots) {
        setCell(b, id, pieceFor(ctx, opt, cell));
        const r = trace(b);
        const used = b.used[id] === 1;
        const same = r.allLit;
        clearCell(b, cell);
        if (!used && same) { where[ci].push({ cell, opt }); break; }
      }
    }
  }
  // affectation (couplage biparti, parcours simple avec retour arriere) : une case par piece, cases distinctes
  const owner = new Map(); // cell -> indice dans need
  const assign = new Array(need.length).fill(null);
  function tryAssign(i, seen) {
    for (const w of where[need[i]]) {
      if (seen.has(w.cell)) continue;
      seen.add(w.cell);
      if (!owner.has(w.cell) || tryAssign(owner.get(w.cell), seen)) { owner.set(w.cell, i); assign[i] = w; return true; }
    }
    return false;
  }
  for (let i = 0; i < need.length; i++) if (!tryAssign(i, new Set())) return null;
  // l'affectation finale est celle de `owner`
  const out = [];
  for (const [cell, i] of owner) { const w = where[need[i]].find((x) => x.cell === cell); out.push({ opt: w.opt, cell }); }
  // rejeu complet : tout est pose, le moteur seul decide
  const r = replayPlacements(ctx, placed.concat(out));
  if (!r.ok || r.used !== placed.length) return null;
  return out;
}

/** Rejeu par le moteur d'un jeu de placements [{opt, cell}] (cases distinctes et libres, inventaire respecte). */
export function replayPlacements(ctx, placed) {
  const occ = Uint8Array.from(ctx.occ0);
  const left = ctx.classes.map((c) => c.count);
  for (const pl of placed) {
    if (pl.cell < 0 || pl.cell >= ctx.n || occ[pl.cell]) return { ok: false, why: 'case occupee ou hors plateau' };
    occ[pl.cell] = 1;
    if (--left[pl.opt.ci] < 0) return { ok: false, why: 'inventaire depasse' };
  }
  const nF = ctx.fixedPieces.length;
  const base = ctx.fixedPieces.map((p, id) => ({ ...p, id }));
  const pcs = placed.map((pl, i) => ({ ...pieceFor(ctx, pl.opt, pl.cell), id: nF + i }));
  const r = trace(buildBoard({ cols: ctx.cols, rows: ctx.rows, pieces: base.concat(pcs) }));
  return { ok: r.allLit && !r.capped, used: r.usedMovable, why: r.allLit ? '' : 'ne gagne pas' };
}

// Placement JSON du niveau (`{type, at, o?, mask?}`) -> [{opt, cell}] ; null si la classe n'existe pas dans l'inventaire.
export function placementsFromJson(ctx, list) {
  const out = [];
  for (const q of list) {
    const mask = q.type === 'filter' ? maskFromLetters(q.mask) : 0;
    const ci = ctx.classes.findIndex((c) => c.type === q.type && c.mask === mask);
    if (ci < 0) return null;
    const o = q.type === 'mirror' || q.type === 'splitter' ? ORIENT_CHARS.indexOf(q.o) : 0;
    const opt = ctx.options.find((x) => x.ci === ci && x.o === o);
    if (!opt) return null;
    out.push({ opt, cell: q.at[1] * ctx.cols + q.at[0] });
  }
  return out;
}

export function placementsToJson(ctx, list) {
  return list.map(({ opt, cell }) => {
    const c = ctx.classes[opt.ci], p = { type: c.type, at: [cell % ctx.cols, (cell / ctx.cols) | 0] };
    if (c.type === 'mirror' || c.type === 'splitter') p.o = ORIENT_CHARS[opt.o];
    if (c.type === 'filter') p.mask = maskToLetters(c.mask);
    return p;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Recherche exhaustive
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Explore tous les ensembles de <= maxDepth pieces (cases eclairees, pieces qui agissent). Pour chaque noeud gagnant (tout allume)
 * dont le score u (pieces utilisees) verifie u <= winBound() et dont le garage existe, appelle onWin(placedUsed, garage, u).
 * onWin renvoie true pour arreter. Options : maxSeconds, maxNodes, split [i, n], check (verifie « utilisee » par le moteur).
 * Renvoie { complete, nodes, fraction, wins }.
 */
export function explore(ctx, maxDepth, winBound, onWin, opts = {}) {
  const { cols, n, options, classes } = ctx;
  const nOpt = options.length;
  const nF = ctx.fixedPieces.length;
  const b = makeWorkBoard(ctx, Math.max(maxDepth, 1));
  const occ = Uint8Array.from(ctx.occ0);
  const left = classes.map((c) => c.count);
  const forbidden = new Uint8Array(n * nOpt);
  const stack = []; // [{opt, cell}] posees, dans l'ordre de pose
  const j = new Int32Array(maxDepth + 2), m = new Int32Array(maxDepth + 2);
  let nodes = 0, wins = 0, stopped = false;
  const t0 = performance.now();
  const deadline = opts.maxSeconds === undefined ? Infinity : t0 + opts.maxSeconds * 1000;
  const maxNodes = opts.maxNodes ?? Infinity;
  const split = opts.split ?? null;
  const check = opts.check === true;
  const inM = b.inM;

  function handleWin(res) {
    const u = res.usedMovable;
    if (u > winBound()) return;
    // sous-ensemble utilise : les pieces posees non utilisees sont retirees (E8 : le champ ne change pas)
    const usedPl = [];
    for (let i = 0; i < stack.length; i++) if (b.used[nF + i] === 1) usedPl.push(stack[i]);
    if (usedPl.length !== u) throw new Error('incoherence : usedMovable different du nombre de pieces utilisees');
    const garage = findGarage(ctx, usedPl);
    if (garage === null) return; // victoire sans garage possible : ce n'est pas une configuration reelle
    wins++;
    if (onWin(usedPl.slice(), garage, u) === true) stopped = true;
  }

  function visit(depth) {
    if (((++nodes) & 1023) === 0 && (performance.now() > deadline || nodes > maxNodes)) throw BUDGET;
    const res = trace(b);
    if (res.allLit) { handleWin(res); if (stopped) return; }
    if (depth >= maxDepth) return;
    // candidats : cases libres eclairees, pieces de l'inventaire restant qui AGISSENT sur les arrivees, non interdites
    const cands = [];
    for (let cell = 0; cell < n; cell++) {
      if (occ[cell]) continue;
      const a0 = inM[cell * 4], a1 = inM[cell * 4 + 1], a2 = inM[cell * 4 + 2], a3 = inM[cell * 4 + 3];
      if ((a0 | a1 | a2 | a3) === 0) continue;
      for (let oi = 0; oi < nOpt; oi++) {
        const opt = options[oi], cl = classes[opt.ci];
        if (left[opt.ci] === 0) continue;
        if (!acts(cl.type, opt.o, cl.mask, a0, a1, a2, a3)) continue;
        const eid = cell * nOpt + oi;
        if (forbidden[eid] === 1) continue;
        cands.push(eid);
      }
    }
    m[depth] = cands.length;
    const done = [];
    for (let k = 0; k < cands.length; k++) {
      j[depth] = k;
      const eid = cands[k], cell = (eid / nOpt) | 0, opt = options[eid % nOpt];
      if (depth === 0 && split !== null && (k % split[1]) !== split[0]) { forbidden[eid] = 1; done.push(eid); continue; }
      setCell(b, nF + depth, pieceFor(ctx, opt, cell));
      occ[cell] = 1; left[opt.ci]--; stack.push({ opt, cell });
      try {
        if (check) { // le moteur doit confirmer que la piece posee est utilisee (sinon l'oracle d'action est faux)
          const r = trace(b);
          if (b.used[nF + depth] !== 1) throw new Error(`oracle en desaccord avec le moteur (case ${cell}, option ${eid % nOpt})`);
          void r;
        }
        visit(depth + 1);
      } finally {
        stack.pop(); left[opt.ci]++; occ[cell] = 0; clearCell(b, cell);
      }
      if (stopped) break;
      forbidden[eid] = 1; done.push(eid);
    }
    for (const e of done) forbidden[e] = 0;
    j[depth] = m[depth]; // fini : sert a l'estimation de fraction
  }

  let complete = true;
  try { visit(0); } catch (e) { if (e !== BUDGET) throw e; complete = false; }
  // fraction estimee : somme des parts terminees, branche par branche (arbre non uniforme : ordre de grandeur, pas une mesure exacte)
  let fraction = 1;
  if (!complete) {
    fraction = 0; let w = 1;
    for (let d = 0; d <= maxDepth && m[d] > 0; d++) { fraction += w * (j[d] / m[d]); w /= m[d]; }
  }
  return { complete: complete || stopped, stopped, nodes, fraction, wins, ms: performance.now() - t0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Certificat d'un niveau
// ---------------------------------------------------------------------------------------------------------------------
/**
 * level : JSON d'un niveau livre (avec `par` et `solutions`). proof : JSON de preuve (facultatif ; sert au temoin + garage).
 * opts : { par, maxSeconds, maxNodes, split, countPar, check }.
 */
export function certifyLevel(level, proof = null, opts = {}) {
  const ctx = makeContext(level);
  const par = opts.par ?? level.par;
  const out = { id: level.id ?? null, par, K: ctx.K, status: null, reason: '', nodes: 0, ms: 0, minimumFound: null, refutation: null, fraction: 1, witnesses: [], countPar: null };
  if (!Number.isInteger(par) || par < 1) { out.status = 'non confirmé'; out.reason = 'par absent ou invalide'; return out; }
  if (par > ctx.K) { out.status = 'réfuté'; out.reason = `par ${par} > nombre de pieces mobiles ${ctx.K}`; return out; }

  // 1. recherche de victoires a moins de `par` pieces utilisees
  let refutation = null;
  const e1 = explore(ctx, par - 1, () => par - 1, (usedPl, garage, u) => { refutation = { used: u, placements: placementsToJson(ctx, usedPl), garage: placementsToJson(ctx, garage) }; return true; },
    { maxSeconds: opts.maxSeconds, maxNodes: opts.maxNodes, split: opts.split, check: opts.check });
  out.nodes = e1.nodes; out.ms = e1.ms; out.fraction = e1.fraction;
  if (refutation) {
    out.status = 'réfuté'; out.refutation = refutation; out.minimumFound = refutation.used;
    out.reason = `victoire avec ${refutation.used} piece(s) utilisee(s) < par ${par}`;
  }

  // 2. temoins : le(s) temoin(s) stocke(s) doivent gagner avec exactement `par` pieces utilisees (rejeu complet par le moteur)
  const sets = [];
  (level.solutions ?? []).forEach((s, i) => sets.push({ label: `solutions[${i}]`, list: s, parking: null }));
  if (proof && Array.isArray(proof.witness)) sets.push({ label: 'preuve.witness+parking', list: proof.witness, parking: proof.parking ?? [] });
  for (const s of sets) {
    const pl = placementsFromJson(ctx, s.list);
    const r = { label: s.label, ok: false, used: null, why: '' };
    if (pl === null) r.why = 'classe de piece hors inventaire';
    else if (s.parking !== null) {
      const pk = placementsFromJson(ctx, s.parking);
      const full = pk === null ? null : pl.concat(pk);
      if (full === null) r.why = 'parking hors inventaire';
      else if (full.length !== ctx.K) r.why = `${full.length} pieces posees, ${ctx.K} attendues`;
      else { const x = replayPlacements(ctx, full); r.ok = x.ok && x.used === par; r.used = x.used; r.why = x.ok ? (x.used === par ? '' : `score ${x.used} != par ${par}`) : x.why; }
    } else {
      const g = findGarage(ctx, pl); // le jeu de `par` pieces + un garage trouve par ce certificateur
      const x = replayPlacements(ctx, pl.concat(g ?? []));
      r.ok = g !== null && x.ok && x.used === par && pl.length + (g?.length ?? 0) === ctx.K; r.used = x.used;
      r.why = r.ok ? '' : g === null ? 'pas de garage' : x.ok ? `score ${x.used} != par ${par}` : x.why;
    }
    out.witnesses.push(r);
  }
  out.witnessOk = out.witnesses.filter((w) => w.ok).length;

  if (out.status === null) {
    if (!e1.complete) { out.status = 'non confirmé'; out.reason = `budget (${opts.maxSeconds ?? '?'} s ou nœuds) atteint ; fraction estimée ${(100 * e1.fraction).toFixed(1)} %`; }
    else if (out.witnessOk === 0) { out.status = 'témoin KO'; out.reason = `aucun temoin ne gagne avec exactement ${par} pieces : ${out.witnesses.map((w) => `${w.label}: ${w.why}`).join(' ; ') || 'aucun temoin stocke'}`; }
    else { out.status = 'confirmé'; out.minimumFound = par; out.reason = `aucune victoire a < ${par} pieces utilisees (enumeration terminee) ; ${out.witnessOk}/${out.witnesses.length} temoin(s) rejoue(s)`; }
  }

  // 3. facultatif : compter les victoires a exactement `par` (comparaison informative avec solutionsAtMin)
  if (opts.countPar && out.status === 'confirmé') {
    let count = 0;
    const e2 = explore(ctx, par, () => par, (usedPl, garage, u) => { if (u === par && usedPl.length === par) count++; return false; }, { maxSeconds: opts.maxSeconds, maxNodes: opts.maxNodes, split: opts.split, check: opts.check });
    out.countPar = { count, complete: e2.complete, nodes: e2.nodes, ms: e2.ms };
  }
  return out;
}

/** Minimum reel (score le plus bas d'une victoire avec garage) par la meme enumeration ; null si aucune victoire jusqu'a maxDepth. */
export function findMinimum(ctx, maxDepth = ctx.K, opts = {}) {
  let best = Infinity, witness = null;
  const e = explore(ctx, Math.min(maxDepth, ctx.K), () => best - 1,
    (usedPl, garage, u) => { if (u < best) { best = u; witness = { used: usedPl, garage }; } return false; }, opts);
  return { minimum: best === Infinity ? null : best, witness, complete: e.complete, nodes: e.nodes };
}

// ---------------------------------------------------------------------------------------------------------------------
// Ligne de commande
// ---------------------------------------------------------------------------------------------------------------------
function readJson(f) { return JSON.parse(readFileSync(f, 'utf8')); }

function loadLevel(dir, id) {
  const level = readJson(path.join(dir, `${id}.json`));
  const pf = path.join(dir, 'proofs', `${id}.proof.json`);
  return { level, proof: existsSync(pf) ? readJson(pf) : null };
}

function parseArgs(argv) {
  const o = { levels: [], all: false, maxSeconds: DEFAULT_MAX_SECONDS, workers: 1, countPar: false, check: false, dir: path.join(REPO_ROOT, 'levels'), json: false, out: null, split: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--level') o.levels.push(v());
    else if (a === '--all') o.all = true;
    else if (a === '--max-seconds') o.maxSeconds = Number(v());
    else if (a === '--workers') o.workers = Number(v());
    else if (a === '--count-par') o.countPar = true;
    else if (a === '--check') o.check = true;
    else if (a === '--levels-dir') o.dir = path.resolve(v());
    else if (a === '--json') o.json = true;
    else if (a === '--out') o.out = v();
    else if (a === '--split') { const [x, y] = v().split('/').map(Number); o.split = [x, y]; }
    else return { error: `option inconnue : ${a}` };
  }
  if (!(o.maxSeconds > 0) || !Number.isInteger(o.workers) || o.workers < 1) return { error: 'valeur invalide (--max-seconds > 0, --workers entier >= 1)' };
  if (o.split && !(Number.isInteger(o.split[0]) && Number.isInteger(o.split[1]) && o.split[1] >= 1 && o.split[0] >= 0 && o.split[0] < o.split[1])) return { error: '--split i/n invalide' };
  return o;
}

function runChild(args) {
  return new Promise((resolve) => {
    const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args, '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    ch.stdout.on('data', (d) => { out += d; });
    ch.stderr.on('data', (d) => { err += d; });
    ch.on('close', () => {
      const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
      try { resolve(JSON.parse(line)); } catch { resolve({ status: 'erreur', reason: (err || out).slice(0, 300) }); }
    });
  });
}

// Fusion des tranches d'un meme niveau (--split) : confirmé seulement si toutes les tranches sont terminees sans refutation.
function mergeSlices(slices) {
  const r = { ...slices[0] };
  r.nodes = slices.reduce((s, x) => s + (x.nodes ?? 0), 0);
  r.ms = Math.max(...slices.map((x) => x.ms ?? 0));
  const bad = slices.find((x) => x.status === 'réfuté');
  const err = slices.find((x) => x.status === 'erreur');
  const unfinished = slices.filter((x) => x.status === 'non confirmé');
  r.fraction = slices.reduce((s, x) => s + (x.fraction ?? 0), 0) / slices.length;
  if (err) { r.status = 'erreur'; r.reason = err.reason; }
  else if (bad) { r.status = 'réfuté'; r.reason = bad.reason; r.refutation = bad.refutation; r.minimumFound = bad.minimumFound; }
  else if (unfinished.length) { r.status = 'non confirmé'; r.reason = `${unfinished.length}/${slices.length} tranche(s) hors budget ; fraction moyenne estimée ${(100 * r.fraction).toFixed(1)} %`; }
  else if (slices.every((x) => x.status === 'confirmé')) { r.status = 'confirmé'; r.reason = `${slices.length} tranches terminees : ${slices[0].reason.replace(/^.*?;/, '').trim()}`; }
  else { r.status = slices[0].status; }
  if (slices[0].countPar) r.countPar = { count: slices.reduce((s, x) => s + (x.countPar?.count ?? 0), 0), complete: slices.every((x) => x.countPar?.complete), nodes: slices.reduce((s, x) => s + (x.countPar?.nodes ?? 0), 0), ms: Math.max(...slices.map((x) => x.countPar?.ms ?? 0)) };
  return r;
}

function formatTable(rows) {
  const pad = (s, w) => String(s).padEnd(w);
  const lines = [`${pad('niveau', 22)}${pad('par', 4)}${pad('K', 3)}${pad('statut', 16)}${pad('temps', 10)}${pad('noeuds', 12)}${pad('min trouvé', 11)}${pad('témoins', 8)}note`];
  for (const r of rows) {
    const w = r.witnesses ? `${r.witnessOk ?? 0}/${r.witnesses.length}` : '';
    lines.push(`${pad(r.id ?? '?', 22)}${pad(r.par ?? '', 4)}${pad(r.K ?? '', 3)}${pad(r.status, 16)}${pad(((r.ms ?? 0) / 1000).toFixed(1) + ' s', 10)}${pad(r.nodes ?? 0, 12)}${pad(r.minimumFound ?? '-', 11)}${pad(w, 8)}${r.status === 'confirmé' ? '' : r.reason}${r.countPar ? ` [victoires a par: ${r.countPar.count}${r.countPar.complete ? '' : '+'}]` : ''}`);
  }
  return lines.join('\n');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.error) { console.error(o.error); process.exit(2); }
  let ids = o.levels;
  if (o.all) ids = readJson(path.join(o.dir, 'index.json')).chapters.flatMap((c) => c.levels);
  if (ids.length === 0) { console.error('usage : node tools/certify-levels.mjs [--level <id>]... [--all] [--max-seconds N] [--workers N] [--count-par] [--check]'); process.exit(2); }

  // enfant : un niveau, une tranche eventuelle, sortie JSON
  if (o.json && ids.length === 1 && o.workers === 1) {
    const { level, proof } = loadLevel(o.dir, ids[0]);
    let res;
    try { res = certifyLevel(level, proof, { maxSeconds: o.maxSeconds, countPar: o.countPar, check: o.check, split: o.split }); res.id = ids[0]; }
    catch (e) { res = { id: ids[0], status: 'erreur', reason: String(e && e.stack ? e.stack : e).slice(0, 400) }; }
    console.log(JSON.stringify(res));
    process.exit(0);
  }

  const extra = ['--max-seconds', String(o.maxSeconds), '--levels-dir', o.dir];
  if (o.countPar) extra.push('--count-par');
  if (o.check) extra.push('--check');
  const results = [];
  if (ids.length === 1 && o.workers > 1) { // un niveau coupe en tranches
    const slices = await Promise.all(Array.from({ length: o.workers }, (_, i) => runChild(['--level', ids[0], '--split', `${i}/${o.workers}`, ...extra])));
    results.push(mergeSlices(slices));
  } else if (o.workers > 1) { // plusieurs niveaux en parallele
    let next = 0;
    const lanes = Array.from({ length: Math.min(o.workers, ids.length, availableParallelism()) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= ids.length) return;
        const r = await runChild(['--level', ids[i], ...extra]);
        r.id = ids[i];
        results[i] = r;
        if (!o.json) console.error(`  ${ids[i]} : ${r.status} (${((r.ms ?? 0) / 1000).toFixed(1)} s, ${r.nodes ?? 0} noeuds)`);
      }
    });
    await Promise.all(lanes);
  } else {
    for (let i = 0; i < ids.length; i++) {
      const { level, proof } = loadLevel(o.dir, ids[i]);
      let r;
      try { r = certifyLevel(level, proof, { maxSeconds: o.maxSeconds, countPar: o.countPar, check: o.check, split: o.split }); } catch (e) { r = { status: 'erreur', reason: String(e && e.message ? e.message : e) }; }
      r.id = ids[i]; results[i] = r;
      if (!o.json && ids.length > 1) console.error(`  ${ids[i]} : ${r.status} (${((r.ms ?? 0) / 1000).toFixed(1)} s, ${r.nodes ?? 0} noeuds)`);
    }
  }
  if (o.out) writeFileSync(o.out, JSON.stringify(results, null, 1));
  if (o.json) console.log(JSON.stringify(ids.length === 1 ? results[0] : results));
  else {
    console.log(formatTable(results));
    const cnt = {}; for (const r of results) cnt[r.status] = (cnt[r.status] ?? 0) + 1;
    console.log(`\nbilan : ${Object.entries(cnt).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    for (const r of results) if (r.status === 'réfuté') console.log(`RÉFUTÉ ${r.id} : ${JSON.stringify(r.refutation)}`);
  }
  if (results.some((r) => r.status === 'réfuté' || r.status === 'témoin KO' || r.status === 'erreur')) process.exit(1);
  process.exit(results.some((r) => r.status !== 'confirmé') ? 3 : 0);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
