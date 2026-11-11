// Automate d'interface (V3-21), voile de lisibilité (V3-23), tables de qualité et mémoire (V3-12, V3-13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHud, HUD, opacityAfter } from '../../../src/render/scene/hud.js';
import { scrimHits, scrimTargets, createScrim, SCRIM, textContrast } from '../../../src/render/scene/scrim.js';
import { QUALITY, bytesPerPixel, effectiveDpr, targetMiB, resolveQuality, MAX_TARGET_PIXELS, MAX_TARGET_MIB } from '../../../src/render/scene/quality.js';
import { makeView } from '../../../src/render/scene/camera.js';
import { layout } from '../../../src/render/scene/layout.js';

test('V3-21 : visible → idle après 3,6 s sans entrée ; transitions 80 ms (apparition) et 700 ms (disparition) ; opacité ≤ 0,05 après 4,5 s', () => {
  const h = createHud();
  assert.equal(h.tick(0).state, 'visible'); assert.equal(h.tick(3599).state, 'visible');
  const r = h.tick(3600); assert.equal(r.state, 'idle'); assert.equal(r.transitionMs, HUD.HIDE_MS); assert.equal(HUD.HIDE_MS, 700); assert.equal(HUD.SHOW_MS, 80);
  assert.ok(opacityAfter('idle', 4500 - 3600) <= 0.05, 'après 4,5 s l\'opacité modélisée est ≤ 0,05');
  const w = h.input(5000); void w;
  const v = h.tick(5000); assert.equal(v.state, 'visible'); assert.equal(v.transitionMs, 80);
  assert.equal(opacityAfter('visible', 80), 1);
});

test('V3-21 : toute entrée (pointermove, pointerdown, touchstart, keydown, focusin) réveille ; la liste des événements est exacte', () => {
  assert.deepEqual([...HUD.WAKE_EVENTS], ['pointermove', 'pointerdown', 'touchstart', 'keydown', 'focusin']);
  const h = createHud(); h.tick(4000);
  assert.equal(h.state, 'idle'); h.input(4001); assert.equal(h.state, 'visible');
  assert.equal(h.tick(4001 + 3599).state, 'visible'); assert.equal(h.tick(4001 + 3600).state, 'idle');
});

test('V3-21 : jamais masquée : réglages ouverts, focus dans la zone, message depuis < 2,2 s, état gagné, indice affiché ; masquage coupé', () => {
  for (const name of ['settings', 'focus', 'won', 'hint']) {
    const h = createHud(); h.pin(name, true, 0);
    assert.equal(h.tick(60000).state, 'visible', name);
    h.pin(name, false, 60000);
    assert.equal(h.tick(60000 + 3599).state, 'visible', `${name} : 3,6 s de répit après l'épingle`); assert.equal(h.tick(60000 + 3600).state, 'idle', name);
  }
  const m = createHud(); m.tick(3500); m.input(0); m.message(3000);
  assert.equal(m.tick(3000 + 2199).state, 'visible');
  const off = createHud({ enabled: false }); assert.equal(off.tick(1e6).state, 'visible');
  off.set({ enabled: true }); assert.equal(off.tick(1e6 + 1).state, 'visible', 'réactivé : pas de masquage immédiat');
  assert.equal(off.idleAt(1e6 + 1), 1e6 + HUD.IDLE_MS);
});

test('V3-23 : voile 0,30 au repos, 0,70 dès qu\'un tronçon (marge 0,6 case) recouvre le rectangle ; calcul seulement sur changement', () => {
  const L = layout({ w: 1280, h: 720, cols: 10, rows: 8 }), V = makeView(L, 1, 0, 0, 10, 8);
  const segs = { count: 1, x0: Float32Array.of(0.5), y0: Float32Array.of(7.5), x1: Float32Array.of(9.5), y1: Float32Array.of(7.5) }; // dernière rangée, horizontale
  const yRow = V.k * 7.5 + V.ty;
  const rects = [
    { x: 500, y: yRow - 10, w: 200, h: 20 }, // sur le faisceau
    { x: 500, y: yRow - 0.6 * V.k + 5, w: 200, h: 20 }, // dans la marge de 0,6 case (au-dessus du faisceau)
    { x: 500, y: yRow - 0.6 * V.k - 60, w: 200, h: 20 }, // à plus de 0,6 case
    { x: 20, y: 20, w: 100, h: 30 }, // loin
  ];
  const hit = scrimHits(rects, segs, V);
  assert.deepEqual([...hit], [1, 1, 0, 0]);
  assert.deepEqual([...scrimTargets(hit, 4)].map((v) => +v.toFixed(2)), [0.7, 0.7, 0.3, 0.3]);
  // segment oblique qui traverse la boîte élargie sans qu'aucune extrémité n'y soit
  const obl = { count: 1, x0: Float32Array.of(0), y0: Float32Array.of(0), x1: Float32Array.of(10), y1: Float32Array.of(8) };
  const mid = { x: V.k * 5 + V.tx - 5, y: V.k * 4 + V.ty - 5, w: 10, h: 10 };
  assert.equal(scrimHits([mid], obl, V)[0], 1);
});

test('V3-23 : transition de 200 ms entre 0,30 et 0,70 ; contraste ≥ 4,5:1 aux deux opacités sur le pire fond (blanc) et sur fond sombre', () => {
  const s = createScrim(1); const t = Float32Array.of(0.7);
  s.step(t, 100); assert.ok(Math.abs(s.opacity[0] - 0.5) < 1e-6); s.step(t, 100); assert.ok(Math.abs(s.opacity[0] - 0.7) < 1e-6); s.step(t, 500); assert.ok(Math.abs(s.opacity[0] - 0.7) < 1e-6);
  for (const a of [SCRIM.HIGH]) assert.ok(textContrast('#ffffff', a) >= 4.5, `0,70 sur blanc : ${textContrast('#ffffff', a).toFixed(2)}`);
  assert.ok(textContrast('#ffffff', 0.66) >= 5.5, '0,66 sur blanc ≈ 5,9 (document)');
  assert.ok(textContrast('#ffffff', 0.55) < 4.5, '0,55 insuffisant (3,95 dans le document)');
  assert.ok(textContrast('#06061a', SCRIM.LOW) >= 4.5, 'repos 0,30 sur fond sombre');
  assert.ok(textContrast('#06061a', SCRIM.LOW) > 15, `fond sombre ${textContrast('#06061a', SCRIM.LOW).toFixed(1)} (document 17,2)`);
});

test('V3-13 : tables de qualité', () => {
  const [h, m, b] = QUALITY;
  assert.deepEqual([h.dprMax, h.bloomScale, h.bloomLevels, h.particles, h.reflection, h.grain, h.pool], [2, 0.5, 6, 1, true, true, 1500]);
  assert.deepEqual([m.dprMax, m.bloomScale, m.bloomLevels, m.particles, m.reflection, m.grain, m.pool], [1.5, 0.25, 5, 0.5, true, true, 750]);
  assert.deepEqual([b.dprMax, b.dprScale, b.bloomScale, b.bloomLevels, b.particles, b.reflection, b.grain, b.pool], [1, 0.8, 0.25, 4, 0.22, false, false, 330]);
  assert.equal(effectiveDpr(0, 3), 2); assert.equal(effectiveDpr(1, 3), 1.5); assert.equal(effectiveDpr(2, 3), 0.8); assert.equal(effectiveDpr(2, 0.5), 0.4);
});

test('V3-12 : mémoire des cibles (MiB) : 1080p 42,2 / 38,2 / 24,5 ; 1440p Haut 75,0 ; 412×915 DPR 2 30,7 / 15,6 / 4,5 ; 4K Haut 168,7', () => {
  const mib = (q, w, h, dpr) => targetMiB(q, w, h, effectiveDpr(q, dpr));
  const close = (got, want, name) => assert.ok(Math.abs(got - want) <= 0.15, `${name} : ${got.toFixed(2)} attendu ${want}`);
  close(mib(0, 1920, 1080, 1), 42.2, '1080p Haut'); close(mib(1, 1920, 1080, 1), 38.2, '1080p Moyen'); close(mib(2, 1920, 1080, 1), 24.5, '1080p Bas');
  close(mib(0, 2560, 1440, 1), 75.0, '1440p Haut');
  close(mib(0, 412, 915, 2), 30.7, 'tél. Haut'); close(mib(1, 412, 915, 2), 15.6, 'tél. Moyen'); close(mib(2, 412, 915, 2), 4.5, 'tél. Bas');
  close(targetMiB(0, 3840, 2160, 1), 168.7, '4K Haut');
  assert.ok(Math.abs(bytesPerPixel(0) - 21.333) < 0.01);
});

test('V3-12 : règle dans cet ordre : (1) plafond de 3,7 M pixels (facteur de résolution), (2) cibles ≤ 80 MiB sinon qualité − 1', () => {
  const k = resolveQuality(0, 3840, 2160, 1);
  assert.equal(k.quality, 0); assert.ok(k.scaled && k.pixels <= MAX_TARGET_PIXELS * 1.001 && k.mib <= MAX_TARGET_MIB, JSON.stringify(k));
  const big = resolveQuality(0, 2560, 1440, 2); // 2560×1440 CSS à DPR 2 : 14,7 Mpx réduits par (1)
  assert.ok(big.scaled && big.pixels <= MAX_TARGET_PIXELS * 1.001 && big.mib <= MAX_TARGET_MIB);
  assert.equal(resolveQuality(0, 1920, 1080, 1).quality, 0);
  assert.equal(resolveQuality(0, 1920, 1080, 1).scaled, false);
  const phone = resolveQuality(1, 412, 915, 3); assert.equal(phone.dpr, 1.5); assert.equal(phone.quality, 1);
  // ordre : un plafond de pixels atteint d'abord ne baisse PAS la qualité si les 80 MiB tiennent après réduction
  assert.equal(resolveQuality(0, 3840, 2160, 2).quality, 0);
  assert.equal(resolveQuality(7, 800, 600, 1).quality, 0, 'qualité inconnue → Haut');
});
