// RÉFÉRENCE INDEPENDANTE du tracé v2 (ARCHITECTURE_V2 E12 f). N'importe RIEN de src/engine/ (ni des tests du moteur).
// Écrite d'après le texte de §2, autre algorithme que le moteur : un canal de couleur (un bit) à la fois, parcours de rayons
// avec ensemble de visites (clé texte), portes par re-tracé complet jusqu'à stabilité (aucune incrémentalité), tables en dur.
// Port de docs/proto-v2/brute2.mjs (partie tracé ; l'énumération de poses du solveur reste pour J3 dans tests/solver/).
// Directions : 0=E 1=N 2=W 3=S (y vers le bas). Orientations : 0='-' 1='/' 2='|' 3='\'.
// Entrée : {cols, rows, pieces:[{type, c, r, o, dir, mask, need, pair, link:[c,r], fixed}]}.
const DXY = [[1, 0], [0, -1], [-1, 0], [0, 1]];
const MIRROR_OUT = [[0, 3, 2, 1], [1, 0, 3, 2], [2, 1, 0, 3], [3, 2, 1, 0]]; // [o][d] -> d' (table MVP-R5, en dur)
const LEFT = [1, 2, 3, 0], RIGHT = [3, 0, 1, 2];

// Trace un état complet. open = Set d'indices de pièces « porte » ouvertes. Retourne {got:[par cible], used:Set d'indices}.
function traceOnce(st, open) {
  const at = new Map();
  st.pieces.forEach((p, i) => at.set(p.c + ',' + p.r, i));
  const targets = [];
  st.pieces.forEach((p, i) => { if (p.type === 'target') targets.push(i); });
  const got = new Map(targets.map((i) => [i, 0]));
  const used = new Set();
  const partner = (i) => {
    const p = st.pieces[i];
    for (let j = 0; j < st.pieces.length; j++) if (j !== i && st.pieces[j].type === 'portal' && st.pieces[j].pair === p.pair) return j;
    return -1;
  };
  for (const bit of [1, 2, 4]) {
    const seen = new Set();
    const work = [];
    st.pieces.forEach((p) => { if (p.type === 'emitter' && (p.mask & bit)) work.push([p.c, p.r, p.dir]); });
    while (work.length) {
      let [c, r, d] = work.pop(); // rayon qui QUITTE le centre de (c,r) vers d
      for (;;) {
        c += DXY[d][0]; r += DXY[d][1];
        if (c < 0 || r < 0 || c >= st.cols || r >= st.rows) break;
        const i = at.get(c + ',' + r);
        const p = i === undefined ? null : st.pieces[i];
        if (p && (p.type === 'wall' || p.type === 'emitter')) break;
        if (p && p.type === 'gate' && !open.has(i)) break;
        const key = c + ',' + r + ',' + d;
        if (seen.has(key)) break;
        seen.add(key);
        if (!p || p.type === 'gate') continue;
        if (p.type === 'target') { got.set(i, got.get(i) | bit); continue; }
        if (p.type === 'mirror') { const nd = MIRROR_OUT[p.o & 3][d]; if (nd !== d) used.add(i); d = nd; continue; }
        if (p.type === 'splitter') { const nd = MIRROR_OUT[p.o & 3][d]; if (nd !== d) { used.add(i); work.push([c, r, nd]); } continue; }
        if (p.type === 'prism') {
          if (bit === 1) { used.add(i); d = LEFT[d]; } else if (bit === 4) { used.add(i); d = RIGHT[d]; }
          continue;
        }
        if (p.type === 'filter') { if (!(p.mask & bit)) { used.add(i); break; } continue; }
        if (p.type === 'portal') { const j = partner(i); if (j < 0) continue; c = st.pieces[j].c; r = st.pieces[j].r; continue; }
      }
    }
  }
  return { got, used, targets };
}

/** Trace complet avec portes : on ouvre les portes dont la cible reçoit au moins sa couleur, on recommence, jusqu'à stabilité. */
export function bruteTrace(st) {
  const open = new Set();
  const gates = [];
  st.pieces.forEach((p, i) => { if (p.type === 'gate') gates.push(i); });
  for (;;) {
    const res = traceOnce(st, open);
    let changed = false;
    for (const g of gates) {
      if (open.has(g)) continue;
      const lk = st.pieces[g].link;
      const ti = st.pieces.findIndex((p) => p.type === 'target' && p.c === lk[0] && p.r === lk[1]);
      if (ti >= 0 && ((res.got.get(ti) & st.pieces[ti].need) === st.pieces[ti].need)) { open.add(g); changed = true; }
    }
    if (!changed) {
      let allLit = res.targets.length > 0;
      for (const t of res.targets) if (res.got.get(t) !== st.pieces[t].need) allLit = false;
      const usedMovable = [...res.used].filter((i) => st.pieces[i].fixed !== true).length;
      return {
        got: res.targets.map((t) => res.got.get(t)), open: [...open].sort((a, b) => a - b), used: [...res.used].sort((a, b) => a - b), allLit, usedMovable,
      };
    }
  }
}
