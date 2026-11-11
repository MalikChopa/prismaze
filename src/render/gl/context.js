// Contexte WebGL2 : création, lecture du nom du pilote graphique, contrôle des capacités par l'essai (ARCHITECTURE_V3_RENDU V3-3).
// Aucune ressource en variable de module : tout est reconstruisible après une perte de contexte (V3-4).

/** Pilotes « logiciels » (rendu par le processeur) : le jeu choisit alors le Canvas 2D, sauf `?r=gl`. Insensible à la casse. */
export const SOFTWARE_RE = /swiftshader|llvmpipe|software|basic render/i;

/** `failIfMajorPerformanceCaveat` reste une simple demande : mesuré, Chrome 156 + SwiftShader renvoie quand même un contexte (jamais une preuve). */
export const CONTEXT_OPTIONS = Object.freeze({
  antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'default', failIfMajorPerformanceCaveat: true,
});

export const isSoftwareRenderer = (name) => typeof name === 'string' && SOFTWARE_RE.test(name);

/** Nom du pilote (WEBGL_debug_renderer_info). Chaîne vide si l'extension est absente ou masquée : « non vérifié », le jeu part alors en GL. */
export function rendererString(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return '';
    const v = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    return typeof v === 'string' ? v : '';
  } catch { return ''; }
}

/**
 * Crée le contexte WebGL2 du canvas. `nogl` (essais) : comme un navigateur sans WebGL2, renvoie null.
 * `forced` (`?r=gl`) : si la demande de performance fait échouer la création, on réessaie sans elle.
 */
export function createGlContext(canvas, { nogl = false, forced = false } = {}) {
  if (nogl) return null;
  const tryCtx = (opts) => { try { return canvas.getContext('webgl2', opts); } catch { return null; } };
  let gl = tryCtx({ ...CONTEXT_OPTIONS });
  if (!gl && forced) gl = tryCtx({ ...CONTEXT_OPTIONS, failIfMajorPerformanceCaveat: false });
  return gl || null;
}

/** Essai d'une cible de rendu : texture à mipmaps du format demandé, attachée à un FBO, doit être « complète ». */
function fboComplete(gl, internalFormat) {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  let ok = false;
  try {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 3, internalFormat, 8, 8); // 8 -> 4 -> 2 : trois niveaux, comme les mipmaps du reflet
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
  } catch { ok = false; }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  return ok;
}

/**
 * Contrôle par l'essai : RGBA16F (HDR) sinon RGBA8 (8 bits), au moins 2 sorties de dessin, texture assez grande pour la fenêtre.
 * @returns {{ok:boolean, hdr:boolean, reason:string, maxTexture:number, drawBuffers:number}}
 */
export function probeCapabilities(gl, { w = 0, h = 0 } = {}) {
  let maxTexture = 0, drawBuffers = 0;
  try {
    maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) | 0;
    drawBuffers = gl.getParameter(gl.MAX_DRAW_BUFFERS) | 0;
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    const hdr = fboComplete(gl, gl.RGBA16F);
    const ldr = hdr || fboComplete(gl, gl.RGBA8);
    if (!ldr) return { ok: false, hdr: false, reason: 'no-render-target', maxTexture, drawBuffers };
    if (drawBuffers < 2) return { ok: false, hdr, reason: 'draw-buffers', maxTexture, drawBuffers };
    if (maxTexture < Math.max(w, h)) return { ok: false, hdr, reason: 'texture-size', maxTexture, drawBuffers };
    return { ok: true, hdr, reason: '', maxTexture, drawBuffers };
  } catch {
    return { ok: false, hdr: false, reason: 'probe-error', maxTexture, drawBuffers };
  }
}

/** Taille du tampon GL : DPR plafonné à 2, et au plus 3,7 millions de pixels de cible (V3-12 règle 1). */
export function glBufferSize(cssW, cssH, dpr) {
  const MAX_PIXELS = 3.7e6;
  let k = Math.min(Math.max(dpr || 1, 1), 2);
  if (cssW * cssH * k * k > MAX_PIXELS) k = Math.sqrt(MAX_PIXELS / (cssW * cssH));
  return { w: Math.max(1, Math.round(cssW * k)), h: Math.max(1, Math.round(cssH * k)), scale: k };
}
