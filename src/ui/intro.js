// V11 : intro (~2,2 s, maquette D2) : un point de lumière relié par un fin rayon trace le logo trait par trait (1,2 s), le I s'allume
// comme un faisceau, puis le logo glisse à sa place sur l'accueil pendant que le noir s'efface. Clic, toucher ou touche : passée.
// Une fois par session (sessionStorage, protégé : un stockage bloqué = pas d'intro), jamais en mouvement réduit, jamais devant un lien direct.
import { buildWordmark, WM_VIEWBOX } from './wordmark.js';

export const INTRO_KEY = 'prismaze.intro';
const TRACE_S = 1.2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const easeIO = (x) => { const v = clamp(x, 0, 1); return v < 0.5 ? 2 * v * v : 1 - ((-2 * v + 2) ** 2) / 2; };

/** sessionStorage utilisable, ou null (navigation privée stricte, iframe bloquée...). */
export function sessionStore(win) {
  try { const s = win.sessionStorage; s.setItem('prismaze.probe', '1'); s.removeItem('prismaze.probe'); return s; } catch { return null; }
}

/**
 * L'intro doit-elle jouer ? Pure.
 * @param {{route:string, reduced:boolean, seen:boolean, forced:'on'|'off'|null, debug:boolean, storage:boolean}} o
 */
export function shouldPlayIntro({ route, reduced, seen, forced, debug, storage }) {
  if (forced === 'off' || route !== 'home' || reduced) return false;
  if (forced === 'on') return true;
  if (debug || !storage) return false; // essais (?debug) : pas d'intro sauf ?intro=1 ; stockage bloqué : on ne saurait pas la retenir
  return !seen;
}

/**
 * @param {{doc:Document, win:Window, box:HTMLElement, svg:SVGSVGElement, target:()=>Element|null, onEnd:()=>void}} deps
 *   box : voile plein écran ; svg : logo de l'intro ; target : logo de l'accueil (où le logo de l'intro va se poser)
 */
export function createIntro({ doc, win, box, svg, target, onEnd }) {
  const wm = buildWordmark(doc, svg, 'intro');
  const paths = wm.paths;
  const NS = svg.namespaceURI;
  const mk = (tag, attrs, parent) => { const n = doc.createElementNS(NS, tag); for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]); parent.appendChild(n); return n; };
  const defs = mk('defs', {}, svg);
  const rg = mk('radialGradient', { id: 'intro-head' }, defs);
  mk('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 1 }, rg);
  mk('stop', { offset: 0.3, 'stop-color': '#dfe2ff', 'stop-opacity': 0.6 }, rg);
  mk('stop', { offset: 1, 'stop-color': '#8a90ff', 'stop-opacity': 0 }, rg);
  const ray = mk('line', { x1: -260, y1: 300, x2: 0, y2: 0, stroke: '#cfd3ff', 'stroke-width': 1.6, 'stroke-opacity': 0, 'stroke-linecap': 'round' }, svg);
  const headC = mk('circle', { r: 18, fill: 'url(#intro-head)', opacity: 0 }, svg);
  let lens = [], total = 0, t0 = 0, raf = 0, state = 'off', flyTimer = 0;

  function measure() {
    lens = paths.map((p) => (typeof p.getTotalLength === 'function' ? p.getTotalLength() : 100));
    total = lens.reduce((a, b) => a + b, 0);
    paths.forEach((p, i) => { p.style.strokeDasharray = `${lens[i]} ${lens[i]}`; p.style.strokeDashoffset = String(lens[i]); });
  }
  function place() {
    const w = Math.min(win.innerWidth * 0.8, 620), h = (WM_VIEWBOX[3] * w) / WM_VIEWBOX[2];
    svg.style.width = `${w}px`; svg.style.height = `${h}px`;
    svg.style.transform = `translate(${(win.innerWidth - w) / 2}px,${(win.innerHeight - h) / 2}px)`;
    return { w };
  }
  function draw(tt) {
    const pos = easeIO(tt / TRACE_S) * total;
    let acc = 0, hp = null;
    for (let i = 0; i < paths.length; i++) {
      const L = lens[i], v = clamp(pos - acc, 0, L);
      paths[i].style.strokeDashoffset = String(L - v);
      if (!hp && pos < acc + L && v > 0) {
        const pp = paths[i].getPointAtLength(v), m = /translate\(([-\d.]+)/.exec(paths[i].parentNode.getAttribute('transform') || '');
        hp = { x: pp.x + (m ? Number(m[1]) : 0), y: pp.y };
      }
      acc += L;
    }
    if (hp) { headC.setAttribute('cx', hp.x); headC.setAttribute('cy', hp.y); headC.setAttribute('opacity', 1); ray.setAttribute('x2', hp.x); ray.setAttribute('y2', hp.y); ray.setAttribute('stroke-opacity', 0.45); } else { headC.setAttribute('opacity', 0); ray.setAttribute('stroke-opacity', 0); }
    wm.I.style.opacity = String(clamp((tt - TRACE_S) / 0.25, 0, 1));
  }
  function loop(now) {
    raf = 0;
    const tt = (now - t0) / 1000;
    draw(tt);
    if (tt >= TRACE_S + 0.35) { fly(); return; }
    raf = win.requestAnimationFrame(loop);
  }
  function fly() {
    if (state !== 'run') return;
    state = 'fly';
    const a = place(), el = target(), r = el ? el.getBoundingClientRect() : null;
    box.classList.add('out');
    if (r && r.width > 0) svg.style.transform = `translate(${r.left}px,${r.top}px) scale(${r.width / a.w})`;
    // V13 (test joueur n° 7) : le menu monte pendant le vol, mais le titre de l'accueil reste caché (`intro-fly`) jusqu'à ce que celui de
    // l'intro soit posé exactement sur lui (même place, même taille) : jamais deux PRISMAZE à l'écran.
    doc.documentElement.classList.add('intro-fly', 'intro-done');
    doc.documentElement.classList.remove('intro-on');
    flyTimer = win.setTimeout(end, 600);
  }
  function end() {
    if (state === 'off') return;
    state = 'off';
    if (raf) win.cancelAnimationFrame(raf);
    raf = 0;
    win.clearTimeout(flyTimer);
    box.hidden = true;
    box.classList.remove('out');
    doc.documentElement.classList.remove('intro-on', 'intro-fly');
    doc.documentElement.classList.add('intro-done');
    win.removeEventListener('keydown', onKey, true);
    box.removeEventListener('pointerdown', skip);
    win.removeEventListener('resize', onResize);
    onEnd();
  }
  function skip(e) { if (state === 'run' || state === 'fly') { if (e && typeof e.preventDefault === 'function') e.preventDefault(); end(); } }
  const onKey = (e) => { if (state !== 'off') { if (e.key !== 'Tab') e.stopPropagation(); skip(e); } };
  const onResize = () => { if (state === 'run') place(); };

  return {
    get state() { return state; },
    /** Lance l'intro. */
    play() {
      measure();
      state = 'run';
      box.hidden = false;
      box.classList.remove('out');
      doc.documentElement.classList.add('intro-on');
      doc.documentElement.classList.remove('intro-done', 'intro-fly');
      wm.I.style.opacity = '0';
      place();
      box.addEventListener('pointerdown', skip);
      win.addEventListener('keydown', onKey, true);
      win.addEventListener('resize', onResize);
      t0 = win.performance.now();
      raf = win.requestAnimationFrame(loop);
    },
    /** Passe l'intro (clic, touche, ou une navigation qui arrive pendant l'intro). */
    skip() { skip(null); },
  };
}
