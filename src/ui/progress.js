// Progression affichée (ARCHITECTURE_V2 P14, S8) : verrouillage séquentiel, totaux d'étoiles, niveau suivant. Fonctions pures.
// P14 : les niveaux d'un chapitre se jouent dans l'ordre ; le chapitre suivant s'ouvre quand le 7e niveau du précédent est gagné
// (un chapitre de moins de 7 niveaux : quand tous sont gagnés — lecture retenue pour les niveaux provisoires). Éditeur, défi et
// niveaux partagés sont ouverts d'emblée (hors de ce module).

export const UNLOCK_AFTER = 7;

/** Nombre de victoires qui ouvre le chapitre suivant. */
export const chapterThreshold = (chapter) => Math.min(UNLOCK_AFTER, chapter.levels.length);

/**
 * @param {Array<{id:string,name:string,levels:string[]}>} chapters  index des niveaux (levels/index.json)
 * @param {(id:string)=>({done:boolean,best:number,stars:number}|null)} result  résultat enregistré d'un niveau
 * @returns {{chapters:Array<object>, stars:number, maxStars:number, done:number, total:number, nextId:string|null}}
 *   chapters[i] = {id, name, index, unlocked, done, total, stars, levels:[{id, n, state:'done'|'current'|'locked', best, stars}]}
 *   nextId : premier niveau jouable non gagné (celui que « Continuer » ouvre), ou null si tout est gagné
 */
export function computeProgress(chapters, result) {
  const out = [];
  let prevOpensNext = true;
  let stars = 0, done = 0, total = 0, nextId = null;
  chapters.forEach((ch, index) => {
    const unlocked = prevOpensNext;
    let chDone = 0, chStars = 0, previousDone = true;
    const levels = ch.levels.map((id, k) => {
      const r = result(id);
      const isDone = r !== null && r.done === true;
      let state;
      if (isDone) state = 'done';
      else if (unlocked && previousDone) state = 'current';
      else state = 'locked';
      if (isDone) { chDone++; chStars += r.stars; }
      if (state === 'current' && nextId === null) nextId = id;
      previousDone = isDone;
      return { id, n: k + 1, state, best: isDone ? r.best : 0, stars: isDone ? r.stars : 0 };
    });
    out.push({ id: ch.id, name: ch.name, index, unlocked, done: chDone, total: ch.levels.length, stars: chStars, levels });
    stars += chStars; done += chDone; total += ch.levels.length;
    prevOpensNext = unlocked && chDone >= chapterThreshold(ch);
  });
  return { chapters: out, stars, maxStars: total * 3, done, total, nextId };
}

/** Un niveau est-il jouable (déverrouillé) ? Les ids inconnus de l'index sont refusés. */
export function isPlayable(progress, id) {
  for (const ch of progress.chapters) for (const l of ch.levels) if (l.id === id) return l.state !== 'locked';
  return false;
}

/** Le niveau qui suit `id` dans l'ordre de l'index, s'il est jouable maintenant ; sinon null. */
export function nextPlayable(progress, id) {
  const flat = [];
  for (const ch of progress.chapters) for (const l of ch.levels) flat.push({ ...l, chapter: ch });
  const i = flat.findIndex((l) => l.id === id);
  if (i < 0 || i + 1 >= flat.length) return null;
  const nxt = flat[i + 1];
  return nxt.state === 'locked' ? null : { id: nxt.id, n: nxt.n, chapter: nxt.chapter.name };
}

/** Place d'un niveau : {chapter, n, total} pour l'étiquette « COULEURS · 03 », ou null. */
export function locate(chapters, id) {
  for (const ch of chapters) {
    const k = ch.levels.indexOf(id);
    if (k >= 0) return { chapter: ch.name, chapterIndex: chapters.indexOf(ch), n: k + 1, total: ch.levels.length };
  }
  return null;
}

/** « ★★☆ » pour 2 étoiles sur 3. */
export const starsText = (n) => '★'.repeat(Math.max(0, Math.min(3, n))) + '☆'.repeat(3 - Math.max(0, Math.min(3, n)));
/** Libellé lu par un lecteur d'écran. */
export const starsLabel = (n) => `${n} étoile${n > 1 ? 's' : ''} sur 3`;
