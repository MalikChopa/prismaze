// Outils de la copie publique : scan (motifs, métadonnées, exceptions), liste blanche de l'export, copie écrite (0 alerte), LICENSE, README.
// Les fixtures sensibles sont assemblées par concaténation : ce fichier est exporté et scanné comme les autres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanDir, imageMetadata, loadAllow } from '../../tools/scan-public.mjs';
import { listExport, writeExport, WHITELIST, TESTS_NEEDING_PRIVATE_FILES } from '../../tools/export-public.mjs';
import { checkReadme, MAX_JPEG_BYTES, JPEGS, GIF } from '../../tools/check-readme.mjs';
import { listFiles } from '../../tools/gen-sw.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOREPLY = 'fake' + '@users.' + 'noreply.example.com';
const META = { author: `Fake <${NOREPLY}>`, noreply: [NOREPLY] };
const NO_IDENTITY = { names: [], homes: [] };
const ESSAI = 'Essai <essai' + '@users.noreply.github.com>';

function tempDir() { return mkdtempSync(path.join(os.tmpdir(), 'prismaze-public-')); }
function withDir(files, body) {
  const dir = tempDir();
  try {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), content);
    }
    return body(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const noAllow = (dir) => path.join(dir, 'absent.json');
const scan = (dir, identity = NO_IDENTITY) => scanDir(dir, { meta: META, identity, allowFile: noAllow(dir) });
const rulesOf = (text, identity) => withDir({ 'a.txt': text }, (d) => scan(d, identity).alerts.map((a) => a.rule));

const FIXTURES = {
  'windows-path': 'C:' + '\\' + 'Users' + '\\' + 'quelquun\\x',
  'unix-path': 'voir /' + 'home/' + 'quelquun/projet',
  email: 'ecrire a ' + 'alice' + '@' + 'exemple.org',
  'github-token': 'gh' + 'p_' + 'a'.repeat(36),
  'github-pat': 'github' + '_pat_' + 'b'.repeat(22),
  'openai-style-key': 's' + 'k-' + 'c'.repeat(24),
  'aws-key': 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP',
  'slack-token': 'xo' + 'xb-' + '123',
  'private-key': 'BEGIN PRIVATE' + ' KEY',
  'secret-assignment': 'pass' + 'word = "' + 'abcdefghijklmnopqrst"',
};

for (const [rule, text] of Object.entries(FIXTURES)) {
  test(`scan : détecte ${rule}`, () => { assert.ok(rulesOf(text).includes(rule), rule); });
}

test('scan : chemin Windows dans une chaîne JSON échappée et chemin Git Bash', () => {
  assert.ok(rulesOf(JSON.stringify('D:' + '\\' + 'Users' + '\\' + 'x')).includes('windows-path'));
  assert.ok(rulesOf('cd /c/' + 'Users/' + 'x/y').includes('unix-path'));
});

test('scan : identité de la machine et dossier personnel lus à l\'exécution, nom de fichier compris', () => {
  const identity = { names: ['Fictif' + '-Nom'], homes: ['Z:/' + 'Dossier' + '/Fictif'] };
  assert.ok(rulesOf('auteur : fictif' + '-nom', identity).includes('machine-identity'));
  assert.ok(rulesOf('Z:/' + 'Dossier' + '/Fictif/a', identity).includes('home-folder'));
  withDir({ ['Fictif' + '-Nom.txt']: 'rien' }, (d) => {
    assert.deepEqual(scan(d, identity).alerts.map((a) => a.rule), ['machine-identity-filename']);
  });
});

test('scan : pas de fausse alerte (paquet@version, @2x, sk- dans un mot, adresse noreply publique)', () => {
  const clean = ['paquet' + '@1.64.1', 'icone' + '@2x.png', 'task-force risk-' + 'x'.repeat(30), NOREPLY, 'https://exemple.org/home/x', 'const key = 1;'].join('\n');
  assert.deepEqual(rulesOf(clean), []);
});

test('scan : champs author et repository de package.json', () => {
  withDir({ 'package.json': JSON.stringify({ name: 'x', author: 'Quelqu Un', repository: 'github:quelquun/x' }) }, (d) => {
    assert.equal(scan(d).alerts.filter((a) => a.rule === 'package-field').length, 2);
  });
  withDir({ 'package.json': JSON.stringify({ name: 'x', repository: 'https://github.com/<utilisateur>/x' }) }, (d) => {
    assert.deepEqual(scan(d).alerts, []);
  });
});

/** PNG minimal (signature, puis des morceaux sans CRC vérifié par le scan). */
function png(extraChunks = []) {
  const chunk = (type, data = Buffer.alloc(0)) => {
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    return Buffer.concat([head, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', Buffer.alloc(13)), ...extraChunks.map((t) => chunk(t, Buffer.from('x'))), chunk('IEND')]);
}

test('scan : métadonnées d\'images (PNG tEXt, JPEG commentaire et Exif, GIF commentaire)', () => {
  assert.deepEqual(imageMetadata(png(), '.png'), []);
  assert.deepEqual(imageMetadata(png(['tEXt']), '.png'), ['PNG tEXt']);
  const jpeg = (marker, body) => {
    const len = Buffer.alloc(2); len.writeUInt16BE(body.length + 2);
    return Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, marker]), len, Buffer.from(body, 'latin1'), Buffer.from([0xFF, 0xD9])]);
  };
  assert.deepEqual(imageMetadata(jpeg(0xFE, 'bonjour'), '.jpg'), ['JPEG commentaire']);
  assert.deepEqual(imageMetadata(jpeg(0xE1, 'Exif\0\0'), '.jpg'), ['JPEG APP1 Exif']);
  assert.deepEqual(imageMetadata(jpeg(0xE0, 'JFIF\0'), '.jpg'), []);
  const gifHead = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([1, 0, 1, 0, 0, 0, 0])]);
  const comment = Buffer.concat([gifHead, Buffer.from([0x21, 0xFE, 2, 0x41, 0x42, 0, 0x3B])]);
  assert.deepEqual(imageMetadata(comment, '.gif'), ['GIF commentaire']);
  assert.deepEqual(imageMetadata(Buffer.concat([gifHead, Buffer.from([0x3B])]), '.gif'), []);
  withDir({ 'a.png': png(['iTXt']) }, (d) => assert.equal(scan(d).alerts[0].rule, 'image-metadata'));
});

test('scan : une exception s\'applique et exige une raison', () => {
  withDir({ 'a.txt': FIXTURES.email, 'allow.json': JSON.stringify([{ file: 'a.txt', rule: 'email', reason: 'adresse fictive du test' }]) }, (d) => {
    const r = scanDir(d, { meta: META, identity: NO_IDENTITY, allowFile: path.join(d, 'allow.json') });
    assert.deepEqual([r.alerts.filter((a) => a.file === 'a.txt').length, r.allowed], [0, 1]);
  });
  withDir({ 'allow.json': JSON.stringify([{ file: 'a.txt', rule: 'email' }]) }, (d) => {
    assert.throws(() => loadAllow(path.join(d, 'allow.json')), /raison/);
  });
});

test('scan : les fichiers de scan-allow.json du dépôt ont tous une raison', () => {
  assert.ok(Array.isArray(loadAllow(path.join(REPO, 'tools', 'scan-allow.json'))));
});

const { files: exported } = listExport(REPO);

test('export : la liste suit la liste blanche, rien d\'autre', () => {
  const allowed = (f) => WHITELIST.some((e) => (e.file && e.file === f)
    || (e.dir && f.startsWith(`${e.dir}/`))
    || (e.glob && path.posix.dirname(f) === e.glob && f.endsWith(e.ext)));
  assert.deepEqual(exported.filter((f) => !allowed(f)), []);
  for (const e of WHITELIST) if (e.file && existsSync(path.join(REPO, e.file))) assert.ok(exported.includes(e.file), e.file);
});

test('export : ni briefs, ni docs privés, ni e2e, ni niveaux de travail, ni réglages locaux', () => {
  const forbidden = [/^docs\/(?!media\/)/, /^tools\/e2e\//, /^levels\/_/, /^levels-/, /^CLAUDE\.md$/, /^\.claude\//, /^export\//, /^\.tmp\//, /node_modules\//];
  for (const re of forbidden) assert.deepEqual(exported.filter((f) => re.test(f)), [], String(re));
});

test('export : tout ce qu\'il faut au jeu est là (précache complet, 50 niveaux avec preuves, défi du jour)', () => {
  const list = new Set(exported);
  for (const f of listFiles(REPO)) assert.ok(list.has(f), f);
  for (const f of ['sw.js', 'index.html', 'manifest.webmanifest', 'levels/index.json', 'LICENSE']) assert.ok(list.has(f), f);
  const chapters = JSON.parse(readFileSync(path.join(REPO, 'levels', 'index.json'), 'utf8')).chapters;
  const ids = chapters.flatMap((c) => c.levels);
  assert.equal(ids.length, 50);
  for (const id of ids) {
    assert.ok(list.has(`levels/${id}.json`), id);
    assert.ok(exported.some((f) => f.startsWith('levels/proofs/') && f.includes(id)), `preuve ${id}`);
  }
  assert.ok(exported.some((f) => f.startsWith('levels/daily-pool/')));
});

test('export : aucun test exporté ne lit un fichier retiré de la copie', () => {
  for (const f of TESTS_NEEDING_PRIVATE_FILES) assert.ok(!exported.includes(f), f);
  const needs = /levels\/_(?:v1|pilots)/;
  for (const f of exported.filter((x) => x.startsWith('tests/') && x.endsWith('.test.mjs') && x !== 'tests/public/public-tools.test.mjs')) {
    const code = readFileSync(path.join(REPO, f), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(code, needs, f);
  }
});

test('export à blanc : n\'écrit rien (aucun dossier de copie créé)', () => {
  const out = execFileSync(process.execPath, [path.join(REPO, 'tools', 'export-public.mjs')], { cwd: REPO, encoding: 'utf8' });
  assert.match(out, /à blanc/);
  assert.equal(out.includes('prismaze-public/'), false);
});

function hasGit() { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } }

test('export écrit : 0 alerte (outils compris), historique neuf d\'un seul commit, identité noreply, aucun dépôt distant', { skip: !hasGit() }, () => {
  const name = `essai-${process.pid}`;
  const target = path.join(REPO, 'export', name);
  try {
    const r = writeExport({ root: REPO, target, allowNoMedia: true, author: ESSAI });
    assert.deepEqual(r.scan.alerts.map((a) => `${a.file}:${a.rule}`), []);
    assert.equal(typeof r.swFresh, 'boolean');
    const git = (args) => execFileSync('git', args, { cwd: target, encoding: 'utf8' }).trim();
    assert.equal(git(['rev-list', '--count', 'HEAD']), '1');
    assert.equal(git(['log', '-1', '--format=%an <%ae>']), ESSAI);
    assert.equal(git(['log', '-1', '--format=%cn <%ce>']), ESSAI);
    assert.equal(git(['remote']), '');
    assert.equal(existsSync(path.join(target, 'CLAUDE.md')), false);
    assert.equal(existsSync(path.join(target, 'tools', 'e2e')), false);
    assert.equal(existsSync(path.join(target, 'docs', 'briefs')), false);
    assert.equal(readFileSync(path.join(target, '.gitignore'), 'utf8').includes('levels-'), false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('export : refuse une cible hors de export/ et une adresse sans noreply', () => {
  assert.throws(() => writeExport({ root: REPO, target: path.join(REPO, 'src', 'x'), allowNoMedia: true }), /sous export/);
  assert.throws(() => writeExport({ root: REPO, target: path.join(REPO, 'export', 'x'), allowNoMedia: true, author: 'A <a' + '@exemple.org>' }), /noreply/);
});

test('LICENSE : texte officiel de la GPL-3.0 (en-tête, fin des conditions, taille de référence)', () => {
  const text = readFileSync(path.join(REPO, 'LICENSE'), 'latin1').replace(/\r\n/g, '\n');
  assert.equal(Buffer.byteLength(text, 'latin1'), 35147);
  assert.match(text, /GNU GENERAL PUBLIC LICENSE\n\s+Version 3, 29 June 2007/);
  assert.match(text, /END OF TERMS AND CONDITIONS/);
});

test('check-readme : les README du dépôt passent (médias non contrôlés)', () => {
  assert.deepEqual(checkReadme({ root: REPO, media: false }).defects, []);
});

function readmeFixture(mutate = (s) => s) {
  const files = {};
  for (const name of ['README.md', 'README.en.md']) files[name] = mutate(readFileSync(path.join(REPO, name), 'utf8'), name);
  files.LICENSE = 'x';
  return files;
}

test('check-readme : une section ou un lien de langue manquant est signalé', () => {
  withDir(readmeFixture((s, n) => (n === 'README.md' ? s.replace('## Commandes', '## Divers').replace('(README.en.md)', '(x.md)') : s)), (d) => {
    const { defects } = checkReadme({ root: d, media: false });
    assert.ok(defects.some((x) => /section manquante : commandes/.test(x)));
    assert.ok(defects.some((x) => /autre langue/.test(x)));
  });
});

test('check-readme : lancement de plus de 3 lignes, lien vers un document privé, autre texte à remplacer', () => {
  const mutate = (s, n) => (n === 'README.md'
    ? s.replace('node tools/serve.mjs\n```', 'npm i\nnode tools/serve.mjs\n```').replace('## Licence', 'Voir [certif](docs/CERTIF_NIVEAUX.md), <votre-nom>.\n\n## Licence')
    : s);
  withDir(readmeFixture(mutate), (d) => {
    const { defects } = checkReadme({ root: d, media: false });
    assert.ok(defects.some((x) => /trop long/.test(x)));
    assert.ok(defects.some((x) => /document privé/.test(x)));
    assert.ok(defects.some((x) => /non autorisé/.test(x)));
  });
});

test('check-readme : la liste « non testé » doit nommer Safari, Firefox, téléphones, lecteurs d\'écran, photosensibilité', () => {
  withDir(readmeFixture((s, n) => (n === 'README.en.md' ? s.replace('**Safari** and **Firefox**', 'Some browsers').replace('- **Photosensitivity**', '- **Flashes**').replace('home-made analysis', 'tool') : s)), (d) => {
    const { defects } = checkReadme({ root: d, media: false });
    for (const word of ['Safari', 'Firefox', 'photosensitiv']) assert.ok(defects.some((x) => x.includes('non testé') && x.includes(word)), word);
  });
});

test('check-readme : médias exigés sans --no-media, poids JPEG limité, signature contrôlée', () => {
  const jpeg = (n) => Buffer.concat([Buffer.from([0xFF, 0xD8]), Buffer.alloc(n)]);
  withDir(readmeFixture(), (d) => {
    assert.equal(checkReadme({ root: d, media: true }).defects.filter((x) => /média absent/.test(x)).length, 4);
    assert.equal(checkReadme({ root: d, media: false }).defects.length, 0);
    mkdirSync(path.join(d, 'docs', 'media'), { recursive: true });
    for (const f of JPEGS) writeFileSync(path.join(d, f), jpeg(10));
    writeFileSync(path.join(d, GIF), Buffer.from('GIF89a..', 'latin1'));
    const ok = checkReadme({ root: d, media: true });
    assert.deepEqual(ok.defects, []);
    assert.ok(ok.sizes[GIF] > 0);
    writeFileSync(path.join(d, JPEGS[0]), jpeg(MAX_JPEG_BYTES + 1));
    writeFileSync(path.join(d, GIF), Buffer.from('nope', 'latin1'));
    const bad = checkReadme({ root: d, media: true }).defects;
    assert.ok(bad.some((x) => /trop lourd/.test(x)));
    assert.ok(bad.some((x) => /pas un GIF/.test(x)));
  });
});
