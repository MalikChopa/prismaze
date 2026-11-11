// Modules purs de la coque (J5) : routage par fragment, verrouillage séquentiel (P14), événements de commande (U6/U7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHash, playHash } from '../../src/ui/route.js';
import { computeProgress, isPlayable, nextPlayable, locate, chapterThreshold, starsText, starsLabel } from '../../src/ui/progress.js';
import { summarize, diffEvents } from '../../src/ui/events.js';
import { createState, movePiece } from '../../src/engine/state.js';
import { moveToWin } from './helpers.mjs';
import { buildBoard } from '../../src/engine/board.js';
import { trace } from '../../src/engine/trace.js';

test('routage : menu par défaut, #play=<id>, #daily, #edit, #l=<code>, tout le reste -> menu', () => {
  assert.deepEqual(parseHash(''), { name: 'menu' });
  assert.deepEqual(parseHash('#'), { name: 'menu' });
  assert.deepEqual(parseHash('#play=m01-tourner'), { name: 'play', id: 'm01-tourner' });
  assert.deepEqual(parseHash('#daily'), { name: 'daily' });
  assert.deepEqual(parseHash('#edit'), { name: 'edit' });
  assert.deepEqual(parseHash('#l=1.AbC_-9'), { name: 'shared', code: '1.AbC_-9' });
  for (const bad of ['#play=', '#play=../x', '#play=A B', '#play=ab', '#truc', '#play=m01&x=1', undefined, null, 5]) {
    assert.deepEqual(parseHash(bad), { name: 'menu' }, String(bad).slice(0, 20));
  }
  // fragment de partage trop long (F5) : « lien invalide » sans lire plus loin, code null (la coque affiche le message)
  assert.deepEqual(parseHash('#l=' + 'A'.repeat(400)), { name: 'shared', code: null });
  assert.deepEqual(parseHash('#l='), { name: 'shared', code: '' });
  assert.equal(playHash('m02-glisser'), '#play=m02-glisser');
});

const chapters = [
  { id: 'a', name: 'Miroirs', levels: ['a01', 'a02', 'a03'] },
  { id: 'b', name: 'Couleurs', levels: ['b01', 'b02'] },
  { id: 'c', name: 'Prismes', levels: Array.from({ length: 10 }, (_, i) => `c${String(i + 1).padStart(2, '0')}`) },
  { id: 'd', name: 'Suite', levels: ['d01'] },
];
const results = (map) => (id) => (Object.prototype.hasOwnProperty.call(map, id) ? { done: true, best: map[id][0], stars: map[id][1] } : null);

test('P14 : au départ seul le premier niveau du premier chapitre est jouable', () => {
  const p = computeProgress(chapters, results({}));
  assert.equal(p.chapters[0].unlocked, true);
  assert.deepEqual(p.chapters[0].levels.map((l) => l.state), ['current', 'locked', 'locked']);
  assert.equal(p.chapters[1].unlocked, false);
  assert.ok(p.chapters[1].levels.every((l) => l.state === 'locked'));
  assert.equal(p.nextId, 'a01');
  assert.deepEqual([p.stars, p.maxStars, p.done, p.total], [0, 48, 0, 16]);
});

test('P14 : dans un chapitre, dans l\'ordre ; chapitre suivant ouvert quand tous les niveaux sont gagnés (chapitre court)', () => {
  let p = computeProgress(chapters, results({ a01: [1, 3] }));
  assert.deepEqual(p.chapters[0].levels.map((l) => l.state), ['done', 'current', 'locked']);
  assert.equal(p.chapters[1].unlocked, false);
  p = computeProgress(chapters, results({ a01: [1, 3], a02: [2, 2], a03: [3, 1] }));
  assert.equal(p.chapters[1].unlocked, true);
  assert.equal(chapterThreshold(chapters[0]), 3);
  assert.deepEqual(p.chapters[1].levels.map((l) => l.state), ['current', 'locked']);
  assert.equal(p.nextId, 'b01');
  assert.equal(p.stars, 6);
});

test('P14 : un chapitre de 10 niveaux s\'ouvre au 7e gagné, pas au 6e', () => {
  const six = {}; for (let i = 1; i <= 6; i++) six[`c${String(i).padStart(2, '0')}`] = [1, 3];
  const base = { a01: [1, 3], a02: [1, 3], a03: [1, 3], b01: [1, 3], b02: [1, 3] };
  assert.equal(computeProgress(chapters, results({ ...base, ...six })).chapters[3].unlocked, false);
  assert.equal(computeProgress(chapters, results({ ...base, ...six, c07: [1, 3] })).chapters[3].unlocked, true);
  assert.equal(chapterThreshold(chapters[2]), 7);
});

test('un chapitre verrouillé garde ses niveaux verrouillés même si une sauvegarde les dit gagnés ; isPlayable / nextPlayable / locate', () => {
  const p = computeProgress(chapters, results({ a01: [1, 3] }));
  assert.equal(isPlayable(p, 'a01'), true);
  assert.equal(isPlayable(p, 'a02'), true);
  assert.equal(isPlayable(p, 'a03'), false);
  assert.equal(isPlayable(p, 'zzz'), false);
  assert.deepEqual(nextPlayable(p, 'a01'), { id: 'a02', n: 2, chapter: 'Miroirs' });
  assert.equal(nextPlayable(p, 'a02'), null, 'a03 verrouillé');
  assert.equal(nextPlayable(p, 'd01'), null, 'dernier niveau');
  assert.deepEqual(locate(chapters, 'b02'), { chapter: 'Couleurs', chapterIndex: 1, n: 2, total: 2 });
  assert.equal(locate(chapters, 'nope'), null);
});

test('tout gagné : plus de « niveau suivant » à proposer ; nextId nul', () => {
  const all = {}; for (const ch of chapters) for (const id of ch.levels) all[id] = [1, 3];
  const p = computeProgress(chapters, results(all));
  assert.equal(p.nextId, null);
  assert.equal(p.stars, p.maxStars);
});

test('étoiles : texte et libellé', () => {
  assert.equal(starsText(2), '★★☆');
  assert.equal(starsText(0), '☆☆☆');
  assert.equal(starsText(9), '★★★');
  assert.equal(starsLabel(1), '1 étoile sur 3');
  assert.equal(starsLabel(3), '3 étoiles sur 3');
});

test('événements sur un vrai tracé : déplacer le miroir allume la cible (lumière blanche : fusion), annuler la perd', () => {
  const s0 = moveToWin();
  const sum0 = summarize(s0, trace(buildBoard(s0)));
  assert.deepEqual(sum0.lit, [false]);
  const mirror = s0.pieces.find((p) => p.type === 'mirror');
  const s1 = movePiece(s0, mirror.id, 1, 0);
  const sum1 = summarize(s1, trace(buildBoard(s1)));
  assert.deepEqual(sum1.lit, [true]);
  assert.deepEqual(diffEvents(sum0, sum1), [{ name: 'merge', arg: 7 }]);
  assert.deepEqual(diffEvents(sum1, sum0), [{ name: 'lost' }]);
});

test('événements : l\'exemple F1 contient un prisme, une porte et des portails (résumé de la bonne forme)', () => {
  const level = JSON.parse(readFileSync(new URL('../fixtures/v2/valid/x00-exemple.json', import.meta.url), 'utf8'));
  const s = createState(level);
  const sum = summarize(s, trace(buildBoard(s)));
  assert.equal(sum.prisms.length, 1);
  assert.equal(sum.portals.length, 2);
  assert.equal(sum.open.length, 1);
  assert.equal(sum.lit.length, 2);
});

test('événements : diff purs sur des résumés à la main', () => {
  const base = { lit: [false, false], needs: [1, 7], open: [false], portals: [false], prisms: [false] };
  assert.deepEqual(diffEvents(base, base), []);
  assert.deepEqual(diffEvents(base, { ...base, lit: [true, false] }), [{ name: 'light', arg: 1 }]);
  assert.deepEqual(diffEvents(base, { ...base, lit: [false, true] }), [{ name: 'merge', arg: 7 }], 'besoin mélangé : fusion');
  assert.deepEqual(diffEvents({ ...base, lit: [true, true] }, base), [{ name: 'lost' }], 'une seule annonce de perte');
  assert.deepEqual(diffEvents(base, { ...base, open: [true], portals: [true], prisms: [true] }).map((e) => e.name), ['gate', 'portal', 'prism']);
  assert.deepEqual(diffEvents(null, base), []);
  assert.deepEqual(diffEvents(base, { ...base, lit: [true] }), [], 'niveaux différents : rien');
});
