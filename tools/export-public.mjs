// Prépare la copie publique de Prismaze : une seule liste blanche, tout le reste est exclu.
// Usage : node tools/export-public.mjs            à blanc : liste ce qui serait copié, n'écrit rien
//         node tools/export-public.mjs --write [--author "Nom <adresse-noreply>"] [--no-media]
// --no-media : accepte l'absence de docs/media/ (répétition avant la production des médias) ; sans lui, elle bloque l'écriture.
// --write remplace export/prismaze-public/ (ignoré par git), y relance le scan (0 alerte exigée) puis y crée un dépôt git à l'historique neuf.
// Cet outil ne pousse jamais et n'ajoute jamais de dépôt distant : la publication reste un geste manuel.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanDir } from './scan-public.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TARGET_NAME = 'prismaze-public';

// Tests qui lisent des fichiers non exportés (levels/_v1, levels/_pilots) : les garder rendrait `npm test` rouge dans la copie.
export const TESTS_NEEDING_PRIVATE_FILES = Object.freeze([
  'tests/engine/level.test.mjs',
  'tests/engine/maquette.test.mjs',
  'tests/load.test.mjs',
  'tests/solver/pilots.test.mjs',
  'tests/solver/v1-minimums.test.mjs',
]);

/**
 * LA liste blanche. `file` : un fichier ; `dir` : un dossier entier (récursif) ; `glob` : fichiers directs d'un dossier d'une extension donnée.
 * `except` : retraits d'une entrée (les sous-dossiers de levels/ ne sont pas parcourus : ils sont cités un par un).
 */
export const WHITELIST = Object.freeze([
  { file: 'index.html' },
  { file: 'sw.js' },
  { file: 'manifest.webmanifest' },
  { file: 'package.json' },
  { file: 'README.md' },
  { file: 'README.en.md' },
  { file: 'LICENSE' },
  { dir: 'icons' },
  { dir: 'src' },
  { glob: 'levels', ext: '.json' },
  { dir: 'levels/proofs' },
  { dir: 'levels/daily-pool' },
  { dir: 'tests', except: TESTS_NEEDING_PRIVATE_FILES },
  { file: 'tools/scan-public.mjs' },
  { file: 'tools/export-public.mjs' },
  { file: 'tools/check-readme.mjs' },
  { file: 'tools/serve.mjs' },
  { file: 'tools/gen-sw.mjs' },
  { file: 'tools/verify-levels.mjs' },
  { file: 'tools/solve-level.mjs' },
  { file: 'tools/gen-levels.mjs' },
  { file: 'tools/certify-levels.mjs' },
  { file: 'tools/bench-engine.mjs' },
  { file: 'tools/scan-allow.json' },
  { file: 'tools/repo-meta.json' },
  { dir: 'tools/media' },
  { dir: 'docs/media' },
]);

/** Fichier écrit dans la copie (celui du dépôt privé nomme des dossiers privés). */
export const PUBLIC_GITIGNORE = 'node_modules/\n.tmp/\nexport/\n*.log\n.DS_Store\nThumbs.db\n';

const toPosix = (p) => p.split(path.sep).join('/');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

/** Applique la liste blanche : chemins relatifs (avec « / ») triés, et entrées requises absentes. */
export function listExport(root = ROOT) {
  const files = new Set();
  const missing = [];
  for (const entry of WHITELIST) {
    if (entry.file) {
      if (existsSync(path.join(root, entry.file))) files.add(entry.file); else missing.push(entry.file);
    } else if (entry.dir) {
      const dir = path.join(root, entry.dir);
      if (!existsSync(dir)) { missing.push(`${entry.dir}/`); continue; }
      for (const p of walk(dir)) {
        const rel = toPosix(path.relative(root, p));
        if (!entry.except?.includes(rel)) files.add(rel);
      }
    } else {
      const dir = path.join(root, entry.glob);
      if (!existsSync(dir)) { missing.push(`${entry.glob}/*${entry.ext}`); continue; }
      for (const name of readdirSync(dir)) {
        if (name.endsWith(entry.ext) && statSync(path.join(dir, name)).isFile()) files.add(`${entry.glob}/${name}`);
      }
    }
  }
  return { files: [...files].sort(), missing };
}

function readAuthor(root, cliAuthor) {
  const author = cliAuthor ?? JSON.parse(readFileSync(path.join(root, 'tools', 'repo-meta.json'), 'utf8')).author;
  const m = /^\s*([^<>]+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(author ?? '');
  if (m === null) throw new Error(`identité invalide (attendu : "Nom <adresse>") : ${author}`);
  if (!/noreply/i.test(m[2])) throw new Error('identité refusée : adresse « noreply » exigée pour la copie publique');
  return { name: m[1], email: m[2] };
}

function gitIn(cwd, args, identity) {
  const env = { ...process.env };
  if (identity) {
    Object.assign(env, { GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email, GIT_COMMITTER_NAME: identity.name, GIT_COMMITTER_EMAIL: identity.email });
  }
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Copie, scanne, puis crée l'historique neuf. Lève une erreur si le scan trouve quelque chose : aucun dépôt n'est alors créé. */
export function writeExport({ root = ROOT, target = path.join(root, 'export', TARGET_NAME), author, scanOptions = {}, allowNoMedia = false } = {}) {
  const exportDir = path.resolve(root, 'export');
  const resolved = path.resolve(target);
  if (!resolved.startsWith(exportDir + path.sep)) throw new Error('la cible doit rester sous export/');
  const identity = readAuthor(root, author);
  const { files, missing: absent } = listExport(root);
  const missing = absent.filter((m) => !(allowNoMedia && m === 'docs/media/'));
  if (missing.length > 0) throw new Error(`entrées absentes de la liste blanche : ${missing.join(', ')}`);
  rmSync(resolved, { recursive: true, force: true }); // uniquement sous export/, dossier produit par cet outil
  for (const rel of files) {
    const dest = path.join(resolved, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(root, rel), dest);
  }
  writeFileSync(path.join(resolved, '.gitignore'), PUBLIC_GITIGNORE);
  const scan = scanDir(resolved, scanOptions);
  if (scan.alerts.length > 0) {
    const detail = scan.alerts.slice(0, 20).map((a) => `${a.file}:${a.line} ${a.rule} ${a.excerpt}`).join('\n');
    throw new Error(`scan de la copie : ${scan.alerts.length} alerte(s), aucun dépôt créé\n${detail}`);
  }
  gitIn(resolved, ['init', '-q', '-b', 'main']);
  gitIn(resolved, ['config', 'core.autocrlf', 'false']); // octets conservés tels quels
  gitIn(resolved, ['config', 'user.name', identity.name]);
  gitIn(resolved, ['config', 'user.email', identity.email]);
  gitIn(resolved, ['add', '-A']);
  gitIn(resolved, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Prismaze : version initiale'], identity); // sans signature : une clé personnelle trahirait son propriétaire
  const remotes = gitIn(resolved, ['remote']);
  if (remotes !== '') throw new Error('un dépôt distant existe dans la copie : anormal, rien ne doit y être ajouté');
  const bytes = files.reduce((n, rel) => n + statSync(path.join(resolved, rel)).size, 0);
  let swFresh = true; // un sw.js périmé casse le hors-ligne : signalé, à corriger par `node tools/gen-sw.mjs` avant de publier
  try { execFileSync(process.execPath, ['tools/gen-sw.mjs', '--check'], { cwd: resolved, stdio: 'ignore' }); } catch { swFresh = false; }
  return { target: resolved, files: files.length + 1, bytes, scan, swFresh, commit: gitIn(resolved, ['log', '-1', '--format=%h %an <%ae>']) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--write')) {
      const i = args.indexOf('--author');
      const r = writeExport({ author: i === -1 ? undefined : args[i + 1], allowNoMedia: args.includes('--no-media') });
      console.log(`export-public : ${r.files} fichiers, ${(r.bytes / 1024).toFixed(0)} Ko`);
      console.log(`scan de la copie : ${r.scan.alerts.length} alerte(s) sur ${r.scan.files} fichiers`);
      console.log(`commit : ${r.commit} ; aucun dépôt distant, rien n'est poussé`);
      if (!r.swFresh) console.log("ATTENTION : sw.js n'est pas à jour (lancer node tools/gen-sw.mjs dans le dépôt, puis réexporter)");
      console.log(`copie : export/${TARGET_NAME}/`);
    } else {
      const { files, missing } = listExport();
      for (const f of files) console.log(f);
      console.log(`export-public (à blanc) : ${files.length} fichiers ; rien n'est écrit (ajouter --write)`);
      if (missing.length > 0) console.log(`absents : ${missing.join(', ')}`);
    }
  } catch (e) {
    console.error(`export-public : ${e.message}`);
    process.exit(1);
  }
}
