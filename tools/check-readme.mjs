// Vérifie les deux README avant publication : sections attendues, lancement local court, liens entre langues, liste honnête de ce qui n'est pas testé, médias.
// Usage : node tools/check-readme.mjs [--no-media]   (code de sortie : 0 tout bon, 1 défauts)
// --no-media : ne contrôle ni l'existence ni le poids de docs/media/{menu,jeu,victoire}.jpg et demo.gif (les liens restent exigés).
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLACEHOLDER = '<utilisateur>';
/** Nom GitHub réel s'il est connu (tools/repo-meta.json, champ "user") ; sinon le texte à remplacer. */
const META_PATH = path.join(ROOT, 'tools', 'repo-meta.json');
export const OWNER = (() => { try { return JSON.parse(readFileSync(META_PATH, 'utf8')).user || PLACEHOLDER; } catch { return PLACEHOLDER; } })();
export const MAX_JPEG_BYTES = 150_000;
export const JPEGS = Object.freeze(['docs/media/menu.jpg', 'docs/media/jeu.jpg', 'docs/media/victoire.jpg']);
export const GIF = 'docs/media/demo.gif';

/** Exigences par langue : [nom, expression cherchée dans les titres ou le texte, où chercher]. */
const LANG = Object.freeze({
  fr: {
    file: 'README.md', other: 'README.en.md',
    headings: [['description', /à propos|le jeu/i], ['fonctionnalités', /fonctionnalités|contenu/i], ['commandes', /commandes/i], ['lancement local', /lancer|lancement/i], ['tests', /vérifi|tests/i], ['non testé', /non test|pas test/i], ['licence', /licence/i]],
    demo: /à publier/i,
    gpl: /GPL-3\.0/,
    photo: /photosensib/i,
    phones: /téléphones? réels?|vrais? téléphones?/i,
    readers: /lecteurs? d'écran/i,
  },
  en: {
    file: 'README.en.md', other: 'README.md',
    headings: [['description', /about|the game/i], ['features', /features|what's inside/i], ['controls', /controls/i], ['local launch', /run|launch/i], ['tests', /verif|tests/i], ['not tested', /not tested|untested/i], ['license', /licen[cs]e/i]],
    demo: /to be published|not published yet/i,
    gpl: /GPL-3\.0/,
    photo: /photosensitiv/i,
    phones: /real phones?|physical phones?/i,
    readers: /screen readers?/i,
  },
});

const headingsOf = (md) => [...md.matchAll(/^#{1,4}\s+(.+)$/gm)].map((m) => m[1]);
const linksOf = (md) => [...md.matchAll(/!?\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)].map((m) => m[1]);

function sectionAfter(md, heading) {
  const start = md.indexOf(heading);
  const rest = md.slice(start + heading.length);
  const next = rest.search(/^#{1,4}\s/m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Défauts d'un README (tableau de textes ; vide = bon). */
export function checkOne(lang, md, root, owner = OWNER) {
  const spec = LANG[lang];
  const real = owner !== PLACEHOLDER;
  const host = real ? owner.toLowerCase() : PLACEHOLDER;
  const defects = [];
  const heads = headingsOf(md);
  for (const [name, re] of spec.headings) if (!heads.some((h) => re.test(h))) defects.push(`section manquante : ${name}`);

  const links = linksOf(md);
  if (!links.includes(spec.other)) defects.push(`pas de lien vers l'autre langue (${spec.other})`);
  if (!links.includes('LICENSE')) defects.push('pas de lien vers LICENSE');
  if (!spec.gpl.test(md)) defects.push('licence GPL-3.0 non citée');

  if (!md.includes(`https://${host}.github.io/`)) defects.push(`adresse de démo absente (https://${host}.github.io/...)`);
  if (!real && !spec.demo.test(md)) defects.push('il faut dire que la démo reste à publier');
  if (real && md.includes(PLACEHOLDER)) defects.push(`texte ${PLACEHOLDER} restant alors que le nom GitHub est connu (${owner})`);

  // un seul texte à remplacer est toléré : <utilisateur>, en dehors des blocs de code ou non
  const stripped = md.replace(/<!--[\s\S]*?-->/g, '').replaceAll(PLACEHOLDER, '');
  const other = stripped.match(/<(?!\/?(?:img|a|p|br|details|summary|picture|source|kbd|sub|sup|b|i|em|strong)\b)[a-zà-ÿ_-]{3,}>/gi);
  if (other) defects.push(`texte à remplacer non autorisé : ${[...new Set(other)].join(', ')}`);
  if (/\b(TODO|FIXME|XXX)\b/.test(stripped)) defects.push('marque TODO/FIXME/XXX restante');

  const launchHead = heads.find((h) => spec.headings[3][1].test(h));
  if (launchHead) {
    const block = /```[^\n]*\n([\s\S]*?)```/.exec(sectionAfter(md, launchHead));
    if (block === null) defects.push('bloc de lancement absent');
    else {
      const lines = block[1].split('\n').filter((l) => l.trim() !== '');
      if (lines.length > 3) defects.push(`bloc de lancement trop long (${lines.length} lignes, 3 au plus)`);
      if (!block[1].includes('node tools/serve.mjs')) defects.push('bloc de lancement sans « node tools/serve.mjs »');
      if (!block[1].includes(`github.com/${owner}/`)) defects.push(`bloc de lancement sans « github.com/${owner}/ »`);
    }
  }

  const notTestedHead = heads.find((h) => spec.headings[5][1].test(h));
  if (notTestedHead) {
    const text = sectionAfter(md, notTestedHead);
    for (const word of [/Safari/, /Firefox/, spec.phones, spec.readers, spec.photo]) if (!word.test(text)) defects.push(`liste « non testé » incomplète : ${word.source}`);
  }

  for (const link of links) {
    if (/^(https?:|mailto:|#)/.test(link)) continue;
    const clean = link.split('#')[0];
    if (clean.startsWith('docs/') && !clean.startsWith('docs/media/')) defects.push(`lien vers un document privé : ${link}`);
    if (!clean.startsWith('docs/media/') && !existsSync(path.join(root, clean))) defects.push(`lien cassé : ${link}`);
  }
  for (const media of [...JPEGS, GIF]) if (!links.includes(media)) defects.push(`média non référencé : ${media}`);
  return defects;
}

/** Contrôle des quatre médias : poids, signature ; renvoie défauts et poids mesurés. */
export function checkMedia(root) {
  const defects = [];
  const sizes = {};
  for (const rel of [...JPEGS, GIF]) {
    const file = path.join(root, rel);
    if (!existsSync(file)) { defects.push(`média absent : ${rel}`); continue; }
    sizes[rel] = statSync(file).size;
    const head = readFileSync(file).subarray(0, 6);
    if (rel === GIF) {
      if (head.toString('latin1', 0, 3) !== 'GIF') defects.push(`${rel} n'est pas un GIF`);
    } else {
      if (head[0] !== 0xFF || head[1] !== 0xD8) defects.push(`${rel} n'est pas un JPEG`);
      if (sizes[rel] > MAX_JPEG_BYTES) defects.push(`${rel} trop lourd : ${sizes[rel]} octets (limite ${MAX_JPEG_BYTES})`);
    }
  }
  return { defects, sizes };
}

export function checkReadme({ root = ROOT, media = true } = {}) {
  const defects = [];
  for (const lang of Object.keys(LANG)) {
    const file = path.join(root, LANG[lang].file);
    if (!existsSync(file)) { defects.push(`${LANG[lang].file} absent`); continue; }
    for (const d of checkOne(lang, readFileSync(file, 'utf8'), root)) defects.push(`${LANG[lang].file} : ${d}`);
  }
  if (!existsSync(path.join(root, 'LICENSE'))) defects.push('LICENSE absent');
  let sizes = {};
  if (media) {
    const m = checkMedia(root);
    defects.push(...m.defects);
    sizes = m.sizes;
  }
  return { defects, sizes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const media = !process.argv.includes('--no-media');
  const { defects, sizes } = checkReadme({ media });
  for (const d of defects) console.log(`DEFAUT ${d}`);
  for (const [rel, n] of Object.entries(sizes)) console.log(`${rel} : ${(n / 1024).toFixed(1)} Ko`);
  console.log(`check-readme${media ? '' : ' (médias non contrôlés)'} : ${defects.length} défaut(s)`);
  process.exit(defects.length === 0 ? 0 : 1);
}
