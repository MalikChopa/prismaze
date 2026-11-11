// Couleurs de la lumière (E2). Module pur : aucune dépendance.
// Une couleur est un masque de 3 bits : R = 1, G = 2, B = 4 ; les sept couleurs sont les masques 1 à 7.

export const R = 1;
export const G = 2;
export const B = 4;
export const WHITE = 7;

/** Nom, symbole (D6) et teinte par masque (l'indice 0 = pas de lumière). */
export const COLOR_NAMES = Object.freeze(['', 'rouge', 'vert', 'jaune', 'bleu', 'violet', 'cyan', 'blanc']);
export const COLOR_SYMBOLS = Object.freeze(['', '▲', '●', '✚', '■', '◆', '✦', '○']);
export const COLOR_HUES = Object.freeze(['', '#ff4d6d', '#3dffb0', '#ffd23f', '#4d8dff', '#c26bff', '#3de0ff', '#ffffff']);

/** 'RG' -> 3. Lettres R, G, B dans n'importe quel ordre, sans doublon ; renvoie -1 si la chaîne est invalide ou vide. */
export function maskFromLetters(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length > 3) return -1;
  let m = 0;
  for (let i = 0; i < s.length; i++) {
    const bit = s[i] === 'R' ? R : s[i] === 'G' ? G : s[i] === 'B' ? B : 0;
    if (bit === 0 || (m & bit) !== 0) return -1;
    m |= bit;
  }
  return m;
}

/** 3 -> 'RG' (ordre R, G, B). */
export function maskToLetters(m) {
  return ((m & R) ? 'R' : '') + ((m & G) ? 'G' : '') + ((m & B) ? 'B' : '');
}
