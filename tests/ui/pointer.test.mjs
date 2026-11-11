import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPointerMachine, dragThreshold, classifyDrop } from '../../src/ui/input.js';
import { maquette, fakeGeometry, recorder } from './helpers.mjs';

// Maquette 10x6 : mobiles id 9 (3,3), 10 (3,1), 11 (7,1) ; fixe id 12 (7,4) ; mur id 6 (5,3) ; cible id 7 (5,1).
function setup(cell = 64) {
  const state = maquette();
  const geo = fakeGeometry(state, cell);
  const { log, rec } = recorder();
  const m = createPointerMachine(
    { getState: () => state, cellAt: geo.cellAt, cellSize: () => geo.cell },
    { onTap: rec('tap'), onBlockedTap: rec('blocked'), onDragStart: rec('dragStart'), onDragMove: rec('dragMove'), onDrop: rec('drop'), onCancel: rec('cancel') },
  );
  const at = (c, r, dx = 0, dy = 0) => { const p = geo.center(c, r); return { x: p.x + dx, y: p.y + dy }; };
  const ev = (pointerId, p, extra = {}) => ({ pointerId, x: p.x, y: p.y, button: 0, isPrimary: true, pointerType: 'mouse', ...extra });
  return { state, geo, m, log, at, ev };
}

test('seuil de glisser : max(6 px, 0,2 case)', () => {
  assert.equal(dragThreshold(20), 6);
  assert.equal(dragThreshold(30), 6);
  assert.equal(dragThreshold(64), 12.8);
  assert.equal(dragThreshold(88), 17.6);
  assert.equal(dragThreshold(0), 6);
});

test('toucher sur un miroir mobile : rotation +1 au relâchement, aucun glisser', () => {
  const { m, log, at, ev } = setup();
  assert.equal(m.down(ev(1, at(7, 1))), true);
  assert.equal(m.phase, 'pressed');
  assert.equal(log.length, 0, 'rien avant le relâchement');
  m.up(ev(1, at(7, 1)));
  assert.deepEqual(log, [['tap', { id: 11, cell: { c: 7, r: 1 }, steps: 1 }]]);
  assert.equal(m.phase, 'idle');
});

test("clic droit : rotation dans l'autre sens ; autres boutons ignorés", () => {
  const { m, log, at, ev } = setup();
  m.down(ev(1, at(7, 1), { button: 2 }));
  m.up(ev(1, at(7, 1), { button: 2 }));
  assert.equal(log[0][1].steps, -1);
  assert.equal(m.down(ev(2, at(7, 1), { button: 1 })), false);
  assert.equal(m.phase, 'idle');
});

test('petit tremblement (moins que le seuil) = toujours un toucher', () => {
  const { m, log, at, ev } = setup();
  m.down(ev(1, at(3, 3)));
  m.move(ev(1, at(3, 3, 12, 0))); // 12 px < 12,8
  m.move(ev(1, at(3, 3, 0, -12)));
  m.up(ev(1, at(3, 3, 5, 5)));
  assert.deepEqual(log.map((e) => e[0]), ['tap']);
});

test('au-delà du seuil : glisser ; au lâcher sur une case libre, un déplacement', () => {
  const { m, log, at, ev } = setup();
  m.down(ev(1, at(3, 3)));
  m.move(ev(1, at(3, 3, 14, 0))); // 14 > 12,8 : glisser, toujours sur la case d'origine
  assert.equal(m.phase, 'dragging');
  m.move(ev(1, at(4, 3)));
  m.move(ev(1, at(4, 3, 3, 3))); // même case : pas de nouvel événement
  m.move(ev(1, at(4, 2)));
  m.up(ev(1, at(4, 2)));
  assert.deepEqual(log.map((e) => e[0]), ['dragStart', 'dragMove', 'dragMove', 'drop']);
  assert.deepEqual(log[0][1], { id: 9, from: { c: 3, r: 3 } });
  assert.deepEqual(log[1][1].candidate, { c: 4, r: 3 });
  assert.deepEqual(log[3][1], { id: 9, from: { c: 3, r: 3 }, to: { c: 4, r: 2 }, reason: 'moved', cell: { c: 4, r: 2 } });
});

test("pendant le glisser, une case occupée ou hors plateau garde la case d'origine comme candidate", () => {
  const { m, log, at, ev, geo } = setup();
  m.down(ev(1, at(3, 3)));
  m.move(ev(1, at(4, 3))); // libre
  m.move(ev(1, at(5, 3))); // mur : candidate = origine
  m.move(ev(1, at(4, 3))); // libre de nouveau
  m.move(ev(1, { x: -50, y: -50 })); // hors du plateau : origine
  const cands = log.filter((e) => e[0] === 'dragMove').map((e) => e[1].candidate);
  assert.deepEqual(cands, [{ c: 4, r: 3 }, { c: 3, r: 3 }, { c: 4, r: 3 }, { c: 3, r: 3 }]);
  assert.equal(geo.cellAt(-50, -50), null);
});

test("lâcher sur une case occupée : retour à l'origine, raison « occupied », pas de déplacement", () => {
  const { m, log, at, ev } = setup();
  m.down(ev(1, at(3, 3)));
  m.move(ev(1, at(3, 2)));
  m.up(ev(1, at(3, 1))); // le miroir (3,1)
  const drop = log.find((e) => e[0] === 'drop')[1];
  assert.deepEqual(drop, { id: 9, from: { c: 3, r: 3 }, to: { c: 3, r: 3 }, reason: 'occupied', cell: { c: 3, r: 1 } });
});

test("lâcher hors du plateau : retour à l'origine, raison « outside »", () => {
  const { m, log, at, ev } = setup();
  m.down(ev(1, at(3, 3)));
  m.move(ev(1, at(3, 2)));
  m.up(ev(1, { x: 5000, y: 5000 }));
  const drop = log.find((e) => e[0] === 'drop')[1];
  assert.equal(drop.reason, 'outside');
  assert.equal(drop.cell, null, 'hors du plateau : aucune case visée');
  assert.deepEqual(drop.to, { c: 3, r: 3 });
});

test("glisser puis revenir sur la case d'origine : ni toucher ni déplacement (raison « same »)", () => {
  const { m, log, at, ev } = setup();
  m.down(ev(1, at(3, 3)));
  m.move(ev(1, at(4, 3)));
  m.move(ev(1, at(3, 3)));
  m.up(ev(1, at(3, 3)));
  assert.deepEqual(log.map((e) => e[0]), ['dragStart', 'dragMove', 'dragMove', 'drop']);
  assert.equal(log.at(-1)[1].reason, 'same');
  assert.ok(!log.some((e) => e[0] === 'tap'));
});

test('second doigt ignoré tant que le premier est posé ; accepté ensuite', () => {
  const { m, log, at, ev } = setup();
  assert.equal(m.down(ev(1, at(7, 1), { pointerType: 'touch' })), true);
  assert.equal(m.down(ev(2, at(3, 3), { pointerType: 'touch', isPrimary: false })), false);
  assert.equal(m.down(ev(3, at(3, 1), { pointerType: 'touch' })), false, 'même un pointeur marqué primaire est ignoré');
  m.move(ev(2, at(4, 3)));
  m.move(ev(2, at(6, 3)));
  m.up(ev(2, at(6, 3)));
  assert.equal(log.length, 0, 'les événements du second doigt ne produisent rien');
  assert.equal(m.phase, 'pressed');
  m.up(ev(1, at(7, 1)));
  assert.deepEqual(log.map((e) => e[0]), ['tap']);
  assert.equal(m.down(ev(4, at(3, 3))), true);
});

test('un pointeur non primaire est ignoré même seul', () => {
  const { m, at, ev } = setup();
  assert.equal(m.down(ev(5, at(7, 1), { isPrimary: false })), false);
});

test('pièces fixes : jamais déplacées ; le toucher ne crée aucune rotation', () => {
  const { m, log, at, ev } = setup();
  m.down(ev(1, at(7, 4))); // miroir fixe
  m.move(ev(1, at(6, 4)));
  m.move(ev(1, at(4, 4)));
  m.up(ev(1, at(4, 4)));
  assert.equal(log.length, 0, 'un glisser sur une pièce fixe ne fait rien');
  m.down(ev(1, at(7, 4)));
  m.up(ev(1, at(7, 4)));
  assert.deepEqual(log.map((e) => e[0]), ['blocked']);
  assert.equal(log[0][1].piece.fixed, true);
  log.length = 0;
  for (const [c, r] of [[5, 3], [5, 1], [0, 3]]) { // mur, cible, émetteur
    m.down(ev(1, at(c, r)));
    m.up(ev(1, at(c, r)));
  }
  assert.deepEqual(log.map((e) => e[0]), ['blocked', 'blocked', 'blocked']);
});

test('toucher sur une case vide ou hors plateau : rien', () => {
  const { m, log, at, ev } = setup();
  m.down(ev(1, at(8, 0)));
  m.up(ev(1, at(8, 0)));
  m.down(ev(1, { x: 9000, y: 9000 }));
  m.up(ev(1, { x: 9000, y: 9000 }));
  assert.equal(log.length, 0);
});

test('annulation du geste (pointercancel) : aucune commande, ni toucher ni lâcher', () => {
  const { m, log, at, ev } = setup();
  m.down(ev(1, at(3, 3)));
  m.cancel({ pointerId: 1 });
  m.up(ev(1, at(3, 3)));
  assert.equal(log.length, 0);
  m.down(ev(1, at(3, 3)));
  m.move(ev(1, at(4, 3)));
  m.cancel({ pointerId: 1 });
  assert.deepEqual(log.map((e) => e[0]), ['dragStart', 'dragMove', 'cancel']);
  m.up(ev(1, at(4, 3)));
  assert.equal(log.length, 3, "aucun lâcher après l'annulation");
  assert.equal(m.phase, 'idle');
});

test('le seuil suit la taille de la case (88 px : 17,6 px)', () => {
  const { m, log, at, ev } = setup(88);
  m.down(ev(1, at(3, 3)));
  m.move(ev(1, at(3, 3, 17, 0)));
  assert.equal(m.phase, 'pressed');
  m.move(ev(1, at(3, 3, 18, 0)));
  assert.equal(m.phase, 'dragging');
  assert.equal(log[0][0], 'dragStart');
});

test('classifyDrop : les quatre cas', () => {
  const s = maquette();
  assert.equal(classifyDrop(s, 9, { c: 4, r: 3 }).reason, 'moved');
  assert.equal(classifyDrop(s, 9, { c: 3, r: 3 }).reason, 'same');
  assert.equal(classifyDrop(s, 9, { c: 3, r: 1 }).reason, 'occupied');
  assert.equal(classifyDrop(s, 9, null).reason, 'outside');
});
