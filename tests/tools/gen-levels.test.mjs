// gen-levels (Q2, Q3, C3 étape 1) : générateur « témoin planté » à graine fixe, filtre de bandes, aucune écriture sans --out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, makeRng, fnv1a32, plant, toLevel, PROFILES } from '../../tools/gen-levels.mjs';
import { verifyLevels } from '../../tools/verify-levels.mjs';
import { validateLevel } from '../../src/engine/level.js';
import { solve } from '../../src/engine/solver.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = (args) => spawnSync(process.execPath, ['tools/gen-levels.mjs', ...args], { cwd: REPO, encoding: 'utf8' });
function capture(args) {
  const lines = [];
  const code = main(args, (s) => lines.push(s));
  return { code, lines };
}

test('Q2 : vecteurs du générateur (fnv1a32, splitmix32, sfc32 modifié, int) retrouvés', () => {
  const seed = fnv1a32('prismaze-daily-v1:2026-11-08:0');
  assert.equal(seed, 4097530856);
  const a = makeRng(seed);
  assert.deepEqual([a.u32(), a.u32(), a.u32(), a.u32(), a.u32()], [2898564557, 2971948310, 3634595666, 211298323, 1361156425]);
  const b = makeRng(seed);
  assert.deepEqual([b.int(10), b.int(10), b.int(10), b.int(10), b.int(10)], [6, 6, 8, 0, 3]);
});

test('profils : les 7 profils sont décrits (--list-profiles)', () => {
  const r = capture(['--list-profiles']);
  assert.equal(r.code, 0);
  assert.equal(r.lines.length, 7);
  assert.deepEqual(Object.keys(PROFILES), ['miroirs', 'miroirs-2e', 'couleurs', 'prismes', 'speciales', 'maitrise', 'maitrise-2e']);
});

test('déterminisme : même graine et mêmes paramètres = même sortie ; autre graine = autre sortie', () => {
  const a = capture(['--profile', 'prismes', '--count', '25', '--seed', '3']);
  const b = capture(['--profile', 'prismes', '--count', '25', '--seed', '3']);
  const c = capture(['--profile', 'prismes', '--count', '25', '--seed', '4']);
  assert.equal(a.code, 0);
  assert.deepEqual(a.lines, b.lines);
  assert.notDeepEqual(a.lines, c.lines);
  assert.match(a.lines.at(-1), /^\{"profile":"prismes","seed":3,"from":0,"attempts":25,"planted":/);
});

test('ligne de commande : deux lancements identiques octet pour octet, code 0 ; option inconnue ou profil absent -> code 2', () => {
  const args = ['--profile', 'miroirs', '--count', '30', '--seed', '9', '--min', '3'];
  const a = run(args);
  const b = run(args);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, b.stdout);
  assert.equal(run(['--profile', 'miroirs', '--nimporte']).status, 2);
  assert.equal(run(['--count', '3']).status, 2);
  assert.equal(run(['--profile', 'inconnu', '--count', '3']).status, 2);
  assert.equal(run(['--profile', 'miroirs', '--band', 'z99']).status, 2);
});

test('tranches : --from E donne les mêmes tentatives qu\'un lot complet (parallélisable)', () => {
  const full = capture(['--profile', 'miroirs', '--count', '40', '--seed', '5', '--min', '2']);
  const part = capture(['--profile', 'miroirs', '--count', '20', '--from', '20', '--seed', '5', '--min', '2']);
  const ids = (r) => r.lines.filter((l) => l.startsWith('ACCEPT')).map((l) => l.split(' ')[1]);
  const second = ids(full).filter((id) => Number(id.split('-').at(-1)) >= 20);
  assert.deepEqual(ids(part), second);
});

test('niveaux plantés : valides V1-V12, résolubles par construction (proved-optimal, minimum <= nombre de mobiles)', () => {
  for (const name of ['miroirs', 'prismes', 'speciales', 'maitrise-2e']) {
    const P = PROFILES[name];
    let made = 0;
    for (let e = 0; e < 25; e++) {
      const g = plant(makeRng(fnv1a32(`test-plant:${name}:${e}`)), P);
      if (g === null) continue;
      made++;
      const level = toLevel(P, g.pieces, `t-${name}-${e}`, 'test');
      assert.deepEqual(validateLevel(level).errors, [], `${name} ${e}`);
      const r = solve(level, { maxNodes: 300000 });
      assert.ok(r.status === 'proved-optimal' || r.status === 'unknown', `${name} ${e} : ${r.status}`);
      if (r.status === 'proved-optimal') assert.ok(r.minimum <= P.inv.length);
      assert.equal(level.pieces.filter((p) => ['mirror', 'splitter', 'prism', 'filter'].includes(p.type)).length, P.inv.length);
    }
    assert.ok(made >= 15, `${name} : ${made} niveaux plantés sur 25`);
  }
});

test('filtre de bande : --band m01 ne garde que des minimums 1 ; --min 3-4 que 3 ou 4', () => {
  const a = capture(['--profile', 'miroirs', '--count', '80', '--seed', '2', '--band', 'm01']);
  for (const l of a.lines.filter((x) => x.startsWith('ACCEPT'))) assert.match(l, / min=1 /);
  const b = capture(['--profile', 'miroirs', '--count', '60', '--seed', '2', '--min', '3-4']);
  const acc = b.lines.filter((x) => x.startsWith('ACCEPT'));
  assert.ok(acc.length >= 5);
  for (const l of acc) assert.match(l, / min=[34] /);
});

test('--out : les niveaux gardés sont écrits avec par et solutions, passent verify-levels (--dir) ; sans --out, rien n\'est écrit', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'prismaze-gen-'));
  try {
    const out = path.join(dir, 'cand');
    const r = capture(['--profile', 'prismes', '--count', '40', '--seed', '8', '--min', '2', '--out', out]);
    assert.equal(r.code, 0);
    const accepted = r.lines.filter((l) => l.startsWith('ACCEPT')).length;
    assert.ok(accepted >= 2, `${accepted} niveaux gardés`);
    assert.equal(readdirSync(out).length, accepted);
    for (const f of readdirSync(out)) {
      const lv = JSON.parse(readFileSync(path.join(out, f), 'utf8'));
      assert.equal(validateLevel(lv, { mode: 'shipped', expectedId: f.slice(0, -5) }).ok, true, f);
    }
    const rep = verifyLevels({ root: dir, dir: 'cand', update: true });
    assert.equal(rep.ok, true, rep.levels.map((l) => l.errors.join(';')).join('\n'));
    assert.equal(verifyLevels({ root: dir, dir: 'cand' }).ok, true);
    const before = readdirSync(REPO).sort().join(',');
    const candBefore = existsSync(path.join(REPO, 'levels-candidates')) ? readdirSync(path.join(REPO, 'levels-candidates')).sort().join(',') : null;
    capture(['--profile', 'prismes', '--count', '10', '--seed', '8', '--min', '2']);
    assert.equal(readdirSync(REPO).sort().join(','), before, 'sans --out, aucun fichier créé');
    // levels-candidates peut exister (travail des concepteurs, J7) : il ne doit pas changer
    const candAfter = existsSync(path.join(REPO, 'levels-candidates')) ? readdirSync(path.join(REPO, 'levels-candidates')).sort().join(',') : null;
    assert.equal(candAfter, candBefore, 'sans --out, levels-candidates est inchangé');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
