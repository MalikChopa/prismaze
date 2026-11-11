// E12 (a) : scénarios du plan de tests du MVP (ARCHITECTURE.md §11) sur le moteur v2, en lumière blanche. Valeurs calculées à la main.
// Les faisceaux sont lus par `segments()` (polyligne enchaînée depuis le centre de l'émetteur), `in`, `out`, `endReason` (E10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, traceBoard, stepLimit, createState, END_EDGE, END_WALL, END_EMITTER } from './engine.mjs';
import { runAscii, levelFromAscii, deepFreeze, chain, run, P } from './helpers.mjs';

const E = 0, N = 1, W = 2, S = 3;
const idx = (cols, c, r, d) => (r * cols + c) * 4 + d;
const reasons = (result) => [...result.endReason].filter((x) => x !== 0);

test('E10 : forme de la sortie', () => {
  const { result } = runAscii(['>....']);
  assert.deepEqual(Object.keys(result).sort(), [
    'allLit', 'capped', 'end', 'endReason', 'gates', 'in', 'litCount', 'order', 'orderCount', 'out', 'segments', 'steps', 'targets', 'used', 'usedMovable',
  ]);
  for (const k of ['in', 'out', 'end', 'endReason']) assert.ok(result[k] instanceof Uint8Array && result[k].length === 5 * 4, k);
  assert.ok(result.order instanceof Int16Array);
  assert.equal(typeof result.segments, 'function');
  const seg = result.segments();
  assert.deepEqual(Object.keys(seg).sort(), ['count', 'mask', 'x0', 'x1', 'y0', 'y1']);
  assert.ok(seg.x0 instanceof Float32Array && seg.mask instanceof Uint8Array);
  const t = runAscii(['>T']).result.targets[0];
  assert.deepEqual(Object.keys(t).sort(), ['cell', 'got', 'lit', 'need', 'reached']);
});

test('plateau vide : le faisceau traverse toute la ligne et sort par la droite (R10)', () => {
  const { result } = runAscii(['.....', '>....', '.....']);
  assert.deepEqual(chain(result, 0.5, 1.5), [0.5, 1.5, 5, 1.5]);
  assert.equal(result.steps, 4);
  assert.deepEqual(reasons(result), [END_EDGE]);
  assert.equal(result.endReason[idx(5, 4, 1, E)], END_EDGE);
  assert.equal(result.end[idx(5, 4, 1, E)], 7);
  assert.deepEqual(result.targets, []);
  assert.equal(result.litCount, 0);
  assert.equal(result.allLit, false, 'E8 : au moins une cible est exigée');
  assert.equal(result.usedMovable, 0);
  assert.equal(result.capped, false);
});

test('R10 : sortie par les 4 bords, point final exact', () => {
  const cases = [
    { map: ['.....', '.....', '>....', '.....', '.....'], start: [0.5, 2.5], points: [0.5, 2.5, 5, 2.5], steps: 4, at: [4, 2, E] },
    { map: ['.....', '.....', '....<', '.....', '.....'], start: [4.5, 2.5], points: [4.5, 2.5, 0, 2.5], steps: 4, at: [0, 2, W] },
    { map: ['.....', '.....', '.....', '.....', '..^..'], start: [2.5, 4.5], points: [2.5, 4.5, 2.5, 0], steps: 4, at: [2, 0, N] },
    { map: ['..v..', '.....', '.....', '.....', '.....'], start: [2.5, 0.5], points: [2.5, 0.5, 2.5, 5], steps: 4, at: [2, 4, S] },
  ];
  for (const k of cases) {
    const { result } = runAscii(k.map);
    assert.deepEqual(chain(result, ...k.start), k.points);
    assert.equal(result.steps, k.steps);
    assert.equal(result.endReason[idx(5, ...k.at)], END_EDGE);
  }
});

test('R10 : émetteur sur le bord, tourné vers l\'extérieur : 0 pas, sort aussitôt', () => {
  const { result } = runAscii(['<....', '.....', '.....']);
  assert.equal(result.steps, 0);
  assert.deepEqual(chain(result, 0.5, 0.5), [0.5, 0.5, 0, 0.5]);
  assert.equal(result.endReason[idx(5, 0, 0, W)], END_EDGE);
  assert.equal(result.orderCount, 0);
});

test('R8 : mur dans les 4 directions, arrêt exact au bord commun', () => {
  const cases = [
    { map: ['.....', '.....', '>..#.', '.....', '.....'], start: [0.5, 2.5], points: [0.5, 2.5, 3, 2.5], at: [2, 2, E], steps: 2 },
    { map: ['.....', '.....', '.#..<', '.....', '.....'], start: [4.5, 2.5], points: [4.5, 2.5, 2, 2.5], at: [2, 2, W], steps: 2 },
    { map: ['.....', '..#..', '.....', '.....', '..^..'], start: [2.5, 4.5], points: [2.5, 4.5, 2.5, 2], at: [2, 2, N], steps: 2 },
    { map: ['..v..', '.....', '.....', '..#..', '.....'], start: [2.5, 0.5], points: [2.5, 0.5, 2.5, 3], at: [2, 2, S], steps: 2 },
  ];
  for (const k of cases) {
    const { result } = runAscii(k.map);
    assert.deepEqual(chain(result, ...k.start), k.points);
    assert.equal(result.endReason[idx(5, ...k.at)], END_WALL);
    assert.equal(result.steps, k.steps);
  }
});

test('R8 : émetteur collé à un mur : 0 pas, arrêt au bord de sa propre case', () => {
  const { result } = runAscii(['>#...']);
  assert.equal(result.steps, 0);
  assert.deepEqual(chain(result, 0.5, 0.5), [0.5, 0.5, 1, 0.5]);
  assert.equal(result.endReason[idx(5, 0, 0, E)], END_WALL);
});

test('R7 : une cible est traversée sans déviation depuis les 4 directions et s\'allume', () => {
  const maps = {
    [E]: ['.....', '.....', '>.T..', '.....', '.....'],
    [W]: ['.....', '.....', '..T.<', '.....', '.....'],
    [N]: ['.....', '.....', '..T..', '.....', '..^..'],
    [S]: ['..v..', '.....', '..T..', '.....', '.....'],
  };
  for (const d of [E, N, W, S]) {
    const { result } = runAscii(maps[d]);
    assert.deepEqual(result.targets.map((t) => t.lit), [true]);
    assert.equal(result.litCount, 1);
    assert.equal(result.allLit, true);
    const cell = 2 * 5 + 2;
    assert.equal(result.in[cell * 4 + d], 7);
    assert.equal(result.out[cell * 4 + d], 7, 'aucune déviation : la lumière continue');
    assert.deepEqual(reasons(result), [END_EDGE], 'le faisceau continue après la cible');
    assert.equal(result.segments().count, 1, 'une seule série droite : aucun sommet sur la cible');
    assert.equal(result.usedMovable, 0);
  }
});

test('R7 : deux cibles alignées sont allumées toutes les deux ; lit suit l\'ordre des cibles dans les pièces', () => {
  const a = runAscii(['>.TT.']).result;
  assert.deepEqual(a.targets.map((t) => t.lit), [true, true]);
  assert.equal(a.allLit, true);
  const b = runAscii(['T.>.T']).result; // cible 0 en (0,0) hors tracé, cible 1 en (4,0) allumée
  assert.deepEqual(b.targets.map((t) => t.lit), [false, true]);
  assert.equal(b.litCount, 1);
  assert.equal(b.allLit, false);
});

test('R6 : miroir parallèle traversé sans sommet et sans déviation', () => {
  const h = runAscii(['>.-..']);
  assert.deepEqual(chain(h.result, 0.5, 0.5), [0.5, 0.5, 5, 0.5]);
  assert.equal(h.result.usedMovable, 0);
  const v = runAscii(['.....', '..|..', '..^..']);
  assert.deepEqual(chain(v.result, 2.5, 2.5), [2.5, 2.5, 2.5, 0]);
  assert.equal(v.result.usedMovable, 0);
});

test('R6 : miroir de face -> retour avec sommet, puis arrêt sur l\'émetteur opaque (R9)', () => {
  const { result } = runAscii(['>.|..', '.....', '.....']);
  assert.deepEqual(chain(result, 0.5, 0.5), [0.5, 0.5, 2.5, 0.5, 1, 0.5]);
  assert.equal(result.steps, 3); // (1,0), (2,0), (1,0)
  assert.equal(result.endReason[idx(5, 1, 0, W)], END_EMITTER);
  assert.equal(result.in[idx(5, 1, 0, E)], 7);
  assert.equal(result.in[idx(5, 2, 0, E)], 7);
  assert.equal(result.in[idx(5, 1, 0, W)], 7);
  assert.equal(result.usedMovable, 1, 'le retour de face compte comme déviation (E8)');
});

test('R9 : l\'émetteur est opaque, même quand le faisceau arrive par le côté', () => {
  const { result } = runAscii(['.....', '.>.\\.', '.....', '.\\./.']);
  // (1,1) E -> (3,1) \ -> S -> (3,3) / -> W -> (1,3) \ -> N -> (1,2) puis l'émetteur (1,1)
  assert.deepEqual(chain(result, 1.5, 1.5), [1.5, 1.5, 3.5, 1.5, 3.5, 3.5, 1.5, 3.5, 1.5, 2]);
  assert.equal(result.steps, 7);
  assert.equal(result.endReason[idx(5, 1, 2, N)], END_EMITTER);
});

test('faisceau qui se croise : deux directions dans une case ne se mélangent pas (E3)', () => {
  const { result } = runAscii(['.....', '>..\\.', '.....', '.\\./.', '.....']);
  assert.deepEqual(chain(result, 0.5, 1.5), [0.5, 1.5, 3.5, 1.5, 3.5, 3.5, 1.5, 3.5, 1.5, 0]);
  assert.equal(result.steps, 10);
  assert.equal(result.endReason[idx(5, 1, 0, N)], END_EDGE);
  assert.equal(result.in[idx(5, 1, 1, E)], 7, 'la case (1,1) est traversée vers l\'E...');
  assert.equal(result.in[idx(5, 1, 1, N)], 7, '...puis vers le N, dans une autre direction');
  assert.equal(result.in[idx(5, 1, 1, W)] | result.in[idx(5, 1, 1, S)], 0);
});

test('E8 : un miroir touché deux fois compte pour un ; les miroirs fixes ne comptent pas', () => {
  const map = ['......', './\\...', '......', '>./.\\.', '.\\../.', '......'];
  const a = runAscii(map);
  assert.equal(a.result.steps, 16);
  assert.equal(a.result.endReason[idx(6, 2, 5, S)], END_EDGE);
  assert.equal(a.result.usedMovable, 6);
  assert.deepEqual([...a.result.used].map((u, id) => (u ? id : -1)).filter((x) => x >= 0), [0, 1, 3, 4, 5, 6]);
  assert.equal(a.result.in[idx(6, 2, 3, E)], 7, 'M est touché par l\'ouest...');
  assert.equal(a.result.in[idx(6, 2, 3, W)], 7, '...et par l\'est');
  const fixedMap = map.slice();
  fixedMap[3] = '>.b.\\.';
  const b = runAscii(fixedMap);
  assert.equal([...b.result.used].filter(Boolean).length, 6, '6 miroirs utilisés');
  assert.equal(b.result.usedMovable, 5, 'dont 5 mobiles');
});

test('E5 : un cycle de lumière converge (anneau de 4 miroirs alimenté par un séparateur) : état légal, pas de boucle infinie', () => {
  // émetteur (0,1) -> séparateur '/' en (1,1) : une branche sort au N (bord), l'autre fait le tour de l'anneau (1,1)-(4,1)-(4,3)-(1,3)
  const { result, board } = run(6, 5, [
    P.emitter(0, 1, E), P.splitter(1, 1, 1), P.mirror(4, 1, 3), P.mirror(4, 3, 1), P.mirror(1, 3, 3),
  ]);
  assert.equal(result.capped, false);
  assert.equal(result.in[idx(6, 4, 1, E)], 7);
  assert.equal(result.in[idx(6, 4, 3, S)], 7);
  assert.equal(result.in[idx(6, 1, 3, W)], 7);
  assert.equal(result.in[idx(6, 1, 1, N)], 7, 'la lumière revient dans le séparateur par le sud');
  assert.ok(result.steps <= 12 * board.n);
  assert.deepEqual(reasons(result), [END_EDGE], 'seule la branche nord sort');
});

test('E7 : plafond de pas : stepLimit = 12·cases + 16 ; un plafond minuscule donne capped et jamais de victoire', () => {
  const ring = runAscii(['......', './..\\.', '......', '......', '.\\../.', '.....<']);
  assert.equal(stepLimit(ring.board), 12 * 36 + 16);
  const big = buildBoard(createState(levelFromAscii(['>' + '.'.repeat(15), ...Array(11).fill('.'.repeat(16))])));
  assert.equal(stepLimit(big), 12 * 192 + 16);
  const win = buildBoard(createState(levelFromAscii(['>.T..'])));
  assert.equal(traceBoard(win).allLit, true);
  const r = traceBoard(win, 1);
  assert.equal(r.capped, true);
  assert.equal(r.steps, 1);
  assert.equal(r.allLit, false, 'jamais de victoire quand le plafond est atteint');
  assert.equal(traceBoard(win, 0).steps, 0);
  assert.equal(traceBoard(win, 0).capped, true);
  const again = traceBoard(win);
  assert.equal(again.capped, false, 'le tracé suivant repart de zéro');
  assert.equal(again.allLit, true);
});

test('E7 : steps ≤ 12·cases sur un plateau 50 pièces 16x12 conforme à la valeur calculée à la main', () => {
  // Émetteur (0,0) vers l'E ; 47 murs remplissent la fin de la ligne 1 puis les lignes 2 à 4 ; une cible en (15,0).
  const rows = Array.from({ length: 12 }, () => '.'.repeat(16).split(''));
  rows[0][0] = '>';
  rows[0][15] = 'T';
  let placed = 2;
  for (let r = 1; placed < 49 && r < 12; r++) for (let c = 0; placed < 49 && c < 16; c++) { rows[r][c] = '#'; placed++; }
  rows[11][15] = '/'; // 50e pièce, hors du chemin
  const { state, result } = runAscii(rows.map((x) => x.join('')));
  assert.equal(state.pieces.length, 50);
  assert.equal(result.steps, 15);
  assert.equal(result.allLit, true);
  assert.deepEqual(chain(result, 0.5, 0.5), [0.5, 0.5, 16, 0.5]);
  assert.ok(result.steps <= 12 * 16 * 12);
});

test('E10 : l\'entrée n\'est pas modifiée (état gelé en profondeur), sortie déterministe, objet et tableaux réutilisés', () => {
  const state = deepFreeze(createState(levelFromAscii(['>./.', '....', '..T.', '....'])));
  const board = buildBoard(state);
  const snap = (b) => JSON.stringify([...b.kind, ...b.pid, ...b.orient, ...b.aux, ...b.need, b.emitters, b.targetCells]);
  const before = snap(board);
  const dump = (r) => JSON.stringify({ i: [...r.in], o: [...r.out], e: [...r.end], er: [...r.endReason], t: r.targets, g: r.gates, u: [...r.used], m: r.usedMovable, s: r.steps, l: r.litCount, a: r.allLit, c: r.capped, ord: [...r.order.slice(0, r.orderCount)], seg: Array.from({ length: r.segments().count }, (_, k) => [r.segments().x0[k], r.segments().y1[k], r.segments().mask[k]]) });
  const r1 = traceBoard(board);
  const d1 = dump(r1);
  const r2 = traceBoard(board);
  assert.equal(r1, r2, 'même objet : valable jusqu\'au tracé suivant');
  assert.equal(r2.in, board.inM, 'mêmes tableaux typés, pas de nouvelle allocation');
  assert.equal(dump(r2), d1);
  assert.equal(dump(traceBoard(buildBoard(state))), d1, 'un plateau neuf donne le même résultat');
  assert.equal(snap(board), before, 'le plateau n\'est pas modifié par le tracé');
  for (let i = 0; i < 200; i++) assert.equal(dump(traceBoard(board)), d1);
});
