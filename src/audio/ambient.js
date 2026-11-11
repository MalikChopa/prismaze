// V11 : nappe d'ambiance de l'accueil (code de la maquette D, docs/maquette-d/NOTES.md) : accords lents non répétitifs et rares tintements,
// tout en Web Audio (aucun fichier). Très bas (mesuré sur la maquette : moyenne −34,3 dBFS, crête −22,1 dBFS, rien d'aigu).
// Le contexte audio est celui des sons du jeu (audio.js, créé au premier geste) : la nappe ne démarre jamais sans geste.
// Elle passe par sa propre chaîne (gain -> compresseur -> sortie) et s'éteint en fondu ; à l'arrêt, le planificateur est coupé.

const CHORDS = [[50, 57, 62, 66, 69], [47, 54, 61, 62, 66], [43, 50, 57, 59, 66], [45, 52, 57, 61, 64], [40, 47, 54, 55, 62], [48, 55, 59, 62, 67]];
const NEXT = [[1, 2, 3, 5], [2, 4, 0], [0, 3, 4, 5], [0, 1, 2], [2, 3, 0], [2, 0]];
const CHIME = [74, 76, 78, 81, 83, 86, 88, 90, 93];
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
/** Niveau du gain général de la nappe (volume 0,6 de la maquette : 0,9 × 0,6²). */
export const AMBIENT_LEVEL = 0.9 * 0.6 * 0.6;
export const FADE_IN_S = 2.5, FADE_OUT_S = 0.6;

function makeIR(ctx, sec, rnd) {
  const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let lp = 0; for (let i = 0; i < n; i++) { const t = i / n, v = (rnd() * 2 - 1) * (1 - t) ** 3; lp = lp * 0.6 + v * 0.4; d[i] = lp; } }
  return b;
}

/** Graphe de la nappe sur un contexte (réel ou hors ligne) ; renvoie {chord(t0, dur), chime(t0)}. Repris de la maquette D. */
export function ambientGraph(ctx, out, rnd) {
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 65;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1050; lp.Q.value = 0.35;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.029; const lfoG = ctx.createGain(); lfoG.gain.value = 330; lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
  const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.0113; const lfoG2 = ctx.createGain(); lfoG2.gain.value = 180; lfo2.connect(lfoG2); lfoG2.connect(lp.frequency); lfo2.start();
  const bus = ctx.createGain(); bus.connect(lp); lp.connect(hp);
  const conv = ctx.createConvolver(); conv.buffer = makeIR(ctx, 4.2, rnd);
  const dry = ctx.createGain(); dry.gain.value = 0.5; const wet = ctx.createGain(); wet.gain.value = 0.8;
  hp.connect(dry); dry.connect(out); hp.connect(conv); conv.connect(wet); wet.connect(out);
  const shim = ctx.createGain(); shim.gain.value = 1; const shLp = ctx.createBiquadFilter(); shLp.type = 'lowpass'; shLp.frequency.value = 2400; shim.connect(shLp); shLp.connect(conv);
  const shDry = ctx.createGain(); shDry.gain.value = 0.25; shLp.connect(shDry); shDry.connect(out);
  let ci = 0;
  // V13b (revue n° 4) : voix programmées et pas encore finies (accords et tintements) : un arrêt les éteint en fondu, pour qu'une relance
  // n'empile jamais un nouvel accord sur un ancien qui tiendrait encore 8 à 13 s.
  const live = new Set();
  const track = (g, oscs, end) => { live.add({ g, oscs, end }); };
  function voice(t0, dur, f, lvl) {
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(lvl, t0 + 3.6 + rnd() * 1.4); g.gain.setValueAtTime(lvl, t0 + dur); g.gain.linearRampToValueAtTime(0, t0 + dur + 5.5); g.connect(bus);
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f; o1.detune.value = -5 + rnd() * 3; o1.connect(g);
    const g2 = ctx.createGain(); g2.gain.value = 0.32; const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f; o2.detune.value = 4 + rnd() * 4; o2.connect(g2); g2.connect(g);
    const end = t0 + dur + 5.7; o1.start(t0); o2.start(t0); o1.stop(end); o2.stop(end);
    track(g, [o1, o2], end);
  }
  /** Voix encore programmées après l'instant t (les finies sont oubliées). */
  function alive(t) { for (const v of live) if (v.end <= t) live.delete(v); return live.size; }
  /** Éteint en `sec` secondes (fondu) toutes les voix encore programmées à l'instant t, puis arrête leurs oscillateurs. */
  function silence(t, sec) {
    alive(t);
    const stopAt = t + sec + 0.02;
    for (const v of live) {
      if (v.end <= stopAt) continue;
      const p = v.g.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(0, t + sec);
      for (const o of v.oscs) o.stop(stopAt); // un nouvel appel à stop() remplace l'ancien (Web Audio)
      v.end = stopAt;
    }
  }
  function chord(t0, dur) {
    const opts = NEXT[ci]; ci = opts[Math.floor(rnd() * opts.length)];
    const c = CHORDS[ci].slice(); const low = c.shift();
    while (c.length > 3) c.splice(Math.floor(rnd() * c.length), 1);
    if (rnd() < 0.35) { const j = Math.floor(rnd() * c.length); c[j] += 12; if (c[j] > 81) c[j] -= 12; }
    voice(t0, dur, mtof(low), 0.06);
    for (const m of c) voice(t0 + rnd() * 0.8, dur, mtof(m), 0.036);
    return ci;
  }
  function chime(t0) {
    const m = CHIME[Math.floor(rnd() * CHIME.length)], f = mtof(m);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.022, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.0004, t0 + 3.2); g.connect(shim);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(t0); o.stop(t0 + 3.3);
    const g3 = ctx.createGain(); g3.gain.setValueAtTime(0, t0); g3.gain.linearRampToValueAtTime(0.006, t0 + 0.03); g3.gain.exponentialRampToValueAtTime(0.0002, t0 + 2.2); g3.connect(shim);
    const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = f * 2; o3.connect(g3); o3.start(t0); o3.stop(t0 + 2.3);
    track(g, [o], t0 + 3.3); track(g3, [o3], t0 + 2.3);
    return m;
  }
  return { chord, chime, silence, alive };
}

/**
 * @param {{audioContext:()=>(AudioContext|null), rnd?:()=>number, setInterval?:Function, clearInterval?:Function}} deps
 *   audioContext : contexte audio du jeu, ou null tant qu'aucun geste ne l'a créé
 */
export function createAmbient(deps) {
  const rnd = deps.rnd || Math.random;
  const setI = deps.setInterval || ((f, ms) => setInterval(f, ms));
  const clearI = deps.clearInterval || ((id) => clearInterval(id));
  let ctx = null, master = null, api = null, timer = 0, nextChord = 0, nextChime = 0, playing = false;
  const stats = { starts: 0, stops: 0, chords: 0, chimes: 0 };

  function ensure() {
    if (master !== null) return true;
    const c = deps.audioContext();
    if (!c || c.state !== 'running') return false; // pas de geste encore : rien (jamais de contexte créé ici)
    ctx = c;
    master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    master.connect(comp); comp.connect(ctx.destination);
    api = ambientGraph(ctx, master, rnd);
    return true;
  }
  function ramp(to, sec) {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(to, t + sec);
  }
  function sched() {
    if (!playing || ctx === null) return;
    const t = ctx.currentTime;
    if (nextChord < t) nextChord = t + 0.05; // retour après une pause : on repart d'ici (pas de rattrapage)
    while (nextChord < t + 1.2) { const d = 8 + rnd() * 5; api.chord(nextChord, d); stats.chords++; nextChord += d; }
    while (nextChime < t + 1.2) { api.chime(Math.max(nextChime, t)); stats.chimes++; nextChime = Math.max(nextChime, t) + 5 + rnd() * 8; }
  }

  return {
    /** Démarre (fondu de 2,5 s) si le contexte tourne ; renvoie true si la nappe joue. */
    start() {
      if (playing) return true;
      if (!ensure()) return false;
      playing = true;
      stats.starts++;
      ramp(AMBIENT_LEVEL, FADE_IN_S);
      const t = ctx.currentTime;
      nextChord = t + 0.05; nextChime = t + 5 + rnd() * 4;
      clearI(timer); timer = setI(sched, 400); sched();
      return true;
    },
    /** Fondu de sortie (0,6 s) puis plus rien n'est planifié. */
    stop() {
      if (!playing) return;
      playing = false;
      stats.stops++;
      clearI(timer); timer = 0;
      ramp(0, FADE_OUT_S);
      api.silence(ctx.currentTime, FADE_OUT_S); // V13b : les accords en cours s'éteignent aussi (une relance repart d'un silence)
    },
    get playing() { return playing; },
    get level() { return master === null ? 0 : master.gain.value; },
    get stats() { return { ...stats }; },
    /** Voix (accords, tintements) encore programmées à cet instant : une relance ne les empile pas (V13b). */
    get voices() { return api === null ? 0 : api.alive(ctx.currentTime); },
  };
}
