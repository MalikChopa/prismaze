// Modèle de l'éditeur (F6) : commandes, annuler / refaire, plafonds de F2 en direct, nom (V15 / P13), aller-retour par le lien (F4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorModel, sanitizeName, EDITOR_LIMITS } from '../../src/ui/editor-model.js';
import { encodeLevel, parseShareCode } from '../../src/engine/share.js';
import { validateLevel } from '../../src/engine/level.js';
import { solve } from '../../src/engine/solver.js';

/** Un niveau jouable construit par les commandes de l'éditeur : émetteur, cible, un miroir mobile mal placé. */
function simpleModel() {
  const m = createEditorModel({ size: [6, 4] });
  assert.equal(m.place(0, 1, { type: 'emitter', dir: 'E', mask: 'RGB' }).ok, true);
  assert.equal(m.place(5, 3, { type: 'target', need: 'RGB' }).ok, true);
  assert.equal(m.place(2, 0, { type: 'mirror', o: '-' }).ok, true);
  assert.equal(m.place(1, 3, { type: 'wall' }).ok, true);
  return m;
}

test('commandes de base : place, erase, rotate, toggleFixed ; le niveau produit passe F2 (mode partageable) et se résout', () => {
  const m = simpleModel();
  assert.deepEqual(m.problems(), []);
  assert.equal(m.valid, true);
  const lv = m.level();
  assert.equal(lv.id, 'partage');
  assert.deepEqual(lv.size, [6, 4]);
  assert.deepEqual(lv.pieces.map((p) => p.at.join(',')), ['2,0', '0,1', '1,3', '5,3'], 'triées par (ligne, colonne)');
  assert.equal(validateLevel(lv, { mode: 'shared' }).ok, true);
  const r = solve(lv);
  assert.equal(r.status, 'proved-optimal');
  // rotate : miroir -, /, |, \ ; émetteur E, N, W, S
  assert.equal(m.rotate(2, 0).ok, true);
  assert.equal(m.pieceAt(2, 0).o, '/');
  assert.equal(m.rotate(2, 0, -1).ok, true);
  assert.equal(m.pieceAt(2, 0).o, '-');
  assert.equal(m.rotate(0, 1).ok, true);
  assert.equal(m.pieceAt(0, 1).dir, 'N');
  assert.equal(m.rotate(1, 3).ok, false, 'un mur ne tourne pas');
  assert.equal(m.rotate(4, 0).ok, false, 'case vide');
  // cadenas
  assert.equal(m.toggleFixed(2, 0).ok, true);
  assert.equal(m.pieceAt(2, 0).fixed, true);
  assert.equal(m.toggleFixed(2, 0).ok, true);
  assert.equal('fixed' in m.pieceAt(2, 0), false, 'mobile = clé absente (forme canonique)');
  assert.equal(m.toggleFixed(1, 3).ok, false, 'un mur est toujours fixe');
  // gomme
  assert.equal(m.erase(1, 3).ok, true);
  assert.equal(m.pieceAt(1, 3), null);
  assert.equal(m.erase(1, 3).ok, false);
});

test('annuler / refaire : place, erase, rotate, toggleFixed, resize ; refaire se vide dès qu\'on agit', () => {
  const m = createEditorModel({ size: [5, 5] });
  assert.equal(m.canUndo, false);
  m.place(1, 1, { type: 'mirror', o: '/' });
  m.rotate(1, 1);
  m.toggleFixed(1, 1);
  m.resize(6, 5);
  m.erase(1, 1);
  assert.equal(m.cols, 6);
  const kinds = [];
  while (m.canUndo) kinds.push(m.undo().kind);
  assert.deepEqual(kinds, ['erase', 'resize', 'toggleFixed', 'rotate', 'place']);
  assert.equal(m.cols, 5);
  assert.deepEqual(m.pieces, []);
  const again = [];
  while (m.canRedo) again.push(m.redo().kind);
  assert.deepEqual(again, ['place', 'rotate', 'toggleFixed', 'resize', 'erase']);
  assert.deepEqual(m.pieces, []);
  assert.equal(m.cols, 6);
  m.undo();
  assert.equal(m.canRedo, true);
  m.place(0, 0, { type: 'wall' });
  assert.equal(m.canRedo, false, 'une nouvelle action vide « refaire »');
  assert.equal(m.undo().ok, true);
  assert.equal(createEditorModel().undo().ok, false);
  assert.equal(createEditorModel().redo().ok, false);
});

test('plafonds de F2 en direct : 3 émetteurs, 8 cibles, 4 portes, 4 paires, 2 portails par paire, 8 mobiles, 100 pièces', () => {
  const m = createEditorModel({ size: [12, 10] });
  for (let i = 0; i < 3; i++) assert.equal(m.place(i, 0, { type: 'emitter', dir: 'E', mask: 'R' }).ok, true);
  const e = m.place(3, 0, { type: 'emitter', dir: 'E', mask: 'R' });
  assert.equal(e.ok, false);
  assert.match(e.message, /3 émetteurs au plus/);
  for (let i = 0; i < 8; i++) assert.equal(m.place(i, 1, { type: 'target', need: 'R' }).ok, true);
  assert.match(m.place(8, 1, { type: 'target', need: 'R' }).message, /8 cibles au plus/);
  for (let i = 0; i < 4; i++) assert.equal(m.place(i, 2, { type: 'gate', link: [i, 1] }).ok, true);
  assert.match(m.place(4, 2, { type: 'gate', link: [0, 1] }).message, /4 portes au plus/);
  for (let pair = 0; pair < 4; pair++) assert.equal(m.place(pair, 3, { type: 'portal', pair }).ok, true);
  assert.equal(m.place(4, 3, { type: 'portal', pair: 0 }).ok, true, 'une 2e extrémité d une paire existante est permise');
  // 5e paire : il y a déjà 4 paires
  const fifth = createEditorModel({ size: [12, 10] });
  for (let pair = 0; pair < 4; pair++) fifth.place(pair, 0, { type: 'portal', pair });
  assert.equal(fifth.place(5, 5, { type: 'portal', pair: 0 }).ok, true);
  assert.equal(fifth.place(6, 5, { type: 'portal', pair: 0 }).ok, false, 'une 3e extrémité de la paire 1 est refusée');
  assert.match(fifth.place(6, 5, { type: 'portal', pair: 0 }).message, /2 portails/);
  // mobiles
  const mob = createEditorModel({ size: [12, 10] });
  for (let i = 0; i < 8; i++) assert.equal(mob.place(i, 0, { type: 'mirror', o: '-' }).ok, true);
  assert.match(mob.place(8, 0, { type: 'prism' }).message, /8 pièces mobiles au plus/);
  assert.equal(mob.place(8, 0, { type: 'prism', fixed: true }).ok, true, 'fixe : ne compte pas dans les mobiles');
  assert.equal(mob.toggleFixed(8, 0).ok, false, 'redevenir mobile ferait 9 mobiles');
  assert.equal(mob.toggleFixed(0, 0).ok, true);
  // 100 pièces
  const full = createEditorModel({ size: [12, 10] });
  let n = 0;
  for (let r = 0; r < 10 && n < 100; r++) for (let c = 0; c < 12 && n < 100; c++) { if (full.place(c, r, { type: 'wall' }).ok) n++; }
  assert.equal(n, 100);
  assert.match(full.place(0, 9, { type: 'wall' }).message ?? 'plein', /100 pièces|déjà/);
  assert.equal(full.counts().pieces, 100);
  assert.equal(EDITOR_LIMITS.pieces, 100);
});

test('grille 3 à 12 x 3 à 10 ; rétrécir refuse de perdre une pièce', () => {
  const m = createEditorModel({ size: [6, 4] });
  assert.equal(m.resize(2, 4).ok, false);
  assert.equal(m.resize(13, 4).ok, false);
  assert.equal(m.resize(6, 11).ok, false);
  assert.equal(m.resize(6, 4).ok, false, 'même taille');
  assert.equal(m.resize(12, 10).ok, true);
  m.place(11, 9, { type: 'wall' });
  const r = m.resize(6, 4);
  assert.equal(r.ok, false);
  assert.match(r.message, /1 pièce serait perdue/);
  assert.deepEqual([m.cols, m.rows], [12, 10], 'inchangée');
  m.erase(11, 9);
  assert.equal(m.resize(3, 3).ok, true);
});

test('porte : liée à une cible existante ; effacer ou remplacer la cible retire ses portes, en UNE commande annulable', () => {
  const m = createEditorModel({ size: [6, 4] });
  assert.match(m.place(1, 1, { type: 'gate', link: [5, 3] }).message, /pose d'abord une cible/);
  m.place(5, 3, { type: 'target', need: 'R' });
  m.place(2, 2, { type: 'target', need: 'G' });
  assert.equal(m.place(1, 1, { type: 'gate', link: [5, 3] }).ok, true);
  assert.equal(m.place(3, 1, { type: 'gate', link: [5, 3] }).ok, true);
  assert.equal(m.place(4, 1, { type: 'gate', link: [2, 2] }).ok, true);
  m.erase(5, 3);
  assert.deepEqual(m.pieces.filter((p) => p.type === 'gate').map((p) => p.at.join(',')), ['4,1'], 'les 2 portes de la cible effacée sont parties');
  assert.equal(m.undo().kind, 'erase');
  assert.equal(m.pieces.filter((p) => p.type === 'gate').length, 3, 'un seul annuler les ramène');
  m.place(5, 3, { type: 'wall' }); // remplacer la cible par un mur
  assert.equal(m.pieces.filter((p) => p.type === 'gate').length, 1);
});

test('placer sur une case occupée remplace ; poser la même chose est refusé ; case hors plateau et pièce inconnue refusées (entrées hostiles)', () => {
  const m = createEditorModel({ size: [5, 5] });
  assert.equal(m.place(1, 1, { type: 'mirror', o: '/' }).ok, true);
  assert.equal(m.place(1, 1, { type: 'mirror', o: '/' }).ok, false);
  assert.equal(m.place(1, 1, { type: 'prism' }).ok, true);
  assert.equal(m.pieces.length, 1);
  assert.equal(m.place(5, 0, { type: 'wall' }).ok, false);
  assert.equal(m.place(-1, 0, { type: 'wall' }).ok, false);
  assert.equal(m.place(1.5, 0, { type: 'wall' }).ok, false);
  assert.equal(m.place(0, 0, { type: '__proto__' }).ok, false);
  assert.equal(m.place(0, 0, { type: 'constructor' }).ok, false);
  assert.equal(m.place(0, 0, null).ok, false);
  assert.equal(m.place(0, 0, { type: 'wall', polluted: 1, __proto__: { x: 1 } }).ok, true);
  assert.deepEqual(m.pieceAt(0, 0), { type: 'wall', at: [0, 0] }, 'les clés hors liste blanche sont ignorées');
  assert.equal(Object.prototype.polluted, undefined);
});

test('nom : NFC puis minuscules, signes hors de T retirés avec la liste des refus, 24 signes au plus (P13)', () => {
  const decomposed = 'Café ÉTÉ';
  const a = sanitizeName(decomposed);
  assert.equal(a.value, 'café été');
  assert.deepEqual(a.rejected, []);
  const b = sanitizeName('Mon <b>niveau</b> #1 ☺');
  assert.equal(b.value, 'mon bniveaub 1 ');
  assert.deepEqual(b.rejected, ['<', '>', '/', '#', '☺']);
  const c = sanitizeName('x'.repeat(40));
  assert.equal(c.value.length, 24);
  assert.equal(c.truncated, true);
  assert.equal(sanitizeName(42).value, '');
  assert.equal(sanitizeName('ŒUF').value, 'œuf');
  const m = createEditorModel();
  m.setName('Défi N°1');
  assert.equal(m.name, 'défi n1');
});

test('aller-retour par le lien (F4) : un niveau fait dans l\'éditeur se rouvre à l\'identique (nom, taille, pièces, fixe, porte, portails)', () => {
  const m = createEditorModel({ size: [9, 7] });
  m.setName('Prismes & portes !');
  m.place(0, 3, { type: 'emitter', dir: 'E', mask: 'RGB' });
  m.place(8, 0, { type: 'target', need: 'R' });
  m.place(8, 6, { type: 'target', need: 'GB' });
  m.place(4, 3, { type: 'prism', fixed: true });
  m.place(2, 3, { type: 'filter', mask: 'RG' });
  m.place(3, 1, { type: 'mirror', o: '\\' });
  m.place(5, 2, { type: 'splitter', o: '|', fixed: true });
  m.place(1, 1, { type: 'portal', pair: 2 });
  m.place(7, 5, { type: 'portal', pair: 2 });
  m.place(6, 0, { type: 'gate', link: [8, 6] });
  m.place(4, 5, { type: 'wall' });
  assert.deepEqual(m.problems(), []);
  const level = m.level();
  const code = encodeLevel(level);
  assert.match(code, /^1\.[A-Za-z0-9_-]+$/);
  assert.ok(code.length <= 323);
  const parsed = parseShareCode(code);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.level, level, 'identique');
  assert.equal(encodeLevel(parsed.level), code, 'forme canonique');
  // le modèle recharge ce niveau et en redonne le même code
  const m2 = createEditorModel();
  m2.load(parsed.level);
  assert.equal(encodeLevel(m2.level()), code);
  assert.equal(m2.canUndo, false);
});

test('problèmes en direct : niveau vide, sans cible, déjà gagné, trop peu de cases libres : messages de F2 (français)', () => {
  const m = createEditorModel({ size: [3, 3] });
  const p0 = m.problems().map((x) => x.code);
  assert.ok(p0.includes('V6_EMITTER_COUNT') && p0.includes('V6_NO_TARGET') && p0.includes('V8_MOVABLE_COUNT'));
  m.place(0, 0, { type: 'emitter', dir: 'E', mask: 'RGB' });
  m.place(2, 0, { type: 'target', need: 'RGB' });
  m.place(1, 2, { type: 'mirror', o: '-' });
  assert.deepEqual(m.problems().map((x) => x.code), ['V10_ALREADY_WON']);
  assert.match(m.problems()[0].message, /déjà gagnant/);
  const c = m.counts();
  assert.deepEqual([c.emitters, c.targets, c.mobiles, c.pieces, c.freeCells], [1, 1, 1, 3, 7]);
});

test('valeurs enumerees de F2 (V7) contrôlées à la pose : un filtre blanc, une orientation ou une paire hors limites sont refusés', () => {
  const m = createEditorModel({ size: [5, 5] });
  for (const spec of [{ type: 'filter', mask: 'RGB' }, { type: 'filter', mask: 'GR' }, { type: 'filter' }, { type: 'mirror', o: 'x' }, { type: 'splitter' }, { type: 'emitter', dir: 'Z', mask: 'R' },
    { type: 'emitter', dir: 'E', mask: '' }, { type: 'target', need: 'RGBB' }, { type: 'portal', pair: 4 }, { type: 'portal', pair: -1 }, { type: 'portal', pair: 1.5 }]) {
    assert.equal(m.place(0, 0, spec).ok, false, JSON.stringify(spec));
  }
  assert.deepEqual(m.pieces, []);
  assert.equal(m.place(0, 0, { type: 'filter', mask: 'RB' }).ok, true);
});
