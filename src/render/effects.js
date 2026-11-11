// Effets (ARCHITECTURE_V3_RENDU §5, V3-28, V3-29, V3-41) : étincelles le long des faisceaux, gerbes d'allumage (limitées), gerbes et étoiles de victoire.
// Module PUR (aucun GL ni DOM) : lit l'état et le tracé en lecture seule, n'écrit ni logique ni sauvegarde. Déterministe : mêmes graine, entrées et durées -> mêmes particules (0 Math.random).
// Pas fixe de 1/60 s pour la simulation : le découpage des images ne change pas le résultat.
import { createParticleSim, seedOf, KIND, F as PF, STRIDE, makeRng } from './scene/particles-sim.js';
import { QUALITY, clampQuality } from './scene/quality.js';
import { LIN } from './gl/piece-data.js';
import { victoryEvents, victoryFrame } from './scene/victory.js';

export const LIT_MAX_PER_SEC = 3; // V3-41 : au plus 3 gerbes-éclats par seconde sur tout l'écran
export const LIT_BURST_N = 40, FUSE_N = 12, STEP_S = 1 / 60;
/** V9b (audit B1) : montée de l'éclat de chaque particule (s) : une gerbe de victoire ou d'allumage s'allume sur 4 images à 60 i/s au lieu d'une. */
export const FADE_IN_S = 4 / 60;
/** V10 (étoiles « striées » vers 0,45 s) : une gerbe d'étoiles naît d'un seul point ; nées à pleine taille, leurs branches se superposent en bandes. Elles grandissent sur ce temps (s). */
export const STAR_GROW_S = 0.22;
const MAX_STEPS = 8;
const GOLD = Object.freeze([1.0, 0.68, 0.22]), GOLD_PALE = Object.freeze([1.0, 0.86, 0.55]);

/**
 * Limiteur V3-41 (pur) : au plus `max` allumages acceptés sur 1 s glissante (horloge en ms fournie par l'appelant).
 * @param {number} [max]
 */
export function createLitLimiter(max = LIT_MAX_PER_SEC) {
  const times = new Float64Array(max).fill(-1e9);
  let head = 0;
  return {
    allow(now) { if (now - times[head] < 1000) return false; times[head] = now; head = (head + 1) % max; return true; },
    reset() { times.fill(-1e9); head = 0; },
  };
}

/** Position (cases) des cibles de `state`, dans l'ordre de `result.targets` (la même règle que `piece-data.js`). */
function targetsOf(state, out) {
  out.length = 0;
  for (let i = 0; i < state.pieces.length; i++) { const p = state.pieces[i]; if (p.type === 'target') out.push(p); }
  return out;
}

/**
 * @param {{quality?:number, reduced?:boolean, seed?:number}} [opt]
 */
export function createEffects(opt = {}) {
  let quality = clampQuality(opt.quality ?? 0), reduced = opt.reduced === true, seed = opt.seed ?? 1;
  let sim = createParticleSim({ pool: QUALITY[quality].pool, quantity: QUALITY[quality].particles, seed });
  let rnd = makeRng((seed ^ 0x51ed270b) >>> 0);
  const limiter = createLitLimiter();
  let sparkAcc = 0, acc = 0, peak = 0, lastNow = -1, burstUntil = -1;
  let forState = null, prev = new Uint8Array(0), first = true, lastLit = -1, litAllowed = new Uint8Array(0), levelKey = null;
  const targets = [];
  // état de la victoire : `lastV` ms de la chronologie déjà jouée, `vId` identifie la victoire en cours
  let vKey = null, lastV = -1, vFrame = null, skipSeen = null, wonNow = false;

  function rebuild() {
    sim = createParticleSim({ pool: QUALITY[quality].pool, quantity: QUALITY[quality].particles, seed });
    rnd = makeRng((seed ^ 0x51ed270b) >>> 0);
    sparkAcc = 0; acc = 0; limiter.reset();
  }

  function setLevel(key, state) {
    levelKey = key;
    seed = seedOf(key);
    rebuild();
    prev = new Uint8Array(0); first = true; lastLit = -1; forState = null; vKey = null; vFrame = null; lastV = -1; skipSeen = null;
    void state;
  }

  function bump(n) { if (n > peak) peak = n; }

  function emitAt(x, y, mask, n, speed, big, ttl = 1.2) {
    sim.burst({ x, y, mask, n, speed, spread: Math.PI * 2, ttl, drag: 2.1, kind: KIND.SPARK, size: 1 });
    burstUntil = lastNow + 1500; // les gerbes empêchent le repos V3-15, pas les étincelles d'ambiance
    if (big) sim.burst({ x, y, mask, n: 1, speed: 0.01, spread: 0, ttl: 0.75, drag: 0, kind: KIND.TOKEN, size: 1 }); // anneau de choc
    bump(sim.count);
  }

  function applyEvent(ev, cx, cy) {
    if (ev.type === 'stars') {
      sim.burst({ x: cx, y: cy, mask: 3, n: ev.n, speed: ev.speed, ttl: 2.6, drag: 0.75, kind: KIND.STAR, size: 0.8 }); // V10 : pas de départ écarté (`advance`) : il agrandissait la surface de flash (A/B : 1,6 % contre 1,2 %) ; la croissance (STAR_GROW_S) suffit
      bump(sim.count);
      return;
    }
    if (ev.type === 'one') {
      if (ev.target < targets.length) { const p = targets[ev.target]; emitAt(p.c + 0.5, p.r + 0.5, p.need, ev.n, ev.speed, ev.big); }
      return;
    }
    for (let i = 0; i < targets.length; i++) {
      if (ev.type === 'half' && i % 2 !== 0) continue;
      const p = targets[i];
      emitAt(p.c + 0.5, p.r + 0.5, p.need, ev.n, ev.speed, ev.big);
    }
  }

  function sparks(dt, post, won) {
    if (!post || post.out.count === 0) return;
    const o = post.out;
    let len = 0;
    for (let i = 0; i < o.count; i++) len += Math.abs(o.x1[i] - o.x0[i]) + Math.abs(o.y1[i] - o.y0[i]);
    sparkAcc += dt * (16 + 2.6 * len) * QUALITY[quality].particles * (won ? 1.7 : 1);
    while (sparkAcc >= 1) {
      sparkAcc -= 1;
      let pick = rnd() * len, s = 0;
      for (let i = 0; i < o.count; i++) {
        const l = Math.abs(o.x1[i] - o.x0[i]) + Math.abs(o.y1[i] - o.y0[i]);
        if (pick < l) { s = i; break; }
        pick -= l; s = i;
      }
      const f = rnd(), x = o.x0[s] + (o.x1[s] - o.x0[s]) * f, y = o.y0[s] + (o.y1[s] - o.y0[s]) * f;
      const a = Math.atan2(o.y1[s] - o.y0[s], o.x1[s] - o.x0[s]) + (rnd() < 0.3 ? Math.PI : 0);
      sim.burst({ x, y, mask: o.mask[s], n: 1, speed: 0.7, spread: 0.5, angle: a, ttl: 0.5 + rnd() * 0.9, drag: 0.6, kind: KIND.SPARK, size: 0.55 });
    }
    bump(sim.count);
  }

  const api = {
    get sim() { return sim; },
    get alive() { return sim.count; },
    get peak() { return peak; },
    get pool() { return sim.pool; },
    /** true tant que des particules vivent ou qu'une victoire joue : l'hôte ne se met pas au repos (V3-15). */
    get busy() { return (vFrame !== null && !vFrame.end) || lastNow < burstUntil; },
    /** État visuel de la victoire en cours (ou null). */
    get frame() { return vFrame; },
    /** Cible allumée en dernier (indice dans result.targets) : centre de l'onde. */
    get lastLit() { return lastLit; },
    /** Masque des cibles dont l'allumage de CETTE image est accepté par V3-41 (lu par l'éclat des pièces). */
    get litAllowed() { return litAllowed; },
    get seed() { return seed; },
    setQuality(q) { const c = clampQuality(q); if (c !== quality) { quality = c; rebuild(); } },
    setReduced(on) { const r = on === true; if (r !== reduced) { reduced = r; if (r) { sim.clear(); peak = 0; } } },

    /**
     * Une image.
     * @param {{nowMs:number, state:object, result:object, post:object, won:boolean, levelKey?:string, victory?:{t:number,skipAt:number|null,id:number}|null}} i
     */
    update(i) {
      const key = i.levelKey || `${i.state.cols}x${i.state.rows}:${i.state.pieces.length}`;
      if (key !== levelKey) setLevel(key, i.state);
      if (forState !== i.state) { forState = i.state; targetsOf(i.state, targets); }
      const res = i.result.targets;
      if (prev.length !== res.length) { prev = new Uint8Array(res.length); first = true; litAllowed = new Uint8Array(res.length); }
      litAllowed.fill(0);
      wonNow = i.won === true;
      const dtReal = lastNow < 0 ? 0 : Math.max(0, Math.min(0.25, (i.nowMs - lastNow) / 1000));
      lastNow = i.nowMs;
      if (reduced) { // V3-41 et P4 : jamais de gerbe ni d'éclat, aucune particule
        for (let t = 0; t < res.length; t++) { if (res[t].lit && prev[t] === 0) lastLit = t; prev[t] = res[t].lit ? 1 : 0; }
        first = false;
        vFrame = i.victory ? victoryFrame(i.victory.t, { reduced: true }) : null;
        return api;
      }
      for (let t = 0; t < res.length; t++) {
        const lit = res[t].lit ? 1 : 0;
        if (lit === 1 && prev[t] === 0 && !first) {
          lastLit = t;
          if (limiter.allow(i.nowMs)) {
            litAllowed[t] = 1;
            const p = targets[t], m = res[t].need;
            emitAt(p.c + 0.5, p.r + 0.5, m, LIT_BURST_N, 2.6, true);
            if ((m & (m - 1)) !== 0) { sim.burst({ x: p.c + 0.5, y: p.r + 0.5, mask: 7, n: FUSE_N, speed: 2.4, ttl: 0.5, drag: 1.8, kind: KIND.SPARK, size: 0.7 }); bump(sim.count); } // mélange : étincelle blanche (V2-U7)
          }
        }
        prev[t] = lit;
      }
      first = false;
      // victoire
      if (i.victory) {
        const v = i.victory;
        const opts = { reduced: false, skipAt: v.skipAt, seed, targets: targets.length };
        if (vKey !== v.id) { vKey = v.id; lastV = -1; skipSeen = null; }
        vFrame = victoryFrame(v.t, { skipAt: v.skipAt });
        const events = victoryEvents(lastV, v.t, opts);
        for (let e = 0; e < events.length; e++) applyEvent(events[e], i.state.cols / 2, i.state.rows / 2);
        lastV = Math.max(lastV, v.t);
        if (v.skipAt !== null && skipSeen === null) skipSeen = v.skipAt;
        if (vFrame.skipped && vFrame.fade <= 0) sim.clear();
      } else if (vFrame !== null) { vFrame = null; vKey = null; }
      // simulation à pas fixe
      acc += dtReal;
      let steps = 0;
      while (acc >= STEP_S && steps < MAX_STEPS) { acc -= STEP_S; steps++; if (vFrame === null || !vFrame.skipped) sparks(STEP_S, i.post, wonNow); sim.update(STEP_S); }
      if (acc > STEP_S * 2) acc = 0;
      return api;
    },

    /** Écrit les particules vivantes dans `out` (8 flottants : x, y, demi-taille, type, r, g, b, alpha × weight) ; renvoie leur nombre. */
    fill(out, weight = 1) {
      const d = sim.data, fade = (vFrame && vFrame.skipped ? vFrame.fade : 1) * weight; // weight (V9b) : poids d'écran des particules (0..1], voir host.js
      let n = 0;
      for (let i = 0; i < sim.pool; i++) {
        const o = i * STRIDE;
        const life = d[o + PF.LIFE];
        if (life <= 0) continue;
        const ttl = d[o + PF.TTL], k = life / ttl, kind = d[o + PF.KIND], size = d[o + PF.SIZE], aux = d[o + PF.AUX], m = d[o + PF.MASK] | 0;
        const age = ttl - life, rin = age >= FADE_IN_S ? 1 : Math.max(0, age) / FADE_IN_S; // V9b (B1, V3-20 c) : éclat qui monte sur 4 images, jamais d'un coup
        const c = LIN[m] || LIN[7];
        let half, a, r, g, b;
        if (kind === KIND.STAR) {
          const gw = age >= STAR_GROW_S ? 1 : Math.max(0, age) / STAR_GROW_S; half = size * 0.55 * (0.2 + 0.8 * k) * (0.15 + 0.85 * gw * gw * (3 - 2 * gw)); a = Math.sqrt(k) * 0.85;
          const pale = aux; r = GOLD[0] + (GOLD_PALE[0] - GOLD[0]) * pale; g = GOLD[1] + (GOLD_PALE[1] - GOLD[1]) * pale; b = GOLD[2] + (GOLD_PALE[2] - GOLD[2]) * pale;
        } else if (kind === KIND.TOKEN) { half = 0.18 + (1 - k) * 0.82; a = k * 0.8; r = c[0]; g = c[1]; b = c[2]; } else {
          half = 0.085 * size * (0.35 + 0.65 * k); a = Math.min(1, k * 2.4);
          const w = 0.4 * aux; r = c[0] + (1 - c[0]) * w; g = c[1] + (1 - c[1]) * w; b = c[2] + (1 - c[2]) * w;
        }
        const w0 = n * 8;
        out[w0] = d[o + PF.X]; out[w0 + 1] = d[o + PF.Y]; out[w0 + 2] = half; out[w0 + 3] = kind;
        out[w0 + 4] = r; out[w0 + 5] = g; out[w0 + 6] = b; out[w0 + 7] = a * fade * rin;
        n++;
      }
      return n;
    },
    /** Empreinte des particules (déterminisme V3-29). */
    checksum() { return sim.checksum(); },
    get emitted() { return sim.emitted; },
  };
  return api;
}
