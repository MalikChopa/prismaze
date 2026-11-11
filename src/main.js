// Point d'entrée : sauvegarde, sons, coque (src/ui/app.js), service worker.
// `?level=<id>` : un niveau de développement (src/dev-levels.js) ou levels/<id>.json, directement (sans menu, ni verrouillage, ni sauvegarde de score).
// `?debug` : crochet de test en lecture seule ; `?bench` : banc de fluidité ; `?motion=reduce|full` : force le mouvement réduit ; `?nosw` : sans service worker.
// `?r=gl|2d|auto` : rendu (V1 : `gl` = sol WebGL derrière le jeu) ; `?nogl` : comme un navigateur sans WebGL2 ; `?noparallel`, `?gltest` : essais.
import { loadIndex, loadLevel, loadDailyPool } from './load.js';
import { DEV_LEVELS } from './dev-levels.js';
import { createApp, rendererParams } from './ui/app.js';
import { createStore, probeStorage } from './storage/save.js';
import { createAudio } from './audio/audio.js';
import { createHost } from './render/host.js';

const params = new URLSearchParams(location.search);

// Grain : une tuile de bruit 128x128 générée une fois, en fond CSS (opacité 0,06 dans la feuille de style). Coût nul par image.
function makeGrain() {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const g = tile.getContext('2d');
  const img = g.createImageData(128, 128);
  let s = 0x9e3779b9;
  for (let i = 0; i < img.data.length; i += 4) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; // xorshift32 : pas de Math.random
    const v = (s >>> 0) & 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  document.getElementById('grain').style.backgroundImage = `url(${tile.toDataURL()})`;
}

// Service worker (U10) : seulement sur http(s), jamais avec ?nosw ; une erreur n'arrête pas le jeu.
function registerWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  if (params.has('nosw')) { // développement : on retire un éventuel worker déjà installé (il servirait d'anciens fichiers)
    navigator.serviceWorker.getRegistrations().then((list) => list.forEach((r) => r.unregister())).catch(() => {});
    return;
  }
  navigator.serviceWorker.register('./sw.js').catch(() => { /* hors ligne indisponible : le jeu marche quand même */ });
}

async function main() {
  makeGrain();
  const store = createStore({ storage: probeStorage(() => window.localStorage) });
  const audio = createAudio({ target: window, doc: document, muted: store.settings.muted });
  const host = createHost({ doc: document, win: window, params: rendererParams(params, store.settings.renderer) }); // un seul hôte, dès le départ, d'après le réglage du joueur (une adresse `?r=` reste prioritaire)
  const app = createApp({
    doc: document, win: window, store, audio, params, host, loadIndex, loadLevel, loadDailyPool, devLevels: DEV_LEVELS,
    context2d: (cv) => cv.getContext('2d'), // V11 : scène de l'accueil (Canvas 2D) ; V3-1 : seul main.js crée ce contexte hors du rendu du jeu
    benchFactory: params.has('bench') ? async () => (await import('./bench.js')).createBench() : null,
  });
  if (params.has('debug')) {
    const { installDebug } = await import('./debug.js');
    installDebug({ snapshot: () => app.snapshot() });
  }
  if (params.has('debug')) window.__prismazeHome = app.homeDebug; // V11 : scène de l'accueil pilotée image par image (analyse de flashs) ; jamais en jeu normal
  if (params.has('debug') || params.has('gltest')) window.__prismazeHost = host; // lecture de l'état du rendu par les essais (V1) ; jamais en jeu normal
  await app.start();
  registerWorker();
}

main().catch((e) => {
  const msg = document.getElementById('msg');
  msg.hidden = false;
  msg.textContent = `Erreur : ${e && e.message ? e.message : e}`;
});
