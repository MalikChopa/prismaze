// Aides des tests du certificateur (tools/certify-levels.mjs) : niveaux aleatoires PETITS, force brute independante (toutes les
// poses reelles des K pieces, garage compris, evaluees par le moteur), comparaison avec le certificateur.
// Rien ici n'importe le solveur.
import { createState } from '../../src/engine/state.js';
import { buildBoard } from '../../src/engine/board.js';
import { trace } from '../../src/engine/trace.js';
import { ORIENT_CHARS, DIR_CHARS } from '../../src/engine/dirs.js';
import { maskToLetters } from '../../src/engine/colors.js';

export function mkRng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- force brute : toutes les poses reelles (les K pieces posees sur K cases libres distinctes, toutes orientations) ----
export function bruteForce(level) {
  const st = createState(level);
  const fixedP = st.pieces.filter((p) => p.fixed), mov = st.pieces.filter((p) => !p.fixed);
  const occ = new Set(fixedP.map((p) => p.r * st.cols + p.c));
  const free = []; for (let i = 0; i < st.cols * st.rows; i++) if (!occ.has(i)) free.push(i);
  const classes = [];
  for (const p of mov) { let c = classes.find((x) => x.type === p.type && x.mask === p.mask); if (!c) { c = { type: p.type, mask: p.mask, left: 0 }; classes.push(c); } c.left++; }
  const placed = [];
  let best = Infinity, wins = 0, leaves = 0;
  const K = mov.length;
  function leaf() {
    leaves++;
    const pieces = fixedP.concat(placed).map((p, i) => ({ ...p, id: i }));
    const r = trace(buildBoard({ cols: st.cols, rows: st.rows, pieces }));
    if (r.allLit) { wins++; if (r.usedMovable < best) best = r.usedMovable; }
  }
  function rec(i, remaining) {
    if (remaining === 0) { leaf(); return; }
    if (free.length - i < remaining) return;
    const cell = free[i], c = cell % st.cols, r = (cell / st.cols) | 0;
    for (const k of classes) {
      if (k.left === 0) continue;
      const rots = k.type === 'mirror' || k.type === 'splitter' ? 4 : 1;
      for (let o = 0; o < rots; o++) {
        placed.push({ type: k.type, c, r, o, dir: 0, mask: k.mask, need: 0, pair: 0, link: null, fixed: false });
        k.left--; rec(i + 1, remaining - 1); k.left++; placed.pop();
      }
    }
    rec(i + 1, remaining);
  }
  rec(0, K);
  return { minimum: best === Infinity ? null : best, wins, leaves, K };
}

// ---- generateur de petits niveaux (3x3 a 5x4, K <= 3, tous types, portes, portails, 1-2 emetteurs) ----
export function genSmallLevel(rnd, opts = {}) {
  const ri = (n) => Math.floor(rnd() * n);
  const pick = (l) => l[ri(l.length)];
  for (;;) {
    const cols = 3 + ri(3), rows = 3 + ri(2);
    const all = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) all.push([c, r]);
    const free = all.slice();
    const take = () => free.splice(ri(free.length), 1)[0];
    const inward = (at) => { const cand = []; if (at[0] < cols - 1) cand.push(0); if (at[1] > 0) cand.push(1); if (at[0] > 0) cand.push(2); if (at[1] < rows - 1) cand.push(3); return pick(cand); };
    const base = [];
    const nEm = opts.twoEmitters || rnd() < 0.3 ? 2 : 1;
    for (let i = 0; i < nEm; i++) { const at = take(); base.push({ type: 'emitter', at, dir: DIR_CHARS[inward(at)], mask: maskToLetters(rnd() < 0.5 ? 7 : 1 + ri(7)) }); }
    const nWall = opts.tight ? 2 + ri(3) : ri(3);
    for (let i = 0; i < nWall && free.length > 6; i++) base.push({ type: 'wall', at: take() });
    if (all.length >= 12 && rnd() < 0.3) { const a = take(), b = take(); base.push({ type: 'portal', at: a, pair: 0 }, { type: 'portal', at: b, pair: 0 }); }
    const K = opts.K ?? 1 + ri(3);
    const mk = (t, at, fixed) => {
      const p = { type: t, at };
      if (t === 'mirror' || t === 'splitter') p.o = ORIENT_CHARS[ri(4)];
      if (t === 'filter') p.mask = maskToLetters(1 + ri(6));
      if (fixed) p.fixed = true;
      return p;
    };
    const types = []; for (let i = 0; i < K; i++) types.push(opts.mirrorsOnly ? 'mirror' : pick(['mirror', 'mirror', 'splitter', 'prism', 'filter']));
    if (rnd() < 0.15) { const t = pick(['mirror', 'splitter', 'prism', 'filter']); base.push(mk(t, take(), true)); } // piece mobile par type, figee
    const nT = 1 + ri(2), nGate = rnd() < 0.3 ? 1 : 0;
    if (free.length < K + nT + nGate + 1) continue;
    // plantation : K pieces sur des cases libres, puis cibles sur des cases eclairees
    const gcell = nGate ? take() : null;
    const planted = types.map((t) => mk(t, take(), false));
    const probe = (extra) => { const b = buildBoard(createState({ size: [cols, rows], pieces: base.concat(extra) })); trace(b); return b; };
    const litAt = (b, at) => (b.inM[(at[1] * cols + at[0]) * 4] | b.inM[(at[1] * cols + at[0]) * 4 + 1] | b.inM[(at[1] * cols + at[0]) * 4 + 2] | b.inM[(at[1] * cols + at[0]) * 4 + 3]) !== 0;
    const gateWall = gcell ? [{ type: 'wall', at: gcell }] : [];
    const bl = probe(gateWall.concat(planted));
    const bare = probe(gateWall);
    const spots0 = free.filter((at) => litAt(bl, at) && !litAt(bare, at));
    const spots = spots0.length > 0 && rnd() < 0.85 ? spots0 : free.filter((at) => litAt(bl, at));
    const tcells = [];
    for (let i = 0; i < nT; i++) {
      const src = spots.length > 0 && rnd() < 0.9 ? spots : free;
      const at = src[ri(src.length)];
      if (tcells.some((t) => t[0] === at[0] && t[1] === at[1])) continue;
      tcells.push(at); free.splice(free.indexOf(at), 1);
    }
    if (tcells.length === 0) continue;
    const targets = tcells.map((at) => ({ type: 'target', at, need: 'RGB' }));
    const gate = gcell ? [{ type: 'gate', at: gcell, link: pick(tcells) }] : [];
    for (let it = 0; it < 3; it++) {
      const r = trace(buildBoard(createState({ size: [cols, rows], pieces: base.concat(targets, gate, planted) })));
      targets.forEach((t, i) => { if (r.targets[i].got !== 0) t.need = maskToLetters(r.targets[i].got); });
    }
    if (rnd() < 0.1) pick(targets).need = maskToLetters(1 + ri(7));
    const fr = free.concat(planted.map((p) => p.at));
    const mov = planted.map((p) => { const at = fr.splice(ri(fr.length), 1)[0]; return { ...p, at }; });
    const seen = new Set(); let bad = false;
    for (const p of base.concat(targets, gate, mov)) { const k = p.at.join(','); if (seen.has(k)) bad = true; seen.add(k); }
    if (bad) continue;
    if (trace(buildBoard(createState({ size: [cols, rows], pieces: base.concat(targets, gate, mov) }))).allLit) continue; // V10 : l'etat initial ne gagne pas
    return { format: 2, id: 'rnd', name: 'rnd', size: [cols, rows], pieces: base.concat(targets, gate, mov) };
  }
}

// Place des pieces JSON dans un niveau (copie).
export function withSolutions(level, par, solutions) { return { ...level, par, solutions }; }
