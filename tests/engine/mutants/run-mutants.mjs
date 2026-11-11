// Harnais de mutation (E12 g). Usage : node tests/engine/mutants/run-mutants.mjs
// Pour chaque mutant : copie src/engine/ dans .tmp/mutants/<id>/, applique la modification, lance les tests du moteur contre cette copie
// (variable PRISMAZE_ENGINE_DIR, lue par tests/engine/engine.mjs) et exige qu'au moins un test échoue. Contrôle : la copie intacte doit passer.
// Affiche, par mutant, les fichiers de test qui l'ont tué et le nombre de tests en échec. Code de sortie 1 si un mutant survit
// ou si le contrôle échoue. src/engine/ n'est jamais modifié.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTANTS, applyMutant } from './mutants.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const SRC = join(ROOT, 'src', 'engine');
const TMP = join(ROOT, '.tmp', 'mutants');
const only = process.argv.slice(2).map(Number).filter(Boolean);

const testFiles = [
  ...readdirSync(join(ROOT, 'tests', 'engine')).filter((f) => f.endsWith('.test.mjs') && f !== 'mutants.test.mjs').map((f) => join('tests', 'engine', f)),
  join('tests', 'engine-crosscheck', 'crosscheck.test.mjs'),
];

function runTests(engineDir, files = testFiles) {
  const t0 = Date.now();
  const res = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PRISMAZE_ENGINE_DIR: engineDir }, maxBuffer: 1 << 28 });
  const out = res.stdout + res.stderr;
  const failed = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  const pass = +(/^# pass (\d+)/m.exec(out) || [0, 0])[1];
  return { code: res.status, failed, pass, ms: Date.now() - t0, out };
}

// quels fichiers de test échouent ? (on relance fichier par fichier seulement pour les mutants tués : rapide, chaque fichier < 3 s)
function killers(engineDir) {
  const names = [];
  for (const f of testFiles) if (runTests(engineDir, [f]).code !== 0) names.push(f.split(String.fromCharCode(92)).join('/').replace(/^tests\//, ''));
  return names;
}

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const control = join(TMP, 'control');
cpSync(SRC, control, { recursive: true });
const c = runTests(control);
console.log(`contrôle (copie intacte) : ${c.code === 0 ? 'OK' : 'ECHEC'} : ${c.pass} tests passés, ${c.failed.length} en échec, ${c.ms} ms`);
let survivors = c.code === 0 ? 0 : 1;

let killed = 0;
const list = only.length ? MUTANTS.filter((m) => only.includes(m.id)) : MUTANTS;
for (const m of list) {
  const dir = join(TMP, String(m.id));
  cpSync(SRC, dir, { recursive: true });
  const p = join(dir, m.file);
  writeFileSync(p, applyMutant(m, readFileSync(p, 'utf8')));
  const r = runTests(dir);
  const dead = r.code !== 0 && r.failed.length > 0;
  if (dead) killed++; else survivors++;
  console.log(`mutant ${m.id} « ${m.name} » : ${dead ? 'TUÉ' : 'SURVIT'} (${r.failed.length} tests en échec, ${r.ms} ms)`);
  if (dead) console.log(`   tué par : ${killers(dir).join(', ')} ; premiers échecs : ${r.failed.slice(0, 2).map((x) => x.slice(0, 70)).join(' | ')}`);
}
console.log(`BILAN : ${killed}/${list.length} mutants tués, ${survivors} survivant(s) ou échec de contrôle`);
rmSync(TMP, { recursive: true, force: true });
process.exit(survivors === 0 ? 0 : 1);
