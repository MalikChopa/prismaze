import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDebug, deepFreeze } from '../../src/debug.js';
import { percentile, summarize, createBench } from '../../src/bench.js';
import { describeCell, litMessage, rotateMessage, moveMessage, cellName, createAnnouncer } from '../../src/ui/a11y.js';
import { createSession } from '../../src/ui/game.js';
import { maquette } from './helpers.mjs';

test('debug : getState est la seule entrée, renvoie une copie gelée neuve, rien ne modifie le jeu', () => {
  const session = createSession(maquette());
  const game = { snapshot: () => ({ levelId: 'x', board: { pieces: [{ id: 1, c: 2 }] }, history: { undo: session.history.undoDepth } }) };
  const target = {};
  const api = installDebug(game, target);
  assert.deepEqual(Object.keys(api), ['getState']);
  const a = api.getState();
  const b = api.getState();
  assert.notEqual(a, b, 'copie neuve à chaque appel');
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.board) && Object.isFrozen(a.board.pieces[0]));
  assert.throws(() => { a.board.pieces[0].c = 5; }, TypeError);
  assert.throws(() => { api.extra = 1; }, TypeError);
  assert.throws(() => { target.__prismaze = null; }, TypeError, 'non remplaçable');
  assert.equal(deepFreeze(5), 5);
});

test('debug : main.js ne charge debug.js (et bench.js) que si ?debug (?bench) est présent', () => {
  const text = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  assert.ok(!/^import .*debug\.js/m.test(text), "pas d'import statique de debug.js");
  assert.ok(!/^import .*bench\.js/m.test(text), "pas d'import statique de bench.js");
  assert.match(text, /if \(params\.has\('debug'\)\) \{\s*const \{ installDebug \} = await import\('\.\/debug\.js'\)/);
  assert.match(text, /params\.has\('bench'\)\s*\?\s*async \(\) => \(await import\('\.\/bench\.js'\)\)/);
});

test("debug : la coque fournit le résumé (snapshot) sans exposer d'action ; aucune affectation de window.__prismaze hors debug.js", () => {
  const app = readFileSync(new URL('../../src/ui/app.js', import.meta.url), 'utf8');
  assert.match(app, /snapshot\(\)/);
  assert.doesNotMatch(app, /__prismaze/);
});

test('a11y : messages en français, numérotation des cases à partir de 1', () => {
  const s = maquette();
  assert.equal(cellName(0, 0), 'colonne 1, ligne 1');
  assert.equal(describeCell(s, 7, 1), 'colonne 8, ligne 2 : miroir mobile, oblique montante /');
  assert.equal(describeCell(s, 7, 4), 'colonne 8, ligne 5 : miroir fixe, oblique montante /');
  assert.equal(describeCell(s, 5, 3), 'colonne 6, ligne 4 : mur');
  assert.equal(describeCell(s, 0, 3), "colonne 1, ligne 4 : émetteur blanc vers l'est");
  assert.equal(describeCell(s, 8, 0), 'colonne 9, ligne 1 : case vide');
  assert.equal(describeCell(s, 5, 1, [true, false]), 'colonne 6, ligne 2 : cible blanche allumée');
  assert.equal(describeCell(s, 4, 4, [true, false]), 'colonne 5, ligne 5 : cible blanche éteinte');
  assert.equal(litMessage(1, 2), '1 cible sur 2 allumée');
  assert.equal(litMessage(2, 2), '2 cibles sur 2 allumées');
  assert.equal(litMessage(0, 2), '0 cible sur 2 allumée');
  assert.match(rotateMessage({ o: 3 }), /oblique descendante \\/);
  assert.equal(moveMessage({ c: 3, r: 1 }, { type: 'mirror' }), 'Miroir posé : colonne 4, ligne 2.');
  assert.equal(moveMessage({ c: 3, r: 1 }, { type: 'prism' }), 'Prisme posé : colonne 4, ligne 2.');
  assert.equal(moveMessage({ c: 3, r: 1 }), 'Pièce posée : colonne 4, ligne 2.');
});

test('a11y : l\'annonceur vide la zone puis écrit (même phrase relue), la dernière phrase gagne', () => {
  const el = { textContent: '' };
  const queue = [];
  const ann = createAnnouncer(el, { schedule: (fn) => queue.push(fn) });
  ann.say('a');
  assert.equal(el.textContent, '');
  ann.say('b');
  queue.forEach((fn) => fn());
  assert.equal(el.textContent, 'b');
  assert.equal(ann.last, 'b');
});

test('bench : percentiles par rang le plus proche, résumé aux clés de §10', () => {
  assert.equal(percentile([], 95), 0);
  assert.equal(percentile([5], 95), 5);
  const v = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(v, 95), 95);
  assert.equal(percentile(v, 50), 50);
  assert.equal(percentile(v, 99), 99);
  assert.equal(percentile(v, 100), 100);
  const r = summarize({ work: [1, 2, 3, 4], intervals: [16, 17, 16.7], traces: [0.01, 0.02], hidden: false, frames: 4 });
  assert.deepEqual(Object.keys(r), ['workP95Ms', 'workMaxMs', 'rafP50Ms', 'rafP95Ms', 'frames', 'hz', 'hidden', 'traceP99Ms', 'particlesMax']);
  assert.equal(r.workMaxMs, 4);
  assert.equal(r.hz, 60);
  assert.equal(r.particlesMax, 0);
});

test('bench : démarre au premier pointerdown, écrit window.__bench après la durée, invalide si onglet masqué', () => {
  const listeners = {};
  const win = {
    addEventListener: (t, f) => { listeners[t] = f; },
    removeEventListener: (t) => { delete listeners[t]; },
  };
  const doc = { hidden: false, addEventListener: (t, f) => { listeners['doc:' + t] = f; }, removeEventListener: () => {} };
  let t = 0;
  const calls = [];
  const bench = createBench({ win, doc, now: () => t, durationMs: 100 });
  bench.attach({ setContinuous: (on) => calls.push(on) });
  assert.deepEqual(calls, [true]);
  bench.hooks.onFrame(0);
  assert.equal(win.__bench, undefined, 'rien avant le premier pointerdown');
  listeners.pointerdown();
  bench.hooks.onEvent(1.5);
  bench.hooks.onDraw(2);
  bench.hooks.onTrace(0.02);
  bench.hooks.onFrame(10);
  doc.hidden = true;
  listeners['doc:visibilitychange']();
  t = 50;
  bench.hooks.onDraw(1);
  bench.hooks.onFrame(26.7);
  assert.equal(win.__bench, undefined);
  t = 120;
  bench.hooks.onFrame(43.4);
  const r = win.__bench;
  assert.equal(r.frames, 3);
  assert.equal(r.hidden, true);
  assert.equal(r.workMaxMs, 3.5);
  assert.equal(r.traceP99Ms, 0.02);
  assert.deepEqual(calls, [true, false]);
});
