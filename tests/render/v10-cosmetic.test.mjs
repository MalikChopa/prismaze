// V10 : finition cosmétique (étoiles de victoire, marqueurs de faisceau, mur et filtre 2D, dalle et franges WebGL). Pur : aucun navigateur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEffects, STAR_GROW_S } from '../../src/render/effects.js';
import { createParticleSim, KIND } from '../../src/render/scene/particles-sim.js';
import { VICTORY } from '../../src/render/scene/victory.js';
import { FS_COMP, FS_PART, FS_FLOOR, FS_PIECE } from '../../src/render/gl/shaders.js';
import { drawWall, drawToken, drawFilter } from '../../src/render/pieces.js';
import { createState } from '../../src/engine/state.js';
import { process } from './scene/_helpers.mjs';

const fakeState = () => ({ cols: 6, rows: 4, pieces: [{ type: 'target', c: 1, r: 0, need: 5 }, { type: 'target', c: 4, r: 3, need: 2 }, { type: 'mirror', c: 2, r: 2 }] });
const fakeResult = (lit) => ({ targets: [{ lit, need: 5, got: lit ? 5 : 0, reached: lit }, { lit, need: 2, got: lit ? 2 : 0, reached: lit }] });
const fakePost = () => ({ out: { count: 2, x0: [0.5, 2.5], y0: [2.5, 2.5], x1: [2.5, 2.5], y1: [2.5, 0.5], mask: [7, 5] } });

/** Joue une victoire jusqu'à `ms` et renvoie les demi-tailles des étoiles écrites par fill(). */
function starsAt(ms) {
  const fx = createEffects({ quality: 0 });
  const state = fakeState(), post = fakePost();
  let t = 0;
  fx.update({ nowMs: t, state, result: fakeResult(false), post, won: false, levelKey: 'v10' });
  const t0 = 16.667;
  for (t = t0; t <= t0 + ms; t += 16.667) fx.update({ nowMs: t, state, result: fakeResult(true), post, won: true, victory: { t: t - t0, skipAt: null, id: 1 }, levelKey: 'v10' });
  const out = new Float32Array(fx.pool * 8), n = fx.fill(out);
  const halves = [];
  for (let i = 0; i < n; i++) if (out[i * 8 + 3] === KIND.STAR) halves.push(out[i * 8 + 2]);
  return halves;
}

test('étoiles : une gerbe naît petite et grandit en STAR_GROW_S (plus de bandes superposées au point d’émission)', () => {
  assert.ok(STAR_GROW_S > 0.1 && STAR_GROW_S < 0.4);
  const young = starsAt(VICTORY.BURST0_MS + 20), grown = starsAt(VICTORY.BURST0_MS + 300);
  assert.ok(young.length > 0 && grown.length > 0);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(avg(young) < avg(grown) * 0.5, `jeunes ${avg(young).toFixed(3)} / grandies ${avg(grown).toFixed(3)}`);
});

test('burst({advance}) : chaque particule part déjà à v × advance du centre', () => {
  const sim = createParticleSim({ pool: 64, seed: 7 });
  sim.burst({ x: 3, y: 2, n: 20, speed: 5, advance: 0.1, kind: KIND.STAR });
  const d = sim.data, S = d.length / sim.pool;
  for (let i = 0; i < 20; i++) {
    const o = i * S, dist = Math.hypot(d[o] - 3, d[o + 1] - 2), v = Math.hypot(d[o + 2], d[o + 3]);
    assert.ok(Math.abs(dist - v * 0.1) < 1e-4, `particule ${i}`);
  }
});

test('shaders V10 : étoiles hors de la couche du reflet ; aberration limitée au front de l’onde ; débord de la dalle en uniforme', () => {
  assert.match(FS_PART, /o1 = vec4\(c \* step\(0\.5, abs\(vKind - 1\.0\)\), 1\.0\)/);
  assert.match(FS_COMP, /dir \* 0\.0030 \* front/);
  assert.doesNotMatch(FS_COMP, /ring \* 0\.010/);
  assert.match(FS_FLOOR, /uniform vec2[^;]*uPad/);
  assert.match(FS_PIECE, /marqueur de faisceau|sdSeg\(q, vec2\(-0\.058/);
});

test('jetons : chaque marqueur porte l’axe de son faisceau (gélule couchée le long du faisceau)', () => {
  const s = createState({ size: [6, 4], pieces: [{ type: 'target', at: [3, 0], need: 'RGB' }, { type: 'emitter', at: [0, 2], dir: 'E', mask: 'RGB' }, { type: 'mirror', at: [3, 2], o: '/' }] }); // m01 résolu
  const { post } = process(s);
  const tk = post.tokens;
  assert.ok(tk.count >= 2);
  let h = 0, v = 0;
  for (let i = 0; i < tk.count; i++) {
    if (tk.axis[i] === 0) { h++; assert.ok(Math.abs(tk.y[i] - 2.5) < 0.2, 'jeton horizontal sur la ligne 2'); } else { v++; assert.ok(Math.abs(tk.x[i] - 3.5) < 0.2, 'jeton vertical sur la colonne 3'); }
  }
  assert.ok(h > 0 && v > 0, `jetons horizontaux : ${h}, verticaux : ${v}`);
});

/** Faux contexte 2D : enregistre les appels et les couleurs. */
function rec() {
  const calls = [];
  const ctx = new Proxy({ calls }, {
    get(t, k) { if (k in t) return t[k]; if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} }); return (...a) => { calls.push([k, ...a]); }; },
    set(t, k, v) { calls.push(['set:' + String(k), v]); return true; },
  });
  return ctx;
}

test('2D : mur à quatre faces (teintes du WebGL), contre-tourné si le plateau l’est ; jeton en gélule ; filtre en vitrail', () => {
  const a = rec(); drawWall(a, 0, 0, 60, 0);
  const fills = a.calls.filter((c) => c[0] === 'set:fillStyle').map((c) => c[1]);
  for (const f of ['#33375a', '#262a49', '#25273c', '#191b2b']) assert.ok(fills.includes(f), `face ${f}`);
  assert.ok(!a.calls.some((c) => c[0] === 'rotate'));
  const b = rec(); drawWall(b, 0, 0, 60, 1);
  assert.ok(b.calls.some((c) => c[0] === 'rotate' && Math.abs(c[1] + Math.PI / 2) < 1e-9), 'tourné : faces lues depuis l’écran');
  const t = rec(); drawToken(t, 30, 30, 60, 7, 1);
  assert.ok(t.calls.some((c) => c[0] === 'set:lineCap' && c[1] === 'round'), 'gélule');
  assert.ok(!t.calls.some((c) => c[0] === 'arc' && Math.abs(c[3] - 0.125 * 60) < 1e-9), 'plus de disque de 0,125 case');
  const f = rec(); drawFilter(f, 0, 0, 60, 6);
  assert.ok(f.calls.filter((c) => c[0] === 'stroke').length >= 3, 'cadre, plombs, reflet');
});
