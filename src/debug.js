// Crochet de test en lecture seule, chargé seulement avec `?debug` (ARCHITECTURE.md §8).
// `window.__prismaze.getState()` renvoie à chaque appel une copie neuve et profondément gelée ; aucune fonction qui modifie le jeu.

/** Gèle récursivement un objet simple (objets et tableaux). */
export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/**
 * @param {{snapshot:()=>object}} game  l'écran de jeu (src/ui/game.js)
 * @param {object} [target]  objet global (par défaut window) ; les tests passent un faux objet
 * @returns {object} l'objet installé
 */
export function installDebug(game, target = globalThis) {
  const api = Object.freeze({
    getState() {
      return deepFreeze(game.snapshot());
    },
  });
  Object.defineProperty(target, '__prismaze', { value: api, writable: false, configurable: false, enumerable: false });
  return api;
}
