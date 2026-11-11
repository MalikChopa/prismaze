// Tables de qualité et budget mémoire des cibles (ARCHITECTURE_V3_RENDU V3-13, V3-12). Module PUR.
// Niveaux : 0 Haut, 1 Moyen, 2 Bas (comme le gouverneur).
export const QUALITY_NAMES = Object.freeze(['Haut', 'Moyen', 'Bas']);

export const QUALITY = Object.freeze([
  Object.freeze({ id: 0, name: 'Haut', dprMax: 2, dprScale: 1, bloomScale: 1 / 2, bloomLevels: 6, particles: 1, pool: 1500, reflection: true, grain: true }),
  Object.freeze({ id: 1, name: 'Moyen', dprMax: 1.5, dprScale: 1, bloomScale: 1 / 4, bloomLevels: 5, particles: 0.5, pool: 750, reflection: true, grain: true }),
  Object.freeze({ id: 2, name: 'Bas', dprMax: 1, dprScale: 0.8, bloomScale: 1 / 4, bloomLevels: 4, particles: 0.22, pool: 330, reflection: false, grain: false }),
]);

export const MAX_TARGET_PIXELS = 3.7e6; // plafond de pixels de cible (V3-12 règle 1)
export const MAX_TARGET_MIB = 80; // plafond de mémoire des cibles (V3-12 règle 2)
export const REBUILD_MIN_MS = 100; // reconstruction au plus 1 fois par 100 ms (V3-13)
const BYTES_SCENE = 8, BYTES_BEAMS = (8 * 4) / 3; // RGBA16F : scène + faisceaux (avec mipmaps)

export function clampQuality(q) {
  return q === 1 || q === 2 ? q : 0;
}

/** Octets par pixel de cible : scène 8 + faisceaux 8·4/3 + pyramide de bloom (RGBA16F, un quart de pixels par niveau). */
export function bytesPerPixel(q) {
  const Q = QUALITY[clampQuality(q)], first = Q.bloomScale * Q.bloomScale;
  let sum = 0;
  for (let i = 0; i < Q.bloomLevels; i++) sum += first * 0.25 ** i;
  return BYTES_SCENE + BYTES_BEAMS + 8 * sum;
}

/** Facteur de résolution effectif (DPR) d'une qualité pour un DPR d'écran : min(DPR, plafond) × échelle. */
export function effectiveDpr(q, rawDpr) {
  const Q = QUALITY[clampQuality(q)];
  return Math.min(rawDpr > 0 ? rawDpr : 1, Q.dprMax) * Q.dprScale;
}

/** MiB de cibles pour un canvas cssW×cssH au DPR effectif `dpr`. */
export function targetMiB(q, cssW, cssH, dpr) {
  return (Math.round(cssW * dpr) * Math.round(cssH * dpr) * bytesPerPixel(q)) / 1048576;
}

/**
 * Résout la qualité demandée (V3-12, dans cet ordre) : (1) DPR plafonné par la qualité, puis facteur de résolution < 1 si les cibles dépassent
 * 3,7 M pixels ; (2) si les cibles dépassent 80 MiB, qualité − 1 (et on recommence).
 * @returns {{quality:number,dpr:number,width:number,height:number,pixels:number,mib:number,scaled:boolean,lowered:boolean}}
 */
export function resolveQuality(requested, cssW, cssH, rawDpr) {
  let q = clampQuality(requested), lowered = false;
  for (;;) {
    let dpr = effectiveDpr(q, rawDpr), scaled = false;
    const px = cssW * dpr * cssH * dpr;
    if (px > MAX_TARGET_PIXELS) { dpr *= Math.sqrt(MAX_TARGET_PIXELS / px); scaled = true; }
    const width = Math.max(1, Math.round(cssW * dpr)), height = Math.max(1, Math.round(cssH * dpr)), mib = (width * height * bytesPerPixel(q)) / 1048576;
    if (mib > MAX_TARGET_MIB && q < 2) { q++; lowered = true; continue; }
    return { quality: q, dpr, width, height, pixels: width * height, mib, scaled, lowered };
  }
}
