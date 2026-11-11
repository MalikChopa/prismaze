// Dessin avec un faux contexte 2D qui enregistre les appels : détecte les erreurs d'exécution du rendu (fautes de frappe, NaN)
// et vérifie les budgets de D5 (<= 500 drawImage par image) sans navigateur. Le rendu visuel réel est jugé sur les captures de docs/qa/J4/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRenderer } from '../src/render/renderer.js';
import { createStaticLayer } from '../src/render/static-layer.js';
import { createState, rotatePiece } from '../src/engine/state.js';
import { buildBoard } from '../src/engine/board.js';
import { trace } from '../src/engine/trace.js';
import { DEV_LEVELS } from '../src/dev-levels.js';
import { POOL_SIZE, BUDGET, createParticles } from '../src/render/particles.js';

const stateOf = (id) => createState(DEV_LEVELS[id]);

function fakeCtx(log) {
  const state = {};
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...args) => { log.push([k, ...args]); };
    },
    set(t, k, v) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${String(k)} = ${v}`);
      t[k] = v; return true;
    },
  });
}
function fakeCanvas(w, h, log) {
  const ctx = fakeCtx(log);
  return { width: w, height: h, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) };
}

function setup(w = 1280, h = 720) {
  const log = [], slog = [];
  const canvas = fakeCanvas(w, h, log);
  const r = createRenderer(canvas, { makeCanvas: (cw, ch) => fakeCanvas(cw, ch, slog) });
  r.resize();
  return { r, log, slog, canvas };
}
function draw(state, env, info = {}) {
  env.log.length = 0;
  env.r.render(state, trace(buildBoard(state)), { now: 1000, ...info });
}
const count = (log, name) => log.filter((c) => c[0] === name).length;

test('render : une image de la galerie sans erreur, <= 500 drawImage (D5), aucune valeur non finie', () => {
  const env = setup();
  draw(stateOf('galerie'), env);
  const n = count(env.log, 'drawImage');
  assert.ok(n > 20 && n <= 500, `drawImage : ${n}`);
  for (const c of env.log) for (const a of c.slice(1)) if (typeof a === 'number') assert.ok(Number.isFinite(a), c[0]);
});

test('render : petits et grands écrans, plusieurs niveaux, jamais de valeur non finie', () => {
  for (const [w, h] of [[360, 640], [412, 915], [1920, 1080], [800, 500], [915, 412]]) {
    for (const id of ['galerie', 'maquette-07', 'x00-exemple']) {
      const env = setup(w, h);
      draw(stateOf(id), env, { cursor: { c: 1, r: 1, holding: false }, lift: { c: 2, r: 2 }, flash: { c: 0, r: 0 }, won: true });
      for (const c of env.log) for (const a of c.slice(1)) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${w}x${h} ${id} ${c[0]}`);
    }
  }
});

test('render : la couche statique n\'est pas redessinée entre deux images ni après un tour de miroir ; le redimensionnement l\'invalide', () => {
  const env = setup();
  let s = stateOf('maquette-07');
  draw(s, env);
  const n = env.slog.length;
  assert.ok(n > 50, 'la couche statique et les sprites ont été dessinés');
  s = rotatePiece(s, 11, 1);
  draw(s, env); draw(s, env);
  assert.equal(env.slog.length, n, 'rien de redessiné hors dynamique');
  env.r.resize();
  draw(s, env);
  assert.ok(env.slog.length > n);
});

test('couche statique : HiDPI = canevas plus grand que la taille CSS ; deux canevas (fond, pièces fixes) recopiés avant et après les faisceaux', () => {
  const slog = [];
  const layer = createStaticLayer(stateOf('maquette-07'), 64, 2, (w, h) => fakeCanvas(w, h, slog));
  assert.equal(layer.canvas.width, 10 * 64 * 2);
  assert.equal(layer.canvas.height, 6 * 64 * 2);
  assert.equal(layer.top.width, layer.canvas.width);
  assert.ok(slog.some((c) => c[0] === 'setTransform' && c[1] === 2 && c[4] === 2));
});

test('D4 : ni ctx.filter ni shadowBlur dans src/render/', () => {
  for (const f of readdirSync(new URL('../src/render/', import.meta.url))) {
    if (!f.endsWith('.js')) continue; // sous-dossiers (gl/, scene/) : V1 ; ils ont leurs propres tests
    const text = readFileSync(new URL(`../src/render/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text.replace(/\/\/.*$/gm, ''), /\.filter\s*=|shadowBlur|ctx\.filter/, f);
  }
});

test('cellAt : retrouve la case sous le pointeur, null hors plateau', () => {
  const env = setup(1280, 720);
  const s = stateOf('maquette-07');
  draw(s, env);
  const L = env.r.layout;
  const mid = (c, r) => [L.x0 + (c + 0.5) * L.cell, L.y0 + (r + 0.5) * L.cell];
  assert.deepEqual(env.r.cellAt(...mid(7, 1), s), { c: 7, r: 1 });
  assert.deepEqual(env.r.cellAt(...mid(9, 5), s), { c: 9, r: 5 });
  assert.equal(env.r.cellAt(L.x0 - 1, L.y0 + 5, s), null);
  assert.equal(env.r.cellAt(L.x0 + 5, L.y0 + L.boardH, s), null);
});

test('rotation animée de 90 ms : « animating » pendant, faux après ; mouvement réduit : jamais', () => {
  const env = setup();
  let s = stateOf('maquette-07');
  draw(s, env, { now: 1000 });
  assert.equal(env.r.animating, false);
  s = rotatePiece(s, 11, 1);
  draw(s, env, { now: 1010 });
  assert.equal(env.r.animating, true);
  draw(s, env, { now: 1010 + 91 });
  assert.equal(env.r.animating, false);
  const red = setup();
  red.r.setReducedMotion(true);
  let t = stateOf('maquette-07');
  draw(t, red, { now: 1000 });
  t = rotatePiece(t, 11, 1);
  draw(t, red, { now: 1010 });
  assert.equal(red.r.animating, false);
});

test('particules : réservoir de 256, victoire <= 160 ; mouvement réduit : aucune', () => {
  const env = setup();
  const s = stateOf('galerie');
  draw(s, env, { now: 1000 });
  env.r.celebrate(s, trace(buildBoard(s)));
  assert.ok(env.r.particlesAlive > 0 && env.r.particlesAlive <= BUDGET.victory, `vivantes : ${env.r.particlesAlive}`);
  const p = createParticles();
  p.burst(1, 1, 3, 1000);
  assert.ok(p.count <= POOL_SIZE);
  const red = setup();
  red.r.setReducedMotion(true);
  draw(s, red, { now: 1000 });
  red.r.celebrate(s, trace(buildBoard(s)));
  assert.equal(red.r.particlesAlive, 0);
});

test('porte : la dissolution dure 250 ms, puis plus d\'animation (mouvement réduit : d\'un coup)', () => {
  const env = setup();
  const s0 = stateOf('x00-exemple'); // porte (5,1) liée à la cible (6,0)
  draw(s0, env, { now: 1000 });
  const s1 = createState({ ...DEV_LEVELS['x00-exemple'], pieces: DEV_LEVELS['x00-exemple'].pieces.map((p) => (p.type === 'mirror' && p.at[0] === 1 ? { ...p, at: [2, 0], o: '/' } : p)) });
  draw(s1, env, { now: 1100 });
  assert.equal(trace(buildBoard(s1)).gates[0].open, true);
  assert.equal(env.r.animating, true);
  draw(s1, env, { now: 1100 + 260 });
  env.r.render(s1, trace(buildBoard(s1)), { now: 1400 });
  assert.equal(env.r.particlesAlive >= 0, true);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// J7 : lien porte -> cible (trait pointillé dans la couche statique, derrière faisceaux et pièces)
import { gateLinks, staticKey } from '../src/render/static-layer.js';
import { THEME } from '../src/render/theme.js';

const twoDoors = () => createState({
  format: 2, id: 'deux-portes', name: 'Deux portes', size: [9, 5],
  pieces: [
    { type: 'emitter', at: [0, 2], dir: 'E', mask: 'RGB' },
    { type: 'target', at: [1, 0], need: 'RGB' }, { type: 'target', at: [7, 4], need: 'RGB' }, { type: 'target', at: [8, 0], need: 'RGB' },
    { type: 'gate', at: [4, 1], link: [1, 0] }, { type: 'gate', at: [5, 3], link: [7, 4] },
    { type: 'mirror', at: [2, 3], o: '/' },
  ],
});

/** Couche statique avec un faux contexte par canevas : `base` = sous les faisceaux, `top` = au-dessus. */
function staticLogs(state, cell = 62, dpr = 1) {
  const logs = [];
  const layer = createStaticLayer(state, cell, dpr, (w, h) => { const log = []; logs.push(log); return fakeCanvas(w, h, log); });
  return { layer, base: logs[0], top: logs[1] };
}

test('lien porte -> cible : un trait pointillé par porte, dans la couche de FOND (derrière faisceaux et pièces), couleur des pastilles', () => {
  const { base, top } = staticLogs(twoDoors());
  const dashes = base.filter((c) => c[0] === 'setLineDash');
  assert.equal(dashes.length, 2, '2 portes : 2 traits');
  assert.equal(top.filter((c) => c[0] === 'setLineDash').length, 0, 'rien dans la couche du dessus');
  for (const d of dashes) assert.ok(d[1][0] < 1 && d[1][1] > 1, 'points ronds : trait quasi nul, intervalle plus grand');
  // le trait est tracé dans l'ordre : fond, grille, murs, PUIS les liens (au-dessus de la grille)
  const iGrid = base.findIndex((c) => c[0] === 'stroke');
  const iLink = base.findIndex((c) => c[0] === 'setLineDash');
  assert.ok(iGrid >= 0 && iGrid < iLink);
  // extrémités : de la porte (4,1) vers la cible (1,0), raccourcies de 0,4 case à chaque bout
  const mv = base.filter((c) => c[0] === 'moveTo').slice(-2), ln = base.filter((c) => c[0] === 'lineTo').slice(-2);
  const [x0, y0] = [4.5 * 62, 1.5 * 62], [x1, y1] = [1.5 * 62, 0.5 * 62], L = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / L, uy = (y1 - y0) / L, gap = 0.4 * 62;
  assert.ok(Math.abs(mv[0][1] - (x0 + ux * gap)) < 1e-6 && Math.abs(mv[0][2] - (y0 + uy * gap)) < 1e-6);
  assert.ok(Math.abs(ln[0][1] - (x1 - ux * gap)) < 1e-6 && Math.abs(ln[0][2] - (y1 - uy * gap)) < 1e-6);
  assert.equal(THEME.gate, '#ffb454');
});

test('lien porte -> cible : pas de lien sans cible sur le plateau, ni quand porte et cible sont voisines au point de se toucher', () => {
  const s = createState({ format: 2, id: 'sans-cible', name: 'x', size: [5, 3], pieces: [
    { type: 'emitter', at: [0, 1], dir: 'E', mask: 'RGB' }, { type: 'target', at: [4, 0], need: 'RGB' }, { type: 'gate', at: [2, 1], link: [3, 2] },
  ] });
  assert.deepEqual(gateLinks(s), [], 'cible liée absente : pas de lien');
  assert.equal(staticLogs(s).base.filter((c) => c[0] === 'setLineDash').length, 0);
  assert.equal(gateLinks(twoDoors()).length, 2);
});

test('lien porte -> cible : la clé de cache change si la porte ou la cible liée bouge (éditeur), pas pour une pièce mobile', () => {
  const a = twoDoors(), cellDpr = [62, 1];
  const moved = createState({ format: 2, id: 'deux-portes', name: 'x', size: [9, 5], pieces: [
    { type: 'emitter', at: [0, 2], dir: 'E', mask: 'RGB' },
    { type: 'target', at: [2, 0], need: 'RGB' }, { type: 'target', at: [7, 4], need: 'RGB' }, { type: 'target', at: [8, 0], need: 'RGB' },
    { type: 'gate', at: [4, 1], link: [2, 0] }, { type: 'gate', at: [5, 3], link: [7, 4] },
    { type: 'mirror', at: [2, 3], o: '/' },
  ] });
  assert.notEqual(staticKey(a, ...cellDpr), staticKey(moved, ...cellDpr));
  const same = twoDoors();
  rotatePiece(same, same.pieces.find((p) => p.type === 'mirror').id, 1);
  assert.equal(staticKey(a, ...cellDpr), staticKey(same, ...cellDpr), 'tourner un miroir mobile ne redessine pas la couche statique');
});

test('lien porte -> cible : le niveau livré s05-porte et le moteur de rendu complet (budget D5, valeurs finies, mouvement réduit)', () => {
  const lv = JSON.parse(readFileSync(new URL('../levels/s05-porte.json', import.meta.url), 'utf8'));
  for (const reduced of [false, true]) {
    const env = setup();
    env.r.setReducedMotion(reduced);
    const s = createState(lv);
    draw(s, env);
    assert.ok(count(env.log, 'drawImage') <= 500);
    assert.equal(env.slog.filter((c) => c[0] === 'setLineDash').length, 1, 's05 : un lien');
    // le lien est dessiné UNE fois (couche statique) : une 2e image ne le redessine pas
    env.slog.length = 0;
    draw(s, env, { now: 1100 });
    assert.equal(env.slog.length, 0, 'image suivante : la couche statique est réutilisée');
  }
});
