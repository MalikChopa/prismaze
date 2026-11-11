// Partage (ARCHITECTURE_V2 F4, F5, F6) : adresse d'un niveau, copie dans le presse-papiers (repli : champ sélectionnable), import d'un lien,
// d'un code ou d'un brouillon JSON collé, et fenêtre modale générique (focus piégé, arrière-plan inerte, retour du focus : U2).
// Tout ce qui vient du texte collé ou de l'adresse est traité comme hostile : décodage par share.js (aucun JSON.parse sur la charge),
// brouillon JSON : JSON.parse puis liste blanche de level.js ; aucun nom n'est jamais inséré en HTML (textContent seulement).
import { parseShareCode, encodeLevel, codeFromFragment, MAX_CODE_LENGTH, FRAGMENT_PREFIX } from '../engine/share.js';
import { validateLevel, SHARED_ID } from '../engine/level.js';

/** Adresse d'un niveau : page courante (sans paramètres) + `#l=<code>`. Le fragment n'est jamais envoyé au serveur. */
export function shareUrl(loc, level) {
  return `${loc.origin}${loc.pathname}${FRAGMENT_PREFIX}${encodeLevel(level)}`;
}

/** Message (français) pour un résultat de parseShareCode refusé. `rules` : liste des règles enfreintes. */
export function shareFailureText(result) {
  if (result.reason === 'newer') return 'Lien d\'une version plus récente de Prismaze : mets le jeu à jour.';
  if (result.reason === 'rules') {
    const first = result.errors.slice(0, 2).map((e) => e.message).join(' ; ');
    return `Ce niveau enfreint les règles : ${first}.`;
  }
  return 'Lien invalide.';
}

/**
 * Texte collé -> niveau partageable. Accepte une adresse complète, un fragment `#l=...`, un code `1.xxx` ou un brouillon JSON.
 * @returns {{ok:true, level:object, via:'code'|'json'}|{ok:false, message:string}}
 */
export function parseImportText(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return { ok: false, message: 'Rien à ouvrir : colle un lien ou un code.' };
  if (text.startsWith('{')) { // brouillon JSON : JSON.parse puis liste blanche (V4) et règles de F2
    if (text.length > 20000) return { ok: false, message: 'Texte trop long.' };
    let obj;
    try { obj = JSON.parse(text); } catch { return { ok: false, message: 'JSON illisible.' }; }
    const clean = obj !== null && typeof obj === 'object' && !Array.isArray(obj) ? { ...obj, id: SHARED_ID } : obj;
    if (clean !== null && typeof clean === 'object') { delete clean.par; delete clean.solutions; } // un niveau d'atelier collé : preuves retirées (J2, ambiguïté 4)
    const v = validateLevel(clean, { mode: 'shared' });
    return v.ok ? { ok: true, level: v.level, via: 'json' } : { ok: false, message: `Brouillon refusé : ${v.errors.slice(0, 2).map((e) => e.message).join(' ; ')}.` };
  }
  let code = null;
  const hashAt = text.indexOf('#');
  if (hashAt >= 0) code = codeFromFragment(text.slice(hashAt));
  else if (text.startsWith('l=')) code = text.slice(2);
  else code = text;
  if (code === null || code.length === 0 || code.length > MAX_CODE_LENGTH) return { ok: false, message: 'Lien invalide.' };
  const r = parseShareCode(code);
  return r.ok ? { ok: true, level: r.level, via: 'code' } : { ok: false, message: shareFailureText(r) };
}

/**
 * Copie un texte dans le presse-papiers. Renvoie true si la copie a eu lieu ; false sinon (API absente, refus, erreur) :
 * l'appelant montre alors le champ sélectionnable.
 */
export async function copyText(text, nav) {
  try {
    if (!nav || !nav.clipboard || typeof nav.clipboard.writeText !== 'function') return false;
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), textarea:not([disabled]), select, [href], [tabindex]:not([tabindex="-1"])';

/**
 * Fenêtre modale <dialog> : focus piégé (Tab boucle), `#app` inerte, Échap ferme, focus rendu à l'ouvreur, clic sur le fond ferme.
 * @returns {{open:(from?:Element|null, focus?:Element|null)=>void, close:()=>void, readonly isOpen:boolean, readonly dialog:HTMLDialogElement}}
 */
export function createModal(doc, dlg, { appRoot = null, onClosed = null } = {}) {
  const root = appRoot || doc.getElementById('app');
  let opener = null;
  dlg.addEventListener('close', () => {
    if (root) root.inert = false;
    const back = opener;
    opener = null;
    if (back && doc.contains(back) && typeof back.focus === 'function') back.focus({ preventScroll: true });
    if (onClosed) onClosed(back);
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const list = [...dlg.querySelectorAll(FOCUSABLE)].filter((n) => !n.hidden && !n.closest('[hidden]') && n.offsetParent !== null);
    if (list.length === 0) return;
    const first = list[0], last = list[list.length - 1], active = doc.activeElement;
    if (e.shiftKey && (active === first || !dlg.contains(active))) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && (active === last || !dlg.contains(active))) { e.preventDefault(); first.focus(); }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  return {
    get isOpen() { return dlg.open; },
    get dialog() { return dlg; },
    open(from = null, focus = null) {
      if (dlg.open) return;
      opener = from || doc.activeElement;
      if (root) root.inert = true;
      dlg.showModal();
      const target = focus || dlg.querySelector(FOCUSABLE);
      if (target) target.focus();
    },
    close() { if (dlg.open) dlg.close(); },
  };
}
