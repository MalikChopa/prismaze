// Interface de partage (F4, F5, F6) et du défi du jour (F7) sans navigateur : import hostile, copie, cache, repli forcé lu dans le pool, annulation, témoin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseImportText, shareUrl, copyText, shareFailureText } from '../../src/ui/share-ui.js';
import { createDailyPreparer, utcDate, dailyLabel } from '../../src/ui/daily.js';
import { createSolveClient } from '../../src/workers/solve-client.js';
import { generateDaily, dailyPoolId } from '../../src/engine/daily.js';
import { encodeLevel, parseShareCode } from '../../src/engine/share.js';
import { validateLevel, replayPlacements } from '../../src/engine/level.js';
import { createState, movePiece } from '../../src/engine/state.js';
import { buildBoard } from '../../src/engine/board.js';
import { trace } from '../../src/engine/trace.js';
import { createStore } from '../../src/storage/save.js';
import { witnessPlacements } from '../../src/ui/editor-model.js';

const level = { format: 2, id: 'partage', name: 'essai', size: [6, 4], pieces: [
  { type: 'emitter', at: [0, 1], dir: 'E', mask: 'RGB' }, { type: 'target', at: [5, 3], need: 'RGB' },
  { type: 'mirror', at: [2, 0], o: '-' }, { type: 'mirror', at: [1, 3], o: '-' }, { type: 'wall', at: [4, 0] }] };
const code = encodeLevel(level);

test('shareUrl : page courante sans paramètres + #l=<code> ; le niveau décodé redonne le niveau', () => {
  const url = shareUrl({ origin: 'https://exemple.test', pathname: '/prismaze/', search: '?debug' }, level);
  assert.equal(url, `https://exemple.test/prismaze/#l=${code}`);
  assert.deepEqual(parseShareCode(url.split('#l=')[1]).level, { ...level, pieces: level.pieces.slice().sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0]) });
});

test('import : adresse complète, fragment, « l=… », code nu : même niveau ; espaces autour tolérés', () => {
  for (const text of [`https://x.test/p/#l=${code}`, `#l=${code}`, `l=${code}`, code, `  ${code}\n`]) {
    const r = parseImportText(text);
    assert.equal(r.ok, true, text.slice(0, 30));
    assert.equal(r.via, 'code');
    assert.equal(encodeLevel(r.level), code);
  }
});

test('import hostile : tout est refusé avec un message, jamais d\'exception, jamais de pollution', () => {
  const bad = ['', '   ', 'abc', '1.', `1.${'A'.repeat(400)}`, '#l=', '#l=2.abc', '<img src=x onerror=alert(1)>', '__proto__', '{"a":', '[1]', 'null', '{"__proto__":{"polluted":1},"format":2,"size":[3,3],"pieces":[]}',
    '{"format":1,"size":[3,3],"pieces":[]}', `{"format":2,"name":"<b>","size":[3,3],"pieces":[]}`, 'x'.repeat(30000), `{${'"a":1,'.repeat(5000)}"b":2}`];
  for (const text of bad) {
    const r = parseImportText(text);
    assert.equal(r.ok, false, text.slice(0, 30));
    assert.equal(typeof r.message, 'string');
    assert.ok(r.message.length > 0);
  }
  assert.equal(({}).polluted, undefined);
  assert.equal(parseImportText(`1.${code.slice(2, 10)}`).message, 'Lien invalide.');
  assert.equal(parseImportText('#l=2.abcdef').message.includes('plus récente'), true);
});

test('import : brouillon JSON de niveau valide (par et solutions retirés, id forcé à « partage »)', () => {
  const draft = { format: 2, id: 'autre-id', name: 'brouillon', size: [6, 4], pieces: level.pieces, par: 1, solutions: [[{ type: 'mirror', at: [1, 1], o: '/' }]] };
  const r = parseImportText(JSON.stringify(draft));
  assert.equal(r.ok, true);
  assert.equal(r.via, 'json');
  assert.equal(r.level.id, 'partage');
  assert.equal('par' in r.level, false);
  assert.equal(validateLevel(r.level, { mode: 'shared' }).ok, true);
  assert.equal(parseImportText(JSON.stringify({ ...draft, extra: 1 })).ok, false, 'clé inconnue refusée (V4)');
});

test('shareFailureText : messages français, sans détail technique pour un lien invalide', () => {
  assert.equal(shareFailureText({ reason: 'invalid' }), 'Lien invalide.');
  assert.match(shareFailureText({ reason: 'newer' }), /version plus récente/);
  assert.match(shareFailureText({ reason: 'rules', errors: [{ message: 'il faut au moins 1 cible' }] }), /enfreint les règles : il faut au moins 1 cible/);
});

test('copyText : succès ; API absente, refus ou exception -> false (l\'appelant montre le champ sélectionnable)', async () => {
  const got = [];
  assert.equal(await copyText('abc', { clipboard: { writeText: async (t) => { got.push(t); } } }), true);
  assert.deepEqual(got, ['abc']);
  assert.equal(await copyText('abc', {}), false);
  assert.equal(await copyText('abc', undefined), false);
  assert.equal(await copyText('abc', { clipboard: { writeText: async () => { throw new Error('NotAllowedError'); } } }), false);
  assert.equal(await copyText('abc', { clipboard: { writeText: () => { throw new Error('sync'); } } }), false);
});

// ---- défi du jour : côté interface ----

const memoryStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
/** Chargeur du pool de repli : lit le vrai fichier de levels/daily-pool/ et le valide comme le fait load.js. */
const poolLoader = (id) => {
  const raw = JSON.parse(readFileSync(new URL(`../../levels/daily-pool/${id}.json`, import.meta.url), 'utf8'));
  const v = validateLevel(raw, { mode: 'shipped', expectedId: id });
  assert.equal(v.ok, true);
  return Promise.resolve({ level: v.level, state: createState(v.level) });
};

test('utcDate : jour UTC de l\'horloge ; libellé de l\'écran de jeu', () => {
  assert.equal(utcDate(Date.UTC(2026, 10, 8, 23, 59, 59)), '2026-11-08');
  assert.equal(utcDate(Date.UTC(2026, 10, 9, 0, 0, 0)), '2026-11-09');
  assert.equal(dailyLabel('2026-11-08', 1, false), 'DÉFI · 2026-11-08 · v1');
  assert.equal(dailyLabel('2026-11-08', 1, true), 'DÉFI · 2026-11-08 · v1 · SECOURS');
});

test('préparation du défi : calcul, mise en cache (code, version, minimum), puis relecture du cache sans nouveau calcul', async () => {
  const store = createStore({ storage: memoryStorage() });
  let calls = 0;
  const client = createSolveClient({ WorkerCtor: null, syncDaily: (d, o) => { calls++; return generateDaily(d, o); } });
  const prepare = createDailyPreparer({ store, client, loadPool: poolLoader });
  const seen = [];
  const a = await prepare('2026-11-11', { onProgress: (x) => seen.push(x.e) }).promise;
  assert.deepEqual([a.fallback, a.fromCache, a.v, a.par, calls], [false, false, 1, 3, 1]);
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(a.level.id, 'partage');
  assert.equal(a.state.pieces.length, a.level.pieces.length);
  assert.equal(store.dailyCache.date, '2026-11-11');
  assert.equal(store.dailyCache.m, 3);
  const b = await prepare('2026-11-11').promise;
  assert.deepEqual([b.fromCache, b.code === a.code, b.par, calls], [true, true, 3, 1], 'cache : pas de nouveau calcul');
  const c = await prepare('2026-11-12').promise;
  assert.equal(c.fromCache, false, 'un autre jour recalcule');
  assert.equal(calls, 2);
});

test('repli FORCÉ (plafond cumulé à 1 nœud) : le niveau vient de levels/daily-pool/ (jour de semaine UTC), prouvé, avec son minimum', async () => {
  const store = createStore({ storage: memoryStorage() });
  const client = createSolveClient({ WorkerCtor: null, syncDaily: (d, o) => generateDaily(d, { ...o, cumulCap: 1 }) });
  const asked = [];
  const prepare = createDailyPreparer({ store, client, loadPool: (id) => { asked.push(id); return poolLoader(id); } });
  for (const [date, id] of [['2026-11-08', 'daily-0'], ['2026-11-09', 'daily-1'], ['2026-11-14', 'daily-6']]) {
    const r = await prepare(date).promise;
    assert.equal(r.fallback, true, date);
    assert.equal(r.reason, 'cumul');
    assert.equal(r.level.id, id);
    assert.ok(Number.isInteger(r.par) && r.par >= 2, `${date} : minimum du pool ${r.par}`);
    assert.equal(r.state.pieces.length, r.level.pieces.length);
    assert.equal(dailyPoolId(date), id);
  }
  assert.deepEqual(asked, ['daily-0', 'daily-1', 'daily-6']);
  assert.equal(store.dailyCache, null, 'un niveau de secours n\'est pas mis en cache (le prochain passage retentera)');
});

test('préparation : date invalide rejetée ; annulation avant la fin : {cancelled:true}, rien en cache', async () => {
  const store = createStore({ storage: memoryStorage() });
  const prepare = createDailyPreparer({ store, client: createSolveClient({ WorkerCtor: null }), loadPool: poolLoader });
  await assert.rejects(prepare('demain').promise, /date invalide/);
  const task = prepare('2026-11-13');
  task.cancel();
  assert.deepEqual(await task.promise, { cancelled: true });
  assert.equal(store.dailyCache, null);
});

test('cache corrompu ou d\'une autre version : ignoré, le niveau est recalculé', async () => {
  const store = createStore({ storage: memoryStorage() });
  store.setDailyCache('2026-11-09', 1, '1.AAAA'); // code qui ne se décode pas
  let calls = 0;
  const client = createSolveClient({ WorkerCtor: null, syncDaily: (d, o) => { calls++; return generateDaily(d, o); } });
  const r = await createDailyPreparer({ store, client, loadPool: poolLoader })('2026-11-09').promise;
  assert.deepEqual([r.fromCache, r.fallback, calls], [false, false, 1]);
  assert.equal(parseShareCode(store.dailyCache.code).ok, true, 'le cache est remplacé par un code valide');
});

// ---- témoin de l'auteur ----

test('témoin : pièces mobiles UTILISÉES de la configuration gagnante, rejouées par le moteur seul', () => {
  // cas simple et certain : niveau à un miroir
  const one = { format: 2, id: 'partage', name: '', size: [5, 3], pieces: [{ type: 'emitter', at: [0, 0], dir: 'E', mask: 'RGB' }, { type: 'target', at: [4, 2], need: 'RGB' }, { type: 'mirror', at: [1, 2], o: '-' }, { type: 'mirror', at: [2, 2], o: '-' }] };
  let s1 = createState(one);
  const mid = s1.pieces.find((p) => p.type === 'mirror' && p.c === 1).id;
  s1 = movePiece(s1, mid, 4, 0);
  s1 = { ...s1, pieces: s1.pieces.map((p) => (p.id === mid ? { ...p, o: 3 } : p)) };
  const t1 = trace(buildBoard(s1));
  assert.equal(t1.allLit, true);
  const w1 = witnessPlacements(s1, t1.used);
  assert.deepEqual(w1, [{ type: 'mirror', at: [4, 0], o: '\\' }]);
  const rp1 = replayPlacements(one, w1);
  assert.deepEqual([rp1.ok, rp1.usedMovable], [true, 1]);
});
