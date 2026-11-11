// V3-1 (qui appelle getContext), lint des uniformes GL, pas de réseau ni d'aléa dans le nouveau code de rendu, SwiftShader/HDR : garde-fous Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROGRAM_SOURCES } from '../../src/render/gl/shaders.js';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
const rel = (p) => relative(SRC, p).replaceAll('\\', '/');
/** Texte sans commentaires `//` et `/* *​/` (les mots y sont permis). */
const code = (p) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('V3-1 : seuls main.js (grain), renderer.js, sprites.js, static-layer.js et gl/context.js appellent getContext ; jamais src/ui/', () => {
  const callers = walk(SRC).filter((p) => /\.getContext\s*\(/.test(code(p))).map(rel).sort();
  assert.deepEqual(callers, ['main.js', 'render/gl/context.js', 'render/renderer.js', 'render/sprites.js', 'render/static-layer.js']);
  for (const f of ['game', 'app', 'input', 'menu', 'settings']) assert.ok(!/getContext/.test(code(join(SRC, 'ui', `${f}.js`))), f);
});

test('V3-1 : game.js, app.js n\'importent plus createRenderer (tout passe par l\'hôte)', () => {
  assert.ok(!/createRenderer/.test(code(join(SRC, 'ui', 'app.js'))));
  assert.ok(!/createRenderer/.test(code(join(SRC, 'ui', 'game.js'))));
  assert.match(code(join(SRC, 'ui', 'app.js')), /host\.attach\(canvas\)/);
});

test('shaders : version 300 es, aucune ressource externe', () => {
  for (const [name, { vs, fs }] of Object.entries(PROGRAM_SOURCES)) {
    assert.match(vs, /^#version 300 es/, `${name} vs`);
    assert.match(fs, /^#version 300 es/, `${name} fs`);
    assert.ok(!/https?:|\/\//.test(vs + fs), `${name} : pas d'URL ni de commentaire`);
  }
});

test('V3-29 : aucun Math.random dans src/render/ (commentaires ignorés)', () => {
  for (const p of walk(join(SRC, 'render'))) assert.ok(!/Math\.random/.test(code(p)), rel(p));
});

test('l\'hôte et gl/ n\'utilisent ni réseau ni stockage', () => {
  for (const p of walk(join(SRC, 'render')).filter((f) => /host\.js$|[\\/]gl[\\/]/.test(f))) {
    assert.ok(!/fetch|XMLHttpRequest|sendBeacon|WebSocket|localStorage|https?:\/\//.test(code(p)), rel(p));
  }
});
