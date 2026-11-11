// Générateurs de niveaux de test pour les contrôles croisés du solveur (S9, J3). Indépendants du moteur et du solveur :
// ils n'utilisent que la force brute (brute.mjs). Port nettoyé des générateurs de l'audit 1 (docs/audit-v2/mine.mjs).
import { trace } from './brute.mjs';

/** Générateur pseudo-aléatoire à graine (mulberry32) : `rnd()` dans [0,1), `rnd.int(n)`, `rnd.pick(liste)`. */
export function mulberry(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = (n) => Math.floor(f() * n);
  f.pick = (list) => list[f.int(list.length)];
  return f;
}

const TYPES_DEFAULT = ['mirror', 'mirror', 'splitter', 'prism', 'filter'];

function dropLonePortals(pieces, occ) {
  const cnt = {};
  pieces.forEach((p) => { if (p.type === 'portal') cnt[p.pair] = (cnt[p.pair] || 0) + 1; });
  for (let i = pieces.length - 1; i >= 0; i--) {
    if (pieces[i].type === 'portal' && cnt[pieces[i].pair] !== 2) { occ.delete(pieces[i].x + ',' + pieces[i].y); pieces.splice(i, 1); }
  }
}

/**
 * Niveau « planté » : on pose tout au hasard, on trace, on place les cibles où la lumière arrive avec ce qu'elle reçoit (donc
 * la pose d'origine gagne), puis on disperse les pièces mobiles. Résoluble par construction (témoin = pose d'origine).
 * Options : cols, rows (défaut 3-4), types, maxK (3), maxGates, portalPct, gatePct, minUsed, hard (cibles seulement où les
 * pièces mobiles changent la lumière), tight (murs jusqu'à ne laisser que K ou K+1 cases sans pièce fixe : garage serré),
 * mutatePct (change le besoin d'une cible : niveau peut-être insoluble).
 * @returns {{level:object, witness:Array}|null}
 */
export function plantedLevel(rnd, opt = {}) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const cols = opt.cols ?? (3 + rnd.int(3)), rows = opt.rows ?? (3 + rnd.int(2));
    const pieces = [];
    const occ = new Set();
    const put = (o) => {
      for (let t = 0; t < 60; t++) {
        const x = rnd.int(cols), y = rnd.int(rows);
        if (!occ.has(x + ',' + y)) { occ.add(x + ',' + y); const q = { ...o, x, y }; pieces.push(q); return q; }
      }
      return null;
    };
    const ne = 1 + rnd.int(opt.maxEmitters ?? 2);
    for (let i = 0; i < ne; i++) put({ type: 'emitter', dir: rnd.int(4), mask: 1 + rnd.int(7) });
    for (let i = rnd.int(3); i > 0; i--) put({ type: 'wall' });
    if (rnd.int(100) < (opt.portalPct ?? 30)) { const pr = rnd.int(3); put({ type: 'portal', pair: pr }); put({ type: 'portal', pair: pr }); }
    const gates = [];
    const ng = rnd.int(100) < (opt.gatePct ?? 40) ? 1 + rnd.int(opt.maxGates ?? 1) : 0;
    for (let i = 0; i < ng; i++) { const g = put({ type: 'gate', link: [0, 0] }); if (g) gates.push(g); }
    const K = 1 + rnd.int(opt.maxK ?? 3);
    const mov = [];
    for (let i = 0; i < K; i++) {
      const t = rnd.pick(opt.types || TYPES_DEFAULT);
      const o = { type: t };
      if (t === 'mirror' || t === 'splitter') o.o = rnd.int(4);
      if (t === 'filter') o.mask = 1 + rnd.int(6);
      const q = put(o);
      if (q) mov.push(q);
    }
    dropLonePortals(pieces, occ);
    if (mov.length === 0) continue;
    const L0 = { cols, rows, pieces };
    // lumière reçue par case (OU des quatre directions), avec et sans les pièces mobiles
    const lit1 = lightField(L0);
    const lit0 = lightField({ cols, rows, pieces: pieces.filter((p) => !mov.includes(p)) });
    const lit = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (occ.has(x + ',' + y)) continue;
      const got = lit1[y * cols + x];
      if (got && (got !== lit0[y * cols + x] || !opt.hard)) lit.push([x, y, got]);
    }
    if (lit.length === 0) continue;
    const nt = Math.min(lit.length, 1 + rnd.int(3));
    const tg = [];
    for (let i = 0; i < nt; i++) {
      const [x, y, got] = lit.splice(rnd.int(lit.length), 1)[0];
      occ.add(x + ',' + y);
      const t = { type: 'target', x, y, need: got };
      pieces.push(t);
      tg.push(t);
    }
    for (const gate of gates) { const t = rnd.pick(tg); gate.link = [t.x, t.y]; }
    // une cible posée ne change pas le champ, mais une porte liée si : on ajuste les besoins jusqu'à stabilité
    let ok = false;
    for (let it = 0; it < 4; it++) {
      const r = trace(L0);
      if (tg.every((t, i) => r.got[i] === t.need)) { ok = true; break; }
      tg.forEach((t, i) => { t.need = r.got[i] || t.need; });
    }
    if (!ok) continue;
    const rf = trace(L0);
    if (!rf.allLit || rf.got.some((g) => g === 0)) continue;
    if (opt.minUsed && rf.usedMovable < opt.minUsed) continue;
    const witness = mov.map((p) => ({ x: p.x, y: p.y, o: p.o }));
    // garage serré : on bouche des cases jusqu'à n'en laisser que K ou K+1 (sans pièce fixe)
    if (opt.tight) {
      const fixedOcc = new Set(pieces.filter((p) => !mov.includes(p)).map((p) => p.x + ',' + p.y));
      const free = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!fixedOcc.has(x + ',' + y)) free.push([x, y]);
      const want = mov.length + rnd.int(2);
      while (free.length > want) { const [x, y] = free.splice(rnd.int(free.length), 1)[0]; fixedOcc.add(x + ',' + y); pieces.push({ type: 'wall', x, y }); }
    }
    // dispersion des pièces mobiles sur des cases sans pièce fixe
    const fixedOcc = new Set(pieces.filter((p) => !mov.includes(p)).map((p) => p.x + ',' + p.y));
    const free = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!fixedOcc.has(x + ',' + y)) free.push([x, y]);
    if (free.length < mov.length) continue;
    for (let i = free.length - 1; i > 0; i--) { const j = rnd.int(i + 1); [free[i], free[j]] = [free[j], free[i]]; }
    mov.forEach((p, i) => { p.x = free[i][0]; p.y = free[i][1]; if (p.type === 'mirror' || p.type === 'splitter') p.o = rnd.int(4); });
    if (opt.mutatePct && rnd.int(100) < opt.mutatePct) {
      const ts = pieces.filter((p) => p.type === 'target');
      ts[rnd.int(ts.length)].need = 1 + rnd.int(7);
    }
    return { level: L0, witness };
  }
  return null;
}

// Lumière reçue par case (OU des directions) : on réutilise la trace de la force brute en lisant `inn` via une cible sur chaque case.
// Pour éviter une seconde implémentation du tracé, on pose une cible de besoin 7 sur chaque case libre dans une copie.
function lightField(L) {
  const { cols, rows } = L;
  const occ = new Set(L.pieces.map((p) => p.x + ',' + p.y));
  const probes = [];
  const pieces = L.pieces.map((p) => ({ ...p }));
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!occ.has(x + ',' + y)) { const t = { type: 'target', x, y, need: 7 }; pieces.push(t); probes.push(t); }
  // les cibles ajoutées sont traversées (E4) : elles ne changent pas le champ ; leurs portes éventuelles n'y sont pas liées
  const r = trace({ cols, rows, pieces });
  const nOrig = L.pieces.filter((p) => p.type === 'target').length;
  const out = new Uint8Array(cols * rows);
  probes.forEach((t, i) => { out[t.y * cols + t.x] = r.got[nOrig + i]; });
  return out;
}

