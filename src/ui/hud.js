// Interface flottante (ARCHITECTURE_V3_RENDU V3-21, V3-23, V3-24, V3-38) : HTML par-dessus le canvas, masquage automatique, plaques de verre et mesure des obstacles.
// `uiMode` et `pinsFor` sont purs ; `createFloatingUi` touche au DOM (l'automate lui-même est `render/scene/hud.js`, le voile `render/scene/scrim.js`).
import { createHud, HUD } from '../render/scene/hud.js';
import { scrimHits, SCRIM } from '../render/scene/scrim.js';

/**
 * Mode de l'interface lu dans l'URL (V3-6, V3-35, V3-40). Joueur : tout est actif. `?debug` : ancienne disposition, caméra et masquage coupés (essais),
 * sauf `?immersive=1` ou `?camera=1` / `?autohide=1`, qui rendent la disposition immersive aux essais. `?camera=0`, `?autohide=0`, `?immersive=0` : coupent.
 * @param {URLSearchParams} params
 * @returns {{immersive:boolean, camera:boolean, autohide:boolean}}  camera/autohide = permis (le réglage du joueur décide ensuite)
 */
export function uiMode(params) {
  const debug = params.has('debug');
  const flag = (name, dflt) => { const v = params.get(name); return v === null ? dflt : v !== '0'; };
  const asksImmersive = params.get('camera') === '1' || params.get('autohide') === '1';
  const immersive = flag('immersive', !debug || asksImmersive);
  return { immersive, camera: immersive && flag('camera', !debug), autohide: immersive && flag('autohide', !debug), rotation: immersive && flag('rot', !debug) }; // rotation : V7, `?debug` : `&rot=1` pour la tester, `?rot=0` coupe
}

/** Rendre l'ordre historique du DOM pour la disposition « classique » (`?debug` : essais à leurs coordonnées) : réglages dans la barre d'outils, recommencer à part. */
export function restoreClassicDom(doc) {
  const tools = doc.getElementById('tools'), reset = doc.getElementById('btn-reset'), settings = doc.getElementById('btn-settings');
  if (!tools || !reset || !settings) return;
  tools.parentNode.insertBefore(reset, tools);
  tools.appendChild(settings);
}

const CHAPTER_OF_PREFIX = Object.freeze({ m: 'Miroirs', c: 'Couleurs', p: 'Prismes', s: 'Pièces spéciales', x: 'Maîtrise' });

/**
 * Titre d'un niveau pour le joueur : jamais le nom de fichier (il donne la solution des puzzles sans parole). `label` déjà au format Chapitre · rang (coque) : inchangé ;
 * niveau de développement (`?level=`, label = l'identifiant du fichier) ou identifiant reconnu `m04-contourner` -> « MIROIRS · 04 ». Partagés, éditeur, défi gardent leur nom.
 */
export function levelTitle(label, levelId) {
  const m = /^([a-z])(\d{2})-/.exec(levelId || '');
  if (m === null || CHAPTER_OF_PREFIX[m[1]] === undefined || label !== String(levelId).toUpperCase()) return label;
  return `${CHAPTER_OF_PREFIX[m[1]].toUpperCase()} · ${m[2]}`;
}

const PLATES = ['hud-tl', 'hud-tr', 'caption', 'tools']; // éléments flottants à plaque de verre, dans l'ordre des rectangles mesurés
const OBSTACLES = ['hud-tl', 'hud-tr', 'tools', 'caption', 'win'];

/** Rectangle {x, y, w, h} d'un élément affiché, ou null. */
function rectOf(el) {
  if (!el || el.hidden) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}

/**
 * @param {{doc:Document, win:Window, root:HTMLElement, autohide?:boolean, now?:()=>number, setTimer?:Function, clearTimer?:Function}} deps
 */
export function createFloatingUi(deps) {
  const { doc, win, root } = deps;
  const now = deps.now || (() => performance.now());
  const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer || ((id) => clearTimeout(id));
  const auto = createHud({ enabled: deps.autohide !== false });
  const plates = PLATES.map((id) => doc.getElementById(id));
  const pins = { settings: false, focus: false, won: false, hint: false };
  let applied = '', timer = null, timerAt = Infinity, msgUntil = -Infinity, dead = false;
  let plateRects = [], hits = new Uint8Array(PLATES.length).fill(255), scrimK = 0, scrimX = 0, scrimY = 0, scrimFor = null;

  function apply(state) {
    if (state !== applied) { applied = state; root.dataset.hud = state; }
  }
  function disarm() { if (timer !== null) { clearTimer(timer); timer = null; timerAt = Infinity; } }
  function arm(t) {
    let at = auto.idleAt(t);
    if (at === Infinity && t < msgUntil) at = msgUntil; // le message expire : réévaluer à cet instant
    if (at === Infinity) { disarm(); return; }
    if (timer !== null && at === timerAt) return;
    disarm();
    timerAt = at;
    timer = setTimer(() => { timer = null; timerAt = Infinity; update(); }, Math.max(0, at - t) + 1);
  }
  function update() {
    if (dead) return;
    const t = now();
    apply(auto.tick(t).state);
    arm(t);
  }

  const inZone = (n) => n && typeof n.closest === 'function' && n.closest('.fl') !== null;
  const wake = () => { auto.input(now()); update(); };
  const onFocusIn = (e) => { if (inZone(e.target)) setPin('focus', true); };
  const onFocusOut = (e) => { if (inZone(e.target) && !inZone(e.relatedTarget)) setPin('focus', false); };
  function setPin(name, on) {
    if (pins[name] === on) return;
    pins[name] = on;
    auto.pin(name, on, now());
    update();
  }

  // ordre : capture, donc le keydown réveille AVANT le déplacement du focus (V3-21)
  const listeners = HUD.WAKE_EVENTS.filter((t) => t !== 'focusin').map((type) => [type, wake]);
  for (const [type, fn] of listeners) doc.addEventListener(type, fn, { capture: true, passive: true });
  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('focusout', onFocusOut, true);
  auto.input(now()); // V9b (test final) : à l'entrée dans un niveau, titre, compteur et légende restent visibles le délai normal avant de s'effacer
  update();

  return {
    get state() { return applied; },
    get plates() { return [...hits]; },
    setAutohide(on) { auto.set({ enabled: on !== false }); update(); },
    pin: setPin,
    /** Message visible (lâcher refusé, indice) : l'interface reste affichée 2,2 s au moins. */
    message() { const t = now(); msgUntil = t + HUD.MESSAGE_MS; auto.message(t); update(); },
    /** Marges de sécurité (encoches), lues sur la sonde CSS `#safe-probe`. */
    safeArea() {
      const p = doc.getElementById('safe-probe');
      if (!p) return { top: 0, right: 0, bottom: 0, left: 0 };
      const s = win.getComputedStyle(p), n = (v) => parseFloat(v) || 0;
      return { top: n(s.paddingTop), right: n(s.paddingRight), bottom: n(s.paddingBottom), left: n(s.paddingLeft) };
    },
    /** Rectangles mesurés des éléments flottants (visibles ou masqués) : les obstacles de la mise en page (V3-38). */
    obstacles(o = {}) {
      plateRects = PLATES.map((id) => rectOf(doc.getElementById(id)));
      scrimFor = null;
      return OBSTACLES.filter((id) => !(o.without && o.without.includes(id))).map((id) => rectOf(doc.getElementById(id))).filter((r) => r !== null);
    },
    /**
     * Voile de lisibilité (V3-23) : 0,30 au repos, 0,70 quand un faisceau passe à moins de 0,6 case d'un élément. Ne recalcule que si la vue ou le tracé changent.
     * @param {object} view  vue présentée ; @param {object} state  état affiché (identité = tracé) ; @param {object} segs  result.segments()
     */
    scrim(view, state, segs) {
      if (state === scrimFor && Math.abs(view.k - scrimK) < 0.25 && Math.abs(view.tx - scrimX) < 0.5 && Math.abs(view.ty - scrimY) < 0.5) return;
      scrimFor = state; scrimK = view.k; scrimX = view.tx; scrimY = view.ty;
      const rects = plateRects.map((r) => r || { x: -1e6, y: -1e6, w: 0, h: 0 });
      if (view.rot === 1) { // plateau tourné : `scrimHits` lit p = k·x + t, on lui donne le tracé déjà tourné (x', y') = (−y, x)
        const n = segs.count, ts = { count: n, x0: new Float32Array(n), y0: new Float32Array(n), x1: new Float32Array(n), y1: new Float32Array(n) };
        for (let i = 0; i < n; i++) { ts.x0[i] = -segs.y0[i]; ts.y0[i] = segs.x0[i]; ts.x1[i] = -segs.y1[i]; ts.y1[i] = segs.x1[i]; }
        segs = ts;
      }
      const out = scrimHits(rects, segs, view);
      for (let i = 0; i < plates.length; i++) {
        if (hits[i] === out[i]) continue;
        hits[i] = out[i];
        if (plates[i]) plates[i].style.setProperty('--plate', String(out[i] ? SCRIM.HIGH : SCRIM.LOW));
      }
    },
    destroy() {
      dead = true;
      disarm();
      for (const [type, fn] of listeners) doc.removeEventListener(type, fn, { capture: true });
      doc.removeEventListener('focusin', onFocusIn, true);
      doc.removeEventListener('focusout', onFocusOut, true);
      delete root.dataset.hud;
    },
  };
}
