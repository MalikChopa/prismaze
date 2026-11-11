// Chasse locale d'un score meilleur que le minimum annoncé (S9, J3) : recherche aléatoire avec redémarrages et acceptation
// des mouvements qui n'empirent pas un score (cibles manquées d'abord, pièces utilisées ensuite), avec le tracé INDÉPENDANT de
// brute.mjs. Un contre-exemple est une pose gagnante dont le score est inférieur à `par`. Elle ne PROUVE rien : elle cherche.
// Port nettoyé de docs/audit-v2/hunt.mjs.
import { makeBoard, traceBoard, moveTo, fromJson } from './brute.mjs';
import { mulberry } from './generate.mjs';

/**
 * @param {object} level  niveau JSON v2
 * @param {{seed?:number, restarts?:number, iters?:number}} [opt]  iters = mouvements par redémarrage
 * @returns {{bestWin:number, hitsAtPar:number, tried:number}}  bestWin = plus petit score gagnant vu (Infinity si aucune victoire)
 */
export function huntBelow(level, opt = {}) {
  const rnd = mulberry(opt.seed ?? 1);
  const restarts = opt.restarts ?? 20, iters = opt.iters ?? 1000;
  const L = fromJson(level);
  const B = makeBoard(L);
  const mov = B.movable;
  for (const p of mov) B.grid[p.y * B.cols + p.x] = null;
  const cells = [];
  for (let i = 0; i < B.N; i++) if (B.grid[i] === null) cells.push(i);
  const need = B.targets.map((t) => t.need);
  const score = () => {
    const r = traceBoard(B);
    let miss = 0;
    r.got.forEach((g, i) => { miss += (need[i] & ~g ? 2 : 0) + (g & ~need[i] ? 1 : 0); });
    return { r, f: miss * 10 + r.usedMovable };
  };
  const ORIENT = ['-', '/', '|', String.fromCharCode(92)];
  // pose de départ = témoin + garage (opt.start, format des placements) : les redémarrages pairs partent de là, puis dérivent
  const placeStart = () => {
    const left = opt.start.map((q) => ({ q, used: false }));
    for (const p of mov) {
      const item = left.find((x) => !x.used && x.q.type === p.type && (p.type !== 'filter' || ((x.q.mask.includes('R') ? 1 : 0) | (x.q.mask.includes('G') ? 2 : 0) | (x.q.mask.includes('B') ? 4 : 0)) === p.mask));
      item.used = true;
      moveTo(B, p, item.q.at[0], item.q.at[1]);
      if (item.q.o !== undefined) p.o = ORIENT.indexOf(item.q.o);
    }
  };
  const place = (restart) => {
    if (opt.start && restart % 2 === 0) { for (const p of mov) if (B.grid[p.y * B.cols + p.x] === p) B.grid[p.y * B.cols + p.x] = null; placeStart(); return; }
    const idx = cells.map((_, k) => k);
    for (let a = idx.length - 1; a > 0; a--) { const b = rnd.int(a + 1); [idx[a], idx[b]] = [idx[b], idx[a]]; }
    mov.forEach((p, k) => { const c = cells[idx[k]]; moveTo(B, p, c % B.cols, (c / B.cols) | 0); if (p.type === 'mirror' || p.type === 'splitter') p.o = rnd.int(4); });
  };
  let bestWin = Infinity, hitsAtPar = 0, tried = 0;
  for (let restart = 0; restart < restarts; restart++) {
    place(restart);
    let cur = score();
    if (cur.r.allLit) { bestWin = Math.min(bestWin, cur.r.usedMovable); if (cur.r.usedMovable === (opt.par ?? -1)) hitsAtPar++; }
    for (let it = 0; it < iters; it++) {
      const p = mov[rnd.int(mov.length)];
      const save = { x: p.x, y: p.y, o: p.o };
      const occ = new Set(mov.map((q) => q.y * B.cols + q.x));
      const swap = rnd.int(3) === 0 ? mov[rnd.int(mov.length)] : null;
      let undo;
      if (swap !== null && swap !== p) {
        const s2 = { x: swap.x, y: swap.y };
        B.grid[p.y * B.cols + p.x] = null; B.grid[swap.y * B.cols + swap.x] = null;
        moveTo(B, p, s2.x, s2.y); moveTo(B, swap, save.x, save.y);
        undo = () => { B.grid[p.y * B.cols + p.x] = null; B.grid[swap.y * B.cols + swap.x] = null; moveTo(B, p, save.x, save.y); moveTo(B, swap, s2.x, s2.y); };
      } else {
        if (rnd.int(2)) { for (let t = 0; t < 10; t++) { const c = rnd.pick(cells); if (!occ.has(c)) { moveTo(B, p, c % B.cols, (c / B.cols) | 0); break; } } }
        if ((p.type === 'mirror' || p.type === 'splitter') && rnd.int(2)) p.o = rnd.int(4);
        undo = () => { moveTo(B, p, save.x, save.y); p.o = save.o; };
      }
      const nx = score();
      tried++;
      if (nx.f <= cur.f || rnd.int(100) < 3) {
        cur = nx;
        if (nx.r.allLit) { bestWin = Math.min(bestWin, nx.r.usedMovable); if (nx.r.usedMovable === (opt.par ?? -1)) hitsAtPar++; }
      } else undo();
    }
  }
  return { bestWin, hitsAtPar, tried };
}
