// Couche statique (D1) : fond du plateau, grille, murs ; deuxième canevas (après les faisceaux) : pièces fixes, émetteurs, portails. Dessinée une fois sur un canevas
// hors écran, recopiée à chaque image. Ne change qu'au chargement, au redimensionnement ou si une pièce FIXE change (éditeur).
import { THEME } from './theme.js';
import { defaultMakeCanvas } from './sprites.js';
import { drawWall, drawFixedDots, drawMirrorLine, drawSplitterBase, drawPrism, drawFilter, drawEmitter, drawPortal, drawGateLink } from './pieces.js';

/** Pièces dessinées dans la couche statique : tout ce qui ne bouge jamais, sauf cibles et portes (qui changent d'état). */
function isStatic(p) {
  return p.type === 'wall' || p.type === 'emitter' || p.type === 'portal' || (p.fixed && p.type !== 'target' && p.type !== 'gate');
}

/** Liens porte -> cible dont la cible est bien sur le plateau : [{ g:porte, t:cible }] (pièces de l'état). Les portes sans cible présente n'ont pas de lien. */
export function gateLinks(state) {
  const out = [];
  for (const g of state.pieces) {
    if (g.type !== 'gate' || !g.link) continue;
    const t = state.pieces.find((p) => p.type === 'target' && p.c === g.link[0] && p.r === g.link[1]);
    if (t !== undefined) out.push({ g, t });
  }
  return out;
}

/** Clé de cache : si elle ne change pas, la couche dessinée reste valable. */
export function staticKey(state, cell, dpr, rot = 0) {
  let k = `${state.cols}x${state.rows}@${cell}x${dpr}${rot === 1 ? ':rot' : ''}`;
  for (const p of state.pieces) {
    if (!isStatic(p)) continue;
    k += `|${p.type[0]}${p.c},${p.r},${p.o},${p.dir},${p.mask},${p.pair}`;
  }
  for (const l of gateLinks(state)) k += `|L${l.g.c},${l.g.r}>${l.t.c},${l.t.r}`; // le lien se redessine si une porte ou sa cible bouge (éditeur)
  return k;
}

/**
 * Dessine le plateau seul (sans marge) : le point (0,0) est le coin haut gauche de la grille.
 * @param {object} state  état (pièces)
 * @param {number} cell  taille d'une case en pixels CSS
 * @param {number} dpr  rapport de pixels (déjà plafonné à 2)
 * @param {(w:number,h:number)=>object} [makeCanvas]  fabrique de canevas (tests, navigateur sans OffscreenCanvas)
 * @param {number} [rot]  V7 : 1 si le plateau est affiché tourné : symboles, points de paire et émetteurs restent droits à l'écran
 */
export function createStaticLayer(state, cell, dpr, makeCanvas = defaultMakeCanvas, rot = 0, boardFill = THEME.boardFill) {
  const w = state.cols * cell, h = state.rows * cell;
  const canvas = makeCanvas(Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const rad = 10 / 62 * cell;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(0.5, 0.5, w - 1, h - 1, rad); else ctx.rect(0.5, 0.5, w - 1, h - 1);
  ctx.fillStyle = boardFill; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = THEME.boardBorder; ctx.stroke();
  ctx.beginPath();
  for (let i = 1; i < state.cols; i++) { ctx.moveTo(i * cell, 4 / 62 * cell); ctx.lineTo(i * cell, h - 4 / 62 * cell); }
  for (let j = 1; j < state.rows; j++) { ctx.moveTo(4 / 62 * cell, j * cell); ctx.lineTo(w - 4 / 62 * cell, j * cell); }
  ctx.strokeStyle = THEME.gridLine; ctx.stroke();

  // Liens porte -> cible (derrière tout : faisceaux, pièces fixes et mobiles), au-dessus des murs et de la grille.
  for (const l of gateLinks(state)) drawGateLink(ctx, (l.g.c + 0.5) * cell, (l.g.r + 0.5) * cell, (l.t.c + 0.5) * cell, (l.t.r + 0.5) * cell, cell);

  // Deuxième canevas : pièces fixes et émetteurs, recopiés APRÈS les faisceaux (la lumière ne doit pas les noyer ; ils restent statiques).
  const top = makeCanvas(canvas.width, canvas.height);
  const tctx = top.getContext('2d');
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const p of state.pieces) {
    const x = p.c * cell, y = p.r * cell, cx = x + cell / 2, cy = y + cell / 2;
    if (p.type === 'wall') { drawWall(ctx, x, y, cell, rot); continue; } // V10 : biseau lu depuis l'écran, comme en WebGL
    const upright = rot === 1 && (p.type === 'portal' || p.type === 'emitter' || (p.type === 'filter' && p.fixed));
    if (upright) { tctx.save(); tctx.translate(cx, cy); tctx.rotate(-Math.PI / 2); tctx.translate(-cx, -cy); } // contre-rotation autour du centre de la case
    switch (p.type) {
      case 'portal': drawPortal(tctx, cx, cy, cell, p.pair); break; // sur les faisceaux : les points de la paire restent lisibles
      case 'emitter': drawEmitter(tctx, cx, cy, cell, upright ? (p.dir + 3) & 3 : p.dir, p.mask); break; // tourné : le corps pointe vers la direction À L'ÉCRAN
      case 'mirror': if (p.fixed) { drawFixedDots(tctx, cx, cy, cell); drawMirrorLine(tctx, cx, cy, cell, p.o); } break;
      case 'splitter': if (p.fixed) { drawFixedDots(tctx, cx, cy, cell); drawSplitterBase(tctx, cx, cy, cell); drawMirrorLine(tctx, cx, cy, cell, p.o); } break;
      case 'prism': if (p.fixed) { drawFixedDots(tctx, cx, cy, cell); drawPrism(tctx, cx, cy, cell); } break;
      case 'filter': if (p.fixed) { drawFilter(tctx, x, y, cell, p.mask); drawFixedDots(tctx, cx, cy, cell); } break;
      default: break;
    }
    if (upright) tctx.restore();
  }
  return { canvas, top, key: staticKey(state, cell, dpr, rot), cssWidth: w, cssHeight: h };
}
