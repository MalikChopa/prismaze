// V11 : sauvegarde v3 (succès, drapeaux, écrans vus, musique d'ambiance) : migration depuis v2 sans perte, liste blanche, réinitialisation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, parseSave, sanitizeSave, defaultSave, SAVE_KEY, SAVE_VERSION, ACHIEVEMENT_IDS, BACKUP_KEY } from '../../src/storage/save.js';

const storage = (init = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const V2 = { v: 2, levels: { 'm01-tourner': { done: true, best: 1, stars: 3 }, 'm02-glisser': { done: true, best: 2, stars: 2 } }, daily: { '2026-11-08': { done: true, best: 4, stars: 2 } }, dailyCache: { date: '2026-11-08', v: 1, code: '1.abc', m: 3 }, settings: { muted: true, motion: 'yes', symbols: false, camera: false, autohide: true, renderer: 'canvas', quality: 'bas' }, drafts: [{ id: 'd1', name: 'essai', code: '1.xyz', t: 7 }], last: 'm02-glisser' };

test('v3 : version 3, nouvelles clés neuves (succès vides, drapeaux faux, rien de vu, musique éteinte)', () => {
  assert.equal(SAVE_VERSION, 3);
  const d = defaultSave();
  assert.deepEqual([d.v, d.ach, d.flags, d.seen, d.settings.ambient], [3, {}, { nohint: false, firsttry: false, shared: false }, { howto: false }, false]);
  assert.equal(ACHIEVEMENT_IDS.length, 12);
});

test('migration v2 -> v3 : rien n\'est perdu (niveaux, défis, cache, réglages, brouillons, dernier niveau) ; réécrite en v3, l\'ancienne en copie', () => {
  const text = JSON.stringify(V2);
  const st = storage({ [SAVE_KEY]: text });
  const store = createStore({ storage: st });
  assert.equal(store.status.migrated, true);
  assert.equal(store.status.mode, 'ok');
  const d = store.data;
  assert.deepEqual(d.levels, V2.levels);
  assert.deepEqual(d.daily, V2.daily);
  assert.deepEqual(d.dailyCache, V2.dailyCache);
  assert.deepEqual(d.drafts, V2.drafts);
  assert.equal(d.last, 'm02-glisser');
  assert.deepEqual(store.settings, { ...V2.settings, ambient: false });
  assert.deepEqual([d.ach, d.flags, d.seen], [{}, { nohint: false, firsttry: false, shared: false }, { howto: false }]);
  store.setSetting('ambient', true);
  const w = JSON.parse(st.m.get(SAVE_KEY));
  assert.equal(w.v, 3);
  assert.equal(st.m.get(BACKUP_KEY), text, 'la sauvegarde v2 est gardée en copie');
  assert.deepEqual(w.levels, V2.levels);
  assert.equal(w.settings.ambient, true);
  // relue par un autre store : identique, plus de migration
  const again = createStore({ storage: st });
  assert.equal(again.status.migrated, false);
  assert.deepEqual(again.data, store.data);
});

test('v3 : succès, drapeaux, écrans vus : liste blanche stricte (ids inconnus, dates invalides, valeurs non booléennes, __proto__)', () => {
  const raw = JSON.parse('{"v":3,"ach":{"first-light":"2026-11-10","inconnu":"2026-11-10","mirrors":"hier","__proto__":{"x":1},"streak":5},"flags":{"nohint":true,"firsttry":"oui","shared":1,"autre":true},"seen":{"howto":true,"intro":true}}');
  const d = sanitizeSave(raw);
  assert.deepEqual(d.ach, { 'first-light': '2026-11-10' });
  assert.deepEqual(d.flags, { nohint: true, firsttry: false, shared: false });
  assert.deepEqual(d.seen, { howto: true });
  assert.equal(({}).x, undefined, 'prototype non pollué');
  assert.equal(parseSave(JSON.stringify({ v: 4 })).readonly, true, 'v4 : plus récente, lecture seule');
});

test('v3 : grantAchievements ajoute seulement les absents (date du jour), setFlag et markSeen ne posent qu\'une fois ; tout est relu', () => {
  const st = storage();
  const s = createStore({ storage: st });
  assert.deepEqual(s.grantAchievements(['first-light', 'mirrors', 'first-light', 'pas-un-succes'], '2026-11-10'), ['first-light', 'mirrors']);
  assert.deepEqual(s.grantAchievements(['first-light', 'colors'], '2026-11-11'), ['colors']);
  assert.deepEqual(s.grantAchievements(['prisms'], 'demain'), [], 'date invalide : rien');
  assert.deepEqual(s.achievements, { 'first-light': '2026-11-10', mirrors: '2026-11-10', colors: '2026-11-11' });
  assert.equal(s.setFlag('shared'), true);
  assert.equal(s.setFlag('shared'), false);
  assert.equal(s.setFlag('inconnu'), false);
  assert.equal(s.markSeen('howto'), true);
  assert.equal(s.markSeen('howto'), false);
  const b = createStore({ storage: st });
  assert.deepEqual([b.achievements, b.flags.shared, b.seen.howto], [s.achievements, true, true]);
});

test('v3 : réinitialiser la progression efface aussi succès et drapeaux ; réglages, brouillons et écrans vus gardés', () => {
  const st = storage({ [SAVE_KEY]: JSON.stringify({ ...V2, v: 3, ach: { 'first-light': '2026-11-10' }, flags: { nohint: true }, seen: { howto: true } }) });
  const s = createStore({ storage: st });
  s.resetProgress();
  const d = s.data;
  assert.deepEqual([d.levels, d.ach, d.flags.nohint, d.seen.howto, d.drafts.length, d.settings.renderer], [{}, {}, false, true, 1, 'canvas']);
});
