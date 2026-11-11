import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyboardController } from '../../src/ui/input.js';
import { maquette, recorder } from './helpers.mjs';

function setup() {
  const state = maquette();
  const { log, rec } = recorder();
  const kb = createKeyboardController({ getState: () => state }, {
    onCursor: rec('cursor'), onPick: rec('pick'), onHoldMove: rec('holdMove'), onDrop: rec('drop'), onCancel: rec('cancel'),
    onRotate: rec('rotate'), onBlocked: rec('blocked'), onUndo: rec('undo'), onRedo: rec('redo'),
  });
  const press = (key, extra = {}) => kb.key({ key, ...extra });
  return { kb, log, press };
}

test('flèches : le curseur bouge, reste dans le plateau, la touche est traitée (preventDefault)', () => {
  const { kb, press } = setup();
  kb.setCursor(0, 0);
  assert.equal(press('ArrowLeft'), true);
  assert.deepEqual(kb.cursor, { c: 0, r: 0 });
  press('ArrowRight');
  press('ArrowDown');
  assert.deepEqual(kb.cursor, { c: 1, r: 1 });
  kb.setCursor(9, 5);
  press('ArrowRight');
  press('ArrowDown');
  assert.deepEqual(kb.cursor, { c: 9, r: 5 });
  press('ArrowUp');
  assert.deepEqual(kb.cursor, { c: 9, r: 4 });
});

test('Entrée sur un miroir mobile le prend ; flèche ; Entrée le pose sur une case libre', () => {
  const { kb, log, press } = setup();
  kb.setCursor(3, 3);
  press('Enter');
  assert.equal(kb.holding, true);
  press('ArrowRight');
  press('ArrowRight'); // (5,3) est un mur : la candidate reste (4,3)
  press('Enter');
  const names = log.map((e) => e[0]);
  assert.deepEqual(names.filter((n) => n !== 'cursor'), ['pick', 'holdMove', 'holdMove', 'drop']);
  const moves = log.filter((e) => e[0] === 'holdMove').map((e) => e[1].candidate);
  assert.deepEqual(moves, [{ c: 4, r: 3 }, { c: 3, r: 3 }]);
  const drop = log.find((e) => e[0] === 'drop')[1];
  assert.deepEqual(drop, { id: 9, from: { c: 3, r: 3 }, to: { c: 3, r: 3 }, reason: 'occupied', cell: { c: 5, r: 3 } });
  assert.equal(kb.holding, false);
  assert.deepEqual(kb.cursor, { c: 3, r: 3 }, 'retour à la case d origine : le curseur aussi');
});

test('Espace prend et pose comme Entrée ; la répétition automatique est sans effet', () => {
  const { kb, log, press } = setup();
  kb.setCursor(7, 1);
  press(' ');
  press(' ', { repeat: true });
  assert.equal(kb.holding, true);
  press('ArrowDown');
  press(' ');
  const drop = log.find((e) => e[0] === 'drop')[1];
  assert.deepEqual(drop, { id: 11, from: { c: 7, r: 1 }, to: { c: 7, r: 2 }, reason: 'moved', cell: { c: 7, r: 2 } });
});

test('Échap annule la prise : la pièce reste à sa case', () => {
  const { kb, log, press } = setup();
  kb.setCursor(3, 3);
  press('Enter');
  press('ArrowDown');
  press('Escape');
  assert.equal(kb.holding, false);
  assert.deepEqual(log.filter((e) => e[0] === 'cancel').length, 1);
  assert.ok(!log.some((e) => e[0] === 'drop'));
  assert.deepEqual(kb.cursor, { c: 3, r: 3 }, 'le curseur revient sur le miroir');
  press('Escape'); // sans prise : rien
  assert.equal(log.filter((e) => e[0] === 'cancel').length, 1);
});

test('R tourne (Maj+R dans l\'autre sens) le miroir sous le curseur, ou le miroir en main', () => {
  const { kb, log, press } = setup();
  kb.setCursor(7, 1);
  press('r');
  press('R', { shiftKey: true });
  assert.deepEqual(log.filter((e) => e[0] === 'rotate').map((e) => e[1]), [{ id: 11, steps: 1 }, { id: 11, steps: -1 }]);
  press('Enter');
  press('ArrowDown');
  press('r');
  assert.deepEqual(log.filter((e) => e[0] === 'rotate').at(-1)[1], { id: 11, steps: 1 }, 'le miroir en main, pas la case sous le curseur');
});

test('Entrée ou R sur une pièce fixe, un mur, une cible : annonce « bloqué », aucune prise', () => {
  const { kb, log, press } = setup();
  for (const [c, r] of [[7, 4], [5, 3], [5, 1], [0, 3]]) {
    kb.setCursor(c, r);
    press('Enter');
    press('r');
  }
  assert.equal(log.filter((e) => e[0] === 'blocked').length, 8);
  assert.ok(!log.some((e) => e[0] === 'pick' || e[0] === 'rotate'));
  assert.equal(kb.holding, false);
  kb.setCursor(8, 0); // case vide
  press('Enter');
  press('r');
  assert.equal(log.filter((e) => e[0] === 'blocked').length, 8);
});

test('Ctrl+Z, Ctrl+Y, Ctrl+Maj+Z, Cmd+Z ; annuler abandonne d\'abord la prise', () => {
  const { kb, log, press } = setup();
  assert.equal(press('z', { ctrlKey: true }), true);
  assert.equal(press('y', { ctrlKey: true }), true);
  assert.equal(press('Z', { ctrlKey: true, shiftKey: true }), true);
  assert.equal(press('z', { metaKey: true }), true);
  assert.deepEqual(log.map((e) => e[0]), ['undo', 'redo', 'redo', 'undo']);
  log.length = 0;
  kb.setCursor(3, 3);
  press('Enter');
  press('z', { ctrlKey: true });
  assert.deepEqual(log.map((e) => e[0]), ['pick', 'cancel', 'undo']);
});

test('touches non traitées : le navigateur garde son comportement', () => {
  const { press } = setup();
  assert.equal(press('Tab'), false);
  assert.equal(press('a'), false);
  assert.equal(press('c', { ctrlKey: true }), false);
  assert.equal(press('ArrowLeft', { altKey: true }), false);
  assert.equal(press('r', { ctrlKey: true }), false);
});
