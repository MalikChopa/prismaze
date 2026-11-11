// Rendu : disposition (pure), thème du style B, symboles, atlas de sprites. Le dessin réel est jugé sur les captures (docs/qa/J4/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout } from '../src/render/renderer.js';
import { THEME, GEOM } from '../src/render/theme.js';
import { staticKey } from '../src/render/static-layer.js';
import { symbolPath } from '../src/render/symbols.js';
import { createAtlas } from '../src/render/sprites.js';
import { createState } from '../src/engine/state.js';
import { COLOR_HUES, COLOR_SYMBOLS } from '../src/engine/colors.js';
import { levelFromAscii } from './engine/helpers.mjs';

test('computeLayout : plateau entier dans la fenêtre, case entière, centré', () => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [412, 915], [360, 640], [800, 500], [100, 100]]) {
    const L = computeLayout(w, h, 10, 6);
    assert.ok(Number.isInteger(L.cell) && L.cell >= 8 && L.cell <= 88, `${w}x${h} cell=${L.cell}`);
    assert.equal(L.boardW, L.cell * 10);
    assert.equal(L.boardH, L.cell * 6);
    if (w >= 360) {
      assert.ok(L.x0 >= 0 && L.x0 + L.boardW <= w, `${w}x${h} horizontal`);
      assert.ok(L.y0 + L.boardH <= h, `${w}x${h} vertical`);
    }
    assert.ok(Math.abs(L.x0 - (w - L.boardW) / 2) <= 0.5, 'centré');
  }
});

test('thème : fond, texte et accents du style B ; teintes = celles du moteur (E2)', () => {
  assert.equal(THEME.bg, '#06061a');
  assert.equal(THEME.accent, '#8f7bff');
  assert.equal(THEME.hues, COLOR_HUES);
  assert.equal(THEME.hues[3], '#ffd23f');
  const alpha = Number(/rgba\([^)]*,\s*([0-9.]+)\)/.exec(THEME.textDim)[1]);
  assert.ok(alpha >= 0.62, `texte secondaire ${alpha}`);
  assert.ok(Number(/,\s*([0-9.]+)\)/.exec(THEME.buttonBorder)[1]) >= 0.55, 'bordure de bouton >= 55 %');
  assert.equal(GEOM.rotateMs, 90);
});

test('D6 : chaque couleur (1..7) a un symbole vectoriel distinct, sans texte', () => {
  const seen = new Set();
  for (let m = 1; m <= 7; m++) {
    const ops = [];
    const ctx = new Proxy({}, { get: (t, k) => (...a) => { ops.push(`${String(k)}:${a.map((x) => (typeof x === 'number' ? x.toFixed(2) : x)).join(',')}`); } });
    symbolPath(ctx, m, 0, 0, 10);
    assert.ok(ops.length >= 1, `symbole ${m} (${COLOR_SYMBOLS[m]})`);
    assert.ok(!ops.some((o) => o.startsWith('fillText')));
    seen.add(ops.join('|'));
  }
  assert.equal(seen.size, 7);
});

test('atlas : 7 familles de bandes (couchée, debout) x 3 couches, halos, jetons, pièces ; taille en pixels périphériques', () => {
  const made = [];
  const mk = (w, h) => {
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : String(k).startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
    const c = { width: w, height: h, getContext: () => ctx };
    made.push(c);
    return c;
  };
  const a = createAtlas(64, 2, mk);
  for (let m = 1; m <= 7; m++) {
    assert.equal(a.beam[m].length, 2);
    assert.equal(a.beam[m][0].length, 3);
    assert.ok(a.glow[m] && a.dot[m] && a.token[m]);
  }
  assert.equal(a.mirror.length, 4);
  assert.equal(a.splitter.length, 4);
  assert.equal(a.tile.width, 128);
  assert.ok(made.length < 150, `canevas fabriqués : ${made.length}`);
});

test('staticKey change avec la taille de case, le dpr, les murs et les pièces fixes, pas avec les pièces mobiles', () => {
  const a = createState(levelFromAscii(['>./#', '..T.', '....']));
  const b = createState(levelFromAscii(['>.\\#', '..T.', '....']));
  const c = createState(levelFromAscii(['>./.', '..T#', '....']));
  assert.equal(staticKey(a, 64, 1), staticKey(b, 64, 1));
  assert.notEqual(staticKey(a, 64, 1), staticKey(a, 65, 1));
  assert.notEqual(staticKey(a, 64, 1), staticKey(a, 64, 2));
  assert.notEqual(staticKey(a, 64, 1), staticKey(c, 64, 1));
});
