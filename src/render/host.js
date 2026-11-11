// Hôte de rendu (ARCHITECTURE_V3_RENDU §1, V3-1 à V3-4, V3-6, V3-10, V3-11, V3-13, V3-15). Une seule interface pour game.js : celle du renderer Canvas 2D
// (render, resize, cellAt, celebrate, layout, animating, setReducedMotion, reducedMotion, particlesPeak, particlesAlive) plus
// backend, quality, setQuality, view, onChange, onWake, diagnostics, probe (`?gltest`).
// V4 : le rendu WebGL2 est actif pour le joueur (`AUTO_ACTIVATES_GL`), `?debug` reste en 2D sauf `?r=gl`.
// Le Canvas 2D (#game) reste la surface d'entrée et le rendu de repli. Paramètres d'URL : `?r=gl|2d|auto`, `?q=haut|moyen|bas|0|1|2`, `?nogl`, `?debug`, `?noparallel`, `?hdr=0`, `?gltest`, `&dt=N`.
import { createRenderer, computeLayout } from './renderer.js';
import { createGlContext, probeCapabilities, rendererString, isSoftwareRenderer, glBufferSize } from './gl/context.js';
import { startProgramSet } from './gl/programs.js';
import { createGlRenderer } from './gl/draw.js';
import { createPieceBuilder } from './gl/piece-data.js';
import { PROGRAM_SOURCES } from './gl/shaders.js';
import { createDiagnostics } from './gl/diagnostics.js';
import { createSegmentPost, kindsOfState } from './scene/segments.js';
import { makeView, cellAtClient, screenToWorld, worldToScreen } from './scene/camera.js';
import { createGovernor, startLevel, HOLD_MS } from './scene/governor.js';
import { resolveQuality, QUALITY_NAMES, REBUILD_MIN_MS, QUALITY } from './scene/quality.js';
import { createEffects } from './effects.js';
import { screenWeight, NARROW_FX_QUALITY } from './scene/victory.js';

/** V3-3 : en mode « auto », un GL jugé bon est-il affiché ? Oui depuis V4 (effets, photosensibilité, lisibilité vérifiés) ; `?debug` reste en 2D (V3-35), les pilotes logiciels aussi. */
export const AUTO_ACTIVATES_GL = true;
export const MAX_LOSSES = 2; // à la 3e perte on reste en 2D (V3-4)
export const COMPILE_TIMEOUT_MS = 3000; // V3-10 : pas prêt à 3 s, on reste en 2D
export const REST_30FPS_MS = 20000; // V3-15 : après 20 s sans entrée, 30 images/s
export const REST_FRAME_MS = 1000 / 30 - 2; // V3-15 : 30 images/s au repos, quelle que soit la cadence de l'écran (120 Hz inclus)
export const REST_FROZEN_MS = 60000; // V3-15 : après 60 s, image figée jusqu'à la prochaine entrée

/**
 * Règle de détection V3-3 (pure, testable avec de faux contextes).
 * @param {{requested:'auto'|'gl'|'2d', debug:boolean, contextOk:boolean, renderer:string, caps:{ok:boolean, reason?:string}|null}} i
 * @returns {{backend:'gl'|'c2d', reason:string}}
 */
export function decideBackend({ requested, debug, contextOk, renderer, caps }) {
  if (requested === '2d') return { backend: 'c2d', reason: 'forced-2d' };
  if (!contextOk) return { backend: 'c2d', reason: 'no-context' };
  if (!caps || !caps.ok) return { backend: 'c2d', reason: `caps:${caps && caps.reason ? caps.reason : 'unknown'}` };
  if (requested === 'gl') return { backend: 'gl', reason: isSoftwareRenderer(renderer) ? 'forced-gl-software' : 'forced-gl' };
  if (debug) return { backend: 'c2d', reason: 'debug' };
  if (isSoftwareRenderer(renderer)) return { backend: 'c2d', reason: 'software' };
  return { backend: 'gl', reason: 'auto' };
}

/** Demande de rendu lue dans l'URL. */
export function requestedRenderer(params) {
  const r = params.get('r');
  return r === 'gl' || r === '2d' ? r : 'auto';
}

/** Qualité demandée par `?q=` : 0, 1, 2 (forcée) ou null (auto). */
export function requestedQuality(params) {
  const v = (params.get('q') || '').toLowerCase();
  const n = ['haut', 'moyen', 'bas'].indexOf(v);
  if (n >= 0) return n;
  return v === '0' || v === '1' || v === '2' ? Number(v) : null;
}

const GL_STYLE = 'position:fixed;inset:0;width:100%;height:100%;display:block;pointer-events:none;opacity:0;transition:opacity 200ms linear;';
const ZERO_CAMERA = Object.freeze({ zoom: 1, dx: 0, dy: 0, floorDx: 0, floorDy: 0 });
/** V10 (test final : « ancien faisceau vers 0,4 s ») : durée du fondu de l'ancien tracé quand le geste gagne (170 ms sinon). */
export const BEAM_FADE_WON_MS = 60;

/**
 * @param {object} deps
 *   doc, win, params : document, window, URLSearchParams
 *   createRenderer2d : fabrique du Canvas 2D (par défaut createRenderer) ; glApi : fonctions GL (remplaçables par des faux dans les tests)
 *   now : horloge en ms
 */
export function createHost(deps) {
  const { doc, win, params } = deps;
  const make2d = deps.createRenderer2d || createRenderer;
  const api = { createContext: createGlContext, probe: probeCapabilities, rendererString, startProgramSet, createGlRenderer, createPieceBuilder, sources: PROGRAM_SOURCES, ...(deps.glApi || {}) };
  const now = deps.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const requested = requestedRenderer(params);
  const debug = params.has('debug');
  const gltest = params.has('gltest');
  const injectedDt = gltest && Number(params.get('dt')) > 0 ? Number(params.get('dt')) : 0;
  const diag = createDiagnostics();

  const info = { requested, backend: 'c2d', decision: 'c2d', reason: 'pending', state: 'idle', renderer: '', hdr: null, losses: 0 };
  const listeners = new Set(), wakeFns = new Set();
  let r2d = null, canvas2d = null, r2dStale = false;
  let glCanvas = null, gl = null, glr = null, progs = null;
  let epoch = 0; // invalide les compilations en cours quand le contexte est perdu ou l'hôte détruit
  let reduced = false, lastLayout = null, lastArgs = null, initPromise = null, destroyed = false, fadeTimer = 0;
  // qualité (V3-5, V3-12, V3-13) : `qRequested` null = auto (gouverneur), sinon forcée
  let qRequested = requestedQuality(params);
  let gov = createGovernor(startLevel(!!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches)));
  let qEffective = gov.level, govClock = 0, govLast = -1, lastRebuild = -1e9, targetKey = '';
  // image GL
  let builder = null, post = null, postDims = '', kinds = null, layoutCache = null, layoutKey = '';
  let lastDrawnState = null, lastDrawT = -1, beamChangeT = -1e9, view = null, frameRect = null, viewUsesCamera = false;
  let spotA = 0, pointer = null; // lumière qui suit le pointeur
  let fx = null, partData = null, framesDrawn = 0;
  const parts = { data: null, count: 0 };
  // repos (V3-15)
  let lastActivity = now(), lastDrawWall = -1e9, restKey = '', restLevelNow = 0, pumping = false, lastExternal = -1e9;

  const emit = (ev) => { for (const fn of [...listeners]) { try { fn(ev); } catch { /* un écouteur fautif n'arrête pas le rendu */ } } };
  const notify = (type, reason) => emit({ type, backend: info.backend, reason, quality: qEffective });
  const setBackend = (backend, reason, type = 'backend-change') => {
    const changed = backend !== info.backend;
    info.backend = backend; info.reason = reason;
    if (changed) notify(type, reason);
  };

  // ---- canvas GL ----
  function makeGlCanvas() {
    const c = doc.createElement('canvas');
    c.id = 'game-gl';
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = GL_STYLE;
    c.addEventListener('webglcontextlost', onLost);
    c.addEventListener('webglcontextrestored', onRestored);
    return c;
  }
  function releaseGlCanvas() {
    if (!glCanvas) return;
    glCanvas.removeEventListener('webglcontextlost', onLost);
    glCanvas.removeEventListener('webglcontextrestored', onRestored);
    if (glCanvas.parentNode) glCanvas.parentNode.removeChild(glCanvas);
    try { const ext = gl && gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch { /* déjà perdu */ }
    glCanvas = null; gl = null;
  }
  const glShown = () => glCanvas !== null && info.backend === 'gl' && info.state === 'ready' && glr !== null;

  /** Place #game-gl juste avant #game (derrière l'interface), fondu croisé de 200 ms avec le 2D (instantané en mouvement réduit). V3-11. */
  function mountGl() {
    if (!glCanvas || !canvas2d || !canvas2d.parentNode) return;
    if (glCanvas.parentNode !== canvas2d.parentNode || glCanvas.nextSibling !== canvas2d) canvas2d.parentNode.insertBefore(glCanvas, canvas2d);
    const c = glCanvas, c2 = canvas2d;
    drawLast(true);
    startPump(); // le jeu n'a pas forcément de boucle en cours (2D au repos) : l'hôte prend le relais jusqu'à la prochaine image demandée par game.js
    if (reduced || typeof win.requestAnimationFrame !== 'function') { c.style.transition = 'none'; c.style.opacity = '1'; collapse2d(); return; }
    c.style.transition = 'opacity 200ms linear';
    c.style.opacity = '0';
    if (c2.style) { c2.style.transition = 'opacity 200ms linear'; c2.style.opacity = '1'; }
    const my = ++fadeTimer;
    win.requestAnimationFrame(() => {
      if (c === glCanvas) c.style.opacity = '1';
      if (c2.style) c2.style.opacity = '0';
      win.setTimeout(() => { if (my === fadeTimer) collapse2d(); }, 230);
    });
  }
  /** En GL, le tampon de #game est réduit à 1×1 (V3-2 ; taille CSS inchangée) : le 2D ne coûte plus rien. */
  function collapse2d() {
    if (!glShown() || !canvas2d) return;
    if (canvas2d.width !== 1) canvas2d.width = 1;
    if (canvas2d.height !== 1) canvas2d.height = 1;
    if (canvas2d.style) { canvas2d.style.transition = ''; canvas2d.style.opacity = ''; }
    r2dStale = true;
  }
  /** Retour au 2D : le tampon de #game reprend sa taille ; le 2D redessine aussitôt la même scène. */
  function restore2d() {
    fadeTimer++;
    if (canvas2d && canvas2d.style) { canvas2d.style.transition = ''; canvas2d.style.opacity = ''; }
    if (r2d && r2dStale) { r2d.resize(); r2dStale = false; }
  }
  function unmountGl() {
    if (glCanvas) { glCanvas.style.opacity = '0'; if (glCanvas.parentNode) glCanvas.parentNode.removeChild(glCanvas); }
    restore2d();
  }

  // ---- initialisation (une fois par page, après le premier affichage) ----
  function defer() {
    return new Promise((res) => {
      let done = false;
      const go = () => { if (!done) { done = true; res(); } };
      if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(() => win.setTimeout(go, 0));
      win.setTimeout(go, 300); // onglet caché : pas d'image, on ne reste pas bloqué
    });
  }

  function finishNoGl(reason) {
    info.state = 'ready';
    info.decision = 'c2d';
    setBackend('c2d', reason);
  }

  async function init() {
    if (destroyed) return info;
    if (requested === '2d') { finishNoGl('forced-2d'); return info; }
    if (debug && requested === 'auto') { finishNoGl('debug'); return info; }
    info.state = 'probing';
    await defer();
    if (destroyed) return info;
    glCanvas = makeGlCanvas();
    const t0 = now();
    gl = api.createContext(glCanvas, { nogl: params.has('nogl'), forced: requested === 'gl' });
    diag.data.contextMs = Math.round((now() - t0) * 10) / 10;
    let caps = null;
    if (gl) {
      info.renderer = api.rendererString(gl);
      const cssW = Math.max(1, win.innerWidth || 1), cssH = Math.max(1, win.innerHeight || 1);
      const size = glBufferSize(cssW, cssH, win.devicePixelRatio || 1);
      const tp = now();
      caps = api.probe(gl, { w: size.w, h: size.h });
      diag.data.probeMs = Math.round((now() - tp) * 10) / 10;
      info.hdr = caps.ok ? caps.hdr && params.get('hdr') !== '0' : null;
    }
    const d = decideBackend({ requested, debug, contextOk: gl !== null, renderer: info.renderer, caps });
    info.decision = d.backend;
    if (d.backend !== 'gl') { releaseGlCanvas(); finishNoGl(d.reason); return info; }
    if (requested === 'auto' && !AUTO_ACTIVATES_GL) { releaseGlCanvas(); finishNoGl('auto-gl-off'); info.decision = 'gl'; return info; }
    info.reason = d.reason;
    startCompile(d.reason);
    return info;
  }

  /** Compile les programmes (parallèle si possible, sinon un par image) ; au plus COMPILE_TIMEOUT_MS. V3-10. */
  function startCompile(reason) {
    const my = ++epoch;
    diag.reset();
    const t0 = now();
    const set = api.startProgramSet(gl, api.sources, { parallel: !params.has('noparallel'), now });
    diag.data.compileStartMs = Math.round((now() - t0) * 10) / 10;
    info.state = 'compiling';
    const step = () => {
      if (my !== epoch || destroyed) { set.dispose(); return; }
      const s = set.step();
      if (s === 'pending') {
        if (now() - t0 > COMPILE_TIMEOUT_MS) { set.dispose(); diag.program(false, 'timeout', now() - t0); info.state = 'ready'; setBackend('c2d', 'compile-timeout'); return; }
        win.requestAnimationFrame(step);
        return;
      }
      const names = Object.keys(api.sources);
      for (const n of names) diag.program(set.handles[n] ? set.handles[n].state === 'ready' : false, set.handles[n] ? set.handles[n].log : 'absent', set.handles[n] ? set.handles[n].ms : 0);
      diag.data.compileMs = Math.round(set.totalMs * 10) / 10;
      if (s !== 'ready') { info.state = 'ready'; setBackend('c2d', 'compile-failed'); return; }
      progs = set.programs;
      glr = api.createGlRenderer(gl, progs, { hdr: info.hdr === true });
      glr.reduced = reduced;
      builder = api.createPieceBuilder({ reduced });
      diag.data.objects = glr.objects;
      info.state = 'ready';
      gov.hold(govClock, HOLD_MS.backend);
      setBackend('gl', reason);
      mountGl();
    };
    win.requestAnimationFrame(step);
  }

  // ---- perte et restauration du contexte (V3-4) ----
  function onLost(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault(); // sans cela le navigateur ne restaure jamais le contexte
    epoch++; // annule une compilation en cours
    info.losses += 1;
    glr = null; progs = null; builder = null; targetKey = ''; diag.data.objects = 0;
    info.state = 'lost';
    unmountGl();
    setBackend('c2d', 'context-lost');
    drawLast(true); // même scène, même état, sans attendre la prochaine action du joueur
  }
  function onRestored() {
    if (destroyed || !glCanvas) return;
    if (info.losses > MAX_LOSSES) { info.state = 'ready'; info.reason = 'context-lost-final'; return; }
    startCompile('restored'); // reconstruction complète depuis zéro (aucune ressource gardée)
  }

  // ---- repos (V3-15) : entrées et activité ----
  const onInput = () => { lastActivity = now(); if (pumpWanted()) startPump(); };
  const onPointer = (e) => { pointer = e; lastActivity = now(); if (pumpWanted()) startPump(); };
  const onVisibility = () => { if (doc && doc.visibilityState === 'visible') gov.hold(govClock, HOLD_MS.visibility); };
  if (typeof win.addEventListener === 'function') {
    win.addEventListener('pointermove', onPointer, { passive: true });
    win.addEventListener('pointerdown', onPointer, { passive: true });
    win.addEventListener('keydown', onInput);
    win.addEventListener('touchstart', onInput, { passive: true });
    win.addEventListener('wheel', onInput, { passive: true });
  }
  if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onVisibility);

  /** Sortie du repos figé : relance une boucle propre tant que game.js ne redemande pas d'image lui-même. */
  const pumpWanted = () => restLevelNow >= 2 && glShown() && !destroyed;
  function startPump() {
    for (const fn of [...wakeFns]) { try { fn(); } catch { /* idem */ } }
    if (pumping || typeof win.requestAnimationFrame !== 'function') return;
    pumping = true;
    win.requestAnimationFrame(pump);
  }
  function pump(ts) {
    pumping = false;
    if (!glShown() || lastArgs === null || destroyed) return;
    if (now() - lastExternal > 50) { drawGl(lastArgs.state, lastArgs.result, lastArgs.info, ts, false); }
    if (host.animating) { pumping = true; win.requestAnimationFrame(pump); }
  }
  function drawLast(force) {
    if (lastArgs === null) return;
    if (glShown()) drawGl(lastArgs.state, lastArgs.result, lastArgs.info, undefined, force);
    else if (r2d) { r2d.render(lastArgs.state, lastArgs.result, lastArgs.info); lastLayout = r2d.layout; }
  }

  const NO_WAVE = Object.freeze([0, 0, -5, 0]), waveVec = [0, 0, 0, 0];
  /** t-ième cible de l'état (la même règle que piece-data.js), sans allocation. */
  function lastLitTarget(state, t) {
    if (t < 0) return null;
    for (let i = 0, n = 0; i < state.pieces.length; i++) { const p = state.pieces[i]; if (p.type === 'target') { if (n === t) return p; n++; } }
    return null;
  }

  // ---- image GL ----
  function restKeyOf(state, i) {
    const c = i.cursor, l = i.lift, f = i.flash, p = i.preview, h = i.hint;
    return `${c ? `${c.c},${c.r},${c.holding}` : '-'}|${l ? `${l.c},${l.r}` : '-'}|${f ? `${f.c},${f.r}` : '-'}|${p ? `${p.c},${p.r},${p.o}` : '-'}|${h ? `${h.ghost.c},${h.ghost.r},${h.ghost.o}` : '-'}|${i.refuse ? 'r' : '-'}|${i.won ? 'w' : '-'}|${i.symbols === false ? 's' : '-'}`;
  }

  function governorStep(dtReal, drewFrame) {
    if (qRequested !== null || !drewFrame) return;
    const dtMs = injectedDt > 0 ? injectedDt : dtReal;
    if (govLast < 0) { govLast = 0; return; }
    govClock += dtMs;
    const before = gov.level;
    gov.push(govClock, dtMs);
    if (gov.level !== before) notify('quality-change', `governor:${QUALITY_NAMES[gov.level]}`);
  }

  function wantedQuality() {
    return qRequested !== null ? qRequested : gov.level;
  }

  function drawGl(state, result, i, tsOverride, force) {
    const wall = now();
    const nowMs = gltest ? 0 : (tsOverride !== undefined ? tsOverride : (i.now === undefined ? wall : i.now));
    // repos (V3-15) : image sautée si rien n'a changé
    const nextKey = restKeyOf(state, i);
    const changed = state !== lastDrawnState || force === true || nextKey !== restKey;
    restKey = nextKey;
    if (changed) lastActivity = Math.max(lastActivity, wall);
    if (fx !== null && fx.busy) lastActivity = wall; // pas de repos tant que la victoire joue ou que des particules vivent
    const idle = wall - lastActivity;
    const restLevel = (gltest && injectedDt === 0) || reduced ? (reduced && !gltest && builder.busy ? 0 : 2) : idle >= REST_FROZEN_MS ? 2 : idle >= REST_30FPS_MS ? 1 : 0;
    restLevelNow = restLevel;
    if (!force && !changed) {
      if (restLevel === 2) return false;
      if (restLevel === 1 && wall - lastDrawWall < REST_FRAME_MS) return false; // 30 i/s quelle que soit la cadence de l'écran
    } else if (restLevel === 2 && reduced) restLevelNow = 0; // en mouvement réduit, une image après chaque changement
    const dtRaw = lastDrawT < 0 ? 0 : wall - lastDrawT;
    const dtS = gltest ? 1 : Math.min(0.05, Math.max(0, (lastDrawT < 0 ? 0 : (nowMs - lastDrawT)) / 1000));
    const rect = canvas2d.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width)), cssH = Math.max(1, Math.round(rect.height)), rawDpr = win.devicePixelRatio || 1;
    const res = resolveQuality(wantedQuality(), cssW, cssH, rawDpr);
    const qEff = res.quality, tk = `${res.width}x${res.height}:${qEff}`;
    if (tk !== targetKey && (targetKey === '' || wall - lastRebuild >= REBUILD_MIN_MS)) {
      if (glCanvas.width !== res.width) glCanvas.width = res.width;
      if (glCanvas.height !== res.height) glCanvas.height = res.height;
      targetKey = tk; lastRebuild = wall;
      gov.hold(govClock, HOLD_MS.resize);
    }
    if (qEff !== qEffective) { qEffective = qEff; }
    const W = glCanvas.width, H = glCanvas.height;
    const dims = `${state.cols}x${state.rows}`;
    if (post === null || postDims !== dims) { post = createSegmentPost(state.cols, state.rows); postDims = dims; }
    const lkey = `${cssW}x${cssH}:${dims}`;
    let L = i.layout || null;
    if (L === null) { if (layoutKey !== lkey || layoutCache === null) { layoutCache = computeLayout(cssW, cssH, state.cols, state.rows); layoutKey = lkey; } L = layoutCache; }
    lastLayout = L;
    const cam = i.camera || ZERO_CAMERA;
    view = makeView(L, cam.zoom, cam.dx, cam.dy, state.cols, state.rows);
    viewUsesCamera = true;
    frameRect = { width: rect.width, height: rect.height };
    const sx = W / cssW, sy = H / cssH;
    const stateChanged = state !== lastDrawnState;
    if (stateChanged) { kinds = kindsOfState(state, kinds); if (!gltest && !reduced && lastDrawnState !== null && post.out.count > 0) { glr.snapshotPrev(post); beamChangeT = nowMs; } }
    post.run(result.segments(), kinds, result.in, result.out, L.cell * cam.zoom);
    if (i.refuse && i.refuse.t0 === null) i.refuse.t0 = nowMs;
    const frozenTime = gltest || reduced;
    let vf = null;
    if (!gltest) { // effets : temps figé (gltest) = aucun effet ; pure lecture de l'état et du tracé (V3-29)
      const fxQ = (W < H || cssH < 500) ? Math.max(qEff, NARROW_FX_QUALITY) : qEff; // V9b (V3-20) : portrait et paysage bas (< 500 px CSS, V12) = particules au niveau Bas (surface de flash ≤ 20 % au téléphone)
      if (fx === null) fx = createEffects({ quality: fxQ, reduced });
      fx.setQuality(fxQ); fx.setReduced(reduced);
      fx.update({ nowMs, state, result, post, won: i.won === true, levelKey: i.levelId, victory: i.victory || null });
      vf = fx.frame;
    }
    builder.build(state, result, i, { nowMs, dtS, snap: gltest, post, symbols: i.symbols !== false, litAllowed: fx !== null && !gltest ? fx.litAllowed : null, rot: view.rot });
    // lumière du pointeur
    let spotX = 0, spotY = 0;
    const spotOn = pointer !== null && !frozenTime && pointer.pointerType !== 'touch';
    if (spotOn) { const w = screenToWorld(view, pointer.clientX - (rect.left || 0), pointer.clientY - (rect.top || 0)); spotX = w[0]; spotY = w[1]; }
    spotA += ((spotOn ? 1 : 0) - spotA) * (frozenTime ? 1 : 1 - Math.exp(-dtS * 4));
    const small = Math.min(cssW, cssH), par = 0.013 * small;
    const F = {
      w: W, h: H, k: view.k * sx, tx: view.tx * sx, ty: view.ty * sy, rot: view.rot,
      floorTx: (view.tx - cam.dx + cam.floorDx) * sx, floorTy: (view.ty - cam.dy + cam.floorDy) * sy, camX: cam.dx * sx, camY: cam.dy * sy,
      cols: state.cols, rows: state.rows, quality: qEff, time: frozenTime ? 0 : nowMs / 1000, pulse: frozenTime ? 0 : 1,
      parX: par > 0 ? cam.dx / par : 0, parY: par > 0 ? cam.dy / par : 0, spotX, spotY, spotA,
      beamFade: gltest || reduced ? 1 : Math.min(1, Math.max(0, (nowMs - beamChangeT) / (i.won === true ? BEAM_FADE_WON_MS : 170))), // V10 : à la victoire, l'ancien tracé s'efface en 60 ms won: i.won === true, grain: !gltest,
      gain: vf !== null ? vf.gain : i.won === true ? 1.32 : 1, glow: vf !== null ? vf.glow : 0, bloom: vf !== null ? vf.bloom : 1, expo: vf !== null ? vf.expo : 1.05, flash: 0, wave: NO_WAVE,
    };
    if (view.rot === 1) { // V10 : plateau tourné (portrait) : la dalle (0,30 case de débord) sortait de l'écran sur les côtés ; débord réduit à la place réelle (2 px CSS gardés)
      const left = F.floorTx - F.k * state.rows, right = F.floorTx, room = (Math.min(left, W - right) - 2 * sx) / F.k;
      F.padX = 0.30; F.padY = Math.max(0.02, Math.min(0.30, room));
    }
    if (vf !== null && (vf.wave > 0 || vf.flash > 0)) { // centre de l'onde : la dernière cible allumée
      const tg = lastLitTarget(state, fx.lastLit >= 0 ? fx.lastLit : result.targets.length - 1);
      if (tg !== null) { const s = worldToScreen(view, tg.c + 0.5, tg.r + 0.5); waveVec[0] = (s[0] * sx) / W; waveVec[1] = 1 - (s[1] * sy) / H; waveVec[2] = vf.waveR; const sw = screenWeight(W / H); waveVec[3] = vf.wave * sw; F.wave = waveVec; F.flash = vf.flash * sw; } // V9b (B1) : même part d'écran éclairée qu'en 16/9
    }
    if (!gltest && fx !== null) {
      if (partData === null || partData.length < fx.pool * 8) partData = new Float32Array(fx.pool * 8);
      parts.data = partData; parts.count = fx.fill(partData, screenWeight(W / H)); // V9b (V3-20) : sur un écran étroit, gerbes et étoiles couvrent une plus grande part de l'image : éclat pondéré comme l'éclair
    } else parts.count = 0;
    glr.frame(F, post, builder, parts);
    framesDrawn++; lastDrawWall = wall;
    if (gltest ? stateChanged : reduced && changed) glr.frame(F, post, builder, parts); // le sol relit les faisceaux de l'image précédente : une image figée (gltest, mouvement réduit) doit être exacte // la couche des faisceaux (lue par le sol) vient de l'image précédente : une image figée doit être exacte
    diag.data.objects = glr.objects;
    lastDrawnState = state;
    lastDrawT = gltest ? 0 : nowMs;
    lastLayout = L;
    if (restLevel === 0) governorStep(dtRaw, true);
    return true;
  }

  // ---- interface vue par game.js ----
  const host = {
    info,
    /** Détection (une fois par page). Renvoie `info` ; sûr à appeler plusieurs fois. */
    init() { if (!initPromise) initPromise = init().catch((e) => { info.state = 'ready'; setBackend('c2d', `init-error:${e && e.message ? e.message : e}`); return info; }); return initPromise; },
    /** Branche l'hôte sur le canvas de jeu (#game) : crée le renderer Canvas 2D ; si le GL est prêt, place #game-gl derrière. */
    attach(canvas) {
      host.detach();
      canvas2d = canvas;
      r2d = make2d(canvas);
      r2dStale = false;
      if (reduced) r2d.setReducedMotion(true);
      lastLayout = null; lastArgs = null; layoutCache = null; view = null; frameRect = null; lastDrawnState = null; lastDrawT = -1;
      lastActivity = now();
      if (glShown()) mountGl();
      return host;
    },
    /** Quitte l'écran de jeu : #game-gl est retiré du DOM, le contexte reste vivant. */
    detach() {
      if (glCanvas && glCanvas.parentNode) glCanvas.parentNode.removeChild(glCanvas);
      if (canvas2d && canvas2d.style) { canvas2d.style.transition = ''; canvas2d.style.opacity = ''; }
      fadeTimer++;
      r2d = null; canvas2d = null; lastLayout = null; lastArgs = null; view = null; frameRect = null; lastDrawnState = null;
    },
    /** Libère tout (fin de page, tests). */
    destroy() {
      destroyed = true; epoch++; host.detach();
      if (glr) { glr.dispose(); glr = null; }
      progs = null;
      releaseGlCanvas();
      listeners.clear(); wakeFns.clear();
      if (typeof win.removeEventListener === 'function') {
        win.removeEventListener('pointermove', onPointer); win.removeEventListener('pointerdown', onPointer); win.removeEventListener('keydown', onInput);
        win.removeEventListener('touchstart', onInput); win.removeEventListener('wheel', onInput);
      }
      if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisibility);
    },
    render(state, result, i = {}) {
      lastArgs = { state, result, info: i };
      lastExternal = now();
      if (glShown()) { if (i.won === true && !wonOnce) { wonOnce = true; gov.hold(govClock, HOLD_MS.victory); } if (i.won !== true) wonOnce = false; drawGl(state, result, i); return; }
      r2d.render(state, result, i);
      lastLayout = r2d.layout;
      if (lastLayout) {
        const cam = i.camera || ZERO_CAMERA;
        view = makeView(lastLayout, cam.zoom, cam.dx, cam.dy, state.cols, state.rows);
        viewUsesCamera = i.camera !== undefined;
        const rect = canvas2d.getBoundingClientRect();
        frameRect = { width: rect.width, height: rect.height };
      }
    },
    resize() { if (glShown()) { r2dStale = true; drawLast(); } else if (r2d) r2d.resize(); },
    cellAt: (x, y, state) => {
      if (view !== null && frameRect !== null && viewUsesCamera && canvas2d) {
        const rect = canvas2d.getBoundingClientRect();
        return cellAtClient(view, x, y, rect, frameRect);
      }
      return r2d ? r2d.cellAt(x, y, state) : null;
    },
    celebrate: (state, result) => { if (glShown()) return; if (r2d) r2d.celebrate(state, result); },
    get layout() { return glShown() ? lastLayout : (r2d ? r2d.layout : null); },
    /** Vue de la dernière image présentée (V3-19) : { k, tx, ty, cols, rows, w, h } en pixels CSS du canvas ; null avant la première image. */
    get view() { return view; },
    get animating() {
      if (glShown()) {
        if (gltest && injectedDt === 0) return false;
        if (reduced) return builder.busy;
        return restLevelNow < 2;
      }
      return r2d ? r2d.animating : false;
    },
    get particlesPeak() { return glShown() ? (fx !== null ? fx.peak : 0) : (r2d ? r2d.particlesPeak : 0); },
    get particlesAlive() { return glShown() ? (fx !== null ? fx.alive : 0) : (r2d ? r2d.particlesAlive : 0); },
    /** Réservoir de particules de la qualité effective (V3-28). */
    get particlesPool() { return QUALITY[qEffective].pool; },
    setReducedMotion(on) { reduced = on === true; if (r2d) r2d.setReducedMotion(reduced); if (builder) builder.setReduced(reduced); if (glr) glr.reduced = reduced; if (fx !== null) fx.setReduced(reduced); },
    get reducedMotion() { return reduced; },
    get backend() { return info.backend; },
    /** Qualité effective : 0 Haut, 1 Moyen, 2 Bas. */
    get quality() { return glShown() ? qEffective : wantedQuality(); },
    /** Force une qualité (0, 1, 2) ou repasse en 'auto'. */
    setQuality(q) {
      qRequested = q === 'auto' ? null : [0, 1, 2].includes(q) ? q : qRequested;
      gov = createGovernor(q === 'auto' ? startLevel(!!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches)) : qRequested); // V8 : « Auto » repart du niveau de départ (V3-5, P12), le gouverneur rebaisse si besoin ; avant : l'ancienne valeur forcée restait (Bas puis Auto = Bas)
      govLast = -1; govClock = 0;
      if (glShown()) { // V8 : qualité effective à jour tout de suite (menu : aucune image du jeu, la ligne d'état et le verre suivaient l'ancienne valeur)
        const rect = canvas2d !== null ? canvas2d.getBoundingClientRect() : { width: win.innerWidth || 1, height: win.innerHeight || 1 }; // menu : aucun canvas de jeu attaché
        qEffective = resolveQuality(wantedQuality(), Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)), win.devicePixelRatio || 1).quality;
        drawLast();
      }
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Appelé quand l'hôte sort du repos figé sur une entrée : `requestDraw` s'y branche (facultatif). */
    onWake(fn) { wakeFns.add(fn); return () => wakeFns.delete(fn); },
    /** Banc d'essai : une image complète, tout de suite, sans repos ni saut d'image. */
    renderNow(state, result, i = {}) { lastArgs = { state, result, info: i }; if (glShown()) drawGl(state, result, i, undefined, true); },
    /** `?gltest` : rendu synchrone puis lecture d'un pixel au centre de la case (c, r), plus un décalage facultatif en cases (V3-36). */
    probe(c, r, o = {}) {
      if (!glShown() || lastArgs === null) return null;
      drawGl(lastArgs.state, lastArgs.result, lastArgs.info, undefined, true);
      const T = glr.targets, sx = T.w / view.w;
      const s = worldToScreen(view, c + 0.5 + (o.dx || 0), r + 0.5 + (o.dy || 0));
      return glr.readPixel(s[0] * sx, s[1] * sx);
    },
    diagnostics() {
      return { ...diag.snapshot(), backend: info.backend, state: info.state, reason: info.reason, renderer: info.renderer, hdr: info.hdr, losses: info.losses, contextMs: diag.data.contextMs, probeMs: diag.data.probeMs, compileStartMs: diag.data.compileStartMs,
        governor: { level: gov.level, clock: govClock }, quality: wantedQuality(), restLevel: restLevelNow, targetsKey: targetKey, framesDrawn };
    },
  };
  let wonOnce = false;
  return host;
}
