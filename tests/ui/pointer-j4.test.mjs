// J4 : appui long et clic droit (aperçu de l'autre sens), prisme et filtre (un toucher ne fait rien, mais se déplacent), séparateur,
// clavier sur les nouvelles pièces, annuler/refaire d'un séparateur et d'un prisme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPointerMachine, createKeyboardController, LONG_PRESS_MS } from '../../src/ui/input.js';
import { createSession, sameLayout } from '../../src/ui/game.js';
import { createState } from '../../src/engine/state.js';
import { DEV_LEVELS } from '../../src/dev-levels.js';
import { fakeGeometry, recorder } from './helpers.mjs';

const state = createState(DEV_LEVELS.galerie);
const idAt = (c, r) => state.pieces.find((p) => p.c === c && p.r === r).id;
const MIRROR = idAt(1, 6), SPLITTER = idAt(7, 4), FILTER = idAt(9, 4), PRISM = idAt(8, 2), FIXED_PRISM = idAt(3, 1);

function fakeTimers() {
  const q = [];
  return { setTimer: (fn, ms) => { q.push({ fn, ms }); return q.length - 1; }, clearTimer: (i) => { if (q[i]) q[i].fn = null; }, fire: () => q.forEach((t) => { const f = t.fn; t.fn = null; if (f) f(); }), q };
}
function setup() {
  const geo = fakeGeometry(state, 64);
  const { log, rec } = recorder();
  const timers = fakeTimers();
  const m = createPointerMachine(
    { getState: () => state, cellAt: geo.cellAt, cellSize: () => 64, setTimer: timers.setTimer, clearTimer: timers.clearTimer },
    { onTap: rec('tap'), onBlockedTap: rec('blocked'), onNoRotate: rec('noRotate'), onLongPress: rec('long'), onPreviewEnd: rec('previewEnd'), onDragStart: rec('dragStart'), onDragMove: rec('dragMove'), onDrop: rec('drop'), onCancel: rec('cancel') },
  );
  const at = (c, r, dx = 0, dy = 0) => { const p = geo.center(c, r); return { x: p.x + dx, y: p.y + dy }; };
  const ev = (pointerId, p, extra = {}) => ({ pointerId, x: p.x, y: p.y, button: 0, isPrimary: true, pointerType: 'touch', ...extra });
  return { m, log, at, ev, timers };
}

test('appui long : un seul minuteur de 450 ms ; au déclenchement, aperçu ; au relâchement, rotation dans l\'autre sens (-1)', () => {
  const { m, log, at, ev, timers } = setup();
  assert.equal(LONG_PRESS_MS, 450);
  m.down(ev(1, at(1, 6)));
  assert.equal(timers.q.length, 1);
  assert.equal(timers.q[0].ms, 450);
  assert.equal(log.length, 0);
  timers.fire();
  assert.deepEqual(log.map((e) => e[0]), ['long']);
  assert.equal(log[0][1].steps, -1);
  m.up(ev(1, at(1, 6)));
  assert.deepEqual(log.map((e) => e[0]), ['long', 'tap']);
  assert.equal(log[1][1].steps, -1);
});

test('toucher court : minuteur annulé, rotation +1, pas d\'aperçu ; bouger au-delà du seuil avant 450 ms : glisser, pas d\'aperçu', () => {
  const a = setup();
  a.m.down(a.ev(1, a.at(1, 6)));
  a.m.up(a.ev(1, a.at(1, 6)));
  a.timers.fire();
  assert.deepEqual(a.log.map((e) => e[0]), ['tap']);
  assert.equal(a.log[0][1].steps, 1);
  const b = setup();
  b.m.down(b.ev(1, b.at(1, 6)));
  b.m.move(b.ev(1, b.at(1, 6, 20, 0)));
  b.timers.fire();
  assert.ok(!b.log.some((e) => e[0] === 'long'));
  assert.equal(b.log[0][0], 'dragStart');
});

test('appui long puis glissement : l\'aperçu disparaît et on glisse ; pointercancel pendant l\'aperçu : aperçu retiré, aucune rotation', () => {
  const a = setup();
  a.m.down(a.ev(1, a.at(1, 6)));
  a.timers.fire();
  a.m.move(a.ev(1, a.at(2, 6)));
  assert.deepEqual(a.log.map((e) => e[0]), ['long', 'previewEnd', 'dragStart', 'dragMove']);
  const b = setup();
  b.m.down(b.ev(1, b.at(1, 6)));
  b.timers.fire();
  b.m.cancel({ pointerId: 1 });
  assert.deepEqual(b.log.map((e) => e[0]), ['long', 'previewEnd']);
});

test('clic droit : aperçu immédiat, rotation -1 au relâchement ; sur un prisme ou un filtre : rien', () => {
  const a = setup();
  a.m.down(a.ev(1, a.at(1, 6), { button: 2, pointerType: 'mouse' }));
  assert.deepEqual(a.log.map((e) => e[0]), ['long']);
  a.m.up(a.ev(1, a.at(1, 6), { button: 2, pointerType: 'mouse' }));
  assert.deepEqual(a.log.map((e) => e[0]), ['long', 'tap']);
  assert.equal(a.log[1][1].steps, -1);
  const b = setup();
  b.m.down(b.ev(1, b.at(8, 2), { button: 2 }));
  b.m.up(b.ev(1, b.at(8, 2), { button: 2 }));
  assert.deepEqual(b.log.map((e) => e[0]), ['noRotate']);
});

test('prisme et filtre mobiles : un toucher ne tourne pas (annonce), mais ils se déplacent ; prisme fixe : pièce fixe', () => {
  const a = setup();
  for (const [c, r] of [[8, 2], [9, 4]]) { a.m.down(a.ev(1, a.at(c, r))); a.timers.fire(); a.m.up(a.ev(1, a.at(c, r))); }
  assert.deepEqual(a.log.map((e) => e[0]), ['noRotate', 'noRotate']);
  assert.equal(a.timers.q.length, 0, 'aucun minuteur d\'appui long sur une pièce qui ne tourne pas');
  const b = setup();
  b.m.down(b.ev(1, b.at(8, 2)));
  b.m.move(b.ev(1, b.at(7, 2)));
  b.m.up(b.ev(1, b.at(7, 2)));
  assert.deepEqual(b.log.map((e) => e[0]), ['dragStart', 'dragMove', 'drop']);
  assert.equal(b.log.at(-1)[1].reason, 'moved');
  const c = setup();
  c.m.down(c.ev(1, c.at(3, 1)));
  c.m.up(c.ev(1, c.at(3, 1)));
  assert.deepEqual(c.log.map((e) => e[0]), ['blocked']);
});

test('clavier : R tourne un séparateur, annonce « ne tourne pas » sur un prisme/filtre ; Entrée prend un prisme', () => {
  const { log, rec } = recorder();
  const kb = createKeyboardController({ getState: () => state }, { onRotate: rec('rotate'), onNoRotate: rec('noRotate'), onPick: rec('pick'), onBlocked: rec('blocked') });
  kb.setCursor(7, 4); kb.key({ key: 'r' });
  kb.setCursor(8, 2); kb.key({ key: 'r' });
  kb.setCursor(9, 4); kb.key({ key: 'R', shiftKey: true });
  kb.setCursor(8, 2); kb.key({ key: 'Enter' });
  assert.deepEqual(log.map((e) => e[0]), ['rotate', 'noRotate', 'noRotate', 'pick']);
  kb.key({ key: 'r' });
  assert.equal(log.at(-1)[0], 'noRotate', 'prisme en main : R ne tourne pas');
});

test('session : séparateur et prisme, rotation, déplacement, annuler et refaire (history-v2)', () => {
  const s = createSession(state);
  assert.ok(s.rotate(SPLITTER, 1));
  assert.equal(s.state.pieces[SPLITTER].o, 0, 'o = « - » (3 + 1 mod 4)');
  assert.equal(s.rotate(FILTER, 1), null, 'filtre : rien');
  assert.equal(s.rotate(PRISM, 1), null, 'prisme : rien');
  assert.equal(s.rotate(FIXED_PRISM, 1), null);
  assert.ok(s.move(PRISM, { c: 7, r: 2 }));
  assert.ok(s.move(FILTER, { c: 9, r: 5 }));
  assert.equal(s.move(FIXED_PRISM, { c: 3, r: 2 }), null);
  assert.equal(s.history.undoDepth, 3);
  const final = s.state;
  for (let i = 0; i < 3; i++) assert.ok(s.undo());
  assert.ok(sameLayout(s.state, state));
  for (let i = 0; i < 3; i++) assert.ok(s.redo());
  assert.ok(sameLayout(s.state, final));
  assert.ok(s.view().result.targets.length === 8);
});
