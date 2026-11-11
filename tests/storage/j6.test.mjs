// Sauvegarde v2 pour J6 : record du défi du jour (Q8), niveau du jour en cache, brouillons de l'éditeur (20 au plus, U9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, SAVE_KEY, MAX_DRAFTS, MAX_DAILY } from '../../src/storage/save.js';

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const CODE = '1.F6AkAEID9wICOORuSNCaIzRMiJ0IVIWImJWI3JHfFdkOqeNM';

test('défi du jour : une victoire par date, meilleur score gardé, étoiles recalculées sur le meilleur score', () => {
  const st = fakeStorage();
  const store = createStore({ storage: st });
  assert.equal(store.daily('2026-11-08'), null);
  const a = store.recordDaily('2026-11-08', 6, 4);
  assert.deepEqual([a.first, a.isBest, a.best, a.stars, a.saved], [true, true, 6, 1, true]); // 6 > 4 + 1 + 0 : 1 étoile
  const b = store.recordDaily('2026-11-08', 4, 4);
  assert.deepEqual([b.first, b.isBest, b.best, b.stars], [false, true, 4, 3]);
  const c = store.recordDaily('2026-11-08', 9, 4);
  assert.deepEqual([c.isBest, c.best, c.stars], [false, 4, 3], 'un moins bon essai ne retire rien');
  assert.deepEqual(store.daily('2026-11-08'), { done: true, best: 4, stars: 3 });
  assert.equal(JSON.parse(st.m.get(SAVE_KEY)).daily['2026-11-08'].best, 4, 'écrit dans la sauvegarde');
  // rechargement : relu par la liste blanche
  assert.deepEqual(createStore({ storage: st }).daily('2026-11-08'), { done: true, best: 4, stars: 3 });
});

test('défi du jour : dates et scores hostiles refusés, 60 dates au plus (les plus anciennes partent)', () => {
  const store = createStore({ storage: fakeStorage() });
  for (const bad of ['__proto__', 'x', '2026-1-1', '2026-11-08; drop', '']) {
    assert.equal(store.recordDaily(bad, 3, 3).saved, false, bad);
    assert.equal(store.daily(bad), null, bad);
  }
  assert.equal(store.recordDaily('2026-11-08', 0, 3).saved, false);
  assert.equal(store.recordDaily('2026-11-08', 3.5, 3).saved, false);
  assert.equal(Object.prototype.polluted, undefined);
  for (let i = 0; i < MAX_DAILY + 10; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    store.recordDaily(d, 2, 2);
  }
  assert.equal(Object.keys(store.data.daily).length, MAX_DAILY);
  assert.equal(store.daily('2026-01-01'), null, 'la plus ancienne est partie');
  assert.notEqual(store.daily(new Date(Date.UTC(2026, 0, 1 + MAX_DAILY + 9)).toISOString().slice(0, 10)), null);
});

test('niveau du jour en cache : date, version, code F4 ; entrées invalides refusées ; effacé par la réinitialisation', () => {
  const store = createStore({ storage: fakeStorage() });
  assert.equal(store.dailyCache, null);
  assert.equal(store.setDailyCache('2026-11-08', 1, CODE), true);
  assert.deepEqual(store.dailyCache, { date: '2026-11-08', v: 1, code: CODE });
  assert.equal(store.setDailyCache('2026-11-08', 0, CODE), false);
  assert.equal(store.setDailyCache('2026-11-08', 1, 'pas un code'), false);
  assert.equal(store.setDailyCache('demain', 1, CODE), false);
  assert.equal(store.setDailyCache('2026-11-08', 1, `1.${'A'.repeat(321)}`), false);
  assert.deepEqual(store.dailyCache, { date: '2026-11-08', v: 1, code: CODE }, 'inchangé');
  store.resetProgress();
  assert.equal(store.dailyCache, null);
});

test('brouillons : ajout, mise à jour, suppression, 20 au plus, ids uniques, relus après rechargement', () => {
  const st = fakeStorage();
  const store = createStore({ storage: st });
  assert.deepEqual(store.drafts, []);
  const a = store.addDraft('mon niveau', CODE, 5);
  assert.deepEqual(a, { ok: true, id: 'd1' });
  const b = store.addDraft('', CODE);
  assert.equal(b.id, 'd2');
  assert.equal(store.updateDraft('d1', 'renommé', CODE, 9).ok, true);
  assert.deepEqual(store.drafts[0], { id: 'd1', name: 'renommé', code: CODE, t: 9 });
  assert.equal(store.updateDraft('d9', 'x', CODE).reason, 'missing');
  assert.equal(store.deleteDraft('d1'), true);
  assert.equal(store.deleteDraft('d1'), false);
  assert.equal(store.addDraft('de nouveau', CODE).id, 'd1', 'un id libéré est réutilisé');
  assert.deepEqual(createStore({ storage: st }).drafts.map((d) => d.id), ['d2', 'd1']);
  // plafond
  while (store.drafts.length < MAX_DRAFTS) assert.equal(store.addDraft('x', CODE).ok, true);
  assert.equal(store.drafts.length, 20);
  assert.deepEqual(store.addDraft('trop', CODE), { ok: false, reason: 'full' });
  assert.equal(store.drafts.length, 20);
});

test('brouillons : nom trop long ou code hostile refusés (rien n\'est écrit) ; la réinitialisation garde les brouillons', () => {
  const st = fakeStorage();
  const store = createStore({ storage: st });
  assert.equal(store.addDraft('x'.repeat(25), CODE).reason, 'invalid');
  assert.equal(store.addDraft('ok', '<script>alert(1)</script>').reason, 'invalid');
  assert.equal(store.addDraft('ok', '2.abc').reason, 'invalid');
  assert.equal(store.addDraft(42, CODE).reason, 'invalid');
  assert.equal(store.drafts.length, 0);
  store.addDraft('garde', CODE);
  store.resetProgress();
  assert.equal(store.drafts.length, 1, 'brouillons gardés (travail du joueur)');
});

test('brouillons dans une sauvegarde corrompue : la liste blanche filtre (20 au plus, formes strictes)', () => {
  const drafts = [];
  for (let i = 0; i < 30; i++) drafts.push({ id: `d${i + 1}`, name: 'ok', code: CODE, t: 1 });
  drafts.splice(3, 0, { id: '../etc', name: 'x', code: CODE, t: 1 }, { id: 'd99', name: 'x'.repeat(30), code: CODE, t: 1 }, { id: 'd98', name: 'x', code: '<b>', t: 1 }, null, 'texte');
  const st = fakeStorage({ [SAVE_KEY]: JSON.stringify({ v: 2, levels: {}, daily: {}, dailyCache: null, settings: {}, drafts, last: null }) });
  const store = createStore({ storage: st });
  assert.equal(store.drafts.length, 20);
  assert.ok(store.drafts.every((d) => /^d\d+$/.test(d.id) && d.name === 'ok'));
});
