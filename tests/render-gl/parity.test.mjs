// Parité GL / Canvas 2D sur la galerie (V3-32, V3-39) : mêmes états de cible (enregistreur d'appels côté 2D, données d'instances côté GL), mêmes pièces.
// Niveau galerie : tests/fixtures/galerie-gl.json (une pièce de chaque type, chaque état de cible), tracé par le vrai moteur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createState } from '../../src/engine/state.js';
import { buildBoard } from '../../src/engine/board.js';
import { trace } from '../../src/engine/trace.js';
import { createPieceBuilder, T, FLOATS, targetVisualState, TARGET_STATE_NAMES } from '../../src/render/gl/piece-data.js';
import { createSegmentPost, kindsOfState } from '../../src/render/scene/segments.js';
import { drawTarget } from '../../src/render/pieces.js';

const level = JSON.parse(fs.readFileSync(new URL('../fixtures/galerie-gl.json', import.meta.url), 'utf8'));
const state = createState(level);
const result = trace(buildBoard(state));
const post = createSegmentPost(state.cols, state.rows);
post.run(result.segments(), kindsOfState(state), result.in, result.out, 60);

function buildGl(info = { symbols: true }) {
  const b = createPieceBuilder();
  b.build(state, result, info, { nowMs: 0, dtS: 1, snap: true, post, symbols: true });
  return b;
}
const fieldOf = (L, i, f) => L.data[i * FLOATS + f];
const instancesOfType = (L, t) => { const out = []; for (let i = 0; i < L.count; i++) if (fieldOf(L, i, 3) === t) out.push(i); return out; };
const pieceAt = (c, r) => state.pieces.find((p) => p.c === c && p.r === r);

test('galerie : les 3 états qui ne dépendent pas d\'un miroir sont bien obtenus par le moteur', () => {
  const idx = (c, r) => state.pieces.filter((p) => p.type === 'target').indexOf(pieceAt(c, r));
  assert.equal(targetVisualState(result.targets[idx(2, 0)]), 3, 'allumée');
  assert.equal(targetVisualState(result.targets[idx(5, 0)]), 0, 'éteinte');
  assert.equal(targetVisualState(result.targets[idx(7, 1)]), 1, 'partielle');
  assert.equal(targetVisualState(result.targets[idx(7, 2)]), 2, 'trop');
  for (const [k, n] of [[idx(2, 0), 'allumee'], [idx(5, 0), 'eteinte'], [idx(7, 1), 'partielle'], [idx(7, 2), 'trop']]) {
    assert.equal(TARGET_STATE_NAMES[targetVisualState(result.targets[k])], n);
  }
});

test('V3-32 : le GL pose un jeton d\'état par cible, identique à targetVisualState', () => {
  const b = buildGl();
  const over = instancesOfType(b.top, T.TARGET_OVER);
  assert.equal(over.length, result.targets.length);
  over.forEach((i, t) => {
    assert.equal(fieldOf(b.top, i, 20), targetVisualState(result.targets[t]), `état de la cible ${t}`);
  });
});

/** Faux contexte Canvas 2D qui enregistre les appels (V3-32). */
function recorder() {
  const log = [];
  const c = new Proxy({ log, dash: [], globalAlpha: 1 }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'setLineDash') return (a) => { t.dash = a; log.push(['dash', a.length]); };
      return (...args) => { log.push([String(k), ...args]); };
    },
    set(t, k, v) { t[k] = v; if (k === 'fillStyle' || k === 'strokeStyle') log.push([k, v]); return true; },
  });
  return c;
}
const moves = (log, from = 0) => log.slice(from).filter((l) => l[0] === 'moveTo').length;
const has = (log, k) => log.some((l) => l[0] === k);
const dashed = (log) => log.some((l) => l[0] === 'dash' && l[1] > 0);

test('V3-32 : côté 2D, l\'enregistreur retrouve les 4 états de la même règle', () => {
  const run = (x) => { const c = recorder(); drawTarget(c, 50, 50, 62, x.need, x.got, x.lit, x.reached); return c.log; };
  const off = run({ need: 3, got: 0, lit: false, reached: false });
  const part = run({ need: 3, got: 1, lit: false, reached: false });
  const too = run({ need: 1, got: 7, lit: false, reached: true });
  const lit = run({ need: 3, got: 3, lit: true, reached: true });
  assert.ok(dashed(off), 'éteinte : pointillé');
  assert.ok(!dashed(part) && !dashed(too) && !dashed(lit));
  assert.ok(moves(too) - moves(part) >= 2, 'trop : les deux traits de la croix en plus');
  assert.ok(has(lit, 'arc'), 'allumée : disque de la coche');
  for (const x of [{ need: 3, got: 0, lit: false, reached: false }, { need: 3, got: 1, lit: false, reached: false }, { need: 1, got: 7, lit: false, reached: true }, { need: 3, got: 3, lit: true, reached: true }]) {
    const vs = targetVisualState(x);
    assert.ok(vs >= 0 && vs <= 3);
  }
});

test('V3-39 : le GL dessine séparateurs, portails (paires 1 à 4), 6 filtres, portes (ouverte et fermée) avec lien, murs, émetteurs, cibles', () => {
  const b = buildGl();
  const under = b.under, over = b.over, top = b.top;
  const nums = (L, t, field) => instancesOfType(L, t).map((i) => fieldOf(L, i, field));
  assert.equal(instancesOfType(under, T.SPLITTER).length, 2, 'deux séparateurs');
  assert.deepEqual(nums(over, T.PORTAL, 23).sort(), [1, 1, 2, 2, 3, 3, 4, 4], 'portails : 8 instances, n = 1..4 points');
  assert.equal(instancesOfType(under, T.FILTER).length, 6, 'six filtres');
  assert.equal(instancesOfType(top, T.TOKEN).filter((i) => fieldOf(top, i, 6) > 0).length, 6, 'jetons de filtre (b = taille)');
  const gates = nums(under, T.GATE, 20);
  assert.equal(gates.length, 2, 'deux portes');
  assert.ok(gates.includes(0) && gates.includes(1), 'une fermée, une ouverte');
  assert.equal(instancesOfType(under, T.LINK).length, 2, 'lien pointillé pour chaque porte');
  assert.ok(instancesOfType(under, T.WALL).length > 0);
  assert.ok(instancesOfType(under, T.EMITTER).length > 0);
  assert.equal(instancesOfType(under, T.TARGET).length, result.targets.length);
  assert.equal(instancesOfType(top, T.PASTILLES).length, 2, 'pastilles sur les deux cibles liées');
});

test('V3-7 : les cases coupées reçoivent l\'anneau de croisement côté GL', () => {
  const b = buildGl();
  assert.equal(post.cutCount, 1, 'une coupure dans la galerie, en (7,4)');
  const rings = instancesOfType(b.top, T.RING);
  assert.equal(rings.length, post.cutCount);
  assert.deepEqual([fieldOf(b.top, rings[0], 0), fieldOf(b.top, rings[0], 1)], [7.5, 4.5]);
});

test('V3-37 : voies de contre-sens et jetons : tronçons et jetons repris tels quels de segments.js', () => {
  assert.ok(post.laneCount >= 2, 'voies rouge/bleu en rangée 7');
  const b = buildGl({ symbols: true });
  const tokens = instancesOfType(b.top, T.TOKEN).filter((i) => fieldOf(b.top, i, 6) === 0);
  assert.equal(tokens.length, post.tokens.count);
  const none = buildGl({ symbols: false });
  assert.ok(instancesOfType(none.top, T.TARGET_OVER).length > 0, 'les états des cibles ne dépendent pas du réglage symboles');
});

test('curseur, indice, aperçu, case refusée : surimpressions GL (parité DOIT du tableau §1)', () => {
  const rf = { id: pieceAt(9, 0).id, at: { c: 9, r: 1 }, from: { c: 9, r: 0 }, t0: -100 };
  const info = { symbols: true, cursor: { c: 1, r: 1, holding: true }, hint: { ghost: { c: 8, r: 8, o: 1, type: 'mirror' }, source: { c: 9, r: 0 }, moves: true }, preview: { c: 10, r: 0, o: 2, type: 'mirror' }, refuse: rf, flash: { c: 0, r: 0 } };
  const b = createPieceBuilder();
  b.build(state, result, info, { nowMs: 0, dtS: 1, snap: true, post, symbols: true });
  assert.equal(instancesOfType(b.top, T.FRAME).length, 3, 'curseur + aperçu + éclair');
  assert.equal(instancesOfType(b.top, T.HINT_RING).length, 1, 'anneau d\'indice');
  assert.ok(instancesOfType(b.top, T.LINK).length >= 1, 'fil d\'indice');
  assert.equal(instancesOfType(b.top, T.REFUSED).length, 1, 'case refusée');
  assert.ok(instancesOfType(b.top, T.MIRROR).length >= 2, 'fantômes d\'indice et d\'aperçu');
});
