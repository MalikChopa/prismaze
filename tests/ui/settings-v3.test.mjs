// V5 (V3-30) : réglages « caméra » et « masquage automatique » : clés ajoutées, `v` reste 2, défauts pour une sauvegarde sans ces clés, valeurs hostiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, sanitizeSettings, DEFAULT_SETTINGS, SAVE_KEY } from '../../src/storage/save.js';

const storage = (init) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m }; };

test('défauts : caméra et masquage actifs ; schéma v3 depuis V11 (v2 avant)', () => {
  assert.equal(DEFAULT_SETTINGS.camera, true);
  assert.equal(DEFAULT_SETTINGS.autohide, true);
  const st = storage({});
  const store = createStore({ storage: st });
  store.setSetting('camera', false);
  assert.equal(JSON.parse(st.map.get(SAVE_KEY)).v, 3, 'V11 : `v` passe à 3 (ajouts seulement ; V3-30 gardait 2)');
});

test('une sauvegarde v2 sans ces clés reçoit les défauts, le reste est identique', () => {
  const v2 = JSON.stringify({ v: 2, levels: { 'm01-tourner': { done: true, best: 2, stars: 3 } }, daily: {}, dailyCache: null, settings: { muted: true, motion: 'yes', symbols: false }, drafts: [], last: 'm01-tourner' });
  const store = createStore({ storage: storage({ [SAVE_KEY]: v2 }) });
  assert.deepEqual(store.settings, { muted: true, motion: 'yes', symbols: false, camera: true, autohide: true, renderer: 'auto', quality: 'auto', ambient: false });
  assert.equal(store.level('m01-tourner').best, 2);
});

test('valeurs invalides : retour au défaut ; clé __proto__ sans effet', () => {
  assert.deepEqual(sanitizeSettings({ camera: 'non', autohide: 0 }), { ...DEFAULT_SETTINGS });
  const hostile = JSON.parse('{"__proto__": {"camera": false}, "camera": "x"}');
  const s = sanitizeSettings(hostile);
  assert.equal(s.camera, true);
  assert.equal(({}).camera, undefined, 'prototype non pollué');
});

test('aller-retour : les deux réglages sont relus par un autre store', () => {
  const st = storage({});
  const a = createStore({ storage: st });
  a.setSetting('camera', false);
  a.setSetting('autohide', false);
  const b = createStore({ storage: st });
  assert.equal(b.settings.camera, false);
  assert.equal(b.settings.autohide, false);
});
