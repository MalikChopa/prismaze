// Indice (S7) de bout en bout hors navigateur : hint.js -> makeGetHint (coque) -> fantôme dessiné par le rendu (faux contexte 2D qui enregistre les appels).
// Le rendu réel et l'indice suivi avec la souris sont essayés en Chrome par tools/e2e/j5.e2e.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRenderer } from '../../src/render/renderer.js';
import { createState } from '../../src/engine/state.js';
import { buildBoard } from '../../src/engine/board.js';
import { trace } from '../../src/engine/trace.js';
import { createHinter, applyHint, HINT_NONE } from '../../src/engine/hint.js';
import { validateLevel } from '../../src/engine/level.js';
import { makeGetHint } from '../../src/ui/app.js';

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const maquette = read('../fixtures/maquette-07.v2.json');

function fakeCtx(log) {
  const props = {};
  return new Proxy(props, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...args) => { log.push([k, ...args, t.globalAlpha]); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const fakeCanvas = (w, h, log) => {
  const ctx = fakeCtx(log);
  return { width: w, height: h, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) };
};
globalThis.Path2D = class { moveTo() {} lineTo() {} arc() {} closePath() {} rect() {} };

function draw(level, info) {
  const log = [];
  const r = createRenderer(fakeCanvas(1280, 720, log), { makeCanvas: (w, h) => fakeCanvas(w, h, []) });
  r.resize();
  const state = createState(level);
  log.length = 0;
  r.render(state, trace(buildBoard(state)), info);
  return { log, layout: r.layout };
}

test('maquette : l\'indice donne un affichage complet (fantôme, source, texte français)', () => {
  const v = validateLevel(maquette);
  assert.ok(v.ok);
  const h = makeGetHint(v.level)(createState(v.level));
  assert.equal(h.none, undefined);
  assert.equal(h.ghost.type, 'mirror');
  assert.ok(Number.isInteger(h.ghost.o) && h.ghost.o >= 0 && h.ghost.o < 4);
  assert.match(h.text, /^Indice : /);
  assert.match(h.text, /colonne \d+, ligne \d+/);
});

test('fantôme d\'un miroir : image translucide (alpha 0,5) sur la case visée, anneau pointillé sur la source, valeurs finies', () => {
  const v = validateLevel(maquette);
  const h = makeGetHint(v.level)(createState(v.level));
  const { log, layout } = draw(v.level, { hint: h, symbols: true });
  const cell = layout.cell;
  const ghostDraws = log.filter((c) => c[0] === 'drawImage' && c[c.length - 1] === 0.5 && c[c.length - 5] === h.ghost.c * cell && c[c.length - 4] === h.ghost.r * cell);
  assert.ok(ghostDraws.length >= 1, 'fantôme dessiné à 50 % sur la case visée');
  const rings = log.filter((c) => c[0] === 'arc' && c[1] === (h.source.c + 0.5) * cell && c[2] === (h.source.r + 0.5) * cell);
  assert.equal(rings.length, 1, 'un anneau sur la pièce source');
  for (const call of log) for (const a of call.slice(1)) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${call[0]} ${a}`);
  assert.equal(log.filter((c) => c[0] === 'save').length, log.filter((c) => c[0] === 'restore').length, 'état du contexte sauvé puis restauré');
});

test('indice « déplacer » : trait de liaison de la source au fantôme', () => {
  const v = validateLevel(maquette);
  const hint = { ghost: { c: 4, r: 2, o: 1, type: 'mirror' }, source: { c: 3, r: 3 }, moves: true, text: 'x' };
  const { log, layout } = draw(v.level, { hint });
  const link = log.findIndex((c) => c[0] === 'moveTo' && c[1] === layout.cell * 3.5 && c[2] === layout.cell * 3.5);
  assert.ok(link >= 0, 'moveTo sur le centre de la source');
  assert.deepEqual(log[link + 1].slice(0, 3), ['lineTo', layout.cell * 4.5, layout.cell * 2.5]);
});

// Niveau minimal à prisme mobile : le prisme posé en (2,1) envoie le rouge au nord, sur la cible (2,0).
const prismLevel = {
  format: 2, id: 'partage', name: '', size: [5, 3],
  pieces: [
    { type: 'emitter', at: [0, 1], dir: 'E', mask: 'RGB' },
    { type: 'target', at: [2, 0], need: 'R' },
    { type: 'prism', at: [4, 2] },
  ],
};

test('prisme mobile : `o` vaut null dans l\'indice du moteur ; la coque en fait un fantôme de prisme sans rotation', () => {
  const v = validateLevel(prismLevel);
  assert.ok(v.ok, JSON.stringify(v.errors));
  const raw = createHinter(v.level).next(createState(v.level));
  assert.equal(raw.reason, null);
  assert.equal(raw.hint.type, 'prism');
  assert.equal(raw.hint.o, null);
  assert.equal(raw.hint.steps, 0);
  const h = makeGetHint(v.level)(createState(v.level));
  assert.deepEqual([h.ghost.type, h.ghost.o, h.ghost.c, h.ghost.r, h.moves], ['prism', 0, 2, 1, true]);
  assert.match(h.text, /prisme/);
  const { log, layout } = draw(v.level, { hint: h });
  assert.ok(log.some((c) => c[0] === 'drawImage' && c[c.length - 1] === 0.5 && c[c.length - 5] === 2 * layout.cell && c[c.length - 4] === 1 * layout.cell), 'fantôme du prisme à 50 % sur (2,1)');
});

test('suivre les indices jusqu\'au bout gagne (maquette) ; sur un niveau gagné : « déjà résolu », sans fantôme', () => {
  const v = validateLevel(maquette);
  const getHint = makeGetHint(v.level);
  let st = createState(v.level);
  let steps = 0;
  while (!trace(buildBoard(st)).allLit && steps < 12) {
    const raw = createHinter(v.level).next(st);
    assert.equal(raw.reason, null);
    st = applyHint(st, raw.hint);
    steps++;
  }
  assert.ok(trace(buildBoard(st)).allLit, `gagné en ${steps} indices`);
  assert.ok(steps >= 1 && steps <= 6, 'au plus 2K = 6 indices (S7)');
  const none = getHint(st);
  assert.equal(none.none, true);
  assert.equal(none.text, HINT_NONE.won);
  assert.equal(none.ghost, undefined);
});

test('V9b (test final) : indice « ranger … il gêne » sans orientation : le fantôme garde l\'orientation de la pièce déplacée', () => {
  const level = read('../../levels/x01-cyan-et-bleu.json');
  const hinter = createHinter(level), getHint = makeGetHint(level);
  let state = createState(level), parks = 0;
  for (let i = 0; i < 12; i++) {
    const r = hinter.next(state);
    if (r.hint === null) break;
    const h = r.hint, shown = getHint(state);
    const piece = state.pieces.find((p) => p.id === h.pieceId);
    if (h.o === null) { parks++; assert.equal(shown.ghost.o, piece.o, `indice ${i + 1} : fantôme ${shown.ghost.o}, pièce ${piece.o}`); }
    state = applyHint(state, h);
  }
  assert.ok(parks >= 1, 'au moins un indice sans orientation sur x01 (cas du test final)');
});
