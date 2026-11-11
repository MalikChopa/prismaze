// Petits niveaux faits a la main, un par type de piece, avec le minimum attendu (raisonne a la main, puis recoupe par la force brute)
// et le nombre de victoires a exactement `par` (ensembles de pieces utilisees, garage possible).
import { bruteForce } from './helpers.mjs';

const BS = String.fromCharCode(92); // le caractere "\" (orientation de miroir)
const E = (at, dir, mask = 'RGB') => ({ type: 'emitter', at, dir, mask });
const T = (at, need = 'RGB') => ({ type: 'target', at, need });
const W = (at) => ({ type: 'wall', at });
const M = (at, o) => ({ type: 'mirror', at, o });

export const HANDMADE = [
  { name: 'miroir : un miroir en (4,0) renvoie le faisceau vers la cible',
    level: { format: 2, id: 'hm-mirror', name: 'hm', size: [5, 4], pieces: [E([0, 0], 'E'), T([4, 3]), M([1, 3], '-'), M([2, 3], '-')] },
    minimum: 1, count: 1, witness: [{ type: 'mirror', at: [4, 0], o: '\\' }] },
  { name: 'separateur : un separateur alimente deux cibles',
    level: { format: 2, id: 'hm-splitter', name: 'hm', size: [5, 4], pieces: [E([0, 1], 'E'), T([4, 1]), T([2, 3]), { type: 'splitter', at: [0, 3], o: '/' }, M([0, 2], '-')] },
    minimum: 1, count: 1, witness: [{ type: 'splitter', at: [2, 1], o: '\\' }] },
  { name: 'prisme : la lumiere blanche est separee en trois cibles',
    level: { format: 2, id: 'hm-prism', name: 'hm', size: [5, 3], pieces: [E([0, 1], 'E'), T([2, 0], 'R'), T([4, 1], 'G'), T([2, 2], 'B'), { type: 'prism', at: [3, 2] }] },
    minimum: 1, count: 1, witness: [{ type: 'prism', at: [2, 1] }] },
  { name: 'filtre : un filtre RG retire le bleu avant la cible',
    level: { format: 2, id: 'hm-filter', name: 'hm', size: [5, 3], pieces: [E([0, 1], 'E'), T([4, 1], 'RG'), { type: 'filter', at: [2, 2], mask: 'RG' }] },
    minimum: 1, count: 3, witness: [{ type: 'filter', at: [1, 1], mask: 'RG' }] }, // 3 cases possibles sur la ligne (1,1) (2,1) (3,1)
  { name: 'portail : le miroir envoie la lumiere dans le portail, la cible est de l autre cote',
    level: { format: 2, id: 'hm-portal', name: 'hm', size: [5, 3], pieces: [E([0, 1], 'E'), { type: 'portal', at: [2, 0], pair: 0 }, { type: 'portal', at: [4, 2], pair: 0 }, T([4, 0]), W([3, 1]), M([0, 2], '-'), M([1, 2], '-')] },
    minimum: 1, count: 1, witness: [{ type: 'mirror', at: [2, 1], o: '/' }] },
  { name: 'porte : la cible liee n est allumee que par un miroir, elle ouvre le passage du second emetteur',
    level: { format: 2, id: 'hm-gate', name: 'hm', size: [5, 4], pieces: [E([0, 0], 'E'), E([0, 3], 'E'), T([2, 2]), T([4, 3]), { type: 'gate', at: [2, 3], link: [2, 2] }, M([4, 1], '-'), M([3, 1], '-')] },
    minimum: 1, count: 1, witness: [{ type: 'mirror', at: [2, 0], o: '\\' }] },
  { name: 'deux emetteurs : le rouge et le bleu doivent converger sur la cible RB (deux miroirs)',
    level: { format: 2, id: 'hm-two', name: 'hm', size: [5, 3], pieces: [E([0, 0], 'E', 'R'), E([0, 2], 'E', 'B'), T([4, 1], 'RB'), M([1, 1], '-'), M([2, 1], '-')] },
    minimum: 2, count: 1, witness: [{ type: 'mirror', at: [4, 0], o: '\\' }, { type: 'mirror', at: [4, 2], o: '/' }] },
  { name: 'mixte : miroir puis prisme (le prisme n agit qu apres le miroir : ordre de derivation)',
    level: { format: 2, id: 'hm-mixed', name: 'hm', size: [5, 4], pieces: [E([0, 0], 'E'), T([4, 2], 'R'), T([3, 3], 'G'), T([2, 2], 'B'), M([4, 3], '-'), { type: 'prism', at: [0, 3] }] },
    minimum: 2, count: 1, witness: [{ type: 'mirror', at: [3, 0], o: '\\' }, { type: 'prism', at: [3, 2] }] },
  { name: 'filtre bloqueur : un filtre G arrete le rouge (il absorbe tout ce qui lui arrive)',
    level: { format: 2, id: 'hm-block', name: 'hm', size: [5, 3], pieces: [E([0, 2], 'E', 'G'), E([4, 0], 'S', 'R'), T([4, 2], 'G'), { type: 'filter', at: [0, 0], mask: 'G' }] },
    minimum: 1, count: 1, witness: [{ type: 'filter', at: [4, 1], mask: 'G' }] },
  { name: 'chaine de trois miroirs (murs en (2,0) et (2,3)) : deux solutions',
    level: { format: 2, id: 'hm-chain', name: 'hm', size: [5, 4], pieces: [E([0, 0], 'E'), W([2, 0]), W([2, 3]), T([3, 3]), M([4, 0], '-'), M([4, 1], '-'), M([4, 2], '-')] },
    minimum: 3, count: 2, witness: [{ type: 'mirror', at: [1, 0], o: BS }, { type: 'mirror', at: [1, 1], o: BS }, { type: 'mirror', at: [3, 1], o: BS }] },
  { name: 'inventaire : la meme chaine avec 2 miroirs seulement (+ un filtre inutile) est insoluble',
    level: { format: 2, id: 'hm-inv', name: 'hm', size: [5, 4], pieces: [E([0, 0], 'E'), W([2, 0]), W([2, 3]), T([3, 3]), M([4, 0], '-'), M([4, 1], '-'), { type: 'filter', at: [4, 2], mask: 'RG' }] },
    unsolvable: true },
  { name: 'garage : un miroir suffirait mais le prisme en trop ne tient nulle part (2 cases libres, toutes eclairees) : insoluble',
    level: { format: 2, id: 'hm-garage', name: 'hm', size: [3, 2], pieces: [E([0, 0], 'E'), W([0, 1]), W([1, 1]), T([2, 1]), M([1, 0], '-'), { type: 'prism', at: [2, 0] }] },
    unsolvable: true },
];

/** Verifie les niveaux faits a la main contre le certificateur `mod` ; renvoie la liste des ecarts (vide = tout va bien). */
export function runHandmade(mod, { withCount = true } = {}) {
  const bad = [];
  for (const h of HANDMADE) {
    const brute = bruteForce(h.level);
    if (h.unsolvable) {
      const ctx0 = mod.makeContext(h.level);
      const f0 = mod.findMinimum(ctx0);
      if (brute.minimum !== null) bad.push(`${h.name} : la force brute trouve ${brute.minimum} (le niveau de test est faux)`);
      else if (f0.minimum !== null || !f0.complete) bad.push(`${h.name} : certificateur ${f0.minimum} (complete ${f0.complete}), attendu insoluble`);
      continue;
    }
    if (h.minimum !== null && brute.minimum !== h.minimum) { bad.push(`${h.name} : force brute ${brute.minimum} != attendu ${h.minimum} (le niveau de test est faux)`); continue; }
    const m = brute.minimum;
    if (m === null || m < 1) { bad.push(`${h.name} : pas de minimum >= 1 (${m})`); continue; }
    const ctx = mod.makeContext(h.level);
    const fm = mod.findMinimum(ctx);
    if (fm.minimum !== m) { bad.push(`${h.name} : certificateur ${fm.minimum} != ${m}`); continue; }
    const lv = { ...h.level, par: m, solutions: [mod.placementsToJson(ctx, fm.witness.used)] };
    const a = mod.certifyLevel(lv, null, { countPar: withCount });
    if (a.status !== 'confirmé') bad.push(`${h.name} : par juste ${m} -> ${a.status} (${a.reason})`);
    if (withCount && h.count !== undefined && a.countPar?.count !== h.count) bad.push(`${h.name} : victoires a par ${a.countPar?.count} != ${h.count}`);
    if (m + 1 <= ctx.K) { const b = mod.certifyLevel({ ...lv, par: m + 1 }); if (b.status !== 'réfuté') bad.push(`${h.name} : par ${m + 1} (trop haut) -> ${b.status}`); else if (!b.refutation || b.refutation.used !== m) bad.push(`${h.name} : refutation sans la configuration attendue`); }
    if (m >= 2) { const c = mod.certifyLevel({ ...lv, par: m - 1 }); if (c.status !== 'témoin KO') bad.push(`${h.name} : par ${m - 1} (trop bas) -> ${c.status}`); }
    if (h.name.startsWith('miroir :')) { // un temoin gagnant mais NON minimal (2 miroirs utilises, par = 1) doit etre refuse
      const w2 = [{ type: 'mirror', at: [2, 0], o: BS }, { type: 'mirror', at: [2, 3], o: BS }];
      const d = mod.certifyLevel({ ...h.level, par: 1, solutions: [w2] });
      if (d.status !== 'témoin KO') bad.push(`${h.name} : temoin non minimal accepte (${d.status})`);
      const d2 = mod.certifyLevel({ ...h.level, par: 1, solutions: [] }, { witness: w2, parking: [] }); // meme chose par le fichier de preuve
      if (d2.status !== 'témoin KO') bad.push(`${h.name} : temoin de preuve non minimal accepte (${d2.status})`);
    }
    if (h.witness) { // le temoin ecrit a la main gagne avec `m` pieces utilisees (rejeu par le moteur, garage compris)
      const pl = mod.placementsFromJson(ctx, h.witness);
      const g = pl && mod.findGarage(ctx, pl);
      const r = g && mod.replayPlacements(ctx, pl.concat(g));
      if (!r || !r.ok || r.used !== m) bad.push(`${h.name} : temoin a la main non rejoue (${JSON.stringify(r)})`);
    }
  }
  return bad;
}
