// Fuzz du codec de partage (F5) : chaînes hostiles -> aucune exception hors rejet prévu, aucune acceptation non canonique.
// Ce fichier n'est pas un test : `fuzz.test.mjs` en lance une version réduite, `run.mjs` la version complète (400 000).
import { decodeShare, encodeLevel, parseShareCode, ShareError, MAX_CODE_LENGTH } from '../../src/engine/share.js';
import { validateLevel } from '../../src/engine/level.js';
import { makeRng, B64, randomLevel, refEncode, fieldsOfLevel, codeOfFields, randomHostileFields, perturbFields } from './lib.mjs';

export const SPECIAL = [
  '__proto__', 'constructor', 'prototype', '1.__proto__', '1.constructor', '1.' + '_'.repeat(5000), '', '1.', '1', '1.A', '2.AAAA', '9999.AAAA',
  '1.<script>', '1.%00', '\u0000', '1.\u0000\u0000\u0000\u0000', '1.é́é́', '１.AAAAAA', '1.AAAAAAAA\ud800', '1.😀😀😀😀', ' 1.AAAAAA', '1.AAAAAA ', '1.AAAA\nAAAA',
  '1.' + 'A'.repeat(318), '1.' + 'A'.repeat(319), '1.' + '_'.repeat(318), '0.AAAAAA', '-1.AAAA', '01.AAAAAA', '1..AAAAA', '1.AAAA=', '1.AAAA==',
];

/**
 * @param {{count:number, seed:number}} opts
 * @returns le rapport (compteurs par famille, rejets par code, exceptions inattendues, acceptations non canoniques)
 */
export function runFuzz({ count, seed }) {
  const rng = makeRng(seed);
  const protoNamesBefore = Object.getOwnPropertyNames(Object.prototype).sort().join(',');
  const seedLevels = [];
  const seedCodes = [];
  const seedFields = [];
  for (let i = 0; i < 60; i++) {
    const lv = randomLevel(rng, i % 2 ? 'big' : 'small');
    seedLevels.push(lv); seedCodes.push(refEncode(lv)); seedFields.push(fieldsOfLevel(lv));
  }
  const rep = { seed, chaines: 0, acceptees: 0, rejetees: 0, exceptionsInattendues: 0, acceptees_non_canoniques: 0, encodeurDifferent: 0, rejetsParCode: {}, parFamille: {}, exemplesProblemes: [] };
  const fam = (name) => (rep.parFamille[name] ??= { chaines: 0, acceptees: 0 });
  const problem = (kind, s, e) => { if (rep.exemplesProblemes.length < 5) rep.exemplesProblemes.push({ kind, s: String(s).slice(0, 120), e: String(e) }); };

  const tryDecode = (s, family) => {
    rep.chaines++;
    const f = fam(family); f.chaines++;
    let level;
    try {
      level = decodeShare(s);
    } catch (e) {
      if (e instanceof ShareError) { rep.rejetees++; rep.rejetsParCode[e.code] = (rep.rejetsParCode[e.code] || 0) + 1; return; }
      rep.exceptionsInattendues++; problem('exception-decode', s, e); return;
    }
    rep.acceptees++; f.acceptees++;
    if (s.length > MAX_CODE_LENGTH) { rep.acceptees_non_canoniques++; problem('trop-long-accepte', s, ''); }
    try {
      if (encodeLevel(level) !== s) { rep.acceptees_non_canoniques++; problem('non-canonique', s, ''); }
    } catch (e) { rep.acceptees_non_canoniques++; problem('re-encodage-impossible', s, e); }
    try { validateLevel(level, { mode: 'shared' }); parseShareCode(s); } catch (e) { rep.exceptionsInattendues++; problem('exception-validation', s, e); }
  };

  const rc = () => B64[rng.int(64)];
  for (let i = 0; i < count; i++) {
    const kind = i % 8;
    let s;
    if (kind === 0) { // chaîne aléatoire
      const len = 2 + rng.int(MAX_CODE_LENGTH + 20); s = '1.'; for (let k = 2; k < len; k++) s += rc();
      tryDecode(s, 'aleatoire');
    } else if (kind === 1) { // code valide, 1 à 3 caractères changés
      const base = rng.pick(seedCodes).split(''); const m = 1 + rng.int(3);
      for (let k = 0; k < m; k++) base[2 + rng.int(base.length - 2)] = rc();
      tryDecode(base.join(''), 'mute');
    } else if (kind === 2) { // code valide tronqué
      const base = rng.pick(seedCodes); tryDecode(base.slice(0, rng.int(base.length)), 'tronque');
    } else if (kind === 3) { // code valide suivi de caractères
      const base = rng.pick(seedCodes); tryDecode(base + rc().repeat(1 + rng.int(8)), 'allonge');
    } else if (kind === 4) { // flux entièrement tiré au hasard, CRC juste
      const o = rng.int(10);
      const { code } = codeOfFields(randomHostileFields(rng), { padOnes: o === 0, badCrc: o === 1 });
      tryDecode(o === 2 ? code + 'A' : o === 3 ? code + 'AAAAAA'.slice(0, 1 + rng.int(6)) : code, 'hostile-crc-juste');
    } else if (kind === 5) { // niveau valide dont un champ est changé, CRC juste
      const { code } = codeOfFields(perturbFields(rng, rng.pick(seedFields)));
      tryDecode(code, 'champ-change-crc-juste');
    } else if (kind === 6) { // niveau valide, remplissage ou longueur anormaux
      const o = rng.int(4);
      const { code } = codeOfFields(rng.pick(seedFields), { padOnes: o === 0, badCrc: o === 1 });
      tryDecode(o === 2 ? code + 'A' : o === 3 ? '2' + code.slice(1) : code, 'remplissage-longueur');
    } else { // niveau valide : doit être accepté, canonique, identique à l'encodeur de référence
      const lv = rng.pick(seedLevels), code = rng.pick(seedCodes);
      let encoded = '';
      try { encoded = encodeLevel(lv); } catch (e) { rep.exceptionsInattendues++; problem('exception-encode', JSON.stringify(lv).slice(0, 80), e); }
      if (encoded !== refEncode(lv)) { rep.encodeurDifferent++; problem('encodeur-different', encoded, ''); }
      tryDecode(code, 'valide');
    }
  }
  for (const s of SPECIAL) tryDecode(s, 'speciaux');
  for (const v of [undefined, null, 0, 1, {}, [], ['1.AAAA'], { toString() { return '1.AAAA'; } }, Symbol.iterator]) {
    rep.chaines++;
    try { decodeShare(v); rep.acceptees++; problem('non-chaine-acceptee', String(typeof v), ''); } catch (e) {
      if (e instanceof ShareError) rep.rejetees++; else { rep.exceptionsInattendues++; problem('exception-non-chaine', typeof v, e); }
    }
  }
  rep.prototypeIntact = Object.getOwnPropertyNames(Object.prototype).sort().join(',') === protoNamesBefore && ({}).polluted === undefined;
  return rep;
}
