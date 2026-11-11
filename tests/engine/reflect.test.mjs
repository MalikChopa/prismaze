// R2, R4, R5, R6 : les 16 couples (orientation, direction) écrits à la main, sans passer par le code testé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DX, DY, opposite, reflect, nextOrientation, prevOrientation, dirFromChar, orientFromChar, dirToChar, orientToChar } from '../../src/engine/dirs.js';
import { END_EDGE, END_EMITTER } from './engine.mjs';
import { runAscii } from './helpers.mjs';

// Table R5 de ARCHITECTURE.md, recopiée telle quelle.
// [orientation du miroir][direction d'entrée] = { out: direction de sortie, kind, vertex: sommet au centre ? }
const R5 = {
  '-':  { E: { out: 'E', kind: 'traverse' }, N: { out: 'S', kind: 'retour' }, W: { out: 'W', kind: 'traverse' }, S: { out: 'N', kind: 'retour' } },
  '/':  { E: { out: 'N', kind: 'devie' },    N: { out: 'E', kind: 'devie' },  W: { out: 'S', kind: 'devie' },    S: { out: 'W', kind: 'devie' } },
  '|':  { E: { out: 'W', kind: 'retour' },   N: { out: 'N', kind: 'traverse' }, W: { out: 'E', kind: 'retour' }, S: { out: 'S', kind: 'traverse' } },
  '\\': { E: { out: 'S', kind: 'devie' },    N: { out: 'W', kind: 'devie' },  W: { out: 'N', kind: 'devie' },    S: { out: 'E', kind: 'devie' } },
};

// Carte 5x5, miroir au centre (2,2), émetteur à deux cases du miroir, tourné vers lui.
const SETUP = {
  E: (m) => ['.....', '.....', `>.${m}..`, '.....', '.....'],
  W: (m) => ['.....', '.....', `..${m}.<`, '.....', '.....'],
  N: (m) => ['.....', '.....', `..${m}..`, '.....', '..^..'],
  S: (m) => ['..v..', '.....', `..${m}..`, '.....', '.....'],
};
// Sortie attendue (écrite à la main) : point final et raison d'arrêt selon le cas.
// traverse : sort par le bord du plateau opposé ; devie : sort par le bord dans la direction de sortie ;
// retour : revient à l'émetteur, qui est opaque (R9).
const END_REASON = { traverse: END_EDGE, devie: END_EDGE, retour: END_EMITTER };

for (const o of ['-', '/', '|', '\\']) {
  for (const dIn of ['E', 'N', 'W', 'S']) {
    const exp = R5[o][dIn];
    test(`R5 : miroir ${o} touché vers ${dIn} -> ${exp.out} (${exp.kind})`, () => {
      const { result } = runAscii(SETUP[dIn](o));
      const cell = 2 * 5 + 2; // le miroir est en (2,2) d'une grille 5x5
      const dI = dirFromChar(dIn), dO = dirFromChar(exp.out);
      assert.equal(result.in[cell * 4 + dI], 7, 'le faisceau doit entrer dans la case du miroir par ' + dIn);
      assert.equal(result.out[cell * 4 + dO], 7, 'et en sortir par ' + exp.out);
      for (let d = 0; d < 4; d++) if (d !== dO) assert.equal(result.out[cell * 4 + d], 0, 'une seule sortie');
      assert.ok(Array.from(result.endReason).includes(END_REASON[exp.kind]), 'raison d arrêt ' + END_REASON[exp.kind]);
      assert.equal(result.usedMovable, exp.kind === 'traverse' ? 0 : 1, 'un miroir parallèle ne dévie pas (R6)');
      assert.equal(dO === dI, exp.kind === 'traverse', 'sommet au centre sauf si parallèle (R6)');
    });
  }
}

test('R2 : directions 0=E, 1=N, 2=W, 3=S et opposé (d+2)&3', () => {
  assert.deepEqual([...DX], [1, 0, -1, 0]);
  assert.deepEqual([...DY], [0, -1, 0, 1]);
  assert.deepEqual([0, 1, 2, 3].map(opposite), [2, 3, 0, 1]);
  assert.deepEqual(['E', 'N', 'W', 'S'].map(dirFromChar), [0, 1, 2, 3]);
  assert.equal(dirFromChar('X'), -1);
  assert.deepEqual([0, 1, 2, 3].map(dirToChar), ['E', 'N', 'W', 'S']);
});

test('R4 : orientations 0=- 1=/ 2=| 3=\\, un toucher fait o -> (o+1)&3, ordre / | \\ -', () => {
  assert.deepEqual(['-', '/', '|', '\\'].map(orientFromChar), [0, 1, 2, 3]);
  assert.equal(orientFromChar('x'), -1);
  assert.deepEqual([0, 1, 2, 3].map(orientToChar), ['-', '/', '|', '\\']);
  assert.deepEqual([0, 1, 2, 3].map(nextOrientation), [1, 2, 3, 0]);
  assert.deepEqual([0, 1, 2, 3].map(prevOrientation), [3, 0, 1, 2]);
  // ordre de la maquette en partant de '/'
  const seq = [];
  let o = orientFromChar('/');
  for (let i = 0; i < 4; i++) { seq.push(orientToChar(o)); o = nextOrientation(o); }
  assert.deepEqual(seq, ['/', '|', '\\', '-']);
});

test('R5 : reflect(o, d) = (o - d) & 3 sur les 16 couples (valeurs numériques écrites à la main)', () => {
  // lignes : o = 0..3 ; colonnes : d = 0..3 (E N W S) ; valeurs lues dans la table R5 ci-dessus
  const expected = [
    [0, 3, 2, 1], // '-'  : E->E, N->S, W->W, S->N
    [1, 0, 3, 2], // '/'  : E->N, N->E, W->S, S->W
    [2, 1, 0, 3], // '|'  : E->W, N->N, W->E, S->S
    [3, 2, 1, 0], // '\\' : E->S, N->W, W->N, S->E
  ];
  for (let o = 0; o < 4; o++) for (let d = 0; d < 4; d++) assert.equal(reflect(o, d), expected[o][d], `o=${o} d=${d}`);
});
