// V11 : les 12 succès (docs/maquette-d/NOTES.md), la série du défi du jour et le compte à rebours. Fonctions pures, aucun serveur :
// tout se calcule depuis la sauvegarde (progression, dates du défi, drapeaux posés pendant le jeu).
import { ACHIEVEMENT_IDS } from '../storage/save.js';

const DAY_MS = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayIndex = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

/**
 * Série du défi du jour : jours consécutifs relevés qui finissent aujourd'hui, ou hier si celui du jour n'est pas encore relevé
 * (la série n'est pas perdue avant minuit UTC). `best` : plus longue suite de jours consécutifs dans l'historique gardé (60 dates).
 * @param {string[]} dates  dates AAAA-MM-JJ relevées
 * @param {string} today  AAAA-MM-JJ (UTC)
 * @returns {{current:number, best:number, today:boolean}}
 */
export function dailyStreak(dates, today) {
  const days = [...new Set(dates.filter((d) => DATE_RE.test(d)).map(dayIndex).filter(Number.isFinite))].sort((a, b) => a - b);
  const set = new Set(days);
  let best = 0, run = 0, prev = null;
  for (const d of days) { run = prev !== null && d === prev + 1 ? run + 1 : 1; prev = d; if (run > best) best = run; }
  const t = DATE_RE.test(today) ? dayIndex(today) : NaN;
  const doneToday = set.has(t);
  let current = 0;
  for (let d = doneToday ? t : t - 1; set.has(d); d--) current++;
  return { current, best, today: doneToday };
}

/** Temps jusqu'au prochain défi (minuit UTC) : « HH:MM » (minutes tronquées ; 00:00 au plus bas). */
export function countdown(now = Date.now()) {
  const left = Math.max(0, (Math.floor(now / DAY_MS) + 1) * DAY_MS - now);
  const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Couleurs (teintes de faisceau du jeu) et textes des succès, dans l'ordre de ACHIEVEMENT_IDS. */
export const ACHIEVEMENTS = Object.freeze([
  { id: 'first-light', name: 'Premier rayon', desc: 'Résoudre le premier niveau.', color: '#c9d0ff' },
  { id: 'mirrors', name: 'Jeu de miroirs', desc: 'Finir le chapitre Miroirs.', color: '#c9d0ff', chapter: 'miroirs' },
  { id: 'colors', name: 'Peintre de lumière', desc: 'Finir le chapitre Couleurs.', color: '#ff4d6d', chapter: 'couleurs' },
  { id: 'prisms', name: 'Arc-en-ciel', desc: 'Finir le chapitre Prismes.', color: '#3dffb0', chapter: 'prismes' },
  { id: 'specials', name: 'Passe-muraille', desc: 'Finir le chapitre Pièces spéciales.', color: '#4d8dff', chapter: 'speciales' },
  { id: 'all-levels', name: 'Maître prisme', desc: 'Finir les 50 niveaux.', color: '#c26bff' },
  { id: 'full-chapter', name: 'Plein feu', desc: '3 étoiles sur les 10 niveaux d\'un chapitre.', color: '#ffd23f' },
  { id: 'constellation', name: 'Constellation', desc: 'Toutes les étoiles : 150 sur 150.', color: '#ffd23f' },
  { id: 'no-hint', name: 'Sans indice', desc: 'Résoudre un niveau de Maîtrise sans indice.', color: '#3de0ff' },
  { id: 'streak', name: 'Fidèle au poste', desc: 'Relever le défi du jour 7 jours de suite.', color: '#3dffb0' },
  { id: 'architect', name: 'Architecte', desc: 'Créer un niveau dans l\'éditeur et copier son lien de partage.', color: '#4d8dff' },
  { id: 'first-try', name: 'Du premier coup', desc: '3 étoiles sans annuler ni recommencer.', color: '#ff4d6d' },
]);
if (ACHIEVEMENTS.map((a) => a.id).join() !== ACHIEVEMENT_IDS.join()) throw new Error('succès : liste incohérente avec la sauvegarde');

/** Chapitre de la Maîtrise (succès « Sans indice »). */
export const MASTERY_CHAPTER = 'maitrise';

/**
 * État des 12 succès.
 * @param {{progress:object, flags:{nohint:boolean, firsttry:boolean, shared:boolean}, dailyDates:string[], today:string, granted?:object}} input
 *   progress : computeProgress(...) ; granted : succès déjà enregistrés {id: date} (un succès obtenu le reste)
 * @returns {Array<{id:string, name:string, desc:string, color:string, earned:boolean, date:string|null, progress:[number, number]|null}>}
 */
export function computeAchievements({ progress, flags, dailyDates, today, granted = {} }) {
  const ch = (id) => progress.chapters.find((c) => c.id === id) || null;
  const full = (c) => c !== null && c.total > 0 && c.done === c.total;
  const streak = dailyStreak(dailyDates, today);
  const total = progress.total;
  const rules = {
    'first-light': () => [progress.done >= 1, null],
    'all-levels': () => [total > 0 && progress.done === total, [progress.done, total]],
    'full-chapter': () => { // V13 : progression = le chapitre le plus avancé en niveaux à 3 étoiles (« 3/10 »)
      const best = progress.chapters.filter((c) => c.total > 0).reduce((m, c) => { const n = c.levels.filter((l) => l.stars === 3).length; return n / c.total > m[0] / m[1] ? [n, c.total] : m; }, [0, 10]);
      return [progress.chapters.some((c) => c.total > 0 && c.stars === c.total * 3), best];
    },
    constellation: () => [progress.maxStars > 0 && progress.stars === progress.maxStars, [progress.stars, progress.maxStars]],
    'no-hint': () => [flags.nohint === true, null],
    streak: () => [streak.best >= 7, [Math.min(Math.max(streak.best, streak.current), 7), 7]],
    architect: () => [flags.shared === true, null],
    'first-try': () => [flags.firsttry === true, null],
  };
  return ACHIEVEMENTS.map((a) => {
    let earned, prog;
    if (a.chapter) { const c = ch(a.chapter); earned = full(c); prog = c ? [c.done, c.total] : null; } else [earned, prog] = rules[a.id]();
    const date = typeof granted[a.id] === 'string' ? granted[a.id] : null;
    return { id: a.id, name: a.name, desc: a.desc, color: a.color, earned: earned || date !== null, date, progress: prog };
  });
}

/** Identifiants obtenus selon le calcul et pas encore enregistrés. */
export const newlyEarned = (list, granted) => list.filter((a) => a.earned && typeof granted[a.id] !== 'string').map((a) => a.id);

/** Texte de droite d'une ligne de succès : « obtenu », une progression « 44/50 », ou « — ». */
export const achievementRight = (a) => (a.earned ? 'obtenu' : a.progress && a.progress[0] > 0 ? `${a.progress[0]}/${a.progress[1]}` : '—');
