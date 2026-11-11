// R3, R4, R11 : état, rotation d'un miroir, déplacement ; buildBoard et ses refus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, rotateMirror, unrotateMirror, rotateAt, moveMirror, pieceAt, movableMirrorIds, isMovableMirror, getPiece,
  rotatePiece, movePiece, isMovable, isRotatable, movableIds, buildBoard, EMPTY, WALL, TARGET, MIRROR, EMITTER,
} from './engine.mjs';
import { levelFromAscii, deepFreeze } from './helpers.mjs';

const level = () => deepFreeze(levelFromAscii(['>./#', '..Tb', '....']));
// ids : 0 émetteur (0,0), 1 miroir mobile (2,0), 2 mur (3,0), 3 cible (2,1), 4 miroir fixe (3,1)

test('createState : pièces normalisées, état gelé, niveau d\'origine intact', () => {
  const lv = level();
  const s = createState(lv);
  assert.equal(s.cols, 4);
  assert.equal(s.rows, 3);
  assert.equal(s.pieces.length, 5);
  assert.deepEqual({ ...s.pieces[0] }, { id: 0, type: 'emitter', c: 0, r: 0, o: 0, dir: 0, mask: 7, need: 0, pair: 0, link: null, fixed: true });
  assert.deepEqual({ ...s.pieces[1] }, { id: 1, type: 'mirror', c: 2, r: 0, o: 1, dir: 0, mask: 0, need: 0, pair: 0, link: null, fixed: false });
  assert.deepEqual({ ...s.pieces[4] }, { id: 4, type: 'mirror', c: 3, r: 1, o: 1, dir: 0, mask: 0, need: 0, pair: 0, link: null, fixed: true });
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.pieces) && Object.isFrozen(s.pieces[1]));
});

test('R4 : rotateMirror fait o -> (o+1)&3 et ne modifie pas l\'ancien état', () => {
  const s0 = createState(level());
  const s1 = rotateMirror(s0, 1);
  assert.equal(s0.pieces[1].o, 1, 'ancien état intact');
  assert.equal(s1.pieces[1].o, 2);
  assert.notEqual(s1, s0);
  assert.equal(s1.pieces[0], s0.pieces[0], 'les autres pièces sont partagées');
  const seq = [];
  let s = s0;
  for (let i = 0; i < 5; i++) { seq.push(s.pieces[1].o); s = rotateMirror(s, 1); }
  assert.deepEqual(seq, [1, 2, 3, 0, 1], 'ordre / | \\ - puis retour');
});

test('R4 : 4 rotations rendent l\'orientation d\'origine ; 20 rotations aussi ; annuler = inverse', () => {
  const s0 = createState(level());
  assert.equal(rotateMirror(s0, 1, 4).pieces[1].o, 1);
  assert.equal(rotateMirror(s0, 1, 20).pieces[1].o, 1);
  assert.equal(rotateMirror(s0, 1, 21).pieces[1].o, 2);
  assert.equal(rotateMirror(s0, 1, -1).pieces[1].o, 0);
  assert.equal(unrotateMirror(rotateMirror(s0, 1), 1).pieces[1].o, 1);
  assert.equal(rotateMirror(s0, 1, 4), s0, 'rotation nulle : même objet');
});

test('rotateMirror : miroir fixe inchangé, pièce qui n\'est pas un miroir -> RangeError', () => {
  const s0 = createState(level());
  assert.equal(rotateMirror(s0, 4), s0);
  assert.equal(unrotateMirror(s0, 4), s0);
  for (const id of [0, 2, 3, 99]) assert.throws(() => rotateMirror(s0, id), RangeError);
});

test('rotateAt : un clic tourne le miroir mobile de la case, sinon ne fait rien', () => {
  const s0 = createState(level());
  assert.equal(rotateAt(s0, 2, 0).pieces[1].o, 2);
  for (const [c, r] of [[0, 0], [3, 0], [2, 1], [3, 1], [1, 1], [-1, 0], [9, 9]]) assert.equal(rotateAt(s0, c, r), s0, `(${c},${r})`);
});

test('moveMirror : vers une case libre seulement ; occupé, hors plateau, fixe -> refusé', () => {
  const s0 = createState(level());
  const s1 = moveMirror(s0, 1, 1, 2);
  assert.deepEqual([s1.pieces[1].c, s1.pieces[1].r], [1, 2]);
  assert.deepEqual([s0.pieces[1].c, s0.pieces[1].r], [2, 0]);
  assert.equal(moveMirror(s0, 1, 3, 0), s0, 'sur un mur');
  assert.equal(moveMirror(s0, 1, 0, 0), s0, 'sur l\'émetteur');
  assert.equal(moveMirror(s0, 1, 4, 0), s0, 'hors plateau');
  assert.equal(moveMirror(s0, 1, 0, -1), s0, 'hors plateau');
  assert.equal(moveMirror(s0, 1, 2, 0), s0, 'même case');
  assert.equal(moveMirror(s0, 4, 0, 2), s0, 'miroir fixe');
  assert.throws(() => moveMirror(s0, 2, 0, 2), RangeError);
});

test('aides : pieceAt, getPiece, isMovableMirror, movableMirrorIds', () => {
  const s = createState(level());
  assert.equal(pieceAt(s, 2, 1).type, 'target');
  assert.equal(pieceAt(s, 1, 2), undefined);
  assert.equal(getPiece(s, 3).type, 'target');
  assert.deepEqual(s.pieces.map(isMovableMirror), [false, true, false, false, false]);
  assert.deepEqual(movableMirrorIds(s), [1]);
});

test('buildBoard : grille de types, orientations, rang des cibles, listes dérivées', () => {
  const b = buildBoard(createState(level()));
  assert.equal(b.cols, 4);
  assert.equal(b.rows, 3);
  assert.equal(b.n, 12);
  assert.deepEqual([...b.kind], [EMITTER, EMPTY, MIRROR, WALL, EMPTY, EMPTY, TARGET, MIRROR, EMPTY, EMPTY, EMPTY, EMPTY]);
  assert.deepEqual([...b.pid], [0, -1, 1, 2, -1, -1, 3, 4, -1, -1, -1, -1]);
  assert.equal(b.orient[2], 1);
  assert.equal(b.aux[6], 0, 'rang de la cible');
  assert.equal(b.need[6], 7, 'cible blanche (need RGB)');
  assert.deepEqual(b.emitters, [{ cell: 0, d: 0, mask: 7 }]);
  assert.deepEqual(b.targetCells, [6]);
  assert.deepEqual([...b.movable], [0, 1, 0, 0, 0], 'seul le miroir mobile est mobile (E9)');
});

test('buildBoard : refuse un état incohérent (RangeError) ; pas d émetteur ou plusieurs émetteurs : permis (V6 est la règle du niveau)', () => {
  const s = createState(levelFromAscii(['>..', '...']));
  const mk = (pieces, extra = {}) => ({ cols: 3, rows: 2, pieces, ...extra });
  const em = s.pieces[0];
  assert.doesNotThrow(() => buildBoard(mk([])), 'plateau sans émetteur');
  assert.doesNotThrow(() => buildBoard(mk([em, { ...em, id: 1, c: 1 }])), 'deux émetteurs (1 à 3 en v2)');
  assert.throws(() => buildBoard(mk([em, { id: 1, type: 'wall', c: 0, r: 0, o: 0, dir: 0, fixed: true }])), RangeError, 'deux pièces sur une case');
  assert.throws(() => buildBoard(mk([em, { id: 1, type: 'wall', c: 3, r: 0, o: 0, dir: 0, fixed: true }])), RangeError, 'hors plateau');
  assert.throws(() => buildBoard(mk([em, { id: 1, type: 'ghost', c: 1, r: 0, o: 0, dir: 0, fixed: true }])), RangeError, 'type inconnu');
  assert.throws(() => buildBoard(mk([em, { id: 1, type: 'constructor', c: 1, r: 0, o: 0, dir: 0, fixed: true }])), RangeError, 'type hérité du prototype');
  assert.throws(() => buildBoard(mk([em], { cols: 0 })), RangeError, 'taille');
});

// v2 : E9, nouvelles pièces
const level2 = () => deepFreeze({
  format: 2, id: 'test-v2', size: [6, 4],
  pieces: [
    { type: 'emitter', at: [0, 0], dir: 'S', mask: 'RB' },
    { type: 'mirror', at: [1, 0], o: '/' }, { type: 'splitter', at: [2, 0], o: '\\' }, { type: 'prism', at: [3, 0] },
    { type: 'filter', at: [4, 0], mask: 'RG' }, { type: 'prism', at: [5, 0], fixed: true },
    { type: 'target', at: [0, 1], need: 'G' }, { type: 'portal', at: [1, 1], pair: 2 }, { type: 'portal', at: [2, 1], pair: 2 },
    { type: 'gate', at: [3, 1], link: [0, 1] }, { type: 'wall', at: [4, 1] },
  ],
});

test('createState v2 : masques en lettres, orientation du séparateur, portail, porte ; fixe = E9', () => {
  const s = createState(level2());
  const p = (i) => ({ ...s.pieces[i] });
  assert.equal(p(0).mask, 5); assert.equal(p(0).dir, 3);
  assert.deepEqual([p(2).type, p(2).o], ['splitter', 3]);
  assert.equal(p(4).mask, 3);
  assert.equal(p(6).need, 2);
  assert.equal(p(7).pair, 2);
  assert.deepEqual(p(9).link, [0, 1]);
  assert.deepEqual(s.pieces.map((q) => q.fixed), [true, false, false, false, false, true, true, true, true, true, true]);
  assert.ok(Object.isFrozen(s.pieces[9].link));
});

test('E9 : mobiles par défaut miroir, séparateur, prisme, filtre ; isMovable, isRotatable, movableIds', () => {
  const s = createState(level2());
  assert.deepEqual(movableIds(s), [1, 2, 3, 4]);
  assert.deepEqual(s.pieces.map(isRotatable), [false, true, true, false, false, false, false, false, false, false, false]);
  assert.deepEqual(s.pieces.map(isMovable).filter(Boolean).length, 4);
  assert.deepEqual(movableMirrorIds(s), [1], 'nom du MVP : miroirs seulement');
});

test('rotatePiece : miroir et séparateur tournent ; prisme et filtre : un toucher ne fait rien ; autres : RangeError', () => {
  const s = createState(level2());
  assert.equal(rotatePiece(s, 1).pieces[1].o, 2);
  assert.equal(rotatePiece(s, 2, 2).pieces[2].o, 1);
  assert.equal(rotatePiece(s, 3), s, 'prisme');
  assert.equal(rotatePiece(s, 4), s, 'filtre');
  assert.equal(rotatePiece(s, 5), s, 'prisme fixe');
  for (const id of [0, 6, 7, 9, 10, 99]) assert.throws(() => rotatePiece(s, id), RangeError, String(id));
  assert.equal(rotateAt(s, 2, 0).pieces[2].o, 0, 'un clic tourne le séparateur');
  assert.equal(rotateAt(s, 3, 0), s, 'un clic sur le prisme ne fait rien');
});

test('movePiece : prisme et filtre se déplacent ; fixe refusé ; type toujours fixe : RangeError', () => {
  const s = createState(level2());
  assert.deepEqual([movePiece(s, 3, 3, 2).pieces[3].c, movePiece(s, 3, 3, 2).pieces[3].r], [3, 2]);
  assert.deepEqual([movePiece(s, 4, 0, 3).pieces[4].c, movePiece(s, 4, 0, 3).pieces[4].r], [0, 3]);
  assert.equal(movePiece(s, 5, 5, 3), s, 'prisme fixe');
  assert.equal(movePiece(s, 3, 4, 1), s, 'sur un mur');
  for (const id of [0, 6, 7, 9, 10, 99]) assert.throws(() => movePiece(s, id, 5, 3), RangeError, String(id));
});

test('buildBoard v2 : portails appariés, porte liée à la cible, filtre = masque dans orient', () => {
  const b = buildBoard(createState(level2()));
  assert.equal(b.aux[1 * 6 + 1], 1 * 6 + 2);
  assert.equal(b.aux[1 * 6 + 2], 1 * 6 + 1);
  assert.deepEqual(b.gatesOf, [[1 * 6 + 3]], 'la porte (3,1) est liée à la cible (0,1)');
  assert.equal(b.orient[4], 3);
  assert.deepEqual(b.emitters, [{ cell: 0, d: 3, mask: 5 }]);
  assert.equal(b.result.targets.length, 1);
  assert.equal(b.result.gates.length, 1);
});

test('buildBoard : ne modifie pas son entrée (état gelé)', () => {
  const s = deepFreeze(createState(levelFromAscii(['>./', '.T.'])));
  assert.doesNotThrow(() => buildBoard(s));
});
