// Simulation de particules (ARCHITECTURE_V3_RENDU §5, V3-28, V3-29). Module PUR : à graine, déterministe, SANS Math.random ni Date.now :
// le temps est une entrée (`update(dt)`). Réservoir de taille fixe (1 500 en Haut, 750 Moyen, 330 Bas ; 256 en Canvas 2D), un seul tableau typé de
// 14 flottants par particule (84 Ko pour 1 500), aucune allocation par image. Les rendus (2D, GL) lisent `data` en lecture seule.
export const STRIDE = 14;
// Champs d'une particule dans `data` : x, y (cases), vx, vy (cases/s), life, ttl (s), size, mask (1..7), drag, gravity (cases/s²), spin, rot, kind, aux
export const F = Object.freeze({ X: 0, Y: 1, VX: 2, VY: 3, LIFE: 4, TTL: 5, SIZE: 6, MASK: 7, DRAG: 8, GRAVITY: 9, SPIN: 10, ROT: 11, KIND: 12, AUX: 13 });
export const KIND = Object.freeze({ SPARK: 0, STAR: 1, TOKEN: 2 });

/** xorshift32 à graine : suite identique pour une même graine (les entiers sont rendus sur 0..1 sans passer par Math.random). */
export function makeRng(seed) {
  let s = seed | 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/** Graine d'un niveau : hachage de son identifiant (FNV-1a 32 bits). */
export function seedOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0 || 1;
}

/**
 * @param {{pool?:number, seed?:number, quantity?:number}} [opt]  quantity : facteur de qualité (1, 0,5, 0,22) appliqué au nombre émis
 */
export function createParticleSim(opt = {}) {
  const pool = opt.pool ?? 1500;
  let seed = opt.seed ?? 1, quantity = opt.quantity ?? 1;
  const data = new Float32Array(pool * STRIDE);
  let rnd = makeRng(seed), alive = 0, peak = 0, cursor = 0, emitted = 0;
  const api = {
    pool, data,
    get count() { return alive; },
    get peak() { return peak; },
    get emitted() { return emitted; },
    set quantity(q) { quantity = q; },
    get quantity() { return quantity; },
    /** Repart de zéro avec une graine (nouveau niveau) : mêmes entrées → mêmes particules. */
    reset(newSeed) { seed = newSeed ?? seed; rnd = makeRng(seed); data.fill(0); alive = 0; peak = 0; cursor = 0; emitted = 0; },
    clear() { for (let i = 0; i < pool; i++) data[i * STRIDE + F.LIFE] = 0; alive = 0; },
    /**
     * Émet `round(n × quantity)` particules (au moins 1 si n > 0 et quantity > 0) depuis (x, y) en cases ; `speed` en cases/s ; `spread` en radians ;
     * `angle` direction centrale ; `ttl` en secondes ; `advance` (V10) : chaque particule part déjà à v × advance du point d'émission. Réservoir plein : les plus anciennes sont écrasées (le total reste borné).
     */
    burst({ x, y, mask = 7, n, speed = 2.2, spread = Math.PI * 2, angle = 0, ttl = 0.9, drag = 1.6, gravity = 0, kind = KIND.SPARK, size = 1, advance = 0 }) {
      const count = n > 0 && quantity > 0 ? Math.max(1, Math.round(n * quantity)) : 0;
      for (let k = 0; k < count; k++) {
        const i = cursor; cursor = (cursor + 1) % pool;
        const o = i * STRIDE;
        if (data[o + F.LIFE] <= 0) alive++;
        const a = angle + (rnd() - 0.5) * spread, v = speed * (0.35 + rnd() * 0.65), t = ttl * (0.6 + rnd() * 0.4);
        data[o + F.X] = x + Math.cos(a) * v * advance; data[o + F.Y] = y + Math.sin(a) * v * advance; data[o + F.VX] = Math.cos(a) * v; data[o + F.VY] = Math.sin(a) * v; // advance (V10) : départ déjà écarté du centre (s)
        data[o + F.LIFE] = t; data[o + F.TTL] = t; data[o + F.SIZE] = size * (0.5 + rnd() * 0.7); data[o + F.MASK] = mask === 0 ? 7 : mask;
        data[o + F.DRAG] = drag; data[o + F.GRAVITY] = gravity; data[o + F.SPIN] = (rnd() - 0.5) * 6; data[o + F.ROT] = rnd() * 6.2831853; data[o + F.KIND] = kind; data[o + F.AUX] = rnd();
      }
      emitted += count;
      if (alive > peak) peak = alive;
      return count;
    },
    /** Avance de dt secondes (temps injecté par l'appelant). */
    update(dt) {
      let n = 0;
      for (let i = 0; i < pool; i++) {
        const o = i * STRIDE;
        if (data[o + F.LIFE] <= 0) continue;
        data[o + F.LIFE] -= dt;
        if (data[o + F.LIFE] <= 0) continue;
        const d = Math.max(0, 1 - data[o + F.DRAG] * dt);
        data[o + F.X] += data[o + F.VX] * dt; data[o + F.Y] += data[o + F.VY] * dt;
        data[o + F.VX] *= d; data[o + F.VY] = data[o + F.VY] * d + data[o + F.GRAVITY] * dt;
        data[o + F.ROT] += data[o + F.SPIN] * dt;
        n++;
      }
      alive = n;
    },
    /** Empreinte (somme de contrôle) de l'état : deux simulations identiques donnent la même valeur. */
    checksum() {
      let h = 0x811c9dc5;
      const u = new Uint32Array(data.buffer);
      for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193); }
      return h >>> 0;
    },
  };
  return api;
}
