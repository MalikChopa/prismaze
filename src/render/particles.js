// Réservoir de particules (D8) : 256 emplacements fixes, tableaux typés, aucune allocation par image.
// Victoire <= 160, fusion 12, porte 24, portail 16 (budgets de D8). Le dessin utilise les sprites `dot` en mode `lighter`.

export const POOL_SIZE = 256;
export const BUDGET = Object.freeze({ victory: 160, fuse: 12, gate: 24, portal: 16, lit: 10 });

/** Générateur déterministe minuscule (xorshift32) : les effets ne dépendent pas de Math.random (tests reproductibles). */
function makeRng(seed) {
  let s = seed | 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

export function createParticles() {
  const x = new Float32Array(POOL_SIZE), y = new Float32Array(POOL_SIZE), vx = new Float32Array(POOL_SIZE), vy = new Float32Array(POOL_SIZE);
  const life = new Float32Array(POOL_SIZE), ttl = new Float32Array(POOL_SIZE), size = new Float32Array(POOL_SIZE), mask = new Uint8Array(POOL_SIZE);
  let alive = 0, peak = 0, cursor = 0;
  const rnd = makeRng(20261107);

  return {
    get count() { return alive; },
    get peak() { return peak; },
    /**
     * Émet `n` particules depuis (px, py) (unités de case), de teinte `m` (1..7) ; `speed` en cases/s ; `spread` en radians (2π = cercle).
     * Pool plein : les plus anciennes sont écrasées (le total reste borné).
     */
    burst(px, py, m, n, speed = 2.2, spread = Math.PI * 2, angle = 0, ttlS = 0.9) {
      for (let k = 0; k < n; k++) {
        const i = cursor; cursor = (cursor + 1) % POOL_SIZE;
        if (life[i] <= 0) alive++;
        const a = angle + (rnd() - 0.5) * spread, v = speed * (0.35 + rnd() * 0.65);
        x[i] = px; y[i] = py; vx[i] = Math.cos(a) * v; vy[i] = Math.sin(a) * v;
        ttl[i] = ttlS * (0.6 + rnd() * 0.4); life[i] = ttl[i]; size[i] = 0.5 + rnd() * 0.7; mask[i] = m === 0 ? 7 : m;
      }
      if (alive > peak) peak = alive;
    },
    /** Avance de dt secondes. */
    update(dt) {
      let n = 0;
      for (let i = 0; i < POOL_SIZE; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) continue;
        x[i] += vx[i] * dt; y[i] += vy[i] * dt;
        vx[i] *= 1 - 1.6 * dt; vy[i] *= 1 - 1.6 * dt;
        n++;
      }
      alive = n;
    },
    /** Dessine en mode lighter ; `dots[m]` = sprite de point, `cell` = taille de case, `ox, oy` = origine du plateau. */
    draw(ctx, dots, cell) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < POOL_SIZE; i++) {
        if (life[i] <= 0) continue;
        const k = life[i] / ttl[i], s = 0.24 * cell * size[i] * (0.4 + 0.6 * k);
        ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.drawImage(dots[mask[i]], x[i] * cell - s / 2, y[i] * cell - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
    clear() { life.fill(0); alive = 0; },
  };
}
