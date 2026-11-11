// Banc d'essai de fluidité, chargé seulement avec `?bench` (ARCHITECTURE.md §10). Instrumentation uniquement :
// il ne change pas les règles du jeu. Il force un redessin complet à chaque image (pire cas), puis mesure
// pendant 10 s à partir du premier `pointerdown` (la scène « drag » est jouée par tools/e2e/bench.e2e.mjs avec de vraies entrées souris).
// À la fin des 10 s, il écrit `window.__bench = {workP95Ms, workMaxMs, rafP50Ms, rafP95Ms, frames, hz, hidden, traceP99Ms, particlesMax}`.
// Tant que la mesure n'est pas finie, `window.__bench` n'existe pas.

export const BENCH_DURATION_MS = 10000;

/** Percentile par rang le plus proche (p entre 0 et 100) ; 0 pour une liste vide. */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1];
}

/** Calcule le résultat à partir des échantillons. Pur (testé sous Node). */
export function summarize({ work, intervals, traces, hidden, frames, particlesMax = 0 }) {
  const rafP50Ms = percentile(intervals, 50);
  return Object.freeze({
    workP95Ms: percentile(work, 95),
    workMaxMs: work.length === 0 ? 0 : Math.max(...work),
    rafP50Ms,
    rafP95Ms: percentile(intervals, 95),
    frames,
    hz: rafP50Ms > 0 ? Math.round(1000 / rafP50Ms) : 0, // estimation : inverse de l'intervalle médian entre images
    hidden,
    traceP99Ms: percentile(traces, 99),
    particlesMax,
  });
}

/**
 * @param {{win?:object, doc?:object, now?:()=>number, durationMs?:number}} [env]  (tests : environnement simulé)
 * @returns {{hooks:object, attach:(game:object)=>void}}
 */
export function createBench(env = {}) {
  const win = env.win || globalThis;
  const doc = env.doc || globalThis.document;
  const now = env.now || (() => performance.now());
  const duration = env.durationMs || BENCH_DURATION_MS;

  let recording = false;
  let finished = false;
  let startedAt = 0;
  let eventMs = 0;
  let drawMs = 0;
  let prevTs = -1;
  let hidden = false;
  let frames = 0;
  let game = null;
  const work = [];
  const intervals = [];
  const traces = [];

  function finish() {
    recording = false;
    finished = true;
    win.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('visibilitychange', onVisibility);
    if (game) game.setContinuous(false);
    Object.defineProperty(win, '__bench', {
      value: summarize({ work, intervals, traces, hidden, frames, particlesMax: game && game.snapshot ? game.snapshot().fx.particlesPeak : 0 }),
      writable: false, configurable: true, enumerable: true,
    });
  }
  function onPointerDown() {
    if (recording || finished) return;
    recording = true;
    startedAt = now();
    eventMs = 0;
    prevTs = -1;
    hidden = doc.hidden === true;
  }
  function onVisibility() {
    if (recording && doc.hidden) hidden = true;
  }

  const hooks = {
    now,
    onEvent(ms) { if (recording) eventMs += ms; },
    onTrace(ms) { if (recording) traces.push(ms); },
    onDraw(ms) { drawMs = ms; },
    /** Appelé à la fin de chaque image dessinée, avec l'horodatage de requestAnimationFrame. */
    onFrame(ts) {
      if (!recording) return;
      frames++;
      work.push(eventMs + drawMs);
      eventMs = 0;
      if (prevTs >= 0) intervals.push(ts - prevTs);
      prevTs = ts;
      if (now() - startedAt >= duration) finish();
    },
  };

  return {
    hooks,
    attach(g) {
      game = g;
      win.addEventListener('pointerdown', onPointerDown, true);
      doc.addEventListener('visibilitychange', onVisibility);
      g.setContinuous(true);
    },
  };
}
