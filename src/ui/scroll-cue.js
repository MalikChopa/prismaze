// V12 (audit responsive G5, B1, C3) : indice de défilement d'un panneau. Quand le contenu dépasse vers le bas, l'élément porte
// `data-more="1"` ; le CSS (index.html) montre alors un fondu et une flèche « ▾ » au bas de la partie visible. Rien d'autre n'est modifié.

/** true s'il reste du contenu caché sous le bas visible (tolérance 2 px). Pur. */
export const hasMoreBelow = (scrollHeight, clientHeight, scrollTop) => scrollHeight - clientHeight - scrollTop > 2;

/**
 * Suit un élément défilant et tient à jour son attribut `data-more`.
 * @param {HTMLElement} el
 * @returns {{update:()=>void, destroy:()=>void}}
 */
export function watchScroll(el) {
  if (!el || typeof el.addEventListener !== 'function' || !el.dataset) return { update() {}, destroy() {} }; // faux documents des tests unitaires : rien à suivre
  const update = () => {
    const more = hasMoreBelow(el.scrollHeight, el.clientHeight, el.scrollTop);
    if (more && el.dataset.more !== '1') el.dataset.more = '1';
    else if (!more && el.dataset.more !== undefined) delete el.dataset.more;
  };
  el.addEventListener('scroll', update, { passive: true });
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(update);
    ro.observe(el);
    for (const c of el.children || []) ro.observe(c);
  }
  update();
  return { update, destroy() { el.removeEventListener('scroll', update); if (ro) ro.disconnect(); } };
}
