// Recherche ce qui ne doit pas partir dans la copie publique : chemins personnels, adresses e-mail, jetons,
// nom d'utilisateur et dossier personnel de la machine (lus à l'exécution), champs de package.json, métadonnées d'images.
// Sans dépendance. Exceptions : tools/scan-allow.json, chacune avec une raison.
// Usage : node tools/scan-public.mjs [dossier] [--summary] [--json]   (code de sortie : 0 rien, 1 alertes, 2 erreur)
// Les motifs sont assemblés par concaténation : l'outil ne s'accuse pas lui-même quand il scanne la copie exportée.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'export', '.tmp']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif']);
const MAX_FILE_BYTES = 32 * 1024 * 1024; // au-delà : fichier signalé, jamais lu entier
const GENERIC_NAMES = new Set(['user', 'admin', 'root', 'runner', 'administrator', 'utilisateur']); // trop courants pour être cherchés

const SEP = '[\\\\/]+'; // « / », « \ » ou « \\ » (JSON, chaînes échappées)
const USERS = 'Us' + 'ers';
const HOME = 'ho' + 'me';

/** Motifs de texte : [identifiant de règle, expression]. */
export const TEXT_RULES = Object.freeze([
  ['windows-path', new RegExp('\\b[A-Za-z]:' + SEP + USERS + '(?:' + SEP + '|\\b)', 'g')],
  ['unix-path', new RegExp('(?<![\\w.:/\\\\-])/(?:[a-z]/' + USERS + '|' + USERS + '|' + HOME + ')/[A-Za-z0-9._-]+', 'g')],
  // domaine alphabétique (ne trouve pas « paquet@1.64.1 » ni « icone@2x.png »)
  ['email', new RegExp('[A-Za-z0-9._%+-]+' + '@' + '[A-Za-z][A-Za-z0-9-]*(?:\\.[A-Za-z][A-Za-z0-9-]*)*\\.[A-Za-z]{2,}', 'g')],
  ['github-token', new RegExp('\\b' + 'gh' + 'p_' + '[A-Za-z0-9]{36}', 'g')],
  ['github-pat', new RegExp('\\b' + 'github' + '_pat_' + '[A-Za-z0-9_]{20,}', 'g')],
  ['openai-style-key', new RegExp('\\b' + 's' + 'k-' + '[A-Za-z0-9]{20,}', 'g')],
  ['aws-key', new RegExp('\\b' + 'AK' + 'IA' + '[0-9A-Z]{16}', 'g')],
  ['slack-token', new RegExp('\\b' + 'xo' + 'x[abprs]-', 'g')],
  ['private-key', new RegExp('PRIVATE' + ' KEY', 'g')],
  ['secret-assignment', new RegExp('\\b(?:' + ['to' + 'ken', 'sec' + 'ret', 'k' + 'ey', 'pass' + 'word'].join('|') + ')["\']?\\s*[:=]\\s*["\'][^"\'\\n]{16,}["\']', 'gi')],
]);

const mask = (s) => (s.length <= 6 ? `${s[0]}***` : `${s.slice(0, 4)}***(${s.length})`);
const toPosix = (p) => p.split(path.sep).join('/');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function git(args, cwd) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}

/** Identité publique choisie (tools/repo-meta.json) : seule adresse autorisée sans exception. */
export function readMeta(root = ROOT) {
  const file = path.join(root, 'tools', 'repo-meta.json');
  if (!existsSync(file)) return { author: '', noreply: [] };
  const meta = JSON.parse(readFileSync(file, 'utf8'));
  return { ...meta, noreply: Array.isArray(meta.noreply) ? meta.noreply : [] };
}

/** Valeurs propres à cette machine, lues à l'exécution, jamais écrites dans ce fichier. */
export function runtimeIdentity(root = ROOT, meta = readMeta(root)) {
  const names = new Set();
  const publicAuthor = String(meta.author || '').toLowerCase();
  const push = (v) => {
    const s = String(v || '').trim();
    if (s.length >= 3 && !GENERIC_NAMES.has(s.toLowerCase()) && !publicAuthor.includes(s.toLowerCase())) names.add(s);
  };
  try { push(os.userInfo().username); } catch { /* pas d'utilisateur : rien à chercher */ }
  push(git(['config', '--global', '--get', 'user.name'], root));
  push(git(['config', '--global', '--get', 'user.email'], root));
  push(git(['config', '--get', 'user.name'], root));
  push(git(['config', '--get', 'user.email'], root));
  push(os.hostname());
  const home = os.homedir();
  const homes = new Set();
  if (home && home.length > 3) {
    const parts = home.split(/[\\/]+/).filter(Boolean);
    homes.add(parts.join('/'));
    homes.add(parts.join('\\'));
    homes.add(parts.join('\\\\'));
  }
  return { names: [...names], homes: [...homes] };
}

function buildIdentityRules(identity) {
  const rules = [];
  if (identity.names.length > 0) rules.push(['machine-identity', new RegExp(`(?<![\\w-])(?:${identity.names.map(escapeRe).join('|')})(?![\\w-])`, 'gi')]);
  if (identity.homes.length > 0) rules.push(['home-folder', new RegExp(identity.homes.map(escapeRe).join('|'), 'gi')]);
  return rules;
}

/** Charge et valide les exceptions. Chacune : { file, rule, match?, reason } ; `file` : chemin exact, ou préfixe terminé par « / ». */
export function loadAllow(file) {
  if (!existsSync(file)) return [];
  const list = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(list)) throw new Error('scan-allow.json : tableau attendu');
  for (const a of list) {
    if (!a || typeof a.file !== 'string' || typeof a.rule !== 'string' || typeof a.reason !== 'string' || a.reason.trim().length < 8) {
      throw new Error(`scan-allow.json : exception sans fichier, règle ou raison : ${JSON.stringify(a)}`);
    }
  }
  return list;
}

const isAllowed = (allow, alert) => allow.some((a) => a.rule === alert.rule
  && (a.file === alert.file || (a.file.endsWith('/') && alert.file.startsWith(a.file)))
  && (a.match === undefined || alert.raw.includes(a.match)));

function lineOf(text, index) {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

/** Applique les règles de texte à un contenu. */
export function scanText(text, rules, noreply = []) {
  const out = [];
  for (const [rule, source] of rules) {
    const re = new RegExp(source.source, source.flags);
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      if (m[0] === '') { re.lastIndex++; continue; }
      if (rule === 'email' && noreply.some((n) => n.toLowerCase() === m[0].toLowerCase())) continue;
      out.push({ rule, line: lineOf(text, m.index), raw: m[0] });
    }
  }
  return out;
}

/** Métadonnées d'une image : renvoie la liste de ce qui s'y trouve (vide = image sans métadonnées). */
export function imageMetadata(buf, ext) {
  const found = [];
  if (ext === '.png') {
    if (buf.length < 8) return found;
    for (let p = 8; p + 12 <= buf.length;) {
      const len = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      if (['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(type)) found.push(`PNG ${type}`);
      if (type === 'IEND') break;
      p += 12 + len;
    }
  } else if (ext === '.jpg' || ext === '.jpeg') {
    for (let p = 2; p + 4 <= buf.length;) {
      if (buf[p] !== 0xFF) break;
      const marker = buf[p + 1];
      if (marker === 0xDA || marker === 0xD9) break; // début des données : plus de métadonnées
      const len = buf.readUInt16BE(p + 2);
      if (marker === 0xFE) found.push('JPEG commentaire');
      if (marker >= 0xE1 && marker <= 0xEF) {
        const id = buf.toString('latin1', p + 4, Math.min(p + 16, buf.length)).split('\0')[0];
        if (marker !== 0xEE) found.push(`JPEG APP${marker - 0xE0} ${id}`.trim()); // APP14 (Adobe) : transformée de couleur seulement
      }
      p += 2 + len;
    }
  } else if (ext === '.gif') {
    if (buf.length < 13) return found;
    let p = 13;
    if (buf[10] & 0x80) p += 3 * (2 ** ((buf[10] & 7) + 1));
    const skipBlocks = (q) => { while (q < buf.length && buf[q] !== 0) q += buf[q] + 1; return q + 1; };
    while (p < buf.length && buf[p] !== 0x3B) {
      if (buf[p] === 0x21) {
        const label = buf[p + 1];
        if (label === 0xFE) found.push('GIF commentaire');
        if (label === 0xFF) {
          const app = buf.toString('latin1', p + 3, p + 14);
          if (!app.startsWith('NETSCAPE2.0') && !app.startsWith('ANIMEXTS1.0')) found.push(`GIF application ${app}`);
        }
        p = skipBlocks(p + 2);
      } else if (buf[p] === 0x2C) {
        let q = p + 10;
        if (buf[p + 9] & 0x80) q += 3 * (2 ** ((buf[p + 9] & 7) + 1));
        p = skipBlocks(q + 1);
      } else break;
    }
  }
  return found;
}

/** Champs de package.json qui nomment quelqu'un : seul le texte à remplacer ou l'identité publique sont admis. */
export function packageFieldAlerts(text, meta) {
  const out = [];
  let pkg;
  try { pkg = JSON.parse(text); } catch { return out; }
  for (const field of ['author', 'contributors', 'maintainers', 'repository', 'bugs', 'homepage']) {
    if (pkg[field] === undefined) continue;
    const value = JSON.stringify(pkg[field]);
    const fine = value.includes('<utilisateur>') || meta.noreply.some((n) => value.includes(n));
    if (!fine) out.push({ rule: 'package-field', line: 1, raw: `${field}: ${value}` });
  }
  return out;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(p, out); }
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

/**
 * Scanne un dossier. Options : `allowFile`, `meta`, `identity` (surcharges pour les tests).
 * Renvoie { files, alerts:[{file,line,rule,excerpt,raw}], allowed }.
 */
export function scanDir(dir, options = {}) {
  const root = path.resolve(dir);
  const meta = options.meta ?? readMeta(ROOT);
  const identity = options.identity ?? runtimeIdentity(ROOT, meta);
  const allow = loadAllow(options.allowFile ?? path.join(ROOT, 'tools', 'scan-allow.json'));
  const rules = [...TEXT_RULES, ...buildIdentityRules(identity)];
  const files = walk(root, []);
  const alerts = [];
  let allowed = 0;
  const add = (rel, a) => {
    const alert = { file: rel, line: a.line, rule: a.rule, excerpt: mask(a.raw), raw: a.raw };
    if (isAllowed(allow, alert)) allowed++; else alerts.push(alert);
  };
  for (const file of files) {
    const rel = toPosix(path.relative(root, file));
    // le nom de fichier lui-même peut trahir quelqu'un
    for (const a of scanText(rel, rules, meta.noreply)) add(rel, { ...a, rule: `${a.rule}-filename` });
    const size = statSync(file).size;
    if (size > MAX_FILE_BYTES) { add(rel, { rule: 'too-large-to-scan', line: 0, raw: `${size} octets` }); continue; }
    const ext = path.extname(file).toLowerCase();
    const buf = readFileSync(file);
    if (IMAGE_EXT.has(ext)) {
      for (const m of imageMetadata(buf, ext)) add(rel, { rule: 'image-metadata', line: 0, raw: m });
      continue;
    }
    const text = buf.toString(buf.includes(0) ? 'latin1' : 'utf8');
    for (const a of scanText(text, rules, meta.noreply)) add(rel, a);
    if (path.basename(file) === 'package.json') for (const a of packageFieldAlerts(text, meta)) add(rel, a);
  }
  return { files: files.length, alerts, allowed };
}

/** Résumé : nombre d'alertes par dossier de premier niveau (docs/briefs compte à part) et par règle. */
export function summarize(alerts) {
  const byPlace = new Map();
  for (const a of alerts) {
    const parts = a.file.split('/');
    const place = parts.length === 1 ? '(racine)' : parts[0] === 'docs' && parts.length > 2 ? `docs/${parts[1]}` : parts[0];
    const row = byPlace.get(place) ?? {};
    row[a.rule] = (row[a.rule] ?? 0) + 1;
    byPlace.set(place, row);
  }
  return [...byPlace.entries()].sort(([a], [b]) => a.localeCompare(b));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--')) ?? ROOT;
  try {
    const { files, alerts, allowed } = scanDir(dir);
    if (args.includes('--json')) {
      console.log(JSON.stringify({ files, allowed, alerts: alerts.map(({ raw, ...a }) => a) }, null, 2));
    } else if (args.includes('--summary')) {
      for (const [place, row] of summarize(alerts)) console.log(`${place} : ${Object.entries(row).map(([r, n]) => `${r} ${n}`).join(', ')}`);
    } else {
      for (const a of alerts) console.log(`${a.file}:${a.line} ${a.rule} ${a.excerpt}`);
    }
    if (!args.includes('--json')) console.log(`scan-public : ${files} fichiers, ${alerts.length} alerte(s), ${allowed} exception(s) appliquée(s)`);
    process.exit(alerts.length === 0 ? 0 : 1);
  } catch (e) {
    console.error(`scan-public : ${e.message}`);
    process.exit(2);
  }
}
