// Écrit la liste des fichiers à précacher et la version dans le bloc généré de sw.js (ARCHITECTURE_V2 U10).
// Précache : index.html, manifeste, icônes, src/** (Worker compris), levels/*.json (index compris), levels/daily-pool/*.json.
// Jamais : levels/proofs/, levels/_*, tools/, tests/, docs/, node_modules/. VERSION = hachage (sha256, 12 caractères) des chemins et contenus
// (fins de ligne ramenées à LF : le même hachage sous Windows et ailleurs).
// Usage : node tools/gen-sw.mjs [--check]   (--check : code 1 si sw.js n'est pas à jour, sans rien écrire)
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BEGIN = '// <gen-sw>';
export const END = '// </gen-sw>';

/** V8 : fichiers de src/ jamais utiles hors ligne au joueur : banc `?bench` (import dynamique, développement seulement). */
export const NOT_PRECACHED = Object.freeze(['src/bench.js']);

const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Liste triée des chemins (relatifs à la racine, avec « / ») à précacher. */
export function listFiles(root = ROOT) {
  const files = ['index.html', 'manifest.webmanifest'];
  const icons = path.join(root, 'icons');
  if (existsSync(icons)) for (const f of readdirSync(icons).sort()) files.push(`icons/${f}`);
  const src = path.join(root, 'src');
  if (existsSync(src)) for (const p of walk(src)) if (/\.(js|mjs|json)$/.test(p) && !NOT_PRECACHED.includes(rel(root, p))) files.push(rel(root, p));
  const levels = path.join(root, 'levels');
  if (existsSync(levels)) {
    for (const f of readdirSync(levels).sort()) {
      const p = path.join(levels, f);
      if (statSync(p).isFile() && f.endsWith('.json')) files.push(`levels/${f}`);
    }
    const pool = path.join(levels, 'daily-pool');
    if (existsSync(pool)) for (const f of readdirSync(pool).sort()) if (f.endsWith('.json')) files.push(`levels/daily-pool/${f}`);
  }
  return files;
}

export function computeVersion(root, files) {
  const h = createHash('sha256');
  for (const f of files) {
    const text = readFileSync(path.join(root, f)).toString('latin1').replace(/\r\n/g, '\n');
    h.update(`${f}\0`);
    h.update(text, 'latin1');
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

/** Texte du bloc généré (entre les marqueurs inclus). */
export function renderBlock(files, version) {
  const list = ['./', ...files.map((f) => `./${f}`)];
  return `${BEGIN}\nconst VERSION = '${version}';\nconst PRECACHE = [\n${list.map((f) => `  '${f}',`).join('\n')}\n];\n${END}`;
}

/** Remplace le bloc de sw.js ; renvoie le nouveau texte. */
export function patchSw(text, block) {
  const a = text.indexOf(BEGIN);
  const b = text.indexOf(END);
  if (a < 0 || b < a) throw new Error('marqueurs <gen-sw> introuvables dans sw.js');
  return text.slice(0, a) + block + text.slice(b + END.length);
}

export function build(root = ROOT) {
  const files = listFiles(root);
  const version = computeVersion(root, files);
  return { files, version, block: renderBlock(files, version) };
}

function main(argv) {
  const check = argv.includes('--check');
  const swFile = path.join(ROOT, 'sw.js');
  const current = readFileSync(swFile, 'utf8');
  const { files, version, block } = build();
  const next = patchSw(current, block);
  if (check) {
    if (next !== current) { console.error('sw.js est périmé : lance « node tools/gen-sw.mjs »'); return 1; }
    console.log(`sw.js à jour : version ${version}, ${files.length} fichiers`);
    return 0;
  }
  if (next !== current) writeFileSync(swFile, next);
  console.log(`sw.js : version ${version}, ${files.length} fichiers précachés${next === current ? ' (inchangé)' : ''}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
