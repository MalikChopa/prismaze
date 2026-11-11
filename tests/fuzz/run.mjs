// Fuzz complet du codec de partage. Usage : node tests/fuzz/run.mjs [nombre=400000] [graine=2026]
// Code de sortie 0 seulement si : 0 exception inattendue, 0 acceptation non canonique, prototype intact.
import { runFuzz } from './fuzz.mjs';

const count = Number(process.argv[2] ?? 400000);
const seed = Number(process.argv[3] ?? 2026);
const t0 = Date.now();
const rep = runFuzz({ count, seed });
rep.dureeMs = Date.now() - t0;
console.log(JSON.stringify(rep, null, 1));
process.exit(rep.exceptionsInattendues === 0 && rep.acceptees_non_canoniques === 0 && rep.encodeurDifferent === 0 && rep.prototypeIntact ? 0 : 1);
