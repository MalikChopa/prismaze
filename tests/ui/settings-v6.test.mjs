// V6 (V3-30, P9) : réglages « rendu » et « qualité » : liste blanche, migration sans perte, ligne d'état, mention de baisse, paramètres donnés à l'hôte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, sanitizeSettings, migrateV1, DEFAULT_SETTINGS, SAVE_KEY, RENDERERS, QUALITIES } from '../../src/storage/save.js';
import { renderLine, qualityNotice, QUALITY_TO_HOST } from '../../src/ui/settings.js';
import { rendererParams } from '../../src/ui/app.js';

const storage = (init) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m }; };

test('défauts : rendu et qualité automatiques', () => {
  assert.equal(DEFAULT_SETTINGS.renderer, 'auto');
  assert.equal(DEFAULT_SETTINGS.quality, 'auto');
  assert.deepEqual([...RENDERERS], ['auto', 'webgl', 'canvas']);
  assert.deepEqual([...QUALITIES], ['auto', 'haut', 'moyen', 'bas']);
});

test('sauvegarde v2 d\'avant V6 : nouvelles clés par défaut, réglages, progression et brouillons gardés, réécrite en v3 (V11)', () => {
  const old = { v: 2, levels: { 'm01-tourner': { done: true, best: 2, stars: 3 } }, daily: { '2026-11-08': { done: true, best: 4, stars: 2 } }, dailyCache: null, settings: { muted: true, motion: 'no', symbols: false, camera: false, autohide: false }, drafts: [{ id: 'abc', name: 'essai', code: '1.abc', t: 5 }], last: 'm01-tourner' };
  const st = storage({ [SAVE_KEY]: JSON.stringify(old) });
  const store = createStore({ storage: st });
  assert.deepEqual(store.settings, { muted: true, motion: 'no', symbols: false, camera: false, autohide: false, renderer: 'auto', quality: 'auto', ambient: false });
  assert.equal(store.level('m01-tourner').best, 2);
  assert.equal(store.daily('2026-11-08').best, 4);
  assert.equal(store.drafts.length, 1);
  store.setSetting('quality', 'moyen');
  const written = JSON.parse(st.map.get(SAVE_KEY));
  assert.equal(written.v, 3);
  assert.equal(written.settings.quality, 'moyen');
  assert.equal(written.levels['m01-tourner'].best, 2, 'écrire un réglage ne perd pas la progression');
});

test('migration v1 -> v2 inchangée : les nouvelles clés valent leur défaut', () => {
  const s = migrateV1({ v: 1, settings: { muted: true, motion: 'yes' } }).settings;
  assert.deepEqual(s, { ...DEFAULT_SETTINGS, muted: true, motion: 'yes' });
});

test('valeurs inconnues ou hostiles : retour au défaut, prototype intact', () => {
  for (const bad of ['gl', '', 0, null, true, ['webgl'], { a: 1 }]) {
    const s = sanitizeSettings({ renderer: bad, quality: bad });
    assert.equal(s.renderer, 'auto');
    assert.equal(s.quality, 'auto');
  }
  const hostile = JSON.parse('{"__proto__": {"renderer": "webgl"}, "quality": "ultra"}');
  assert.equal(sanitizeSettings(hostile).renderer, 'auto');
  assert.equal(({}).renderer, undefined);
});

test('aller-retour, et setSetting refuse une valeur inconnue', () => {
  const st = storage({});
  const a = createStore({ storage: st });
  a.setSetting('renderer', 'canvas');
  a.setSetting('quality', 'bas');
  const b = createStore({ storage: st });
  assert.equal(b.settings.renderer, 'canvas');
  assert.equal(b.settings.quality, 'bas');
  b.setSetting('quality', 'extreme');
  assert.equal(b.settings.quality, 'auto', 'valeur inconnue : défaut');
});

test('le niveau du gouverneur n\'est jamais enregistré', () => {
  assert.equal(Object.keys(DEFAULT_SETTINGS).some((k) => /govern|level/i.test(k)), false);
});

test('QUALITY_TO_HOST : valeurs attendues par host.setQuality', () => {
  assert.deepEqual({ ...QUALITY_TO_HOST }, { auto: 'auto', haut: 0, moyen: 1, bas: 2 });
});

test('renderLine dit ce qui est affiché réellement', () => {
  assert.equal(renderLine({ backend: 'gl', quality: 1, qualitySetting: 'auto', rendererSetting: 'auto' }), 'Rendu : WebGL2 · Moyen (auto)');
  assert.equal(renderLine({ backend: 'c2d', quality: 0, qualitySetting: 'auto', rendererSetting: 'canvas' }), 'Rendu : Canvas 2D · Haut (auto)');
  assert.equal(renderLine({ backend: 'gl', quality: 2, qualitySetting: 'bas', rendererSetting: 'webgl' }), 'Rendu : WebGL2 · Bas');
  assert.equal(renderLine({ backend: 'c2d', quality: 0, qualitySetting: 'haut', rendererSetting: 'webgl' }), 'Rendu : Canvas 2D (WebGL2 indisponible) · Haut');
});

test('P9 : mention seulement pour une baisse du gouverneur, en réglage automatique', () => {
  const ev = (reason, type = 'quality-change') => ({ type, reason });
  const down = qualityNotice(0, ev('governor:Moyen'), 'auto');
  assert.equal(down.level, 1);
  assert.match(down.text, /Moyen/);
  assert.equal(qualityNotice(1, ev('governor:Haut'), 'auto').text, null, 'remontée : silence');
  assert.equal(qualityNotice(1, ev('governor:Haut'), 'auto').level, 0, 'remontée : niveau suivi');
  assert.equal(qualityNotice(1, ev('governor:Moyen'), 'auto').text, null, 'même niveau : silence');
  assert.equal(qualityNotice(0, ev('governor:Bas'), 'moyen').text, null, 'qualité imposée : silence');
  assert.deepEqual(qualityNotice(1, ev('context-lost', 'backend-change'), 'auto'), { level: 1, text: null });
  assert.deepEqual(qualityNotice(1, ev('governor:Ultra'), 'auto'), { level: 1, text: null });
  assert.deepEqual(qualityNotice(1, null, 'auto'), { level: 1, text: null });
});

test('rendererParams : le réglage devient `r`, une adresse `?r=` reste prioritaire, l\'original n\'est pas modifié', () => {
  const p = new URLSearchParams('debug&x=1');
  assert.equal(rendererParams(p, 'webgl').get('r'), 'gl');
  assert.equal(rendererParams(p, 'canvas').get('r'), '2d');
  assert.equal(rendererParams(p, 'auto').has('r'), false);
  assert.equal(p.has('r'), false);
  assert.equal(rendererParams(p, 'webgl').has('debug'), true);
  assert.equal(rendererParams(new URLSearchParams('r=2d'), 'webgl').get('r'), '2d');
});
