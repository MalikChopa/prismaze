// V11 : logo PRISMAZE (dessin original de la maquette D2) : traits droits, chanfreins à 45° (l'angle des miroirs) ; le I est un faisceau
// (cœur blanc, halo à la couleur du parcours de la scène, variable CSS --beam). Aussi les petits dessins lumineux des chapitres.

const GLYPHS = [['P', 58, ['M0 100V0H40L58 18V34L40 52H0']], ['R', 58, ['M0 100V0H40L58 18V34L40 52H0', 'M32 52L58 100']], ['I', 0, null],
  ['S', 58, ['M58 0H18L0 18V32L18 50H40L58 68V82L40 100H0']], ['M', 70, ['M0 100V0L35 56L70 0V100']], ['A', 58, ['M0 100V22L22 0H36L58 22V100', 'M0 60H58']],
  ['Z', 58, ['M0 0H58L0 100H58']], ['E', 54, ['M54 0H0V100H54', 'M0 50H44']]];
const GAP = 24;
let width = 0, ix = 0;
const placed = GLYPHS.map((g, i) => { const x = width; if (g[0] === 'I') ix = x; width += g[1] + (i < GLYPHS.length - 1 ? GAP : 0); return { x, paths: g[2] }; });
/** viewBox du logo. */
export const WM_VIEWBOX = [-8, -10, width + 16, 120];

function el(doc, tag, attrs, parent) {
  const n = doc.createElementNS(parent.namespaceURI, tag); // espace de noms lu sur le <svg> d'accueil (aucune adresse écrite dans le code)
  for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

/**
 * Dessine le logo dans `svg` (vide). `id` : suffixe unique du filtre de halo.
 * @returns {{paths:SVGPathElement[], I:SVGGElement}}
 */
export function buildWordmark(doc, svg, id) {
  svg.setAttribute('viewBox', WM_VIEWBOX.join(' '));
  const defs = el(doc, 'defs', {}, svg);
  const f = el(doc, 'filter', { id: `wmglow-${id}`, filterUnits: 'userSpaceOnUse', x: ix - 60, y: -50, width: 120, height: 200 }, defs);
  el(doc, 'feGaussianBlur', { stdDeviation: 5 }, f);
  const g = el(doc, 'g', { fill: 'none', stroke: '#e6e8fb', 'stroke-width': 11, 'stroke-linecap': 'butt', 'stroke-linejoin': 'bevel' }, svg);
  const paths = [];
  for (const gl of placed) {
    if (!gl.paths) continue;
    const gg = el(doc, 'g', { transform: `translate(${gl.x} 0)` }, g);
    for (const d of gl.paths) paths.push(el(doc, 'path', { d }, gg));
  }
  const I = el(doc, 'g', { class: 'wm-i' }, svg);
  el(doc, 'line', { x1: ix, y1: -2, x2: ix, y2: 102, 'stroke-width': 24, 'stroke-opacity': 0.75, filter: `url(#wmglow-${id})`, style: 'stroke:var(--beam);transition:stroke 1.4s' }, I);
  el(doc, 'line', { x1: ix, y1: 0, x2: ix, y2: 100, stroke: '#ffffff', 'stroke-width': 11 }, I);
  return { paths, I };
}

// ---- dessins lumineux des chapitres (maquette D2), SVG en texte constant (aucune donnée externe) ----
const beam = (d, col, w = 7) => `<path d="${d}" stroke="${col}" stroke-width="${w}" opacity=".22" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" stroke="${col}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" stroke="#fff" stroke-width=".7" opacity=".8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const hexT = (x, y, col) => `<g transform="translate(${x} ${y})"><polygon points="0,-8 7,-4 7,4 0,8 -7,4 -7,-4" fill="${col}" stroke="${col}" stroke-width="1.3" style="filter:drop-shadow(0 0 5px ${col})"/></g>`;
const mir = (x, y, a) => { const dx = 8 * Math.cos(a), dy = 8 * Math.sin(a); return `<line x1="${x - dx}" y1="${y - dy}" x2="${x + dx}" y2="${y + dy}" stroke="#e8ecff" stroke-width="2.6" stroke-linecap="round"/>`; };
const GRID = (() => { let s = ''; for (let x = 20; x < 160; x += 20) s += `<path d="M${x} 0V90" stroke="rgba(170,180,255,.07)"/>`; for (let y = 15; y < 90; y += 20) s += `<path d="M0 ${y}H160" stroke="rgba(170,180,255,.07)"/>`; return s; })();
const PI = Math.PI;
const ART = [
  GRID + beam('M8 65H60V25H150', '#c9d0ff') + mir(60, 65, -PI / 4) + mir(60, 25, -PI / 4) + hexT(150, 25, '#c9d0ff') + '<rect x="2" y="59" width="12" height="12" rx="3" fill="#0b0d24" stroke="#c9d0ff" stroke-width="1.2"/>',
  GRID + beam('M8 45H80', '#ff4d6d') + beam('M80 86V45', '#4d8dff') + beam('M80 45H148', '#c26bff') + hexT(148, 45, '#c26bff') + '<rect x="74" y="39" width="12" height="12" rx="2" fill="none" stroke="#e8ecff" stroke-width="1.2" opacity=".7"/>',
  GRID + beam('M8 45H72', '#ffffff') + beam('M80 45V8', '#ff4d6d') + beam('M80 45H150', '#3dffb0') + beam('M80 45V84', '#4d8dff') + '<polygon points="70,36 92,45 70,54" fill="rgba(160,170,255,.2)" stroke="#e8ecff" stroke-width="1.3" stroke-linejoin="round"/>' + hexT(150, 45, '#3dffb0'),
  GRID + beam('M8 62H52', '#4d8dff') + beam('M108 28H150', '#4d8dff') + '<ellipse cx="56" cy="62" rx="5" ry="11" fill="none" stroke="#3de0ff" stroke-width="1.6" style="filter:drop-shadow(0 0 4px #3de0ff)"/><ellipse cx="104" cy="28" rx="5" ry="11" fill="none" stroke="#3de0ff" stroke-width="1.6" style="filter:drop-shadow(0 0 4px #3de0ff)"/><path d="M60 62Q82 60 100 30" stroke="#3de0ff" stroke-dasharray="2 4" fill="none" opacity=".7"/><rect x="126" y="60" width="6" height="26" rx="2" fill="none" stroke="#ffb84d" stroke-width="1.3" opacity=".8"/>' + hexT(150, 28, '#4d8dff'),
  GRID + beam('M8 18H40V72H100V34H152', '#c26bff') + beam('M100 34V6', '#3dffb0') + mir(40, 18, PI / 4) + mir(40, 72, -PI / 4) + mir(100, 72, -PI / 4) + '<rect x="94" y="28" width="12" height="12" rx="2" fill="rgba(160,170,255,.16)" stroke="#e8ecff" stroke-width="1.1" transform="rotate(45 100 34)"/>' + hexT(152, 34, '#c26bff') + hexT(100, 6, '#3dffb0'),
];
/** Dessin du chapitre n° `i` (0 à 4 ; au-delà : le dernier), en texte SVG constant. */
export const chapterArt = (i) => `<svg viewBox="0 0 160 90" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice">${ART[Math.max(0, Math.min(ART.length - 1, i))]}</svg>`;
