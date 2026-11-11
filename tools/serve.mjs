// Serveur statique local pour Prismaze : node:http, 127.0.0.1, sans dépendance.
// Usage : node tools/serve.mjs [port]   (sans port : premier port libre >= 4180)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const FIRST_PORT = 4180;
const MAX_TRIES = 100;

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

// Transforme une URL de requête en chemin disque sous root, ou renvoie un code d'erreur.
async function resolveRequest(rawUrl, root) {
  let pathname;
  try {
    // Pas de new URL() ici : il normalise « /../ » et masquerait la tentative.
    pathname = decodeURIComponent(rawUrl.split(/[?#]/)[0]);
  } catch { return { status: 400 }; }
  if (!pathname.startsWith('/')) return { status: 400 };
  if (pathname.includes('\0') || pathname.includes('\\')) return { status: 400 };
  const parts = pathname.split('/').filter((p) => p !== '');
  if (parts.some((p) => p === '..' || p === '.')) return { status: 403 };
  if (parts.some((p) => p.startsWith('.'))) return { status: 404 }; // .git, .claude, .env...
  if (parts[0] === 'node_modules') return { status: 404 };
  let file = path.join(root, ...parts);
  if (file !== root && !file.startsWith(root + path.sep)) return { status: 403 };
  try {
    let st = await fs.promises.stat(file);
    if (st.isDirectory()) { // pas de listing : seulement un index.html s'il existe
      file = path.join(file, 'index.html');
      st = await fs.promises.stat(file);
    }
    if (!st.isFile()) return { status: 404 };
    const real = await fs.promises.realpath(file);
    const realRoot = await fs.promises.realpath(root);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return { status: 403 };
    return { status: 200, file, size: st.size };
  } catch { return { status: 404 }; }
}

export function createHandler(root = ROOT) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return send(res, 405, 'Méthode non permise');
    }
    const r = await resolveRequest(req.url || '/', root);
    if (r.status !== 200) return send(res, r.status, r.status === 404 ? 'Introuvable' : 'Refusé');
    const type = MIME[path.extname(r.file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': r.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(r.file).on('error', () => res.destroy()).pipe(res);
  };
}

function listenOn(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (e) => { server.off('listening', onOk); reject(e); };
    const onOk = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onOk);
    server.listen(port, HOST);
  });
}

// Démarre le serveur. port fourni : on l'exige ; sinon premier port libre >= 4180.
export async function startServer({ port, root = ROOT } = {}) {
  const handler = createHandler(root);
  const candidates = port ? [port] : Array.from({ length: MAX_TRIES }, (_, i) => FIRST_PORT + i);
  for (const p of candidates) {
    const server = http.createServer((req, res) => {
      handler(req, res).catch(() => { if (!res.headersSent) send(res, 500, 'Erreur'); else res.destroy(); });
    });
    try {
      await listenOn(server, p);
      const actual = server.address().port;
      return {
        server, port: actual, url: `http://${HOST}:${actual}/`,
        close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }),
      };
    } catch (e) {
      if (e.code !== 'EADDRINUSE' || port) throw e;
    }
  }
  throw new Error(`Aucun port libre entre ${FIRST_PORT} et ${FIRST_PORT + MAX_TRIES - 1}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  const port = arg === undefined ? undefined : Number(arg);
  if (arg !== undefined && !(Number.isInteger(port) && port >= 1 && port <= 65535)) {
    console.error('Port invalide :', arg);
    process.exit(2);
  }
  const s = await startServer({ port });
  console.log(`Prismaze : ${s.url}  (Ctrl+C pour arrêter)`);
  process.on('SIGINT', async () => { await s.close(); process.exit(0); });
}
