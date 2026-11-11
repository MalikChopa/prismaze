import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { startServer } from '../tools/serve.mjs';

// Requête brute : fetch normalise « /../ » avant l'envoi, http.get non.
function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

test('package.json : module ES, sans dépendance', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.test, 'node --test "tests/**/*.test.mjs"'); // limite aux tests du dossier tests/ (docs/audit-* contiennent des scripts jetables)
  assert.equal(pkg.scripts.serve, 'node tools/serve.mjs');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.author, undefined);
  assert.equal(pkg.repository, undefined);
});

test('serve.mjs : sert index.html (200), les bons types MIME, refuse ../ et les listings', async () => {
  const s = await startServer();
  try {
    assert.ok(s.port >= 4180);
    const home = await rawGet(s.port, '/');
    assert.equal(home.status, 200);
    assert.match(home.type, /text\/html/);
    assert.match(home.body, /<canvas/);
    const js = await rawGet(s.port, '/src/main.js');
    assert.equal(js.status, 200);
    assert.match(js.type, /text\/javascript/);
    const json = await rawGet(s.port, '/package.json');
    assert.match(json.type, /application\/json/);
    for (const bad of ['/../package.json', '/%2e%2e/package.json', '/src/../../x', '/..%2f..%2fetc/passwd', '/src%5C..%5Cmain.js']) {
      const r = await rawGet(s.port, bad);
      assert.ok(r.status >= 400 && r.status < 500, `${bad} -> ${r.status}`);
    }
    assert.equal((await rawGet(s.port, '/src/')).status, 404); // pas de listing
    assert.equal((await rawGet(s.port, '/.git/config')).status, 404);
    assert.equal((await rawGet(s.port, '/nexiste-pas.js')).status, 404);
  } finally {
    await s.close();
  }
});

test('serve.mjs : un port occupé est refusé quand il est imposé, sinon on prend le suivant', async () => {
  const a = await startServer();
  try {
    await assert.rejects(startServer({ port: a.port }), { code: 'EADDRINUSE' });
    const b = await startServer();
    assert.notEqual(b.port, a.port);
    await b.close();
  } finally {
    await a.close();
  }
});

test('tools/serve.mjs en ligne de commande : affiche l\'URL, sert /, puis s\'arrête', async () => {
  const child = spawn(process.execPath, ['tools/serve.mjs'], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const url = await new Promise((resolve, reject) => {
      let out = '';
      const t = setTimeout(() => reject(new Error('pas d\'URL affichée')), 5000);
      child.stdout.on('data', (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+\//); if (m) { clearTimeout(t); resolve(m[0]); } });
      child.on('exit', () => reject(new Error('serveur arrêté trop tôt')));
    });
    const res = await fetch(url);
    assert.equal(res.status, 200);
    await res.arrayBuffer();
  } finally {
    child.kill();
  }
});
