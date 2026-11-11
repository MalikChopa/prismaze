// Cibles de rendu : formats, tailles de la pyramide, nombre d'objets, suppression à la reconstruction (V3-12, V3-14), hors navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTargets } from '../../src/render/gl/targets.js';
import { QUALITY } from '../../src/render/scene/quality.js';

function fakeGl() {
  let tex = 0, fbo = 0;
  const live = { tex: new Set(), fbo: new Set() };
  const gl = {
    RGBA16F: 'RGBA16F', RGBA8: 'RGBA8', TEXTURE_2D: 1, TEXTURE_MIN_FILTER: 2, TEXTURE_MAG_FILTER: 3, TEXTURE_WRAP_S: 4, TEXTURE_WRAP_T: 5, LINEAR: 6, LINEAR_MIPMAP_LINEAR: 7, CLAMP_TO_EDGE: 8, FRAMEBUFFER: 9, COLOR_ATTACHMENT0: 10,
    sizes: [], fmt: [],
    createTexture() { const t = { id: ++tex }; live.tex.add(t); return t; }, deleteTexture(t) { live.tex.delete(t); },
    bindTexture() {}, texStorage2D(t, l, f, w, h) { gl.fmt.push(f); gl.sizes.push([w, h, l]); }, texParameteri() {},
    createFramebuffer() { const f = { id: ++fbo }; live.fbo.add(f); return f; }, deleteFramebuffer(f) { live.fbo.delete(f); }, bindFramebuffer() {}, framebufferTexture2D() {}, drawBuffers() {},
  };
  return { gl, live };
}

test('Haut en 1080p : scène + faisceaux (mipmaps) + 6 niveaux de bloom à demi résolution', () => {
  const { gl } = fakeGl();
  const T = createTargets(gl, { w: 1920, h: 1080, quality: 0, hdr: true });
  assert.equal(T.lv.length, 6);
  assert.deepEqual([T.lv[0].w, T.lv[0].h], [960, 540]);
  assert.deepEqual([T.lv[5].w, T.lv[5].h], [30, 17]);
  assert.ok(gl.fmt.every((f) => f === 'RGBA16F'));
  assert.equal(T.objects, 8 + 8);
});

test('8 bits (?hdr=0) : RGBA8', () => {
  const { gl } = fakeGl();
  createTargets(gl, { w: 1280, h: 720, quality: 2, hdr: false });
  assert.ok(gl.fmt.every((f) => f === 'RGBA8'));
});

test('V3-14 : 50 cycles de reconstruction, nombre d\'objets vivants constant, aucune fuite', () => {
  const { gl, live } = fakeGl();
  let T = createTargets(gl, { w: 1280, h: 720, quality: 0, hdr: true });
  const n0 = live.tex.size + live.fbo.size;
  for (let i = 0; i < 50; i++) { T.dispose(); T = createTargets(gl, { w: 1280 + (i % 3), h: 720, quality: i % 3, hdr: true }); }
  T.dispose();
  assert.equal(live.tex.size + live.fbo.size, 0);
  assert.ok(n0 > 0);
});

test('table des qualités cohérente avec le pipeline', () => {
  assert.deepEqual(QUALITY.map((q) => q.bloomLevels), [6, 5, 4]);
  assert.deepEqual(QUALITY.map((q) => q.reflection), [true, true, false]);
});
