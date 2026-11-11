// J2 : F4 (lien de partage) et F5 (entrée hostile). Le fuzz réduit est dans tests/fuzz/fuzz.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  encodeLevel, decodeShare, parseShareCode, shareFragment, codeFromFragment, ShareError, MAX_CODE_LENGTH, FRAGMENT_PREFIX,
} from '../../src/engine/share.js';
import { NAME_TABLE, normalizeName, validateLevel } from '../../src/engine/level.js';
import { makeRng, refEncode, fieldsOfLevel, codeOfFields, codeOfBits, bitsOf, crc16, randomLevel } from '../fuzz/lib.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const exemple = () => ({ ...read('../fixtures/v2/valid/x00-exemple.json'), name: 'exemple' });
const maquette = () => ({ ...read('../fixtures/maquette-07.v2.json'), name: 'deux lumières' });
const dense = () => read('../fixtures/v2/valid/test-dense.json');
const rejects = (s, code) => assert.throws(() => decodeShare(s), (e) => e instanceof ShareError && (code === undefined || e.code === code), `${String(s).slice(0, 40)} -> ${code}`);
// niveau comparé sans les champs que le lien ne transporte pas (id remplacé, par et solutions absents), pièces dans l'ordre (ligne, colonne)
const wire = (lv) => ({ format: 2, id: 'partage', name: lv.name ?? '', size: lv.size, pieces: lv.pieces.slice().sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0]) });

test('valeurs d\'or : trois niveaux d\'exemple -> code figé, identique à la réécriture de référence', () => {
  const golden = [
    [exemple(), '1.FWcUIuIYeWIwGQETkLVGQHE0JpkMkRECwOsHxdA'],
    [maquette(), '1.F20aGIovIWoYRaiIkIkYolE-4omIgMTmaJTKTIkJEPuiOFKFCQ'],
    [dense(), '1.Gex0MiQWWJIGIakIQQGEKBEoRgIhoZAsTJEjQl7E2CfbI0JkZo1Ne5tk32jkGzOGiJETKiBkWOjIR2lEVIy0NgomFSNUaqvdWyr7SyFanSYkZGzL4ZtseF303JXRu6-XbTyHbnwgTlD6kE0I4hfcGSmA5hSYlmNfmw'],
  ];
  for (const [lv, code] of golden) {
    assert.equal(encodeLevel(lv), code);
    assert.equal(refEncode(lv), code, 'la réécriture indépendante donne le même code');
    assert.deepEqual(decodeShare(code), wire(lv));
    assert.equal(encodeLevel(decodeShare(code)), code);
  }
});

test('longueur du lien sur 3 niveaux d\'exemple (limite dure 320)', (t) => {
  const stats = [exemple(), maquette(), dense()].map((lv) => [lv.name, lv.pieces.length, encodeLevel(lv).length]);
  t.diagnostic(JSON.stringify(stats));
  assert.deepEqual(stats.map((s) => s[2]), [41, 52, 164]);
  for (const s of stats) assert.ok(s[2] <= MAX_CODE_LENGTH);
});

test('aller-retour : 600 niveaux aléatoires bien codables, graines fixes, forme canonique', () => {
  const rng = makeRng(31337);
  let pieces = 0;
  for (let i = 0; i < 600; i++) {
    const lv = randomLevel(rng, i % 3 === 0 ? 'big' : 'small');
    const s = encodeLevel(lv);
    assert.ok(s.length <= MAX_CODE_LENGTH, `longueur ${s.length}`);
    const back = decodeShare(s);
    assert.deepEqual(back, wire(lv));
    assert.equal(encodeLevel(back), s);
    assert.equal(refEncode(lv), s);
    pieces += lv.pieces.length;
  }
  assert.ok(pieces > 4000);
});

test('niveau le plus long permis par F2 : 100 pièces, nom de 24 signes -> sous la limite de 320', () => {
  // 3 émetteurs, 8 cibles, 4 portes, 8 portails, le reste en miroirs fixes (3 bits de paramètres : le plus coûteux hors porte)
  const pieces = [];
  const cells = []; for (let r = 0; r < 10; r++) for (let c = 0; c < 12; c++) cells.push([c, r]);
  const take = () => cells.shift();
  for (let i = 0; i < 3; i++) pieces.push({ type: 'emitter', at: take(), dir: 'E', mask: 'RGB' });
  const targets = []; for (let i = 0; i < 8; i++) { const t = { type: 'target', at: take(), need: 'RGB' }; targets.push(t); pieces.push(t); }
  for (let i = 0; i < 4; i++) pieces.push({ type: 'gate', at: take(), link: targets[i].at.slice() });
  for (let i = 0; i < 8; i++) pieces.push({ type: 'portal', at: take(), pair: i % 4 });
  while (pieces.length < 100) pieces.push({ type: 'mirror', at: take(), o: '/', fixed: true });
  const lv = { format: 2, id: 'partage', name: 'z'.repeat(24), size: [12, 10], pieces };
  const s = encodeLevel(lv);
  assert.ok(s.length <= MAX_CODE_LENGTH && s.length > 250, `longueur ${s.length}`);
  assert.deepEqual(decodeShare(s), wire(lv));
});

test('nom : tous les signes de la table T font l\'aller-retour (64 signes, 6 bits chacun)', () => {
  const base = exemple();
  const chars = [...NAME_TABLE];
  assert.equal(chars.length, 64);
  for (let i = 0; i < chars.length; i += 24) {
    const name = chars.slice(i, i + 24).join('');
    const s = encodeLevel({ ...base, name });
    assert.equal(decodeShare(s).name, name);
    assert.equal(refEncode({ ...base, name }), s);
  }
  // la table finit par æÿ : les 62 premiers indices ne changent pas par rapport au prototype
  const e = decodeShare(encodeLevel({ ...base, name: 'æÿ' }));
  assert.equal(e.name, 'æÿ');
});

test('nom : NFC puis minuscules (V15, M7 de l\'audit 2) avant l\'encodage ; sans cela l\'encodage refuse', () => {
  const typed = 'Café Ŧ'; // clavier / collage macOS : e + accent combinant
  const base = exemple();
  assert.throws(() => encodeLevel({ ...base, name: 'Café' }), (e) => e instanceof ShareError && e.code === 'ENCODE');
  assert.throws(() => encodeLevel({ ...base, name: 'Café' }), ShareError, 'majuscule refusée : pas de normalisation silencieuse');
  const name = normalizeName('Café ÈÉÊ À ŒUF');
  assert.equal(name, 'café èéê à œuf');
  const s = encodeLevel({ ...base, name });
  assert.equal(decodeShare(s).name, 'café èéê à œuf');
  assert.equal(decodeShare(s).name, decodeShare(s).name.normalize('NFC'));
  assert.ok(typed.length > 0);
  // le décodeur ne produit jamais de forme décomposée : e + accent n'est pas dans T
  for (const n of ['abc', 'é', 'é']) {
    if (n.normalize('NFC') !== n) assert.throws(() => encodeLevel({ ...base, name: n }), ShareError);
  }
});

test('nom : 0 à 24 signes ; 25 refusé à l\'encodage et au décodage', () => {
  const base = exemple();
  assert.equal(decodeShare(encodeLevel({ ...base, name: '' })).name, '');
  assert.equal(decodeShare(encodeLevel({ ...base, name: undefined })).name, '');
  assert.throws(() => encodeLevel({ ...base, name: 'a'.repeat(25) }), ShareError);
  // longueur de nom 25 écrite à la main avec un CRC juste
  const f = fieldsOfLevel({ ...base, name: 'a'.repeat(24) });
  f[3] = [25, 5];
  f.splice(5 + 24, 0, [0, 6]);
  rejects(codeOfFields(f).code, 'BOUNDS');
});

// ---- F5 : entrée hostile -----------------------------------------------------------------------------------------

test('F5 : longueur 320 maximum contrôlée avant toute lecture', () => {
  rejects('1.' + 'A'.repeat(319), 'LENGTH');
  rejects('1.' + 'A'.repeat(5000), 'LENGTH');
  rejects('', 'LENGTH');
  rejects('1.', 'LENGTH');
  rejects('1.A', 'LENGTH');
  // 320 exactement n'est pas refusé pour sa longueur
  assert.throws(() => decodeShare('1.' + 'A'.repeat(318)), (e) => e.code !== 'LENGTH');
  for (const v of [undefined, null, 5, {}, [], ['1.AAAA'], Symbol('x'), () => '1.AAAA', { toString: () => '1.AAAA' }]) rejects(v, 'LENGTH');
});

test('F5 : préfixe `1.`, version plus récente, alphabet [A-Za-z0-9_-]', () => {
  const ok = encodeLevel(exemple());
  rejects('2' + ok.slice(1), 'NEWER');
  rejects('17.AAAAAAAA', 'NEWER');
  rejects('0.AAAAAAAA', 'PREFIX');
  rejects('01.AAAAAAAA', 'PREFIX');
  rejects('x.AAAAAAAA', 'PREFIX');
  rejects('1_AAAAAAAA', 'PREFIX');
  rejects('1,AAAAAAAA', 'PREFIX');
  rejects('１.AAAAAAAA', 'PREFIX');
  rejects('__proto__', 'PREFIX');
  rejects('constructor', 'PREFIX');
  for (const bad of ['+', '/', '=', ' ', '\n', '%', '<', 'é', '\u0000', '😀', '.']) {
    rejects(ok.slice(0, 5) + bad + ok.slice(6), 'ALPHABET');
  }
  rejects(ok + '=', 'ALPHABET');
  rejects(' ' + ok, 'PREFIX');
});

test('F5 : somme de contrôle, remplissage nul, rien après le CRC, forme canonique', () => {
  const lv = exemple();
  const { code, bodyBits } = codeOfFields(fieldsOfLevel(lv));
  assert.equal(code, encodeLevel(lv));
  assert.equal(decodeShare(code).name, 'exemple');
  rejects(codeOfFields(fieldsOfLevel(lv), { badCrc: true }).code, 'CRC');
  // un bit du corps change : CRC
  const flipped = code.slice(0, 10) + (code[10] === 'A' ? 'B' : 'A') + code.slice(11);
  assert.throws(() => decodeShare(flipped), ShareError);
  // remplissage non nul
  const total = bodyBits + 16;
  assert.notEqual(total % 6, 0, 'cet exemple a du remplissage');
  rejects(codeOfFields(fieldsOfLevel(lv), { padOnes: true }).code, 'PADDING');
  // un groupe de 6 bits en trop (même nul) : forme non canonique
  rejects(code + 'A', 'TRAILING');
  rejects(code + 'AAAAAA', 'TRAILING');
  // le même niveau avec deux CRC valides n'existe pas ; mais deux chaînes pour un niveau : refusées
  const bits = bitsOf(fieldsOfLevel(lv)); bits.push(...bitsOf([[crc16(bits), 16]]));
  assert.equal(codeOfBits(bits), code);
  rejects(codeOfBits(bits.concat([0, 0, 0, 0, 0, 0])), 'TRAILING');
});

test('F5 : bornes (taille, nombre, coordonnées, type, masque, ordre, lien) : un rejet par cas, avec CRC juste', () => {
  const lv = exemple();
  // champs découpés : en-tête (5), nom, puis un groupe [colonne, ligne, type, paramètres…] par pièce triée
  const parts = (level) => {
    const f = fieldsOfLevel(level), head = f.slice(0, 5 + level.name.length), body = f.slice(head.length), groups = [];
    const width = { 1: 2, 2: 0, 3: 1, 4: 2, 5: 2, 6: 1, 7: 2, 8: 1, 9: 1 }; // champs de paramètres par type
    for (let i = 0; i < body.length;) { const n = 3 + width[body[i + 2][0]]; groups.push(body.slice(i, i + n)); i += n; }
    return { head, groups };
  };
  const build = (level, edit) => {
    const { head, groups } = parts(level);
    edit(head, groups);
    return codeOfFields([...head, ...groups.flat()]).code;
  };
  const ofType = (groups, t) => groups.findIndex((g) => g[2][0] === t);
  assert.equal(build(lv, () => {}), encodeLevel(lv), 'le découpage est fidèle');
  rejects(build(lv, (h) => { h[0] = [2, 4]; }), 'FORMAT'); // version interne
  rejects(build(lv, (h) => { h[1] = [10, 4]; }), 'BOUNDS'); // 13 colonnes
  rejects(build(lv, (h) => { h[1] = [0, 4]; }), 'BOUNDS'); // 3 colonnes : les pièces dépassent
  rejects(build(lv, (h, g) => { g[0][0] = [15, 4]; }), 'BOUNDS'); // colonne 15
  rejects(build(lv, (h, g) => { g[0][1] = [9, 4]; }), 'BOUNDS'); // ligne 9 d'un plateau de 6
  for (const t of [0, 10, 15]) rejects(build(lv, (h, g) => { g[0][2] = [t, 4]; }), 'TYPE');
  rejects(build(lv, (h, g) => { g[ofType(g, 1)][4] = [0, 3]; }), 'MASK'); // émetteur de masque 0
  rejects(build(lv, (h, g) => { g[ofType(g, 3)][3] = [0, 3]; }), 'MASK'); // cible sans besoin
  rejects(build(lv, (h, g) => { [g[0], g[1]] = [g[1], g[0]]; }), 'ORDER'); // ordre décroissant
  rejects(build(lv, (h, g) => { g[1][0] = g[0][0]; g[1][1] = g[0][1]; }), 'ORDER'); // même case
  const rankField = (g) => g[ofType(g, 9)][3];
  const gate = build(lv, (h, g) => { rankField(g)[0] = 1; });
  assert.equal(decodeShare(gate).pieces.find((p) => p.type === 'gate').link.join(), '7,1', 'rang 1 = deuxième cible triée');
  rejects(build(lv, (h, g) => { rankField(g)[0] = 2; }), 'LINK'); // 2 cibles : rangs 0 et 1
  rejects(build(lv, (h, g) => { rankField(g)[0] = 63; }), 'LINK');
  // filtre de masque 0 ou 7
  const withFilter = { ...lv, pieces: [...lv.pieces, { type: 'filter', at: [7, 4], mask: 'RG' }] };
  assert.equal(build(withFilter, () => {}), encodeLevel(withFilter));
  for (const m of [0, 7]) rejects(build(withFilter, (h, g) => { g[ofType(g, 7)][3] = [m, 3]; }), 'MASK');
  // nom : longueur 25
  rejects(build(lv, (h) => { h[3] = [25, 5]; }), 'BOUNDS');
  // 101 pièces annoncées
  rejects(build(lv, (h) => { h[4] = [101, 7]; }), 'BOUNDS');
  // fin de données au milieu d'une pièce, ou compte annoncé trop grand
  rejects(build(lv, (h, g) => { g.length = 3; g[2] = g[2].slice(0, 2); }));
  rejects(build(lv, (h) => { h[4] = [lv.pieces.length + 1, 7]; }));
  // moins de pièces annoncées que de pièces écrites : le reste est pris pour le CRC et refusé
  assert.throws(() => decodeShare(build(lv, (h) => { h[4] = [lv.pieces.length - 1, 7]; })), ShareError);
});

test('F5 : décodage -> objets littéraux sans clé venue de l\'entrée ; pas de pollution de prototype', () => {
  const before = Object.getOwnPropertyNames(Object.prototype).sort().join();
  const lv = decodeShare(encodeLevel(dense()));
  const keys = new Set();
  for (const p of lv.pieces) for (const k of Object.keys(p)) keys.add(k);
  assert.deepEqual([...keys].sort(), ['at', 'dir', 'fixed', 'link', 'mask', 'need', 'o', 'pair', 'type']);
  assert.deepEqual(Object.keys(lv), ['format', 'id', 'name', 'size', 'pieces']);
  for (const s of ['__proto__', 'constructor', 'prototype', '1.__proto__', '1.constructor', '1.prototype', '1.__proto__AAAAAAAA']) rejects(s);
  // un nom qui ressemble à une clé dangereuse reste du texte : « __proto__ » est refusé (le « _ » n'est pas dans T)
  assert.throws(() => encodeLevel({ ...exemple(), name: '__proto__' }), ShareError);
  const named = decodeShare(encodeLevel({ ...exemple(), name: 'constructor' }));
  assert.equal(named.name, 'constructor');
  assert.equal(Object.prototype.hasOwnProperty.call(named, 'constructor'), false);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getOwnPropertyNames(Object.prototype).sort().join(), before);
  // encodeLevel d'un objet hostile (clés dangereuses, types étranges) : erreur d'encodage, jamais autre chose
  const hostile = JSON.parse('{"size":[8,6],"name":"","pieces":[{"type":"__proto__","at":[0,0]},{"type":"constructor","at":[1,0]}],"__proto__":{"polluted":1}}');
  assert.throws(() => encodeLevel(hostile), (e) => e instanceof ShareError && e.code === 'ENCODE');
  for (const bad of [null, undefined, 5, 'x', [], {}, { size: [8, 6], pieces: 'x' }, { size: [8, 6], pieces: [null] }, { size: [8, 6], pieces: [{ type: 'wall' }] },
    { size: [8, 6], pieces: [{ type: 'wall', at: [8, 0] }] }, { size: [8, 6], pieces: [{ type: 'wall', at: [0, 0] }, { type: 'wall', at: [0, 0] }] },
    { size: [8.5, 6], pieces: [] }, { size: [2, 6], pieces: [] }, { size: [13, 6], pieces: [] }]) {
    assert.throws(() => encodeLevel(bad), (e) => e instanceof ShareError && e.code === 'ENCODE');
  }
  assert.equal(({}).polluted, undefined);
});

test('encodeLevel : n\'écrit ni id, ni par, ni solutions ; trie les pièces ; masques lus dans n\'importe quel ordre, relus en RGB', () => {
  const a = exemple();
  const b = { ...exemple(), id: 'autre-id', par: 7, solutions: [], pieces: a.pieces.slice().reverse() };
  assert.equal(encodeLevel(a), encodeLevel(b));
  const c = { ...exemple(), pieces: a.pieces.map((p) => (p.type === 'emitter' ? { ...p, mask: 'BGR' } : p)) };
  assert.equal(encodeLevel(c), encodeLevel(a));
  assert.equal(decodeShare(encodeLevel(c)).pieces.find((p) => p.type === 'emitter').mask, 'RGB');
});

test('fragment d\'URL : #l=1.<charge> ; longueur contrôlée avant lecture ; autres fragments ignorés', () => {
  const lv = exemple();
  const frag = shareFragment(lv);
  assert.equal(frag, FRAGMENT_PREFIX + encodeLevel(lv));
  assert.ok(frag.startsWith('#l=1.'));
  assert.equal(codeFromFragment(frag), encodeLevel(lv));
  for (const h of ['', '#', '#x=1.AAAA', '#L=1.AAAA', 'l=1.AAAA', undefined, null, 5, '#l=1.' + 'A'.repeat(400)]) assert.equal(codeFromFragment(h), null, String(h).slice(0, 20));
  assert.equal(codeFromFragment('#l=' + '1.' + 'A'.repeat(318)).length, 320);
});

test('parseShareCode : valide complètement (mode shared) ; jamais d\'exception ; raison sans détail', () => {
  const good = parseShareCode(encodeLevel(exemple()));
  assert.equal(good.ok, true);
  assert.equal(good.level.id, 'partage');
  assert.equal(good.level.name, 'exemple');
  assert.deepEqual(validateLevel(good.level, { mode: 'shared' }).errors, []);
  assert.equal(parseShareCode(encodeLevel(dense())).ok, true);
  const newer = parseShareCode('2.AAAAAAAAAA');
  assert.deepEqual([newer.ok, newer.reason], [false, 'newer']);
  for (const s of ['n\'importe quoi', '1.AAAA', null, undefined, 5, '__proto__', '1.' + '_'.repeat(400)]) {
    const r = parseShareCode(s);
    assert.deepEqual([r.ok, r.reason, r.level], [false, 'invalid', null]);
  }
  // bien codé mais contraire aux règles : 0 émetteur (V6), niveau déjà gagné (V10)
  const noEmitter = { ...exemple(), pieces: exemple().pieces.filter((p) => p.type !== 'emitter') };
  const r1 = parseShareCode(encodeLevel(noEmitter));
  assert.deepEqual([r1.ok, r1.reason], [false, 'rules']);
  assert.ok(r1.errors.some((e) => e.code === 'V6_EMITTER_COUNT'));
  const won = { ...exemple(), pieces: [...exemple().pieces, { type: 'mirror', at: [2, 0], o: '/', fixed: true }] };
  const r2 = parseShareCode(encodeLevel(won));
  assert.ok(r2.errors.some((e) => e.code === 'V10_ALREADY_WON'));
});
