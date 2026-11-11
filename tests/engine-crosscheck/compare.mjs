// Compare le tracé du moteur (src/engine/, via tests/engine/engine.mjs) à la référence indépendante sur un plateau.
import { buildBoard, traceBoard } from '../engine/engine.mjs';
import { bruteTrace } from './reference.mjs';

/** Renvoie {ok, res, board, br, mine} ; `mine` a la même forme que la sortie de bruteTrace. */
export function compareBoard(st) {
  const board = buildBoard(st);
  const res = traceBoard(board);
  const br = bruteTrace(st);
  const open = [];
  let g = 0;
  st.pieces.forEach((p, id) => { if (p.type === 'gate') { if (res.gates[g].open) open.push(id); g++; } });
  const used = [];
  st.pieces.forEach((p, id) => { if (res.used[id]) used.push(id); });
  const mine = { got: res.targets.map((t) => t.got), open, used, allLit: res.allLit, usedMovable: res.usedMovable };
  const ok = JSON.stringify(mine.got) === JSON.stringify(br.got) && JSON.stringify(mine.open) === JSON.stringify(br.open)
    && JSON.stringify(mine.used) === JSON.stringify(br.used) && mine.allLit === br.allLit && mine.usedMovable === br.usedMovable;
  return { ok, res, board, br, mine };
}
