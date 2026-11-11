// Défi du jour, côté interface (ARCHITECTURE_V2 F7) : date UTC de l'appareil (Q1), niveau en cache (Q8), préparation dans un Worker avec
// progression et annulation (Q5/Q7), repli sur le pool hors ligne (levels/daily-pool/), résultat du jour dans la sauvegarde.
import { CURRENT_DAILY_VERSION, dailyVersion, dailyPoolId, isValidDay } from '../engine/daily.js';
import { parseShareCode } from '../engine/share.js';
import { createState } from '../engine/state.js';

/** Q1 : jour UTC AAAA-MM-JJ de l'horloge de l'appareil. */
export function utcDate(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/** Libellé court de l'écran de jeu : « DÉFI · 2026-11-08 · v1 ». */
export const dailyLabel = (date, v, fallback) => `DÉFI · ${date} · v${v}${fallback ? ' · SECOURS' : ''}`;

/**
 * Prépare le niveau du jour.
 * @param {{store:object, client:object, loadPool:(id:string)=>Promise<{level:object,state:object}>}} deps
 * @returns {(date:string, opts?:{onProgress?:(attempt:object)=>void})=>{promise:Promise<object>, cancel:()=>void}}
 *   Résout {date, v, level, state, par, fallback, fromCache, code, sync} ou {cancelled:true}, ou rejette (pool illisible).
 *   par : minimum prouvé (étoiles) ; null si inconnu. Le niveau du jour porte l'id `partage` et le nom « défi du jour ».
 */
export function createDailyPreparer({ store, client, loadPool }) {
  return (date, { onProgress = null } = {}) => {
    if (!isValidDay(date)) return { promise: Promise.reject(new RangeError('date invalide')), cancel() {} };
    const v = dailyVersion(date);
    const fromCode = (code, par, extra) => {
      const parsed = parseShareCode(code);
      if (!parsed.ok) return null;
      const level = { ...parsed.level, name: 'défi du jour' };
      return { date, v, level, state: createState(level), par, fallback: false, code, ...extra };
    };
    // 1. cache de l'appareil (une génération par jour, Q8) : date et version identiques, code rouvert par le décodeur complet
    const cache = store.dailyCache;
    if (cache !== null && cache.date === date && cache.v === v) {
      const hit = fromCode(cache.code, cache.m ?? null, { fromCache: true, sync: false });
      if (hit !== null) return { promise: Promise.resolve(hit), cancel() {} };
    }
    let task = null;
    let cancelled = false;
    const promise = (async () => {
      task = client.daily(date, { onProgress });
      const d = await task.promise;
      if (d.cancelled || cancelled) return { cancelled: true };
      if (!d.fallback) {
        const made = fromCode(d.code, d.minimum, { fromCache: false, sync: d.sync === true });
        if (made !== null) { store.setDailyCache(date, v, d.code, d.minimum); return made; }
      }
      // 2. repli : un des 7 niveaux prouvés hors ligne (Q5), jamais d'écran vide
      const pooled = await loadPool(dailyPoolId(date));
      if (cancelled) return { cancelled: true };
      return { date, v, level: pooled.level, state: pooled.state, par: pooled.level.par ?? null, fallback: true, fromCache: false, code: null, sync: d.sync === true, reason: d.reason ?? null };
    })();
    return { promise, cancel() { cancelled = true; if (task) task.cancel(); } };
  };
}

export { CURRENT_DAILY_VERSION };
