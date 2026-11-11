import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, sameLayout } from '../../src/ui/game.js';
import { maquette, moveToWin } from './helpers.mjs';

test('session : rotations de (7,1) = comportement de référence de J1 (1/2 puis 2/2 cibles)', () => {
  const s = createSession(maquette());
  assert.equal(s.view().result.litCount, 1);
  assert.equal(s.won, false);
  assert.ok(s.rotate(11, 1));
  assert.equal(s.view().result.litCount, 1, 'un cran : toujours 1 cible');
  assert.ok(s.rotate(11, 1));
  assert.equal(s.view().result.litCount, 2);
  assert.equal(s.state.pieces[11].o, 3, 'o = « \\ »');
  assert.equal(s.won, true);
  assert.equal(s.history.undoDepth, 2);
});

test('session : N annulations redonnent l\'état initial, N refaire le restituent', () => {
  const s = createSession(maquette());
  s.rotate(11, 1);
  s.rotate(10, 1);
  s.move(9, { c: 4, r: 3 });
  s.rotate(9, -1);
  const final = s.state;
  for (let i = 0; i < 4; i++) assert.ok(s.undo());
  assert.equal(s.undo(), null);
  assert.ok(sameLayout(s.state, s.initial));
  assert.equal(s.won, false);
  for (let i = 0; i < 4; i++) assert.ok(s.redo());
  assert.ok(sameLayout(s.state, final));
});

test('session : rien ne change (miroir fixe, case occupée) = aucune étape', () => {
  const s = createSession(maquette());
  assert.equal(s.rotate(12, 1), null, 'miroir fixe');
  assert.equal(s.move(9, { c: 3, r: 1 }), null, 'case occupée');
  assert.equal(s.move(9, { c: 3, r: 3 }), null, 'même case');
  assert.equal(s.move(12, { c: 8, r: 4 }), null, 'miroir fixe');
  assert.equal(s.move(9, { c: 99, r: 3 }), null, 'hors plateau');
  assert.equal(s.history.undoDepth, 0);
});

test('session : recommencer est annulable (P8) et sans effet sur un plateau déjà au départ', () => {
  const s = createSession(maquette());
  assert.equal(s.reset(), null);
  s.rotate(11, 1);
  s.rotate(11, 1);
  s.move(9, { c: 4, r: 3 });
  const before = s.state;
  assert.ok(s.reset());
  assert.ok(sameLayout(s.state, s.initial));
  assert.equal(s.won, false);
  assert.ok(s.undo());
  assert.equal(s.state, before, 'annuler rend exactement l\'état d\'avant');
  assert.equal(s.won, s.view().result.allLit, "victoire recalculée sur l'état restitué");
  assert.ok(s.redo());
  assert.ok(sameLayout(s.state, s.initial));
});

test('session : une prise montre le miroir sur la case candidate (R11) sans toucher à l\'état validé', () => {
  const s = createSession(moveToWin());
  const before = s.state;
  s.beginDrag(0 + 1, { c: 1, r: 1 }, 'pointer'); // pièces : 0 émetteur, 1 miroir, 2 cible
  s.moveDrag({ c: 1, r: 0 });
  const v = s.view();
  assert.equal(v.state.pieces[1].r, 0, 'le miroir occupe la case candidate');
  assert.equal(v.result.allLit, true, 'le faisceau est recalculé en direct');
  assert.equal(s.state, before, 'état validé intact');
  assert.equal(s.won, false, 'victoire pas évaluée pendant le glisser (P7)');
  assert.equal(s.history.undoDepth, 0);
  s.endDrag();
  assert.equal(s.view().state, before);
  assert.equal(s.view().result.allLit, false);
});

test('session : la victoire n\'est évaluée qu\'après le lâcher (P7)', () => {
  const s = createSession(moveToWin());
  s.beginDrag(1, { c: 1, r: 1 }, 'pointer');
  s.moveDrag({ c: 1, r: 0 });
  assert.equal(s.won, false);
  s.endDrag();
  assert.ok(s.move(1, { c: 1, r: 0 }));
  assert.equal(s.won, true);
  assert.ok(s.undo());
  assert.equal(s.won, false);
});

test('session : le tracé est en cache tant que rien ne change', () => {
  let traces = 0;
  const s = createSession(maquette(), { onTrace: () => { traces++; }, now: () => 0 });
  traces = 0;
  const a = s.view();
  const b = s.view();
  assert.equal(a, b);
  assert.equal(traces, 1);
  s.rotate(11, 1); // le jugement de victoire calcule le tracé, la vue le réutilise
  s.view();
  s.view();
  assert.equal(traces, 2);
});

test("session : recommencer depuis un niveau gagné, puis annuler, rend la victoire", () => {
  const s = createSession(maquette());
  s.rotate(11, 1);
  s.rotate(11, 1);
  assert.equal(s.won, true);
  s.reset();
  assert.equal(s.won, false);
  s.undo();
  assert.equal(s.won, true);
  assert.equal(s.view().result.litCount, 2);
});
