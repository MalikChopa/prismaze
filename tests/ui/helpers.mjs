// Aides des tests d'interface (ce fichier n'est pas un test : son nom ne finit pas par .test.mjs).
import { readFileSync } from 'node:fs';
import { createState } from '../../src/engine/state.js';
import { levelFromAscii } from '../engine/helpers.mjs';

export const maquette = () => createState(JSON.parse(readFileSync(new URL('../fixtures/maquette-07.v2.json', import.meta.url), 'utf8')));

/** Niveau minimal : un miroir mobile (1,1) en « \ » ; le déplacer en (1,0) allume la cible (1,3). */
export const moveToWin = () => createState(levelFromAscii(['>...', '.\\..', '....', '.T..']));

/** Géométrie fictive : cases de `cell` px, plateau à l'origine de l'écran. */
export function fakeGeometry(state, cell = 64) {
  return {
    cell,
    cellAt(x, y) {
      if (x < 0 || y < 0) return null;
      const c = Math.floor(x / cell);
      const r = Math.floor(y / cell);
      if (c >= state.cols || r >= state.rows) return null;
      return { c, r };
    },
    /** Centre de la case en pixels. */
    center(c, r) { return { x: (c + 0.5) * cell, y: (r + 0.5) * cell }; },
  };
}

/** Enregistre les appels de gestionnaires dans une liste de [nom, charge utile]. */
export function recorder() {
  const log = [];
  const rec = (name) => (arg) => { log.push([name, arg]); };
  return { log, rec, names: () => log.map((e) => e[0]) };
}
