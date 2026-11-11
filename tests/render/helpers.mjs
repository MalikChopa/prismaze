// Faux navigateur minimal pour tester l'hôte de rendu sans DOM : éléments, file de rAF/minuteries pilotée à la main, faux GL.

export function fakeEl(tag = 'div') {
  const handlers = {};
  const el = {
    tagName: tag.toUpperCase(), id: '', style: {}, attrs: {}, children: [], parentNode: null, width: 300, height: 150,
    setAttribute(k, v) { el.attrs[k] = String(v); },
    addEventListener(t, fn) { (handlers[t] ||= []).push(fn); },
    removeEventListener(t, fn) { handlers[t] = (handlers[t] || []).filter((f) => f !== fn); },
    fire(t, ev = {}) { const e = { type: t, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, ...ev }; for (const f of [...(handlers[t] || [])]) f(e); return e; },
    listeners: (t) => (handlers[t] || []).length,
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = el; el.children.push(c); return c; },
    insertBefore(c, ref) { if (c.parentNode) c.parentNode.removeChild(c); const i = el.children.indexOf(ref); c.parentNode = el; el.children.splice(i < 0 ? el.children.length : i, 0, c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; return c; },
    get nextSibling() { const p = el.parentNode; return p ? p.children[p.children.indexOf(el) + 1] || null : null; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    getContext: () => null,
  };
  return el;
}

export function fakeEnv(search = '') {
  const rafs = [], timers = [];
  const win = {
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    requestAnimationFrame(fn) { rafs.push(fn); return rafs.length; },
    setTimeout(fn) { timers.push(fn); return timers.length; },
  };
  const doc = { createElement: (t) => fakeEl(t) };
  const screen = fakeEl('div');
  const canvas = fakeEl('canvas'); canvas.id = 'game';
  screen.appendChild(canvas);
  /** Vide les rAF et minuteries jusqu'à épuisement (au plus `max` tours). */
  async function settle(max = 40) {
    for (let i = 0; i < max; i++) {
      const r = rafs.splice(0), t = timers.splice(0);
      if (r.length === 0 && t.length === 0) { await new Promise((x) => setImmediate(x)); if (rafs.length === 0 && timers.length === 0) return; continue; }
      for (const f of r) f(0);
      for (const f of t) f();
      await new Promise((x) => setImmediate(x));
    }
  }
  return { win, doc, screen, canvas, params: new URLSearchParams(search), settle, pending: () => rafs.length + timers.length };
}

/** Faux renderer Canvas 2D : enregistre les appels. */
export function fakeRenderer2d(log = []) {
  const L = { x0: 100, y0: 50, cell: 60, boardW: 600, boardH: 480, w: 1280, h: 720 };
  return {
    render(...a) { log.push(['render', ...a]); }, resize() { log.push(['resize']); }, cellAt: (x, y) => ({ c: x, r: y }), celebrate() { log.push(['celebrate']); },
    layout: L, animating: false, particlesPeak: 3, particlesAlive: 2, reducedMotion: false,
    setReducedMotion(on) { log.push(['reduced', on]); this.reducedMotion = on; },
  };
}

/** Faux contexte GL pour le contrôle des capacités et la compilation. */
export function fakeGl(o = {}) {
  const calls = [];
  const exts = o.exts || { WEBGL_debug_renderer_info: { UNMASKED_RENDERER_WEBGL: 0x9246 }, WEBGL_lose_context: { loseContext() { calls.push('loseContext'); } }, KHR_parallel_shader_compile: { COMPLETION_STATUS_KHR: 0x91b1 } };
  const gl = {
    calls, FRAMEBUFFER: 1, TEXTURE_2D: 2, COLOR_ATTACHMENT0: 3, FRAMEBUFFER_COMPLETE: 4, NO_ERROR: 0, RGBA16F: 16, RGBA8: 8,
    MAX_TEXTURE_SIZE: 20, MAX_DRAW_BUFFERS: 21, VERTEX_SHADER: 30, FRAGMENT_SHADER: 31, LINK_STATUS: 40, COMPILE_STATUS: 41, TRIANGLES: 5,
    getExtension: (n) => (n === 'WEBGL_debug_renderer_info' && o.noRendererExt ? null : exts[n] || null),
    getParameter(p) { if (p === 0x9246) return o.renderer ?? 'ANGLE (AMD Radeon RX 7900 XT)'; if (p === 20) return o.maxTexture ?? 16384; if (p === 21) return o.drawBuffers ?? 8; return null; },
    createTexture: () => ({}), createFramebuffer: () => ({}), bindTexture() {}, bindFramebuffer() {}, deleteFramebuffer() {}, deleteTexture() {},
    texStorage2D(t, l, fmt) { gl._fmt = fmt; }, framebufferTexture2D() {},
    checkFramebufferStatus() { return (gl._fmt === 16 ? o.hdr !== false : o.ldr !== false) ? 4 : 0; }, getError: () => 0,
    createShader: () => ({}), shaderSource() {}, compileShader() {}, createProgram: () => ({ id: 1 }), attachShader() {}, detachShader() {}, linkProgram() { calls.push('link'); },
    getProgramParameter: (p, k) => (k === 40 ? o.link !== false : o.complete ?? true), getShaderParameter: () => true, getProgramInfoLog: () => o.log || '', getShaderInfoLog: () => '',
    deleteShader() {}, deleteProgram() { calls.push('deleteProgram'); }, getUniformLocation: (p, n) => n, viewport() {}, useProgram() {},
    uniform2f() {}, uniform4f() {}, uniform1f() {}, drawArrays() { calls.push('draw'); },
  };
  return gl;
}

/** Fausse pile GL de V3 : renderer et builder factices (les vrais shaders sont testés dans le vrai navigateur, tests/render-gl et e2e gl). */
export function fakeGlApi(log = []) {
  return {
    createGlRenderer() {
      const r = { frame(F) { log.push(['frame', F.w, F.h, F.quality]); }, snapshotPrev() {}, readPixel: () => [1, 2, 3, 255], objects: 7, targets: { w: 1280, h: 720 }, dispose() { log.push(['dispose']); }, set reduced(v) { log.push(['glReduced', v]); } };
      return r;
    },
    createPieceBuilder() { return { under: { count: 0 }, over: { count: 0 }, top: { count: 0 }, fan: { count: 0 }, build() {}, busy: false, setReduced() {} }; },
  };
}

/** Faux état + tracé pour faire passer le chemin GL de l'hôte. */
export function fakeScene(cols = 4, rows = 3) {
  const state = { cols, rows, pieces: [] };
  const n = 4 * cols * rows;
  const result = { in: new Uint8Array(n), out: new Uint8Array(n), segments: () => ({ count: 0, x0: new Float32Array(1), y0: new Float32Array(1), x1: new Float32Array(1), y1: new Float32Array(1), mask: new Uint8Array(1) }), targets: [], gates: [] };
  return { state, result };
}
