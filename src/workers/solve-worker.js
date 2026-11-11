// Worker module (ARCHITECTURE_V2 F6, F7, S7) : le solveur et la préparation du défi du jour hors du fil principal.
// Messages reçus :  {type:'solve', id, level, maxNodes}  ou  {type:'daily', id, date}  ;  ne lit que ses messages (données, jamais du code).
// Messages émis  :  {type:'result', id, result}  (solve : statut, minimum, nœuds, témoin, garage)
//                   {type:'progress', id, attempt}  puis {type:'daily-result', id, daily}  (défi : niveau accepté ou repli)
//                   {type:'error', id, message}
// Annulation : l'appelant fait `terminate()` (aucun message d'annulation : le calcul est synchrone dans ce Worker).
import { solve } from '../engine/solver.js';
import { generateDaily } from '../engine/daily.js';

/** Résultat de solve() réduit à ce que l'interface lit (structuré-clonable, sans tableaux typés). */
export function slimResult(r) {
  return { status: r.status, minimum: r.minimum, K: r.K, nodes: r.nodes, nodesTotal: r.nodesTotal, witness: r.witness, parking: r.parking, solutions: r.solutions };
}

/** Traite un message (exporté pour les tests : le même code tourne dans le Worker et sous Node). `post` reçoit les réponses. */
export function handleMessage(m, post) {
  const id = m !== null && typeof m === 'object' ? m.id : undefined;
  try {
    if (m === null || typeof m !== 'object') throw new TypeError('message invalide');
    if (m.type === 'solve') {
      post({ type: 'result', id, result: slimResult(solve(m.level, { maxNodes: m.maxNodes })) });
    } else if (m.type === 'daily') {
      const d = generateDaily(m.date, { onAttempt: (attempt) => post({ type: 'progress', id, attempt }) });
      post({ type: 'daily-result', id, daily: { date: d.date, version: d.version, weekday: d.weekday, fallback: d.fallback, reason: d.reason, attempt: d.attempt, minimum: d.minimum, nodes: d.nodes, cumulNodes: d.cumulNodes, code: d.code } });
    } else throw new TypeError('type de message inconnu');
  } catch (e) {
    post({ type: 'error', id, message: e && e.message ? String(e.message) : 'erreur' });
  }
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof self.addEventListener === 'function' && typeof document === 'undefined') {
  self.addEventListener('message', (ev) => handleMessage(ev.data, (msg) => self.postMessage(msg)));
}
