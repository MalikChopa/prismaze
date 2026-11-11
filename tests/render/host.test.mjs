// Hôte de rendu (V1) : cycle de vie, détection, ?nogl, perte et restauration du contexte, délégation au Canvas 2D (faux navigateur, faux GL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost, AUTO_ACTIVATES_GL, MAX_LOSSES } from '../../src/render/host.js';
import { fakeEnv, fakeRenderer2d, fakeGl, fakeGlApi, fakeScene } from './helpers.mjs';

/** Hôte branché sur un faux navigateur. `gl` : options du faux GL ; `ctxNull` : getContext renvoie null. */
function setup(search, { gl: glOpts = {}, log = [] } = {}) {
  const env = fakeEnv(search);
  const gl = fakeGl(glOpts);
  const r2d = fakeRenderer2d(log);
  let contexts = 0;
  const host = createHost({
    doc: env.doc, win: env.win, params: env.params, createRenderer2d: () => r2d, now: () => 0,
    glApi: { createContext: (c, o) => { contexts++; return o.nogl ? null : gl; }, ...fakeGlApi(log) },
  });
  return { env, gl, r2d, host, log, contexts: () => contexts };
}
/** Lance la détection et fait tourner la file d'images/minuteries du faux navigateur jusqu'à la fin. */
async function boot(s) { const p = s.host.init(); await s.env.settle(); await p; await s.env.settle(); }
const inDom = (env) => env.screen.children.map((c) => c.id);

test('V3-2 : ?r=gl, vrai GPU simulé -> #game-gl créé par l\'hôte, juste derrière #game, aria-hidden, sans événements', async () => {
  const s = setup('?r=gl');
  s.host.attach(s.env.canvas);
  assert.deepEqual(inDom(s.env), ['game']); // rien avant la détection : le joueur joue en 2D (V3-11)
  await boot(s);
  assert.equal(s.host.backend, 'gl');
  assert.deepEqual(inDom(s.env), ['game-gl', 'game']);
  const g = s.env.screen.children[0];
  assert.equal(g.attrs['aria-hidden'], 'true');
  assert.match(g.style.cssText, /pointer-events:none/);
  assert.match(g.style.cssText, /position:fixed/);
});

test('?r=gl : huit programmes liés, le rendu passe par le renderer GL et non par le 2D', async () => {
  const log = [];
  const s = setup('?r=gl', { log });
  s.host.attach(s.env.canvas);
  await boot(s);
  assert.equal(s.host.diagnostics().programs, 8);
  assert.equal(s.host.diagnostics().linkOk, true);
  const { state, result } = fakeScene();
  s.host.render(state, result, { now: 1 });
  assert.equal(log.filter((l) => l[0] === 'frame').length, 1);
  assert.equal(log.filter((l) => l[0] === 'render').length, 0);
  assert.ok(s.host.view !== null);
  assert.equal(s.host.view.cols, 4);
});

test('?r=2d : le Canvas 2D fait le rendu : render/resize/cellAt/layout/animating délégués', async () => {
  const log = [];
  const s = setup('?r=2d', { log });
  s.host.attach(s.env.canvas);
  await boot(s);
  s.host.render('S', 'R', { now: 5 });
  assert.deepEqual(log.find((l) => l[0] === 'render'), ['render', 'S', 'R', { now: 5 }]);
  assert.deepEqual(s.host.cellAt(2, 3), { c: 2, r: 3 });
  assert.equal(s.host.layout.cell, 60);
  assert.equal(s.host.particlesPeak, 3);
  assert.equal(s.host.particlesAlive, 2);
  assert.equal(s.host.animating, false);
  s.host.setReducedMotion(true);
  assert.equal(s.host.reducedMotion, true);
  assert.deepEqual(log.filter((l) => l[0] === 'reduced').pop(), ['reduced', true]);
});

test('sans attache : les accesseurs sont sûrs (layout null, rien ne plante)', () => {
  const s = setup('');
  assert.equal(s.host.layout, null);
  assert.equal(s.host.cellAt(1, 1, {}), null);
  assert.equal(s.host.animating, false);
  s.host.resize();
  s.host.detach();
});

test('mouvement réduit demandé avant l\'attache : transmis au renderer 2D dès la création', () => {
  const log = [];
  const s = setup('', { log });
  s.host.setReducedMotion(true);
  s.host.attach(s.env.canvas);
  assert.deepEqual(log.filter((l) => l[0] === 'reduced'), [['reduced', true]]);
});

test('?nogl : getContext renvoie null -> c2d, raison no-context, aucun #game-gl, aucune erreur', async () => {
  const s = setup('?r=gl&nogl');
  s.host.attach(s.env.canvas);
  await boot(s);
  assert.equal(s.host.backend, 'c2d');
  assert.equal(s.host.info.reason, 'no-context');
  assert.deepEqual(inDom(s.env), ['game']);
  s.host.render({}, {}, {}); // le jeu continue
});

test('?nogl seul (auto) : c2d aussi', async () => {
  const s = setup('?nogl');
  await boot(s);
  assert.equal(s.host.backend, 'c2d');
  assert.equal(s.host.info.reason, 'no-context');
});

test('SwiftShader sans ?r -> c2d (raison software, décision c2d) ; avec ?r=gl -> gl', async () => {
  const a = setup('', { gl: { renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))' } });
  await boot(a);
  assert.equal(a.host.backend, 'c2d');
  assert.equal(a.host.info.reason, 'software');
  assert.equal(a.host.info.decision, 'c2d');
  const b = setup('?r=gl', { gl: { renderer: 'SwiftShader Device' } });
  b.host.attach(b.env.canvas);
  await boot(b);
  assert.equal(b.host.backend, 'gl');
});

test('vrai GPU sans ?r : décision « gl », GL affiché (AUTO_ACTIVATES_GL vrai depuis V4)', async () => {
  assert.equal(AUTO_ACTIVATES_GL, true);
  const s = setup('');
  s.host.attach(s.env.canvas);
  await boot(s);
  assert.equal(s.host.info.decision, 'gl');
  assert.equal(s.host.backend, 'gl');
  assert.equal(s.host.info.reason, 'auto');
});

test('?debug sans ?r et ?r=2d : le GL n\'est même pas sondé', async () => {
  const a = setup('?debug');
  await boot(a);
  assert.equal(a.contexts(), 0);
  assert.equal(a.host.info.reason, 'debug');
  const b = setup('?r=2d');
  await boot(b);
  assert.equal(b.contexts(), 0);
  assert.equal(b.host.info.reason, 'forced-2d');
  const c = setup('?debug&r=gl');
  c.host.attach(c.env.canvas);
  await boot(c);
  assert.equal(c.host.backend, 'gl');
});

test('capacités insuffisantes (une seule sortie de dessin) -> c2d même avec ?r=gl', async () => {
  const s = setup('?r=gl', { gl: { drawBuffers: 1 } });
  await boot(s);
  assert.equal(s.host.backend, 'c2d');
  assert.equal(s.host.info.reason, 'caps:draw-buffers');
});

test('compilation en échec -> c2d, journal conservé ; pas de programme prêt dans le délai -> c2d', async () => {
  const a = setup('?r=gl', { gl: { link: false, log: 'ERROR: 0:1: syntaxe' } });
  a.host.attach(a.env.canvas);
  await boot(a);
  assert.equal(a.host.backend, 'c2d');
  assert.equal(a.host.info.reason, 'compile-failed');
  assert.equal(a.host.diagnostics().linkOk, false);
  assert.match(a.host.diagnostics().logs[0], /syntaxe/);
  let t = 0;
  const env = fakeEnv('?r=gl'); const gl = fakeGl({ complete: false });
  const host = createHost({ doc: env.doc, win: env.win, params: env.params, createRenderer2d: () => fakeRenderer2d(), now: () => (t += 1000), glApi: { createContext: () => gl, ...fakeGlApi() } });
  host.attach(env.canvas);
  { const p = host.init(); await env.settle(80); await p; }
  assert.equal(host.backend, 'c2d');
  assert.equal(host.info.reason, 'compile-timeout');
});

test('?noparallel : l\'extension de compilation parallèle n\'est pas demandée', async () => {
  const s = setup('?r=gl&noparallel');
  const asked = [];
  const orig = s.gl.getExtension;
  s.gl.getExtension = (n) => { asked.push(n); return orig(n); };
  await boot(s);
  assert.ok(!asked.includes('KHR_parallel_shader_compile'));
});

test('V3-4 perte de contexte : preventDefault, bascule en c2d, #game-gl retiré, onChange annoncé, le 2D continue', async () => {
  const log = [];
  const s = setup('?r=gl', { log });
  s.host.attach(s.env.canvas);
  const events = [];
  s.host.onChange((e) => events.push(e));
  await boot(s);
  assert.equal(s.host.backend, 'gl');
  const g = s.env.screen.children[0];
  const ev = g.fire('webglcontextlost');
  assert.equal(ev.defaultPrevented, true);
  assert.equal(s.host.backend, 'c2d');
  assert.equal(s.host.info.reason, 'context-lost');
  assert.deepEqual(inDom(s.env), ['game']);
  s.host.render('S', 'R', {});
  assert.equal(log.filter((l) => l[0] === 'render').length, 1);
  assert.deepEqual(events.map((e) => `${e.type}:${e.backend}`), ['backend-change:gl', 'backend-change:c2d']);
});

test('V3-4 restauration : reconstruction complète puis retour au GL ; à la 3e perte on reste en 2D', async () => {
  const s = setup('?r=gl');
  s.host.attach(s.env.canvas);
  await boot(s);
  const g = () => s.env.screen.children.find((c) => c.id === 'game-gl');
  const gc = g();
  for (let i = 1; i <= MAX_LOSSES; i++) {
    gc.fire('webglcontextlost');
    assert.equal(s.host.backend, 'c2d');
    gc.fire('webglcontextrestored'); await s.env.settle();
    assert.equal(s.host.backend, 'gl', `retour au GL après la perte ${i}`);
    assert.deepEqual(inDom(s.env), ['game-gl', 'game']);
  }
  const before = s.gl.calls.filter((c) => c === 'link').length;
  assert.ok(before >= 1 + MAX_LOSSES, 'chaque restauration recompile');
  gc.fire('webglcontextlost');
  gc.fire('webglcontextrestored'); await s.env.settle();
  assert.equal(s.host.info.losses, MAX_LOSSES + 1);
  assert.equal(s.host.backend, 'c2d');
  assert.equal(s.host.info.reason, 'context-lost-final');
  assert.equal(s.gl.calls.filter((c) => c === 'link').length, before, 'aucune recompilation à la 3e perte');
});

test('perte pendant la compilation : la compilation en cours est abandonnée, aucun dessin', async () => {
  const s = setup('?r=gl', { gl: { complete: false } });
  s.host.attach(s.env.canvas);
  const p = s.host.init();
  await s.env.settle(2); // défère passé, compilation commencée mais jamais finie (complete: false)
  await p;
  const gc = s.env.screen.children.find((c) => c.id === 'game-gl');
  assert.equal(gc, undefined); // pas encore monté : la compilation n'est pas finie
  s.host.destroy();
  await s.env.settle();
  assert.ok(!s.gl.calls.includes('draw'));
});

test('detach retire #game-gl sans perdre le contexte ; attach le remet derrière le nouveau canvas', async () => {
  const s = setup('?r=gl');
  s.host.attach(s.env.canvas);
  await boot(s);
  s.host.detach();
  assert.deepEqual(inDom(s.env), ['game']);
  assert.equal(s.host.backend, 'gl');
  s.host.attach(s.env.canvas);
  assert.deepEqual(inDom(s.env), ['game-gl', 'game']);
  assert.equal(s.host.info.losses, 0);
});

test('init() est idempotente : un seul contexte créé', async () => {
  const s = setup('?r=gl');
  const a = s.host.init(), b = s.host.init();
  await s.env.settle(); await Promise.all([a, b]);
  assert.equal(a, b);
  assert.equal(s.contexts(), 1);
});

test('qualité : mémorisée seulement (0 Haut par défaut ; valeurs invalides ignorées)', () => {
  const s = setup('');
  assert.equal(s.host.quality, 0);
  s.host.setQuality(2); assert.equal(s.host.quality, 2);
  s.host.setQuality('zzz'); assert.equal(s.host.quality, 2);
  s.host.setQuality('auto'); assert.equal(s.host.quality, 0);
});

test('un écouteur onChange qui lève une exception n\'arrête pas l\'hôte ; se désabonne', async () => {
  const s = setup('?r=gl');
  s.host.attach(s.env.canvas);
  let n = 0;
  const off = s.host.onChange(() => { n++; throw new Error('x'); });
  await boot(s);
  assert.equal(n, 1);
  off();
  s.env.screen.children[0].fire('webglcontextlost');
  assert.equal(n, 1);
});

test('destroy : plus rien dans le DOM, contexte libéré', async () => {
  const s = setup('?r=gl');
  s.host.attach(s.env.canvas);
  await boot(s);
  s.host.destroy();
  assert.deepEqual(inDom(s.env), ['game']);
  assert.ok(s.gl.calls.includes('loseContext'));
});

test('V3-15 repos : 30 images/s après 20 s, figé après 60 s, une entrée réveille ; V3-13 : au plus une reconstruction par 100 ms', async () => {
  const log = [];
  const env = fakeEnv('?r=gl');
  const handlers = {};
  env.win.addEventListener = (t, fn) => { (handlers[t] ||= []).push(fn); };
  env.win.removeEventListener = () => {};
  let clock = 1000;
  const r2d = fakeRenderer2d(log);
  const gl = fakeGl();
  const host = createHost({ doc: env.doc, win: env.win, params: env.params, createRenderer2d: () => r2d, now: () => clock, glApi: { createContext: () => gl, ...fakeGlApi(log) } });
  host.attach(env.canvas);
  { const p = host.init(); await env.settle(); await p; await env.settle(); }
  assert.equal(host.backend, 'gl');
  const { state, result } = fakeScene();
  const frames = () => log.filter((l) => l[0] === 'frame').length;
  host.render(state, result, { now: clock });
  assert.equal(frames(), 1);
  assert.equal(host.animating, true); // tant qu'il n'est pas au repos, le jeu demande des images
  clock += 25000;
  const n25 = frames();
  host.render(state, result, { now: clock }); host.render(state, result, { now: clock + 16 }); host.render(state, result, { now: clock + 32 }); host.render(state, result, { now: clock + 48 });
  const drawnAt25 = frames() - n25;
  assert.ok(drawnAt25 >= 1 && drawnAt25 <= 2, `30 i/s : une image sur deux (${drawnAt25} sur 4)`);
  clock += 40000;
  const n65 = frames();
  host.render(state, result, { now: clock });
  assert.equal(frames() - n65, 0, 'figé après 60 s sans entrée');
  assert.equal(host.animating, false, 'figé : plus de boucle');
  let woken = 0;
  host.onWake(() => { woken++; });
  handlers.keydown[0]({ type: 'keydown' });
  assert.equal(woken, 1, 'onWake appelé en sortie de repos figé');
  clock += 1000;
  const nw = frames();
  host.render(state, result, { now: clock });
  assert.equal(frames() - nw, 1, 'après l\'entrée, le rendu reprend');
});

test('host.view et cellAt : vue GL en pixels CSS, avec zoom et décalage de caméra (V3-19)', async () => {
  const log = [];
  const s = setup('?r=gl', { log });
  s.host.attach(s.env.canvas);
  await boot(s);
  const { state, result } = fakeScene(10, 8);
  s.host.render(state, result, { now: 1, layout: { cell: 60, x0: 100, y0: 50, boardW: 600, boardH: 480, w: 1280, h: 720 }, camera: { zoom: 1, dx: 10, dy: -4, floorDx: 5, floorDy: -2 } });
  const v = s.host.view;
  assert.equal(v.k, 60);
  assert.deepEqual(s.host.cellAt(100 + 10 + 60 * 3.5, 50 - 4 + 60 * 2.5, state), { c: 3, r: 2 });
  assert.equal(s.host.cellAt(50, 50, state), null);
  assert.equal(s.host.layout.cell, 60, 'mise en page utilisée, fournie par info.layout');
});

test('qualité : ?q=bas forcée, setQuality(auto) repasse au gouverneur', async () => {
  const log = [];
  const s = setup('?r=gl&q=bas', { log });
  s.host.attach(s.env.canvas);
  await boot(s);
  const { state, result } = fakeScene();
  s.host.render(state, result, { now: 1 });
  assert.equal(s.host.quality, 2);
  assert.equal(log.filter((l) => l[0] === 'frame').pop()[3], 2);
  s.host.setQuality(0);
  s.host.render(state, result, { now: 20 });
  assert.equal(s.host.quality, 0);
  s.host.setQuality('auto');
  assert.ok(s.host.quality === 0, 'auto : le gouverneur (départ Haut ici) décide');
});
