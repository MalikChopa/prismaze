// Chargement des niveaux : SEUL module du jeu qui touche au réseau (URL relatives, même origine).
import { validateIndex, validateLevel, ID_PATTERN } from './engine/level.js';
import { createState } from './engine/state.js';

// Les URL sont relatives à ce fichier (src/load.js) : ../levels/...
const LEVELS_DIR = new URL('../levels/', import.meta.url);

/** Erreur de chargement ou de validation ; `errors` contient les codes de level.js le cas échéant. */
export class LoadError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'LoadError';
    this.errors = errors;
  }
}

function assertSameOrigin(url) {
  const here = globalThis.location;
  if (here && here.origin && url.origin !== here.origin) {
    throw new LoadError(`origine refusée : ${url.origin}`);
  }
}

// L'unique appel réseau du jeu.
async function getJson(url) {
  assertSameOrigin(url);
  let res;
  try {
    res = await fetch(url, { credentials: 'same-origin', cache: 'no-cache' });
  } catch (e) {
    throw new LoadError(`réseau indisponible pour ${url.pathname}`);
  }
  if (!res.ok) throw new LoadError(`${url.pathname} : HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (e) {
    throw new LoadError(`${url.pathname} : JSON illisible`);
  }
}

/**
 * Charge levels/index.json (F3 : chapitres).
 * @returns {Promise<{chapters:Array<{id:string,name:string,levels:string[]}>, ids:string[]}>} les chapitres et, à plat, les ids dans l'ordre
 */
export async function loadIndex() {
  const raw = await getJson(new URL('index.json', LEVELS_DIR));
  const v = validateIndex(raw);
  if (!v.ok) throw new LoadError('index des niveaux invalide : ' + v.errors.map((e) => e.code).join(', '), v.errors);
  return { chapters: v.chapters, ids: v.ids };
}

/**
 * Charge et valide levels/<id>.json (niveau livré : V1 à V13).
 * @param {string} id  doit respecter [a-z0-9-]{3,40} (aucun chemin possible)
 * @returns {Promise<{level:object, state:object}>} le niveau validé et son état initial
 */
export async function loadLevel(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new LoadError(`id de niveau invalide : ${String(id).slice(0, 40)}`);
  const raw = await getJson(new URL(`${id}.json`, LEVELS_DIR));
  const v = validateLevel(raw, { mode: 'shipped', expectedId: id });
  if (!v.ok) throw new LoadError(`niveau « ${id} » invalide : ` + v.errors.map((e) => e.code).join(', '), v.errors);
  return { level: v.level, state: createState(v.level) };
}

const POOL_ID = /^daily-[0-6]$/;

/**
 * Charge un niveau du pool de repli du défi du jour (levels/daily-pool/daily-<j>.json, j = jour de semaine UTC, F7 Q5).
 * Même contrôles qu'un niveau livré, mais sans exiger que l'id soit celui d'un fichier de levels/.
 * @param {string} id  « daily-0 » à « daily-6 »
 * @returns {Promise<{level:object, state:object}>}
 */
export async function loadDailyPool(id) {
  if (typeof id !== 'string' || !POOL_ID.test(id)) throw new LoadError(`id du pool invalide : ${String(id).slice(0, 40)}`);
  const raw = await getJson(new URL(`daily-pool/${id}.json`, LEVELS_DIR));
  const v = validateLevel(raw, { mode: 'shipped', expectedId: id });
  if (!v.ok) throw new LoadError(`niveau de repli « ${id} » invalide : ` + v.errors.map((e) => e.code).join(', '), v.errors);
  return { level: v.level, state: createState(v.level) };
}
