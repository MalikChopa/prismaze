// Sauvegarde v2 (U9) : stockage bloqué, corrompu, migration v1, aller-retour, version plus récente, entrées hostiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore, parseSave, sanitizeV2, migrateV1, defaultSave, starsFor, probeStorage, SAVE_KEY, BACKUP_KEY, MAX_DRAFTS, MAX_DAILY, MAX_RAW,
} from '../../src/storage/save.js';

/** Faux localStorage : une Map, avec options de panne. */
function fakeStorage({ failSet = false, failGet = false, init = {} } = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem(k) { if (failGet) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (failSet) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}

const goodSave = (extra = {}) => JSON.stringify({ v: 2, levels: { 'm01-tourner': { done: true, best: 2, stars: 3 } }, daily: {}, dailyCache: null, settings: { muted: true, motion: 'yes', symbols: false }, drafts: [], last: 'm01-tourner', ...extra });

test('stockage bloqué (null) : mode mémoire, le jeu continue, rien ne lève', () => {
  const store = createStore({ storage: null });
  assert.equal(store.status.mode, 'memory');
  assert.equal(store.persistent, false);
  const r = store.recordLevel('m01-tourner', 1, 1);
  assert.deepEqual([r.best, r.stars, r.saved], [1, 3, false]);
  assert.equal(store.level('m01-tourner').best, 1, 'la progression vit en mémoire');
  store.setSetting('muted', true);
  assert.equal(store.settings.muted, true);
});

test('stockage dont l\'accès lève (SecurityError) : mode mémoire', () => {
  const store = createStore({ storage: fakeStorage({ failGet: true }) });
  assert.equal(store.status.mode, 'memory');
  assert.equal(store.status.reason, 'stockage illisible');
  assert.doesNotThrow(() => store.recordLevel('m01-tourner', 3, 2));
});

test('probeStorage : getter qui lève, stockage nul, écriture refusée -> null ; stockage sain -> lui-même', () => {
  assert.equal(probeStorage(() => { throw new Error('x'); }), null);
  assert.equal(probeStorage(() => null), null);
  assert.equal(probeStorage(() => fakeStorage({ failSet: true })), null);
  const ok = fakeStorage();
  assert.equal(probeStorage(() => ok), ok);
  assert.equal(ok.m.size, 0, 'la sonde se retire');
});

test('écriture refusée en cours de jeu (stockage plein) : bascule en mémoire, la progression reste lisible', () => {
  const st = fakeStorage();
  const store = createStore({ storage: st });
  assert.equal(store.recordLevel('m01-tourner', 1, 1).saved, true);
  st.setItem = () => { throw new Error('QuotaExceededError'); };
  const r = store.recordLevel('m02-glisser', 2, 2);
  assert.equal(r.saved, false);
  assert.equal(store.status.mode, 'memory');
  assert.equal(store.level('m02-glisser').best, 2);
  assert.equal(store.level('m01-tourner').best, 1);
});

test('sauvegarde corrompue : repli sur la copie valide ; sans copie : sauvegarde neuve, l\'écriture suivante remplace', () => {
  const st = fakeStorage({ init: { [SAVE_KEY]: '{"v":2,"levels":{', [BACKUP_KEY]: goodSave() } });
  const store = createStore({ storage: st });
  assert.equal(store.status.recovered, 'copie');
  assert.equal(store.level('m01-tourner').best, 2);
  assert.equal(store.settings.muted, true);

  const st2 = fakeStorage({ init: { [SAVE_KEY]: 'pas du json', [BACKUP_KEY]: 'pas du json non plus' } });
  const s2 = createStore({ storage: st2 });
  assert.equal(s2.status.recovered, 'neuf');
  assert.deepEqual(s2.data.levels, {});
  s2.setSetting('motion', 'no');
  assert.equal(JSON.parse(st2.m.get(SAVE_KEY)).settings.motion, 'no');
});

test('formes corrompues variées : nulle, tableau, nombre, version absente / négative / non entière / énorme texte', () => {
  for (const bad of ['null', '[]', '12', '{}', '{"v":0}', '{"v":-1}', '{"v":"2"}', '{"v":2.5}', '"v":2', '', ' '.repeat(10), 'x'.repeat(MAX_RAW + 1)]) {
    assert.equal(parseSave(bad).ok, false, bad.slice(0, 20));
    const store = createStore({ storage: fakeStorage({ init: { [SAVE_KEY]: bad } }) });
    assert.deepEqual(store.data.levels, {}, 'sauvegarde neuve');
  }
});

test('migration v1 -> v2 : réglages gardés, niveaux et dernier niveau abandonnés, ancien texte gardé en copie', () => {
  const v1 = JSON.stringify({ v: 1, levels: { '01-tourner': { done: true, best: 1 } }, settings: { muted: true, motion: 'no', patterns: true }, last: '02-glisser' });
  const st = fakeStorage({ init: { [SAVE_KEY]: v1 } });
  const store = createStore({ storage: st });
  assert.equal(store.status.migrated, true);
  assert.deepEqual(store.data.levels, {});
  assert.equal(store.data.last, null);
  assert.deepEqual(store.settings, { muted: true, motion: 'no', symbols: true, camera: true, autohide: true, renderer: 'auto', quality: 'auto', ambient: false }, 'patterns abandonné, symboles par défaut (P12)');
  store.setSetting('symbols', false);
  assert.equal(JSON.parse(st.m.get(SAVE_KEY)).v, 3); // V11 : v1 -> v3 directement (v2 puis ajouts de v3)
  assert.equal(st.m.get(BACKUP_KEY), v1, 'la sauvegarde v1 est conservée en copie');
  assert.deepEqual(migrateV1({ v: 1, settings: { motion: 'bidon', muted: 3 } }).settings, { muted: false, motion: 'auto', symbols: true, camera: true, autohide: true, renderer: 'auto', quality: 'auto', ambient: false });
});

test('aller-retour : écrire puis relire dans un autre store donne les mêmes données', () => {
  const st = fakeStorage();
  const a = createStore({ storage: st });
  a.recordLevel('m01-tourner', 1, 1);
  a.recordLevel('m02-glisser', 3, 2);
  a.setSetting('muted', true); a.setSetting('motion', 'yes'); a.setSetting('symbols', false);
  a.setLast('m02-glisser');
  const b = createStore({ storage: st });
  assert.deepEqual(b.data, a.data);
  assert.deepEqual(b.data.levels['m02-glisser'], { done: true, best: 3, stars: 2 });
  assert.deepEqual(b.settings, { muted: true, motion: 'yes', symbols: false, camera: true, autohide: true, renderer: 'auto', quality: 'auto', ambient: false });
  assert.equal(b.data.last, 'm02-glisser');
  assert.deepEqual(sanitizeV2(JSON.parse(JSON.stringify(a.data))), a.data, 'sanitize est idempotente');
});

test('la copie est la dernière sauvegarde valide (une écriture en retard)', () => {
  const st = fakeStorage();
  const s = createStore({ storage: st });
  s.recordLevel('m01-tourner', 2, 2);
  const first = st.m.get(SAVE_KEY);
  s.recordLevel('m02-glisser', 1, 1);
  assert.equal(st.m.get(BACKUP_KEY), first);
});

test('record : meilleur score et étoiles ne régressent pas ; stars recalculées sur le meilleur', () => {
  const s = createStore({ storage: fakeStorage() });
  assert.deepEqual(s.recordLevel('m03-deux', 4, 3), { best: 4, stars: 2, isBest: true, first: true, saved: true });
  const worse = s.recordLevel('m03-deux', 9, 3);
  assert.deepEqual([worse.best, worse.stars, worse.isBest, worse.first], [4, 2, false, false]);
  const better = s.recordLevel('m03-deux', 3, 3);
  assert.deepEqual([better.best, better.stars, better.isBest], [3, 3, true]);
});

test('starsFor (S8) : u <= par 3, u <= par + 1 + floor(par/5) 2, sinon 1', () => {
  assert.deepEqual([1, 2, 3].map((u) => starsFor(u, 1)), [3, 2, 1]);
  assert.deepEqual([5, 6, 7, 8].map((u) => starsFor(u, 5)), [3, 2, 2, 1]);
  assert.deepEqual([6, 7, 8, 9].map((u) => starsFor(u, 6)), [3, 2, 2, 1]);
  assert.equal(starsFor(3, 0), 1);
});

test('version plus récente : lecture seule (rien n\'est réécrit)', () => {
  const newer = JSON.stringify({ v: 4, levels: { 'm01-tourner': { done: true, best: 1, stars: 3 } }, truc: 1 });
  const st = fakeStorage({ init: { [SAVE_KEY]: newer } });
  const store = createStore({ storage: st });
  assert.equal(store.status.mode, 'readonly');
  assert.equal(store.level('m01-tourner').best, 1, 'lue');
  const r = store.recordLevel('m02-glisser', 1, 1);
  assert.equal(r.saved, false);
  assert.equal(st.m.get(SAVE_KEY), newer, 'intacte');
});

test('liste blanche : clés inconnues, __proto__, ids et valeurs invalides, plafonds de brouillons et de dates', () => {
  const hostile = '{"v":2,"__proto__":{"polluted":1},"levels":{"__proto__":{"done":true,"best":1,"stars":3},"constructor":{"done":true,"best":2,"stars":2},"BAD ID":{"done":true,"best":1,"stars":3},"m01-tourner":{"done":true,"best":0,"stars":3},"m02-glisser":{"done":true,"best":3,"stars":9,"x":1},"m03-deux":{"done":false,"best":3,"stars":3}},"settings":{"muted":"oui","motion":"bidon","symbols":0,"extra":1},"last":"../x","evil":1}';
  const d = sanitizeV2(JSON.parse(hostile));
  assert.equal({}.polluted, undefined);
  assert.deepEqual(Object.keys(d.levels).sort(), ['constructor', 'm02-glisser']);
  assert.deepEqual(d.levels['m02-glisser'], { done: true, best: 3, stars: 1 }, 'étoiles hors bornes -> 1, clé en trop retirée');
  assert.deepEqual(d.settings, { muted: false, motion: 'auto', symbols: true, camera: true, autohide: true, renderer: 'auto', quality: 'auto', ambient: false });
  assert.equal(d.last, null);
  assert.equal(d.evil, undefined);
  const drafts = Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, name: 'x', code: '1.AAAA', t: i }));
  const daily = {};
  for (let m = 1; m <= 12; m++) for (let i = 1; i <= 28; i++) daily[`2026-${String(m).padStart(2, '0')}-${String(i).padStart(2, '0')}`] = { done: true, best: 1, stars: 3 };
  const big = sanitizeV2({ v: 2, drafts, daily });
  assert.equal(big.drafts.length, MAX_DRAFTS);
  assert.equal(Object.keys(big.daily).length, MAX_DAILY);
  assert.ok(Object.keys(big.daily).includes('2026-12-28'), 'les 60 dates les plus récentes');
  assert.deepEqual(sanitizeV2({ v: 2, drafts: [{ id: 'x', name: 'a'.repeat(30), code: '1.AAAA', t: 0 }, { id: 'y', name: 'ok', code: 'pas un code', t: 0 }] }).drafts, []);
});

test('défaut : sauvegarde neuve = symboles ON, son actif, mouvement auto', () => {
  assert.deepEqual(defaultSave().settings, { muted: false, motion: 'auto', symbols: true, camera: true, autohide: true, renderer: 'auto', quality: 'auto', ambient: false });
});

test('deux onglets : reload() relit le stockage (le dernier écrit gagne)', () => {
  const st = fakeStorage();
  const a = createStore({ storage: st });
  const b = createStore({ storage: st });
  a.recordLevel('m01-tourner', 1, 1);
  assert.equal(b.level('m01-tourner'), null);
  let seen = 0;
  b.subscribe(() => { seen++; });
  b.reload();
  assert.equal(b.level('m01-tourner').best, 1);
  assert.equal(seen, 1);
});

test('resetProgress : niveaux, défis et dernier niveau effacés ; réglages et brouillons gardés', () => {
  const st = fakeStorage({ init: { [SAVE_KEY]: goodSave({ drafts: [{ id: 'd1', name: 'a', code: '1.AAAA', t: 1 }] }) } });
  const s = createStore({ storage: st });
  s.resetProgress();
  const d = JSON.parse(st.m.get(SAVE_KEY));
  assert.deepEqual([d.levels, d.last, d.settings.muted, d.drafts.length], [{}, null, true, 1]);
});

test('reload : en mode mémoire la progression de la session est gardée ; sans changement du stockage, aucune notification', () => {
  const mem = createStore({ storage: null });
  mem.recordLevel('m01-tourner', 1, 1);
  mem.reload();
  assert.equal(mem.level('m01-tourner').best, 1);
  const st = fakeStorage();
  const s = createStore({ storage: st });
  s.recordLevel('m01-tourner', 1, 1);
  let seen = 0;
  s.subscribe(() => { seen++; });
  s.reload();
  assert.equal(seen, 0, 'données identiques : pas de notification');
});
