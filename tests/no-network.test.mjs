// Aucune donnée ne sort : pas d'API réseau dans src/, sauf l'unique appel de src/load.js (URL relatives).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const NET_WORDS = ['fetch', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource'];
const URL_RE = /https?:\/\//;
const rel = (p) => relative(ROOT, p).replaceAll('\\', '/');
const files = walk(SRC);

export function netFindings(text) {
  return NET_WORDS.filter((w) => text.includes(w)).concat(URL_RE.test(text) ? ['url-absolue'] : []);
}

test('src/ contient au moins les modules de J1', () => {
  const names = files.map(rel);
  for (const f of ['src/main.js', 'src/load.js', 'src/engine/trace.js', 'src/render/renderer.js']) assert.ok(names.includes(f), f);
});

for (const file of files) {
  const name = rel(file);
  if (name === 'src/load.js') continue;
  test(`pas de réseau : ${name}`, () => {
    assert.deepEqual(netFindings(readFileSync(file, 'utf8')), []);
  });
}

test('src/load.js : un seul appel fetch, aucune autre API réseau, aucune URL absolue', () => {
  const text = readFileSync(join(SRC, 'load.js'), 'utf8');
  assert.equal([...text.matchAll(/\bfetch\s*\(/g)].length, 1, 'exactement un appel fetch(');
  assert.equal([...text.matchAll(/\bfetch\b/g)].length, 1, 'le mot fetch n\'apparaît qu\'une fois (pas de référence détournée)');
  for (const w of NET_WORDS.slice(1)) assert.ok(!text.includes(w), w);
  assert.ok(!URL_RE.test(text), 'URL absolue');
  assert.match(text, /import\.meta\.url/, 'URL relatives au module');
});

test('index.html : aucune ressource externe', () => {
  // Seule exception : le lien cliquable vers le dépôt public (« À propos »). Un lien n'envoie rien tant
  // qu'on ne clique pas ; il doit apparaître exactement une fois, sous cette forme.
  const REPO_LINK = 'href="https://github.com/MalikChopa/prismaze" target="_blank" rel="noopener noreferrer"';
  const raw = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.equal(raw.split(REPO_LINK).length - 1, 1, 'le lien du dépôt figure une fois');
  const html = raw.replace(REPO_LINK, '').replace('>github.com/MalikChopa/prismaze<', '><');
  assert.ok(!URL_RE.test(html));
  assert.ok(!/\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'pas d\'URL sans protocole');
});

test('le détecteur reconnaît chaque motif (contrôle du test lui-même)', () => {
  for (const w of NET_WORDS) assert.ok(netFindings(`x.${w}(1)`).includes(w), w);
  assert.ok(netFindings('a = "https://example.org/x"').includes('url-absolue'));
  assert.ok(netFindings('a = "http://example.org/x"').includes('url-absolue'));
  assert.deepEqual(netFindings('const u = new URL("../levels/", import.meta.url);'), []);
});
