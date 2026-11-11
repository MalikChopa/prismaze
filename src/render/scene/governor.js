// Gouverneur de qualité (ARCHITECTURE_V3_RENDU V3-5). Module PUR, horloge injectable (l'appelant donne `now` et `dt`).
// Le code de createGovernor est CELUI du document (testé tel quel) : fenêtres en TEMPS, durées plafonnées à 250 ms mais jamais ignorées
// (la machine la plus lente doit pouvoir baisser), jamais de remontée. Niveaux : 0 Haut, 1 Moyen, 2 Bas.
export const GOVERNOR = Object.freeze({ WINDOW_MS: 1500, MIN_FRAMES: 8, P95_MAX: 20, STRIKES: 3, WARMUP_MS: 500, START_WARMUP_MS: 1000, CAP_MS: 250 });
const C = GOVERNOR;

/** Durées de `hold` (ms) : victoire + 1 s, redimensionnement ou bascule de rendu, onglet redevenu visible. */
export const HOLD_MS = Object.freeze({ victory: 4600, resize: 500, backend: 500, visibility: 1000 });

export function createGovernor(startLevel = 0) {
  let level = startLevel, buf = [], strikes = 0, t0 = 0, quietUntil = C.START_WARMUP_MS;
  return {
    get level() { return level; },
    push(now, dt) { // now : horodatage de l'image (ms) ; dt : durée depuis la précédente
      if (now < quietUntil) { t0 = now; return level; }
      buf.push(Math.min(dt, C.CAP_MS));
      if (now - t0 < C.WINDOW_MS || buf.length < C.MIN_FRAMES) return level;
      const s = buf.slice().sort((a, b) => a - b), p95 = s[Math.ceil(0.95 * s.length) - 1];
      buf = []; t0 = now;
      if (p95 <= C.P95_MAX) { strikes = 0; return level; }
      if (++strikes >= C.STRIKES && level < 2) { level++; strikes = 0; quietUntil = now + C.WARMUP_MS; }
      return level; // jamais de remontée
    },
    hold(now, ms) { buf = []; strikes = 0; t0 = now; quietUntil = Math.max(quietUntil, now + ms); },
  };
}

/** Niveau de départ (P12, définitif) : Moyen sur écran tactile (`pointer: coarse`), sinon Haut. */
export function startLevel(coarsePointer) {
  return coarsePointer ? 1 : 0;
}
