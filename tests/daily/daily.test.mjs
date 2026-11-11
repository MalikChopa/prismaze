// Défi du jour (ARCHITECTURE_V2 F7 : Q1 à Q9) : PRNG, dates, profils, plafond cumulé, repli forcé, empreintes d'or, pool de repli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import {
  fnv1a32, makeRng, generateDaily, addDays, weekdayOf, isValidDay, dailyVersion, dailyPoolId, WEEKDAY, DAILY_VERSIONS, CURRENT_DAILY_VERSION,
  DAILY_ATTEMPT_CAP, DAILY_CUMUL_CAP, DAILY_MAX_ATTEMPTS,
} from '../../src/engine/daily.js';
import { parseShareCode, encodeLevel } from '../../src/engine/share.js';
import { validateLevel, replayPlacements } from '../../src/engine/level.js';
import { solve } from '../../src/engine/solver.js';

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const GOLDEN = read('./golden.json');

test('Q2 : vecteurs du texte (graine, 5 sorties, int(10)) retrouvés par le code de production', () => {
  const seed = fnv1a32('prismaze-daily-v1:2026-11-08:0');
  assert.equal(seed, 4097530856);
  const a = makeRng(seed);
  assert.deepEqual([a.u32(), a.u32(), a.u32(), a.u32(), a.u32()], [2898564557, 2971948310, 3634595666, 211298323, 1361156425]);
  const b = makeRng(seed);
  assert.deepEqual([b.int(10), b.int(10), b.int(10), b.int(10), b.int(10)], [6, 6, 8, 0, 3]);
  assert.equal(fnv1a32(''), 0x811c9dc5);
  assert.equal(fnv1a32('a'), 0xe40c292c, 'FNV-1a 32 bits de « a » (valeur publiée)');
});

test('Q1 : dates en arithmétique entière = calendrier UTC (1 500 dates), jour de semaine 0 = dimanche', () => {
  let d = '2024-02-27';
  for (let i = 0; i < 1500; i++) {
    const ref = new Date(Date.UTC(2024, 1, 27 + i));
    assert.equal(d, ref.toISOString().slice(0, 10));
    assert.equal(weekdayOf(d), ref.getUTCDay(), d);
    assert.equal(addDays('2024-02-27', i), d);
    d = addDays(d, 1);
  }
  assert.equal(weekdayOf('2026-11-08'), 0);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(isValidDay('2028-02-29'), true);
  assert.equal(isValidDay('2027-02-29'), false);
  for (const bad of ['2026-13-01', '2026-00-10', '2026-1-1', '', 'abc', 20261108, null, '2026-11-08x', '1969-12-31']) assert.equal(isValidDay(bad), false, String(bad));
  assert.throws(() => generateDaily('pas une date'), RangeError);
});

test('Q4 : les 7 profils (taille, inventaire, cibles, murs, minimum exigé)', () => {
  const sig = (p) => `${p.cols}x${p.rows} ${p.inv.map((x) => (x.type === 'mirror' ? 'M' : x.type === 'prism' ? 'P' : x.type === 'splitter' ? 'S' : `F${x.mask}`)).join('')} t${p.targets.join('-')} w${p.walls} g${p.gates} q${p.portalPairs} min${p.mMin} e${p.emitters.join(',')}`;
  assert.deepEqual(WEEKDAY.map(sig), [
    '10x8 MMMPSF6 t3-4 w8 g1 q0 min4 e7', '7x6 MMM t1-2 w4 g0 q0 min2 e7', '8x6 MMMP t2-3 w5 g0 q0 min2 e7', '8x7 MMMPF3 t2-3 w6 g0 q0 min3 e7',
    '9x7 MMMSP t2-4 w7 g1 q0 min3 e7', '10x8 MMMPSF5 t3-4 w8 g0 q0 min4 e7', '10x8 MMMPSF3 t3-5 w8 g1 q1 min4 e7',
  ]);
  assert.equal(WEEKDAY.length, 7);
  assert.equal(DAILY_ATTEMPT_CAP, 600000);
  assert.equal(DAILY_CUMUL_CAP, 3000000);
  assert.equal(DAILY_MAX_ATTEMPTS, 40);
});

test('Q9 : table des versions lue par la date (une seule version exécutable : la dernière)', () => {
  assert.deepEqual(DAILY_VERSIONS.map((r) => r.v), [1]);
  assert.equal(CURRENT_DAILY_VERSION, 1);
  assert.equal(dailyVersion('2026-11-08'), 1);
  assert.equal(dailyVersion('2030-01-01'), 1);
  assert.equal(dailyVersion('2026-01-01'), 1, 'avant la première ligne : la première');
  // la version entre dans la graine : v2 donne un autre niveau pour la même date
  const a = generateDaily('2026-11-09');
  const b = generateDaily('2026-11-09', { version: 2 });
  assert.notEqual(a.code, b.code);
});

test('Q6 : 30 empreintes d\'or produites par le code de production : e, nœuds, minimum et sha256 du code F4 (deux exécutions identiques)', () => {
  assert.equal(GOLDEN.rows.length, 30);
  assert.equal(GOLDEN.start, '2026-11-08');
  for (let pass = 0; pass < 2; pass++) {
    GOLDEN.rows.forEach((row, i) => {
      assert.equal(row.date, addDays(GOLDEN.start, i));
      const d = generateDaily(row.date);
      assert.equal(d.fallback, false, row.date);
      assert.equal(d.version, row.v);
      assert.equal(d.attempt, row.e, `${row.date} : tentative acceptée`);
      assert.equal(d.nodes, row.nodes, `${row.date} : nœuds de la preuve (dérive du solveur ?)`);
      assert.equal(d.minimum, row.minimum, row.date);
      assert.equal(createHash('sha256').update(d.code, 'ascii').digest('hex'), row.sha256, `${row.date} : empreinte`);
    });
  }
});

test('niveau du jour : code F4 canonique, aller-retour par le décodeur (validation F2 complète), nom vide, id partage', () => {
  for (const row of GOLDEN.rows.slice(0, 10)) {
    const d = generateDaily(row.date);
    const parsed = parseShareCode(d.code);
    assert.equal(parsed.ok, true, row.date);
    assert.equal(parsed.level.name, '');
    assert.equal(parsed.level.id, 'partage');
    assert.equal(encodeLevel(parsed.level), d.code, 'forme canonique');
    assert.ok(d.code.length <= 323);
    const lv = d.level;
    assert.equal(validateLevel(lv, { mode: 'shared' }).ok, true, row.date);
    const r = solve(parsed.level);
    assert.equal(r.status, 'proved-optimal');
    assert.equal(r.minimum, row.minimum, 'le niveau décodé a le même minimum');
  }
});

test('Q5 : le plafond cumulé FORCE le repli (cumul à 1 nœud) : aucun niveau, raison « cumul », jamais d\'exception', () => {
  for (const date of ['2026-11-08', '2026-11-09', '2026-11-14']) {
    const d = generateDaily(date, { cumulCap: 1 });
    assert.equal(d.fallback, true, date);
    assert.equal(d.reason, 'cumul');
    assert.equal(d.level, null);
    assert.equal(d.code, null);
    assert.ok(d.cumulNodes >= 1);
    assert.equal(dailyPoolId(date), `daily-${weekdayOf(date)}`);
  }
});

test('Q5 : sémantique du plafond cumulé : budget = min(600 000, cumul restant) ; épuisement sur le reste = repli ; tentative épuisée à 600 000 = tentative suivante', () => {
  // 2026-11-08 : la tentative 0 est acceptée à 117 977 nœuds
  const free = generateDaily('2026-11-08');
  assert.equal(free.nodes, 117977);
  // plafond cumulé juste au-dessus : accepté ; juste en dessous : le budget de la tentative est le reste du cumul -> unknown -> repli
  assert.equal(generateDaily('2026-11-08', { cumulCap: 117977 }).fallback, false, 'budget = 117 977 : exactement suffisant');
  const short = generateDaily('2026-11-08', { cumulCap: 117976 });
  assert.equal(short.fallback, true, 'budget = 117 976 : le nœud 117 977 dépasse');
  assert.equal(short.reason, 'cumul');
  // plafond par tentative bas : la tentative est épuisée sur son propre plafond (budget = plafond) -> tentative suivante, pas de repli immédiat
  const low = generateDaily('2026-11-08', { attemptCap: 1000 });
  assert.notEqual(low.reason, 'cumul', 'épuisée à son propre plafond : on tente la suivante');
  assert.ok(low.attempts.length > 1);
  assert.ok(low.attempts.every((a) => a.status !== 'unknown' || a.nodes === 1001), 'une tentative épuisée consomme plafond + 1 nœuds (comptage gelé)');
  // 40 tentatives sans acceptation : repli « attempts »
  const none = generateDaily('2026-11-08', { attemptCap: 1, cumulCap: 1e9 });
  assert.equal(none.fallback, true);
  assert.equal(none.reason, 'attempts');
  assert.equal(none.attempts.length, 40);
});

test('rappel de progression : onAttempt est appelé à chaque tentative, dans l\'ordre', () => {
  const seen = [];
  const d = generateDaily('2026-11-11', { onAttempt: (a) => seen.push(a.e) });
  assert.deepEqual(seen, d.attempts.map((a) => a.e));
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(d.attempt, 7);
});

test('pool de repli : 7 niveaux levels/daily-pool/daily-<j>.json, prouvés (preuve, rejeu du témoin), un par jour de semaine, profil de Q4', () => {
  for (let j = 0; j < 7; j++) {
    const path = `../../levels/daily-pool/daily-${j}.json`;
    assert.ok(existsSync(new URL(path, import.meta.url)), path);
    const lv = read(path);
    assert.equal(lv.id, `daily-${j}`);
    const v = validateLevel(lv, { mode: 'shipped', expectedId: `daily-${j}` });
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    const P = WEEKDAY[j];
    assert.deepEqual(lv.size, [P.cols, P.rows]);
    const mobile = lv.pieces.filter((p) => ['mirror', 'splitter', 'prism', 'filter'].includes(p.type) && p.fixed !== true);
    assert.equal(mobile.length, P.inv.length, `profil ${j} : mobiles`);
    assert.ok(lv.par >= P.mMin && lv.par <= P.inv.length, `profil ${j} : minimum ${lv.par}`);
    const proof = read(`../../levels/daily-pool/proofs/daily-${j}.proof.json`);
    assert.equal(proof.status, 'proved-optimal');
    assert.equal(proof.minimum, lv.par);
    assert.equal(proof.levelId, `daily-${j}`);
    const r = replayPlacements(lv, proof.witness.concat(proof.parking));
    assert.equal(r.ok, true);
    assert.equal(r.usedMovable, lv.par);
    // le niveau de repli est un niveau comme les autres : il se partage (nom du pool hors table T mais le code, lui, n'en porte pas)
    assert.equal(parseShareCode(encodeLevel({ ...lv, name: '' })).ok, true);
  }
});
