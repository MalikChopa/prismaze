// Point d'entrée UNIQUE du moteur pour les tests du moteur (ce fichier n'est pas un test).
// Par défaut : src/engine/. Variable d'environnement PRISMAZE_ENGINE_DIR : un autre dossier contenant la même
// arborescence (copie mutée, voir tests/engine/mutants/run-mutants.mjs).
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const dir = process.env.PRISMAZE_ENGINE_DIR;
const base = dir ? pathToFileURL(resolve(dir) + '/') : new URL('../../src/engine/', import.meta.url);
const load = (f) => import(new URL(f, base).href);

const [board, trace, state, dirs, colors] = await Promise.all([load('board.js'), load('trace.js'), load('state.js'), load('dirs.js'), load('colors.js')]);

export const ENGINE_DIR = base.href;
export const { buildBoard, createBoard, setCell, clearCell, finalize, EMPTY, WALL, TARGET, MIRROR, EMITTER, SPLITTER, PRISM, FILTER, PORTAL, GATE, isAlwaysFixed } = board;
export const { trace: traceBoard, stepLimit, END_NONE, END_EDGE, END_WALL, END_EMITTER, END_GATE } = trace;
export const { createState, rotatePiece, rotateMirror, unrotateMirror, rotateAt, movePiece, moveMirror, pieceAt, getPiece, isMovable, isRotatable, isMovableMirror, movableIds, movableMirrorIds } = state;
export const { DX, DY, reflect } = dirs;
export const { R, G, B, WHITE, maskFromLetters, maskToLetters, COLOR_NAMES, COLOR_SYMBOLS, COLOR_HUES } = colors;
