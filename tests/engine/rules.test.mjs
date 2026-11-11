// E12 (b) : une assertion par ligne de la table E4 (+ E3, E8, E9), valeurs écrites à la main, sans recopier le code du moteur.
// Directions : 0 E, 1 N, 2 W, 3 S. Le « motif 5x5 » est une grille 5x5, la pièce testée au centre (2,2), l'émetteur à 2 cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { END_NONE, END_WALL, END_EMITTER, END_GATE } from './engine.mjs';
import { run, P } from './helpers.mjs';

const E = 0, N = 1, W = 2, S = 3;
const idx = (cols, c, r, d) => (r * cols + c) * 4 + d;
const at5 = (c, r, d) => idx(5, c, r, d);
// émetteur de couleur m vers la pièce centrale (2,2), arrivant en allant dans la direction d
const FEED = { [E]: (m) => P.emitter(0, 2, E, m), [W]: (m) => P.emitter(4, 2, W, m), [N]: (m) => P.emitter(2, 4, N, m), [S]: (m) => P.emitter(2, 0, S, m) };
const DIRS = [E, N, W, S];
const outs = (result, cols, c, r) => [0, 1, 2, 3].map((d) => result.out[idx(cols, c, r, d)]);

test('E4 émetteur : émet son masque depuis son centre vers le voisin, pour les 7 couleurs et les 4 directions', () => {
  for (let m = 1; m <= 7; m++) {
    for (const d of DIRS) {
      const { result } = run(5, 5, [FEED[d](m)]);
      const em = d === E ? [0, 2] : d === W ? [4, 2] : d === N ? [2, 4] : [2, 0];
      assert.equal(result.out[at5(em[0], em[1], d)], m);
      const next = [em[0] + [1, 0, -1, 0][d], em[1] + [0, -1, 0, 1][d]];
      assert.equal(result.in[at5(next[0], next[1], d)], m, `première arrivée dans la case voisine, couleur ${m} direction ${d}`);
    }
  }
});

test('E4 émetteur : sa case est opaque (un faisceau qui y revient s\'arrête, `emitter`), même pour un autre émetteur', () => {
  const { result } = run(5, 1, [P.emitter(0, 0, E, 1), P.emitter(4, 0, W, 4)]);
  assert.equal(result.endReason[idx(5, 1, 0, W)], END_EMITTER, 'le bleu s\'arrête contre l\'émetteur rouge');
  assert.equal(result.endReason[idx(5, 3, 0, E)], END_EMITTER, 'le rouge s\'arrête contre l\'émetteur bleu');
  assert.equal(result.in[idx(5, 2, 0, E)], 1);
  assert.equal(result.in[idx(5, 2, 0, W)], 4);
  assert.equal(result.in[idx(5, 0, 0, W)], 0);
});

test('E4 mur : arrêt au bord (`wall`), la case du mur ne reçoit rien', () => {
  const { result } = run(5, 5, [FEED[E](5), P.wall(2, 2)]);
  assert.equal(result.endReason[at5(1, 2, E)], END_WALL);
  assert.equal(result.end[at5(1, 2, E)], 5);
  assert.deepEqual([...result.in.slice(at5(2, 2, 0), at5(2, 2, 0) + 4)], [0, 0, 0, 0]);
});

test('E4 miroir : sort en (o-d)&3 avec le même masque ; parallèle : traverse ; de face : repart en arrière (16 couples, 7 couleurs)', () => {
  const expected = [[0, 3, 2, 1], [1, 0, 3, 2], [2, 1, 0, 3], [3, 2, 1, 0]]; // [o][d], table R5 écrite à la main
  for (let o = 0; o < 4; o++) {
    for (const d of DIRS) {
      for (const m of [1, 2, 4, 3, 7]) {
        const { result } = run(5, 5, [FEED[d](m), P.mirror(2, 2, o)]);
        const want = [0, 0, 0, 0];
        want[expected[o][d]] = m;
        assert.deepEqual(outs(result, 5, 2, 2), want, `o=${o} d=${d} m=${m}`);
        assert.equal(result.usedMovable, expected[o][d] === d ? 0 : 1, 'utilisé seulement s\'il dévie ou renvoie');
      }
    }
  }
});

test('E4 séparateur : sort en d ET en (o-d)&3 avec le masque COMPLET (si différent) ; de face : traverse et renvoie', () => {
  const expected = [[0, 3, 2, 1], [1, 0, 3, 2], [2, 1, 0, 3], [3, 2, 1, 0]];
  for (let o = 0; o < 4; o++) {
    for (const d of DIRS) {
      const m = 7;
      const { result } = run(5, 5, [FEED[d](m), P.splitter(2, 2, o)]);
      const want = [0, 0, 0, 0];
      want[d] = m;
      want[expected[o][d]] = m;
      assert.deepEqual(outs(result, 5, 2, 2), want, `o=${o} d=${d}`);
      assert.equal(result.usedMovable, expected[o][d] === d ? 0 : 1);
    }
  }
  // de face (o = 2 '|', d = E) : traverse (E) et renvoie (W), avec un masque mélangé
  const f = run(5, 5, [FEED[E](5), P.splitter(2, 2, 2)]).result;
  assert.deepEqual(outs(f, 5, 2, 2), [5, 0, 5, 0]);
  assert.equal(f.in[at5(3, 2, E)], 5, 'la branche qui traverse arrive');
  assert.equal(f.in[at5(1, 2, W)], 5, 'la branche renvoyée arrive');
});

test('E4 prisme : R à gauche (d+1), G tout droit, B à droite (d+3), chaque bit seul ; entrée non blanche : seuls ses bits sortent', () => {
  for (const d of DIRS) {
    for (let m = 1; m <= 7; m++) {
      const { result } = run(5, 5, [FEED[d](m), P.prism(2, 2)]);
      const want = [0, 0, 0, 0];
      if (m & 1) want[(d + 1) & 3] = 1;
      if (m & 2) want[d] = 2;
      if (m & 4) want[(d + 3) & 3] = 4;
      assert.deepEqual(outs(result, 5, 2, 2), want, `d=${d} m=${m}`);
      assert.equal(result.usedMovable, (m & 5) ? 1 : 0, 'utilisé s\'il reçoit R ou B (le vert seul le traverse)');
    }
  }
  // gauche du sens de marche : vers l'est, le nord (en haut)
  const east = run(5, 5, [FEED[E](7), P.prism(2, 2)]).result;
  assert.equal(east.out[at5(2, 2, N)], 1, 'rouge vers le nord');
  assert.equal(east.out[at5(2, 2, S)], 4, 'bleu vers le sud');
  assert.equal(east.out[at5(2, 2, E)], 2, 'vert tout droit');
});

test('E4 prisme : les trois faisceaux repartent de la case du prisme et sortent chacun par son bord', () => {
  const { result } = run(5, 5, [FEED[E](7), P.prism(2, 2)]);
  assert.equal(result.in[at5(2, 1, N)], 1);
  assert.equal(result.in[at5(2, 3, S)], 4);
  assert.equal(result.in[at5(3, 2, E)], 2);
  assert.equal(result.usedMovable, 1);
  assert.equal(result.segments().count, 4, 'blanc entrant + trois sorties');
});

test('E4 filtre f : passe m & f, absorbe m & ~f ; rien ne passe : arrêt (`absorbed` se lit sur `in`)', () => {
  for (let f = 1; f <= 6; f++) {
    for (let m = 1; m <= 7; m++) {
      const { result } = run(5, 5, [FEED[E](m), P.filter(2, 2, f)]);
      assert.equal(result.in[at5(2, 2, E)], m, 'tout ce qui arrive est lu sur in');
      assert.equal(result.out[at5(2, 2, E)], m & f, `f=${f} m=${m} : sort m & f`);
      assert.equal(result.in[at5(3, 2, E)], m & f, 'la case suivante ne reçoit que m & f');
      assert.equal(result.usedMovable, (m & ~f) !== 0 ? 1 : 0, 'utilisé s\'il absorbe au moins un bit');
      if ((m & f) === 0) assert.equal(result.segments().count, 1, 'rien ne passe : la série s\'arrête au filtre');
    }
  }
});

test('E4 cible : traversée ; got = OU reçu ; allumée si got == need ; atteinte si got ⊇ need (7 x 7 couleurs)', () => {
  for (let need = 1; need <= 7; need++) {
    for (let m = 1; m <= 7; m++) {
      const { result } = run(5, 1, [P.emitter(0, 0, E, m), P.target(2, 0, need)]);
      const t = result.targets[0];
      assert.equal(t.got, m);
      assert.equal(t.need, need);
      assert.equal(t.lit, m === need, `need=${need} m=${m}`);
      assert.equal(t.reached, (m & need) === need);
      assert.equal(result.out[idx(5, 2, 0, E)], m, 'la lumière continue après la cible');
      assert.equal(result.allLit, m === need);
    }
  }
});

test('E3/E4 cible : voit le OU des quatre directions ; deux directions dans une case ne se mélangent pas', () => {
  // rouge par l'ouest, vert par le sud, bleu par le nord, dans la case (2,2)
  const { result } = run(5, 5, [P.emitter(0, 2, E, 1), P.emitter(2, 4, N, 2), P.emitter(2, 0, S, 4), P.target(2, 2, 7)]);
  assert.equal(result.targets[0].got, 7);
  assert.equal(result.targets[0].lit, true);
  assert.equal(result.in[at5(2, 2, E)], 1);
  assert.equal(result.in[at5(2, 2, N)], 2);
  assert.equal(result.in[at5(2, 2, S)], 4);
  assert.equal(result.out[at5(2, 2, E)], 1, 'chaque direction continue seule : pas de mélange dans la lumière');
  assert.equal(result.out[at5(2, 2, N)], 2);
  assert.equal(result.out[at5(2, 2, S)], 4);
});

test('E3 fusion : même case et même direction = OU des masques (un faisceau, couleur mélangée)', () => {
  // séparateur '/' en (1,2) : le rouge (venu de l'ouest) passe tout droit ET part au nord ; le bleu (venu du sud) sort au nord ET part à l'est.
  // Vers l'est : rouge | bleu = 5 (violet), dans un seul faisceau ; vers le nord : même fusion dans la case (1,1).
  const f = run(6, 5, [P.emitter(0, 2, E, 1), P.splitter(1, 2, 1), P.emitter(1, 4, N, 4), P.target(4, 2, 5)]);
  assert.equal(f.result.out[idx(6, 1, 2, E)], 5, 'rouge et bleu dans la même direction = violet');
  assert.equal(f.result.out[idx(6, 1, 2, N)], 5);
  assert.equal(f.result.in[idx(6, 1, 1, N)], 5);
  assert.equal(f.result.targets[0].got, 5);
  assert.equal(f.result.targets[0].lit, true);
  // sans fusion : un miroir '/' sépare les deux couleurs (le rouge part au nord, le bleu à l'est)
  const m = run(6, 5, [P.emitter(0, 2, E, 1), P.mirror(1, 2, 1), P.emitter(1, 4, N, 4), P.target(4, 2, 5)]);
  assert.equal(m.result.out[idx(6, 1, 2, N)], 1);
  assert.equal(m.result.out[idx(6, 1, 2, E)], 4);
  assert.equal(m.result.targets[0].got, 4);
});

test('E4 portail : entrer par A en allant dans d = sortir du CENTRE de B dans d (direction conservée), et réciproquement', () => {
  for (const d of DIRS) {
    // A en (1,1), B en (3,3) dans une grille 5x5 ; l'émetteur entre dans A par la direction d
    const em = [[0, 1], [1, 2], [2, 1], [1, 0]][d]; // E : (0,1) ; N : (1,2) ; W : (2,1) ; S : (1,0)
    const { result } = run(5, 5, [P.emitter(em[0], em[1], d, 7), P.portal(1, 1, 0), P.portal(3, 3, 0)]);
    assert.equal(result.in[at5(1, 1, d)], 7);
    assert.deepEqual(outs(result, 5, 1, 1), [0, 0, 0, 0], 'A n\'émet rien');
    assert.equal(result.out[at5(3, 3, d)], 7, 'sort de B dans la même direction d');
    for (let e = 0; e < 4; e++) if (e !== d) assert.equal(result.out[at5(3, 3, e)], 0);
  }
  // réciproque : entrer par B en allant vers l'ouest = sortir de A vers l'ouest
  const r = run(5, 5, [P.emitter(4, 3, W, 7), P.portal(1, 1, 0), P.portal(3, 3, 0)]);
  assert.equal(r.result.in[at5(3, 3, W)], 7);
  assert.equal(r.result.out[at5(1, 1, W)], 7);
  assert.equal(r.result.in[at5(0, 1, W)], 7, 'et la lumière sort de A par l\'ouest');
  // sortie contre un mur : la lumière s'arrête au bord de B
  const w = run(5, 5, [P.emitter(0, 1, E, 7), P.portal(1, 1, 0), P.portal(3, 3, 0), P.wall(4, 3)]);
  assert.equal(w.result.endReason[at5(3, 3, E)], END_WALL);
});

test('E4 portail : les deux portails d\'une paire sont indépendants des autres paires ; sans partenaire, la lumière s\'arrête', () => {
  const two = run(7, 3, [P.emitter(0, 0, E, 1), P.emitter(0, 2, E, 4), P.portal(2, 0, 0), P.portal(5, 2, 0), P.portal(2, 2, 1), P.portal(5, 0, 1)]);
  assert.equal(two.result.out[idx(7, 5, 2, E)], 1, 'rouge : paire 0, de (2,0) vers (5,2)');
  assert.equal(two.result.out[idx(7, 5, 0, E)], 4, 'bleu : paire 1, de (2,2) vers (5,0)');
  const lone = run(5, 1, [P.emitter(0, 0, E, 7), P.portal(2, 0, 0)]);
  assert.equal(lone.result.in[idx(5, 2, 0, E)], 7);
  assert.equal(lone.result.in[idx(5, 3, 0, E)], 0, 'portail sans partenaire (invalide, V11) : la lumière s\'arrête (choix du moteur, voir journal)');
});

test('E4 porte : fermée = mur (`gate`) ; ouverte = case vide ; s\'ouvre quand la cible liée est ATTEINTE (reçu ⊇ besoin)', () => {
  const closed = run(5, 3, [P.emitter(0, 0, E, 7), P.gate(2, 0, [4, 2]), P.target(4, 0, 7), P.target(4, 2, 7)]);
  assert.equal(closed.result.endReason[idx(5, 1, 0, E)], END_GATE);
  assert.equal(closed.result.in[idx(5, 2, 0, E)], 0, 'fermée : rien n\'entre dans la case de la porte');
  assert.equal(closed.result.gates[0].open, false);
  assert.equal(closed.result.targets[0].got, 0);
  // la cible liée (4,2) reçoit du blanc alors qu'elle veut du rouge : atteinte (⊇) sans être allumée, la porte s'ouvre
  const open = run(5, 3, [P.emitter(0, 0, E, 7), P.gate(2, 0, [4, 2]), P.target(4, 0, 7), P.target(4, 2, 1), P.emitter(0, 2, E, 7)]);
  const t1 = open.result.targets[1];
  assert.deepEqual([t1.got, t1.reached, t1.lit], [7, true, false], 'atteinte mais pas allumée');
  assert.equal(open.result.gates[0].open, true);
  assert.equal(open.result.out[idx(5, 2, 0, E)], 7, 'ouverte : la lumière traverse la case');
  assert.equal(open.result.targets[0].lit, true);
  assert.equal(open.result.endReason[idx(5, 1, 0, E)], END_NONE, 'plus de raison d\'arrêt devant la porte');
});

test('E6 : une cible partielle (rouge reçu, vert attendu) n\'ouvre pas ; « reçu ⊇ besoin » ouvre ; une porte ouverte ne se referme jamais', () => {
  const partial = run(5, 3, [P.emitter(0, 0, E, 7), P.gate(2, 0, [4, 2]), P.target(4, 0, 7), P.target(4, 2, 3), P.emitter(0, 2, E, 1)]);
  assert.equal(partial.result.targets[1].reached, false, 'R reçu, RG attendu');
  assert.equal(partial.result.gates[0].open, false);
  const whole = run(5, 3, [P.emitter(0, 0, E, 7), P.gate(2, 0, [4, 2]), P.target(4, 0, 7), P.target(4, 2, 3), P.emitter(0, 2, E, 3)]);
  assert.equal(whole.result.gates[0].open, true);
  // rouge puis blanc : avec « == » la cible (need R) cesserait d'être allumée et la porte se refermerait (E6) ; ici elle reste ouverte
  const mono = run(7, 3, [P.emitter(0, 0, E, 7), P.gate(2, 0, [6, 2]), P.target(4, 0, 7), P.target(6, 2, 1), P.emitter(0, 2, E, 1), P.emitter(6, 1, S, 6)]);
  assert.equal(mono.result.targets[1].got, 7, 'rouge de l\'ouest + cyan du nord');
  assert.equal(mono.result.targets[1].lit, false, 'plus allumée (7 != 1)');
  assert.equal(mono.result.gates[0].open, true, 'mais la porte reste ouverte');
});

test('E6 : cible liée qui dépend de la porte elle-même (cycle) : la porte reste fermée (plus petit point fixe)', () => {
  const { result } = run(5, 1, [P.emitter(0, 0, E, 7), P.gate(1, 0, [3, 0]), P.target(3, 0, 7)]);
  assert.equal(result.gates[0].open, false);
  assert.equal(result.targets[0].got, 0);
});

test('E8 : victoire = au moins une cible et toutes allumées ; score = pièces mobiles utilisées (fixes exclues)', () => {
  const none = run(3, 1, [P.emitter(0, 0, E, 7)]);
  assert.equal(none.result.allLit, false, 'aucune cible : pas de victoire');
  const fixedPrism = run(5, 5, [FEED[E](7), P.prism(2, 2, true)]);
  assert.equal(fixedPrism.result.used[1], 1, 'le prisme fixe est utilisé...');
  assert.equal(fixedPrism.result.usedMovable, 0, '...mais ne compte pas dans le score');
  const filt = run(5, 5, [FEED[E](7), P.filter(2, 2, 3, false)]);
  assert.equal(filt.result.usedMovable, 1);
  const free = run(5, 5, [FEED[E](3), P.filter(2, 2, 3, false)]);
  assert.equal(free.result.usedMovable, 0, 'un filtre qui ne retient rien n\'est pas utilisé');
});

test('E9 : les pièces fixes ne comptent jamais (miroir, séparateur, prisme, filtre fixes) ; mobiles par défaut', () => {
  const { result } = run(7, 5, [
    P.emitter(0, 2, E, 7), P.filter(1, 2, 3, true), P.splitter(2, 2, 1, true), P.prism(3, 2, true), P.mirror(2, 0, 3, true),
  ]);
  assert.ok([...result.used].filter(Boolean).length >= 3, 'plusieurs pièces fixes ont servi');
  assert.equal(result.usedMovable, 0);
});
