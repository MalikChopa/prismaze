// Moteur de dessin WebGL2 (§2, V3-10..V3-14) : sol, pièces instanciées, faisceaux additifs (MRT scène + couche des faisceaux), bloom, composition.
// Pas d'allocation par image une fois les tampons à la bonne taille. Les noms d'uniformes passés à `su` sont vérifiés contre les shaders par un test Node (lint).
import { QUALITY } from '../scene/quality.js';
import { createTargets } from './targets.js';
import { FLOATS, LIN } from './piece-data.js';

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
const LIGHT = [-0.5526, -0.8334];
const BLOOM_GAIN = [0.30, 0.32, 0.34];
const BEAM_FLOATS = 12;

/** Intensité d'un faisceau selon son masque (mélanges légèrement atténués, blanc plus encore : valeurs de la maquette). */
export function beamIntensity(mask) {
  return mask === 7 ? 0.78 : mask === 3 || mask === 5 || mask === 6 ? 0.92 : 1;
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {Object<string,WebGLProgram>} programs  les 8 programmes liés
 * @param {{hdr:boolean, onError?:(msg:string)=>void}} opts
 */
export function createGlRenderer(gl, programs, opts) {
  const hdr = opts.hdr === true;
  const P = {};
  for (const name of Object.keys(programs)) P[name] = { p: programs[name], loc: {} };
  let targets = null, reduced = false, frameIndex = 0;
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
  const buffers = { under: createInst(160 * FLOATS), over: createInst(32 * FLOATS), top: createInst(120 * FLOATS), fan: createInst(16 * FLOATS) };
  const beamBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, beamBuf);
  let beamCap = 256;
  gl.bufferData(gl.ARRAY_BUFFER, beamCap * BEAM_FLOATS * 4, gl.DYNAMIC_DRAW);
  let beamData = new Float32Array(beamCap * BEAM_FLOATS);
  let beamPrev = new Float32Array(beamCap * BEAM_FLOATS), prevCount = 0;
  const partBuf = gl.createBuffer(), vaoPart = gl.createVertexArray();
  let partBytes = 0;
  const vaoTri = gl.createVertexArray();
  const vaoBeam = gl.createVertexArray();
  gl.bindVertexArray(vaoBeam);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, beamBuf);
  [[1, 0], [2, 16], [3, 32]].forEach(([loc, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, BEAM_FLOATS * 4, off); gl.vertexAttribDivisor(loc, 1); });
  gl.bindVertexArray(vaoPart);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
  [[1, 0], [2, 16]].forEach(([loc, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 32, off); gl.vertexAttribDivisor(loc, 1); });
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  function createInst(bytesFloats) {
    const buf = gl.createBuffer(), vao = gl.createVertexArray();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, bytesFloats * 4, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (let i = 0; i < 6; i++) { gl.enableVertexAttribArray(1 + i); gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, FLOATS * 4, i * 16); gl.vertexAttribDivisor(1 + i, 1); }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return { buf, vao, bytes: bytesFloats * 4 };
  }

  function upload(b, list) {
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
    const bytes = list.count * FLOATS * 4;
    if (bytes > b.bytes) { b.bytes = Math.max(bytes, b.bytes * 2); gl.bufferData(gl.ARRAY_BUFFER, b.bytes, gl.DYNAMIC_DRAW); }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, list.data, 0, list.count * FLOATS);
  }

  function ensureBeamCap(n) {
    if (n <= beamCap) return;
    while (beamCap < n) beamCap *= 2;
    beamData = new Float32Array(beamCap * BEAM_FLOATS); beamPrev = new Float32Array(beamCap * BEAM_FLOATS); prevCount = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, beamBuf);
    gl.bufferData(gl.ARRAY_BUFFER, beamCap * BEAM_FLOATS * 4, gl.DYNAMIC_DRAW);
  }

  function su(prog, name, a, b, c, d) {
    let l = prog.loc[name];
    if (l === undefined) l = prog.loc[name] = gl.getUniformLocation(prog.p, name);
    if (l === null) return;
    const n = arguments.length;
    if (n === 3) gl.uniform1f(l, a); else if (n === 4) gl.uniform2f(l, a, b); else if (n === 5) gl.uniform3f(l, a, b, c); else gl.uniform4f(l, a, b, c, d);
  }
  function setWorld(prog, F) { if (F.rot === 1) su(prog, 'uM', 0, -F.k, F.k, 0); else su(prog, 'uM', F.k, 0, 0, F.k); su(prog, 'uT', F.tx, F.ty); su(prog, 'uRes', F.w, F.h); } // V7 : plateau tourné, (x, y) → (tx − k·y, ty + k·x)

  function ensureTargets(w, h, quality) {
    if (targets && targets.w === w && targets.h === h && targets.quality === quality) return false;
    if (targets) targets.dispose();
    targets = createTargets(gl, { w, h, quality, hdr });
    targets.quality = quality;
    frameIndex = 0;
    return true;
  }

  /** Remplit l'instance des faisceaux : `post` (tronçons après coupures et voies), + la trace précédente en fondu (0,17 s). `fade` = 0 → seul le précédent, 1 → seul le nouveau. */
  function writeBeams(post, fade) {
    const o = post.out;
    ensureBeamCap(o.count + prevCount + 4);
    let n = 0;
    const onLane = (x0, y0, x1, y1, axis) => { // décalé de l'axe de la case ou biseau : une voie (V3-8)
      if (axis === 0) return Math.abs(y0 - Math.floor(y0) - 0.5) > 1e-3 || Math.abs(y1 - Math.floor(y1) - 0.5) > 1e-3 ? 1 : 0;
      return Math.abs(x0 - Math.floor(x0) - 0.5) > 1e-3 || Math.abs(x1 - Math.floor(x1) - 0.5) > 1e-3 ? 1 : 0;
    };
    const put = (x0, y0, x1, y1, m, i, fa, fb, g, lane) => {
      const c = LIN[m], off = n * BEAM_FLOATS;
      beamData[off] = x0; beamData[off + 1] = y0; beamData[off + 2] = x1; beamData[off + 3] = y1; beamData[off + 4] = c[0]; beamData[off + 5] = c[1]; beamData[off + 6] = c[2];
      beamData[off + 7] = i * beamIntensity(m); beamData[off + 8] = fa; beamData[off + 9] = fb; beamData[off + 10] = g; beamData[off + 11] = lane + (m === 7 ? 2 : 0);
      n++;
    };
    if (fade < 1 && prevCount > 0) {
      for (let i = 0; i < prevCount; i++) {
        const off = i * BEAM_FLOATS;
        beamData[n * BEAM_FLOATS] = beamPrev[off]; beamData[n * BEAM_FLOATS + 1] = beamPrev[off + 1]; beamData[n * BEAM_FLOATS + 2] = beamPrev[off + 2]; beamData[n * BEAM_FLOATS + 3] = beamPrev[off + 3];
        beamData[n * BEAM_FLOATS + 4] = beamPrev[off + 4]; beamData[n * BEAM_FLOATS + 5] = beamPrev[off + 5]; beamData[n * BEAM_FLOATS + 6] = beamPrev[off + 6];
        beamData[n * BEAM_FLOATS + 7] = beamPrev[off + 7] * (1 - fade); beamData[n * BEAM_FLOATS + 8] = beamPrev[off + 8]; beamData[n * BEAM_FLOATS + 9] = beamPrev[off + 9]; beamData[n * BEAM_FLOATS + 10] = beamPrev[off + 10]; beamData[n * BEAM_FLOATS + 11] = beamPrev[off + 11];
        n++;
      }
    }
    for (let i = 0; i < o.count; i++) put(o.x0[i], o.y0[i], o.x1[i], o.y1[i], o.mask[i], fade < 1 ? fade : 1, o.fa[i], o.fb[i], o.glow[i], onLane(o.x0[i], o.y0[i], o.x1[i], o.y1[i], o.axis[i]));
    return n;
  }

  /** Copie les faisceaux courants comme « trace précédente » (appelé quand l'état change). */
  function snapshotPrev(post) {
    const o = post.out, N = o.count;
    if (N * BEAM_FLOATS > beamPrev.length) { ensureBeamCap(N + prevCount + 4); }
    for (let i = 0; i < N; i++) {
      const off = i * BEAM_FLOATS, c = LIN[o.mask[i]];
      beamPrev[off] = o.x0[i]; beamPrev[off + 1] = o.y0[i]; beamPrev[off + 2] = o.x1[i]; beamPrev[off + 3] = o.y1[i]; beamPrev[off + 4] = c[0]; beamPrev[off + 5] = c[1]; beamPrev[off + 6] = c[2];
      beamPrev[off + 7] = beamIntensity(o.mask[i]); beamPrev[off + 8] = o.fa[i]; beamPrev[off + 9] = o.fb[i]; beamPrev[off + 10] = o.glow[i];
      beamPrev[off + 11] = ((o.axis[i] === 0 ? Math.abs(o.y0[i] - Math.floor(o.y0[i]) - 0.5) : Math.abs(o.x0[i] - Math.floor(o.x0[i]) - 0.5)) > 1e-3 ? 1 : 0) + (o.mask[i] === 7 ? 2 : 0);
    }
    prevCount = N;
  }

  /**
   * Une image complète.
   * @param {{w:number,h:number,k:number,tx:number,ty:number,floorTx:number,floorTy:number,cols:number,rows:number,quality:number,time:number,pulse:number,
   *   parX:number,parY:number,spotX:number,spotY:number,spotA:number,beamFade:number,won:boolean,grain:boolean,gain:number,glow:number,bloom:number,expo:number,flash:number,wave:number[]}} F  (pixels du tampon)
   * @param {object} post  segments traités ; @param {object} pieces  builder (under, over, fan)
   * @param {{data:Float32Array, count:number}|null} [parts]  particules (8 flottants par instance : x, y, demi-taille, type, r, g, b, alpha)
   */
  function frame(F, post, pieces, parts) {
    const W = F.w, H = F.h, q = QUALITY[F.quality];
    const lx = F.rot === 1 ? LIGHT[1] : LIGHT[0], ly = F.rot === 1 ? -LIGHT[0] : LIGHT[1]; // V7 : la lumière reste en haut à gauche de l'écran
    ensureTargets(W, H, F.quality);
    const T = targets;
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    // 1. sol
    let p = P.floor;
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fScene);
    gl.bindVertexArray(vaoTri);
    gl.useProgram(p.p);
    su(p, 'uRes', W, H); su(p, 'uFloorT', F.floorTx, F.floorTy); if (F.rot === 1) su(p, 'uMi', 0, 1 / F.k, -1 / F.k, 0); else su(p, 'uMi', 1 / F.k, 0, 0, 1 / F.k); su(p, 'uLight', lx, ly); su(p, 'uPx', 1 / F.k);
    su(p, 'uSpot', F.spotX, F.spotY); su(p, 'uSpotA', F.spotA); su(p, 'uPar', F.parX, F.parY); su(p, 'uHalf', F.cols / 2, F.rows / 2); su(p, 'uPad', F.padX ?? 0.30, F.padY ?? 0.30);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.beam); gl.uniform1i(gl.getUniformLocation(p.p, 'uBeam'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 2. pièces sous les faisceaux (verre facetté)
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    upload(buffers.under, pieces.under);
    p = P.piece;
    gl.useProgram(p.p); setWorld(p, F); su(p, 'uPx', 1 / F.k); su(p, 'uViewRot', F.rot === 1 ? Math.PI / 2 : 0); su(p, 'uLight', lx, ly); su(p, 'uTime', F.time); su(p, 'uTone', 0);
    gl.bindVertexArray(buffers.under.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, pieces.under.count);
    // 3. faisceaux et dispersion (MRT : scène + couche des faisceaux seule pour le reflet)
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fBeam);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.blendFunc(gl.ONE, gl.ONE);
    const nb = writeBeams(post, F.beamFade);
    gl.bindBuffer(gl.ARRAY_BUFFER, beamBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, beamData, 0, nb * BEAM_FLOATS);
    p = P.beam;
    gl.useProgram(p.p); setWorld(p, F); su(p, 'uTime', F.time); su(p, 'uGain', F.gain); su(p, 'uPulse', F.pulse);
    gl.bindVertexArray(vaoBeam);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nb);
    if (pieces.fan.count > 0) {
      upload(buffers.fan, pieces.fan);
      p = P.fan;
      gl.useProgram(p.p); setWorld(p, F); su(p, 'uTime', F.time); su(p, 'uGain', F.gain); su(p, 'uPulse', F.pulse);
      su(p, 'cR', LIN[1][0], LIN[1][1], LIN[1][2]); su(p, 'cG', LIN[2][0], LIN[2][1], LIN[2][2]); su(p, 'cB', LIN[4][0], LIN[4][1], LIN[4][2]);
      gl.bindVertexArray(buffers.fan.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, pieces.fan.count);
    }
    if (parts && parts.count > 0) { // particules : additives, dans la scène et la couche des faisceaux (reflet, lueur du sol)
      gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
      const bytes = parts.count * 32;
      if (bytes > partBytes) { partBytes = Math.max(bytes, 4096); gl.bufferData(gl.ARRAY_BUFFER, partBytes, gl.DYNAMIC_DRAW); }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, parts.data, 0, parts.count * 8);
      p = P.part;
      gl.useProgram(p.p); setWorld(p, F);
      gl.bindVertexArray(vaoPart);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, parts.count);
    }
    // 4. surimpressions (après les faisceaux, sans toucher la couche du reflet)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    upload(buffers.over, pieces.over);
    p = P.piece;
    gl.useProgram(p.p);
    gl.bindVertexArray(buffers.over.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, pieces.over.count);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.disable(gl.BLEND);
    gl.bindTexture(gl.TEXTURE_2D, T.beam);
    gl.generateMipmap(gl.TEXTURE_2D);
    // 5. bloom : descente puis remontée
    gl.bindVertexArray(vaoTri);
    p = P.down;
    gl.useProgram(p.p);
    gl.uniform1i(gl.getUniformLocation(p.p, 'uTex'), 0);
    let srcT = T.scene, sw = W, sh = H;
    for (let i = 0; i < T.lv.length; i++) {
      const lv = T.lv[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, lv.f); gl.viewport(0, 0, lv.w, lv.h); gl.bindTexture(gl.TEXTURE_2D, srcT);
      su(p, 'uTexel', 1 / sw, 1 / sh); su(p, 'uThr', i === 0 ? 0.22 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      srcT = lv.t; sw = lv.w; sh = lv.h;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    p = P.up;
    gl.useProgram(p.p);
    gl.uniform1i(gl.getUniformLocation(p.p, 'uTex'), 0);
    for (let i = T.lv.length - 1; i >= 1; i--) {
      const s = T.lv[i], d = T.lv[i - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.f); gl.viewport(0, 0, d.w, d.h); gl.bindTexture(gl.TEXTURE_2D, s.t);
      su(p, 'uTexel', 1 / s.w, 1 / s.h); su(p, 'uW', 0.9);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
    // 6. composition
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    p = P.comp;
    gl.useProgram(p.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.scene);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.lv[0].t);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T.beam);
    gl.uniform1i(gl.getUniformLocation(p.p, 'uScene'), 0); gl.uniform1i(gl.getUniformLocation(p.p, 'uBloom'), 1); gl.uniform1i(gl.getUniformLocation(p.p, 'uBeam'), 2);
    su(p, 'uRes', W, H); su(p, 'uWave', F.wave[0], F.wave[1], F.wave[2], F.wave[3]); su(p, 'uTime', F.time); su(p, 'uBloomG', BLOOM_GAIN[F.quality] * F.bloom); su(p, 'uGlow', F.glow);
    su(p, 'uReflG', q.reflection ? 0.30 : 0); su(p, 'uRefl', (-0.03 * F.k + F.camX * 0.7) / W, (0.12 * F.k - F.camY * 0.7) / H);
    su(p, 'uVig', 1); su(p, 'uGrain', F.grain && !reduced ? 1 : 0); su(p, 'uExpo', F.expo); su(p, 'uMenu', 0); su(p, 'uFlash', F.flash); su(p, 'uAber', reduced ? 0 : 0.0020);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 7. surimpressions nettes : hors bloom, directement sur l'image finale (V3-32 : le bloom ne noie aucun symbole)
    upload(buffers.top, pieces.top);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    p = P.piece;
    gl.useProgram(p.p); su(p, 'uTone', 1);
    gl.bindVertexArray(buffers.top.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, pieces.top.count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    T.fresh = false;
    frameIndex++;
    return T;
  }

  /** Lit un pixel (x, y en pixels du tampon, y vers le bas) dans l'image qui vient d'être dessinée (rendu synchrone : V3-36). */
  function readPixel(x, y) {
    const out = new Uint8Array(4);
    gl.readPixels(Math.round(x), targets ? targets.h - 1 - Math.round(y) : 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return Array.from(out);
  }

  function liveObjects() {
    let n = (targets ? targets.objects : 0) + Object.keys(programs).length + 3 + 4 * 2; // programmes, 3 VAO/VBO fixes (quad, beam, vaoTri), + 4 paires (VAO, tampon) d'instances
    n += 4; // beamBuf, vaoBeam, partBuf, vaoPart
    return n;
  }

  return {
    frame, readPixel, ensureTargets, snapshotPrev,
    get targets() { return targets; },
    get objects() { return liveObjects(); },
    set reduced(on) { reduced = on === true; },
    dispose() {
      if (targets) targets.dispose();
      targets = null;
      for (const b of Object.values(buffers)) { gl.deleteBuffer(b.buf); gl.deleteVertexArray(b.vao); }
      gl.deleteBuffer(quadBuf); gl.deleteBuffer(beamBuf); gl.deleteBuffer(partBuf); gl.deleteVertexArray(vaoTri); gl.deleteVertexArray(vaoBeam); gl.deleteVertexArray(vaoPart);
      for (const n of Object.keys(programs)) gl.deleteProgram(programs[n]);
    },
  };
}
