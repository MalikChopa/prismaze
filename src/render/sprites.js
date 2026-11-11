// Atlas de sprites hors écran (D2, D3, D4) : bandes de faisceau pré-floues, halos, jetons, pièces mobiles.
// Refait au redimensionnement (cell ou dpr qui changent). Aucun `ctx.filter`, aucun `shadowBlur` : seulement des dégradés.
import { THEME, GEOM } from './theme.js';
import { drawTile, drawMirrorLine, drawSplitterBase, drawPrism, drawFilter, drawToken } from './pieces.js';
/** Côté (en cases) de l'image d'un marqueur de faisceau dans l'atlas (V10). */
export const TOKEN_BOX = 0.36;

export function defaultMakeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
const mix = (hex, k) => { const [r, g, b] = rgb(hex); return `rgb(${Math.round(r + (255 - r) * k)},${Math.round(g + (255 - g) * k)},${Math.round(b + (255 - b) * k)})`; };

/** Clé de cache d'un atlas. */
export function atlasKey(cell, dpr) {
  return `${cell}@${dpr}`;
}

// Bande de dégradé (profil gaussien) : `band` = bande couchée (hauteur bw), `bandV` = debout (largeur bw). Étirée dans le sens de la longueur.
function band(mk, bw, color, sigma) {
  const { canvas, ctx } = mk(2, bw);
  const g = ctx.createLinearGradient(0, 0, 0, bw);
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * 2 - 1;
    g.addColorStop(i / N, color(Math.exp(-(t * t) / (2 * sigma * sigma)) * (1 - t * t * t * t)));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, bw);
  return canvas;
}

function bandV(mk, bw, color, sigma) {
  const { canvas, ctx } = mk(bw, 2);
  const g = ctx.createLinearGradient(0, 0, bw, 0);
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * 2 - 1;
    g.addColorStop(i / N, color(Math.exp(-(t * t) / (2 * sigma * sigma)) * (1 - t * t * t * t)));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, bw, 2);
  return canvas;
}

/**
 * @param {number} cell  taille de la case en pixels CSS
 * @param {number} dpr  rapport de pixels (déjà plafonné à 2)
 * @param {(w:number,h:number)=>object} [makeCanvas]
 * @returns l'atlas : beam[mask][0 couchée | 1 debout][0 halo large | 1 halo étroit | 2 cœur], glow[mask], dot[mask], token[mask], ring,
 *   tile, line (trait de miroir d'orientation 0, sans tuile), splitterBase, mirror[4], splitter[4], prism, filter[mask]
 */
export function createAtlas(cell, dpr, makeCanvas = defaultMakeCanvas) {
  // mk(w, h) : canevas de w x h pixels PÉRIPHÉRIQUES, repère identité ; mkCss(w, h) : w x h pixels CSS, repère CSS (échelle dpr)
  const mk = (w, h) => { const canvas = makeCanvas(Math.max(1, w), Math.max(1, h)); return { canvas, ctx: canvas.getContext('2d') }; };
  const mkCss = (w, h) => { const o = mk(Math.round(w * dpr), Math.round(h * dpr)); o.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return o; };

  const beam = [null];
  const glow = [null], dot = [null], token = [null], tokenV = [null], filter = [null];
  const wide = Math.max(2, Math.round(GEOM.beamWide * cell * dpr)), narrow = Math.max(2, Math.round(GEOM.beamNarrow * cell * dpr));
  const core = Math.max(2, Math.round(GEOM.beamCore * cell * dpr));
  for (let m = 1; m <= 7; m++) {
    const hue = THEME.hues[m];
    const layers = [
      [band(mk, wide, (a) => rgba(hue, 0.2 * a), 0.4), bandV(mk, wide, (a) => rgba(hue, 0.2 * a), 0.4)],
      [band(mk, narrow, (a) => rgba(hue, 0.5 * a), 0.45), bandV(mk, narrow, (a) => rgba(hue, 0.5 * a), 0.45)],
      [band(mk, core, (a) => mix(hue, 0.72).replace('rgb(', 'rgba(').replace(')', `,${Math.min(1, 1.25 * a)})`), 0.55), bandV(mk, core, (a) => mix(hue, 0.72).replace('rgb(', 'rgba(').replace(')', `,${Math.min(1, 1.25 * a)})`), 0.55)],
    ];
    beam[m] = [[layers[0][0], layers[1][0], layers[2][0]], [layers[0][1], layers[1][1], layers[2][1]]];

    const gl = mkCss(1.3 * cell, 1.3 * cell), gc = 0.65 * cell;
    const rg = gl.ctx.createRadialGradient(gc, gc, 0, gc, gc, gc);
    rg.addColorStop(0, rgba(hue, 0.55)); rg.addColorStop(0.35, rgba(hue, 0.2)); rg.addColorStop(1, rgba(hue, 0));
    gl.ctx.fillStyle = rg; gl.ctx.fillRect(0, 0, 1.3 * cell, 1.3 * cell);
    glow[m] = gl.canvas;

    const dt = mkCss(0.24 * cell, 0.24 * cell), dc = 0.12 * cell;
    const dg = dt.ctx.createRadialGradient(dc, dc, 0, dc, dc, dc);
    dg.addColorStop(0, 'rgba(255,255,255,0.95)'); dg.addColorStop(0.4, rgba(hue, 0.8)); dg.addColorStop(1, rgba(hue, 0));
    dt.ctx.fillStyle = dg; dt.ctx.fillRect(0, 0, 0.24 * cell, 0.24 * cell);
    dot[m] = dt.canvas;

    const tk = mkCss(TOKEN_BOX * cell, TOKEN_BOX * cell); // V10 : gélule de 0,31 case : boîte de 0,36 case
    drawToken(tk.ctx, TOKEN_BOX / 2 * cell, TOKEN_BOX / 2 * cell, cell, m);
    token[m] = tk.canvas;
    const tv = mkCss(TOKEN_BOX * cell, TOKEN_BOX * cell); // V10 : marqueur d'un faisceau vertical (à l'écran)
    drawToken(tv.ctx, TOKEN_BOX / 2 * cell, TOKEN_BOX / 2 * cell, cell, m, 1);
    tokenV[m] = tv.canvas;

    if (m <= 6) { const f = mkCss(cell, cell); drawFilter(f.ctx, 0, 0, cell, m); filter[m] = f.canvas; }
  }

  const rg = mkCss(0.44 * cell, 0.44 * cell);
  rg.ctx.beginPath(); rg.ctx.arc(0.22 * cell, 0.22 * cell, 0.15 * cell, 0, Math.PI * 2);
  rg.ctx.fillStyle = 'rgba(6,6,26,0.55)'; rg.ctx.fill();
  rg.ctx.lineWidth = Math.max(1.4, 0.03 * cell); rg.ctx.strokeStyle = 'rgba(255,255,255,0.92)'; rg.ctx.stroke();

  const tile = mkCss(cell, cell); drawTile(tile.ctx, 0, 0, cell);
  const c = cell / 2;
  const line = mkCss(cell, cell); drawMirrorLine(line.ctx, c, c, cell, 0);
  const sBase = mkCss(cell, cell); drawTile(sBase.ctx, 0, 0, cell); drawSplitterBase(sBase.ctx, c, c, cell);
  const mirror = [], splitter = [];
  for (let o = 0; o < 4; o++) {
    const a = mkCss(cell, cell); drawTile(a.ctx, 0, 0, cell); drawMirrorLine(a.ctx, c, c, cell, o); mirror.push(a.canvas);
    const b = mkCss(cell, cell); drawTile(b.ctx, 0, 0, cell); drawSplitterBase(b.ctx, c, c, cell); drawMirrorLine(b.ctx, c, c, cell, o); splitter.push(b.canvas);
  }
  const pr = mkCss(cell, cell); drawTile(pr.ctx, 0, 0, cell); drawPrism(pr.ctx, c, c, cell * 0.92);
  return {
    key: atlasKey(cell, dpr), cell, dpr, beam, glow, dot, token, tokenV, filter, ring: rg.canvas, tile: tile.canvas, line: line.canvas,
    splitterBase: sBase.canvas, mirror, splitter, prism: pr.canvas,
  };
}
