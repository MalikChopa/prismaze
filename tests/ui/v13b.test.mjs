// V13b (revue V11-V12) : scène de l'accueil (n° 5 mises en page regroupées, n° 11 masque au défilement, n° 13 faisceau dans l'écran),
// source unique du paysage bas (n° 2). Faux canevas et fausse fenêtre : aucun dessin réel sous Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHomeScene, BEAM_MARGIN } from '../../src/ui/home-scene.js';
import { frameScheduler, RESIZE_SETTLE_MS } from '../../src/ui/home.js';
import { COMPACT_QUERY, isCompact } from '../../src/render/scene/layout.js';
import { createStage } from '../../src/ui/stage.js';

/** Contexte 2D qui accepte tout (méthodes vides, dégradés factices). */
const fakeCtx = () => new Proxy({ filter: 'none' }, {
  get(t, k) { if (k in t) return t[k]; if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} }); return () => {}; },
  set(t, k, v) { t[k] = v; return true; },
});
/** Canevas qui compte les réallocations (une affectation de width/height efface la toile). */
function fakeCanvas(log) {
  let w = 300, h = 150;
  return { get width() { return w; }, set width(v) { log.alloc++; w = v; }, get height() { return h; }, set height(v) { log.alloc++; h = v; } };
}
function fakeWorld(W, H) {
  const log = { alloc: 0, raf: [], timers: new Map(), nextId: 1 };
  const win = {
    innerWidth: W, innerHeight: H, devicePixelRatio: 1,
    requestAnimationFrame(f) { log.raf.push(f); return log.raf.length; }, cancelAnimationFrame() {},
    setTimeout(f) { const id = log.nextId++; log.timers.set(id, f); return id; }, clearTimeout(id) { log.timers.delete(id); },
    performance: { now: () => 0 }, addEventListener() {}, removeEventListener() {},
  };
  const doc = { hidden: false, createElement: () => fakeCanvas(log), addEventListener() {} };
  const flush = () => { const t = [...log.timers.values()]; log.timers.clear(); t.forEach((f) => f()); const r = log.raf; log.raf = []; r.forEach((f) => f(16)); };
  return { log, win, doc, flush };
}
const rect = (x, y, w, h) => ({ getBoundingClientRect: () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h }) });
function scene(W, H, { avoid = [], seed = 7 } = {}) {
  const w = fakeWorld(W, H);
  const av = { list: avoid };
  const s = createHomeScene({ canvas: fakeCanvas(w.log), win: w.win, doc: w.doc, seed, context2d: fakeCtx, avoid: () => av.list, textBlock: () => av.list });
  s.freeze(true);
  s.setActive(true);
  return { s, w, av };
}

test('V13b (n° 5) : demandes regroupées : 50 événements resize = une seule mise en page, après le calme ; sans délai, une par image', () => {
  const { win, log, flush } = fakeWorld(800, 600);
  let n = 0;
  const later = frameScheduler(win, () => { n++; }, RESIZE_SETTLE_MS);
  for (let k = 0; k < 50; k++) later();
  assert.equal(log.timers.size, 1, 'un seul minuteur en attente');
  flush();
  assert.equal(n, 1);
  const perFrame = frameScheduler(win, () => { n++; });
  for (let k = 0; k < 20; k++) perFrame();
  assert.equal(log.raf.length, 1, 'une seule image demandée');
  flush();
  assert.equal(n, 2);
});

test('V13b (n° 5) : mise en page à taille égale : aucune toile réallouée, même parcours (rien ne clignote)', () => {
  const { s, w } = scene(1280, 720, { avoid: [rect(60, 420, 420, 260)] });
  const r0 = s.stats().route, a0 = w.log.alloc;
  for (let k = 0; k < 10; k++) s.layout();
  assert.equal(w.log.alloc, a0, 'aucune affectation de width/height');
  assert.equal(s.stats().route, r0, 'parcours gardé');
});

test('V13b (n° 11) : défilement : le masque suit le texte ; le parcours n\'est refait que si une pièce tombe sous le texte', () => {
  const { s, av } = scene(568, 320, { avoid: [rect(20, 200, 200, 110)] });
  const st0 = s.stats();
  assert.ok(st0.pieceRects.length > 0);
  // le texte remonte de 4 px : aucune pièce dessous -> même parcours
  const free = st0.pieceRects.every(([x, y, c]) => !(x < 220 + c * 0.45 && x + c > 20 - c * 0.45 && y < 306 + c * 0.45 && y + c > 196 - c * 0.45));
  av.list = [rect(20, 196, 200, 110)];
  s.layout();
  if (free) assert.equal(s.stats().route, st0.route, 'même parcours');
  // le texte passe sur une pièce : nouveau parcours, plus aucune pièce sous le texte
  const [px, py, c] = st0.pieceRects[st0.pieceRects.length - 1];
  av.list = [rect(px, py, c, c)];
  s.layout();
  const st1 = s.stats();
  assert.ok(st1.route > st0.route, 'parcours refait');
  for (const [x, y, w] of st1.pieceRects) assert.ok(!(x < px + c && x + w > px && y < py + c && y + w > py), 'pièce hors du texte');
});

test('V13b (n° 13) : faisceau et pièces dans l\'écran avec une marge, sur des cycles entiers (miroir qui tourne compris), à plusieurs tailles', () => {
  for (const [W, H] of [[3440, 1440], [2560, 1080], [1920, 1080], [1280, 720], [390, 844], [568, 320], [1024, 768]]) {
    for (const seed of [1, 7, 42]) {
      const { s } = scene(W, H, { seed, avoid: [rect(W * 0.05, H * 0.6, Math.min(420, W * 0.6), H * 0.3)] });
      let worst = Infinity, open = 0;
      for (let k = 0; k < 2200; k++) { // 2 200 × 1/60 s ≈ 37 s : trois parcours au moins, rotation du miroir comprise
        s.step(1 / 60);
        const b = s.stats().bounds;
        if (b.margin !== null) worst = Math.min(worst, b.margin);
        open = Math.max(open, b.open);
      }
      const C = s.stats().C;
      assert.ok(worst >= 0.2 * C - 0.5, `${W}x${H} graine ${seed} : marge mini ${worst} px (case ${C}, attendu >= ${(0.2 * C).toFixed(1)})`);
      assert.ok(open >= 1, `${W}x${H} graine ${seed} : un rayon dévié (miroir qui tourne) a bien été arrêté au cadre`);
    }
  }
  assert.equal(BEAM_MARGIN, 0.45);
});

test('V13b (n° 2) : paysage bas : une seule règle, la requête CSS d\'index.html ; la mise en page suit la réponse de matchMedia', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(`@media ${COMPACT_QUERY}`), `index.html contient « @media ${COMPACT_QUERY} »`);
  assert.equal(isCompact(900, 499), true);
  assert.equal(isCompact(900, 499.5), false, 'repli sans matchMedia : mêmes bornes que la règle CSS (499,5 > 499)');
  const st = createStage({ gl: true });
  const p = { w: 900, h: 499, cols: 10, rows: 8, obstacles: [{ x: 327, y: 420, w: 246, h: 60 }] };
  st.relayout({ ...p, compact: false });
  assert.equal(st.compact, false, 'la réponse de matchMedia prime (faux : pas de rails)');
  st.relayout({ ...p, compact: true });
  assert.equal(st.compact, true);
  st.relayout(p);
  assert.equal(st.compact, true, 'sans réponse : repli isCompact');
});
