import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, makeRotate, makeMove, makeReset, applyCommand, revertCommand } from '../../src/ui/history.js';
import { rotateMirror, moveMirror } from '../../src/engine/state.js';
import { maquette } from './helpers.mjs';

test('history : pile vide, annuler et refaire renvoient null', () => {
  const h = createHistory();
  const s = maquette();
  assert.equal(h.undo(s), null);
  assert.equal(h.redo(s), null);
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
});

test("history : rotation, déplacement, recommencer s'annulent et se refont à l'identique", () => {
  const s0 = maquette();
  const h = createHistory();
  const s1 = rotateMirror(s0, 11, 1);
  h.record(makeRotate(11, 1));
  const s2 = moveMirror(s1, 9, 4, 3);
  h.record(makeMove(9, { c: 3, r: 3 }, { c: 4, r: 3 }));
  const s3 = s0;
  h.record(makeReset(s2, s3));
  assert.equal(h.undoDepth, 3);
  let r = h.undo(s3);
  assert.equal(r.state, s2, "annuler « recommencer » rend l'état d'avant (P8)");
  r = h.undo(r.state);
  assert.equal(r.state.pieces[9].c, 3, 'le miroir revient en (3,3)');
  assert.deepEqual(r.state.pieces, s1.pieces);
  r = h.undo(r.state);
  assert.deepEqual(r.state.pieces, s0.pieces);
  assert.equal(h.undo(r.state), null);
  assert.equal(h.redoDepth, 3);
  r = h.redo(s0);
  assert.deepEqual(r.state.pieces, s1.pieces);
  r = h.redo(r.state);
  assert.deepEqual(r.state.pieces, s2.pieces);
  r = h.redo(r.state);
  assert.equal(r.state, s3);
  assert.equal(h.redo(r.state), null);
});

test('history : une nouvelle commande vide « refaire »', () => {
  const h = createHistory();
  h.record(makeRotate(11, 1));
  h.record(makeRotate(11, 1));
  const s = maquette();
  h.undo(rotateMirror(rotateMirror(s, 11, 1), 11, 1));
  assert.equal(h.canRedo, true);
  h.record(makeRotate(10, 1));
  assert.equal(h.canRedo, false);
  assert.equal(h.undoDepth, 2);
});

test('history : deux rotations successives du même miroir sont deux étapes séparées', () => {
  const h = createHistory();
  h.record(makeRotate(11, 1));
  h.record(makeRotate(11, 1));
  assert.equal(h.undoDepth, 2);
  const s0 = maquette();
  const s2 = rotateMirror(rotateMirror(s0, 11, 1), 11, 1);
  const r = h.undo(s2);
  assert.equal(r.state.pieces[11].o, 2, 'une seule rotation annulée : / -> |');
});

test("history : sans limite (5000 étapes) et l'annulation complète redonne l'état initial", () => {
  const h = createHistory();
  let s = maquette();
  const s0 = s;
  for (let i = 0; i < 5000; i++) {
    s = rotateMirror(s, 11, i % 3 === 0 ? -1 : 1);
    h.record(makeRotate(11, i % 3 === 0 ? -1 : 1));
  }
  assert.equal(h.undoDepth, 5000);
  for (let i = 0; i < 5000; i++) s = h.undo(s).state;
  assert.deepEqual(s.pieces, s0.pieces);
  assert.equal(h.canUndo, false);
});

test("history : rotation dans l'autre sens (-1) s'annule", () => {
  const s0 = maquette();
  const s1 = applyCommand(s0, makeRotate(11, -1));
  assert.equal(s1.pieces[11].o, 0, '/ (1) devient - (0)');
  assert.deepEqual(revertCommand(s1, makeRotate(11, -1)).pieces, s0.pieces);
});

test('history : clear vide les deux piles ; les commandes sont gelées ; commande inconnue refusée', () => {
  const h = createHistory();
  h.record(makeRotate(11, 1));
  h.undo(rotateMirror(maquette(), 11, 1));
  h.clear();
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  assert.ok(Object.isFrozen(makeMove(9, { c: 1, r: 1 }, { c: 2, r: 2 })));
  assert.throws(() => applyCommand(maquette(), { type: 'x' }), RangeError);
  assert.throws(() => revertCommand(maquette(), { type: 'x' }), RangeError);
});
