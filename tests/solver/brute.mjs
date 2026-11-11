// FORCE BRUTE INDÉPENDANTE du solveur v2 (ARCHITECTURE_V2 S9). N'importe RIEN de src/ : ni moteur, ni solveur.
// Écrite à partir du texte de §2 (E2 à E9) et de S1 seulement, par un autre algorithme que le moteur : balayage de Kleene
// (on rejoue toutes les cases jusqu'à ce que plus rien ne change), sans pile ni file, portes par balayages successifs.
// Port nettoyé de docs/audit-v2/mine.mjs (audit 1), rendu sans allocation par tracé pour tenir 20 000+ niveaux.
//
// Niveau interne : { cols, rows, pieces:[{type, x, y, dir?, mask?, o?, need?, pair?, link?:[x,y], fixed?}] }
//   dir 0..3 = E N W S ; o 0..3 = « - » « / » « | » « \ » ; masques 1..7 (R=1, G=2, B=4).
//   types : emitter wall target mirror splitter prism filter portal gate.
// S1 : une configuration réelle pose les K pièces mobiles sur K cases distinctes sans pièce fixe, avec orientations ;
// elle gagne si toutes les cibles sont allumées (reçu == besoin) ; son score = pièces mobiles utilisées. Le minimum réel est
// le plus petit score gagnant, le garage (pièces inutiles rangées sur des cases) est donc inclus d'office.
export const DX = [1, 0, -1, 0];
export const DY = [0, -1, 0, 1];
export const MOVABLE_TYPES = new Set(['mirror', 'splitter', 'prism', 'filter']);
export const isMovable = (p) => MOVABLE_TYPES.has(p.type) && p.fixed !== true;

/** Préparation d'un niveau pour le tracé : grille de pièces, listes, portail partenaire, porte -> cible. Réutilisable. */
export function makeBoard(L) {
  const { cols, rows } = L;
  const N = cols * rows;
  const grid = new Array(N).fill(null);
  for (const p of L.pieces) grid[p.y * cols + p.x] = p;
  const emitters = L.pieces.filter((p) => p.type === 'emitter');
  const targets = L.pieces.filter((p) => p.type === 'target');
  const gates = L.pieces.filter((p) => p.type === 'gate');
  const partner = new Map();
  for (const p of L.pieces) if (p.type === 'portal') for (const q of L.pieces) if (q !== p && q.type === 'portal' && q.pair === p.pair) partner.set(p, q);
  const gateTarget = gates.map((g) => grid[g.link[1] * cols + g.link[0]]);
  const movable = L.pieces.filter(isMovable);
  return { L, cols, rows, N, grid, emitters, targets, gates, partner, gateTarget, movable, inn: new Uint8Array(N * 4), open: new Uint8Array(gates.length) };
}

/** Trace complet (E3 à E8) de l'état courant de la grille. Renvoie {allLit, usedMovable, got:[par cible], open:[par porte]}. */
export function traceBoard(B) {
  const { cols, rows, N, grid, emitters, targets, gates, partner, gateTarget, inn, open } = B;
  inn.fill(0);
  open.fill(0);
  const send = (cell, d, m) => { // lumière m qui quitte le centre de `cell` vers d : entre dans la case voisine
    const nx = (cell % cols) + DX[d], ny = ((cell / cols) | 0) + DY[d];
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;
    const k = (ny * cols + nx) * 4 + d;
    if ((inn[k] | m) === inn[k]) return false;
    inn[k] |= m;
    return true;
  };
  for (let outer = 0; outer <= gates.length; outer++) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of emitters) if (send(e.y * cols + e.x, e.dir, e.mask)) changed = true;
      for (let cell = 0; cell < N; cell++) {
        const p = grid[cell];
        for (let d = 0; d < 4; d++) {
          const m = inn[cell * 4 + d];
          if (m === 0) continue;
          if (p === null) { if (send(cell, d, m)) changed = true; continue; }
          switch (p.type) {
            case 'wall': case 'emitter': case 'target': if (p.type === 'target' && send(cell, d, m)) changed = true; break;
            case 'mirror': if (send(cell, (p.o - d) & 3, m)) changed = true; break;
            case 'splitter': {
              if (send(cell, d, m)) changed = true;
              const r = (p.o - d) & 3;
              if (r !== d && send(cell, r, m)) changed = true;
              break;
            }
            case 'prism':
              if ((m & 1) && send(cell, (d + 1) & 3, 1)) changed = true;
              if ((m & 2) && send(cell, d, 2)) changed = true;
              if ((m & 4) && send(cell, (d + 3) & 3, 4)) changed = true;
              break;
            case 'filter': { const q = m & p.mask; if (q !== 0 && send(cell, d, q)) changed = true; break; }
            case 'portal': { const o = partner.get(p); if (o !== undefined && send(o.y * cols + o.x, d, m)) changed = true; break; }
            case 'gate': if (open[gates.indexOf(p)] === 1 && send(cell, d, m)) changed = true; break;
            default: throw new Error('type ' + p.type);
          }
        }
      }
    }
    let opened = false;
    for (let g = 0; g < gates.length; g++) {
      const t = gateTarget[g];
      if (open[g] === 1 || t === null || t === undefined || t.type !== 'target') continue;
      const c = t.y * cols + t.x;
      const got = inn[c * 4] | inn[c * 4 + 1] | inn[c * 4 + 2] | inn[c * 4 + 3];
      if ((got & t.need) === t.need) { open[g] = 1; opened = true; } // E6 : au moins sa couleur
    }
    if (!opened) break;
  }
  const got = targets.map((t) => { const c = t.y * cols + t.x; return inn[c * 4] | inn[c * 4 + 1] | inn[c * 4 + 2] | inn[c * 4 + 3]; });
  let allLit = targets.length > 0;
  targets.forEach((t, i) => { if (got[i] !== t.need) allLit = false; });
  let usedMovable = 0;
  const usedPieces = [];
  for (const p of B.movable) {
    const c = p.y * cols + p.x;
    let u = false;
    for (let d = 0; d < 4 && !u; d++) {
      const m = inn[c * 4 + d];
      if (m === 0) continue;
      if (p.type === 'mirror' || p.type === 'splitter') u = ((p.o - d) & 3) !== d;
      else if (p.type === 'prism') u = (m & 5) !== 0;
      else u = (m & ~p.mask & 7) !== 0;
    }
    if (u) { usedMovable++; usedPieces.push(p); }
  }
  return { allLit, usedMovable, usedPieces, got, open: Array.from(open) };
}

/** Trace d'un niveau interne (prépare le plateau à chaque appel : pratique, pas rapide). */
export function trace(L) {
  return traceBoard(makeBoard(L));
}

// Pose la pièce mobile p en (x, y) sur la grille (retire l'ancienne case).
export function moveTo(B, p, x, y) {
  const old = p.y * B.cols + p.x;
  if (B.grid[old] === p) B.grid[old] = null;
  p.x = x; p.y = y;
  B.grid[y * B.cols + x] = p;
}

/**
 * Minimum réel exhaustif (S1) : toutes les poses des pièces mobiles (cases sans pièce fixe, 4 orientations pour miroir et
 * séparateur). Les pièces identiques (même type et même masque) sont énumérées en cases croissantes : même minimum, K! fois moins.
 * @returns {{min:number, configs:number}}  min = -1 si aucune pose ne gagne
 */
export function bruteMin(L) {
  const B = makeBoard(L);
  const mov = B.movable;
  const origin = mov.map((p) => ({ x: p.x, y: p.y, o: p.o }));
  for (const p of mov) B.grid[p.y * B.cols + p.x] = null;
  const cells = [];
  for (let i = 0; i < B.N; i++) {
    const q = B.grid[i];
    if (q === null) cells.push(i);
  }
  const cls = mov.map((p) => p.type + ':' + (p.mask || 0));
  const idxOf = new Array(mov.length).fill(-1);
  const taken = new Uint8Array(B.N);
  let best = Infinity, configs = 0;
  const rec = (i) => {
    if (i === mov.length) {
      configs++;
      const r = traceBoard(B);
      if (r.allLit && r.usedMovable < best) best = r.usedMovable;
      return;
    }
    const p = mov[i];
    const nOr = p.type === 'mirror' || p.type === 'splitter' ? 4 : 1;
    const start = i > 0 && cls[i] === cls[i - 1] ? idxOf[i - 1] + 1 : 0;
    for (let j = start; j < cells.length; j++) {
      const c = cells[j];
      if (taken[c] === 1) continue;
      taken[c] = 1; idxOf[i] = j;
      moveTo(B, p, c % B.cols, (c / B.cols) | 0);
      for (let o = 0; o < nOr; o++) { if (nOr === 4) p.o = o; rec(i + 1); }
      B.grid[c] = null;
      taken[c] = 0;
    }
  };
  rec(0);
  mov.forEach((p, i) => { p.x = origin[i].x; p.y = origin[i].y; p.o = origin[i].o; });
  return { min: best === Infinity ? -1 : best, configs };
}

/**
 * Compte, pour k donné, les jeux de k pièces (les autres ABSENTES) qui gagnent et dont les k pièces servent toutes
 * (« solutions relaxées »), et parmi eux ceux dont le garage est possible : il existe une pose des K - k pièces restantes sur
 * des cases libres qui garde la victoire avec exactement k pièces utilisées (« solutions réelles à k »).
 * Un jeu = ensemble de (classe, case, orientation) ; énumération en cases croissantes dans chaque classe.
 * @returns {{relaxed:number, real:number}}
 */
export function bruteCounts(L, k) {
  const B = makeBoard(L);
  const all = B.movable;
  for (const p of all) B.grid[p.y * B.cols + p.x] = null;
  const origin = all.map((p) => ({ x: p.x, y: p.y, o: p.o }));
  const classes = [];
  for (const p of all) {
    const key = p.type + ':' + (p.mask || 0);
    let cl = classes.find((c) => c.key === key);
    if (cl === undefined) { cl = { key, members: [], rotates: p.type === 'mirror' || p.type === 'splitter' }; classes.push(cl); }
    cl.members.push(p);
  }
  const cells = [];
  for (let i = 0; i < B.N; i++) if (B.grid[i] === null) cells.push(i);
  const nOf = (cl) => (cl.rotates ? 4 : 1);
  let relaxed = 0, real = 0;
  // active : pièces actuellement sur la grille ; elles sont retirées de B.movable pendant le tracé (les absentes n'existent pas)
  const savedMov = B.movable;
  const placeOn = (p, c, o) => { moveTo(B, p, c % B.cols, (c / B.cols) | 0); p.o = o; };
  const takeOff = (p, c) => { B.grid[c] = null; void p; };
  const occupied = new Uint8Array(B.N);

  // complétion : poser les pièces restantes (liste `rest`) sur des cases libres, toutes orientations ; vrai si une pose garde la victoire avec k utilisées
  let extraSet = new Set();
  const complete = (rest, active, startCell) => {
    if (rest.length === 0) {
      B.movable = active;
      const r = traceBoard(B);
      B.movable = savedMov;
      // garage = les pièces en trop ne servent à rien (E8) : la configuration est la même que la relaxée
      return r.allLit && r.usedMovable === k && !r.usedPieces.some((u) => extraSet.has(u));
    }
    const [cl, p] = rest[0];
    const sameNext = rest.length > 1 && rest[1][0] === cl;
    for (let j = 0; j < cells.length; j++) {
      const c = cells[j];
      if (occupied[c] === 1) continue;
      if (j < startCell) continue;
      occupied[c] = 1;
      for (let o = 0; o < nOf(cl); o++) {
        placeOn(p, c, o);
        active.push(p);
        const ok = complete(rest.slice(1), active, sameNext ? j + 1 : 0);
        active.pop();
        if (ok) { takeOff(p, c); occupied[c] = 0; return true; }
      }
      takeOff(p, c);
      occupied[c] = 0;
    }
    return false;
  };

  const chosen = []; // {cl, p, c}
  const recClass = (ci, left, usedInClass, lastJ) => {
    if (ci === classes.length) {
      if (left !== 0) return;
      B.movable = chosen.map((x) => x.p);
      const r = traceBoard(B);
      B.movable = savedMov;
      if (!(r.allLit && r.usedMovable === k)) return;
      relaxed++;
      const rest = [];
      for (const cl of classes) for (const p of cl.members) if (!chosen.some((x) => x.p === p)) rest.push([cl, p]);
      extraSet = new Set(rest.map((x) => x[1]));
      if (complete(rest, chosen.map((x) => x.p), 0)) real++;
      return;
    }
    const cl = classes[ci];
    // finir cette classe ici
    recClass(ci + 1, left, 0, -1);
    if (usedInClass >= cl.members.length || left === 0) return;
    const p = cl.members[usedInClass];
    for (let j = lastJ + 1; j < cells.length; j++) {
      const c = cells[j];
      if (occupied[c] === 1) continue;
      occupied[c] = 1;
      for (let o = 0; o < nOf(cl); o++) {
        placeOn(p, c, o);
        chosen.push({ cl, p, c });
        recClass(ci, left - 1, usedInClass + 1, j);
        chosen.pop();
      }
      B.grid[c] = null;
      occupied[c] = 0;
    }
  };
  // les pièces absentes ne sont pas sur la grille : on ne trace que les pièces choisies (les autres sont hors grille)
  recClass(0, k, 0, -1);
  all.forEach((p, i) => { p.x = origin[i].x; p.y = origin[i].y; p.o = origin[i].o; });
  B.movable = savedMov;
  return { relaxed, real };
}

// ---------------------------------------------------------------------------------------------------------------
// Conversions avec le format JSON v2 (F1) : seul point de contact avec le reste du dépôt, sans importer de module.

const DIR_CHARS = 'ENWS';
const ORIENT_CHARS = ['-', '/', '|', '\\'];
const letters = (m) => (m & 1 ? 'R' : '') + (m & 2 ? 'G' : '') + (m & 4 ? 'B' : '');
const fromLetters = (s) => (s.includes('R') ? 1 : 0) | (s.includes('G') ? 2 : 0) | (s.includes('B') ? 4 : 0);

/** Niveau interne -> niveau JSON v2 (id, nom et pièces dans l'ordre de la liste). */
export function toJson(L, id = 'brute-test') {
  return {
    format: 2, id, name: id, size: [L.cols, L.rows],
    pieces: L.pieces.map((p) => {
      const at = [p.x, p.y];
      switch (p.type) {
        case 'emitter': return { type: 'emitter', at, dir: DIR_CHARS[p.dir], mask: letters(p.mask) };
        case 'target': return { type: 'target', at, need: letters(p.need) };
        case 'mirror': case 'splitter': return p.fixed ? { type: p.type, at, o: ORIENT_CHARS[p.o], fixed: true } : { type: p.type, at, o: ORIENT_CHARS[p.o] };
        case 'prism': return p.fixed ? { type: 'prism', at, fixed: true } : { type: 'prism', at };
        case 'filter': return p.fixed ? { type: 'filter', at, mask: letters(p.mask), fixed: true } : { type: 'filter', at, mask: letters(p.mask) };
        case 'portal': return { type: 'portal', at, pair: p.pair };
        case 'gate': return { type: 'gate', at, link: [p.link[0], p.link[1]] };
        default: return { type: 'wall', at };
      }
    }),
  };
}

/** Niveau JSON v2 -> niveau interne. */
export function fromJson(level) {
  return {
    cols: level.size[0], rows: level.size[1],
    pieces: level.pieces.map((p) => {
      const q = { type: p.type, x: p.at[0], y: p.at[1] };
      if (p.type === 'emitter') { q.dir = DIR_CHARS.indexOf(p.dir); q.mask = fromLetters(p.mask); }
      if (p.type === 'target') q.need = fromLetters(p.need);
      if (p.type === 'mirror' || p.type === 'splitter') q.o = ORIENT_CHARS.indexOf(p.o);
      if (p.type === 'filter') q.mask = fromLetters(p.mask);
      if (p.type === 'portal') q.pair = p.pair;
      if (p.type === 'gate') q.link = [p.link[0], p.link[1]];
      if (p.fixed === true) q.fixed = true;
      return q;
    }),
  };
}

/** Copie profonde d'un niveau interne. */
export function cloneLevel(L) {
  return { cols: L.cols, rows: L.rows, pieces: L.pieces.map((p) => ({ ...p, link: p.link ? [p.link[0], p.link[1]] : undefined })) };
}

/** Pose un jeu de placements du format du fichier (F1/S6) sur la copie d'un niveau interne : les pièces mobiles sont retirées. */
export function withPlacements(L, placements) {
  const pieces = L.pieces.filter((p) => !isMovable(p)).map((p) => ({ ...p }));
  for (const q of placements) {
    const p = { type: q.type, x: q.at[0], y: q.at[1] };
    if (q.o !== undefined) p.o = ORIENT_CHARS.indexOf(q.o);
    if (q.mask !== undefined) p.mask = fromLetters(q.mask);
    pieces.push(p);
  }
  return { cols: L.cols, rows: L.rows, pieces };
}
