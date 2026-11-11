// Détection V3-3 : règle de décision, contrôle des capacités par l'essai, création du contexte (faux contextes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSoftwareRenderer, createGlContext, probeCapabilities, rendererString, glBufferSize, CONTEXT_OPTIONS } from '../../src/render/gl/context.js';
import { decideBackend, requestedRenderer } from '../../src/render/host.js';
import { fakeGl } from './helpers.mjs';

const OK = { ok: true, hdr: true, reason: '' };
const base = { requested: 'auto', debug: false, contextOk: true, renderer: 'ANGLE (AMD Radeon RX 7900 XT)', caps: OK };

test('pilotes logiciels reconnus (insensible à la casse) ; vrai GPU et chaîne vide non', () => {
  for (const s of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))', 'llvmpipe (LLVM 15)', 'Mesa Software Rasterizer', 'Microsoft Basic Render Driver', 'SWIFTSHADER']) assert.ok(isSoftwareRenderer(s), s);
  for (const s of ['ANGLE (AMD, AMD Radeon RX 7900 XT Direct3D11)', 'Apple GPU', '', undefined, null]) assert.ok(!isSoftwareRenderer(s), String(s));
});

test('décision : auto sur vrai GPU -> gl ; auto sur SwiftShader -> c2d ; chaîne masquée -> gl (filet = gouverneur)', () => {
  assert.deepEqual(decideBackend(base), { backend: 'gl', reason: 'auto' });
  assert.deepEqual(decideBackend({ ...base, renderer: 'SwiftShader Device' }), { backend: 'c2d', reason: 'software' });
  assert.deepEqual(decideBackend({ ...base, renderer: '' }), { backend: 'gl', reason: 'auto' });
});

test('décision : ?r=gl force le GL même en logiciel, ?r=2d force le 2D, ?debug = 2d sauf ?r=gl', () => {
  assert.equal(decideBackend({ ...base, requested: 'gl', renderer: 'SwiftShader' }).backend, 'gl');
  assert.equal(decideBackend({ ...base, requested: 'gl', renderer: 'SwiftShader' }).reason, 'forced-gl-software');
  assert.equal(decideBackend({ ...base, requested: '2d' }).backend, 'c2d');
  assert.equal(decideBackend({ ...base, debug: true }).reason, 'debug');
  assert.equal(decideBackend({ ...base, debug: true, requested: 'gl' }).backend, 'gl');
});

test('décision : pas de contexte (?nogl) ou capacités insuffisantes -> c2d, même avec ?r=gl', () => {
  assert.equal(decideBackend({ ...base, contextOk: false, caps: null }).reason, 'no-context');
  assert.equal(decideBackend({ ...base, requested: 'gl', contextOk: false, caps: null }).backend, 'c2d');
  assert.equal(decideBackend({ ...base, caps: { ok: false, reason: 'draw-buffers' } }).reason, 'caps:draw-buffers');
  assert.equal(decideBackend({ ...base, requested: 'gl', caps: { ok: false, reason: 'texture-size' } }).backend, 'c2d');
});

test('requestedRenderer : gl, 2d, sinon auto', () => {
  assert.equal(requestedRenderer(new URLSearchParams('r=gl')), 'gl');
  assert.equal(requestedRenderer(new URLSearchParams('r=2d')), '2d');
  assert.equal(requestedRenderer(new URLSearchParams('r=auto')), 'auto');
  assert.equal(requestedRenderer(new URLSearchParams('r=zzz')), 'auto');
  assert.equal(requestedRenderer(new URLSearchParams('')), 'auto');
});

test('createGlContext : ?nogl -> null sans appeler getContext ; options V3-3 ; exception -> null', () => {
  let n = 0;
  assert.equal(createGlContext({ getContext: () => { n++; return {}; } }, { nogl: true }), null);
  assert.equal(n, 0);
  let seen = null;
  const gl = {};
  assert.equal(createGlContext({ getContext: (t, o) => { seen = [t, o]; return gl; } }), gl);
  assert.equal(seen[0], 'webgl2');
  assert.deepEqual(seen[1], { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'default', failIfMajorPerformanceCaveat: true });
  assert.equal(CONTEXT_OPTIONS.powerPreference, 'default');
  assert.equal(createGlContext({ getContext: () => { throw new Error('x'); } }), null);
});

test('createGlContext : sans ?r=gl un refus reste un refus ; avec ?r=gl on réessaie sans la demande de performance', () => {
  const tries = [];
  const c = { getContext: (t, o) => { tries.push(o.failIfMajorPerformanceCaveat); return o.failIfMajorPerformanceCaveat ? null : {}; } };
  assert.equal(createGlContext(c), null);
  assert.deepEqual(tries, [true]);
  tries.length = 0;
  assert.notEqual(createGlContext(c, { forced: true }), null);
  assert.deepEqual(tries, [true, false]);
});

test('rendererString : lit UNMASKED_RENDERER ; extension absente ou exception -> chaîne vide', () => {
  assert.equal(rendererString(fakeGl({ renderer: 'SwiftShader Device' })), 'SwiftShader Device');
  assert.equal(rendererString(fakeGl({ noRendererExt: true })), '');
  assert.equal(rendererString({ getExtension() { throw new Error('x'); } }), '');
});

test('probeCapabilities : HDR, repli 8 bits, aucune cible, sorties de dessin, taille de texture', () => {
  assert.deepEqual(probeCapabilities(fakeGl(), { w: 1920, h: 1080 }), { ok: true, hdr: true, reason: '', maxTexture: 16384, drawBuffers: 8 });
  const ldr = probeCapabilities(fakeGl({ hdr: false }), { w: 100, h: 100 });
  assert.ok(ldr.ok && !ldr.hdr);
  assert.equal(probeCapabilities(fakeGl({ hdr: false, ldr: false }), {}).reason, 'no-render-target');
  assert.equal(probeCapabilities(fakeGl({ drawBuffers: 1 }), {}).reason, 'draw-buffers');
  assert.equal(probeCapabilities(fakeGl({ maxTexture: 1024 }), { w: 1920, h: 1080 }).reason, 'texture-size');
  assert.equal(probeCapabilities({ getParameter() { throw new Error('x'); } }, {}).reason, 'probe-error');
});

test('glBufferSize : DPR plafonné à 2, au plus 3,7 Mpx de cible', () => {
  assert.deepEqual(glBufferSize(1280, 720, 1), { w: 1280, h: 720, scale: 1 });
  assert.equal(glBufferSize(1280, 720, 3).scale, 2);
  const big = glBufferSize(2560, 1440, 2); // 14,7 Mpx demandés
  assert.ok(big.w * big.h <= 3.7e6 * 1.001, `${big.w}x${big.h}`);
  assert.equal(glBufferSize(412, 915, 2).scale, 2);
});
