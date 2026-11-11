// Indice v2 (ARCHITECTURE_V2 S7) : choix du témoin, précédence des actions, pièces spéciales, cas limites, garantie « 2·K indices ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, rotatePiece, movePiece, pieceAt, isMovable } from '../../src/engine/state.js';
import { buildBoard } from '../../src/engine/board.js';
import { trace } from '../../src/engine/trace.js';
import { solve } from '../../src/engine/solver.js';
import { computeHint, applyHint, hintMessage, createHinter, HINT_NONE, HINT_MAX_NODES } from '../../src/engine/hint.js';
import { levelFromAscii, rng } from '../engine/helpers.mjs';
import { readFixture, deepFreeze } from './helpers.mjs';
import { mulberry, plantedLevel } from './generate.mjs';
import { toJson } from './brute.mjs';

const maquette = () => readFixture('maquette-07.v2.json');
const won = (state) => trace(buildBoard(state)).allLit;

test('maquette, état initial : tourner (7,1) vers « \\ » (R4 : deux crans de « / » à « \\ »)', () => {
  const lv = maquette();
  const state = createState(lv);
  const { hint, reason } = createHinter(lv).next(state);
  assert.equal(reason, null);
  assert.equal(hint.action, 'rotate');
  assert.equal(hint.type, 'mirror');
  assert.deepEqual(hint.from, [7, 1]);
  assert.deepEqual(hint.at, [7, 1]);
  assert.equal(hint.o, '\\');
  assert.equal(hint.steps, 2);
  assert.equal(hint.pieceId, 11);
  assert.equal(hint.distance, 1);
  assert.equal(won(applyHint(state, hint)), true);
});

test('plateau déjà gagné : aucun indice (computeHint, createHinter)', () => {
  const lv = maquette();
  const solved = rotatePiece(createState(lv), 11, 2);
  assert.equal(won(solved), true);
  assert.deepEqual(createHinter(lv).next(solved), { hint: null, reason: 'won' });
  assert.equal(computeHint(solved, solve(lv, { countAll: true }).solutions.map((s) => s.witness)), null);
});

test('gagné par une autre solution minimale : toujours aucun indice', () => {
  const lv = maquette();
  let s = createState(lv);
  s = movePiece(s, 9, 4, 3);
  s = movePiece(s, 10, 4, 1);
  s = rotatePiece(s, 11, 2);
  assert.equal(won(s), true);
  assert.equal(createHinter(lv).next(s).hint, null);
});

test('sans témoin : aucun indice ; niveau insoluble ou plafond de nœuds : « indisponible »', () => {
  const lv = maquette();
  assert.equal(computeHint(createState(lv), []), null);
  const hopeless = levelFromAscii(['>#.', '.-.', '..T']);
  assert.deepEqual(createHinter(hopeless).next(createState(hopeless)), { hint: null, reason: 'unavailable' });
  assert.deepEqual(createHinter(lv, { maxNodes: 5 }).next(createState(lv)), { hint: null, reason: 'unavailable' });
  assert.ok(HINT_NONE.won && HINT_NONE.unavailable);
  assert.equal(HINT_MAX_NODES, 600000);
});

test('niveau livré : les témoins du fichier (`solutions`) sont lus tels quels, aucun solveur', () => {
  const lv = { ...maquette(), par: 3, solutions: [[{ type: 'mirror', at: [3, 3], o: '/' }, { type: 'mirror', at: [3, 1], o: '/' }, { type: 'mirror', at: [7, 1], o: '\\' }]] };
  const hinter = createHinter(lv, { maxNodes: 1 }); // un solveur à 1 nœud échouerait : il n'est pas appelé
  const r = hinter.next(createState(lv));
  assert.equal(r.hint.action, 'rotate');
  assert.equal(hinter.solutions, lv.solutions);
});

test('niveau partagé : témoins calculés au premier appel, une seule fois, entrée gelée non modifiée', () => {
  const lv = deepFreeze(maquette());
  const hinter = createHinter(lv);
  assert.equal(hinter.solutions, null);
  const state = createState(lv);
  const a = hinter.next(state);
  const sols = hinter.solutions;
  assert.equal(sols.length, 4);
  assert.equal(hinter.solutions, sols);
  assert.deepEqual(hinter.next(state), a);
});

// Niveau 5x4 : émetteur (0,0) vers l'est, cible (2,2), deux miroirs mobiles A (3,0) « / » et B (2,1) « | ».
// Une seule solution minimale : « \ » en (2,0).
const spareLevel = () => levelFromAscii(['>../.', '..|..', '..T..', '.....']);

test('pièce source du déplacement : une pièce qui gêne passe avant une pièce hors chemin, même à égalité de distance', () => {
  const lv = spareLevel();
  const state = createState(lv);
  const A = pieceAt(state, 3, 0);
  const B = pieceAt(state, 2, 1);
  assert.ok(A.id < B.id, 'A a le plus petit identifiant : sans la règle « gêne », il serait choisi');
  const r = createHinter(lv).next(state);
  assert.equal(r.hint.action, 'move');
  assert.equal(r.hint.pieceId, B.id);
  assert.deepEqual(r.hint.from, [2, 1]);
  assert.deepEqual(r.hint.at, [2, 0]);
  assert.equal(r.hint.o, '\\');
  assert.equal(won(applyHint(state, r.hint)), true);
});

test('pièce source : à égalité de « gêne », la plus proche', () => {
  const lv = levelFromAscii(['>....', '.....', '..T..', '.../-']);
  const state = createState(lv);
  const h = createHinter(lv).next(state).hint;
  assert.deepEqual(h.from, [3, 3]); // distance 1 + 3 = 4 < 5
});

test('le témoin le plus proche gagne : la distance (placements insatisfaits) prime, à égalité l\'ordre donné', () => {
  const lv = levelFromAscii(['>....', '.....', '..T..', '...-/']);
  const state = createState(lv);
  const close = [{ type: 'mirror', at: [3, 3], o: '-' }, { type: 'mirror', at: [2, 0], o: '\\' }]; // (3,3) est déjà bon : distance 1
  const away = [{ type: 'mirror', at: [1, 0], o: '\\' }, { type: 'mirror', at: [2, 0], o: '\\' }]; // distance 2
  const h = computeHint(state, [away, close]);
  assert.equal(h.solution, 1);
  assert.equal(h.distance, 1);
  const A = [{ type: 'mirror', at: [2, 0], o: '\\' }];
  const B = [{ type: 'mirror', at: [1, 0], o: '\\' }];
  assert.equal(computeHint(state, [A, B]).at[0], 2, 'ordre donné à distance égale');
  assert.equal(computeHint(state, [B, A]).at[0], 1);
});

test('ranger une pièce en trop : tous les placements sont satisfaits, un miroir en trop dévie -> garé là où il est transparent, le plus proche', () => {
  const lv = spareLevel();
  let s = createState(lv);
  const B = pieceAt(s, 2, 1);
  const A = pieceAt(s, 3, 0);
  s = movePiece(s, A.id, 2, 0);
  s = rotatePiece(s, A.id, 2); // « / » -> « \ »
  s = rotatePiece(s, B.id, 3); // « | » -> « / » : dévie le faisceau qui descend
  assert.equal(won(s), false);
  const h = computeHint(s, [[{ type: 'mirror', at: [2, 0], o: '\\' }]]);
  assert.equal(h.action, 'park');
  assert.equal(h.pieceId, B.id);
  assert.deepEqual(h.from, [2, 1]);
  assert.equal(h.distance, 0);
  assert.equal(won(applyHint(s, h)), true);
});

test('une pièce d\'une autre classe bloque la case d\'un placement : on la range d\'abord (action park), puis on pose', () => {
  // émetteur blanc vers l'est ; cible verte en bout ; un prisme doit aller en (2,0) mais un miroir mobile l'occupe
  const lv = { format: 2, id: 'bloque', name: 'x', size: [5, 3], pieces: [
    { type: 'emitter', at: [0, 0], dir: 'E', mask: 'RGB' }, { type: 'target', at: [4, 0], need: 'G' },
    { type: 'mirror', at: [2, 0], o: '-' }, { type: 'prism', at: [0, 2] }] };
  let state = createState(lv);
  const witness = [[{ type: 'prism', at: [2, 0] }]];
  const h1 = computeHint(state, witness);
  assert.equal(h1.action, 'park', 'le miroir en (2,0) bloque la case du prisme');
  assert.equal(h1.type, 'mirror');
  assert.deepEqual(h1.from, [2, 0]);
  state = applyHint(state, h1);
  assert.equal(pieceAt(state, 2, 0), undefined, 'la case est libérée');
  const h2 = computeHint(state, witness);
  assert.equal(h2.action, 'move');
  assert.equal(h2.type, 'prism');
  assert.deepEqual(h2.at, [2, 0]);
  state = applyHint(state, h2);
  assert.equal(won(state), true, 'le miroir rangé est transparent là où il est');
});

test('filtre et prisme : « déplacer » sans orientation (o null, 0 cran) ; phrases avec le nom de la couleur du filtre', () => {
  const lv = { format: 2, id: 'filtre', name: 'x', size: [5, 3], pieces: [
    { type: 'emitter', at: [0, 0], dir: 'E', mask: 'RGB' }, { type: 'target', at: [4, 0], need: 'RG' },
    { type: 'filter', at: [3, 2], mask: 'RG' }] };
  const state = createState(lv);
  const hinter = createHinter(lv);
  const { hint } = hinter.next(state);
  assert.equal(hint.action, 'move');
  assert.equal(hint.type, 'filter');
  assert.equal(hint.mask, 3);
  assert.equal(hint.o, null);
  assert.equal(hint.steps, 0);
  assert.match(hintMessage(hint), /^Indice : déplacer le filtre jaune de colonne 4, ligne 3 vers colonne \d, ligne 1$/);
  assert.equal(won(applyHint(state, hint)), true);
});

test('hintMessage : tourner, déplacer, ranger (avec le nom de case de l\'interface)', () => {
  const base = { pieceId: 1, type: 'mirror', mask: 0, solution: 0, distance: 1 };
  const rot = { ...base, action: 'rotate', from: [7, 1], at: [7, 1], o: '\\', steps: 2 };
  assert.match(hintMessage(rot), /^Indice : tourner le miroir de colonne 8, ligne 2 en oblique descendante \\$/);
  const mv = { ...base, action: 'move', from: [2, 1], at: [4, 0], o: '/', steps: 1 };
  assert.match(hintMessage(mv, (c) => `C${c + 1}`), /^Indice : déplacer le miroir de C3 vers C5, orientation oblique montante \/$/);
  const pk = { ...base, type: 'splitter', action: 'park', from: [2, 1], at: [1, 1], o: '/', steps: 0 };
  assert.match(hintMessage(pk), /ranger le séparateur/);
  assert.match(hintMessage({ ...pk, at: [2, 1] }), /tourner le séparateur/);
  assert.match(hintMessage({ ...base, type: 'prism', action: 'park', from: [2, 1], at: [1, 1], o: null, steps: 0 }), /ranger le prisme/);
});

// ---- Garantie : on gagne en au plus 2·K indices, chaque action appliquée en entier ----

/** États atteignables par des commandes au hasard (rotations et déplacements vers des cases quelconques). */
function randomStates(level, count, seed) {
  const R = rng(seed);
  const states = [];
  for (let n = 0; n < count; n++) {
    let s = createState(level);
    const steps = 1 + Math.floor(R() * 25);
    for (let i = 0; i < steps; i++) {
      const ids = s.pieces.filter(isMovable).map((p) => p.id);
      const id = ids[Math.floor(R() * ids.length)];
      if (R() < 0.5) s = rotatePiece(s, id, 1 + Math.floor(R() * 3));
      else s = movePiece(s, id, Math.floor(R() * s.cols), Math.floor(R() * s.rows));
    }
    states.push(s);
  }
  return states;
}

function followHints(hinter, state, limit) {
  let n = 0;
  let s = state;
  while (!won(s)) {
    const { hint } = hinter.next(s);
    assert.ok(hint, `pas d'indice alors que le plateau n'est pas gagné (après ${n} indices)`);
    const next = applyHint(s, hint);
    assert.notEqual(next, s, `l'indice ne change rien : ${JSON.stringify(hint)}`);
    s = next;
    n++;
    assert.ok(n <= limit, `plus de ${limit} indices`);
  }
  return n;
}

test('garantie sur la maquette : depuis l\'état initial et 100 états atteignables au hasard, victoire en au plus 2·K = 6 indices', () => {
  const lv = maquette();
  const hinter = createHinter(lv);
  assert.ok(followHints(hinter, createState(lv), 6) <= 6);
  let worst = 0;
  for (const s of randomStates(lv, 100, 20261107)) { if (!won(s)) worst = Math.max(worst, followHints(hinter, s, 6)); }
  assert.ok(worst >= 1);
});

test('garantie sur 120 petits niveaux plantés (4 types, portes, portails, garage serré) : 8 états chacun, au plus 2·K indices', (t) => {
  const rnd = mulberry(4242);
  const fams = [
    { types: ['mirror', 'splitter', 'prism', 'filter'], hard: true, portalPct: 30, gatePct: 40, maxK: 3, cols: 5, rows: 4 },
    { types: ['mirror', 'prism', 'filter', 'splitter'], hard: true, tight: true, maxK: 3 },
  ];
  let levels = 0, states = 0, worstRatio = 0;
  for (let guard = 0; levels < 120 && guard < 5000; guard++) {
    const pl = plantedLevel(rnd, fams[levels % 2]);
    if (pl === null) continue;
    const L = pl.level;
    const mov = L.pieces.filter(isMovable);
    if (L.cols * L.rows - (L.pieces.length - mov.length) < mov.length + 1) continue; // V9 : au moins K + 1 cases sans pièce fixe
    const json = toJson(L, `hg-${guard}`);
    const r = solve(json);
    if (r.status !== 'proved-optimal' || r.minimum < 1) continue;
    levels++;
    const hinter = createHinter(json);
    const K = mov.length;
    for (const s of randomStates(json, 8, guard)) {
      if (won(s)) continue;
      worstRatio = Math.max(worstRatio, followHints(hinter, s, 2 * K) / K);
      states++;
    }
  }
  t.diagnostic(`${levels} niveaux, ${states} états, pire rapport indices / K : ${worstRatio.toFixed(2)}`);
  assert.equal(levels, 120);
  assert.ok(states >= 600);
  assert.ok(worstRatio <= 2);
});
