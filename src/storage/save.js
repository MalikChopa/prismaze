// Sauvegarde v3 (ARCHITECTURE_V2 U9 ; V11 : succès, drapeaux, écrans déjà vus, musique d'ambiance). Clé `prismaze.save` et sa copie `prismaze.save.bak` (dernière sauvegarde valide).
// v2 -> v3 : ajouts seulement (rien n'est perdu) ; une sauvegarde v2 est lue telle quelle et réécrite en v3 à la première écriture.
// Le stockage est injecté (`{getItem, setItem, removeItem}` ou null quand il est bloqué) : tout se teste sous Node.
// Les données du stockage ne sont pas fiables : chargement = version -> migrations pures -> liste blanche -> objets neufs.
// Bloqué, plein ou corrompu : copie, sinon mode mémoire (le jeu continue, avec la mention « progression non sauvegardée »).

export const SAVE_KEY = 'prismaze.save';
export const BACKUP_KEY = 'prismaze.save.bak';
export const SAVE_VERSION = 3;
export const MAX_DRAFTS = 20;
export const MAX_DAILY = 60;
export const MAX_RAW = 200000; // octets lus au plus : au-delà, la sauvegarde est tenue pour corrompue
export const MOTIONS = Object.freeze(['auto', 'yes', 'no']);
export const RENDERERS = Object.freeze(['auto', 'webgl', 'canvas']); // V3-30
export const QUALITIES = Object.freeze(['auto', 'haut', 'moyen', 'bas']); // V3-30 ; le niveau du gouverneur n'est jamais enregistré
/** V11 : les 12 succès (ordre d'affichage) ; seuls ces identifiants sont gardés dans `ach`. */
export const ACHIEVEMENT_IDS = Object.freeze(['first-light', 'mirrors', 'colors', 'prisms', 'specials', 'all-levels', 'full-chapter', 'constellation', 'no-hint', 'streak', 'architect', 'first-try']);
/** V11 : drapeaux posés pendant le jeu (ce que la progression seule ne dit pas). */
export const FLAG_NAMES = Object.freeze(['nohint', 'firsttry', 'shared']);
/** V11 : écrans déjà proposés (« Comment jouer » au premier lancement). */
export const SEEN_NAMES = Object.freeze(['howto']);

const ID_RE = /^[a-z0-9-]{3,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^1\.[A-Za-z0-9_-]{1,320}$/;
const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// V11 : `ambient` (musique d'ambiance de l'accueil) éteinte par défaut : rien ne joue sans que le joueur l'ait demandé.
export const DEFAULT_SETTINGS = Object.freeze({ muted: false, motion: 'auto', symbols: true, camera: true, autohide: true, renderer: 'auto', quality: 'auto', ambient: false });

const emptyFlags = () => Object.fromEntries(FLAG_NAMES.map((k) => [k, false]));
const emptySeen = () => Object.fromEntries(SEEN_NAMES.map((k) => [k, false]));

/** Sauvegarde neuve (aucune progression, réglages par défaut). */
export function defaultSave() {
  return { v: SAVE_VERSION, levels: {}, daily: {}, dailyCache: null, settings: { ...DEFAULT_SETTINGS }, drafts: [], last: null, ach: {}, flags: emptyFlags(), seen: emptySeen() };
}

/** Réglages : liste blanche, valeur par défaut pour tout ce qui est absent ou invalide. */
export function sanitizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS };
  if (!isObj(raw)) return s;
  if (typeof own(raw, 'muted') === 'boolean') s.muted = raw.muted;
  if (MOTIONS.includes(own(raw, 'motion'))) s.motion = raw.motion;
  if (typeof own(raw, 'symbols') === 'boolean') s.symbols = raw.symbols;
  if (typeof own(raw, 'camera') === 'boolean') s.camera = raw.camera; // V3-30 : clés ajoutées, `v` reste 2
  if (typeof own(raw, 'autohide') === 'boolean') s.autohide = raw.autohide;
  if (RENDERERS.includes(own(raw, 'renderer'))) s.renderer = raw.renderer;
  if (QUALITIES.includes(own(raw, 'quality'))) s.quality = raw.quality;
  if (typeof own(raw, 'ambient') === 'boolean') s.ambient = raw.ambient; // V11
  return s;
}

function sanitizeResult(raw) {
  if (!isObj(raw)) return null;
  const done = own(raw, 'done') === true;
  const best = own(raw, 'best');
  const stars = own(raw, 'stars');
  if (!done || !isInt(best, 1, 99)) return null;
  return { done: true, best, stars: isInt(stars, 0, 3) ? stars : 1 };
}

/**
 * Liste blanche d'une sauvegarde v2 ou v3 (les champs v3 absents d'une v2 prennent leur valeur neuve) : renvoie un objet neuf, jamais l'entrée. Les ids de niveaux doivent avoir la forme d'un id
 * (aucune clé spéciale), les dates celle de AAAA-MM-JJ, les codes celle d'un code de partage ; les plafonds sont appliqués.
 */
export function sanitizeV2(raw) {
  const out = defaultSave();
  if (!isObj(raw)) return out;
  out.settings = sanitizeSettings(own(raw, 'settings'));
  const levels = own(raw, 'levels');
  if (isObj(levels)) {
    for (const id of Object.keys(levels)) {
      if (!ID_RE.test(id)) continue;
      const r = sanitizeResult(levels[id]);
      if (r !== null) Object.defineProperty(out.levels, id, { value: r, enumerable: true, writable: true, configurable: true });
    }
  }
  const daily = own(raw, 'daily');
  if (isObj(daily)) {
    const dates = Object.keys(daily).filter((d) => DATE_RE.test(d)).sort().slice(-MAX_DAILY);
    for (const d of dates) {
      const r = sanitizeResult(daily[d]);
      if (r !== null) out.daily[d] = r;
    }
  }
  const dc = own(raw, 'dailyCache');
  if (isObj(dc) && typeof own(dc, 'date') === 'string' && DATE_RE.test(dc.date) && isInt(own(dc, 'v'), 1, 99) && typeof own(dc, 'code') === 'string' && CODE_RE.test(dc.code)) {
    out.dailyCache = { date: dc.date, v: dc.v, code: dc.code };
    if (isInt(own(dc, 'm'), 1, 8)) out.dailyCache.m = dc.m; // minimum prouvé du niveau du jour (étoiles) : ajout de J6 à U9
  }
  const drafts = own(raw, 'drafts');
  if (Array.isArray(drafts)) {
    for (const d of drafts) {
      if (out.drafts.length >= MAX_DRAFTS) break;
      if (!isObj(d)) continue;
      const id = own(d, 'id'), name = own(d, 'name'), code = own(d, 'code'), t = own(d, 't');
      if (typeof id !== 'string' || !/^[a-z0-9-]{1,20}$/.test(id) || typeof name !== 'string' || name.length > 24) continue;
      if (typeof code !== 'string' || !CODE_RE.test(code)) continue;
      out.drafts.push({ id, name, code, t: Number.isFinite(t) && t >= 0 ? Math.floor(t) : 0 });
    }
  }
  const last = own(raw, 'last');
  out.last = typeof last === 'string' && ID_RE.test(last) ? last : null;
  // V11 (v3) : succès {id: date}, drapeaux et écrans vus : liste blanche stricte
  const ach = own(raw, 'ach');
  if (isObj(ach)) for (const id of ACHIEVEMENT_IDS) { const d = own(ach, id); if (typeof d === 'string' && DATE_RE.test(d)) out.ach[id] = d; }
  const flags = own(raw, 'flags');
  if (isObj(flags)) for (const k of FLAG_NAMES) if (own(flags, k) === true) out.flags[k] = true;
  const seen = own(raw, 'seen');
  if (isObj(seen)) for (const k of SEEN_NAMES) if (own(seen, k) === true) out.seen[k] = true;
  return out;
}
/** Nom générique (V11) : la même liste blanche sert pour v2 et v3. */
export const sanitizeSave = sanitizeV2;

/** Migration v1 -> v2 : les réglages sont gardés (`muted`, `motion`), `levels` et `last` sont abandonnés (niveaux refaits, P11). */
export function migrateV1(raw) {
  const out = defaultSave();
  if (isObj(raw)) out.settings = sanitizeSettings(own(raw, 'settings'));
  return out;
}

/**
 * Lit un texte de sauvegarde.
 * @returns {{ok:true, data:object, migrated:boolean, readonly:boolean}|{ok:false, reason:string}}
 *   readonly : version plus récente que ce code (lue sans être réécrite).
 */
export function parseSave(text) {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, reason: 'absent' };
  if (text.length > MAX_RAW) return { ok: false, reason: 'trop grand' };
  let raw;
  try { raw = JSON.parse(text); } catch { return { ok: false, reason: 'illisible' }; }
  if (!isObj(raw)) return { ok: false, reason: 'forme' };
  const v = own(raw, 'v');
  if (!Number.isInteger(v) || v < 1) return { ok: false, reason: 'version' };
  if (v === 1) return { ok: true, data: migrateV1(raw), migrated: true, readonly: false };
  if (v === 2) return { ok: true, data: sanitizeV2(raw), migrated: true, readonly: false }; // V11 : v2 -> v3, ajouts seulement
  if (v === SAVE_VERSION) return { ok: true, data: sanitizeV2(raw), migrated: false, readonly: false };
  return { ok: true, data: sanitizeV2(raw), migrated: false, readonly: true }; // plus récente : lecture seule
}

/** Étoiles (S8, P2) : 3 si u <= par ; 2 si u <= par + 1 + floor(par/5) ; sinon 1. */
export function starsFor(used, par) {
  if (!Number.isInteger(par) || par < 1) return 1;
  if (used <= par) return 3;
  if (used <= par + 1 + Math.floor(par / 5)) return 2;
  return 1;
}

/** Stockage du navigateur, ou null s'il est bloqué (accès qui lève, écriture refusée). Sonde par une écriture suivie d'un retrait. */
export function probeStorage(getter) {
  try {
    const s = getter();
    if (!s) return null;
    const k = 'prismaze.probe';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

/**
 * @param {{storage:(null|{getItem:Function,setItem:Function,removeItem:Function})}} opts
 */
export function createStore({ storage = null } = {}) {
  let data = defaultSave();
  const status = { mode: 'ok', reason: null, recovered: null, migrated: false };
  const listeners = new Set();
  let lastValidText = null; // dernier texte valide connu (lu ou écrit) : devient la copie à la prochaine écriture

  const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* un abonné ne casse pas la sauvegarde */ } } };
  const setMemory = (reason) => { status.mode = 'memory'; status.reason = reason; };

  function read(key) {
    try { return storage.getItem(key); } catch { return undefined; } // undefined : la lecture elle-même échoue
  }

  function load() {
    status.mode = 'ok'; status.reason = null; status.recovered = null; status.migrated = false;
    lastValidText = null;
    if (storage === null) { data = defaultSave(); setMemory('stockage bloqué'); return; }
    const text = read(SAVE_KEY);
    if (text === undefined) { data = defaultSave(); setMemory('stockage illisible'); return; }
    if (text === null) { // première visite : rien d'enregistré (la copie ne sert que si la clé principale est abîmée)
      const bak = read(BACKUP_KEY);
      const pb = typeof bak === 'string' ? parseSave(bak) : { ok: false };
      if (pb.ok && !pb.readonly) { data = pb.data; status.recovered = 'copie'; lastValidText = bak; return; }
      data = defaultSave();
      return;
    }
    const p = parseSave(text);
    if (p.ok) {
      data = p.data; status.migrated = p.migrated;
      if (p.readonly) { status.mode = 'readonly'; status.reason = 'sauvegarde d\'une version plus récente'; } else lastValidText = text; // v1 aussi : l'ancien texte devient la copie
      return;
    }
    const bak = read(BACKUP_KEY);
    const pb = typeof bak === 'string' ? parseSave(bak) : { ok: false };
    if (pb.ok && !pb.readonly) { data = pb.data; status.recovered = 'copie'; lastValidText = bak; return; }
    data = defaultSave();
    status.recovered = 'neuf'; // sauvegarde corrompue, copie absente ou corrompue : on repart de zéro (l'écriture suivante remplace)
  }

  function persist() {
    if (status.mode === 'readonly') return false;
    if (storage === null || status.mode === 'memory') return false;
    const text = JSON.stringify(data);
    try {
      if (lastValidText !== null && lastValidText !== text) storage.setItem(BACKUP_KEY, lastValidText);
      storage.setItem(SAVE_KEY, text);
      lastValidText = text;
      return true;
    } catch {
      setMemory('écriture impossible (stockage plein ou bloqué)');
      return false;
    }
  }

  function mutate(fn) {
    fn(data);
    const saved = persist();
    emit();
    return saved;
  }

  load();

  return {
    /** Copie de lecture des données (objet neuf à chaque appel). */
    get data() { return JSON.parse(JSON.stringify(data)); },
    get settings() { return { ...data.settings }; },
    get status() { return { ...status }; },
    /** true si la progression est bien écrite sur l'appareil (mode « ok »). */
    get persistent() { return status.mode === 'ok'; },
    level(id) { const r = own(data.levels, id); return r === undefined ? null : { ...r }; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Relit le stockage (retour sur l'onglet : le dernier écrit gagne). */
    reload() {
      // la progression de la session n'existe qu'en mémoire : une relecture l'effacerait (succès accordés puis annoncés de nouveau).
      // V13b (revue n° 3) : de même en lecture seule (sauvegarde d'une version plus récente) : rien n'y est écrit, relire ne ferait que perdre la session.
      if (status.mode === 'memory' || status.mode === 'readonly') return;
      const before = JSON.stringify([data, status]);
      load();
      if (JSON.stringify([data, status]) !== before) emit(); // rien n'a changé : on ne redessine pas (le focus reste où il est)
    },
    /**
     * Enregistre une victoire. `best` = plus petit score ; `stars` recalculées sur ce meilleur score.
     * @returns {{best:number, stars:number, isBest:boolean, first:boolean, saved:boolean}}
     */
    recordLevel(id, used, par) {
      if (!ID_RE.test(id) || !isInt(used, 1, 99)) return { best: used, stars: starsFor(used, par), isBest: false, first: false, saved: false };
      const prev = own(data.levels, id);
      const first = prev === undefined;
      const best = first ? used : Math.min(prev.best, used);
      const stars = Math.max(first ? 0 : prev.stars, starsFor(best, par));
      const isBest = first || used < prev.best;
      const saved = mutate((d) => { Object.defineProperty(d.levels, id, { value: { done: true, best, stars }, enumerable: true, writable: true, configurable: true }); d.last = id; });
      return { best, stars, isBest, first, saved };
    },
    setLast(id) { if (ID_RE.test(id)) mutate((d) => { d.last = id; }); },
    setSetting(key, value) {
      const next = sanitizeSettings({ ...data.settings, [key]: value });
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) return false;
      return mutate((d) => { d.settings = next; });
    },
    /** Réinitialise la progression (niveaux, défis, dernier niveau ; V11 : succès et drapeaux). Réglages, brouillons et écrans vus gardés. */
    resetProgress() { return mutate((d) => { d.levels = {}; d.daily = {}; d.dailyCache = null; d.last = null; d.ach = {}; d.flags = emptyFlags(); }); },

    // ---- V11 : succès, drapeaux, écrans vus ----
    /** Succès obtenus : {id: AAAA-MM-JJ}. */
    get achievements() { return { ...data.ach }; },
    /** Ajoute les succès `ids` encore absents (date du jour) ; renvoie ceux qui viennent d'être ajoutés. */
    grantAchievements(ids, date) {
      if (!DATE_RE.test(date)) return [];
      const fresh = ids.filter((id, i) => ACHIEVEMENT_IDS.includes(id) && own(data.ach, id) === undefined && ids.indexOf(id) === i);
      if (fresh.length > 0) mutate((d) => { for (const id of fresh) d.ach[id] = date; });
      return fresh;
    },
    get flags() { return { ...data.flags }; },
    /** Pose un drapeau (nohint, firsttry, shared) ; true s'il vient d'être posé. */
    setFlag(name) {
      if (!FLAG_NAMES.includes(name) || data.flags[name] === true) return false;
      mutate((d) => { d.flags[name] = true; });
      return true;
    },
    get seen() { return { ...data.seen }; },
    markSeen(name) {
      if (!SEEN_NAMES.includes(name) || data.seen[name] === true) return false;
      mutate((d) => { d.seen[name] = true; });
      return true;
    },
    /** Défi du jour et brouillons passent par la même liste blanche. */
    replaceAll(next) { return mutate((d) => { Object.assign(d, sanitizeV2(next)); }); },

    // ---- défi du jour (Q8) : `daily[date] = {done, best, stars}` (60 dates) et le niveau du jour en cache (code F4 + version) ----
    /** Résultat d'une date AAAA-MM-JJ, ou null. */
    daily(date) { const r = DATE_RE.test(date) ? own(data.daily, date) : undefined; return r === undefined ? null : { ...r }; },
    /** Enregistre une victoire du défi : meilleur score gardé ; étoiles recalculées sur ce meilleur score (par = minimum prouvé du niveau du jour). */
    recordDaily(date, used, par) {
      if (!DATE_RE.test(date) || !isInt(used, 1, 99)) return { best: used, stars: starsFor(used, par), isBest: false, first: false, saved: false };
      const prev = own(data.daily, date);
      const first = prev === undefined;
      const best = first ? used : Math.min(prev.best, used);
      const stars = Math.max(first ? 0 : prev.stars, starsFor(best, par));
      const isBest = first || used < prev.best;
      const saved = mutate((d) => {
        d.daily[date] = { done: true, best, stars };
        for (const k of Object.keys(d.daily).sort().slice(0, -MAX_DAILY)) delete d.daily[k]; // 60 dates au plus : les plus anciennes partent
      });
      return { best, stars, isBest, first, saved };
    },
    /** Niveau du jour calculé (Q8) : {date, v, code} ou null. */
    get dailyCache() { return data.dailyCache === null ? null : { ...data.dailyCache }; },
    setDailyCache(date, v, code, minimum = null) {
      if (!DATE_RE.test(date) || !isInt(v, 1, 99) || typeof code !== 'string' || !CODE_RE.test(code)) return false;
      return mutate((d) => { d.dailyCache = isInt(minimum, 1, 8) ? { date, v, code, m: minimum } : { date, v, code }; });
    },

    // ---- brouillons de l'éditeur (U9) : 20 au plus ; rien n'est écrit sans geste du joueur (F5) ----
    get drafts() { return data.drafts.map((d) => ({ ...d })); },
    /** Ajoute un brouillon {name, code}. Refusé (false, raison) au-delà de 20 ou si le code ou le nom est invalide. */
    addDraft(name, code, t = 0) {
      if (data.drafts.length >= MAX_DRAFTS) return { ok: false, reason: 'full' };
      if (typeof name !== 'string' || name.length > 24 || typeof code !== 'string' || !CODE_RE.test(code)) return { ok: false, reason: 'invalid' };
      let n = 1;
      while (data.drafts.some((d) => d.id === `d${n}`)) n++;
      const id = `d${n}`;
      mutate((d) => { d.drafts.push({ id, name, code, t: Number.isFinite(t) && t >= 0 ? Math.floor(t) : 0 }); });
      return { ok: true, id };
    },
    /** Remplace le nom et le code d'un brouillon existant. */
    updateDraft(id, name, code, t = 0) {
      const i = data.drafts.findIndex((d) => d.id === id);
      if (i < 0) return { ok: false, reason: 'missing' };
      if (typeof name !== 'string' || name.length > 24 || typeof code !== 'string' || !CODE_RE.test(code)) return { ok: false, reason: 'invalid' };
      mutate((d) => { d.drafts[i] = { id, name, code, t: Number.isFinite(t) && t >= 0 ? Math.floor(t) : 0 }; });
      return { ok: true, id };
    },
    deleteDraft(id) {
      const i = data.drafts.findIndex((d) => d.id === id);
      if (i < 0) return false;
      mutate((d) => { d.drafts.splice(i, 1); });
      return true;
    },
  };
}
