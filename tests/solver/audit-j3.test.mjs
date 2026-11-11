// Correctifs de l'audit indépendant du solveur J3 (docs/AUDIT_J3_SOLVEUR.md, points 1, 3, 4, 6, 7, 8) devenus des tests permanents.
// Les « mutants » sont des copies de solver.js modifiées dans un dossier temporaire : le dépôt n'est jamais touché.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { solve, replaySolution, DEFAULT_MAX_NODES } from '../../src/engine/solver.js';
import { verifyLevels, formatReport } from '../../tools/verify-levels.mjs';
import { bruteMin, toJson, fromJson } from './brute.mjs';
import { mulberry, plantedLevel } from './generate.mjs';
import { readFixture } from './helpers.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOLVER_FILE = path.join(REPO, 'src', 'engine', 'solver.js');

/** Charge une copie de solver.js dont `from` est remplacé par `to` (exactement une occurrence) ; imports réécrits en URL absolues. */
async function loadMutant(from, to) {
  const src = readFileSync(SOLVER_FILE, 'utf8');
  assert.equal(src.split(from).length - 1, 1, `le motif à muter doit exister une fois : ${from}`);
  const dir = mkdtempSync(path.join(tmpdir(), 'prismaze-mut-'));
  const text = src.replace(from, to).replace(/from '\.\/([a-z]+)\.js'/g, (_m, name) => `from '${pathToFileURL(path.join(REPO, 'src', 'engine', `${name}.js`)).href}'`);
  const file = path.join(dir, 'solver-mutant.mjs');
  writeFileSync(file, text);
  try { return await import(pathToFileURL(file).href); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---- Point 1 : « case sautée puis redécidée » (niveau construit à la main de l'audit, craft.mjs)

/** Émetteur G vers l'est, émetteur R vers l'ouest, cible RG ; 1 miroir + 1 prisme. Le prisme est transparent au vert qui arrive
 * d'abord, il ne sert qu'après que le miroir a envoyé le rouge dessus : la case est sautée puis doit être redécidée. */
const craft = (swap) => {
  const A = { type: 'emitter', at: [0, 1], dir: 'E', mask: 'G' };
  const B = { type: 'emitter', at: [4, 0], dir: 'W', mask: 'R' };
  return { format: 2, id: 'craft-saut', name: 'x', size: [5, 3], pieces: [...(swap ? [B, A] : [A, B]), { type: 'target', at: [4, 1], need: 'RG' }, { type: 'mirror', at: [0, 2], o: '-' }, { type: 'prism', at: [1, 2] }] };
};

test('case sautée puis redécidée : niveau construit, minimum 2 (force brute indépendante), 2 ordres d\'émetteurs, témoin rejoué', () => {
  for (const swap of [false, true]) {
    const lv = craft(swap);
    assert.equal(bruteMin(fromJson(lv)).min, 2, 'force brute');
    const r = solve(lv);
    assert.equal(r.status, 'proved-optimal', `swap=${swap}`);
    assert.equal(r.minimum, 2);
    assert.equal(r.witness.length, 2);
    const rp = replaySolution(lv, r.witness.concat(r.parking));
    assert.equal(rp.ok, true);
    assert.equal(rp.usedMovable, 2);
  }
});

test('mutant « case sautée jamais redécidée » (skip12[cell] === 0) : le niveau construit le tue (verdict faux)', async () => {
  const m = await loadMutant('cur12(cell) !== skip12[cell]', 'skip12[cell] === 0');
  let killed = 0;
  for (const swap of [false, true]) {
    const r = m.solve(craft(swap));
    if (!(r.status === 'proved-optimal' && r.minimum === 2)) killed++;
  }
  assert.ok(killed >= 1, 'au moins un des deux ordres doit donner un verdict faux avec le mutant');
});

// ---- Point 3 : garage serré, ensemble dédié exécuté à chaque `npm test`

const GARAGE_OPTS = { types: ['prism', 'filter', 'filter', 'splitter', 'mirror'], tight: true, hard: true, cols: 3, rows: 3, maxEmitters: 3, portalPct: 0, gatePct: 20, maxK: 3 };

function garageSet(seed, n) {
  const rnd = mulberry(seed);
  const out = [];
  while (out.length < n) {
    const pl = plantedLevel(rnd, GARAGE_OPTS);
    if (pl === null) continue;
    const L = pl.level;
    const mov = L.pieces.filter((p) => ['mirror', 'splitter', 'prism', 'filter'].includes(p.type) && p.fixed !== true);
    if (L.cols * L.rows - (L.pieces.length - mov.length) < mov.length) continue; // V9
    out.push(L);
  }
  return out;
}

function garageRun(solveFn, levels) {
  const st = { levels: levels.length, parkingFails: 0, disagreements: 0, replayKO: 0, solvable: 0 };
  levels.forEach((L, i) => {
    const json = toJson(L, `garage-${i}`);
    const s = solveFn(json, { maxNodes: 300000 });
    if (s.parkingFails > 0) st.parkingFails++;
    const b = bruteMin(L);
    const mine = s.status === 'proved-optimal' ? s.minimum : -1;
    if (mine !== b.min) { st.disagreements++; return; }
    if (b.min >= 0) {
      st.solvable++;
      const rp = replaySolution(json, s.witness.concat(s.parking));
      if (!rp.ok || rp.usedMovable !== b.min) st.replayKO++;
    }
  });
  return st;
}

test('garage serré (ensemble dédié, plateaux 3x3, 3 émetteurs, murs jusqu\'à K cases libres) : échecs de garage exercés, 0 désaccord avec la force brute, 0 rejeu raté', (t) => {
  const st = garageRun(solve, garageSet(5, 400));
  t.diagnostic(JSON.stringify(st));
  assert.ok(st.parkingFails >= 10, `le chemin « échec de garage » doit être exercé (${st.parkingFails})`);
  assert.ok(st.solvable >= 100);
  assert.equal(st.disagreements, 0);
  assert.equal(st.replayKO, 0);
});

test('mutant « garage toujours possible » (parking() rend []) : l\'ensemble de garage serré le détecte', async () => {
  const m = await loadMutant('if (extras.length === 0) return [];', 'return [];');
  const st = garageRun(m.solve, garageSet(5, 400));
  assert.ok(st.disagreements + st.replayKO > 0, JSON.stringify(st));
});

// ---- Point 6 : plafond de nœuds invalide

test('solve : maxNodes NaN, infini, négatif, nul, texte -> RangeError (jamais « sans plafond »)', () => {
  const lv = readFixture('v2/valid/x00-exemple.json');
  for (const bad of [NaN, Infinity, -Infinity, -5, 0, '100', null, {}]) {
    assert.throws(() => solve(lv, { maxNodes: bad }), RangeError, `maxNodes ${String(bad)}`);
  }
  for (const key of ['countMaxNodes', 'countLimit', 'maxStored']) assert.throws(() => solve(lv, { countAll: true, [key]: NaN }), RangeError, key);
  assert.equal(solve(lv, { maxNodes: undefined }).status, 'proved-optimal', 'absent = défaut');
  assert.equal(solve(lv, { maxNodes: DEFAULT_MAX_NODES }).status, 'proved-optimal');
  assert.equal(solve(lv, { maxNodes: 1 }).status, 'unknown', 'plafond 1 : unknown');
});

test('solve : un niveau insoluble coûteux reste borné par un plafond valide ; NaN est refusé', () => {
  // 8 miroirs, cible rouge sous lumière blanche : insoluble (audit points 6 et 10) ; avec un plafond de 20 000 : unknown
  const pieces = [{ type: 'emitter', at: [0, 0], dir: 'E', mask: 'RGB' }, { type: 'target', at: [9, 7], need: 'R' }];
  for (let i = 0; i < 8; i++) pieces.push({ type: 'mirror', at: [1 + i, 3], o: '/' });
  const lv = { format: 2, id: 'insoluble-8', name: 'x', size: [10, 8], pieces };
  const r = solve(lv, { maxNodes: 20000 });
  assert.equal(r.status, 'unknown');
  assert.ok(r.nodes <= 20001);
  assert.throws(() => solve(lv, { maxNodes: NaN }), RangeError);
});

// ---- Point 7 : comptage tronqué

test('solutionsAtMin tronqué : null (jamais un nombre trompeur) et solutionsTruncated vrai ; dépassement : borne basse + overflow + solutionsTruncated', () => {
  const mq = readFixture('maquette-07.v2.json');
  const full = solve(mq, { countAll: true });
  assert.equal(full.solutionsAtMin, 4);
  assert.equal(full.solutionsTruncated, false);
  const cut = solve(mq, { countAll: true, countMaxNodes: 10 });
  assert.equal(cut.status, 'proved-optimal');
  assert.equal(cut.counted, false);
  assert.equal(cut.solutionsAtMin, null);
  assert.equal(cut.solutionsTruncated, true);
  const over = solve(mq, { countAll: true, countLimit: 2 });
  assert.equal(over.overflow, true);
  assert.equal(over.solutionsAtMin, 3);
  assert.equal(over.solutionsTruncated, true);
  assert.equal(solve(mq).solutionsTruncated, false, 'sans comptage : rien de tronqué (rien de compté)');
});

// ---- Point 4 : --update ne doit pas écrire un niveau refusé par la courbe C1 ; --dry-run n'affiche jamais « (écrit) »

const exemple = () => readFixture('v2/valid/x00-exemple.json');
const stripped = (lv) => { const c = { ...lv }; delete c.par; delete c.solutions; return c; };
function makeRoot(levels) {
  const root = mkdtempSync(path.join(tmpdir(), 'prismaze-aj3-'));
  mkdirSync(path.join(root, 'levels'), { recursive: true });
  const ids = Object.keys(levels);
  writeFileSync(path.join(root, 'levels', 'index.json'), JSON.stringify({ format: 2, chapters: [{ id: 'essai', name: 'Essai', levels: ids }] }));
  for (const [id, lv] of Object.entries(levels)) writeFileSync(path.join(root, 'levels', `${id}.json`), JSON.stringify({ ...lv, id }, null, 1));
  return root;
}
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

test('--update : un niveau que la courbe C1 refuse (minimum 1 au rang m09) n\'est NI écrit NI prouvé', () => {
  const root = makeRoot({ 'm09-trop-facile': stripped(exemple()) });
  try {
    const file = path.join(root, 'levels', 'm09-trop-facile.json');
    const before = sha(file);
    const rep = verifyLevels({ root, update: true });
    assert.equal(rep.ok, false);
    assert.match(rep.levels[0].errors.join('|'), /C1 courbe : minimum 1 hors de la bande/);
    assert.equal(sha(file), before, 'fichier du niveau inchangé');
    assert.equal(existsSync(path.join(root, 'levels', 'proofs')), false, 'aucune preuve créée');
    assert.deepEqual(rep.changes, []);
    assert.equal(existsSync(`${file}.tmp`), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--update --dry-run : jamais « (écrit) » dans le rapport, rien écrit', () => {
  const root = makeRoot({ 'x00-exemple': stripped(exemple()) });
  try {
    const rep = verifyLevels({ root, update: true, dryRun: true });
    const text = formatReport(rep);
    assert.doesNotMatch(text, /\(écrit\)/);
    assert.match(text, /à écrire, simulation/);
    assert.equal(existsSync(path.join(root, 'levels', 'proofs')), false);
    const real = verifyLevels({ root, update: true });
    assert.match(formatReport(real), /OK \(écrit\)/, 'le vrai --update, lui, écrit');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- Point 8 : --max-nodes / --max-solutions au-dessus des plafonds de livraison

test('--max-nodes / --max-solutions au-dessus des plafonds : avertissement net, NON LIVRABLE, échec, rien d\'écrit', () => {
  const root = makeRoot({ 'x00-exemple': stripped(exemple()) });
  try {
    const file = path.join(root, 'levels', 'x00-exemple.json');
    const before = sha(file);
    for (const extra of [['--max-nodes', '5000000'], ['--max-solutions', '1000000']]) {
      const r = spawnSync(process.execPath, ['tools/verify-levels.mjs', '--root', root, '--update', ...extra], { cwd: REPO, encoding: 'utf8' });
      assert.equal(r.status, 1, extra.join(' '));
      assert.match(r.stderr, /ATTENTION.*NON LIVRABLE/);
      assert.match(r.stdout, /NON LIVRABLE/);
      assert.equal(sha(file), before, 'rien n\'est écrit');
      assert.equal(existsSync(path.join(root, 'levels', 'proofs')), false);
    }
    const ok = spawnSync(process.execPath, ['tools/verify-levels.mjs', '--root', root, '--update', '--max-nodes', '100000'], { cwd: REPO, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout);
    assert.doesNotMatch(ok.stderr, /ATTENTION/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('solve-level : comptage tronqué affiché comme tronqué ; --max-nodes > 2 M -> avertissement ; gen-levels idem', () => {
  const t = spawnSync(process.execPath, ['tools/solve-level.mjs', 'tests/fixtures/maquette-07.v2.json'], { cwd: REPO, encoding: 'utf8' });
  assert.match(t.stdout, /solutions minimales 4 /);
  const a = spawnSync(process.execPath, ['tools/solve-level.mjs', 'tests/fixtures/v2/valid/x00-exemple.json', '--max-nodes', '9000000'], { cwd: REPO, encoding: 'utf8' });
  assert.match(a.stderr, /ATTENTION.*NON LIVRABLE/);
  assert.match(a.stdout, /NON LIVRABLE/);
  const b = spawnSync(process.execPath, ['tools/gen-levels.mjs', '--profile', 'miroirs', '--count', '1', '--seed', '1', '--max-nodes', '9000000'], { cwd: REPO, encoding: 'utf8' });
  assert.match(b.stderr, /ATTENTION.*NON LIVRABLE/);
  assert.match(b.stdout, /"deliverable":false/);
});
