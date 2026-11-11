// V13b (revue V11-V12 n° 3) : sauvegarde en lecture seule (écrite par une version plus récente) : un retour sur l'onglet (reload) ne relit pas,
// sinon les succès, drapeaux et victoires de la session (en mémoire seulement) seraient perdus puis annoncés de nouveau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, SAVE_KEY } from '../../src/storage/save.js';
import { newlyEarned } from '../../src/ui/achievements.js';

const storage = (init = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const NEWER = JSON.stringify({ v: 4, levels: { 'm01-tourner': { done: true, best: 1, stars: 3 } }, futur: 1 });

test('lecture seule : reload() garde les succès, drapeaux et victoires de la session ; le stockage reste intact ; aucune notification', () => {
  const st = storage({ [SAVE_KEY]: NEWER });
  const store = createStore({ storage: st });
  assert.equal(store.status.mode, 'readonly');
  assert.deepEqual(store.grantAchievements(['first-light'], '2026-11-11'), ['first-light']);
  assert.equal(store.setFlag('nohint'), true);
  store.recordLevel('m02-glisser', 1, 1);
  let seen = 0;
  store.subscribe(() => { seen++; });
  store.reload(); // retour sur l'onglet
  store.reload(); // événement « storage »
  assert.deepEqual(Object.keys(store.achievements), ['first-light'], 'succès de la session gardé');
  assert.equal(store.flags.nohint, true, 'drapeau gardé');
  assert.equal(store.level('m02-glisser').best, 1, 'victoire de la session gardée');
  assert.equal(seen, 0);
  assert.equal(st.m.get(SAVE_KEY), NEWER, 'rien n\'est écrit');
});

test('lecture seule : un succès déjà accordé n\'est pas de nouveau « nouveau » après un retour sur l\'onglet (pas de double annonce)', () => {
  const store = createStore({ storage: storage({ [SAVE_KEY]: NEWER }) });
  const list = [{ id: 'first-light', earned: true }, { id: 'mirrors', earned: false }];
  assert.deepEqual(newlyEarned(list, store.achievements), ['first-light']);
  store.grantAchievements(['first-light'], '2026-11-11');
  store.reload();
  assert.deepEqual(newlyEarned(list, store.achievements), [], 'rien à annoncer');
  assert.deepEqual(store.grantAchievements(['first-light'], '2026-11-11'), [], 'déjà accordé');
});

test('mode normal : reload() relit toujours le stockage (deux onglets, le dernier écrit gagne)', () => {
  const st = storage();
  const a = createStore({ storage: st });
  const b = createStore({ storage: st });
  a.grantAchievements(['first-light'], '2026-11-11');
  b.reload();
  assert.deepEqual(Object.keys(b.achievements), ['first-light']);
});
