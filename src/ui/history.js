// Historique annuler / refaire (ARCHITECTURE.md §8). Module pur : aucune dépendance au navigateur.
// Une étape = une commande : `rotate` (un cran, +1 ou -1), `move` (un miroir vers une case libre)
// ou `reset` (recommencer, avec une copie de l'état avant et après : P8, annulable).
// Deux rotations successives du même miroir restent deux étapes séparées.
// Une nouvelle commande vide la pile « refaire ». La pile n'a pas de limite.
import { rotateMirror, moveMirror } from '../engine/state.js';

/** Commande de rotation d'un cran (steps = +1 : sens de R4 ; -1 : sens inverse). */
export function makeRotate(id, steps = 1) {
  return Object.freeze({ type: 'rotate', id, steps: steps < 0 ? -1 : 1 });
}

/** Commande de déplacement d'un miroir mobile de `from` vers `to` (cases {c, r}). */
export function makeMove(id, from, to) {
  return Object.freeze({
    type: 'move', id,
    from: Object.freeze({ c: from.c, r: from.r }),
    to: Object.freeze({ c: to.c, r: to.r }),
  });
}

/** Commande « recommencer » : `before` et `after` sont des états du moteur (immuables, donc partageables). */
export function makeReset(before, after) {
  return Object.freeze({ type: 'reset', before, after });
}

/** Applique une commande à un état et renvoie le nouvel état. */
export function applyCommand(state, cmd) {
  switch (cmd.type) {
    case 'rotate': return rotateMirror(state, cmd.id, cmd.steps);
    case 'move': return moveMirror(state, cmd.id, cmd.to.c, cmd.to.r);
    case 'reset': return cmd.after;
    default: throw new RangeError(`commande inconnue : ${String(cmd && cmd.type)}`);
  }
}

/** Applique l'inverse d'une commande (l'état fourni est celui obtenu juste après la commande). */
export function revertCommand(state, cmd) {
  switch (cmd.type) {
    case 'rotate': return rotateMirror(state, cmd.id, -cmd.steps);
    case 'move': return moveMirror(state, cmd.id, cmd.from.c, cmd.from.r);
    case 'reset': return cmd.before;
    default: throw new RangeError(`commande inconnue : ${String(cmd && cmd.type)}`);
  }
}

/**
 * Pile de commandes annuler / refaire.
 * `undo(state)` et `redo(state)` renvoient `{state, cmd}` (nouvel état, commande concernée) ou `null` si la pile est vide.
 */
export function createHistory() {
  /** @type {object[]} */ let undoStack = [];
  /** @type {object[]} */ let redoStack = [];
  return {
    /** Enregistre une commande déjà appliquée par l'appelant ; vide la pile « refaire ». */
    record(cmd) {
      undoStack.push(cmd);
      redoStack = [];
    },
    undo(state) {
      const cmd = undoStack.pop();
      if (cmd === undefined) return null;
      redoStack.push(cmd);
      return { state: revertCommand(state, cmd), cmd };
    },
    redo(state) {
      const cmd = redoStack.pop();
      if (cmd === undefined) return null;
      undoStack.push(cmd);
      return { state: applyCommand(state, cmd), cmd };
    },
    /** Vide les deux piles (changement de niveau). */
    clear() {
      undoStack = [];
      redoStack = [];
    },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get undoDepth() { return undoStack.length; },
    get redoDepth() { return redoStack.length; },
  };
}
