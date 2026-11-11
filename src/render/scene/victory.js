// Chronologie de la victoire (ARCHITECTURE_V3_RENDU V3-27, P4, P11). Module PUR : le temps est une entrée (ms depuis la fin du geste), aucun DOM ni GL.
// `victoryFrame(t)` donne l'état continu (onde, flash, gain, panneau, focus, montée du plateau) ; `victoryEvents(t0, t1)` les gerbes émises entre deux instants.
// Déterministe : mêmes (t, graine, saut) -> mêmes valeurs. Aucun Math.random.
export const VICTORY = Object.freeze({
  END_MS: 3600, WAVE_MS: 2600, WAVE_SPEED: 1.05, FLASH_MS: 350, FLASH_IN_MS: 90, WAVE_IN_MS: 140, GAIN: 0.32, GAIN_RISE_MS: 600, GAIN_FALL_FROM: 2600,
  PANEL_MS: 1300, FOCUS_DELAY_MS: 350, RISE_MS: 450, RISE_DURATION_MS: 850,
  SKIP_MIN_MS: 300, SKIP_FADE_MS: 300, REDUCED_PANEL_MS: 150,
  BURST0_MS: 40, BURST0_N: 80, STARS0_N: 30, BURST1_MS: 450, BURST1_N: 30, STARS1_N: 16, RAIN_FROM_MS: 550, RAIN_EVERY_MS: 420, RAIN_N: 26,
  REDUCED_GLOW: 0.30, REDUCED_GAIN: 1.12,
});

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mix32 = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ b; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; };

/**
 * État continu de la victoire à l'instant t (ms).
 * @param {number} t  ms depuis la fin du geste gagnant (>= 0)
 * @param {{reduced?:boolean, skipAt?:number|null}} [o]  skipAt : instant du saut (P11), ou null
 * @returns {{t:number,wave:number,waveR:number,flash:number,gain:number,glow:number,expo:number,bloom:number,panel:boolean,focus:boolean,rise:boolean,end:boolean,fade:number,skipped:boolean}}
 */
export function victoryFrame(t, o = {}) {
  const reduced = o.reduced === true, skipAt = o.skipAt ?? null, V = VICTORY;
  if (reduced) { // V3-27 : ni onde, ni flash, ni poussée, ni montée animée, aucune particule ; halo fixe, panneau à 150 ms
    const panel = t >= V.REDUCED_PANEL_MS;
    return { t, wave: 0, waveR: 0, flash: 0, gain: V.REDUCED_GAIN, glow: V.REDUCED_GLOW, expo: 1, bloom: 1, panel, focus: panel, rise: true, end: panel, fade: 0, skipped: false };
  }
  const skipped = skipAt !== null && t >= skipAt;
  const eff = skipped ? Math.max(t, V.PANEL_MS) : t; // un saut mène la chronologie à t = 1 300 (P11) ; sans lui elle suit t
  const fade = skipped ? clamp01(1 - (t - skipAt) / V.SKIP_FADE_MS) : 1; // onde, flash, particules et gain s'éteignent en 300 ms après un saut
  const waveIn = Math.min(1, t / V.WAVE_IN_MS), flashIn = Math.min(1, t / V.FLASH_IN_MS);
  const wave = eff < V.WAVE_MS ? (1 - eff / V.WAVE_MS) * waveIn * fade : 0; // montées courtes : V3-20 (c) limite la variation de luminance moyenne à 0,05 par image
  const flash = t < V.FLASH_MS ? (1 - t / V.FLASH_MS) * flashIn * fade : 0;
  const rise01 = clamp01(eff / V.GAIN_RISE_MS), fall = clamp01((V.END_MS - eff) / (V.END_MS - V.GAIN_FALL_FROM));
  const wg = rise01 * fall * fade; // enveloppe : monte en 600 ms, redescend vers 1 à 3 600 ms
  const gain = 1 + V.GAIN * wg, glow = wg * (0.55 + 0.25 * Math.exp(-eff / 1000 * 0.6)) * 0.5;
  const panel = eff >= V.PANEL_MS, focus = skipped || t >= V.PANEL_MS + V.FOCUS_DELAY_MS;
  const rise = eff >= V.RISE_MS;
  return { t, wave, waveR: (eff / 1000) * V.WAVE_SPEED, flash, gain, glow, expo: 1.05 + 0.1 * wg, bloom: 0.9 + 0.35 * wg + 0.1 * (1 - wg), panel, focus, rise, end: skipped ? fade <= 0 : eff >= V.END_MS, fade, skipped };
}

/** Indice de cible tiré pour la k-ième gerbe de pluie (déterministe, à graine). */
function rainTarget(seed, k, n) { return n > 0 ? mix32(seed, k) % n : 0; }

/**
 * Gerbes émises dans l'intervalle (t0, t1] (ms). Aucune en mouvement réduit, aucune après un saut.
 * @param {{seed?:number, targets?:number, reduced?:boolean, skipAt?:number|null}} [o]
 * @returns {Array<{t:number, type:'all'|'half'|'one'|'stars', n:number, speed:number, big:boolean, target?:number}>} ordre chronologique
 */
export function victoryEvents(t0, t1, o = {}) {
  const V = VICTORY, seed = o.seed || 1, nt = o.targets || 0, skipAt = o.skipAt ?? null, ev = [];
  if (o.reduced === true || !(t1 > t0)) return ev;
  const end = skipAt !== null ? Math.min(t1, skipAt - 1e-6) : t1;
  if (t0 < V.BURST0_MS && end >= V.BURST0_MS) ev.push({ t: V.BURST0_MS, type: 'all', n: V.BURST0_N, speed: 4.2, big: true }, { t: V.BURST0_MS, type: 'stars', n: V.STARS0_N, speed: 8, big: false });
  if (t0 < V.BURST1_MS && end >= V.BURST1_MS) ev.push({ t: V.BURST1_MS, type: 'stars', n: V.STARS1_N, speed: 5.5, big: false }, { t: V.BURST1_MS, type: 'half', n: V.BURST1_N, speed: 3, big: false });
  for (let k = 0; ; k++) {
    const tk = V.RAIN_FROM_MS + k * V.RAIN_EVERY_MS;
    if (tk >= V.END_MS || tk > end) break;
    if (tk > t0 && nt > 0) { // V9b (V3-20) : l'anneau de choc d'une pluie ne revient jamais sur la cible de la pluie précédente (sinon 2,4 anneaux/s au même endroit)
      const target = rainTarget(seed, k, nt);
      ev.push({ t: tk, type: 'one', n: V.RAIN_N, speed: 3.2, big: k === 0 || target !== rainTarget(seed, k - 1, nt), target });
    }
  }
  return ev;
}

/** Temps nécessaire (ms) avant la fin de la victoire pour le jeu : horloge de la coque (panneau, focus). */
export function victoryDurationMs(reduced) {
  return reduced === true ? VICTORY.REDUCED_PANEL_MS : VICTORY.END_MS;
}

/** Plafond sûr du zoom de la poussée (V3-38, V5 #5) : `zoomRest` ≤ ce plafond, jamais moins que 1,03 (ce que V3-38 garantit toujours). */
export function pushCeiling(zoomFree) {
  return Math.max(1.03, zoomFree > 0 ? zoomFree : 1.03);
}

// V9b (audit B1, V3-20 c) : l'éclair et l'onde sont des taches gaussiennes exp(-5 r²) mesurées en hauteurs d'écran (FS_COMP). Sur un écran étroit
// (téléphone en portrait) la tache couvre une bien plus grande part de l'image qu'à 16/9 : la luminance moyenne montait 2,5 fois plus vite (pas de 0,06 par image).
// `screenWeight(aspect)` ramène la part d'écran éclairée à celle du 16/9 de référence ; 1 pour tout écran en paysage (aspect ≥ 1), < 1 en portrait.
/** V9b (Diapason, V3-20) : en portrait, les effets de victoire (gerbes, étoiles, pluie) sont plafonnés au niveau Bas quelle que soit la qualité. */
export const NARROW_FX_QUALITY = 2;
const ERF_A = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
function erf(x) { // Abramowitz-Stegun 7.1.26 (erreur < 1,5e-7), x >= 0
  const t = 1 / (1 + 0.3275911 * x);
  return 1 - ((((ERF_A[4] * t + ERF_A[3]) * t + ERF_A[2]) * t + ERF_A[1]) * t + ERF_A[0]) * t * Math.exp(-x * x);
}
/** Part moyenne (par unité de largeur) d'une gaussienne exp(-5 x²) centrée sur un écran de largeur `aspect` (en hauteurs). */
const cover = (aspect) => (Math.sqrt(Math.PI / 5) * erf((Math.sqrt(5) * aspect) / 2)) / aspect;
export const FLASH_REF_ASPECT = 16 / 9;
/** Poids (0..1] de l'éclair et de l'onde selon la forme de l'écran (largeur / hauteur). */
export function screenWeight(aspect) {
  if (!(aspect > 0) || aspect >= 1) return 1; // V9b (Diapason) : tout écran en paysage garde l'aspect d'origine

  return Math.min(1, cover(FLASH_REF_ASPECT) / cover(aspect));
}
