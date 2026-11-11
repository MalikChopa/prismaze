// Worker de calcul (F6 « Prouver », F7 préparation du défi) : même code sous Node via de faux Workers ; annulation, repli synchrone à 150 000 nœuds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleMessage } from '../../src/workers/solve-worker.js';
import { createSolveClient, PROVE_MAX_NODES, SYNC_MAX_NODES } from '../../src/workers/solve-client.js';

const exemple = () => JSON.parse(readFileSync(new URL('../fixtures/v2/valid/x00-exemple.json', import.meta.url), 'utf8'));

/** Faux Worker : répond de façon asynchrone avec le vrai gestionnaire. */
class EchoWorker {
  constructor(url, opts) { this.url = url; this.opts = opts; this.terminated = false; EchoWorker.made.push(this); }
  postMessage(m) { queueMicrotask(() => { if (!this.terminated) handleMessage(m, (msg) => { if (!this.terminated) this.onmessage({ data: msg }); }); }); }
  terminate() { this.terminated = true; }
}
EchoWorker.made = [];
/** Faux Worker qui ne répond jamais (calcul long). */
class HangWorker { constructor() { this.terminated = false; HangWorker.made.push(this); } postMessage() {} terminate() { this.terminated = true; } }
HangWorker.made = [];
/** Faux Worker qui échoue au démarrage (module non pris en charge). */
class BrokenWorker { constructor() { this.terminated = false; } postMessage() { queueMicrotask(() => this.onerror({ message: 'module non pris en charge' })); } terminate() { this.terminated = true; } }
class ThrowingCtor { constructor() { throw new Error('Worker module indisponible'); } }

test('constantes de F6 : plafond 1 M nœuds, repli synchrone 150 000', () => {
  assert.equal(PROVE_MAX_NODES, 1000000);
  assert.equal(SYNC_MAX_NODES, 150000);
});

test('Prouver dans un Worker module : résultat du solveur, Worker terminé ensuite, type module demandé', async () => {
  const client = createSolveClient({ WorkerCtor: EchoWorker });
  assert.equal(client.hasWorker, true);
  const r = await client.solve(exemple()).promise;
  assert.equal(r.status, 'proved-optimal');
  assert.equal(r.minimum, 1);
  assert.equal(r.nodes, 32);
  assert.equal(r.sync, false);
  assert.equal(r.maxNodes, 1000000);
  const w = EchoWorker.made.at(-1);
  assert.equal(w.opts.type, 'module');
  assert.equal(w.terminated, true);
});

test('Prouver : un niveau hors du plafond rend « unknown » (le plafond est transmis au Worker)', async () => {
  const client = createSolveClient({ WorkerCtor: EchoWorker });
  const r = await client.solve(exemple(), { maxNodes: 3 }).promise;
  assert.equal(r.status, 'unknown');
  assert.equal(r.maxNodes, 3);
});

test('Annuler : terminate() du Worker, la promesse se résout par {cancelled:true}, aucune réponse tardive n\'est prise en compte', async () => {
  const client = createSolveClient({ WorkerCtor: HangWorker });
  const task = client.solve(exemple());
  const w = HangWorker.made.at(-1);
  assert.equal(w.terminated, false);
  task.cancel();
  assert.equal(w.terminated, true);
  assert.deepEqual(await task.promise, { cancelled: true });
  w.onmessage({ data: { type: 'result', id: 1, result: { status: 'proved-optimal' } } }); // réponse tardive : ignorée, ne lève pas
});

test('sans Worker : repli synchrone plafonné à 150 000 nœuds, marqué sync', async () => {
  const seen = [];
  const client = createSolveClient({ WorkerCtor: null, syncSolve: (lv, o) => { seen.push(o.maxNodes); return { status: 'unknown', minimum: -1, nodes: o.maxNodes + 1, witness: null }; } });
  assert.equal(client.hasWorker, false);
  const r = await client.solve(exemple()).promise;
  assert.deepEqual(seen, [150000]);
  assert.equal(r.sync, true);
  assert.equal(r.maxNodes, 150000);
  const r2 = await client.solve(exemple(), { maxNodes: 1000 }).promise;
  assert.equal(r2.maxNodes, 1000, 'un plafond plus bas est gardé');
  // annulation avant exécution du repli
  const t = client.solve(exemple());
  t.cancel();
  assert.deepEqual(await t.promise, { cancelled: true });
});

test('constructeur de Worker qui lève, ou Worker qui échoue au démarrage : repli synchrone (pas d\'exception)', async () => {
  for (const WorkerCtor of [ThrowingCtor, BrokenWorker]) {
    const client = createSolveClient({ WorkerCtor });
    const r = await client.solve(exemple()).promise;
    assert.equal(r.status, 'proved-optimal');
    assert.equal(r.sync, true, WorkerCtor.name);
  }
});

test('Worker : message invalide ou inconnu -> {type:error}, jamais d\'exception ; la promesse est rejetée avec le message', async () => {
  const out = [];
  handleMessage(null, (m) => out.push(m));
  handleMessage({ type: 'exec', id: 7, code: 'alert(1)' }, (m) => out.push(m));
  handleMessage({ type: 'solve', id: 8, level: { size: 'x' }, maxNodes: NaN }, (m) => out.push(m));
  assert.deepEqual(out.map((m) => m.type), ['error', 'error', 'error']);
  assert.equal(out[1].id, 7);
  const client = createSolveClient({ WorkerCtor: EchoWorker });
  await assert.rejects(client.solve(exemple(), { maxNodes: NaN }).promise, /option maxNodes invalide/);
});

test('Défi du jour dans un Worker : progression par tentative, résultat sans niveau (le code F4 suffit)', async () => {
  const client = createSolveClient({ WorkerCtor: EchoWorker });
  const seen = [];
  const r = await client.daily('2026-11-11', { onProgress: (a) => seen.push(a.e) }).promise;
  assert.equal(r.fallback, false);
  assert.equal(r.attempt, 7);
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.match(r.code, /^1\.[A-Za-z0-9_-]+$/);
  assert.equal(r.sync, false);
  assert.equal(r.level, undefined);
});

test('Défi du jour sans Worker : calcul synchrone au bout (Q5), progression rappelée, annulation avant calcul', async () => {
  const client = createSolveClient({ WorkerCtor: null });
  const seen = [];
  const r = await client.daily('2026-11-09', { onProgress: (a) => seen.push(a.e) }).promise;
  assert.equal(r.sync, true);
  assert.equal(r.fallback, false);
  assert.deepEqual(seen, [0]);
  const t = client.daily('2026-11-09');
  t.cancel();
  assert.deepEqual(await t.promise, { cancelled: true });
});

test('Défi du jour : le Worker et le calcul synchrone donnent le même niveau (code identique)', async () => {
  const a = await createSolveClient({ WorkerCtor: EchoWorker }).daily('2026-11-12').promise;
  const b = await createSolveClient({ WorkerCtor: null }).daily('2026-11-12').promise;
  assert.equal(a.code, b.code);
  assert.equal(a.nodes, b.nodes);
});
