// Cibles de rendu (textures et FBO) : scène, couche des faisceaux à mipmaps, pyramide de bloom (§2, V3-12, V3-14). Recréées à chaque redimensionnement
// ou changement de qualité ; les anciennes sont supprimées d'abord. L'appelant compte les objets vivants (`count`).
import { QUALITY } from '../scene/quality.js';

/** @param {boolean} hdr  RGBA16F si vrai, sinon RGBA8 (`?hdr=0`). */
export function textureFormat(gl, hdr) {
  return hdr ? gl.RGBA16F : gl.RGBA8;
}

function mkTex(gl, fmt, w, h, mips) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const levels = mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, fmt, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function mkFbo(gl, texs) {
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  const db = [];
  texs.forEach((t, i) => { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0); db.push(gl.COLOR_ATTACHMENT0 + i); });
  gl.drawBuffers(db);
  return f;
}

/**
 * @returns {{w:number,h:number,scene:WebGLTexture,beam:WebGLTexture,fScene:WebGLFramebuffer,fBeam:WebGLFramebuffer,lv:Array<{t,f,w,h}>,objects:number,fresh:boolean,dispose:()=>void}}
 *   `fresh` reste vrai tant qu'aucune image n'a écrit la couche des faisceaux (le sol ne doit pas la relire).
 */
export function createTargets(gl, { w, h, quality, hdr }) {
  const q = QUALITY[quality], fmt = textureFormat(gl, hdr);
  const tex = [], fbo = [];
  const scene = mkTex(gl, fmt, w, h, false), beam = mkTex(gl, fmt, w, h, true);
  tex.push(scene, beam);
  const fScene = mkFbo(gl, [scene]), fBeam = mkFbo(gl, [scene, beam]);
  fbo.push(fScene, fBeam);
  const lv = [];
  let bw = Math.max(1, Math.ceil(w * q.bloomScale)), bh = Math.max(1, Math.ceil(h * q.bloomScale));
  for (let i = 0; i < q.bloomLevels; i++) {
    const t = mkTex(gl, fmt, bw, bh, false), f = mkFbo(gl, [t]);
    tex.push(t); fbo.push(f); lv.push({ t, f, w: bw, h: bh });
    bw = Math.max(1, Math.ceil(bw / 2)); bh = Math.max(1, Math.ceil(bh / 2));
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  let alive = true;
  return {
    w, h, scene, beam, fScene, fBeam, lv, fresh: true,
    objects: tex.length + fbo.length,
    dispose() { if (!alive) return; alive = false; for (const t of tex) gl.deleteTexture(t); for (const f of fbo) gl.deleteFramebuffer(f); },
  };
}
