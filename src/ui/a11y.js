// Accessibilité (ARCHITECTURE_V2 U4) : annonces `aria-live` en français. Les fabriques de messages sont pures.
// Aucune information par la couleur seule : les annonces nomment les couleurs. Les cases sont annoncées en numérotation « humaine »
// (colonne 1 = la première), alors que l'état de débogage (`?debug`) numérote à partir de 0.
import { ORIENT_CHARS } from '../engine/dirs.js';
import { pieceAt } from '../engine/state.js';
import { COLOR_NAMES } from '../engine/colors.js';

const ORIENT_NAMES = ['horizontal', 'oblique montante', 'vertical', 'oblique descendante'];
const DIR_NAMES = ['vers l\'est', 'vers le nord', 'vers l\'ouest', 'vers le sud'];
const TYPE_NAMES = { mirror: 'miroir', splitter: 'séparateur', prism: 'prisme', filter: 'filtre', emitter: 'émetteur', wall: 'mur', target: 'cible', portal: 'portail', gate: 'porte' };

/** « colonne 4, ligne 2 » (numérotation à partir de 1). */
export function cellName(c, r) {
  return `colonne ${c + 1}, ligne ${r + 1}`;
}

const TURNED_ORIENT = { 'oblique montante /': 'oblique descendante \\', 'oblique descendante \\': 'oblique montante /', 'horizontal -': 'vertical |', 'vertical |': 'horizontal -' }; // quart de tour : la pente s'inverse, horizontal et vertical s'échangent
const TURNED_DIR = { "vers l'est": 'vers le sud', 'vers le nord': "vers l'est", "vers l'ouest": 'vers le nord', 'vers le sud': "vers l'ouest" }; // quart de tour horaire

/** V7 : plateau tourné, les coordonnées d'un texte (annonces, indice) sont converties en coordonnées VUES À L'ÉCRAN : colonnes depuis la gauche, lignes depuis le haut. */
export function screenCellText(text, rows) {
  return text
    .replace(/colonne (\d+), ligne (\d+)/g, (m, n, l) => `colonne ${rows - Number(l) + 1}, ligne ${n}`)
    .replace(/oblique montante \/|oblique descendante \\|horizontal -|vertical \|/g, (m) => TURNED_ORIENT[m])
    .replace(/vers l'est|vers le nord|vers l'ouest|vers le sud/g, (m) => TURNED_DIR[m]);
}

/** « 1 cible sur 2 allumée » / « 2 cibles sur 2 allumées » / « 0 cible sur 2 allumée ». */
export function litMessage(litCount, total) {
  const plural = litCount > 1;
  return `${litCount} cible${plural ? 's' : ''} sur ${total} allumée${plural ? 's' : ''}`;
}

/** Nom de couleur d'un masque (1..7). */
export const colorName = (mask) => COLOR_NAMES[mask] || '';
/** Nom de couleur accordé au féminin (une cible verte, une cible blanche). */
const COLOR_NAMES_F = Object.freeze(['', 'rouge', 'verte', 'jaune', 'bleue', 'violette', 'cyan', 'blanche']);
export const colorNameF = (mask) => COLOR_NAMES_F[mask] || '';

/** Nom + état d'une pièce : « miroir mobile, oblique montante / », « filtre vert », « émetteur blanc vers l'est »... */
export function pieceDescription(piece) {
  const name = TYPE_NAMES[piece.type] || 'pièce';
  const lock = piece.fixed && (piece.type === 'mirror' || piece.type === 'splitter' || piece.type === 'prism' || piece.type === 'filter') ? ' fixe' : '';
  switch (piece.type) {
    case 'mirror': case 'splitter': return `${name}${lock || ' mobile'}, ${ORIENT_NAMES[piece.o & 3]} ${ORIENT_CHARS[piece.o & 3]}`;
    case 'prism': return `${name}${lock || ' mobile'}`;
    case 'filter': return `${name} ${colorName(piece.mask)}${lock || ' mobile'}`;
    case 'emitter': return `${name} ${colorName(piece.mask)} ${DIR_NAMES[piece.dir & 3]}`;
    case 'target': return `${name} ${colorNameF(piece.need)}`;
    case 'portal': return `${name} ${piece.pair + 1}`;
    default: return name;
  }
}

/** Compatibilité : description d'un miroir. */
export const mirrorDescription = pieceDescription;

/** État d'une cible : « allumée », « éteinte », « reçoit du vert, il manque du rouge », « reçoit trop de lumière ». `x` : booléen ou {lit, reached, got}. */
export function targetStatus(x) {
  if (x === null || x === undefined) return '';
  if (typeof x === 'boolean') return x ? ' allumée' : ' éteinte';
  if (x.lit) return ' allumée';
  if (x.got === 0) return ' éteinte';
  return x.reached ? ` reçoit trop de lumière (${colorName(x.got)})` : ` partielle, elle reçoit ${colorName(x.got)}`;
}

/**
 * Ce que contient une case, pour une annonce quand le curseur arrive dessus.
 * @param {object} state  état du moteur
 * @param {boolean[]|object[]} [lit]  cibles dans l'ordre des cibles de `state.pieces` : booléens ou résultats {lit, reached, got}
 */
export function describeCell(state, c, r, lit) {
  const where = cellName(c, r);
  const p = pieceAt(state, c, r);
  if (p === undefined) return `${where} : case vide`;
  let text = pieceDescription(p);
  if (p.type === 'target' && lit) {
    let t = 0;
    for (const q of state.pieces) {
      if (q.type !== 'target') continue;
      if (q === p) { text += targetStatus(lit[t]); break; }
      t++;
    }
  }
  return `${where} : ${text}`;
}

/** Phrases d'annonce (messages courts, un seul endroit pour les corriger). */
export const MESSAGES = Object.freeze({
  fixed: 'Pièce fixe',
  noRotate: 'Cette pièce ne tourne pas : déplace-la',
  picked: 'Pièce prise',
  cancelled: 'Prise annulée',
  occupied: 'Case occupée : la pièce revient',
  outside: 'Hors du plateau : la pièce revient',
  restarted: 'Niveau recommencé',
  nothingToUndo: 'Rien à annuler',
  nothingToRedo: 'Rien à refaire',
  solved: 'Niveau résolu',
  hintSoon: 'Indice : bientôt disponible',
  soundSoon: 'Son : bientôt disponible',
  preview: 'Aperçu de la rotation dans l\'autre sens',
});

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** « Miroir tourné en oblique montante / » (état après la rotation). */
export function rotateMessage(piece) {
  return `${cap(TYPE_NAMES[piece.type] || 'pièce')} tourné en ${ORIENT_NAMES[piece.o & 3]} ${ORIENT_CHARS[piece.o & 3]}.`;
}

/** « Prisme posé : colonne 4, ligne 2. » */
export function moveMessage(to, piece = null) {
  if (!piece) return `Pièce posée : ${cellName(to.c, to.r)}.`;
  return `${cap(TYPE_NAMES[piece.type] || 'pièce')} posé : ${cellName(to.c, to.r)}.`;
}

/**
 * Annonceur : écrit dans une zone `aria-live="polite"`. Une phrase identique à la précédente est quand même
 * relue (on vide la zone, puis on écrit à l'image suivante).
 * @param {{textContent:string}} el
 * @param {{schedule?:(fn:()=>void)=>void}} [opts]  schedule : planificateur (tests : exécution immédiate)
 */
export function createAnnouncer(el, opts = {}) {
  const schedule = opts.schedule || ((fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 0)));
  let last = '';
  let token = 0;
  return {
    say(text) {
      last = text;
      const mine = ++token;
      el.textContent = '';
      schedule(() => { if (mine === token) el.textContent = text; });
    },
    get last() { return last; },
  };
}
