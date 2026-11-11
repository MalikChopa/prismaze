// Client du Worker de calcul (ARCHITECTURE_V2 F6 « Prouver », S7 indice des niveaux partagés, F7 préparation du défi).
// Chaque appel renvoie {promise, cancel}. Annuler = `terminate()` du Worker (le calcul est coupé net).
// Repli synchrone quand le Worker module n'existe pas ou échoue : « Prouver » est alors plafonné à 150 000 nœuds (au lieu de 1 M) pour ne
// pas figer la page ; la préparation du défi, elle, doit aller au bout (Q5 : décision identique partout) et tourne sur le fil principal.
import { solve } from '../engine/solver.js';
import { generateDaily } from '../engine/daily.js';

export const PROVE_MAX_NODES = 1000000; // F6
export const SYNC_MAX_NODES = 150000; // F6 : repli synchrone

/**
 * @param {{WorkerCtor?:Function|null, workerUrl?:string|URL, syncSolve?:Function, syncDaily?:Function}} [deps]
 *   WorkerCtor : constructeur de Worker (défaut : `Worker` global s'il existe, sinon repli synchrone) ; tests : un faux Worker.
 */
export function createSolveClient(deps = {}) {
  const WorkerCtor = deps.WorkerCtor === undefined ? (typeof Worker === 'function' ? Worker : null) : deps.WorkerCtor;
  const workerUrl = deps.workerUrl ?? new URL('./solve-worker.js', import.meta.url);
  const syncSolve = deps.syncSolve ?? solve;
  const syncDaily = deps.syncDaily ?? generateDaily;
  let seq = 0;

  function startWorker() {
    if (WorkerCtor === null) return null;
    try { return new WorkerCtor(workerUrl, { type: 'module' }); } catch { return null; }
  }

  /** Lance une tâche dans un Worker neuf ; `onMessage(msg, settle)` traite chaque message ; renvoie null si pas de Worker. */
  function runInWorker(message, onMessage) {
    const w = startWorker();
    if (w === null) return null;
    const id = ++seq;
    let settled = false;
    let resolveFn;
    let rejectFn;
    const promise = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });
    const finish = (fn, value) => { if (settled) return; settled = true; try { w.terminate(); } catch { /* déjà arrêté */ } fn(value); };
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m === null || typeof m !== 'object' || m.id !== id) return;
      if (m.type === 'error') finish(rejectFn, new Error(String(m.message)));
      else onMessage(m, (v) => finish(resolveFn, v));
    };
    w.onerror = (ev) => finish(rejectFn, Object.assign(new Error(ev && ev.message ? String(ev.message) : 'Worker en erreur'), { workerFailure: true }));
    w.postMessage({ ...message, id });
    return { promise, cancel() { if (!settled) { settled = true; try { w.terminate(); } catch { /* ok */ } resolveFn({ cancelled: true }); } } };
  }

  return {
    get hasWorker() { return WorkerCtor !== null; },

    /**
     * Prouve un niveau (F6) : plafond `maxNodes` (défaut 1 M dans un Worker, 150 000 en repli synchrone).
     * Résout {status, minimum, nodes, witness, parking, ..., sync:boolean} ou {cancelled:true}.
     */
    solve(level, { maxNodes = PROVE_MAX_NODES } = {}) {
      const task = runInWorker({ type: 'solve', level, maxNodes }, (m, done) => { if (m.type === 'result') done({ ...m.result, sync: false, maxNodes }); });
      if (task !== null) {
        // un Worker qui échoue au démarrage (module non pris en charge, fichier introuvable) : on retombe sur le calcul synchrone
        const wrapped = task.promise.catch((e) => {
          if (e && e.workerFailure) { const cap = Math.min(maxNodes, SYNC_MAX_NODES); return { ...syncSolve(level, { maxNodes: cap }), sync: true, maxNodes: cap }; }
          throw e;
        });
        return { promise: wrapped, cancel: task.cancel };
      }
      const cap = Math.min(maxNodes, SYNC_MAX_NODES);
      let cancelled = false;
      const promise = Promise.resolve().then(() => (cancelled ? { cancelled: true } : { ...syncSolve(level, { maxNodes: cap }), sync: true, maxNodes: cap }));
      return { promise, cancel() { cancelled = true; } };
    },

    /** Prépare le défi d'une date (F7). `onProgress(attempt)` à chaque tentative. Résout le résultat de generateDaily (sans niveau) ou {cancelled:true}. */
    daily(date, { onProgress = null } = {}) {
      const task = runInWorker({ type: 'daily', date }, (m, done) => {
        if (m.type === 'progress' && onProgress) onProgress(m.attempt);
        else if (m.type === 'daily-result') done({ ...m.daily, sync: false });
      });
      if (task !== null) {
        const wrapped = task.promise.catch((e) => {
          if (e && e.workerFailure) { const d = syncDaily(date, { onAttempt: onProgress ?? undefined }); return { ...d, level: undefined, sync: true }; }
          throw e;
        });
        return { promise: wrapped, cancel: task.cancel };
      }
      let cancelled = false;
      const promise = Promise.resolve().then(() => {
        if (cancelled) return { cancelled: true };
        const d = syncDaily(date, { onAttempt: onProgress ?? undefined });
        return { ...d, level: undefined, sync: true };
      });
      return { promise, cancel() { cancelled = true; } };
    },
  };
}
