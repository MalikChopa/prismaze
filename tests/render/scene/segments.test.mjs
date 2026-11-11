// Post-traitement des tronçons (V3-7 coupures, V3-8 / V3-37 voies, V3-9 tampon) : 50 niveaux rejoués avec le vrai moteur, 20 000 plateaux aléatoires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../../../src/engine/state.js';
import { EMPTY, FILTER, GATE } from '../../../src/engine/board.js';
import { CUT_HALF, CUT_FADE, LANE_BEVEL, laneOffset, segmentCapacity, classifyCell, kindsOfState } from '../../../src/render/scene/segments.js';
import { shippedBoards, process, randomBoards } from './_helpers.mjs';

const cellName = (id, cols, c) => `${id}(${c % cols},${(c / cols) | 0})`;

test('V3-7 : 50 niveaux (1re solution, vrai moteur) : EXACTEMENT les 3 coupes p09 (7,6), x10 (4,6), s10 (6,1)', () => {
  const boards = shippedBoards();
  assert.equal(boards.length, 50);
  const cut = [];
  for (const { id, state } of boards) {
    const { post } = process(state);
    assert.equal(post.overflow, 0, id);
    for (let q = 0; q < post.cutCount; q++) cut.push(cellName(id, state.cols, post.cuts[q]));
  }
  assert.deepEqual(cut.sort(), ['p09(7,6)', 's10(6,1)', 'x10(4,6)']);
});

test('V3-7 : sur les 89 solutions, les mêmes 3 niveaux seulement', () => {
  const boards = shippedBoards({ all: true });
  assert.equal(boards.length, 89);
  const levels = new Set();
  for (const { id, state } of boards) { const { post } = process(state); if (post.cutCount > 0) levels.add(id); }
  assert.deepEqual([...levels].sort(), ['p09', 's10', 'x10']);
});

test('V3-9 / V3-37 : 50 niveaux : jamais de dépassement du tampon, voies dans c02, c07, c10 seulement', () => {
  const lanes = {};
  for (const { id, state } of shippedBoards()) {
    const { post } = process(state);
    assert.ok(post.out.count <= segmentCapacity(state.cols, state.rows), id);
    if (post.laneCount > 0) lanes[id] = post.laneCount;
  }
  assert.deepEqual(Object.keys(lanes).sort(), ['c02', 'c07', 'c10']);
});

test('V3-7 : 20 000 plateaux aléatoires (graine 12345) : 0 coupe sur une pièce ; seules cases vides, filtres, portes ; chiffres du document', () => {
  const cnt = { boards: 0, empty: 0, filter: 0, gate: 0, onPiece: 0, cutAndOpposite: 0, overflow: 0 };
  for (const state of randomBoards(20000)) {
    const { b, res, post } = process(state);
    cnt.boards++; cnt.overflow += post.overflow;
    for (let q = 0; q < post.cutCount; q++) {
      const c = post.cuts[q], k = b.kind[c];
      if (k === EMPTY) cnt.empty++; else if (k === FILTER) cnt.filter++; else if (k === GATE) cnt.gate++; else cnt.onPiece++;
      const I = (d) => res.in[c * 4 + d];
      if ((I(0) && I(2) && I(0) !== I(2)) || (I(1) && I(3) && I(1) !== I(3))) cnt.cutAndOpposite++;
    }
  }
  assert.equal(cnt.onPiece, 0, 'aucune coupe sur miroir, prisme, séparateur, portail, émetteur, cible');
  assert.equal(cnt.overflow, 0, 'V3-9 : aucun tronçon perdu');
  assert.equal(cnt.gate, 0);
  // document V3-7 : « 1 008 cases vides + 3 filtres coupés » ; V3-37 : « coupe et contre-sens dans la même case : 4 »
  assert.equal(cnt.empty, 1008, JSON.stringify(cnt));
  assert.equal(cnt.filter, 3, JSON.stringify(cnt));
  assert.equal(cnt.cutAndOpposite, 4, JSON.stringify(cnt));
});

// Géométrie : la lumière n'est coupée QUE sur les cases coupées ; ailleurs, chaque tronçon brut reste couvert au centre des cases (±0,18) ;
// dans une case coupée, plus aucun tronçon horizontal ne couvre la coupure, et l'axe vertical garde son tracé.
function coverage(post, axis, line, centre, half) {
  // longueur couverte de [centre − half, centre + half] par les tronçons de cet axe sur la rangée/colonne `line` (±0,5)
  const iv = [];
  const o = post.out;
  for (let i = 0; i < o.count; i++) {
    if (o.axis[i] !== axis) continue;
    const l0 = axis === 0 ? o.y0[i] : o.x0[i], l1 = axis === 0 ? o.y1[i] : o.x1[i];
    if (Math.abs(l0 - line) > 0.5 || Math.abs(l1 - line) > 0.5) continue;
    const a = axis === 0 ? o.x0[i] : o.y0[i], b = axis === 0 ? o.x1[i] : o.y1[i];
    const lo = Math.max(centre - half, Math.min(a, b)), hi = Math.min(centre + half, Math.max(a, b));
    if (hi > lo) iv.push([lo, hi]);
  }
  iv.sort((p, q) => p[0] - q[0]);
  let covered = 0, end = -Infinity;
  for (const [lo, hi] of iv) { const s = Math.max(lo, end); if (hi > s) covered += hi - s; end = Math.max(end, hi); }
  return covered;
}

test('V3-7 / V3-37 : couverture : coupe seulement sur les cases coupées, axe vertical intact (plateaux « coupe + contre-sens » compris)', () => {
  let checked = 0, withBoth = 0;
  for (const state of randomBoards(20000)) {
    const { res, post } = process(state);
    const raw = res.segments(), cols = state.cols;
    const isCut = new Set(); for (let q = 0; q < post.cutCount; q++) isCut.add(post.cuts[q]);
    for (let i = 0; i < raw.count; i++) {
      const horiz = raw.y0[i] === raw.y1[i];
      const a = Math.min(horiz ? raw.x0[i] : raw.y0[i], horiz ? raw.x1[i] : raw.y1[i]), z = Math.max(horiz ? raw.x0[i] : raw.y0[i], horiz ? raw.x1[i] : raw.y1[i]);
      const line = horiz ? raw.y0[i] : raw.x0[i];
      for (let u = Math.ceil(a - 0.5) + 0.5; u < z - 1e-9; u += 1) { // centres de cases du tronçon (extrémités comprises : demi-couverture exigée)
        const c = horiz ? Math.floor(line) * cols + Math.floor(u) : Math.floor(u) * cols + Math.floor(line);
        if (horiz && isCut.has(c)) continue; // vérifié plus bas
        const need = Math.min(u + CUT_HALF, z) - Math.max(u - CUT_HALF, a); // partie de [u±0,18] qui appartient au tronçon
        const cov = coverage(post, horiz ? 0 : 1, line, u, CUT_HALF);
        assert.ok(cov >= need - 1e-4, `centre non coupé couvert (case ${c}, ${horiz ? 'H' : 'V'}, couvert ${cov.toFixed(3)} sur ${need.toFixed(3)})`);
        checked++;
      }
    }
    for (const c of isCut) {
      const cx = (c % cols) + 0.5, cy = Math.floor(c / cols) + 0.5, b4 = c * 4;
      assert.ok(coverage(post, 0, cy, cx, CUT_HALF - 1e-4) < 1e-6, 'rien d\'horizontal dans la coupure');
      assert.ok(coverage(post, 1, cx, cy, CUT_HALF) >= 2 * CUT_HALF - 1e-4, 'axe vertical intact');
      if ((res.in[b4] && res.in[b4 + 2] && res.in[b4] !== res.in[b4 + 2]) || (res.in[b4 + 1] && res.in[b4 + 3] && res.in[b4 + 1] !== res.in[b4 + 3])) withBoth++;
    }
  }
  assert.ok(checked > 100000, `centres vérifiés : ${checked}`);
  assert.equal(withBoth, 4);
});

const E = (at, dir, mask) => ({ type: 'emitter', at, dir, mask });
const near = (a, b, eps = 1e-5) => Math.abs(a - b) < eps;
const piecesOn = (post, pred) => {
  const o = post.out, r = [];
  for (let i = 0; i < o.count; i++) {
    const p = { x0: o.x0[i], y0: o.y0[i], x1: o.x1[i], y1: o.y1[i], mask: o.mask[i], axis: o.axis[i], glow: o.glow[i], fa: o.fa[i], fb: o.fb[i] };
    if (pred(p)) r.push(p);
  }
  return r;
};

test('V3-7 : coupure d\'un croisement R horizontal × B vertical sur case vide : ±0,18, fondu 0,06, halo seulement aux vraies extrémités, anneau signalé', () => {
  const st = createState({ size: [9, 7], pieces: [E([0, 3], 'E', 'R'), E([4, 0], 'S', 'B')] });
  const { post } = process(st);
  assert.equal(post.cutCount, 1);
  assert.equal(post.cuts[0], 3 * 9 + 4);
  const h = piecesOn(post, (p) => p.axis === 0).sort((a, b) => a.x0 - b.x0);
  assert.equal(h.length, 2);
  assert.ok(near(h[0].x0, 0.5) && near(h[0].x1, 4.5 - CUT_HALF) && near(h[0].fb, CUT_FADE) && h[0].fa === 0 && h[0].glow === 1);
  assert.ok(near(h[1].x0, 4.5 + CUT_HALF) && near(h[1].x1, 9) && near(h[1].fa, CUT_FADE) && h[1].fb === 0 && h[1].glow === 2);
  const v = piecesOn(post, (p) => p.axis === 1);
  assert.equal(v.length, 1, 'le vertical passe');
  assert.ok(near(v[0].y0, 0.5) && near(v[0].y1, 7));
});

test('V3-7 : même masque ou masque inclus : pas de coupure (l\'addition ne ment pas)', () => {
  for (const [m1, m2] of [['R', 'R'], ['RG', 'R'], ['RGB', 'G']]) {
    const { post } = process(createState({ size: [9, 7], pieces: [E([0, 3], 'E', m1), E([4, 0], 'S', m2)] }));
    assert.equal(post.cutCount, 0, `${m1}/${m2}`);
  }
});

test('V3-7 : sur un miroir, un séparateur ou une cible, jamais de coupure même si les deux axes sont éclairés', () => {
  for (const piece of [{ type: 'mirror', at: [4, 3], o: '/' }, { type: 'target', at: [4, 3], need: 'RB' }, { type: 'splitter', at: [4, 3], o: '/' }]) {
    const { post } = process(createState({ size: [9, 7], pieces: [E([0, 3], 'E', 'R'), E([4, 0], 'S', 'B'), piece] }));
    assert.equal(post.cutCount, 0, piece.type);
  }
});

test('V3-8 : deux faisceaux opposés de masques différents : voies à droite de leur sens, biseau de 0,25 jusqu\'à l\'axe aux extrémités (raccord V3-37 (1))', () => {
  const st = createState({ size: [8, 6], pieces: [E([0, 3], 'E', 'R'), E([7, 3], 'W', 'B')] });
  const cell = 60, off = laneOffset(cell);
  assert.ok(near(off, 0.07));
  const { post } = process(st, cell);
  assert.equal(post.laneCount, 2);
  const red = piecesOn(post, (p) => p.mask === 1).sort((a, b) => a.x0 - b.x0), blue = piecesOn(post, (p) => p.mask === 4).sort((a, b) => a.x0 - b.x0);
  // rouge (vers l'est) : décalé vers le bas (+y) ; bleu (vers l'ouest) : vers le haut (−y)
  assert.equal(red.length, 4); assert.equal(blue.length, 4);
  const mid = (arr) => arr.find((p) => near(p.y0, p.y1) && !near(p.y0, 3.5));
  assert.ok(near(mid(red).y0, 3.5 + off) && near(mid(red).x0, 1 + LANE_BEVEL) && near(mid(red).x1, 7 - LANE_BEVEL));
  assert.ok(near(mid(blue).y0, 3.5 - off) && near(mid(blue).x0, 1 + LANE_BEVEL) && near(mid(blue).x1, 7 - LANE_BEVEL));
  // biseaux : de l'axe (3,5) à la voie sur 0,25 case, aux deux bouts de la section commune [1, 7]
  const bev = red.filter((p) => !near(p.y0, p.y1));
  assert.equal(bev.length, 2);
  assert.ok(near(bev[0].x0, 1) && near(bev[0].y0, 3.5) && near(bev[0].x1, 1.25) && near(bev[0].y1, 3.5 + off));
  assert.ok(near(bev[1].x1, 7) && near(bev[1].y1, 3.5));
  // les jonctions intérieures n'ont pas de halo ; les vraies extrémités oui
  assert.equal(red.filter((p) => p.glow & 1).length, 1); assert.equal(red.filter((p) => p.glow & 2).length, 1);
});

test('V3-8 : même masque en sens opposés : rien ne bouge ; décalage = max(0,07 case, 3 px) plafonné à 0,12', () => {
  const { post } = process(createState({ size: [8, 6], pieces: [E([0, 3], 'E', 'G'), E([7, 3], 'W', 'G')] }));
  assert.equal(post.laneCount, 0);
  assert.equal(post.out.count, 2);
  assert.ok(near(laneOffset(100), 0.07)); assert.ok(near(laneOffset(40), 0.075)); assert.ok(near(laneOffset(20), 0.12)); assert.ok(near(laneOffset(10), 0.12));
});

test('V3-37 (2) : priorité à la coupure : voies sans trou de ±0,18 dans la case coupée, voies reprises de part et d\'autre', () => {
  // rouge → est et vert ← ouest sur la rangée 3 (contre-sens), bleu ↓ sud sur la colonne 4 : le croisement (4,3) est vide, trompeur, et en contre-sens
  const st = createState({ size: [9, 7], pieces: [E([0, 3], 'E', 'R'), E([8, 3], 'W', 'G'), E([4, 0], 'S', 'B')] });
  const { post } = process(st, 60);
  assert.equal(post.cutCount, 1);
  const off = laneOffset(60);
  const h = piecesOn(post, (p) => p.axis === 0);
  for (const p of h) assert.ok(p.x1 <= 4.5 - CUT_HALF + 1e-5 || p.x0 >= 4.5 + CUT_HALF - 1e-5, 'aucun tronçon horizontal dans la coupure');
  const red = h.filter((p) => p.mask === 1 && near(p.y0, 3.5 + off) && near(p.y1, 3.5 + off));
  assert.ok(red.some((p) => near(p.x1, 4.5 - CUT_HALF)), 'voie rouge reprise à gauche de la coupure');
  assert.ok(red.some((p) => near(p.x0, 4.5 + CUT_HALF)), 'voie rouge reprise à droite');
});

test('V3-37 (2) : sur une case de pièce (miroir), jamais de coupe ; les voies se rejoignent au centre du miroir (raccord)', () => {
  // rouge → est vers un miroir « / » en (4,3) qui le renvoie vers le nord ; bleu ↓ sud depuis (4,0) arrive sur le même miroir : sens opposés sur la colonne 4
  const st = createState({ size: [9, 7], pieces: [E([0, 3], 'E', 'R'), E([4, 0], 'S', 'B'), { type: 'mirror', at: [4, 3], o: '/' }] });
  const { post } = process(st, 60);
  assert.equal(post.cutCount, 0);
  const col = piecesOn(post, (p) => p.axis === 1);
  const atMirror = col.filter((p) => near(p.y1, 3.5) || near(p.y0, 3.5));
  assert.ok(atMirror.length >= 2);
  for (const p of atMirror) assert.ok((near(p.y1, 3.5) && near(p.x1, 4.5)) || (near(p.y0, 3.5) && near(p.x0, 4.5)), 'raccord au centre du miroir');
  assert.ok(col.some((p) => !near(p.x0, 4.5) || !near(p.x1, 4.5)), 'des voies décalées existent');
});

test('jetons-symboles : entre deux centres de cases (abscisse entière), jamais dans une coupure', () => {
  const { post } = process(createState({ size: [9, 7], pieces: [E([0, 3], 'E', 'R'), E([8, 3], 'W', 'G'), E([4, 0], 'S', 'B')] }), 60);
  const t = post.tokens;
  assert.ok(t.count > 0);
  for (let i = 0; i < t.count; i++) {
    const frac = (v) => Math.abs(v - Math.round(v));
    assert.ok(frac(t.x[i]) < 1e-6 || frac(t.y[i]) < 1e-6, 'jeton sur une frontière de case (abscisse entière sur son axe)');
    assert.ok(!(Math.abs(t.x[i] - 4.5) < CUT_HALF && Math.abs(t.y[i] - 3.5) < 0.2), 'pas de jeton dans la coupure');
  }
});

test('classifyCell et kindsOfState : lecture des types de case', () => {
  const st = createState({ size: [4, 3], pieces: [E([0, 0], 'E', 'R'), { type: 'mirror', at: [1, 1], o: '/' }, { type: 'filter', at: [2, 2], mask: 'R' }] });
  const k = kindsOfState(st);
  assert.equal(k[0], 4); assert.equal(k[5], 3); assert.equal(k[10], FILTER); assert.equal(k[11], EMPTY);
  assert.deepEqual(classifyCell(k, new Uint8Array(48), new Uint8Array(48), 5), { thru: false, lie: false, cut: false });
});
