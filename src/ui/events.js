// Événements sonores et visuels d'une commande (ARCHITECTURE_V2 U6/U7) : on compare deux résumés de tracé (avant / après).
// Fonctions pures : aucun DOM, aucun son. L'appelant joue les sons et déclenche les effets.

const popcount = (m) => ((m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1));

/**
 * Résumé du tracé utile aux événements.
 * @param {object} state  état (engine/state.js)
 * @param {object} result  résultat de trace()
 * @returns {{lit:boolean[], needs:number[], open:boolean[], portals:boolean[], prisms:boolean[]}}
 */
export function summarize(state, result) {
  const lit = result.targets.map((t) => t.lit === true);
  const needs = result.targets.map((t) => t.need);
  const open = result.gates.map((g) => g.open === true);
  const portals = [], prisms = [];
  for (const p of state.pieces) {
    if (p.type !== 'portal' && p.type !== 'prism') continue;
    const b = (p.r * state.cols + p.c) * 4;
    const reached = (result.in[b] | result.in[b + 1] | result.in[b + 2] | result.in[b + 3]) !== 0;
    (p.type === 'portal' ? portals : prisms).push(reached);
  }
  return { lit, needs, open, portals, prisms };
}

const same = (a, b) => a.length === b.length;

/**
 * Événements entre deux résumés, dans l'ordre où ils se jouent :
 * `{name:'light'|'merge', arg:masque}` pour chaque cible allumée (mélange = fusion), `lost` (une fois), `gate`, `portal`, `prism`.
 * Deux résumés de niveaux différents (longueurs différentes) : aucun événement.
 */
export function diffEvents(prev, next) {
  const out = [];
  if (prev === null || !same(prev.lit, next.lit) || !same(prev.open, next.open) || !same(prev.portals, next.portals) || !same(prev.prisms, next.prisms)) return out;
  let lost = false;
  for (let i = 0; i < next.lit.length; i++) {
    if (next.lit[i] && !prev.lit[i]) out.push({ name: popcount(next.needs[i]) > 1 ? 'merge' : 'light', arg: next.needs[i] });
    else if (!next.lit[i] && prev.lit[i]) lost = true;
  }
  if (lost) out.push({ name: 'lost' });
  for (let i = 0; i < next.open.length; i++) if (next.open[i] && !prev.open[i]) { out.push({ name: 'gate' }); break; }
  for (let i = 0; i < next.portals.length; i++) if (next.portals[i] && !prev.portals[i]) { out.push({ name: 'portal' }); break; }
  for (let i = 0; i < next.prisms.length; i++) if (next.prisms[i] && !prev.prisms[i]) { out.push({ name: 'prism' }); break; }
  return out;
}
