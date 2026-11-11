// Réglages (U8) : fenêtre modale <dialog>. showModal() piège le focus dans la fenêtre et l'arrière-plan reste inerte ; on ajoute `inert` sur
// #app (ceinture et bretelles) et on rend le focus à l'élément d'origine à la fermeture (U2). Échap ferme.
// Réglages : mouvement réduit (auto / oui / non), symboles sur les faisceaux (défaut oui), son, musique d'ambiance (V11), caméra, masquage de l'interface, rendu et qualité des effets (V3-30). Réinitialiser la progression : avec confirmation.
import { watchScroll } from './scroll-cue.js';

const QUALITY_LABELS = Object.freeze(['Haut', 'Moyen', 'Bas']);
/** Réglage de la sauvegarde -> valeur de `host.setQuality`. */
export const QUALITY_TO_HOST = Object.freeze({ auto: 'auto', haut: 0, moyen: 1, bas: 2 });

/**
 * Ligne « Rendu : WebGL2 · Moyen (auto) » (V3-30) : ce qui est réellement affiché, pas ce qui est demandé.
 * @param {{backend:'gl'|'c2d', quality:number, qualitySetting:string, rendererSetting:string}} i
 */
export function renderLine({ backend, quality, qualitySetting, rendererSetting }) {
  const name = backend === 'gl' ? 'WebGL2' : 'Canvas 2D';
  const q = QUALITY_LABELS[quality] || QUALITY_LABELS[0];
  const fallback = rendererSetting === 'webgl' && backend !== 'gl' ? ' (WebGL2 indisponible)' : '';
  return `Rendu : ${name}${fallback} · ${q}${qualitySetting === 'auto' ? ' (auto)' : ''}`;
}

/**
 * Mention de baisse automatique (P9), d'après un événement de l'hôte. `level` = niveau connu après l'événement (0 Haut, 2 Bas).
 * Seule une baisse décidée par le gouverneur (`reason` = « governor:Moyen ») donne un texte, et seulement en réglage « auto ».
 * @returns {{level:number, text:string|null}}
 */
export function qualityNotice(previous, ev, qualitySetting) {
  const m = ev && ev.type === 'quality-change' && typeof ev.reason === 'string' ? /^governor:(.+)$/.exec(ev.reason) : null;
  if (m === null) return { level: previous, text: null };
  const level = QUALITY_LABELS.indexOf(m[1]);
  if (level < 0) return { level: previous, text: null };
  const lowered = level > previous && qualitySetting === 'auto';
  return { level, text: lowered ? `Qualité réduite à « ${QUALITY_LABELS[level]} » pour garder le jeu fluide` : null };
}

/**
 * @param {Document} doc
 * @param {{store:object, onChange:(key:string, value:*)=>void, onReset:()=>void, appRoot?:HTMLElement|null, renderInfo?:()=>{backend:string, quality:number}|null, bootRenderer?:string, onReload?:()=>void}} deps
 */
export function createSettings(doc, deps) {
  const { store, onChange, onReset } = deps;
  const dlg = doc.getElementById('dlg-settings');
  const cue = watchScroll(dlg); // V12 (audit G5) : indice de défilement quand la fenêtre dépasse l'écran
  const form = doc.getElementById('settings-form');
  const appRoot = deps.appRoot || doc.getElementById('app');
  const radios = [...form.querySelectorAll('input[name="motion"]')];
  const rendererRadios = [...form.querySelectorAll('input[name="renderer"]')];
  const qualityRadios = [...form.querySelectorAll('input[name="quality"]')];
  const line = doc.getElementById('render-line');
  const pending = doc.getElementById('render-pending');
  const symbols = form.querySelector('input[name="symbols"]');
  const sound = form.querySelector('input[name="sound"]');
  const ambient = form.querySelector('input[name="ambient"]'); // V11 : musique d'ambiance de l'accueil
  const camera = form.querySelector('input[name="camera"]');
  const autohide = form.querySelector('input[name="autohide"]');
  const resetZone = doc.getElementById('reset-zone');
  const resetConfirm = doc.getElementById('reset-confirm');
  const resetQ = doc.getElementById('reset-q');
  const closeBtn = doc.getElementById('btn-settings-close');
  let opener = null;

  const CONFIRM_TEXT = 'Effacer toute la progression ? Les réglages sont gardés.';

  function sync() {
    const s = store.settings;
    for (const r of radios) r.checked = r.value === s.motion;
    symbols.checked = s.symbols;
    sound.checked = !s.muted;
    if (ambient) ambient.checked = s.ambient === true;
    camera.checked = s.camera;
    autohide.checked = s.autohide;
    for (const r of rendererRadios) r.checked = r.value === s.renderer;
    for (const r of qualityRadios) r.checked = r.value === s.quality;
    refresh();
  }

  /** Ligne d'état du rendu, et mention « prend effet au prochain lancement » : l'hôte choisit son rendu une fois, au chargement. */
  function refresh() {
    const s = store.settings;
    const info = typeof deps.renderInfo === 'function' ? deps.renderInfo() : null;
    const text = info === null ? '' : renderLine({ ...info, qualitySetting: s.quality, rendererSetting: s.renderer });
    if (line.textContent !== text) line.textContent = text; // aria-live : n'annoncer que les vrais changements
    // V9b (test final) : la ligne RELANCER garde toujours sa place (visibility) : rien ne bouge sous le pointeur quand elle apparaît, jamais RÉINITIALISER sous le curseur
    const off = deps.bootRenderer === undefined || s.renderer === deps.bootRenderer;
    pending.hidden = false;
    pending.style.visibility = off ? 'hidden' : '';
  }

  function resetConfirmUi(show) {
    resetConfirm.hidden = !show;
    resetZone.hidden = show;
    resetQ.textContent = CONFIRM_TEXT;
    const buttons = resetConfirm.querySelectorAll('button');
    for (const b of buttons) b.hidden = false;
  }

  for (const r of radios) r.addEventListener('change', () => { if (r.checked) onChange('motion', r.value); });
  symbols.addEventListener('change', () => onChange('symbols', symbols.checked));
  sound.addEventListener('change', () => onChange('muted', !sound.checked));
  if (ambient) ambient.addEventListener('change', () => onChange('ambient', ambient.checked));
  for (const [list, key] of [[rendererRadios, 'renderer'], [qualityRadios, 'quality']]) {
    for (const r of list) r.addEventListener('change', () => { if (r.checked) { onChange(key, r.value); refresh(); } });
  }
  doc.getElementById('btn-render-reload').addEventListener('click', () => { if (typeof deps.onReload === 'function') deps.onReload(); });
  camera.addEventListener('change', () => onChange('camera', camera.checked));
  autohide.addEventListener('change', () => onChange('autohide', autohide.checked));
  form.addEventListener('submit', (e) => e.preventDefault());

  doc.getElementById('btn-reset-progress').addEventListener('click', () => {
    resetConfirmUi(true);
    doc.getElementById('btn-reset-no').focus();
  });
  doc.getElementById('btn-reset-no').addEventListener('click', () => {
    resetConfirmUi(false);
    doc.getElementById('btn-reset-progress').focus();
  });
  doc.getElementById('btn-reset-yes').addEventListener('click', () => {
    onReset();
    resetConfirm.hidden = false;
    resetZone.hidden = true;
    resetQ.textContent = 'Progression effacée.';
    for (const b of resetConfirm.querySelectorAll('button')) b.hidden = true;
    closeBtn.focus();
  });
  closeBtn.addEventListener('click', () => close());

  function close() { if (dlg.open) dlg.close(); }

  dlg.addEventListener('close', () => {
    if (appRoot) appRoot.inert = false;
    resetConfirmUi(false);
    const back = opener;
    opener = null;
    if (back && doc.contains(back) && typeof back.focus === 'function') back.focus({ preventScroll: true });
    if (typeof deps.onClosed === 'function') deps.onClosed(back);
  });
  // Focus piégé : <dialog> modal laisse Tab sortir vers l'interface du navigateur ; on boucle sur les commandes de la fenêtre (U2).
  const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])';
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const list = [...dlg.querySelectorAll(FOCUSABLE)].filter((n) => !n.hidden && n.offsetParent !== null && !n.closest('[hidden]'));
    if (list.length === 0) return;
    // les boutons radio d'un même groupe ne forment qu'un arrêt : on garde celui qui est coché (ou le premier)
    const stops = list.filter((n, i) => n.type !== 'radio' || n.checked || !list.some((m) => m.type === 'radio' && m.name === n.name && m.checked) && list.findIndex((m) => m.name === n.name && m.type === 'radio') === i);
    const first = stops[0], last = stops[stops.length - 1];
    const active = doc.activeElement;
    if (e.shiftKey && (active === first || !dlg.contains(active))) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && (active === last || !dlg.contains(active))) { e.preventDefault(); first.focus(); }
  });
  // clic sur le fond (hors du panneau) : ferme
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });

  return {
    get isOpen() { return dlg.open; },
    sync,
    refresh,
    open(from = null) {
      if (dlg.open) return;
      opener = from || doc.activeElement;
      sync();
      resetConfirmUi(false);
      if (appRoot) appRoot.inert = true;
      dlg.showModal();
      cue.update();
      const checked = radios.find((r) => r.checked) || radios[0];
      checked.focus();
    },
    close,
    set onClosed(fn) { deps.onClosed = fn; },
  };
}
