// Hors ligne (U10) : sw.js à jour (liste + version), contenu du précache, fermeture des imports, comportement du worker (faux contexte), manifeste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, patchSw, listFiles, renderBlock, computeVersion, NOT_PRECACHED } from '../../tools/gen-sw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const swText = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

function parseBlock(text) {
  const version = /const VERSION = '([^']+)'/.exec(text)[1];
  const list = [...text.slice(text.indexOf('const PRECACHE'), text.indexOf('// </gen-sw>')).matchAll(/'(\.\/[^']*)'/g)].map((m) => m[1]);
  return { version, list };
}

test('sw.js est à jour : liste et version recalculées = celles du fichier (sinon : node tools/gen-sw.mjs)', () => {
  const { block } = build(ROOT);
  assert.equal(patchSw(swText, block), swText);
});

test('précache : index, manifeste, icônes, sources, niveaux ; jamais proofs, tools, tests, docs, _v1, _pilots', () => {
  const { list } = parseBlock(swText);
  for (const f of ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './src/main.js', './src/load.js', './levels/index.json']) assert.ok(list.includes(f), f);
  for (const f of list) {
    assert.doesNotMatch(f, /(^|\/)(proofs|tools|tests|docs|node_modules|_v1|_pilots|\.tmp|\.git)(\/|$)/, f);
    if (f !== './') assert.ok(existsSync(path.join(ROOT, f)), `fichier absent : ${f}`);
  }
  assert.equal(new Set(list).size, list.length, 'pas de doublon');
});

test('précache : chaque niveau de l\'index est dans la liste', () => {
  const { list } = parseBlock(swText);
  const idx = JSON.parse(readFileSync(path.join(ROOT, 'levels', 'index.json'), 'utf8'));
  for (const ch of idx.chapters) for (const id of ch.levels) assert.ok(list.includes(`./levels/${id}.json`), id);
});

test('précache complet : tout import statique ou dynamique de src/ et tout script de index.html est dans la liste', () => {
  const { list } = parseBlock(swText);
  const set = new Set(list);
  const files = list.filter((f) => f.startsWith('./src/') && f.endsWith('.js'));
  assert.ok(files.length > 20);
  for (const f of files) {
    const text = readFileSync(path.join(ROOT, f), 'utf8');
    const specs = [...text.matchAll(/(from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => ({ dynamic: m[1].startsWith('import'), s: m[2] }));
    for (const { dynamic, s } of specs) {
      const target = './' + path.posix.normalize(path.posix.join(path.posix.dirname(f.slice(2)), s));
      if (dynamic && NOT_PRECACHED.includes(target.slice(2))) continue; // banc de développement (?bench) : import dynamique, hors précache (V8)
      assert.ok(set.has(target), `${f} importe ${s} -> ${target} absent du précache`);
    }
  }
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="(\.?\/?[^"#:]+)"/g)) {
    const target = './' + m[1].replace(/^\.\//, '');
    assert.ok(set.has(target), `index.html référence ${m[1]} absent du précache`);
  }
});

test('gen-sw : liste stable, version = hachage des contenus (fins de ligne ignorées), sensible à un changement', () => {
  const files = listFiles(ROOT);
  assert.deepEqual(files, [...new Set(files)]);
  const v = computeVersion(ROOT, files);
  assert.match(v, /^[0-9a-f]{12}$/);
  assert.equal(computeVersion(ROOT, files), v);
  assert.notEqual(computeVersion(ROOT, files.slice(1)), v);
  assert.match(renderBlock(['a.js'], 'abc'), /const VERSION = 'abc';[\s\S]*'\.\/a\.js'/);
  assert.throws(() => patchSw('rien', 'x'), /marqueurs/);
});

test('sw.js : pas de skipWaiting, aucune URL absolue, aucune API réseau hors fetch(req), pas d\'écriture dans le cache en réponse à un fetch', () => {
  assert.doesNotMatch(swText, /skipWaiting/);
  assert.doesNotMatch(swText, /https?:\/\//);
  for (const w of ['XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'importScripts']) assert.ok(!swText.includes(w), w);
  const calls = [...swText.matchAll(/\bfetch\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(calls, ['req'], 'seul appel : fetch(req) pour une requête de la même origine');
  assert.match(swText, /url\.origin !== self\.location\.origin\) return/);
  assert.doesNotMatch(swText, /cache\.put|cache\.add\(/);
});

/** Exécute sw.js dans un bac à sable avec un faux `caches` / `self`. */
function runWorker({ files = {}, oldCaches = [], origin = 'http://127.0.0.1:4200', networkDown = true } = {}) {
  const store = new Map(); // nom de cache -> Map(url -> Response)
  const listeners = {};
  const net = [], added = [];
  class FakeRequest { constructor(u, init = {}) { this.raw = u; this.url = new URL(u, origin + '/sw.js').href; this.cache = init.cache; } }
  class FakeResponse { constructor(body, init = {}) { this.body = body; this.status = init.status || 200; } }
  const caches = {
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name);
      return {
        async addAll(reqs) { for (const q of reqs) { added.push(q); const u = typeof q === 'string' ? q : q.raw; m.set(new URL(u, origin + '/sw.js').href, new FakeResponse(files[u] ?? `contenu de ${u}`)); } },
        async match(req, opt = {}) {
          const raw = typeof req === 'string' ? new URL(req, origin + '/sw.js').href : req.url;
          for (const [k, v] of m) {
            if (k === raw || (opt.ignoreSearch && k.split('?')[0] === raw.split('?')[0])) return v;
          }
          return undefined;
        },
      };
    },
    async keys() { return [...store.keys()]; },
    async delete(n) { return store.delete(n); },
  };
  for (const n of oldCaches) store.set(n, new Map());
  const sandbox = {
    self: { location: { origin }, addEventListener(t, f) { listeners[t] = f; } },
    caches, Response: FakeResponse, Request: FakeRequest, URL,
    fetch: async (req) => { net.push(req.url); if (networkDown) throw new Error('réseau coupé'); return new FakeResponse('réseau'); },
  };
  vm.runInNewContext(swText, sandbox);
  const waitFor = async (type) => { let p; listeners[type]({ waitUntil: (x) => { p = x; } }); await p; };
  const fetchEvent = (url, { method = 'GET', mode = 'cors' } = {}) => {
    let answered; let responded = false;
    listeners.fetch({ request: { url, method, mode }, respondWith: (p) => { responded = true; answered = p; } });
    return { responded, answer: answered };
  };
  return { store, net, added, waitFor, fetchEvent, listeners };
}

test('worker : installation = tout le précache dans le cache prismaze-<VERSION> ; activation supprime les anciennes versions seulement', async () => {
  const { version, list } = parseBlock(swText);
  const w = runWorker({ oldCaches: ['prismaze-ancienne', 'autre-site'] });
  await w.waitFor('install');
  assert.deepEqual([...w.store.keys()].sort(), ['autre-site', 'prismaze-ancienne', `prismaze-${version}`].sort());
  assert.equal(w.store.get(`prismaze-${version}`).size, list.length);
  await w.waitFor('activate');
  assert.deepEqual([...w.store.keys()].sort(), ['autre-site', `prismaze-${version}`].sort(), 'seules les anciennes prismaze-* partent');
  assert.equal('message' in w.listeners, false);
});

test('worker hors ligne : un fichier du cache est servi sans réseau ; une navigation reçoit index.html ; un fichier inconnu : 503 ; aucun appel réseau', async () => {
  const w = runWorker({ files: { './index.html': 'PAGE', './src/main.js': 'MAIN' }, networkDown: true });
  await w.waitFor('install');
  const a = w.fetchEvent('http://127.0.0.1:4200/src/main.js');
  assert.equal(a.responded, true);
  assert.equal((await a.answer).body, 'MAIN');
  const nav = w.fetchEvent('http://127.0.0.1:4200/?level=x&debug', { mode: 'navigate' });
  assert.equal((await nav.answer).body, 'PAGE');
  const miss = w.fetchEvent('http://127.0.0.1:4200/levels/inconnu.json');
  assert.equal((await miss.answer).status, 503);
  assert.deepEqual(w.net, ['http://127.0.0.1:4200/levels/inconnu.json'], 'le seul essai réseau est le fichier inconnu, de la même origine');
});

test('worker : autre origine et méthodes non GET ne sont pas interceptées (pas de respondWith)', async () => {
  const w = runWorker();
  await w.waitFor('install');
  assert.equal(w.fetchEvent('https://exemple.test/x.js').responded, false);
  assert.equal(w.fetchEvent('http://127.0.0.1:4200/src/main.js', { method: 'POST' }).responded, false);
  assert.equal(w.net.length, 0);
});

test('manifeste : nom, démarrage relatif, icônes existantes, fond sombre', () => {
  const m = JSON.parse(readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'Prismaze');
  assert.equal(m.start_url, './');
  assert.equal(m.display, 'standalone');
  assert.match(m.background_color, /^#06061a$/i);
  assert.ok(m.icons.length >= 2);
  for (const i of m.icons) assert.ok(existsSync(path.join(ROOT, i.src)), i.src);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
});

test('icônes : SVG bien formés, sans script ni référence externe', () => {
  for (const f of readdirSync(path.join(ROOT, 'icons'))) {
    const t = readFileSync(path.join(ROOT, 'icons', f), 'utf8');
    assert.match(t, /^<svg[\s>]/);
    assert.doesNotMatch(t, /<script|href=|onload/i);
    assert.ok(statSync(path.join(ROOT, 'icons', f)).size < 4000, `${f} léger`);
  }
});

test('V8 : les fichiers exclus du précache ne sont importés statiquement par aucun fichier précaché', () => {
  const { list } = parseBlock(swText);
  for (const x of NOT_PRECACHED) assert.ok(!list.includes(`./${x}`), `${x} encore précaché`);
  for (const f of list.filter((g) => g.startsWith('./src/') && g.endsWith('.js'))) {
    const text = readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of text.matchAll(/from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f.slice(2)), m[1]));
      assert.ok(!NOT_PRECACHED.includes(target), `${f} importe statiquement ${target}`);
    }
  }
});

test('V9b (audit G2) : le précache contourne le cache HTTP (new Request(u, { cache: « reload » })) pour chaque fichier', async () => {
  assert.match(swText, /new Request\(u, \{ cache: 'reload' \}\)/);
  const { list } = parseBlock(swText);
  const w = runWorker();
  await w.waitFor('install');
  assert.equal(w.added.length, list.length);
  assert.ok(w.added.every((q) => typeof q === 'object' && q.cache === 'reload'), 'chaque requête du précache est en cache: reload');
  assert.deepEqual(w.added.map((q) => q.raw), list);
});
