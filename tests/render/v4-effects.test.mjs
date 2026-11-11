// V4 : victoire (V3-27), effets (V3-28, V3-29, V3-41), analyseur de flashs (V3-20). Tout est pur : aucun navigateur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { VICTORY, victoryFrame, victoryEvents, pushCeiling } from '../../src/render/scene/victory.js';
import { createEffects, createLitLimiter, LIT_MAX_PER_SEC } from '../../src/render/effects.js';
import { QUALITY } from '../../src/render/scene/quality.js';
import { analyse, GW, GH, srgb8ToLinear, reduceToBlocks } from '../lib/flash-analyse.mjs';

const V = VICTORY;
test('victoire : événements de V3-27 aux bons instants, gerbes bornées', () => {
  const ev = victoryEvents(-1, 3700, { seed: 7, targets: 3 });
  const stars = ev.filter((e) => e.type === 'stars');
  assert.deepEqual(stars.map((e) => [e.t, e.n]), [[40, 30], [450, 16]]);
  assert.equal(ev.filter((e) => e.type === 'all')[0].t, 40);
  assert.equal(ev.filter((e) => e.type === 'all')[0].n, 80);
  assert.equal(ev.filter((e) => e.type === 'half')[0].t, 450);
  const rain = ev.filter((e) => e.type === 'one');
  assert.equal(rain[0].t, 550);
  assert.equal(rain.length, 8); // 550 + 7·420 = 3 490 ; 3 910 > 3 600
  for (let i = 0; i < rain.length; i++) { assert.equal(rain[i].t, 550 + i * 420); assert.ok(rain[i].target >= 0 && rain[i].target < 3); }
  for (const e of ev) assert.ok(e.t <= V.END_MS);
});

test('victoire : pas de doublon quand on découpe le temps, découpage quelconque', () => {
  const opts = { seed: 42, targets: 4 };
  const all = victoryEvents(-1, 3700, opts).map((e) => `${e.t}:${e.type}:${e.target ?? ''}`);
  const cuts = [];
  let t0 = -1;
  for (let t = 0; t <= 3700; t += 13) { cuts.push(...victoryEvents(t0, t, opts).map((e) => `${e.t}:${e.type}:${e.target ?? ''}`)); t0 = t; }
  assert.deepEqual(cuts, all);
});

test('victoire : état continu (onde, flash, poussée de gain, panneau, focus, fin)', () => {
  const f0 = victoryFrame(0), f100 = victoryFrame(100), f1300 = victoryFrame(1300), f3600 = victoryFrame(3600);
  assert.equal(f0.flash, 0); assert.ok(f100.flash > 0 && f100.flash <= 1); assert.ok(victoryFrame(90).flash > 0.7, 'flash : montée 90 ms puis retombée');
  assert.equal(victoryFrame(350).flash, 0);
  assert.ok(Math.abs(victoryFrame(1000).waveR - 1.05) < 1e-9, 'onde : 1,05 écran/s');
  assert.equal(victoryFrame(2600).wave, 0);
  assert.equal(victoryFrame(1299).panel, false);
  assert.equal(f1300.panel, true);
  assert.equal(f1300.focus, false);
  assert.equal(victoryFrame(1650).focus, true);
  assert.equal(f3600.end, true);
  assert.ok(Math.abs(f3600.gain - 1) < 1e-9, 'gain +32 % revenu à 1');
  assert.ok(victoryFrame(1000).gain > 1.3);
  assert.equal(victoryFrame(449).rise, false);
  assert.equal(victoryFrame(450).rise, true);
});

test('P11 : le saut après 300 ms amène à 1 300 ms, plus de gerbe, panneau et focus immédiats', () => {
  const o = { seed: 3, targets: 2, skipAt: 500 };
  const ev = victoryEvents(-1, 3700, o);
  assert.ok(ev.every((e) => e.t < 500));
  const f = victoryFrame(520, { skipAt: 500 });
  assert.equal(f.skipped, true); assert.equal(f.panel, true); assert.equal(f.focus, true);
  assert.ok(f.fade < 1 && f.fade > 0.9);
  assert.equal(victoryFrame(800, { skipAt: 500 }).fade, 0);
  assert.equal(victoryFrame(800, { skipAt: 500 }).end, true);
  assert.equal(victoryFrame(400, { skipAt: 500 }).skipped, false);
});

test('mouvement réduit : ni onde, ni flash, aucune gerbe, panneau à 150 ms', () => {
  const r = { reduced: true };
  assert.equal(victoryEvents(-1, 4000, { ...r, targets: 3 }).length, 0);
  for (const t of [0, 100, 149, 150, 2000]) {
    const f = victoryFrame(t, r);
    assert.equal(f.wave, 0); assert.equal(f.flash, 0); assert.equal(f.rise, true);
  }
  assert.equal(victoryFrame(149, r).panel, false);
  assert.equal(victoryFrame(150, r).panel, true);
  assert.equal(victoryFrame(150, r).end, true);
});

test('plafond de la poussée : jamais sous 1,03, jamais au-dessus de la place libre', () => {
  assert.equal(pushCeiling(1.06), 1.06);
  assert.equal(pushCeiling(1.01), 1.03);
  assert.equal(pushCeiling(0), 1.03);
});

test('V3-41 : au plus 3 allumages par seconde glissante', () => {
  const lim = createLitLimiter();
  assert.equal(LIT_MAX_PER_SEC, 3);
  const ok = [];
  for (let t = 0; t < 2000; t += 166) ok.push(lim.allow(t));
  assert.equal(ok.slice(0, 6).filter(Boolean).length, 3); // 6 allumages en 1 s -> 3 acceptés
  let n = 0;
  for (let t = 3000; t < 3999; t += 50) if (lim.allow(t)) n++;
  assert.ok(n <= 3);
});

// Plateau minimal : deux cibles, deux segments d'un faisceau.
const fakeState = () => ({ cols: 6, rows: 4, pieces: [{ type: 'target', c: 1, r: 0, need: 5 }, { type: 'target', c: 4, r: 3, need: 2 }, { type: 'mirror', c: 2, r: 2 }] });
const fakeResult = (litA, litB) => ({ targets: [{ lit: litA, need: 5, got: litA ? 5 : 0, reached: litA }, { lit: litB, need: 2, got: litB ? 2 : 0, reached: litB }] });
const fakePost = () => ({ out: { count: 2, x0: [0.5, 2.5], y0: [2.5, 2.5], x1: [2.5, 2.5], y1: [2.5, 0.5], mask: [7, 5] } });

function runScenario(q, reduced, frames = 400) {
  const fx = createEffects({ quality: q, reduced });
  const state = fakeState();
  const post = fakePost();
  let t = 0;
  fx.update({ nowMs: t, state, result: fakeResult(false, false), post, won: false });
  for (let i = 0; i < frames; i++) {
    t += 16.667;
    const lit = i >= 60;
    const v = i >= 120 ? { t: t - 120 * 16.667, skipAt: null, id: 1 } : null;
    fx.update({ nowMs: t, state, result: fakeResult(lit, i >= 62), post, won: i >= 120, victory: v, levelKey: 'm01-test' });
  }
  return fx;
}

test('V3-28 : particules vivantes et pic bornés par le réservoir de la qualité, 3 qualités', () => {
  for (const q of [0, 1, 2]) {
    const fx = runScenario(q, false);
    assert.ok(fx.peak > 0, `qualité ${q}`);
    assert.ok(fx.peak <= QUALITY[q].pool, `pic ${fx.peak} > réservoir ${QUALITY[q].pool}`);
    assert.ok(fx.alive <= QUALITY[q].pool);
  }
  const haut = runScenario(0, false).peak, bas = runScenario(2, false).peak;
  assert.ok(haut > bas, `Haut ${haut} > Bas ${bas}`);
});

test('P4 : mouvement réduit = aucune particule, aucune émission', () => {
  const fx = runScenario(0, true);
  assert.equal(fx.peak, 0);
  assert.equal(fx.emitted, 0);
  assert.equal(fx.alive, 0);
});

test('V3-29 : mêmes entrées = mêmes particules ; aucun Math.random dans src/render/', () => {
  const a = runScenario(0, false), b = runScenario(0, false);
  assert.equal(a.checksum(), b.checksum());
  assert.equal(a.peak, b.peak);
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const file of walk('src/render')) {
    const code = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(/Math\.random/.test(code), false, `${file} utilise Math.random`);
  }
});

test('V3-29 : les effets ne touchent ni au tracé ni à l\'état', () => {
  const fx = createEffects({ quality: 0 });
  const state = Object.freeze({ ...fakeState(), pieces: Object.freeze(fakeState().pieces.map((p) => Object.freeze(p))) });
  const r = fakeResult(true, false);
  const before = JSON.stringify([state, r]);
  fx.update({ nowMs: 0, state, result: fakeResult(false, false), post: fakePost(), won: false });
  fx.update({ nowMs: 16, state, result: r, post: fakePost(), won: false });
  assert.equal(JSON.stringify([state, r]), before);
});

test('V3-41 dans les effets : la cible qui clignote ne fait au plus que 3 gerbes par seconde', () => {
  const fx = createEffects({ quality: 0 });
  const state = fakeState();
  let t = 0, bursts = 0;
  fx.update({ nowMs: t, state, result: fakeResult(false, false), post: fakePost(), won: false });
  for (let i = 0; i < 6; i++) { // 6 allumages en 1 s
    t += 83; fx.update({ nowMs: t, state, result: fakeResult(true, false), post: fakePost(), won: false }); if (fx.litAllowed[0] === 1) bursts++;
    t += 83; fx.update({ nowMs: t, state, result: fakeResult(false, false), post: fakePost(), won: false });
  }
  assert.equal(bursts, 3);
});

// ---- analyseur de flashs : cas synthétiques de V3-20 ----
const mk = (T, fn) => Array.from({ length: T }, (_, t) => { const f = new Float32Array(GW * GH * 3); for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) f.set(fn(t, x, y), (y * GW + x) * 3); return f; });
const c = (r, g, b) => [srgb8ToLinear(r), srgb8ToLinear(g), srgb8ToLinear(b)];
const DARK = c(20, 20, 40), LIGHT = c(200, 200, 220), RED = c(255, 0, 0), GREY = c(70, 70, 70);
const region = (x0, y0, w, h) => (x, y) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
const strobe = (hz, inR) => (t, x, y) => (inR(x, y) && Math.floor((t * hz * 2) / 60) % 2 ? LIGHT : DARK);

test('analyseur : plein écran 6 flashs/s -> échec ; 3 flashs/s -> passe', () => {
  assert.equal(analyse(mk(120, strobe(6, () => true))).general.fail, true);
  assert.equal(analyse(mk(120, strobe(3, () => true))).general.fail, false);
});

test('analyseur : région 63 blocs -> passe ; 64 blocs -> échec', () => {
  assert.equal(analyse(mk(120, strobe(6, region(10, 10, 7, 9)))).general.fail, false);
  assert.equal(analyse(mk(120, strobe(6, region(10, 10, 8, 8)))).general.fail, true);
});

test('analyseur : flash doux Δ0,3 sur 64 blocs -> échec (la moyenne de zone ne le voyait pas)', () => {
  const r = region(10, 10, 8, 8);
  assert.equal(analyse(mk(120, (t, x, y) => (r(x, y) && Math.floor((t * 12) / 60) % 2 ? c(150, 150, 170) : c(30, 30, 50)))).general.fail, true);
});

test('analyseur : rouge saturé <-> gris à 5 Hz -> échec rouge ; images claires -> passe ; retombée douce -> passe', () => {
  assert.equal(analyse(mk(120, (t) => (Math.floor((t * 10) / 60) % 2 ? RED : GREY))).red.fail, true);
  assert.equal(analyse(mk(120, (t) => (Math.floor((t * 12) / 60) % 2 ? c(255, 255, 255) : c(240, 240, 240)))).general.fail, false);
  assert.equal(analyse(mk(120, (t) => { const v = 20 + 180 * Math.exp(-t / 20); return c(v, v, v + 20); })).general.fail, false);
});

test('analyseur : variation d\'une image à l\'autre, réduction en blocs linéaires', () => {
  const a = analyse(mk(10, (t) => (t < 5 ? c(0, 0, 0) : c(255, 255, 255))));
  assert.equal(a.lumaStepOk, false);
  const w = 128, h = 72, rgba = new Uint8Array(w * h * 4).fill(255);
  const blocks = reduceToBlocks(rgba, w, h);
  assert.ok(Math.abs(blocks[0] - 1) < 1e-6 && Math.abs(blocks[GW * GH * 3 - 1] - 1) < 1e-6);
  assert.ok(Math.abs(srgb8ToLinear(128) - 0.2158605) < 1e-5, 'sRGB exact');
});

test('titre : jamais le nom de fichier, chapitres du fichier index ; partagés et éditeur gardent leur nom', async () => {
  const { levelTitle } = await import('../../src/ui/hud.js');
  const idx = JSON.parse(readFileSync('levels/index.json', 'utf8'));
  for (const ch of idx.chapters) for (let i = 0; i < ch.levels.length; i++) {
    const id = ch.levels[i];
    assert.equal(levelTitle(id.toUpperCase(), id), `${ch.name.toUpperCase()} · ${String(i + 1).padStart(2, '0')}`, id);
  }
  assert.equal(levelTitle('MIROIRS · 04', 'm04-contourner'), 'MIROIRS · 04');
  assert.equal(levelTitle('PARTAGÉ · MON NIVEAU', 'partage'), 'PARTAGÉ · MON NIVEAU');
  assert.equal(levelTitle('ESSAI · ÉDITEUR', 'edit'), 'ESSAI · ÉDITEUR');
  assert.equal(levelTitle('DÉFI · 2026-11-09 · v1', 'x10-examen-daily'), 'DÉFI · 2026-11-09 · v1');
});

test('V3-38 : le plafond de zoom de la victoire suit les obstacles mesurés', async () => {
  const { maxFreeZoom } = await import('../../src/ui/stage.js');
  const L = { x0: 100, y0: 100, boardW: 400, boardH: 300, cell: 50, w: 800, h: 600 };
  const bounds = { l: 0, t: 0, r: 800, b: 600 };
  const free = maxFreeZoom(L, [], bounds);
  assert.ok(free >= 1.19, `sans obstacle : ${free}`);
  const dock = { x: 200, y: 412, w: 200, h: 60 }; // dock juste sous le plateau, écart 12 px
  const tight = maxFreeZoom(L, [dock], bounds);
  assert.ok(tight > 1 && tight < free, `dock : ${tight}`);
  const blocked = maxFreeZoom({ ...L, y0: 5 }, [{ x: 200, y: 312, w: 200, h: 60 }, { x: 200, y: 0, w: 200, h: 8 }], bounds);
  assert.ok(blocked <= 1.03);
});

// V9b (audit G1) : cas synthétiques que l'ancien analyseur laissait passer (A1, A4, R1) et leurs témoins (A0, R3).
const grey = (v) => [v, v, v]; // linéaire : luminance relative = v
const rectA = region(20, 10, 21, 12); // exactement le rectangle glissant 21x12 (252 blocs > 63)
test('analyseur G1 : A0 témoin, départ sur un extrême, 0,40 <-> 0,55 à 10 Hz -> échec', () => {
  assert.equal(analyse(mk(120, (t) => grey(Math.floor(t / 3) % 2 ? 0.55 : 0.40))).general.fail, true);
});
test('analyseur G1 : A1, image 0 entre les extrêmes (0,50), puis 0,58 <-> 0,45 à 10 Hz -> échec par la surface', () => {
  const r = analyse(mk(120, (t) => grey(t === 0 ? 0.50 : Math.floor((t - 1) / 3) % 2 ? 0.45 : 0.58)));
  assert.equal(r.general.fail, true);
  assert.ok(r.general.area > 0.25);
});
test('analyseur G1 : A4, sinus 0,50 ± 0,07 à 8 Hz sur un rectangle 21x12 entier -> échec', () => {
  const r = analyse(mk(120, (t, x, y) => (rectA(x, y) ? grey(0.5 + 0.07 * Math.sin((2 * Math.PI * 8 * t) / 60)) : grey(0.02))));
  assert.equal(r.general.fail, true);
  assert.equal(r.pass, false);
});
const mixRG = (w) => [RED[0] * w + GREY[0] * (1 - w), RED[1] * w + GREY[1] * (1 - w), RED[2] * w + GREY[2] * (1 - w)];
const RAMP5 = [1, 1, 1, 0.75, 0.5, 0.25, 0, 0, 0, 0.25, 0.5, 0.75]; // 12 images = 5 Hz, rampes de 3 images
test('analyseur G1 : R1, rouge <-> gris avec rampe de 3 images à 5 Hz -> échec rouge', () => {
  const r = analyse(mk(120, (t) => mixRG(RAMP5[t % 12])));
  assert.equal(r.red.fail, true);
  assert.equal(r.pass, false);
});
test('analyseur G1 : R3, même rampe à 2 Hz -> passe ; R0 coupure nette à 5 Hz -> échec ; fondu lent -> passe', () => {
  const ramp2 = (t) => { const p = t % 30; return p < 3 ? 1 - (p + 1) / 4 : p < 15 ? 0 : p < 18 ? (p - 14) / 4 : 1; };
  assert.equal(analyse(mk(120, (t) => mixRG(ramp2(t)))).red.fail, false);
  assert.equal(analyse(mk(120, (t) => (Math.floor(t / 6) % 2 ? RED : GREY))).red.fail, true);
  assert.equal(analyse(mk(120, (t) => grey(0.1 + (0.8 * Math.min(t, 60)) / 60))).general.fail, false);
});
