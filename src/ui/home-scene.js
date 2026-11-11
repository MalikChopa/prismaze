// V11 : scène vivante de l'accueil (maquette D2, variante 2) : un vrai bout de plateau en Canvas 2D derrière le texte.
// Un émetteur, 2-3 miroirs, un filtre OU le prisme du jeu, des cibles ; parcours générés sur une grille (miroirs à 45°, le prisme envoie
// rouge à gauche, vert tout droit, bleu à droite comme engine/trace.js), lumière calculée par un lancer de rayon continu (un miroir peut
// tourner ou pencher vers le pointeur). Cycle calme d'environ 11 s ; rien ne pulse à plus de 0,5 Hz (V3-20). Rien sous le texte (masque).
// Mouvement réduit : image fixe, parcours allumé, aucune boucle. Onglet caché ou écran du jeu : boucle arrêtée. Tampon plafonné (DPR <= 1,5, <= 1,6 Mpx).

const PI = Math.PI;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const easeIO = (x) => { const v = clamp(x, 0, 1); return v < 0.5 ? 2 * v * v : 1 - ((-2 * v + 2) ** 2) / 2; };
/** Teintes des faisceaux du jeu, par masque de couleur (1 rouge, 2 vert, 4 bleu, 7 blanc). */
export const HUES = ['#000000', '#ff4d6d', '#3dffb0', '#ffd23f', '#4d8dff', '#c26bff', '#3de0ff', '#ffffff'];
const RGB = HUES.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
const rgba = (m, a) => { const c = RGB[m]; return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
const coreCol = (m, a) => { const c = RGB[m]; return `rgba(${Math.round(c[0] * 0.4 + 153)},${Math.round(c[1] * 0.4 + 153)},${Math.round(c[2] * 0.4 + 153)},${a})`; };
const DX = [1, 0, -1, 0], DY = [0, -1, 0, 1];
const HOLD = 7.4, SPEED = 7.5, GS = 5;
/** V13b (n° 13) : marge (en cases) entre le bord de l'écran et le cadre du faisceau ; le halo (0,25 case) reste ainsi à 0,2 case au moins du bord. */
export const BEAM_MARGIN = 0.45;
const PLANS = [['M', 'M', 'F', 'M', 'T'], ['M', 'M', 'P'], ['M', 'F', 'M', 'T'], ['M', 'M', 'M', 'P'], ['M', 'M', 'F', 'T'], ['M', 'P', 'x']];

/** Générateur pseudo-aléatoire (mulberry32) : parcours reproductibles avec une graine. */
export function mulberry(seed) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Parcours sur une grille {cols, rows, ok[]} : liste de pièces {t:'E'|'M'|'F'|'P'|'T', i, j, ...} ou null. Pur (testable sous Node).
 * @param {{cols:number, rows:number, ok:boolean[]}} grid  ok[j*cols+i] : case libre (pas sous le texte)
 * @param {()=>number} rnd
 * @param {boolean} wantPrism  un parcours sur deux montre le prisme
 */
export function generateRoute(grid, rnd, wantPrism) {
  const okc = (i, j) => i >= 0 && j >= 0 && i < grid.cols && j < grid.rows && grid.ok[j * grid.cols + i];
  const free = [];
  for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.cols; i++) if (okc(i, j)) free.push([i, j]);
  if (free.length < 3) return null;
  const shuffle = (arr) => { for (let k = arr.length - 1; k > 0; k--) { const q = Math.floor(rnd() * (k + 1)); [arr[k], arr[q]] = [arr[q], arr[k]]; } return arr; };
  function tryPlan(pl) {
    const e = free[Math.floor(rnd() * free.length)];
    let d = Math.floor(rnd() * 4);
    const occ = new Set(), pcs = [], K = (i, j) => `${i},${j}`;
    let beam = new Set();
    const hasPF = pl.includes('P') || pl.includes('F');
    let m = hasPF ? 7 : [1, 2, 4, 3, 6, 5][Math.floor(rnd() * 6)];
    occ.add(K(e[0], e[1]));
    pcs.push({ t: 'E', i: e[0], j: e[1], d, m });
    const walk = (i, j, dd, L) => {
      const cells = [];
      for (let s = 1; s <= L; s++) { const ni = i + DX[dd] * s, nj = j + DY[dd] * s, k = K(ni, nj); if (!okc(ni, nj) || occ.has(k)) return null; cells.push(k); }
      const last = cells[cells.length - 1];
      if (beam.has(last)) return null;
      for (let c = 0; c < cells.length - 1; c++) beam.add(cells[c]);
      occ.add(last);
      return [i + DX[dd] * L, j + DY[dd] * L];
    };
    let ci = e[0], cj = e[1];
    for (let s = 0; s < pl.length; s++) {
      const step = pl[s];
      if (step === 'x') break;
      const Ls = shuffle(s === 0 ? [1, 2, 3] : grid.cols > 12 ? [3, 4, 5, 6] : [2, 3, 4]); // V13 : segments plus longs sur une grille très large
      if (s > 0) Ls.push(1);
      let at = null;
      for (let q = 0; q < Ls.length && !at; q++) { const b0 = new Set(beam); at = walk(ci, cj, d, Ls[q]); if (!at) beam = b0; }
      if (!at) return null;
      beam.add(K(ci, cj));
      [ci, cj] = at;
      if (step === 'M') {
        const nd = (d + (rnd() < 0.5 ? 1 : 3)) & 3;
        const slash = (d === 0 && nd === 1) || (d === 1 && nd === 0) || (d === 2 && nd === 3) || (d === 3 && nd === 2);
        pcs.push({ t: 'M', i: ci, j: cj, th: slash ? -PI / 4 : PI / 4 });
        d = nd;
      } else if (step === 'F') {
        const opts = [1, 2, 4, 3, 5, 6].filter((f) => (m & f) && (m & f) !== m);
        const f = opts[Math.floor(rnd() * opts.length)];
        pcs.push({ t: 'F', i: ci, j: cj, f });
        m &= f;
      } else if (step === 'T') {
        pcs.push({ t: 'T', i: ci, j: cj, m });
        return pcs;
      } else if (step === 'P') {
        pcs.push({ t: 'P', i: ci, j: cj });
        beam.add(K(ci, cj));
        const br = [[1, (d + 1) & 3], [2, d], [4, (d + 3) & 3]]; // rouge à gauche, vert tout droit, bleu à droite (engine/trace.js)
        for (const [mask, bd] of br) {
          let ok2 = null;
          const LL = shuffle([1, 2, 3]);
          for (let w = 0; w < 3 && !ok2; w++) { const bb = new Set(beam); ok2 = walk(ci, cj, bd, LL[w]); if (!ok2) beam = bb; }
          if (!ok2) return null;
          pcs.push({ t: 'T', i: ok2[0], j: ok2[1], m: mask });
        }
        return pcs;
      }
    }
    return null;
  }
  let best = null, bestS = -1, found = 0;
  for (let a = 0; a < 1400 && found < 24; a++) {
    const pl = PLANS[Math.floor(rnd() * PLANS.length)];
    if (pl.includes('P') !== wantPrism && a < 900) continue;
    const r = tryPlan(pl);
    if (!r) continue;
    found++;
    const xs = r.map((p) => p.i), ys = r.map((p) => p.j);
    // V13 : sur une grille très large (plus de 12 colonnes : écran ultra-large), l'étendue horizontale compte plus (le parcours occupe la largeur)
    const sc = (Math.max(...xs) - Math.min(...xs) + 1) ** (grid.cols > 12 ? 1.6 : 1) * (Math.max(...ys) - Math.min(...ys) + 1) * (0.7 + 0.6 * rnd());
    if (sc > bestS) { bestS = sc; best = r; best.plan = pl.join(''); }
  }
  for (let b = 0; b < 400 && !best; b++) { best = tryPlan(['M', 'T']) || tryPlan(['T']); if (best) best.plan = 'repli'; }
  return best;
}

/**
 * @param {{canvas:HTMLCanvasElement, win:Window, doc:Document, context2d:(c:HTMLCanvasElement)=>CanvasRenderingContext2D, avoid:()=>Element[], textBlock:()=>Element[], seed?:number, onAccent?:(hex:string)=>void}} deps
 *   context2d : fabrique de contextes 2D fournie par main.js (V3-1 : aucun module de src/ui/ n'appelle getContext lui-même) ;
 *   avoid : éléments sous lesquels rien n'est dessiné ; textBlock : bloc de texte (en portrait la scène se place au-dessus)
 */
export function createHomeScene(deps) {
  const { canvas: cv, win, doc } = deps;
  const ctx2d = deps.context2d;
  const ctx = ctx2d(cv);
  const mk = () => doc.createElement('canvas');
  const bgc = mk(), bgx = ctx2d(bgc), mkc = mk(), mkx = ctx2d(mkc), glc = mk(), glx = ctx2d(glc);
  const HAS_F = typeof ctx.filter === 'string';
  let W = 1, H = 1, SC = 1, C = 60, raf = 0, last = 0, hidden = doc.hidden === true, rm = false, active = false, dim = 0, dimT = 0, odd = 0, frozen = false;
  const seed = Number.isInteger(deps.seed) ? deps.seed : (Math.random() * 1e9) | 0;
  const rnd = mulberry(seed);
  let box = { l: 0, t: 0, r: 1, b: 1 }; // V13b (n° 13) : cadre du faisceau, dans l'écran avec une marge : un rayon dévié (miroir qui tourne) s'arrête au bord du cadre, en fondu
  const tmpc = mk(), tmpx = ctx2d(tmpc); // toile de travail de la grille (réutilisée : aucune allocation par mise en page)
  let B = null, P = [], segs = [], hits = [], maxL = 0, ph = 'in', pt = 0, head = 0, tail = 0, alpha = 0, rotM = null, nRoute = 0, plan = '';
  const ptr = { x: -1e5, y: -1e5 };
  let boost = 0, boostT = 0, sparks = [], st = { frames: 0, ms: 0, max: 0 }, ptrOn = false;

  const rectOf = (e) => { const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom } : null; };

  // ---- mise en place : taille des cases, zone libre (hors texte), plateau ----
  function layout(regen = false) {
    W = Math.max(1, win.innerWidth); H = Math.max(1, win.innerHeight);
    SC = Math.min(win.devicePixelRatio || 1, 1.5);
    if (W * H * SC * SC > 1.6e6) SC = Math.sqrt(1.6e6 / (W * H));
    const cw = Math.round(W * SC), ch = Math.round(H * SC);
    // V13b (revue n° 5) : les toiles ne sont réallouées (et effacées) que si leur taille change
    for (const c of [cv, bgc, mkc, tmpc]) if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const gw = Math.ceil(W / GS), gh = Math.ceil(H / GS);
    if (glc.width !== gw || glc.height !== gh) { glc.width = gw; glc.height = gh; }
    C = Math.round(clamp(Math.min(W, H) / 8.2, 40, 132));
    const avoid = deps.avoid().map(rectOf).filter(Boolean);
    const A = avoid.map((r) => { const m = 0.3 * C; return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m }; });
    let tb = null;
    for (const e of deps.textBlock()) { const r = rectOf(e); if (!r) continue; tb = tb ? { l: Math.min(tb.l, r.x), t: Math.min(tb.t, r.y), r: Math.max(tb.r, r.r), b: Math.max(tb.b, r.b) } : { l: r.x, t: r.y, r: r.r, b: r.b }; }
    const m = 0.45 * C;
    const portrait = H > W * 1.1; // téléphone couché (568x320...) : la scène occupe la place libre autour du texte, pas une bande au-dessus
    let fr = { x: m, y: m, w: W - 2 * m, h: H - 2 * m }; // variante 2 : la scène se compose dans tout l'écran autour du bloc de titre
    if (portrait && tb) fr = { x: m, y: m, w: W - 2 * m, h: tb.t - 0.4 * C - m }; // téléphone en portrait : la scène au-dessus du texte
    const rows = Math.max(1, Math.min(Math.floor(Math.max(0, fr.h) / C), portrait ? 11 : 8));
    // V13 (test joueur n° 8) : écran très large (rapport > 2, 3440×1440, 2560×1080) : plus de colonnes, autant que le rapport de l'écran le demande
    // (sinon 12 colonnes au centre laissaient ~40 % de l'écran vide à droite) ; 16:9 et moins : 12 colonnes au plus, comme avant.
    const colCap = W / H > 2 ? 40 : 12;
    const cols = Math.max(1, Math.min(Math.floor(fr.w / C), colCap));
    const nb = { cols, rows, x0: Math.round(fr.x + (fr.w - cols * C) / 2), y0: Math.round(fr.y + (Math.max(fr.h, C) - rows * C) / 2), ok: [] };
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const cx = nb.x0 + i * C, cy = nb.y0 + j * C;
        let ok = cx >= 0 && cy >= 0 && cx + C <= W && cy + C <= H;
        for (let k = 0; ok && k < A.length; k++) { const r = A[k]; if (cx + C * 1.15 > r.x && cx - C * 0.15 < r.x + r.w && cy + C * 1.15 > r.y && cy - C * 0.15 < r.y + r.h) ok = false; }
        nb.ok.push(ok);
      }
    }
    // V13b (revue n° 5, 11) : le parcours n'est refait que si la grille change (taille de case, colonnes, origine) ou si une de ses pièces
    // tombe sous le texte (défilement, bandeau) ; sinon seuls le masque et le fond suivent (aucun parcours qui clignote).
    const geo = JSON.stringify([W, H, C, cols, rows, nb.x0, nb.y0]);
    const changed = !B || B.geo !== geo || P.some((p) => !nb.ok[p.j * cols + p.i]);
    nb.geo = geo; B = nb;
    // V13b (n° 13) : cadre du faisceau = plateau + 0,5 case (la grille dessinée), borné à l'écran moins BEAM_MARGIN cases
    const bm = BEAM_MARGIN * C;
    box = { l: Math.max(bm, nb.x0 - 0.5 * C), t: Math.max(bm, nb.y0 - 0.5 * C), r: Math.min(W - bm, nb.x0 + (cols + 0.5) * C), b: Math.min(H - bm, nb.y0 + (rows + 0.5) * C) };
    buildMask(A); buildBg();
    if (regen || changed || P.length === 0) newRoute(); else retrace();
    if (rm || !raf) draw();
  }
  function buildMask(A) {
    mkx.setTransform(SC, 0, 0, SC, 0, 0); mkx.clearRect(0, 0, W, H); mkx.fillStyle = '#000';
    if (HAS_F) mkx.filter = `blur(${Math.round(0.45 * C * SC * 0.6)}px)`;
    for (const r of A) mkx.fillRect(r.x, r.y, r.w, r.h);
    if (HAS_F) mkx.filter = 'none';
  }
  function buildBg() {
    const x = bgx;
    x.setTransform(SC, 0, 0, SC, 0, 0); x.globalCompositeOperation = 'source-over'; x.fillStyle = '#06061a'; x.fillRect(0, 0, W, H);
    const bw = B.cols * C, bh = B.rows * C, cx = B.x0 + bw / 2, cy = B.y0 + bh / 2, R = Math.max(bw, bh, 1) * 0.75;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, 'rgba(48,52,130,.16)'); g.addColorStop(1, 'rgba(48,52,130,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    // grille du plateau, effacée vers les bords et sous le texte
    const t = tmpc;
    const y = tmpx;
    y.setTransform(1, 0, 0, 1, 0, 0); y.globalCompositeOperation = 'source-over'; y.clearRect(0, 0, t.width, t.height);
    y.setTransform(SC, 0, 0, SC, 0, 0); y.strokeStyle = 'rgba(170,180,255,.07)'; y.lineWidth = 1; y.beginPath();
    for (let i = 0; i <= B.cols; i++) { const px = B.x0 + i * C + 0.5; y.moveTo(px, B.y0 - C * 0.5); y.lineTo(px, B.y0 + bh + C * 0.5); }
    for (let j = 0; j <= B.rows; j++) { const py = B.y0 + j * C + 0.5; y.moveTo(B.x0 - C * 0.5, py); y.lineTo(B.x0 + bw + C * 0.5, py); }
    y.stroke();
    y.globalCompositeOperation = 'destination-in';
    const g2 = y.createRadialGradient(cx, cy, 0, cx, cy, R * 0.95); g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(0.6, 'rgba(0,0,0,.7)'); g2.addColorStop(1, 'rgba(0,0,0,0)'); y.fillStyle = g2; y.fillRect(0, 0, W, H);
    y.globalCompositeOperation = 'destination-out'; y.setTransform(1, 0, 0, 1, 0, 0); y.drawImage(mkc, 0, 0);
    x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(t, 0, 0);
  }

  function newRoute() {
    const r = B ? generateRoute(B, rnd, nRoute % 2 === 1) : null;
    nRoute++;
    P = [];
    if (!r) { segs = []; hits = []; return; }
    plan = r.plan;
    for (const p of r) {
      const o = { t: p.t, i: p.i, j: p.j, x: B.x0 + (p.i + 0.5) * C, y: B.y0 + (p.j + 0.5) * C, lit: 0, rot: 0, tilt: 0, th: p.th || 0, m: p.m || 0, f: p.f || 0, d: p.d || 0 };
      o.r = p.t === 'T' ? 0.42 * C : p.t === 'E' ? 0.36 * C : 0.3 * C;
      P.push(o);
    }
    const ts = P.filter((p) => p.t === 'T');
    if (deps.onAccent) deps.onAccent(HUES[ts.length ? ts[0].m : 7]);
    const ms = P.filter((p) => p.t === 'M');
    rotM = ms.length > 1 ? ms[Math.floor(rnd() * ms.length)] : null;
    if (rm) { ph = 'hold'; pt = 0; head = 1e9; tail = 0; alpha = 1; } else { ph = 'in'; pt = 0; head = 0; tail = 0; alpha = 0; }
    retrace();
    if (rm) litNow();
  }
  function litNow() { for (const p of P) if (p.t === 'T') p.lit = hits.some((h) => h.p === p && h.m === p.m) ? 1 : 0; }

  // ---- lancer de rayon continu ----
  // V13b (n° 13) : un rayon qui ne touche rien s'arrête au cadre `box` (dans l'écran), plus à une case au-delà du bord
  function exitT(x, y, dx, dy) {
    let t = 1e9;
    if (dx > 1e-6) t = Math.min(t, (box.r - x) / dx);
    if (dx < -1e-6) t = Math.min(t, (box.l - x) / dx);
    if (dy > 1e-6) t = Math.min(t, (box.b - y) / dy);
    if (dy < -1e-6) t = Math.min(t, (box.t - y) / dy);
    return Math.max(t, 0);
  }
  function trace(ox, oy, dx, dy, m, l0, skip, depth) {
    if (depth > 16) return;
    let bt = exitT(ox, oy, dx, dy), bp = null;
    const HALF = 0.37 * C;
    for (const p of P) {
      if (p === skip) continue;
      if (p.t === 'M') {
        const th = p.th + p.rot + p.tilt, hx = Math.cos(th) * HALF, hy = Math.sin(th) * HALF, ax = p.x - hx, ay = p.y - hy, ex = 2 * hx, ey = 2 * hy, den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const qx = ax - ox, qy = ay - oy, t = (qx * ey - qy * ex) / den, s = (qx * dy - qy * dx) / den;
        if (t > 1e-3 && s >= 0 && s <= 1 && t < bt) { bt = t; bp = p; }
      } else {
        const qx = p.x - ox, qy = p.y - oy, t = qx * dx + qy * dy;
        if (t <= 1e-3 || t >= bt) continue;
        if (Math.abs(qx * dy - qy * dx) < p.r) { bt = t; bp = p; }
      }
    }
    const x = ox + dx * bt, y = oy + dy * bt, l = l0 + bt;
    segs.push({ ax: ox, ay: oy, bx: x, by: y, m, l0, l1: l, open: !bp }); // open : finit au cadre (dessiné en fondu)
    if (l > maxL) maxL = l;
    if (!bp) return;
    if (bp.t === 'M') { const th = bp.th + bp.rot + bp.tilt, nx = -Math.sin(th), ny = Math.cos(th), dd = dx * nx + dy * ny; trace(x, y, dx - 2 * dd * nx, dy - 2 * dd * ny, m, l, bp, depth + 1); } else if (bp.t === 'P') {
      if (m & 1) trace(x, y, dy, -dx, 1, l, bp, depth + 1);
      if (m & 2) trace(x, y, dx, dy, 2, l, bp, depth + 1);
      if (m & 4) trace(x, y, -dy, dx, 4, l, bp, depth + 1);
    } else if (bp.t === 'F') { const m2 = m & bp.f; if (m2) trace(x, y, dx, dy, m2, l, bp, depth + 1); } else if (bp.t === 'T') hits.push({ p: bp, m, l });
  }
  function retrace() { segs = []; hits = []; maxL = 0; const e = P[0]; if (!e) return; trace(e.x + DX[e.d] * 0.3 * C, e.y + DY[e.d] * 0.3 * C, DX[e.d], DY[e.d], e.m, 0, e, 0); }

  // ---- animation : apparition, le faisceau avance, un miroir tourne puis revient, retrait ----
  function update(dt) {
    pt += dt;
    if (ph === 'in') { alpha = easeIO(pt / 0.7); if (pt >= 0.7) { ph = 'grow'; pt = 0; } } else if (ph === 'grow') { alpha = 1; head += SPEED * C * dt; if (head >= maxL + C) { ph = 'hold'; pt = 0; head = 1e9; } } else if (ph === 'hold') {
      if (rotM) rotM.rot = (PI / 2) * (easeIO((pt - 2.3) / 1.1) + easeIO((pt - 4.7) / 1.1));
      if (pt >= HOLD) { ph = 'out'; pt = 0; tail = 0; head = 1e9; if (rotM) rotM.rot = 0; }
    } else if (ph === 'out') { tail += SPEED * 1.3 * C * dt; alpha = 1 - easeIO((pt - 0.55) / 0.5); if (pt >= 1.05 && tail >= maxL) { newRoute(); return; } }
    let near = null, nd = 2.3 * C;
    if (dimT === 0) for (const p of P) { if (p.t !== 'M') continue; const d = Math.hypot(ptr.x - p.x, ptr.y - p.y); if (d < nd) { nd = d; near = p; } }
    for (const p of P) { if (p.t !== 'M') continue; const tt = p === near ? 0.032 * clamp((ptr.x - p.x + ptr.y - p.y) / (1.6 * C), -1, 1) : 0; p.tilt += (tt - p.tilt) * Math.min(1, dt * 3.5); }
    boost += (boostT - boost) * Math.min(1, dt * 5);
    dim += (dimT - dim) * Math.min(1, dt * 6); if (Math.abs(dimT - dim) < 0.003) dim = dimT;
    retrace();
    for (const p of P) { if (p.t !== 'T') continue; let on = 0; for (const h of hits) if (h.p === p && h.m === p.m && h.l <= head && h.l > tail) on = 1; p.lit += (on - p.lit) * Math.min(1, dt * 5); }
    for (let i = sparks.length - 1; i >= 0; i--) { sparks[i].l += 13 * C * dt; if (sparks[i].l > maxL) sparks.splice(i, 1); }
  }

  // ---- dessin ----
  const vis = (s) => { const a = Math.max(s.l0, tail), b = Math.min(s.l1, head); if (b <= a) return null; const L = (s.l1 - s.l0) || 1, u0 = (a - s.l0) / L, u1 = (b - s.l0) / L; return [s.ax + (s.bx - s.ax) * u0, s.ay + (s.by - s.ay) * u0, s.ax + (s.bx - s.ax) * u1, s.ay + (s.by - s.ay) * u1]; };
  /** Couleur d'un trait : unie, ou en fondu sur la dernière case d'un rayon qui finit au cadre (V13b, n° 13 : pas de coupure nette). */
  function ink(c, q, a, col) {
    const s = q[2];
    if (!s.open) return col(q[1], a);
    const L = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1, f = Math.min(1, C / L);
    const g = c.createLinearGradient(s.bx - (s.bx - s.ax) * f, s.by - (s.by - s.ay) * f, s.bx, s.by);
    g.addColorStop(0, col(q[1], a)); g.addColorStop(1, col(q[1], 0));
    return g;
  }
  const line = (c, v) => { c.beginPath(); c.moveTo(v[0], v[1]); c.lineTo(v[2], v[3]); c.stroke(); };
  function sym(c, m, x, y, r) { // symbole de couleur du jeu (▲ ● ■ ✚ ◆ ✦, anneau pour le blanc)
    c.beginPath();
    if (m === 1) { c.moveTo(x, y - r); c.lineTo(x + r * 0.95, y + r * 0.7); c.lineTo(x - r * 0.95, y + r * 0.7); c.closePath(); } else if (m === 2) c.arc(x, y, r * 0.8, 0, 2 * PI);
    else if (m === 4) c.rect(x - r * 0.7, y - r * 0.7, r * 1.4, r * 1.4);
    else if (m === 3) { const w = r * 0.32; c.rect(x - w, y - r * 0.85, 2 * w, 1.7 * r); c.rect(x - r * 0.85, y - w, 1.7 * r, 2 * w); } else if (m === 5) { c.moveTo(x, y - r); c.lineTo(x + r * 0.8, y); c.lineTo(x, y + r); c.lineTo(x - r * 0.8, y); c.closePath(); } else if (m === 6) { for (let k = 0; k < 8; k++) { const a = (k * PI) / 4 - PI / 2, rr = k % 2 ? r * 0.38 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); } else { c.arc(x, y, r * 0.8, 0, 2 * PI); c.arc(x, y, r * 0.45, 0, 2 * PI, true); }
    c.fill();
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function tile(c, x, y) { const i = 0.1 * C; rr(c, x - C / 2 + i, y - C / 2 + i, C - 2 * i, C - 2 * i, 0.13 * C); c.fillStyle = 'rgba(170,178,255,.045)'; c.fill(); c.lineWidth = 1; c.strokeStyle = 'rgba(170,180,255,.16)'; c.stroke(); }
  function drawPiece(c, p, T) {
    const u = C / 62, x = p.x, y = p.y;
    if (p.t === 'M') {
      tile(c, x, y);
      const th = p.th + p.rot + p.tilt, h = 0.31 * C, hx = Math.cos(th) * h, hy = Math.sin(th) * h;
      c.lineCap = 'round'; c.beginPath(); c.moveTo(x - hx, y - hy); c.lineTo(x + hx, y + hy);
      c.strokeStyle = 'rgba(185,192,255,.28)'; c.lineWidth = 0.13 * C; c.stroke(); c.strokeStyle = '#fff'; c.lineWidth = Math.max(2, 0.065 * C); c.stroke();
    } else if (p.t === 'P') {
      const s = 0.92 * u, g = c.createLinearGradient(x - 24 * s, y - 20 * s, x + 26 * s, y + 20 * s);
      g.addColorStop(0, 'rgba(217,221,255,.7)'); g.addColorStop(0.5, 'rgba(143,148,232,.55)'); g.addColorStop(1, 'rgba(60,63,146,.8)');
      const tri = () => { c.beginPath(); c.moveTo(x - 24 * s, y + 20 * s); c.lineTo(x + 26 * s, y); c.lineTo(x - 24 * s, y - 20 * s); c.closePath(); };
      tri(); c.fillStyle = g; c.fill(); c.save(); c.clip(); c.globalAlpha *= 0.42;
      [1, 2, 4].forEach((m, k) => { c.fillStyle = HUES[m]; c.fillRect(x + 4 * s, y + (k - 1.5) * 6 * s, 24 * s, 6 * s); });
      c.restore();
      c.lineWidth = Math.max(1, 1.4 * s); c.strokeStyle = '#e8ebff'; tri(); c.stroke();
      c.beginPath(); c.moveTo(x - 24 * s, y + 20 * s); c.lineTo(x + 8 * s, y - 4 * s); c.strokeStyle = 'rgba(255,255,255,.45)'; c.stroke();
    } else if (p.t === 'F') {
      const i = 7 * u, w = C - 2 * i, X = x - C / 2, Y = y - C / 2, hue = HUES[p.f];
      rr(c, X + i, Y + i, w, w, 7 * u);
      const ga = c.globalAlpha; c.globalAlpha = ga * 0.24; c.fillStyle = hue; c.fill(); c.globalAlpha = ga;
      c.save(); c.clip(); const a = 0.34 * C; c.beginPath(); c.moveTo(x - a, y - a); c.lineTo(x + a, y + a); c.moveTo(x + a, y - a); c.lineTo(x - a, y + a); c.lineWidth = Math.max(1, 1.4 * u); c.strokeStyle = 'rgba(6,7,20,.45)'; c.stroke(); c.restore();
      rr(c, X + i, Y + i, w, w, 7 * u); c.lineWidth = Math.max(1.2, 1.6 * u); c.strokeStyle = hue; c.stroke();
      c.fillStyle = 'rgba(6,7,20,.75)'; sym(c, p.f, x, y, 10 * u); c.fillStyle = hue; sym(c, p.f, x, y, 8.5 * u);
    } else if (p.t === 'T') {
      const R = 19 * u, hue = HUES[p.m], L = p.lit;
      c.beginPath(); for (let k = 0; k < 6; k++) { const an = -PI / 2 + (k * PI) / 3; c.lineTo(x + Math.cos(an) * R, y + Math.sin(an) * R); } c.closePath();
      c.fillStyle = '#0b0c2f'; c.fill();
      if (L > 0.01) { const ga = c.globalAlpha; c.globalAlpha = ga * L * (0.86 + 0.1 * Math.sin(T * PI)); c.fillStyle = hue; c.fill(); c.globalAlpha = ga; } // pulsation 0,5 Hz, faible
      c.lineWidth = Math.max(1.4, 1.8 * u); c.strokeStyle = hue; c.stroke();
      c.fillStyle = L > 0.5 ? '#06061a' : hue; sym(c, p.m, x, y, 8.5 * u);
    } else if (p.t === 'E') {
      const A = [0, -PI / 2, PI, PI / 2][p.d];
      c.save(); c.translate(x, y); c.rotate(A); c.beginPath(); c.moveTo(-24 * u, -15 * u); c.lineTo(-4 * u, -22 * u); c.lineTo(10 * u, 0); c.lineTo(-4 * u, 22 * u); c.lineTo(-24 * u, 15 * u); c.closePath();
      c.fillStyle = '#0d0e2a'; c.fill(); c.lineWidth = Math.max(1.4, 1.8 * u); c.strokeStyle = HUES[p.m]; c.stroke(); c.restore();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 4.6 * u, 0, 2 * PI); c.fill();
    }
  }
  let clock = 0; // secondes de la scène (pulsation des cibles) : avance avec update, pas avec l'horloge murale (images reproductibles)
  function draw() {
    const T = clock, c = ctx;
    c.setTransform(SC, 0, 0, SC, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.clearRect(0, 0, W, H);
    const I = rm ? 1 : 1 + 0.32 * boost;
    // halo large : dessiné petit puis agrandi (flou gratuit)
    glx.setTransform(1 / GS, 0, 0, 1 / GS, 0, 0); glx.globalCompositeOperation = 'source-over'; glx.clearRect(0, 0, W, H); glx.globalCompositeOperation = 'lighter'; glx.lineCap = 'round';
    const V = [];
    for (const s of segs) { const v = vis(s); if (v) V.push([v, s.m, s]); }
    if (HAS_F) glx.filter = 'blur(3px)';
    for (const q of V) { glx.strokeStyle = ink(glx, q, (q[1] === 7 ? 0.3 : 0.42) * I * alpha, rgba); glx.lineWidth = 0.5 * C; line(glx, q[0]); }
    for (const p of P) if (p.t === 'T' && p.lit > 0.01) { glx.fillStyle = rgba(p.m, 0.42 * p.lit * alpha * (0.9 + 0.1 * Math.sin(T * PI))); glx.beginPath(); glx.arc(p.x, p.y, 0.5 * C, 0, 2 * PI); glx.fill(); }
    if (HAS_F) glx.filter = 'none';
    c.globalCompositeOperation = 'lighter'; c.imageSmoothingEnabled = true; c.drawImage(glc, 0, 0, W, H);
    c.lineCap = 'round';
    for (const q of V) { const v = q[0]; c.strokeStyle = ink(c, q, 0.26 * I * alpha, rgba); c.lineWidth = 0.075 * C; line(c, v); c.strokeStyle = ink(c, q, 0.95 * alpha, coreCol); c.lineWidth = Math.max(1.4, 0.034 * C); line(c, v); }
    // tête du faisceau qui avance, étincelles du survol
    const dots = [];
    if (ph === 'grow') for (const s of segs) if (head >= s.l0 && head <= s.l1) { const u = (head - s.l0) / ((s.l1 - s.l0) || 1); dots.push([s.ax + (s.bx - s.ax) * u, s.ay + (s.by - s.ay) * u, s.m, 0.9]); }
    for (const k of sparks) for (const s of segs) if (k.l >= s.l0 && k.l <= s.l1 && k.l <= head && k.l > tail) { const u = (k.l - s.l0) / ((s.l1 - s.l0) || 1); dots.push([s.ax + (s.bx - s.ax) * u, s.ay + (s.by - s.ay) * u, s.m, 0.85]); }
    for (const d of dots) { const g = c.createRadialGradient(d[0], d[1], 0, d[0], d[1], 0.24 * C); g.addColorStop(0, `rgba(255,255,255,${d[3] * alpha})`); g.addColorStop(0.3, rgba(d[2], 0.5 * d[3] * alpha)); g.addColorStop(1, rgba(d[2], 0)); c.fillStyle = g; c.fillRect(d[0] - 0.25 * C, d[1] - 0.25 * C, 0.5 * C, 0.5 * C); }
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = alpha;
    for (const p of P) drawPiece(c, p, T);
    c.globalAlpha = 1;
    // rien sous le texte : effacement doux, puis le fond passe dessous
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'destination-out'; c.drawImage(mkc, 0, 0);
    c.globalCompositeOperation = 'destination-over'; c.drawImage(bgc, 0, 0);
    c.globalCompositeOperation = 'source-over';
    if (dim > 0) { c.fillStyle = `rgba(6,6,26,${dim * 0.9})`; c.fillRect(0, 0, cv.width, cv.height); }
  }
  function step(dt) { clock += dt; update(dt); draw(); }
  /** V13b (n° 13) : étendue de ce qui est dessiné (px CSS) : faisceau (tracé entier, halo de 0,25 case compris) et cases des pièces ; marge minimale au bord de l'écran. */
  function bounds() {
    const e = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
    const add = (x0, y0, x1, y1) => { e.l = Math.min(e.l, x0); e.t = Math.min(e.t, y0); e.r = Math.max(e.r, x1); e.b = Math.max(e.b, y1); };
    const h = 0.25 * C;
    for (const s of segs) add(Math.min(s.ax, s.bx) - h, Math.min(s.ay, s.by) - h, Math.max(s.ax, s.bx) + h, Math.max(s.ay, s.by) + h);
    for (const p of P) add(p.x - C / 2, p.y - C / 2, p.x + C / 2, p.y + C / 2);
    if (e.l === Infinity) return { W, H, extent: null, margin: null, open: 0 };
    const r1 = (v) => Math.round(v * 10) / 10;
    return { W, H, extent: [r1(e.l), r1(e.t), r1(e.r), r1(e.b)], margin: r1(Math.min(e.l, e.t, W - e.r, H - e.b)), open: segs.filter((s) => s.open).length };
  }
  function frame(now) {
    raf = 0;
    if (hidden || rm || !active || frozen) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (dimT > 0 && dim === dimT && (odd ^= 1)) { raf = win.requestAnimationFrame(frame); return; } // derrière un sous-écran : une image sur deux
    const t0 = win.performance.now();
    step(dt);
    const ms = win.performance.now() - t0;
    st.frames++; st.ms += ms; if (ms > st.max) st.max = ms;
    raf = win.requestAnimationFrame(frame);
  }
  function kick() { if (!raf && !hidden && !rm && active && !frozen) { last = 0; raf = win.requestAnimationFrame(frame); } }
  function halt() { if (raf) win.cancelAnimationFrame(raf); raf = 0; }
  const onVis = () => { hidden = doc.hidden === true; if (hidden) halt(); else kick(); };
  const onMove = (e) => { ptr.x = e.clientX; ptr.y = e.clientY; };
  const onLeave = () => { ptr.x = -1e5; ptr.y = -1e5; };
  doc.addEventListener('visibilitychange', onVis);

  return {
    /** Montre la scène (écrans de l'accueil) ou l'arrête (jeu, éditeur) : aucune boucle quand elle n'est pas vue. */
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) {
        if (!ptrOn) { win.addEventListener('pointermove', onMove, { passive: true }); doc.addEventListener('pointerleave', onLeave); ptrOn = true; }
        layout(false); kick();
      } else {
        halt();
        if (ptrOn) { win.removeEventListener('pointermove', onMove); doc.removeEventListener('pointerleave', onLeave); ptrOn = false; }
        onLeave();
      }
    },
    layout(regen = false) { if (active) layout(regen); },
    /** Assombrit la scène derrière un sous-écran (1) ou la montre (0). */
    setDim(v) { dimT = v; if (rm || !raf) { dim = v; if (active) draw(); } },
    setReducedMotion(v) {
      rm = v === true;
      if (rm) { halt(); ph = 'hold'; head = 1e9; tail = 0; alpha = 1; sparks = []; for (const p of P) { p.rot = 0; p.tilt = 0; } dim = dimT; retrace(); litNow(); if (active) draw(); } else kick();
    },
    /** Survol d'une entrée : le faisceau s'avive et une étincelle le parcourt. */
    hover(on) { boostT = on ? 1 : 0; if (on && !rm && ph === 'hold' && sparks.length < 2) sparks.push({ l: 0 }); },
    get running() { return raf !== 0; },
    // ---- essais (?debug) : horloge prise en main, état lisible ----
    freeze(on) { frozen = on === true; if (frozen) halt(); else kick(); },
    step(dt) { step(dt); },
    /** V13b (n° 13, essais) : fait avancer la scène de `seconds` (pas `dt`, sans dessin intermédiaire) et renvoie la marge minimale vue au bord de l'écran. */
    probe(seconds = 36, dt = 1 / 30) {
      let margin = Infinity, open = 0, routes = nRoute, frames = 0;
      for (let tt = 0; tt < seconds; tt += dt) { clock += dt; update(dt); frames++; const b = bounds(); if (b.margin !== null) margin = Math.min(margin, b.margin); open = Math.max(open, b.open); }
      draw();
      return { margin: margin === Infinity ? null : margin, open, routes: nRoute - routes, frames, C, W, H };
    },
    stats() {
      return { seed, route: nRoute, plan, phase: ph, C, cols: B && B.cols, rows: B && B.rows, free: B ? B.ok.filter(Boolean).length : 0, pieces: P.map((p) => p.t).join(''), lit: P.filter((p) => p.t === 'T' && p.lit > 0.5).length,
        tilt: Number(Math.max(0, ...P.map((p) => Math.abs(p.tilt))).toFixed(4)), boost: Number(boost.toFixed(2)), dim: Number(dim.toFixed(2)), buffer: [cv.width, cv.height], frames: st.frames, msAvg: st.frames ? Number((st.ms / st.frames).toFixed(3)) : 0, msMax: Number(st.max.toFixed(2)), running: raf !== 0,
        mirrors: P.filter((p) => p.t === 'M').map((p) => [Math.round(p.x), Math.round(p.y)]), pieceRects: P.map((p) => [Math.round(p.x - C / 2), Math.round(p.y - C / 2), C, C]),
        bounds: bounds() };
    },
    resetStats() { st = { frames: 0, ms: 0, max: 0 }; },
  };
}
