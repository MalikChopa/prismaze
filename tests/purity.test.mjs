// R15 : src/engine/ est pur. Aucun accès au navigateur, à Node, à l'horloge, à l'aléa ni au réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = fileURLToPath(new URL('../src/engine/', import.meta.url));

export const FORBIDDEN = [
  'document', 'window', 'localStorage', 'node:', 'Date.now', 'Date(', 'Math.random', 'performance.', 'crypto',
  'fetch', 'XMLHttpRequest', 'require(', 'process.', 'globalThis', 'setTimeout', 'setInterval', 'requestAnimationFrame',
];

export function findForbidden(text, words = FORBIDDEN) {
  return words.filter((w) => text.includes(w));
}

const files = readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.js'));

test('src/engine/ contient les modules attendus (J0-J1 : colors.js ajouté)', () => {
  for (const f of ['dirs.js', 'colors.js', 'board.js', 'trace.js', 'level.js', 'state.js']) assert.ok(files.includes(f), f);
});

for (const f of files) {
  test(`pureté : src/engine/${f} sans API interdite`, () => {
    const text = readFileSync(join(ENGINE_DIR, f), 'utf8');
    assert.deepEqual(findForbidden(text), []);
  });

  test(`pureté : src/engine/${f} n'importe que des modules du même dossier`, () => {
    const text = readFileSync(join(ENGINE_DIR, f), 'utf8');
    const specs = [...text.matchAll(/^\s*(?:import|export)\b[^'"\n]*from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    for (const s of specs) assert.match(s, /^\.\/[a-z-]+\.js$/, `import « ${s} » dans ${f}`);
    assert.doesNotMatch(text, /\bimport\s*\(/, 'pas d\'import dynamique');
  });
}

test('le détecteur reconnaît chaque motif interdit (contrôle du test lui-même)', () => {
  const samples = {
    document: 'document.body', window: 'window.innerWidth', localStorage: 'localStorage.getItem(1)', 'node:': 'import fs from "node:fs"',
    'Date.now': 'Date.now()', 'Date(': 'new Date()', 'Math.random': 'Math.random()', 'performance.': 'performance.now()', crypto: 'crypto.randomUUID()',
  };
  for (const [w, text] of Object.entries(samples)) assert.ok(findForbidden(text).includes(w), w);
  assert.deepEqual(findForbidden('const x = (o - d) & 3;'), []);
});
