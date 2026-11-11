// V11 : écran des chapitres et écran des niveaux d'un chapitre (maquette D2), à la place de l'ancienne grille de 50 tuiles.
// Lignes sans boîte : petit dessin lumineux, numéro romain, nom, étoiles ; niveaux : numéro, nom réel, étoiles, « à jouer » ou cadenas.
// Le verrouillage est celui de progress.js (P14), inchangé. Chaque niveau est un vrai bouton (classe `tile`, `data-id`, état) : clavier natif.
import { starsLabel, chapterThreshold } from './progress.js';
import { chapterArt } from './wordmark.js';

export const CHAPTER_COLORS = ['#c9d0ff', '#ff4d6d', '#3dffb0', '#4d8dff', '#c26bff'];
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
/** Phrase d'un chapitre (écran des niveaux), par id de levels/index.json. */
export const CHAPTER_LEADS = Object.freeze({
  miroirs: 'Tourne et glisse les miroirs pour guider le faisceau.',
  couleurs: 'Rouge, vert, bleu : les faisceaux s\'additionnent, les filtres trient.',
  prismes: 'Le prisme sépare le blanc en trois couleurs.',
  speciales: 'Séparateurs, portails et portes qui s\'ouvrent.',
  maitrise: 'Tout ensemble. Les niveaux les plus durs.',
});
const LOCK_SVG = '<svg viewBox="0 0 12 13" aria-hidden="true"><rect x="1.5" y="5.5" width="9" height="6.5" rx="1"/><path d="M3.5 5.5V4a2.5 2.5 0 0 1 5 0v1.5"/></svg>';

const pad2 = (n) => String(n).padStart(2, '0');
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** « 2026-11-08 » -> « 8 novembre 2026 » (la date du défi est en UTC : aucune conversion de fuseau). Autre forme : renvoyée telle quelle. */
export function frenchDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (m === null || Number(m[2]) < 1 || Number(m[2]) > 12) return String(iso);
  return `${Number(m[3])}${Number(m[3]) === 1 ? 'er' : ''} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
/** Nom affiché d'un niveau : son nom réel (levels/<id>.json, via level-names.js), sinon l'id rendu lisible. */
export const levelName = (names, id) => (names && typeof names[id] === 'string' ? names[id] : id.replace(/^[a-z]\d+-/, '').replace(/-/g, ' '));

function h(doc, tag, attrs = {}, text = null) {
  const n = doc.createElement(tag);
  for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
  if (text !== null) n.textContent = text;
  return n;
}
/** « 25/30 ★ · 10/10 » : étoile dorée en aria-hidden (le libellé du bouton dit tout). */
function starsMeta(doc, stars, maxStars, done, total) {
  const span = h(doc, 'span', { class: 'mt num' });
  span.append(`${stars}/${maxStars} `, h(doc, 'span', { class: 'st', 'aria-hidden': 'true' }, '★'), ` · ${done}/${total}`);
  return span;
}

/**
 * Écran des chapitres.
 * @param {HTMLElement} list  <ul> des chapitres
 * @param {object} progress  computeProgress(...)
 * @param {{onOpen:(index:number)=>void, onLocked:(text:string)=>void}} cb
 */
export function renderChapters(doc, list, progress, cb) {
  list.replaceChildren();
  progress.chapters.forEach((ch, i) => {
    const li = h(doc, 'li');
    const b = h(doc, 'button', { type: 'button', 'data-ch': String(i), 'data-beam': '' });
    const art = h(doc, 'span', { class: 'art' });
    art.innerHTML = chapterArt(i); // texte SVG constant du code, aucune donnée externe
    const nm = h(doc, 'span', { class: 'nm' });
    nm.append(h(doc, 'i', {}, ROMAN[i] || String(i + 1)), ch.name);
    const prev = i > 0 ? progress.chapters[i - 1] : null;
    const lockText = prev ? `Finis ${chapterThreshold({ levels: prev.levels })} niveaux de ${prev.name}` : '';
    const meta = ch.unlocked ? starsMeta(doc, ch.stars, ch.total * 3, ch.done, ch.total) : h(doc, 'span', { class: 'mt' }, lockText);
    b.append(art, nm, meta);
    if (!ch.unlocked) {
      b.className = 'lk';
      b.setAttribute('aria-disabled', 'true');
      b.setAttribute('aria-label', `Chapitre ${ROMAN[i]}, ${ch.name} : verrouillé. ${lockText}.`);
      b.addEventListener('click', () => cb.onLocked(`Verrouillé : ${lockText.charAt(0).toLowerCase()}${lockText.slice(1)}.`));
    } else {
      b.setAttribute('aria-label', `Chapitre ${ROMAN[i]}, ${ch.name} : ${ch.stars} étoiles sur ${ch.total * 3}, ${ch.done} niveaux sur ${ch.total}`);
      b.addEventListener('click', () => cb.onOpen(i));
    }
    li.append(b);
    list.append(li);
  });
}

/**
 * Écran des niveaux d'un chapitre.
 * @param {{title:HTMLElement, lead:HTMLElement, art:HTMLElement, list:HTMLElement}} el
 * @param {object} ch  progress.chapters[i]
 * @param {Object<string,string>} names  noms réels des niveaux
 * @param {{onPlay:(id:string)=>void, onLocked:(text:string)=>void}} cb
 */
export function renderLevels(doc, el, ch, names, cb) {
  const i = ch.index;
  el.title.textContent = `${ROMAN[i] || i + 1} · ${ch.name}`;
  el.lead.replaceChildren(`${CHAPTER_LEADS[ch.id] || ''} `, h(doc, 'span', { class: 'num' }, `· ${ch.stars}/${ch.total * 3} `), h(doc, 'span', { class: 'st', 'aria-hidden': 'true' }, '★'));
  el.art.innerHTML = chapterArt(i); // texte SVG constant
  el.list.replaceChildren();
  for (const l of ch.levels) {
    const li = h(doc, 'li');
    const nm = levelName(names, l.id);
    const b = h(doc, 'button', { type: 'button', class: `tile ${l.state}`, 'data-id': l.id });
    b.append(h(doc, 'span', { class: 'n num', 'aria-hidden': 'true' }, pad2(l.n)), h(doc, 'span', { class: 'nm' }, nm));
    const right = h(doc, 'span', { class: 's', 'aria-hidden': 'true' });
    let label = `Niveau ${l.n}, ${nm} : `;
    if (l.state === 'done') {
      right.append('★'.repeat(l.stars), h(doc, 'span', { class: 'o' }, '★'.repeat(3 - l.stars)));
      label += `${starsLabel(l.stars)}, meilleur score ${l.best} pièce${l.best > 1 ? 's' : ''}.`;
      b.title = `Meilleur : ${l.best} pièce${l.best > 1 ? 's' : ''}`;
    } else if (l.state === 'current') {
      right.textContent = 'à jouer';
      label += 'à jouer.';
    } else {
      right.innerHTML = LOCK_SVG; // constante du code
      b.setAttribute('aria-disabled', 'true');
      label += 'verrouillé.';
    }
    b.append(right);
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => { if (l.state === 'locked') cb.onLocked('Verrouillé : gagne d\'abord le niveau précédent.'); else cb.onPlay(l.id); });
    li.append(b);
    el.list.append(li);
  }
}
