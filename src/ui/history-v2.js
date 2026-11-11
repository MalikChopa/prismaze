// Historique annuler / refaire pour toutes les pièces mobiles (U5) : même contrat que history.js (MVP, conservé), mais les commandes
// passent par rotatePiece / movePiece (séparateur compris). history.js ne tourne que les miroirs : il reste pour ses propres tests.
import { rotatePiece, movePiece } from '../engine/state.js';
export { makeRotate, makeMove, makeReset } from './history.js';

/** Applique une commande à un état et renvoie le nouvel état. */
export function applyCommand(state, cmd) {
  switch (cmd.type) {
    case 'rotate': return rotatePiece(state, cmd.id, cmd.steps);
    case 'move': return movePiece(state, cmd.id, cmd.to.c, cmd.to.r);
    case 'reset': return cmd.after;
    default: throw new RangeError(`commande inconnue : ${String(cmd && cmd.type)}`);
  }
}

/** Applique l'inverse d'une commande (l'état fourni est celui obtenu juste après la commande). */
export function revertCommand(state, cmd) {
  switch (cmd.type) {
    case 'rotate': return rotatePiece(state, cmd.id, -cmd.steps);
    case 'move': return movePiece(state, cmd.id, cmd.from.c, cmd.from.r);
    case 'reset': return cmd.before;
    default: throw new RangeError(`commande inconnue : ${String(cmd && cmd.type)}`);
  }
}

/** Pile de commandes : `undo(state)` et `redo(state)` renvoient `{state, cmd}` ou `null` si la pile est vide. */
export function createHistory() {
  let undoStack = [];
  let redoStack = [];
  return {
    record(cmd) { undoStack.push(cmd); redoStack = []; },
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
    clear() { undoStack = []; redoStack = []; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get undoDepth() { return undoStack.length; },
    get redoDepth() { return redoStack.length; },
  };
}
