// Longueur des liens de partage (F4) : niveaux d'exemple + niveaux aléatoires bien codables. Usage : node tests/fuzz/stats.mjs
import { readFileSync } from 'node:fs';
import { encodeLevel } from '../../src/engine/share.js';
import { makeRng, randomLevel } from './lib.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const samples = [
  { ...read('../fixtures/v2/valid/x00-exemple.json'), name: 'exemple' },
  { ...read('../fixtures/maquette-07.v2.json'), name: 'deux lumières' },
  read('../fixtures/v2/valid/test-dense.json'),
];
for (const lv of samples) console.log(JSON.stringify({ niveau: lv.name, taille: lv.size.join('x'), pieces: lv.pieces.length, longueurCode: encodeLevel(lv).length, longueurFragment: ('#l=' + encodeLevel(lv)).length }));
const rng = makeRng(2026);
for (const profile of ['small', 'big']) {
  const lens = [], pcs = [];
  for (let i = 0; i < 300; i++) { const lv = randomLevel(rng, profile); lens.push(encodeLevel(lv).length); pcs.push(lv.pieces.length); }
  const st = (a) => ({ min: Math.min(...a), moyenne: Math.round(a.reduce((x, y) => x + y, 0) / a.length), max: Math.max(...a) });
  console.log(JSON.stringify({ profil: profile, niveaux: 300, pieces: st(pcs), longueurCode: st(lens) }));
}
