// Analyseur de flashs (ARCHITECTURE_V3_RENDU V3-20). Approximation prudente de WCAG 2.3.1, PAS un test certifié (aucun outil PEAT utilisé).
// Entrée : suite d'images 60 i/s réduites à 64x36 blocs, chaque bloc = couleur LINÉAIRE moyenne des pixels du bloc (sRGB exact, seuil 0,04045).
// Flash général : paire de changements opposés >= 0,1 de luminance relative dont l'image la plus sombre est < 0,80 (zigzag par bloc). Flash rouge : transitions vers/depuis un rouge saturé
// (R/(R+G+B) >= 0,8, écart u'v' > 0,2). Bloc « en flash » : plus de 6 changements (3 flashs) sur 1 s glissante. Surface : blocs en flash dans le rectangle glissant 21x12 (1/3 x 1/3 de l'écran) ; échec au-delà de 63 blocs (25 %), alerte à 20 %.
export const GW = 64, GH = 36, FPS = 60, RW = 21, RH = 12, LIMIT = 0.25, WARN = 0.20;

/** sRGB 8 bits -> linéaire (fonction exacte, seuil 0,04045). */
export function srgb8ToLinear(v) {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}
const LUT = Float32Array.from({ length: 256 }, (_, v) => srgb8ToLinear(v));
export const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Réduit une image RGBA8 (lignes de haut en bas ou de bas en haut : indifférent pour la surface) en GW x GH blocs de couleur linéaire moyenne (3 flottants par bloc). */
export function reduceToBlocks(rgba, w, h, out = new Float32Array(GW * GH * 3)) {
  const counts = new Float32Array(GW * GH), sums = new Float64Array(GW * GH * 3);
  for (let y = 0; y < h; y++) {
    const by = Math.min(GH - 1, Math.floor((y * GH) / h));
    for (let x = 0; x < w; x++) {
      const bx = Math.min(GW - 1, Math.floor((x * GW) / w)), b = by * GW + bx, o = (y * w + x) * 4;
      sums[b * 3] += LUT[rgba[o]]; sums[b * 3 + 1] += LUT[rgba[o + 1]]; sums[b * 3 + 2] += LUT[rgba[o + 2]]; counts[b]++;
    }
  }
  for (let b = 0; b < GW * GH; b++) { const n = counts[b] || 1; out[b * 3] = sums[b * 3] / n; out[b * 3 + 1] = sums[b * 3 + 1] / n; out[b * 3 + 2] = sums[b * 3 + 2] / n; }
  return out;
}

function uv(r, g, b) {
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b, Y = lum(r, g, b), Z = 0.0193 * r + 0.1192 * g + 0.9505 * b, d = X + 15 * Y + 3 * Z;
  return d > 1e-9 ? [(4 * X) / d, (9 * Y) / d] : null;
}
const isRed = (r, g, b) => { const s = r + g + b; return s > 1e-6 && r / s >= 0.8; };

/**
 * Zigzag (V9b, audit G1) : `hi`/`lo` suivis dès l'image 0 ; le 1er extrême est fixé quand hi − lo >= thr (celui des deux vu en premier),
 * puis chaque extrême est confirmé quand le signal en repart de thr. La dernière transition en cours (amplitude >= thr) compte aussi.
 * Renvoie les indices (image de l'extrême atteint) des changements dont l'image la plus sombre est < 0,80.
 */
function generalChanges(L, thr = 0.1) {
  const out = [], T = L.length;
  if (T === 0) return out;
  let hi = L[0], hiI = 0, lo = L[0], loI = 0, dir = 0, ext = 0, extI = 0, last = 0;
  const push = (a, b, i) => { if (Math.min(a, b) < 0.8) out.push(i); };
  for (let i = 1; i < T; i++) {
    const v = L[i];
    if (dir === 0) {
      if (v > hi) { hi = v; hiI = i; }
      if (v < lo) { lo = v; loI = i; }
      if (hi - lo >= thr) { if (loI < hiI) { last = lo; dir = 1; ext = hi; extI = hiI; } else { last = hi; dir = -1; ext = lo; extI = loI; } }
      continue;
    }
    if (dir === 1) {
      if (v > ext) { ext = v; extI = i; } else if (ext - v >= thr) { push(ext, last, extI); last = ext; dir = -1; ext = v; extI = i; }
    } else if (v < ext) { ext = v; extI = i; } else if (v - ext >= thr) { push(ext, last, extI); last = ext; dir = 1; ext = v; extI = i; }
  }
  if (dir !== 0 && Math.abs(ext - last) >= thr) push(ext, last, extI); // transition en cours à la fin de la suite
  return out;
}

/**
 * Flash rouge (V9b, audit G1) : la suite est découpée en segments « rouge saturé » / « non » ; chaque transition est jugée entre l'extrême
 * du segment précédent et celui du suivant (le plus rouge d'un segment rouge, le moins rouge de l'autre), et non entre deux images voisines :
 * une rampe de quelques images est vue comme la coupure nette. Compte si l'écart u'v' > 0,2. Renvoie l'indice de la 1re image de chaque segment d'arrivée.
 */
function redChanges(C, T) {
  const segs = []; // {red, start, best:[r,g,b] | null, score}
  for (let t = 0; t < T; t++) {
    const r = C[t * 3], g = C[t * 3 + 1], b = C[t * 3 + 2], s = r + g + b, red = isRed(r, g, b);
    let cur = segs.length ? segs[segs.length - 1] : null;
    if (cur === null || cur.red !== red) { cur = { red, start: t, best: null, score: -Infinity }; segs.push(cur); }
    if (s > 1e-6 && uv(r, g, b) !== null) { const ratio = r / s, score = red ? ratio : -ratio; if (score > cur.score) { cur.score = score; cur.best = [r, g, b]; } }
  }
  const tr = [];
  for (let k = 1; k < segs.length; k++) {
    const a = segs[k - 1].best, c = segs[k].best;
    if (a === null || c === null) continue;
    const ua = uv(a[0], a[1], a[2]), uc = uv(c[0], c[1], c[2]);
    if (Math.hypot(ua[0] - uc[0], ua[1] - uc[1]) > 0.2) tr.push(segs[k].start);
  }
  return tr;
}

/** Plus grande somme d'un rectangle RW x RH de blocs drapeau (table cumulée). */
function maxRect(flag) {
  const S = new Int32Array((GW + 1) * (GH + 1));
  for (let y = 0; y < GH; y++) {
    let row = 0;
    for (let x = 0; x < GW; x++) { row += flag[y * GW + x]; S[(y + 1) * (GW + 1) + x + 1] = S[y * (GW + 1) + x + 1] + row; }
  }
  let best = 0;
  for (let y = 0; y + RH <= GH; y++) for (let x = 0; x + RW <= GW; x++) {
    const s = S[(y + RH) * (GW + 1) + x + RW] - S[y * (GW + 1) + x + RW] - S[(y + RH) * (GW + 1) + x] + S[y * (GW + 1) + x];
    if (s > best) best = s;
  }
  return best;
}

/**
 * @param {Float32Array[]} frames  images de GW*GH*3 flottants linéaires (voir reduceToBlocks)
 * @returns {{frames:number, general:{area:number,fail:boolean,warn:boolean,maxChangesPerSec:number,failFrame:number}, red:object, meanLumaMin:number, meanLumaMax:number, lumaStepMax:number, lumaStepFrame:number, lumaStepOk:boolean, pass:boolean}}
 */
export function analyse(frames, { fps = FPS } = {}) {
  const T = frames.length, nb = GW * GH;
  const limit = LIMIT * RW * RH;
  const general = new Array(nb), red = new Array(nb);
  const L = new Float64Array(T), C = new Float64Array(T * 3);
  for (let b = 0; b < nb; b++) {
    for (let t = 0; t < T; t++) {
      const r = frames[t][b * 3], g = frames[t][b * 3 + 1], bb = frames[t][b * 3 + 2];
      C[t * 3] = r; C[t * 3 + 1] = g; C[t * 3 + 2] = bb; L[t] = lum(r, g, bb);
    }
    general[b] = generalChanges(L); red[b] = redChanges(C, T);
  }
  const res = { frames: T };
  for (const [name, ev] of [['general', general], ['red', red]]) {
    let area = 0, maxPer = 0, failFrame = -1;
    for (let t = 0; t < T; t++) {
      const flag = new Uint8Array(nb);
      let any = false;
      for (let b = 0; b < nb; b++) { let n = 0; for (const f of ev[b]) if (f <= t && f > t - fps) n++; if (n > maxPer) maxPer = n; if (n > 6) { flag[b] = 1; any = true; } }
      if (!any) continue;
      const best = maxRect(flag), frac = best / (RW * RH);
      if (frac > area) area = frac;
      if (best > limit && failFrame < 0) failFrame = t;
    }
    res[name] = { area: Math.round(area * 1000) / 1000, fail: failFrame >= 0, warn: area >= WARN, maxChangesPerSec: maxPer, failFrame };
  }
  // critère (c) : variation de la luminance moyenne d'une image à l'autre
  let prev = -1, stepMax = 0, stepFrame = -1, lmin = Infinity, lmax = -Infinity;
  for (let t = 0; t < T; t++) {
    let s = 0;
    for (let b = 0; b < nb; b++) s += lum(frames[t][b * 3], frames[t][b * 3 + 1], frames[t][b * 3 + 2]);
    const m = s / nb;
    if (m < lmin) lmin = m;
    if (m > lmax) lmax = m;
    if (t > 0 && Math.abs(m - prev) > stepMax) { stepMax = Math.abs(m - prev); stepFrame = t; }
    prev = m;
  }
  res.meanLumaMin = lmin; res.meanLumaMax = lmax; res.lumaStepMax = stepMax; res.lumaStepFrame = stepFrame; res.lumaStepOk = stepMax <= 0.05;
  res.pass = !res.general.fail && !res.red.fail && res.lumaStepOk;
  return res;
}

/** Diagnostic (V9b) : changements du flash général d'une suite de luminances (mêmes règles que `analyse`). */
export const generalChangesOf = (L) => generalChanges(L);
