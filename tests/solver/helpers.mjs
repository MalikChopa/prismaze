// Aides communes aux tests du solveur (J3).
import { readFileSync } from 'node:fs';

export const fixtureUrl = (f) => new URL(`../fixtures/${f}`, import.meta.url);
export const readFixture = (f) => JSON.parse(readFileSync(fixtureUrl(f), 'utf8'));

/** Niveau du MVP (format 1) -> niveau v2 : émetteur et cibles en lumière blanche (`RGB`). */
export function v1ToV2(lv) {
  return {
    format: 2, id: lv.id, name: lv.name, size: lv.size,
    pieces: lv.pieces.map((p) => {
      if (p.type === 'emitter') return { type: 'emitter', at: p.at, dir: p.dir, mask: 'RGB' };
      if (p.type === 'target') return { type: 'target', at: p.at, need: 'RGB' };
      return p;
    }),
  };
}

/** Gèle un objet en profondeur (pureté des fonctions testées). */
export function deepFreeze(o) {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/** Niveau v2 minimal : émetteur blanc en (0,0) vers l'est dans un couloir, cible en (cols-1, 0), pièces mobiles données. */
export function corridor(cols, need, inventory, extra = []) {
  return {
    format: 2, id: 'couloir-test', name: 'couloir', size: [cols, 1], // 1 ligne : le garage est serré (le solveur ne vérifie pas V3)
    pieces: [
      { type: 'emitter', at: [0, 0], dir: 'E', mask: 'RGB' },
      { type: 'target', at: [cols - 1, 0], need },
      ...extra,
      ...inventory,
    ],
  };
}
