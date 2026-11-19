// Service worker de Prismaze (ARCHITECTURE_V2 U10) : cache d'abord, hors ligne après la première visite.
// Le bloc entre les deux marqueurs est écrit par `node tools/gen-sw.mjs` (liste des fichiers + version = hachage de leur contenu) :
// ne pas le modifier à la main ; `tests/sw/sw.test.mjs` échoue si le bloc est périmé.
// Pas de prise de contrôle immédiate (U10) : une nouvelle version attend la fermeture des onglets (pas de mélange d'anciens et de nouveaux fichiers).
// Ce worker ne lit que des fichiers de la même origine (le jeu lui-même) ; il n'envoie rien nulle part.

// <gen-sw>
const VERSION = 'd391314c3cf5';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-maskable.svg',
  './icons/icon.svg',
  './src/audio/ambient.js',
  './src/audio/audio.js',
  './src/audio/sounds.js',
  './src/debug.js',
  './src/dev-levels.js',
  './src/engine/board.js',
  './src/engine/colors.js',
  './src/engine/daily.js',
  './src/engine/dirs.js',
  './src/engine/hint.js',
  './src/engine/level.js',
  './src/engine/share.js',
  './src/engine/solver.js',
  './src/engine/state.js',
  './src/engine/trace.js',
  './src/load.js',
  './src/main.js',
  './src/render/effects.js',
  './src/render/gl/context.js',
  './src/render/gl/diagnostics.js',
  './src/render/gl/draw.js',
  './src/render/gl/piece-data.js',
  './src/render/gl/programs.js',
  './src/render/gl/shaders.js',
  './src/render/gl/targets.js',
  './src/render/host.js',
  './src/render/particles.js',
  './src/render/pieces.js',
  './src/render/renderer.js',
  './src/render/scene/camera.js',
  './src/render/scene/governor.js',
  './src/render/scene/hud.js',
  './src/render/scene/layout.js',
  './src/render/scene/particles-sim.js',
  './src/render/scene/quality.js',
  './src/render/scene/scrim.js',
  './src/render/scene/segments.js',
  './src/render/scene/victory.js',
  './src/render/sprites.js',
  './src/render/static-layer.js',
  './src/render/symbols.js',
  './src/render/theme.js',
  './src/storage/save.js',
  './src/ui/a11y.js',
  './src/ui/achievements.js',
  './src/ui/app.js',
  './src/ui/daily.js',
  './src/ui/editor-model.js',
  './src/ui/editor.js',
  './src/ui/events.js',
  './src/ui/game.js',
  './src/ui/history-v2.js',
  './src/ui/history.js',
  './src/ui/home-scene.js',
  './src/ui/home.js',
  './src/ui/hud.js',
  './src/ui/input.js',
  './src/ui/intro.js',
  './src/ui/level-names.js',
  './src/ui/menu.js',
  './src/ui/progress.js',
  './src/ui/route.js',
  './src/ui/scroll-cue.js',
  './src/ui/settings.js',
  './src/ui/share-ui.js',
  './src/ui/stage.js',
  './src/ui/version.js',
  './src/ui/wordmark.js',
  './src/workers/solve-client.js',
  './src/workers/solve-worker.js',
  './levels/c01-rouge.json',
  './levels/c02-melange.json',
  './levels/c03-filtre.json',
  './levels/c04-deux-lumieres.json',
  './levels/c05-paralleles.json',
  './levels/c06-jaune.json',
  './levels/c07-bleu-barre.json',
  './levels/c08-cascade.json',
  './levels/c09-cyan.json',
  './levels/c10-trois-sources.json',
  './levels/index.json',
  './levels/m01-tourner.json',
  './levels/m02-glisser.json',
  './levels/m03-traverser.json',
  './levels/m04-contourner.json',
  './levels/m05-fixe-et-leurre.json',
  './levels/m06-serpent.json',
  './levels/m07-crochet.json',
  './levels/m08-zigzag.json',
  './levels/m09-cinq-cibles.json',
  './levels/m10-grand-final.json',
  './levels/p01-prisme.json',
  './levels/p02-violet.json',
  './levels/p03-trois-couleurs.json',
  './levels/p04-sous-l-emetteur.json',
  './levels/p05-le-filtre.json',
  './levels/p06-jaune.json',
  './levels/p07-cyan.json',
  './levels/p08-violet-en-colonne.json',
  './levels/p09-double-partage.json',
  './levels/p10-detour-jaune.json',
  './levels/s01-separateur.json',
  './levels/s02-deux-voies.json',
  './levels/s03-portail.json',
  './levels/s04-passage.json',
  './levels/s05-porte.json',
  './levels/s06-la-cible-cle.json',
  './levels/s07-retour.json',
  './levels/s08-porte-du-fond.json',
  './levels/s09-grand-ensemble.json',
  './levels/s10-tout-ensemble.json',
  './levels/x01-cyan-et-bleu.json',
  './levels/x02-porte-et-prisme.json',
  './levels/x03-deux-sources.json',
  './levels/x04-rouge-et-vert.json',
  './levels/x05-cle.json',
  './levels/x06-trois-teintes.json',
  './levels/x07-verrou.json',
  './levels/x08-passage.json',
  './levels/x09-six-pieces.json',
  './levels/x10-examen.json',
  './levels/daily-pool/daily-0.json',
  './levels/daily-pool/daily-1.json',
  './levels/daily-pool/daily-2.json',
  './levels/daily-pool/daily-3.json',
  './levels/daily-pool/daily-4.json',
  './levels/daily-pool/daily-5.json',
  './levels/daily-pool/daily-6.json',
];
// </gen-sw>

const CACHE = `prismaze-${VERSION}`;

self.addEventListener('install', (event) => {
  // V9b (audit G2) : `cache: 'reload'` contourne le cache HTTP du navigateur : jamais de fichiers d'une ancienne version mélangés au nouveau cache.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n.startsWith('prismaze-') && n !== CACHE).map((n) => caches.delete(n)))),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // jamais d'autre origine
  event.respondWith(answer(req));
});

async function answer(req) {
  const cache = await caches.open(CACHE);
  // Une navigation (adresse du jeu avec ?level=, #play=...) reçoit la page d'accueil mise en cache.
  const hit = req.mode === 'navigate' ? await cache.match('./index.html', { ignoreSearch: true }) : await cache.match(req, { ignoreSearch: false });
  if (hit) return hit;
  try {
    return await fetch(req);
  } catch (e) {
    return new Response('Hors ligne : ce fichier n\'est pas dans le cache.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
