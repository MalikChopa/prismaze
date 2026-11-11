// E12 (c) : plateau d'or 10x8 de 50 pièces (2 émetteurs, 5 cibles, 8 murs, 2 portes, 2 portails, 14 miroirs, 6 séparateurs, 6 prismes, 5 filtres).
// Plateau « dense » choisi de façon déterministe (denseBoard : 2000 tirages puis 4000 mutations gardées si elles ne baissent pas les pas).
// Les valeurs figées ci-dessous ont été relevées avec ce moteur le 2026-11-07 ET confirmées par la référence indépendante (reference.mjs) :
// elles servent de garde-fou contre toute dérive du moteur (une dérive du générateur les change aussi : mettre alors à jour ensemble).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildBoard, traceBoard } from './engine.mjs';
import { denseBoard } from '../engine-crosscheck/generate.mjs';
import { compareBoard } from '../engine-crosscheck/compare.mjs';

const stepsOf = (st) => traceBoard(buildBoard(st)).steps;
const GOLD = denseBoard(20261107, stepsOf);

test('plateau d\'or : 10x8, 50 pièces, composition attendue', () => {
  assert.deepEqual([GOLD.cols, GOLD.rows, GOLD.pieces.length], [10, 8, 50]);
  const count = {};
  for (const p of GOLD.pieces) count[p.type] = (count[p.type] || 0) + 1;
  assert.deepEqual(count, { emitter: 2, target: 5, wall: 8, gate: 2, portal: 2, mirror: 14, splitter: 6, prism: 6, filter: 5 });
});

test('plateau d\'or : le moteur égale la référence indépendante (cibles reçues, portes, pièces utilisées, score)', () => {
  const { ok, mine, br } = compareBoard(GOLD);
  assert.ok(ok, JSON.stringify([mine, br]));
});

test('plateau d\'or : valeurs figées (pas, cibles, score, cases éclairées, séries, empreinte de in/out)', () => {
  const b = buildBoard(GOLD);
  const r = traceBoard(b);
  assert.equal(r.steps, 151);
  assert.ok(r.steps <= 12 * b.n);
  assert.equal(r.capped, false);
  assert.equal(r.litCount, 0);
  assert.equal(r.allLit, false);
  assert.deepEqual(r.targets.map((t) => t.got), [0, 0, 0, 1, 0]);
  assert.deepEqual(r.gates.map((g) => g.open), [false, false]);
  assert.equal(r.usedMovable, 10);
  assert.equal(r.orderCount, 51);
  assert.equal(r.segments().count, 49);
  const digest = createHash('sha256').update(Buffer.from(r.in)).update(Buffer.from(r.out)).digest('hex').slice(0, 16);
  assert.equal(digest, '1b1ee0131f41185f');
});

test('plateau d\'or : 1000 tracés successifs identiques (déterminisme, tableaux réutilisés)', () => {
  const b = buildBoard(GOLD);
  const d0 = JSON.stringify([...traceBoard(b).in]);
  for (let i = 0; i < 1000; i++) assert.equal(JSON.stringify([...traceBoard(b).in]), d0);
});
