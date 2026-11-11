// Directions et orientations (R2, R4, R5). Module pur : aucune dépendance.

/** Directions : 0 = E, 1 = N, 2 = W, 3 = S (y vers le bas). */
export const DX = Object.freeze([1, 0, -1, 0]);
export const DY = Object.freeze([0, -1, 0, 1]);
export const DIR_CHARS = Object.freeze(['E', 'N', 'W', 'S']);

/** Orientations d'un miroir : 0 = '-', 1 = '/', 2 = '|', 3 = '\'. */
export const ORIENT_CHARS = Object.freeze(['-', '/', '|', '\\']);

/** Opposé d'une direction (R2). */
export function opposite(d) {
  return (d + 2) & 3;
}

/** Direction de sortie d'un miroir d'orientation o touché en allant dans la direction d (R5). */
export function reflect(o, d) {
  return (o - d) & 3;
}

/** Orientation suivante après un toucher (R4) : / -> | -> \ -> - */
export function nextOrientation(o) {
  return (o + 1) & 3;
}

/** Orientation précédente (annuler un toucher). */
export function prevOrientation(o) {
  return (o + 3) & 3;
}

/** 'E' -> 0 ; renvoie -1 si le caractère est inconnu. */
export function dirFromChar(ch) {
  return DIR_CHARS.indexOf(ch);
}

/** '/' -> 1 ; renvoie -1 si le caractère est inconnu. */
export function orientFromChar(ch) {
  return ORIENT_CHARS.indexOf(ch);
}

export function dirToChar(d) {
  return DIR_CHARS[d & 3];
}

export function orientToChar(o) {
  return ORIENT_CHARS[o & 3];
}
