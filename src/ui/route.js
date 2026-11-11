// Routage par fragment (ARCHITECTURE_V2 U1) : `#` accueil, `#play=<id>`, `#daily`, `#edit`, `#l=1.<charge>` ; tout autre fragment : accueil.
// V11 : écrans de l'accueil `#niveaux`, `#chapitre-<n>` (1 à 9), `#aide`, `#succes`, `#apropos` (route `menu` avec `sub`).
// Fonctions pures. Le fragment n'est jamais envoyé au serveur (règle du protocole) : un niveau partagé reste sur l'appareil.
import { ID_PATTERN } from '../engine/level.js';

const SHARE_MAX = 320 + 3; // `l=` + charge de 320 caractères au plus (F5) ; la validation complète est celle de share.js
const SUBS = Object.freeze({ niveaux: 'chapters', aide: 'howto', succes: 'ach', apropos: 'about' });

/**
 * @param {string} hash  location.hash (avec ou sans « # »)
 * @returns {{name:'menu', sub?:string, chapter?:number}|{name:'play', id:string}|{name:'daily'}|{name:'edit'}|{name:'shared', code:string|null}}  (code null : fragment trop long)
 */
export function parseHash(hash) {
  const h = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  if (h === '' ) return { name: 'menu' };
  if (h.startsWith('play=')) {
    const id = h.slice(5);
    return ID_PATTERN.test(id) ? { name: 'play', id } : { name: 'menu' };
  }
  if (h === 'daily') return { name: 'daily' };
  if (h === 'edit') return { name: 'edit' };
  if (h.startsWith('l=')) return { name: 'shared', code: h.length <= SHARE_MAX ? h.slice(2) : null }; // trop long : « lien invalide » sans lire plus loin (F5)
  if (Object.prototype.hasOwnProperty.call(SUBS, h)) return { name: 'menu', sub: SUBS[h] };
  const m = /^chapitre-([1-9])$/.exec(h);
  if (m) return { name: 'menu', sub: 'levels', chapter: Number(m[1]) - 1 };
  return { name: 'menu' };
}

export const playHash = (id) => `#play=${id}`;
