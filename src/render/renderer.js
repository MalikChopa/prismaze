// Rendu Canvas 2D, style B « cristal coloré » (ARCHITECTURE_V2 D1 à D9) : couche statique en cache + couche dynamique
// (faisceaux additifs en sprites de bandes, cibles et portes avec leur état, pièces mobiles, particules, curseur).
// Aucune allocation par image dans le chemin chaud (hors changement d'état) ; rien n'est demandé de plus quand rien ne bouge.
import { THEME, GEOM, MAX_CELL, MIN_CELL } from './theme.js';
import { createAtlas, atlasKey, TOKEN_BOX } from './sprites.js';
import { createStaticLayer, staticKey } from './static-layer.js';
import { createParticles, BUDGET } from './particles.js';
import { victoryFrame, victoryEvents } from './scene/victory.js';
import { drawTarget, drawGate, drawPastilles } from './pieces.js';
import { createSegmentPost, kindsOfState } from './scene/segments.js';

const HUD_H = 52; // bandeau du haut (numéro de niveau, bouton recommencer : DOM)
const GATE_FADE_MS = 250; // D9 / U7 : panneau dissous en 250 ms
const HALF_PI = Math.PI / 4;
const PULSE_MS = 1200; // U7 : impulsion de victoire le long des faisceaux
const RING_MS = 450; // U7 : anneau pulsé d'un portail
const BEVEL_STEPS = 4; // marches d'un biseau de voie dessiné en Canvas 2D
// J8b : retour d'un lâcher refusé (case occupée, hors plateau) : la pièce glisse vers sa case (SLIDE), tremble (SHAKE), la case refusée reste marquée (MARK)
const SLIDE_MS = 170, SHAKE_MS = 260, MARK_MS = 900;

/**
 * Disposition de l'écran : case entière, plateau centré dans l'espace libre. Pure (testable sans DOM).
 * Le pied de page (outils, légende, texte de victoire SOUS le plateau) est réservé : le plateau ne bouge pas à la victoire.
 */
export function computeLayout(w, h, cols, rows) {
  const pad = Math.min(40, Math.max(12, Math.round(w * 0.03)));
  const footH = h < 600 ? 112 : 150;
  const availW = Math.max(1, w - 2 * pad);
  const availH = Math.max(1, h - HUD_H - footH);
  const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(Math.min(availW / cols, availH / rows))));
  const boardW = cell * cols;
  const boardH = cell * rows;
  const x0 = Math.round((w - boardW) / 2);
  const y0 = HUD_H + Math.max(0, Math.round((availH - boardH) / 2));
  const toolsY = y0 + boardH + 6;
  return { cell, x0, y0, boardW, boardH, padX: Math.max(pad, x0), hudY: HUD_H / 2 + 4, toolsY, captionY: toolsY + 52, winY: toolsY + 44, footH, w, h };
}

/**
 * Disposition « serrée » (éditeur, J8b) : le canvas est déjà le seul espace du plateau (ni bandeau du haut ni pied de page à réserver) ;
 * le plateau occupe tout le canvas moins une marge, centré. Mêmes champs que computeLayout.
 */
export function computeTightLayout(w, h, cols, rows) {
  const pad = Math.min(16, Math.max(6, Math.round(Math.min(w, h) * 0.03)));
  const availW = Math.max(1, w - 2 * pad);
  const availH = Math.max(1, h - 2 * pad);
  const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(Math.min(availW / cols, availH / rows))));
  const boardW = cell * cols;
  const boardH = cell * rows;
  const x0 = Math.round((w - boardW) / 2);
  const y0 = Math.round((h - boardH) / 2);
  return { cell, x0, y0, boardW, boardH, padX: pad, hudY: 0, toolsY: y0 + boardH, captionY: y0 + boardH, winY: y0 + boardH, footH: 0, w, h };
}

/**
 * @param {HTMLCanvasElement} canvas  taille CSS donnée par la page (plein écran)
 * @param {{makeCanvas?:(w:number,h:number)=>object, fit?:'screen'|'tight', boardFill?:string}} [options]  fit 'tight' : plateau serré dans le canvas (éditeur) ; boardFill : fond du plateau (éditeur : THEME.editorBoardFill)
 */
export function createRenderer(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  const particles = createParticles();
  let dpr = 1, cssW = 0, cssH = 0, layout = null, layoutDims = '';
  // V3-7 / V3-8 / V3-37 : coupures de croisement et voies de contre-sens (scene/segments.js, communes aux deux rendus)
  let post = null, postDims = '', kinds = null, overflowWarned = false;
  const bw = new Float64Array(3);
  let atlas = null, staticLayer = null, staticFor = null, staticKeyNow = '';
  let reduced = false;
  let cam = null; // pose de caméra de la dernière image (V5 : parallaxe, zoom ; null = aucune)
  // décor dérivé de l'état (recalculé quand l'objet état change, jamais à chaque image)
  let decorFor = null, dynPieces = [], targetPieces = [], gatePieces = [], portalPieces = [], gateNumber = null, targetPastilles = null;
  let offX = 0, offY = 0; // décalage de la pièce refusée (retour d'un lâcher), calculé par refuseOffset
  // animations
  let shownO = new Int8Array(0), rotT0 = new Float64Array(0), rotFrom = new Int8Array(0), rotDelta = new Int8Array(0);
  let gateOpenAt = new Float64Array(0), gateWasOpen = new Uint8Array(0), litWas = new Uint8Array(0);
  let lastNow = -1, animating = false, firstFrame = true;
  // U7 : impulsion de victoire le long des faisceaux, anneau pulsé des portails (coupés en mouvement réduit)
  let pulseT0 = -1e9, pulsePending = false, portalWas = new Uint8Array(0), portalPulseAt = new Float64Array(0);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, Math.round(rect.width));
    cssH = Math.max(1, Math.round(rect.height));
    dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    layout = null; atlas = null; staticLayer = null;
  }

  const rot = () => (layout !== null && layout.rot === 1 ? 1 : 0); // V7 : plateau tourné d'un quart de tour (contexte tourné ; symboles contre-tournés)
  /** Dessine `fn` droit à l'écran autour de (cx, cy) quand le plateau est tourné. */
  function upright(cx, cy, fn) {
    if (rot() === 0) { fn(); return; }
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-Math.PI / 2); ctx.translate(-cx, -cy); fn(); ctx.restore();
  }

  function ensureLayout(state, given) {
    if (cssW === 0) resize();
    const dims = `${cssW}x${cssH}:${state.cols}x${state.rows}`;
    if (given) { // mise en page immersive calculée par l'appelant (V3-17, scene/layout.js) ; le cache dépend de la case
      if (layout !== given) { layout = given; layoutDims = ''; atlas = null; staticLayer = null; staticFor = null; }
    } else if (layout === null || dims !== layoutDims) {
      layout = (options.fit === 'tight' ? computeTightLayout : computeLayout)(cssW, cssH, state.cols, state.rows);
      layoutDims = dims; atlas = null; staticLayer = null;
    }
    const pd = `${state.cols}x${state.rows}`;
    if (post === null || postDims !== pd) { post = createSegmentPost(state.cols, state.rows); postDims = pd; }
    if (atlas === null || atlas.key !== atlasKey(layout.cell, dpr)) atlas = createAtlas(layout.cell, dpr, options.makeCanvas);
    if (staticFor !== state) { // la clé n'est recalculée que pour un nouvel objet état
      staticFor = state; staticKeyNow = staticKey(state, layout.cell, dpr, rot());
    }
    if (staticLayer === null || staticLayer.key !== staticKeyNow) staticLayer = createStaticLayer(state, layout.cell, dpr, options.makeCanvas, rot(), options.boardFill);
  }

  function ensureDecor(state, now) {
    if (decorFor === state) return;
    const n = state.pieces.length;
    if (shownO.length !== n) { // nouveau niveau (ou éditeur) : tout repart de zéro
      shownO = new Int8Array(n).fill(-1); rotT0 = new Float64Array(n); rotFrom = new Int8Array(n); rotDelta = new Int8Array(n);
      gateOpenAt = new Float64Array(n).fill(-1e9); gateWasOpen = new Uint8Array(n); litWas = new Uint8Array(n); firstFrame = true;
      portalWas = new Uint8Array(n); portalPulseAt = new Float64Array(n).fill(-1e9); pulseT0 = -1e9; pulsePending = false;
    }
    dynPieces = []; targetPieces = []; gatePieces = []; portalPieces = [];
    for (let i = 0; i < n; i++) {
      const p = state.pieces[i];
      if (p.type === 'target') targetPieces.push(p);
      else if (p.type === 'gate') gatePieces.push(p);
      else if (p.type === 'portal') portalPieces.push(p);
      else if (!p.fixed && p.type !== 'wall' && p.type !== 'emitter') dynPieces.push(p);
    }
    gateNumber = new Map(); targetPastilles = new Map();
    for (let g = 0; g < gatePieces.length; g++) {
      const lk = gatePieces[g].link;
      if (lk) { const key = lk[1] * state.cols + lk[0]; if (!targetPastilles.has(key)) targetPastilles.set(key, g + 1); }
    }
    kinds = kindsOfState(state, kinds);
    decorFor = state;
  }

  /** Lance une rotation animée de 90 ms quand l'orientation affichée d'une pièce change (rotation, annuler, refaire). */
  function trackRotations(now) {
    for (let k = 0; k < dynPieces.length; k++) {
      const p = dynPieces[k];
      if (p.type !== 'mirror' && p.type !== 'splitter') continue;
      const prev = shownO[p.id];
      if (prev === -1 || reduced) { shownO[p.id] = p.o; rotDelta[p.id] = 0; continue; }
      if (prev !== p.o) {
        const d = ((p.o - prev + 2) & 3) - 2; // plus court chemin : -2..1
        rotFrom[p.id] = prev; rotDelta[p.id] = d === -2 ? 2 : d; rotT0[p.id] = now; shownO[p.id] = p.o;
      }
    }
  }

  function fxFromResult(state, result, now) {
    for (let t = 0; t < result.targets.length; t++) {
      const x = result.targets[t], lit = x.lit ? 1 : 0;
      if (!firstFrame && lit === 1 && litWas[t] === 0 && !reduced) {
        const cx = (targetPieces[t].c + 0.5), cy = (targetPieces[t].r + 0.5);
        particles.burst(cx, cy, x.need, BUDGET.lit, 1.6, Math.PI * 2, 0, 0.7);
        if ((x.need & (x.need - 1)) !== 0) particles.burst(cx, cy, 7, BUDGET.fuse, 2.4, Math.PI * 2, 0, 0.5); // fusion de couleurs : étincelle blanche
      }
      litWas[t] = lit;
    }
    for (let g = 0; g < result.gates.length; g++) {
      const open = result.gates[g].open ? 1 : 0;
      if (open === 1 && gateWasOpen[g] === 0) {
        if (firstFrame || reduced) gateOpenAt[g] = -1e9;
        else { gateOpenAt[g] = now; particles.burst(gatePieces[g].c + 0.5, gatePieces[g].r + 0.5, 7, BUDGET.gate, 2, Math.PI * 2, 0, 0.8); }
      }
      if (open === 0) gateOpenAt[g] = -1e9;
      gateWasOpen[g] = open;
    }
    for (let k = 0; k < portalPieces.length; k++) { // portail : anneau pulsé la première fois que la lumière y entre
      const p = portalPieces[k], b = (p.r * state.cols + p.c) * 4, on = (result.in[b] | result.in[b + 1] | result.in[b + 2] | result.in[b + 3]) !== 0 ? 1 : 0;
      if (on === 1 && portalWas[k] === 0 && !firstFrame && !reduced) {
        portalPulseAt[k] = now;
        particles.burst(p.c + 0.5, p.r + 0.5, result.in[b] | result.in[b + 1] | result.in[b + 2] | result.in[b + 3], BUDGET.portal, 1.4, Math.PI * 2, 0, 0.6);
      }
      portalWas[k] = on;
    }
    firstFrame = false;
  }

  /** Victoire : jusqu'à 160 particules réparties sur les cibles (D8). Sans effet en mouvement réduit (D9 : halo fixe, voir `won`). */
  function celebrate(state, result) {
    if (reduced || result === undefined) return;
    const n = result.targets.length;
    if (n === 0 || targetPieces.length !== n) return; // (les cibles sont fixes : leurs cases sont connues dès la première image)
    const each = Math.floor(BUDGET.victory / n);
    for (let t = 0; t < n; t++) particles.burst(targetPieces[t].c + 0.5, targetPieces[t].r + 0.5, result.targets[t].need, each, 3.2, Math.PI * 2, 0, 1.3);
    pulsePending = true; // l'impulsion démarre à l'image suivante (l'horloge de l'image n'est pas connue ici)
    animating = true;
  }

  /**
   * Dessine une image complète.
   * @param {object} state  état (engine/state.js)
   * @param {object} result  résultat de trace() pour cet état (tableaux réutilisés : lus ici, jamais conservés)
   * @param {{now?:number, cursor?:{c,r,holding}|null, lift?:{c,r}|null, flash?:{c,r}|null, preview?:{c,r,o,type}|null,
   *   hint?:{ghost:{c,r,o}, source:{c,r}, moves:boolean}|null, symbols?:boolean, won?:boolean}} [info]
   */
  /** Victoire du Canvas 2D (repli « digne », V3-27 simplifiée) : gerbes dorées et pluie de la chronologie (mêmes événements que le GL, à graine fixe), 0 en mouvement réduit. */
  let v2Id = null, v2Last = -1;
  function victory2d(v, result) {
    if (v === null || reduced) return;
    if (v.id !== v2Id) { v2Id = v.id; v2Last = -1; }
    const n = result.targets.length;
    const events = victoryEvents(v2Last, v.t, { seed: 20261107, targets: n, skipAt: v.skipAt });
    v2Last = Math.max(v2Last, v.t);
    for (const e of events) {
      if (e.type === 'stars') { const cols = layout ? Math.round((rot() ? layout.boardH : layout.boardW) / layout.cell) : 1, rows = layout ? Math.round((rot() ? layout.boardW : layout.boardH) / layout.cell) : 1; particles.burst(cols / 2, rows / 2, 3, Math.min(30, e.n), e.speed * 0.7, Math.PI * 2, 0, 1.4); }
      else if (e.type === 'one' && e.target < n && targetPieces[e.target]) particles.burst(targetPieces[e.target].c + 0.5, targetPieces[e.target].r + 0.5, result.targets[e.target].need, 14, 2.6, Math.PI * 2, 0, 0.9);
    }
  }

  /** Anneau lumineux qui part du plateau (2D : pas de réfraction), dessiné sur toute la surface. */
  function drawWave2d(L, v) {
    const f = victoryFrame(v.t, { skipAt: v.skipAt });
    if (f.wave <= 0) return;
    const cx = L.x0 + L.boardW / 2, cy = L.y0 + L.boardH / 2, r = Math.max(2, f.waveR * cssH), w = cssH * 0.22;
    const g = ctx.createRadialGradient(cx, cy, Math.max(0, r - w), cx, cy, r + w);
    g.addColorStop(0, 'rgba(201,195,255,0)');
    g.addColorStop(0.5, `rgba(214,206,255,${(0.42 * f.wave).toFixed(3)})`);
    g.addColorStop(1, 'rgba(201,195,255,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r + w, 0, Math.PI * 2); if (r - w > 0) ctx.arc(cx, cy, r - w, 0, Math.PI * 2, true); ctx.fill();
    ctx.restore();
  }

  function render(state, result, info = {}) {
    ensureLayout(state, info.layout || null);
    const now = info.now === undefined ? 0 : info.now;
    ensureDecor(state, now);
    trackRotations(now);
    fxFromResult(state, result, now);
    const dt = lastNow < 0 ? 0 : Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    particles.update(dt);
    victory2d(info.victory || null, result);

    const L = layout, cell = L.cell;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, cssW, cssH);
    cam = info.camera || null;
    if (cam !== null && (cam.zoom !== 1 || cam.dx !== 0 || cam.dy !== 0)) { // caméra (V3-18) : zoom autour du centre du plateau, puis décalage
      const cx = L.x0 + L.boardW / 2, cy = L.y0 + L.boardH / 2;
      ctx.translate(cx + cam.dx, cy + cam.dy); ctx.scale(cam.zoom, cam.zoom); ctx.translate(-cx, -cy);
    }
    const turned = L.rot === 1, wW = turned ? L.boardH : L.boardW, wH = turned ? L.boardW : L.boardH; // côtés du plateau en pixels, dans le repère du monde
    if (turned) { ctx.save(); ctx.translate(L.x0 + L.boardW, L.y0); ctx.rotate(Math.PI / 2); } // V7 : (x, y) → (x0 + boardW − y, y0 + x)
    ctx.drawImage(staticLayer.canvas, 0, 0, staticLayer.canvas.width, staticLayer.canvas.height, turned ? 0 : L.x0, turned ? 0 : L.y0, wW, wH);

    ctx.save();
    ctx.translate(turned ? 0 : L.x0, turned ? 0 : L.y0);
    ctx.beginPath(); ctx.rect(0, 0, wW, wH); ctx.clip();
    post.run(result.segments(), kinds, result.in, result.out, cell);
    if (post.overflow > 0 && !overflowWarned) { overflowWarned = true; console.error(`renderer : ${post.overflow} tronçon(s) perdu(s) (tampon de ${post.out.x0.length})`); }
    drawBeams(cell);
    drawCrossings(cell);
    if (info.symbols !== false) drawTokens(cell);
    if (pulsePending) { pulsePending = false; pulseT0 = now; }
    if (now - pulseT0 < PULSE_MS) drawPulse(result, cell, now);
    ctx.drawImage(staticLayer.top, 0, 0, staticLayer.top.width, staticLayer.top.height, 0, 0, wW, wH);
    drawPortalGlow(result, state, cell);
    drawPortalRings(cell, now);
    drawGates(result, cell, now);
    drawTargets(result, cell);
    const rf = info.refuse || null;
    if (rf !== null && rf.t0 === null) rf.t0 = now; // l'horloge de l'image n'est connue que ici : la première image la fixe
    drawMobile(state, cell, now, rf);
    particles.draw(ctx, atlas.dot, cell);
    drawOverlays(cell, info, state, now);
    if (info.won) { // victoire : halo fixe autour du plateau (identique en mouvement réduit)
      // V13 : lueur douce vers l'intérieur, coins arrondis (le trait net de 3 px se lisait comme un cadre de focus clavier, test joueur n° 12)
      const rr = Math.min(wW, wH) * 0.03;
      for (const [inset, width, alpha] of [[2, 4, 0.10], [4, 2, 0.16], [5.5, 1, 0.30]]) {
        ctx.lineWidth = width; ctx.strokeStyle = `rgba(201,189,255,${alpha})`;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(inset, inset, wW - 2 * inset, wH - 2 * inset, rr); else ctx.rect(inset, inset, wW - 2 * inset, wH - 2 * inset);
        ctx.stroke();
      }
    }
    ctx.restore();
    if (turned) ctx.restore();
    if (info.victory && !reduced) drawWave2d(L, info.victory);

    animating = particles.count > 0;
    for (let k = 0; k < dynPieces.length && !animating; k++) {
      const id = dynPieces[k].id;
      if (rotDelta[id] !== 0 && now - rotT0[id] < GEOM.rotateMs) animating = true;
    }
    for (let g = 0; g < result.gates.length && !animating; g++) if (now - gateOpenAt[g] < GATE_FADE_MS) animating = true;
    if (!animating && (pulsePending || now - pulseT0 < PULSE_MS)) animating = true;
    if (!animating && rf !== null && now - rf.t0 < MARK_MS) animating = true;
    for (let k = 0; k < portalPieces.length && !animating; k++) if (now - portalPulseAt[k] < RING_MS) animating = true;
  }

  // Une bande de faisceau (horizontale, ou verticale si `vertical`) de `a0` à `a1` (pixels sur l'axe), centrée sur `cross` ; fondu de `fa` / `fb` pixels aux bouts (coupure V3-7).
  function putBand(band, a0, len, cross, th, vertical) {
    if (vertical) ctx.drawImage(band, cross - th / 2, a0, th, len); else ctx.drawImage(band, a0, cross - th / 2, len, th);
  }
  function drawPiece(bands, a0, a1, cross, vertical, fa, fb) {
    for (let k = 0; k < 3; k++) {
      const th = bw[k], band = bands[k], s0 = a0 + fa, e0 = a1 - fb;
      if (e0 > s0) putBand(band, s0, e0 - s0, cross, th, vertical);
      if (fa > 0) for (let q = 0; q < 3; q++) { ctx.globalAlpha = (q + 1) / 4; putBand(band, a0 + (fa * q) / 3, fa / 3, cross, th, vertical); }
      if (fb > 0) for (let q = 0; q < 3; q++) { ctx.globalAlpha = (3 - q) / 4; putBand(band, e0 + (fb * q) / 3, fb / 3, cross, th, vertical); }
      if (fa > 0 || fb > 0) ctx.globalAlpha = 1;
    }
  }

  function drawBeams(cell) {
    const o = post.out;
    ctx.globalCompositeOperation = 'lighter';
    bw[0] = GEOM.beamWide * cell; bw[1] = GEOM.beamNarrow * cell; bw[2] = GEOM.beamCore * cell;
    const g = 1.3 * cell;
    for (let i = 0; i < o.count; i++) {
      const m = o.mask[i], x0 = o.x0[i], y0 = o.y0[i], x1 = o.x1[i], y1 = o.y1[i], bands = atlas.beam[m], fa = o.fa[i] * cell, fb = o.fb[i] * cell;
      if (y0 === y1) drawPiece(bands[0], x0 * cell, x1 * cell, y0 * cell, false, fa, fb); // couchée
      else if (x0 === x1) drawPiece(bands[1], y0 * cell, y1 * cell, x0 * cell, true, fa, fb); // debout
      else { // biseau d'une voie (V3-37) : quelques marches de 0,06 case ; une bande tournée laisserait des coins en biais (le halo large est carré aux bouts)
        const vert = o.axis[i] === 1, a0 = (vert ? y0 : x0) * cell, a1 = (vert ? y1 : x1) * cell, c0 = (vert ? x0 : y0) * cell, c1 = (vert ? x1 : y1) * cell;
        for (let q = 0; q < BEVEL_STEPS; q++) {
          const f0 = q / BEVEL_STEPS, f1 = (q + 1) / BEVEL_STEPS;
          drawPiece(bands[vert ? 1 : 0], a0 + (a1 - a0) * f0, a0 + (a1 - a0) * f1, c0 + (c1 - c0) * (f0 + f1) / 2, vert, q === 0 ? Math.min(fa, (a1 - a0) / BEVEL_STEPS) : 0, q === BEVEL_STEPS - 1 ? Math.min(fb, (a1 - a0) / BEVEL_STEPS) : 0);
        }
      }
      const gl = o.glow[i];
      if (gl !== 0) { // halo aux vraies extrémités seulement (pas aux bords d'une coupure ni aux raccords d'une voie)
        const gimg = atlas.glow[m];
        ctx.globalAlpha = 0.7;
        if ((gl & 1) !== 0) ctx.drawImage(gimg, x0 * cell - g / 2, y0 * cell - g / 2, g, g);
        if ((gl & 2) !== 0) ctx.drawImage(gimg, x1 * cell - g / 2, y1 * cell - g / 2, g, g);
        ctx.globalAlpha = 1; // (la v2 laissait 0,7 aux bandes des tronçons suivants : état résiduel corrigé)
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // V3-7 : l'addition par `lighter` peint un croisement en violet ou en blanc alors que le moteur ne mélange pas (E3). L'anneau de croisement ne marque
  // que les cases COUPÉES (traversée trompeuse sur case sans pièce déviante) : jamais sur un miroir, un prisme, un séparateur, un portail, un émetteur ni une cible.
  function drawCrossings(cell) {
    const rs = 0.44 * cell, cols = post.cols;
    for (let q = 0; q < post.cutCount; q++) {
      const c = post.cuts[q];
      ctx.drawImage(atlas.ring, ((c % cols) + 0.5) * cell - rs / 2, (((c / cols) | 0) + 0.5) * cell - rs / 2, rs, rs);
    }
  }

  // D6 : jetons de symbole espacés le long des faisceaux (entre deux centres de cases : jamais sur une pièce).
  function drawTokens(cell) {
    const tk = post.tokens, ts = TOKEN_BOX * cell;
    if (rot() === 1) { // jetons droits à l'écran (V7) : contre-rotation sans état sauvegardé
      const a = Math.PI / 2;
      for (let i = 0; i < tk.count; i++) { const x = tk.x[i] * cell, y = tk.y[i] * cell; ctx.translate(x, y); ctx.rotate(-a); ctx.drawImage((tk.axis[i] === 1 ? atlas.token : atlas.tokenV)[tk.mask[i]], -ts / 2, -ts / 2, ts, ts); ctx.rotate(a); ctx.translate(-x, -y); } // tourné : l'axe à l'écran est l'autre
      return;
    }
    for (let i = 0; i < tk.count; i++) ctx.drawImage((tk.axis[i] === 1 ? atlas.tokenV : atlas.token)[tk.mask[i]], tk.x[i] * cell - ts / 2, tk.y[i] * cell - ts / 2, ts, ts); // V10 : gélule le long du faisceau
  }

  /** U7 : à la victoire, un éclat parcourt chaque série de faisceau (position = phase du temps + rang de la série). */
  function drawPulse(result, cell, now) {
    const seg = result.segments(), t = (now - pulseT0) / PULSE_MS, fade = 1 - t, gs = 0.95 * cell;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.max(0, Math.min(1, fade * 1.4));
    for (let i = 0; i < seg.count; i++) {
      const p = (t * 1.6 + i * 0.137) % 1;
      const x = (seg.x0[i] + (seg.x1[i] - seg.x0[i]) * p) * cell, y = (seg.y0[i] + (seg.y1[i] - seg.y0[i]) * p) * cell;
      ctx.drawImage(atlas.glow[seg.mask[i]], x - gs / 2, y - gs / 2, gs, gs);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawPortalRings(cell, now) {
    for (let k = 0; k < portalPieces.length; k++) {
      const e = (now - portalPulseAt[k]) / RING_MS;
      if (e < 0 || e >= 1) continue;
      const p = portalPieces[k], s = (0.5 + e * 1.1) * cell;
      ctx.globalAlpha = 1 - e;
      ctx.drawImage(atlas.ring, (p.c + 0.5) * cell - s / 2, (p.r + 0.5) * cell - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  function drawPortalGlow(result, state, cell) {
    const inM = result.in, gs = 1.3 * cell;
    for (let k = 0; k < portalPieces.length; k++) {
      const p = portalPieces[k], b = (p.r * state.cols + p.c) * 4, m = inM[b] | inM[b + 1] | inM[b + 2] | inM[b + 3];
      if (m === 0) continue;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.8;
      ctx.drawImage(atlas.glow[m], (p.c + 0.5) * cell - gs / 2, (p.r + 0.5) * cell - gs / 2, gs, gs);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawGates(result, cell, now) {
    for (let g = 0; g < gatePieces.length; g++) {
      const p = gatePieces[g], open = result.gates[g].open;
      const fade = open ? Math.max(0, 1 - (now - gateOpenAt[g]) / GATE_FADE_MS) : 1;
      upright((p.c + 0.5) * cell, (p.r + 0.5) * cell, () => drawGate(ctx, p.c * cell, p.r * cell, cell, g + 1, open, fade));
    }
  }

  function drawTargets(result, cell) {
    for (let t = 0; t < targetPieces.length; t++) {
      const p = targetPieces[t], x = result.targets[t], cx = (p.c + 0.5) * cell, cy = (p.r + 0.5) * cell;
      if (x.lit) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.9;
        const gs = 1.3 * cell;
        ctx.drawImage(atlas.glow[x.need], cx - gs / 2, cy - gs / 2, gs, gs);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      upright(cx, cy, () => {
        drawTarget(ctx, cx, cy, cell, x.need, x.got, x.lit, x.reached);
        const n = targetPastilles.get(p.r * layoutCols() + p.c);
        if (n !== undefined) drawPastilles(ctx, cx, cy + 0.34 * cell, cell, n);
      });
    }
  }
  const layoutCols = () => decorFor.cols;

  /** Décalage (offX, offY) de la pièce refusée : glisse de la case visée vers sa case, puis tremble. Aucun mouvement en mouvement réduit. */
  function refuseOffset(rf, cell, now) {
    offX = 0; offY = 0;
    if (reduced) return;
    const age = now - rf.t0;
    if (age < 0) return;
    if (rf.at !== null && age < SLIDE_MS) {
      const f = 1 - age / SLIDE_MS, e = f * f;
      offX = (rf.at.c - rf.from.c) * cell * e; offY = (rf.at.r - rf.from.r) * cell * e;
      return;
    }
    const a = age - (rf.at !== null ? SLIDE_MS : 0);
    if (a < SHAKE_MS) { const s = Math.sin(a / 24) * 0.09 * cell * (1 - a / SHAKE_MS); if (rot() === 1) offY = s; else offX = s; } // V7 : tremblement horizontal à l'écran
  }

  function drawMobile(state, cell, now, rf) {
    const h = cell / 2;
    for (let k = 0; k < dynPieces.length; k++) {
      const p = dynPieces[k];
      let x = p.c * cell, y = p.r * cell;
      if (rf !== null && rf.id === p.id) { refuseOffset(rf, cell, now); x += offX; y += offY; }
      switch (p.type) {
        case 'mirror': case 'splitter': {
          const e = (now - rotT0[p.id]) / GEOM.rotateMs;
          if (rotDelta[p.id] !== 0 && e < 1) {
            const t = e < 0 ? 0 : 1 - (1 - e) * (1 - e), ang = -(rotFrom[p.id] + rotDelta[p.id] * t) * HALF_PI;
            ctx.drawImage(p.type === 'mirror' ? atlas.tile : atlas.splitterBase, x, y, cell, cell);
            ctx.save(); ctx.translate(x + h, y + h); ctx.rotate(ang); ctx.drawImage(atlas.line, -h, -h, cell, cell); ctx.restore();
          } else {
            ctx.drawImage(p.type === 'mirror' ? atlas.mirror[p.o & 3] : atlas.splitter[p.o & 3], x, y, cell, cell);
          }
          break;
        }
        case 'prism': ctx.drawImage(atlas.prism, x, y, cell, cell); break;
        case 'filter': upright(x + h, y + h, () => ctx.drawImage(atlas.filter[p.mask], x, y, cell, cell)); break;
        default: break;
      }
    }
  }

  /** Curseur clavier (cadre de 2 px, 3 px quand une pièce est en main), case candidate, aperçu de rotation (U3), contour des pièces fixes, indice. */
  function drawOverlays(cell, info, state, now) {
    ctx.setLineDash([]);
    const rf = info.refuse;
    if (rf && now - rf.t0 < MARK_MS) { // case refusée : cadre rose et croix, qui s'estompent (fixes en mouvement réduit)
      const m = rf.at !== null ? rf.at : rf.from, age = now - rf.t0, fade = reduced || age < MARK_MS * 0.6 ? 1 : 1 - (age - MARK_MS * 0.6) / (MARK_MS * 0.4);
      const x = m.c * cell, y = m.r * cell, q = cell * 0.3;
      ctx.globalAlpha = Math.max(0, fade); ctx.strokeStyle = '#ff8aa0'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.strokeRect(x + 3, y + 3, cell - 6, cell - 6);
      ctx.beginPath(); ctx.moveTo(x + q, y + q); ctx.lineTo(x + cell - q, y + cell - q); ctx.moveTo(x + cell - q, y + q); ctx.lineTo(x + q, y + cell - q); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (info.hint) drawHint(cell, info.hint);
    if (info.preview) { // fantôme de la prochaine orientation (appui long, clic droit)
      const q = info.preview, x = q.c * cell, y = q.r * cell;
      ctx.globalAlpha = 0.55;
      ctx.drawImage(q.type === 'splitter' ? atlas.splitter[q.o & 3] : atlas.mirror[q.o & 3], x, y, cell, cell);
      ctx.globalAlpha = 1;
      ctx.setLineDash([cell * 0.07, cell * 0.06]); ctx.lineWidth = 2; ctx.strokeStyle = THEME.accentLight;
      ctx.strokeRect(x + 3, y + 3, cell - 6, cell - 6); ctx.setLineDash([]);
    }
    if (info.flash) { ctx.strokeStyle = THEME.white; ctx.lineWidth = 2; ctx.strokeRect(info.flash.c * cell + 3, info.flash.r * cell + 3, cell - 6, cell - 6); }
    const mark = (c, r, width, fillAlpha) => {
      if (fillAlpha > 0) { ctx.fillStyle = `rgba(${THEME.accentRgb},${fillAlpha})`; ctx.fillRect(c * cell, r * cell, cell, cell); }
      ctx.strokeStyle = THEME.accentLight; ctx.lineWidth = width;
      ctx.strokeRect(c * cell + width / 2 + 1, r * cell + width / 2 + 1, cell - width - 2, cell - width - 2);
    };
    if (info.lift) mark(info.lift.c, info.lift.r, 2, 0.12);
    if (info.cursor) { if (info.cursor.holding) mark(info.cursor.c, info.cursor.r, 3, 0.1); else mark(info.cursor.c, info.cursor.r, 2, 0); }
  }

  /** Indice : fantôme translucide de la pièce visée et anneau sur la pièce source (statique : identique en mouvement réduit). */
  function drawHint(cell, hint) {
    const { ghost, source } = hint;
    const sx = (source.c + 0.5) * cell, sy = (source.r + 0.5) * cell, gx = (ghost.c + 0.5) * cell, gy = (ghost.r + 0.5) * cell;
    ctx.lineCap = 'round';
    if (hint.moves) {
      ctx.setLineDash([cell * 0.08, cell * 0.08]); ctx.strokeStyle = `rgba(${THEME.accentRgb},0.6)`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(gx, gy); ctx.stroke();
    }
    ctx.setLineDash([cell * 0.07, cell * 0.05]); ctx.strokeStyle = THEME.accentLight; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, cell * 0.4, 0, Math.PI * 2); ctx.stroke();
    const o = ghost.o & 3, sprite = ghost.type === 'prism' ? atlas.prism : ghost.type === 'filter' && atlas.filter[ghost.mask] ? atlas.filter[ghost.mask] : ghost.type === 'splitter' ? atlas.splitter[o] : atlas.mirror[o];
    ctx.globalAlpha = 0.5; upright(gx, gy, () => { if (ghost.type === 'filter') ctx.drawImage(sprite, ghost.c * cell, ghost.r * cell, cell, cell); }); if (ghost.type !== 'filter') ctx.drawImage(sprite, ghost.c * cell, ghost.r * cell, cell, cell); ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  /** Case (c, r) sous un point de la fenêtre (clientX/clientY), ou null. */
  function cellAt(clientX, clientY, state) {
    if (layout === null) return null;
    const rect = canvas.getBoundingClientRect();
    let x = clientX - rect.left - layout.x0, y = clientY - rect.top - layout.y0;
    if (layout.rot === 1) { // V7 : plateau tourné (inverse de (x, y) → (x0 + boardW − y, y0 + x))
      const hw = layout.boardW / 2, hh = layout.boardH / 2, z = cam !== null ? cam.zoom : 1, dx = cam !== null ? cam.dx : 0, dy = cam !== null ? cam.dy : 0;
      const sx = (x - hw - dx) / z + hw, sy = (y - hh - dy) / z + hh, wx = sy, wy = layout.boardW - sx;
      if (wx < 0 || wy < 0 || wx >= layout.boardH || wy >= layout.boardW) return null;
      const c = Math.floor(wx / layout.cell), r = Math.floor(wy / layout.cell);
      return c >= state.cols || r >= state.rows ? null : { c, r };
    }
    if (cam !== null) { // inverse de la transformation de caméra de la dernière image
      const hw = layout.boardW / 2, hh = layout.boardH / 2;
      x = (x - hw - cam.dx) / cam.zoom + hw; y = (y - hh - cam.dy) / cam.zoom + hh;
    }
    if (x < 0 || y < 0 || x >= layout.boardW || y >= layout.boardH) return null;
    const c = Math.floor(x / layout.cell), r = Math.floor(y / layout.cell);
    if (c >= state.cols || r >= state.rows) return null;
    return { c, r };
  }

  return {
    render, resize, cellAt, celebrate,
    get layout() { return layout; },
    /** true tant qu'une animation ou une particule est vivante : l'appelant redemande une image. */
    get animating() { return animating; },
    get particlesPeak() { return particles.peak; },
    get particlesAlive() { return particles.count; },
    /** Mouvement réduit (D9) : ni rotation animée, ni particules ; la porte s'ouvre d'un coup. */
    setReducedMotion(on) { reduced = on === true; if (reduced) particles.clear(); },
    get reducedMotion() { return reduced; },
  };
}
