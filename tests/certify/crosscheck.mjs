// Comparaison certificateur / force brute sur des niveaux aleatoires PETITS. `mod` = le module du certificateur (le vrai, ou un mutant
// copie dans docs/certif/mut/ pour verifier que ces tests ont de la puissance).
import { bruteForce, genSmallLevel, mkRng } from './helpers.mjs';

export function crossCheck(mod, seed, n, genOpts = {}) {
  const rnd = mkRng(seed);
  const st = { n: 0, solvable: 0, unsolvable: 0, minHist: {}, disagreements: [], gateLevels: 0, portalLevels: 0, twoEm: 0, types: {}, garageSensitive: 0 };
  for (let i = 0; i < n; i++) {
    const level = genSmallLevel(rnd, genOpts);
    st.n++;
    if (level.pieces.some((p) => p.type === 'gate')) st.gateLevels++;
    if (level.pieces.some((p) => p.type === 'portal')) st.portalLevels++;
    if (level.pieces.filter((p) => p.type === 'emitter').length > 1) st.twoEm++;
    for (const p of level.pieces) if (['mirror', 'splitter', 'prism', 'filter'].includes(p.type) && !p.fixed) st.types[p.type] = (st.types[p.type] ?? 0) + 1;
    const brute = bruteForce(level);
    const ctx = mod.makeContext(level);
    const fm = mod.findMinimum(ctx);
    if (!fm.complete) { st.disagreements.push({ why: 'recherche incomplete', level }); continue; }
    if (fm.minimum !== brute.minimum) { st.disagreements.push({ why: `minimum certificateur ${fm.minimum} != force brute ${brute.minimum}`, level }); continue; }
    if (brute.minimum === null) { st.unsolvable++; continue; }
    st.solvable++; st.minHist[brute.minimum] = (st.minHist[brute.minimum] ?? 0) + 1;
    const m = brute.minimum;
    if (m === 0) continue; // minimum 0 : valide pour le moteur mais jamais un `par` (V14 : par >= 1)
    const sol = [mod.placementsToJson(ctx, fm.witness.used)];
    const lv = { ...level, par: m, solutions: sol };
    if (m < ctx.K) { /* garage possible ou non : deja pris en compte par la force brute */ }
    // par juste : confirme (temoin rejoue) ; par trop haut : refute ; par trop bas : temoin KO (aucune victoire a ce score)
    const a = mod.certifyLevel(lv);
    if (a.status !== 'confirmé') st.disagreements.push({ why: `par juste ${m} : statut ${a.status} (${a.reason})`, level: lv });
    if (m + 1 <= ctx.K) {
      const b = mod.certifyLevel({ ...lv, par: m + 1 });
      if (b.status !== 'réfuté') st.disagreements.push({ why: `par ${m + 1} trop haut : statut ${b.status}`, level: lv });
    }
    if (m - 1 >= 1) {
      const c = mod.certifyLevel({ ...lv, par: m - 1 });
      if (c.status !== 'témoin KO') st.disagreements.push({ why: `par ${m - 1} trop bas : statut ${c.status}`, level: lv });
    }
    // la force brute voit-elle un score minimal plus eleve que le minimum « relache » ? (garage serre) : on compte les niveaux K > m
    if (ctx.K > m) st.garageSensitive++;
  }
  return st;
}
