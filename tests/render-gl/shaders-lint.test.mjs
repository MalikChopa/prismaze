// Lint des shaders (§8) : tout uniforme alimenté par draw.js existe dans le programme visé, tout uniforme déclaré est alimenté (sauf le programme des particules, branché en V4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PROGRAM_SOURCES, PROGRAM_NAMES } from '../../src/render/gl/shaders.js';

const draw = fs.readFileSync(new URL('../../src/render/gl/draw.js', import.meta.url), 'utf8');

const declaredUniforms = (src) => {
  const out = new Set();
  for (const m of src.matchAll(/uniform\s+\w+\s+([^;]+);/g)) for (const part of m[1].split(',')) out.add(part.trim().split(/\s|\[/)[0]);
  return out;
};
const declared = (name) => { const { vs, fs: f } = PROGRAM_SOURCES[name]; return new Set([...declaredUniforms(vs), ...declaredUniforms(f)]); };

/** Balaye draw.js en suivant la variable `p` (programme courant) : renvoie la liste [programme, uniforme] de chaque appel à su() ou getUniformLocation. */
function fedUniforms() {
  const code = draw.replace(/\/\/.*$/gm, '');
  const fed = [];
  const re = /(\bp\s*=\s*P\.(\w+))|(su\(\s*(p|prog)\s*,\s*'(\w+)')|(getUniformLocation\(p\.p,\s*'(\w+)'\))/g;
  let cur = null;
  for (const m of code.matchAll(re)) {
    if (m[1]) cur = m[2];
    else if (m[3]) fed.push(m[4] === 'prog' ? ['_world', m[5]] : [cur, m[5]]);
    else if (m[6]) fed.push([cur, m[7]]);
  }
  return fed;
}

test('liste des programmes : les 8 du pipeline (V3-10)', () => {
  assert.deepEqual([...PROGRAM_NAMES].sort(), ['beam', 'comp', 'down', 'fan', 'floor', 'part', 'piece', 'up']);
});

test('chaque uniforme nommé dans draw.js existe dans le programme visé', () => {
  const worldPrograms = ['piece', 'beam', 'fan'];
  for (const [prog, u] of fedUniforms()) {
    if (prog === '_world') { for (const w of worldPrograms) assert.ok(declared(w).has(u), `${u} absent de ${w}`); continue; }
    assert.ok(prog && PROGRAM_SOURCES[prog], `programme inconnu pour ${u}`);
    assert.ok(declared(prog).has(u), `${u} n'est pas déclaré dans le programme ${prog}`);
  }
});

test('chaque uniforme déclaré est alimenté par draw.js', () => {
  const fed = new Set(fedUniforms().filter(([p]) => p !== '_world').map(([p, u]) => `${p}.${u}`));
  const worldFed = new Set(fedUniforms().filter(([p]) => p === '_world').map(([, u]) => u));
  for (const name of PROGRAM_NAMES) {
    if (name === 'part') continue; // particules : préparé pour V4
    for (const u of declared(name)) assert.ok(fed.has(`${name}.${u}`) || worldFed.has(u), `${name}.${u} jamais alimenté`);
  }
});

test('les shaders sont en GLSL ES 3.00, sans URL ni commentaire', () => {
  for (const [name, { vs, fs: f }] of Object.entries(PROGRAM_SOURCES)) {
    assert.ok(vs.startsWith('#version 300 es'), `${name} vs`);
    assert.ok(f.startsWith('#version 300 es'), `${name} fs`);
    assert.ok(!/https?:|\/\//.test(vs + f), `${name}`);
  }
});

test('types de pièce du shader : une branche par type (T.* de piece-data.js)', async () => {
  const { T } = await import('../../src/render/gl/piece-data.js');
  const fsPiece = PROGRAM_SOURCES.piece.fs;
  const max = Object.values(T).reduce((a, b) => Math.max(a, b), 0);
  for (let t = 0; t < max; t++) assert.ok(fsPiece.includes(`t < ${t + 1}.0`), `branche ${t}`);
});
