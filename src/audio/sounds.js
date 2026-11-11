// Sons synthétisés (ARCHITECTURE_V2 U6). Chaque son est une fonction (ctx, out, t0, arg) qui programme des nœuds Web Audio
// branchés sur `out` à partir de l'instant `t0` (secondes du contexte) et renvoie sa durée en secondes.
// Aucune dépendance au contexte temps réel : le même code se rend dans un OfflineAudioContext (essai `tools/e2e/audio.e2e.mjs`)
// ou dans un faux contexte (tests/audio). Chaque voix a un gain <= 0,22 ; un accord de trois notes reste sous 1.
// Notes des cibles (U6) : rouge sol 392 Hz, vert si 494 Hz, bleu ré 587 Hz ; un mélange joue l'accord.

export const NOTE_HZ = Object.freeze({ 1: 392, 2: 494, 4: 587 }); // bits de couleur : R=1, G=2, B=4 (engine/colors.js)

/** Notes (Hz) d'un masque de couleur 1..7 : une par composante. */
export function chordFor(mask) {
  const m = mask & 7;
  const out = [];
  for (const bit of [1, 2, 4]) if (m & bit) out.push(NOTE_HZ[bit]);
  return out.length > 0 ? out : [NOTE_HZ[1]];
}

/** Une note : oscillateur + enveloppe attaque courte / décroissance exponentielle. Glissando facultatif (f -> f2). */
function tone(ctx, out, t0, { f, f2 = null, dur = 0.15, type = 'sine', gain = 0.2, attack = 0.005, delay = 0, lowpass = 0 }) {
  const t = t0 + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t);
  if (f2 !== null) osc.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  let tail = g;
  if (lowpass > 0) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(lowpass, t);
    g.connect(lp);
    tail = lp;
  }
  tail.connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  return delay + dur;
}

/** Souffle filtré : bruit blanc (tampon de 0,2 s, graine fixe) passé dans un filtre à bande. */
function noise(ctx, out, t0, { dur = 0.03, freq = 1800, q = 1.2, gain = 0.2, f2 = null, delay = 0, type = 'bandpass' }) {
  const t = t0 + delay;
  const len = Math.max(1, Math.floor(ctx.sampleRate * 0.2));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 0x2545f491;
  for (let i = 0; i < len; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = ((s >>> 0) / 4294967296) * 2 - 1; }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.Q.setValueAtTime(q, t);
  flt.frequency.setValueAtTime(freq, t);
  if (f2 !== null) flt.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + Math.min(0.004, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt); flt.connect(g); g.connect(out);
  src.start(t);
  src.stop(t + Math.min(dur + 0.02, 0.2));
  return delay + dur;
}

export const SOUNDS = Object.freeze({
  /** Prendre une pièce : petit « pop » montant. */
  take: (ctx, out, t0) => tone(ctx, out, t0, { f: 330, f2: 520, dur: 0.07, type: 'triangle', gain: 0.18 }),
  /** Poser : petit « toc » descendant. */
  drop: (ctx, out, t0) => Math.max(tone(ctx, out, t0, { f: 260, f2: 150, dur: 0.09, type: 'sine', gain: 0.22 }), noise(ctx, out, t0, { dur: 0.025, freq: 900, gain: 0.08 })),
  /** Tourner : bruit filtré de 30 ms (MVP §9) + tic. */
  rotate: (ctx, out, t0) => Math.max(noise(ctx, out, t0, { dur: 0.03, freq: 2200, q: 2, gain: 0.2 }), tone(ctx, out, t0, { f: 700, dur: 0.03, type: 'square', gain: 0.04 })),
  /** Cible allumée : la note de la couleur (accord si mélange). arg = masque 1..7. */
  light: (ctx, out, t0, mask = 1) => {
    const notes = chordFor(mask);
    const gain = 0.2 / Math.sqrt(notes.length);
    let d = 0;
    notes.forEach((f, i) => { d = Math.max(d, tone(ctx, out, t0, { f, dur: 0.22, type: 'sine', gain, delay: i * 0.012 })); });
    return d;
  },
  /** Cible perdue : glissando descendant voilé. */
  lost: (ctx, out, t0) => tone(ctx, out, t0, { f: 392, f2: 230, dur: 0.16, type: 'sawtooth', gain: 0.1, lowpass: 900 }),
  /** Fusion de couleurs : deux glissandos qui se rejoignent + scintillement. arg = masque. */
  merge: (ctx, out, t0, mask = 7) => {
    const target = chordFor(mask)[0];
    const a = tone(ctx, out, t0, { f: target * 0.75, f2: target, dur: 0.18, type: 'triangle', gain: 0.12 });
    const b = tone(ctx, out, t0, { f: target * 1.5, f2: target * 2, dur: 0.18, type: 'sine', gain: 0.08 });
    const c = tone(ctx, out, t0, { f: 1568, dur: 0.12, type: 'sine', gain: 0.07, delay: 0.16 });
    return Math.max(a, b, c);
  },
  /** Lumière dans un prisme : balayage montant. */
  prism: (ctx, out, t0) => Math.max(tone(ctx, out, t0, { f: 600, f2: 1500, dur: 0.22, type: 'sine', gain: 0.1 }), tone(ctx, out, t0, { f: 900, f2: 2250, dur: 0.22, type: 'triangle', gain: 0.04, delay: 0.03 })),
  /** Porte qui s'ouvre : coup sourd + souffle montant. */
  gate: (ctx, out, t0) => Math.max(tone(ctx, out, t0, { f: 120, f2: 70, dur: 0.14, type: 'sine', gain: 0.22 }), noise(ctx, out, t0, { dur: 0.25, freq: 500, f2: 2600, q: 1.5, gain: 0.12, delay: 0.03 })),
  /** Portail : modulation rapide, comme un souffle qui traverse. */
  portal: (ctx, out, t0) => Math.max(tone(ctx, out, t0, { f: 440, f2: 880, dur: 0.2, type: 'sine', gain: 0.08 }), tone(ctx, out, t0, { f: 445, f2: 890, dur: 0.2, type: 'sine', gain: 0.08, delay: 0.01 })),
  /** Dépôt invalide : deux petits bips graves. */
  invalid: (ctx, out, t0) => Math.max(tone(ctx, out, t0, { f: 150, dur: 0.06, type: 'square', gain: 0.07, lowpass: 700 }), tone(ctx, out, t0, { f: 130, dur: 0.07, type: 'square', gain: 0.07, lowpass: 700, delay: 0.09 })),
  /** Victoire : arpège montant de 4 notes (sol si ré sol) puis accord tenu. */
  victory: (ctx, out, t0) => {
    const notes = [392, 494, 587, 784];
    let d = 0;
    notes.forEach((f, i) => { d = Math.max(d, tone(ctx, out, t0, { f, dur: 0.28, type: 'sine', gain: 0.17, delay: i * 0.11 })); });
    for (const f of [392, 494, 587]) d = Math.max(d, tone(ctx, out, t0, { f: f * 2, dur: 0.6, type: 'triangle', gain: 0.06, delay: 0.5 }));
    return d;
  },
  /** Étoiles révélées : une note aiguë par étoile, de plus en plus haute. arg = nombre d'étoiles 1..3. */
  stars: (ctx, out, t0, n = 3) => {
    const freqs = [880, 1109, 1319];
    let d = 0;
    for (let i = 0; i < Math.max(1, Math.min(3, n | 0)); i++) d = Math.max(d, tone(ctx, out, t0, { f: freqs[i], dur: 0.2, type: 'sine', gain: 0.14, delay: i * 0.16 }));
    return d;
  },
});

export const SOUND_NAMES = Object.freeze(Object.keys(SOUNDS));
