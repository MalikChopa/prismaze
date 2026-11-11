// verify-levels v2 : F3 (index), V1-V15, S6 (preuves), refus des preuves périmées ou altérées, courbe C1 (J3).
// Les essais travaillent sur des copies dans un dossier temporaire ; le dépôt n'est jamais modifié.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyLevels, formatReport, formatProof, formatLevel, levelHashHex, canonicalJson, curveSlot, curveErrors, curveWarnings, CURVE, TUTORIAL_EXEMPT,
} from '../../tools/verify-levels.mjs';
import { canonicalLevelText, validateLevel } from '../../src/engine/level.js';
import { readFixture } from './helpers.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const exemple = () => readFixture('v2/valid/x00-exemple.json');
const stripped = (lv) => { const c = { ...lv }; delete c.par; delete c.solutions; return c; };

/** Dossier temporaire avec levels/index.json (un chapitre) et les niveaux donnés {id: objet niveau}. */
function makeRoot(levels, { chapters } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'prismaze-vl-'));
  mkdirSync(path.join(root, 'levels'), { recursive: true });
  const ids = Object.keys(levels);
  const idx = { format: 2, chapters: chapters ?? [{ id: 'essai', name: 'Essai', levels: ids }] };
  writeFileSync(path.join(root, 'levels', 'index.json'), JSON.stringify(idx));
  for (const [id, lv] of Object.entries(levels)) writeFileSync(path.join(root, 'levels', `${id}.json`), JSON.stringify({ ...lv, id }, null, 1));
  return root;
}
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const proofPath = (root, id) => path.join(root, 'levels', 'proofs', `${id}.proof.json`);
const levelPath = (root, id) => path.join(root, 'levels', `${id}.json`);
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const cleanup = (root) => rmSync(root, { recursive: true, force: true });
const messages = (rep) => rep.levels.flatMap((l) => l.errors).concat(rep.errors).join(' | ');

/** Racine avec x00-exemple dont la preuve vient d'être écrite par --update. */
function provenRoot(extra = {}) {
  const root = makeRoot({ 'x00-exemple': stripped(exemple()), ...extra });
  const rep = verifyLevels({ root, update: true });
  assert.equal(rep.ok, true, formatReport(rep));
  return root;
}

test('dépôt réel : code 0 (index v2 vide pour l\'instant, ou niveaux tous prouvés)', () => {
  const r = spawnSync(process.execPath, ['tools/verify-levels.mjs'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /niveau\(x\), 0 erreur\(s\)/);
});

test('options : inconnue -> code 2 ; --dry-run sans --update -> code 2', () => {
  const a = spawnSync(process.execPath, ['tools/verify-levels.mjs', '--nimporte'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(a.status, 2);
  const b = spawnSync(process.execPath, ['tools/verify-levels.mjs', '--dry-run'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(b.status, 2);
});

test('--update : écrit par, solutions et la preuve S6 ; le niveau écrit passe V1-V15 en mode livré ; le contrôle simple passe', () => {
  const root = provenRoot();
  try {
    const lv = readJson(levelPath(root, 'x00-exemple'));
    assert.equal(lv.par, 1);
    assert.deepEqual(lv.solutions, [[{ type: 'mirror', at: [2, 0], o: '/' }]]);
    assert.equal(validateLevel(lv, { mode: 'shipped', expectedId: 'x00-exemple' }).ok, true);
    const proof = readJson(proofPath(root, 'x00-exemple'));
    assert.equal(proof.format, 2);
    assert.equal(proof.levelId, 'x00-exemple');
    assert.equal(proof.levelHash, `sha256:${createHash('sha256').update(canonicalLevelText(lv)).digest('hex')}`);
    assert.equal(proof.status, 'proved-optimal');
    assert.equal(proof.minimum, 1);
    assert.equal(proof.solutionsAtMin, 1);
    assert.deepEqual(proof.witness, [{ type: 'mirror', at: [2, 0], o: '/' }]);
    assert.equal(proof.parking.length, 1);
    assert.equal(proof.metrics.nodes, 32);
    assert.equal(proof.metrics.movable, 2);
    assert.equal(verifyLevels({ root }).ok, true);
    const cli = spawnSync(process.execPath, ['tools/verify-levels.mjs', '--root', root], { cwd: REPO, encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stdout);
    assert.match(cli.stdout, /x00-exemple +min=1 K=2 solutions=1 noeuds=32/);
  } finally { cleanup(root); }
});

test('--update deux fois : fichiers de niveau et de preuve identiques octet pour octet (SHA-256), aucune modification annoncée', () => {
  const root = provenRoot();
  try {
    const before = [sha(levelPath(root, 'x00-exemple')), sha(proofPath(root, 'x00-exemple'))];
    const rep = verifyLevels({ root, update: true });
    assert.equal(rep.ok, true);
    assert.deepEqual(rep.changes, []);
    assert.deepEqual([sha(levelPath(root, 'x00-exemple')), sha(proofPath(root, 'x00-exemple'))], before);
    const text = readFileSync(proofPath(root, 'x00-exemple'), 'utf8');
    assert.ok(!text.includes('\r'));
    assert.ok(text.endsWith('}\n'));
    assert.doesNotMatch(text, /\d{4}-\d\d-\d\dT/, 'aucun horodatage');
    assert.equal(formatProof(JSON.parse(text)), text);
    const lvText = readFileSync(levelPath(root, 'x00-exemple'), 'utf8');
    assert.equal(formatLevel(JSON.parse(lvText)), lvText);
  } finally { cleanup(root); }
});

test('--update --dry-run : liste les modifications sans rien écrire', () => {
  const root = makeRoot({ 'x00-exemple': stripped(exemple()) });
  try {
    const before = sha(levelPath(root, 'x00-exemple'));
    const rep = verifyLevels({ root, update: true, dryRun: true });
    assert.equal(rep.changes.length, 2);
    assert.match(rep.changes[0], /x00-exemple\.json : par=1/);
    assert.match(rep.changes[1], /proof\.json/);
    assert.equal(sha(levelPath(root, 'x00-exemple')), before);
    assert.equal(existsSync(path.join(root, 'levels', 'proofs')), false);
  } finally { cleanup(root); }
});

test('sans preuve : échec V14 ; la preuve manquante est créée par --update', () => {
  const root = provenRoot();
  try {
    rmSync(proofPath(root, 'x00-exemple'));
    const rep = verifyLevels({ root });
    assert.equal(rep.ok, false);
    assert.match(messages(rep), /preuve absente/);
    assert.equal(verifyLevels({ root, update: true }).ok, true);
    assert.equal(verifyLevels({ root }).ok, true);
  } finally { cleanup(root); }
});

test('preuve altérée : minimum changé, témoin changé, métrique changée, garage supprimé -> refusée (V14, rejeu et recalcul)', () => {
  const root = provenRoot();
  try {
    const file = proofPath(root, 'x00-exemple');
    const original = readJson(file);
    const attempts = {
      minimum: (p) => { p.minimum = 2; },
      témoin: (p) => { p.witness = [{ type: 'mirror', at: [3, 0], o: '/' }]; },
      métrique: (p) => { p.metrics.nodes = 33; },
      'garage supprimé': (p) => { p.parking = []; },
      statut: (p) => { p.status = 'unknown'; },
      'clé en trop': (p) => { p.extra = 1; },
    };
    for (const [name, mutate] of Object.entries(attempts)) {
      const p = JSON.parse(JSON.stringify(original));
      mutate(p);
      writeFileSync(file, formatProof(p));
      const rep = verifyLevels({ root });
      assert.equal(rep.ok, false, name);
      assert.match(messages(rep), /V14/, name);
    }
    writeFileSync(file, formatProof(original));
    assert.equal(verifyLevels({ root }).ok, true);
  } finally { cleanup(root); }
});

test('preuve périmée : le niveau a changé (hachage), puis rulesVersion, puis solverVersion', () => {
  const root = provenRoot();
  try {
    const lvFile = levelPath(root, 'x00-exemple');
    const lv = readJson(lvFile);
    lv.pieces.push({ type: 'wall', at: [7, 3] }); // case libre : le niveau reste valide, mais le hachage change
    writeFileSync(lvFile, formatLevel(lv));
    let rep = verifyLevels({ root });
    assert.equal(rep.ok, false);
    assert.match(messages(rep), /hachage différent|le niveau a changé/);
    const root2 = provenRoot();
    try {
      for (const [key, re] of [['rulesVersion', /rulesVersion/], ['solverVersion', /solverVersion/]]) {
        const f = proofPath(root2, 'x00-exemple');
        const p = readJson(f);
        const orig = p[key];
        p[key] = 1;
        writeFileSync(f, formatProof(p));
        rep = verifyLevels({ root: root2 });
        assert.equal(rep.ok, false, key);
        assert.match(messages(rep), re, key);
        p[key] = orig;
        writeFileSync(f, formatProof(p));
      }
      assert.equal(verifyLevels({ root: root2 }).ok, true);
    } finally { cleanup(root2); }
  } finally { cleanup(root); }
});

test('preuve illisible : échec', () => {
  const root = provenRoot();
  try {
    writeFileSync(proofPath(root, 'x00-exemple'), '{ pas du json');
    const rep = verifyLevels({ root });
    assert.equal(rep.ok, false);
    assert.match(messages(rep), /preuve illisible/);
  } finally { cleanup(root); }
});

test('par du fichier différent du minimum prouvé : échec ; solutions qui ne gagnent pas : échec (V13)', () => {
  const root = provenRoot();
  try {
    const lvFile = levelPath(root, 'x00-exemple');
    const lv = readJson(lvFile);
    writeFileSync(lvFile, formatLevel({ ...lv, par: 2 }));
    assert.equal(verifyLevels({ root }).ok, false);
    writeFileSync(lvFile, formatLevel({ ...lv, solutions: [[{ type: 'mirror', at: [3, 3], o: '/' }]] }));
    const rep = verifyLevels({ root });
    assert.equal(rep.ok, false);
    assert.match(messages(rep), /V13/);
  } finally { cleanup(root); }
});

test('F3 : fichier non indexé, id sans fichier et id en double sont des échecs', () => {
  const root = provenRoot();
  try {
    writeFileSync(path.join(root, 'levels', 'zzz-orphelin.json'), '{}');
    let rep = verifyLevels({ root });
    assert.equal(rep.ok, false);
    assert.match(rep.errors.join(' | '), /fichier non indexé : levels\/zzz-orphelin\.json/);
    rmSync(path.join(root, 'levels', 'zzz-orphelin.json'));
    writeFileSync(path.join(root, 'levels', 'index.json'), JSON.stringify({ format: 2, chapters: [{ id: 'essai', name: 'Essai', levels: ['x00-exemple', 'x99-fantome'] }] }));
    rep = verifyLevels({ root });
    assert.equal(rep.ok, false);
    assert.match(messages(rep), /id de l'index sans fichier levels\/x99-fantome\.json/);
    writeFileSync(path.join(root, 'levels', 'index.json'), JSON.stringify({ format: 2, chapters: [{ id: 'essai', name: 'Essai', levels: ['x00-exemple', 'x00-exemple'] }] }));
    rep = verifyLevels({ root });
    assert.equal(rep.ok, false);
    assert.match(rep.errors.join(' | '), /I_DUPLICATE/);
  } finally { cleanup(root); }
});

test('preuve orpheline : avertissement seulement', () => {
  const root = provenRoot();
  try {
    writeFileSync(proofPath(root, 'x77-disparu'), readFileSync(proofPath(root, 'x00-exemple')));
    const rep = verifyLevels({ root });
    assert.equal(rep.ok, true);
    assert.match(rep.warnings.join(' | '), /preuve orpheline/);
  } finally { cleanup(root); }
});

test('V10 : niveau déjà gagné au départ -> échec ; V2 : id différent du nom de fichier -> échec', () => {
  const won = stripped(exemple());
  won.pieces = won.pieces.map((p) => (p.type === 'mirror' && p.at[0] === 1 ? { ...p, at: [2, 0], o: '/' } : p)); // le miroir (1,3) va en (2,0), bien orienté
  const root = makeRoot({ 'x00-exemple': won });
  try {
    const rep = verifyLevels({ root, update: true });
    assert.equal(rep.ok, false);
    assert.match(messages(rep), /V10_ALREADY_WON|V5_OVERLAP/);
  } finally { cleanup(root); }
  const root2 = makeRoot({ 'x00-exemple': stripped(exemple()) });
  try {
    const f = levelPath(root2, 'x00-exemple');
    writeFileSync(f, JSON.stringify({ ...stripped(exemple()), id: 'x00-autre' }));
    const rep = verifyLevels({ root: root2, update: true });
    assert.equal(rep.ok, false);
    assert.match(messages(rep), /V2_ID_NAME/);
  } finally { cleanup(root2); }
});

test('plateau au-delà de 10x8 (P8) : refusé', () => {
  const big = stripped(exemple());
  big.size = [11, 6];
  const root = makeRoot({ 'x00-exemple': big });
  try {
    const rep = verifyLevels({ root, update: true });
    assert.equal(rep.ok, false);
    assert.match(messages(rep), /plafond 10x8/);
  } finally { cleanup(root); }
});

test('plafonds : plus de nœuds que --max-nodes -> statut unknown refusé ; plus de solutions que le plafond -> refusé', () => {
  const root = makeRoot({ 'x00-exemple': stripped(exemple()) });
  try {
    const a = verifyLevels({ root, update: true, maxNodes: 5 });
    assert.equal(a.ok, false);
    assert.match(messages(a), /statut unknown/);
    assert.equal(existsSync(proofPath(root, 'x00-exemple')), false, 'aucune preuve écrite pour un niveau refusé');
  } finally { cleanup(root); }
  const mq = { ...readFixture('maquette-07.v2.json') };
  delete mq.id;
  const root2 = makeRoot({ 'maquette-07': mq });
  try {
    const b = verifyLevels({ root: root2, update: true, maxSolutions: 3 });
    assert.equal(b.ok, false);
    assert.match(messages(b), /plus de 3 solutions minimales/);
    assert.equal(verifyLevels({ root: root2, update: true }).ok, true, 'avec le plafond normal (256) : accepté');
  } finally { cleanup(root2); }
});

test('plus de 6 pièces mobiles avec un type spécial : refusé (S5)', () => {
  const lv = stripped(exemple());
  for (let i = 0; i < 5; i++) lv.pieces.push({ type: 'prism', at: [[0, 1, 2, 3, 5][i], 2] });
  const root = makeRoot({ 'x00-exemple': lv });
  try {
    const rep = verifyLevels({ root, update: true, maxNodes: 200000 });
    assert.equal(rep.ok, false);
    assert.match(messages(rep), /pièces mobiles : au plus 6/);
  } finally { cleanup(root); }
});

test('mode --dir : vérifie les *.json d\'un dossier sans index ni courbe, preuves dans <dossier>/proofs/', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'prismaze-vl-'));
  try {
    mkdirSync(path.join(root, 'pilotes'));
    writeFileSync(path.join(root, 'pilotes', 'm01-exemple.json'), JSON.stringify({ ...stripped(exemple()), id: 'm01-exemple' }));
    const rep = verifyLevels({ root, dir: 'pilotes', update: true });
    assert.equal(rep.ok, true, formatReport(rep));
    assert.ok(existsSync(path.join(root, 'pilotes', 'proofs', 'm01-exemple.proof.json')));
    assert.equal(verifyLevels({ root, dir: 'pilotes' }).ok, true);
  } finally { cleanup(root); }
});

// ---- Courbe C1

test('C1 : le chapitre et le rang se lisent dans l\'id (m01 à x10) ; autres ids ignorés', () => {
  assert.deepEqual(curveSlot('m01-tourner'), { chapter: 'm', rank: 1 });
  assert.deepEqual(curveSlot('x10'), { chapter: 'x', rank: 10 });
  assert.equal(curveSlot('x00-exemple'), null);
  assert.equal(curveSlot('x11-trop'), null);
  assert.equal(curveSlot('z01-nul'), null);
  assert.equal(curveSlot('pilote-1'), null);
  assert.deepEqual(TUTORIAL_EXEMPT, ['p01', 's01', 'c03']);
});

test('C1 : bandes de minimum par rang (tableau de C1), tutoriels p01, s01, c03 exemptés de la borne basse', () => {
  const ok = { minimum: 1, K: 3, nodes: 100, solutionsAtMin: 1 };
  assert.deepEqual(curveErrors('m01-a', ok), []);
  assert.equal(curveErrors('m01-a', { ...ok, minimum: 2 }).length, 1);
  assert.deepEqual(curveErrors('m10-a', { ...ok, minimum: 6, K: 8 }), []);
  assert.equal(curveErrors('m10-a', { ...ok, minimum: 7, K: 8 }).length, 1);
  assert.equal(curveErrors('m10-a', { ...ok, minimum: 3, K: 8 }).length, 1);
  assert.deepEqual(curveErrors('p01-a', ok), [], 'tutoriel p01 : minimum 1 malgré la bande 2');
  assert.deepEqual(curveErrors('s01-a', ok), []);
  assert.deepEqual(curveErrors('c03-a', ok), []);
  assert.equal(curveErrors('p02-a', ok).length, 1, 'p02 n\'est pas exempté');
  assert.equal(curveErrors('p01-a', { ...ok, minimum: 3 }).length, 1, 'p01 : au plus la borne haute de la bande');
  const bands = Object.fromEntries(Object.entries(CURVE).map(([k, v]) => [k, v.bands.map((b) => b.join('-')).join(' ')]));
  assert.deepEqual(bands, { m: '1-1 1-2 2-3 3-4 4-6', c: '1-1 2-2 3-3 3-4 4-5', p: '2-2 3-3 3-4 4-4 4-5', s: '2-2 3-3 3-4 4-4 4-5', x: '4-4 4-5 5-5 5-5 5-6' });
});

test('C1 : mobiles, nœuds et solutions par chapitre', () => {
  const base = { K: 6, nodes: 1000, solutionsAtMin: 2 };
  assert.deepEqual(curveErrors('x03-a', { ...base, minimum: 5 }), []);
  assert.equal(curveErrors('x03-a', { ...base, minimum: 5, K: 7 }).length, 1, 'chapitre 5 : 6 mobiles au plus');
  assert.equal(curveErrors('m05-a', { ...base, minimum: 2, K: 9 }).length, 1, 'chapitre 1 : 8 mobiles au plus');
  assert.equal(curveErrors('m05-a', { ...base, minimum: 2, K: 8 }).length, 0);
  assert.equal(curveErrors('c05-a', { ...base, minimum: 3, nodes: 100001 }).length, 1, 'chapitre 2 : 100 000 nœuds');
  assert.equal(curveErrors('p05-a', { ...base, minimum: 3, nodes: 300001 }).length, 1);
  assert.equal(curveErrors('s05-a', { ...base, minimum: 3, nodes: 500001 }).length, 1);
  assert.equal(curveErrors('x05-a', { ...base, minimum: 5, nodes: 2000000 }).length, 0);
  assert.equal(curveErrors('m05-a', { ...base, minimum: 2, solutionsAtMin: 5 }).length, 1, 'chapitre 1 : 1 à 4 solutions');
  assert.equal(curveErrors('c05-a', { ...base, minimum: 3, solutionsAtMin: 4 }).length, 1, 'chapitre 2 : 1 à 3 solutions');
  assert.equal(curveErrors('x05-a', { ...base, minimum: 5, solutionsAtMin: 12 }).length, 0, 'chapitre 5 : jusqu a 12 solutions minimales (décision 2026-11-08)');
  assert.equal(curveErrors('x05-a', { ...base, minimum: 5, solutionsAtMin: 13 }).length, 1, 'chapitre 5 : 13 solutions refusées');
  assert.equal(curveErrors('x05-a', { ...base, minimum: 5, solutionsAtMin: 0 }).length, 1, 'chapitre 5 : 0 solution refusée');
});

test('C1 : avertissements D2 (hausse > 8, baisse > 2) et chapitre 5 (10 niveaux sur 10 peuvent avoir plus de 2 solutions : pas de limite d effectif)', () => {
  const mk = (id, ch, rank, D2, sol = 1) => ({ id, chapter: ch, rank, D2, solutionsAtMin: sol });
  const w = curveWarnings([mk('m01', 'm', 1, 10), mk('m02', 'm', 2, 25), mk('m03', 'm', 3, 21), mk('m04', 'm', 4, 20)]);
  assert.deepEqual(w.warnings.map((x) => x.id), ['m02', 'm03']);
  assert.match(w.warnings[0].message, /monte de 15\.0/);
  assert.match(w.warnings[1].message, /baisse de 4\.0/);
  assert.deepEqual(w.errors, []);
  const many = Array.from({ length: 10 }, (_, i) => mk(`x${String(i + 1).padStart(2, '0')}`, 'x', i + 1, 30 + i, i < 4 ? 5 : 1));
  assert.deepEqual(curveWarnings(many).errors, [], '4 niveaux sur 10 à plus de 2 solutions : accepté');
  assert.deepEqual(curveWarnings(many.map((x) => ({ ...x, solutionsAtMin: 12 }))).errors, [], '10 niveaux sur 10 à 12 solutions : accepté');
});

test('C1 : un niveau d\'un chapitre hors bande est refusé par verify-levels (m09 : minimum 4 à 6 exigé)', () => {
  const root = makeRoot({ 'm09-exemple': stripped(exemple()) });
  try {
    const rep = verifyLevels({ root, update: true });
    assert.equal(rep.ok, false);
    assert.match(messages(rep), /C1 courbe : minimum 1 hors de la bande 4-6/);
  } finally { cleanup(root); }
  const root2 = makeRoot({ 'm01-exemple': stripped(exemple()) });
  try {
    assert.equal(verifyLevels({ root: root2, update: true }).ok, true);
  } finally { cleanup(root2); }
  const root3 = makeRoot({ 'p01-exemple': stripped(exemple()) });
  try {
    assert.equal(verifyLevels({ root: root3, update: true }).ok, true, 'tutoriel p01 exempté de la borne basse');
  } finally { cleanup(root3); }
});

test('utilitaires : canonicalJson trie les clés ; levelHashHex ignore id, nom, par et solutions', () => {
  assert.equal(canonicalJson({ b: [1, { z: 1, a: 2 }], a: null }), '{"a":null,"b":[1,{"a":2,"z":1}]}');
  const lv = exemple();
  assert.equal(levelHashHex(lv), levelHashHex({ ...lv, id: 'autre', name: 'autre', par: 9, solutions: [] }));
  assert.notEqual(levelHashHex(lv), levelHashHex({ ...lv, pieces: lv.pieces.slice(1) }));
});
