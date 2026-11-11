// V11 : nouvel accueil, fonctions pures : succès (calcul depuis la sauvegarde), série du défi, compte à rebours, routes des écrans,
// libellés de l'accueil, noms des niveaux (copie vérifiée contre levels/), intro (quand jouer), générateur de parcours de la scène.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAchievements, newlyEarned, dailyStreak, countdown, achievementRight, ACHIEVEMENTS } from '../../src/ui/achievements.js';
import { computeProgress } from '../../src/ui/progress.js';
import { parseHash } from '../../src/ui/route.js';
import { homeHash, dailyLine, playLabel } from '../../src/ui/home.js';
import { LEVEL_NAMES } from '../../src/ui/level-names.js';
import { shouldPlayIntro } from '../../src/ui/intro.js';
import { generateRoute, mulberry } from '../../src/ui/home-scene.js';
import { levelName } from '../../src/ui/menu.js';
import { VERSION } from '../../src/ui/version.js';

const INDEX = JSON.parse(readFileSync(new URL('../../levels/index.json', import.meta.url), 'utf8'));
const CHAPTERS = INDEX.chapters;
const ALL = CHAPTERS.flatMap((c) => c.levels);
/** Progression avec `results` : {id: {done, best, stars}}. */
const prog = (results) => computeProgress(CHAPTERS, (id) => results[id] || null);
const won = (ids, stars = 3) => Object.fromEntries(ids.map((id) => [id, { done: true, best: 1, stars }]));
const NOFLAGS = { nohint: false, firsttry: false, shared: false };
const earned = (list) => list.filter((a) => a.earned).map((a) => a.id);

test('succès : nouveau joueur : aucun ; progressions affichées pour les succès à compteur', () => {
  const list = computeAchievements({ progress: prog({}), flags: NOFLAGS, dailyDates: [], today: '2026-11-10' });
  assert.equal(list.length, 12);
  assert.deepEqual(earned(list), []);
  assert.deepEqual(list.map(achievementRight), Array(12).fill('—'));
  assert.deepEqual(list.find((a) => a.id === 'all-levels').progress, [0, 50]);
});

test('succès : premier niveau, chapitre Miroirs fini en 3 étoiles (Plein feu), progression des autres', () => {
  const list = computeAchievements({ progress: prog(won(CHAPTERS[0].levels)), flags: NOFLAGS, dailyDates: [], today: '2026-11-10' });
  assert.deepEqual(earned(list), ['first-light', 'mirrors', 'full-chapter']);
  assert.deepEqual(list.find((a) => a.id === 'all-levels').progress, [10, 50]);
  assert.equal(achievementRight(list.find((a) => a.id === 'constellation')), '30/150');
  assert.equal(achievementRight(list.find((a) => a.id === 'mirrors')), 'obtenu');
  // 2 étoiles partout : pas de Plein feu
  assert.ok(!earned(computeAchievements({ progress: prog(won(CHAPTERS[0].levels, 2)), flags: NOFLAGS, dailyDates: [], today: '2026-11-10' })).includes('full-chapter'));
});

test('succès : les 50 niveaux en 3 étoiles = 8 succès de progression ; les drapeaux donnent les 3 autres', () => {
  const list = computeAchievements({ progress: prog(won(ALL)), flags: { nohint: true, firsttry: true, shared: true }, dailyDates: [], today: '2026-11-10' });
  assert.deepEqual(earned(list).sort(), ACHIEVEMENTS.map((a) => a.id).filter((id) => id !== 'streak').sort());
});

test('succès : un succès enregistré reste obtenu même si la progression ne le donne plus ; newlyEarned ne renvoie que les absents', () => {
  const list = computeAchievements({ progress: prog({}), flags: NOFLAGS, dailyDates: [], today: '2026-11-10', granted: { architect: '2026-11-09' } });
  assert.deepEqual(earned(list), ['architect']);
  assert.equal(list.find((a) => a.id === 'architect').date, '2026-11-09');
  const l2 = computeAchievements({ progress: prog(won(['m01-tourner'])), flags: { ...NOFLAGS, shared: true }, dailyDates: [], today: '2026-11-10', granted: { architect: '2026-11-09' } });
  assert.deepEqual(newlyEarned(l2, { architect: '2026-11-09' }), ['first-light']);
});

test('sauvegarde ancienne : les succès déjà mérités par la progression sont accordés au premier chargement (calcul seul)', () => {
  const results = won([...CHAPTERS[0].levels, ...CHAPTERS[1].levels.slice(0, 7)], 2);
  const list = computeAchievements({ progress: prog(results), flags: NOFLAGS, dailyDates: [], today: '2026-11-10', granted: {} });
  assert.deepEqual(newlyEarned(list, {}), ['first-light', 'mirrors']);
});

test('série du défi : jours consécutifs jusqu\'à aujourd\'hui, ou hier si le jour n\'est pas encore relevé ; plus longue suite', () => {
  assert.deepEqual(dailyStreak([], '2026-11-10'), { current: 0, best: 0, today: false });
  assert.deepEqual(dailyStreak(['2026-11-08', '2026-11-09', '2026-11-10'], '2026-11-10'), { current: 3, best: 3, today: true });
  assert.deepEqual(dailyStreak(['2026-11-08', '2026-11-09'], '2026-11-10'), { current: 2, best: 2, today: false }, 'pas encore relevé aujourd\'hui : la série tient');
  assert.deepEqual(dailyStreak(['2026-11-07', '2026-11-08'], '2026-11-10'), { current: 0, best: 2, today: false }, 'un jour manqué : série perdue');
  const seven = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'];
  assert.deepEqual(dailyStreak([...seven, '2026-11-10', 'pas-une-date'], '2026-11-10'), { current: 1, best: 7, today: true }, 'passage de mois compris');
  assert.deepEqual(dailyStreak(['2026-12-31', '2027-01-01'], '2027-01-01'), { current: 2, best: 2, today: true }, 'passage d\'année');
  const list = computeAchievements({ progress: prog({}), flags: NOFLAGS, dailyDates: seven, today: '2026-11-10' });
  assert.deepEqual(earned(list), ['streak']);
  const l5 = computeAchievements({ progress: prog({}), flags: NOFLAGS, dailyDates: seven.slice(2), today: '2026-11-10' });
  assert.equal(achievementRight(l5.find((a) => a.id === 'streak')), '5/7');
});

test('compte à rebours : jusqu\'à minuit UTC, HH:MM', () => {
  assert.equal(countdown(Date.parse('2026-11-10T19:59:00Z')), '04:01');
  assert.equal(countdown(Date.parse('2026-11-10T00:00:00Z')), '24:00');
  assert.equal(countdown(Date.parse('2026-11-10T23:59:30Z')), '00:00');
  assert.equal(countdown(Date.parse('2026-11-10T12:30:59Z')), '11:29');
});

test('routes V11 : #niveaux, #chapitre-N, #aide, #succes, #apropos ; l\'accueil reste {name:"menu"} ; homeHash est l\'inverse', () => {
  assert.deepEqual(parseHash('#niveaux'), { name: 'menu', sub: 'chapters' });
  assert.deepEqual(parseHash('#chapitre-3'), { name: 'menu', sub: 'levels', chapter: 2 });
  assert.deepEqual(parseHash('#aide'), { name: 'menu', sub: 'howto' });
  assert.deepEqual(parseHash('#succes'), { name: 'menu', sub: 'ach' });
  assert.deepEqual(parseHash('#apropos'), { name: 'menu', sub: 'about' });
  for (const bad of ['#chapitre-0', '#chapitre-10', '#chapitre-x', '#constructor', '#__proto__', '#toString']) assert.deepEqual(parseHash(bad), { name: 'menu' }, bad);
  for (const [sub, ch] of [['chapters', 0], ['levels', 4], ['howto', 0], ['ach', 0], ['about', 0]]) {
    const r = parseHash(homeHash(sub, ch));
    assert.equal(r.sub, sub);
    if (sub === 'levels') assert.equal(r.chapter, 4);
  }
  assert.equal(homeHash('home'), '#');
});

test('libellés de l\'accueil : Jouer (nouveau), Reprendre, Rejouer (tout fini) ; ligne du défi', () => {
  assert.equal(playLabel(prog({}), 'm01-tourner', LEVEL_NAMES).a, 'Jouer');
  assert.equal(playLabel(prog({}), 'm01-tourner', LEVEL_NAMES).b, 'Miroirs 01 · Tourner');
  const mid = prog(won(CHAPTERS[0].levels.slice(0, 4)));
  assert.deepEqual([playLabel(mid, 'm05-fixe-et-leurre', LEVEL_NAMES).a, playLabel(mid, 'm05-fixe-et-leurre', LEVEL_NAMES).b], ['Reprendre', 'Miroirs 05 · Fixe et leurre']);
  assert.equal(playLabel(prog(won(ALL)), 'x10-examen', LEVEL_NAMES).a, 'Rejouer');
  assert.deepEqual(dailyLine({ date: '2026-11-10', done: true, streak: 5, countdown: '04:01' }).text, 'relevé · série 5 · prochain dans 04:01');
  assert.deepEqual(dailyLine({ date: '2026-11-10', done: false, streak: 0, countdown: '04:01' }).text, 'à relever · encore 04:01');
  assert.match(dailyLine({ date: '2026-11-10', done: false, streak: 2, countdown: '04:01' }).label, /10 novembre 2026 : pas encore relevé, série de 2 jours, encore 04:01/);
});

test('noms des niveaux : copie exacte du champ name des 50 fichiers de levels/ (et rien d\'autre)', () => {
  assert.deepEqual(Object.keys(LEVEL_NAMES), ALL);
  for (const id of ALL) assert.equal(LEVEL_NAMES[id], JSON.parse(readFileSync(new URL(`../../levels/${id}.json`, import.meta.url), 'utf8')).name, id);
  assert.equal(levelName({}, 'p04-sous-l-emetteur'), 'sous l emetteur', 'repli : id lisible');
});

test('intro : seulement sur l\'accueil, une fois par session, jamais en mouvement réduit ni devant un lien ; ?intro=1/0 ; ?debug sans intro', () => {
  const base = { route: 'home', reduced: false, seen: false, forced: null, debug: false, storage: true };
  assert.equal(shouldPlayIntro(base), true);
  assert.equal(shouldPlayIntro({ ...base, seen: true }), false);
  assert.equal(shouldPlayIntro({ ...base, reduced: true }), false);
  assert.equal(shouldPlayIntro({ ...base, route: 'other' }), false, 'lien partagé, #play=, #daily... : jamais');
  assert.equal(shouldPlayIntro({ ...base, storage: false }), false, 'sessionStorage bloqué : pas d\'intro (on ne saurait pas la retenir)');
  assert.equal(shouldPlayIntro({ ...base, debug: true }), false);
  assert.equal(shouldPlayIntro({ ...base, debug: true, forced: 'on' }), true);
  assert.equal(shouldPlayIntro({ ...base, forced: 'on', reduced: true }), false, 'mouvement réduit l\'emporte');
  assert.equal(shouldPlayIntro({ ...base, forced: 'off' }), false);
});

test('scène : parcours générés sur la grille, cases libres seulement, une cible au moins, prisme un parcours sur deux', () => {
  const cols = 12, rows = 8;
  const ok = Array.from({ length: cols * rows }, (_, k) => (k % cols) >= 4 || Math.floor(k / cols) < 2); // un bloc « sous le texte » en bas à gauche
  const rnd = mulberry(7);
  let prisms = 0;
  for (let n = 0; n < 40; n++) {
    const r = generateRoute({ cols, rows, ok }, rnd, n % 2 === 1);
    assert.ok(r && r.length >= 2, `parcours ${n}`);
    assert.equal(r[0].t, 'E');
    assert.ok(r.some((p) => p.t === 'T'));
    for (const p of r) assert.ok(ok[p.j * cols + p.i], `pièce ${p.t} sur une case libre (${p.i},${p.j})`);
    const cells = new Set(r.map((p) => `${p.i},${p.j}`));
    assert.equal(cells.size, r.length, 'une pièce par case');
    if (r.some((p) => p.t === 'P')) { prisms++; assert.deepEqual(r.filter((p) => p.t === 'T').map((p) => p.m).sort(), [1, 2, 4], 'prisme : cibles rouge, verte, bleue'); }
  }
  assert.ok(prisms >= 15, `prisme environ un parcours sur deux (${prisms}/40)`);
  assert.equal(generateRoute({ cols: 2, rows: 1, ok: [true, true] }, mulberry(1), false), null, 'trop peu de place : aucun parcours');
});

test('version : une seule constante, forme x.y.z', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});
