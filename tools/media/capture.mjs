// Produit les images du README à partir de VRAIES images de Chrome (aucune retouche) : docs/media/{menu,jeu,victoire}.jpg et docs/media/demo.gif.
// Usage : node tools/media/capture.mjs [--out dossier] [--no-gif]
// Besoins : Chrome installé ; le pilote d'essais tools/e2e/ et son playwright-core (présents dans le dépôt de travail, absents de la copie publique) ;
// ffmpeg dans le PATH, uniquement pour fabriquer le GIF : il ne fait pas partie du jeu et le jeu ne s'en sert jamais.
// Le GIF : un vrai enregistrement (Page.startScreencast) d'un niveau résolu en suivant l'indice du jeu, entrées réelles à la souris.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const MAX_JPEG_BYTES = 150_000;
const VIEWPORT = { width: 1280, height: 800 };
const QUALITIES = [84, 76, 68, 60, 52, 44];
const SHOT_LEVEL = 'p03-trois-couleurs';
const GIF_LEVEL = 'p03-trois-couleurs';
const GIF_WIDTH = 480;
const GIF_FPS = 10;
const HINTS_BEFORE_SHOT = 2; // en pleine partie : assez de pièces posées pour voir les couleurs
const SEEDED_LEVELS = 17; // progression factice du menu (aucune donnée de joueur)

async function loadDriver() {
  try {
    const cdp = await import(new URL('../e2e/cdp.mjs', import.meta.url).href);
    const helpers = await import(new URL('../e2e/helpers5.mjs', import.meta.url).href);
    const nav = await import(new URL('../e2e/nav.mjs', import.meta.url).href); // V12 : nouvel accueil (V11) : accueil -> Niveaux -> chapitre -> niveau
    return { ...cdp, solveByHints: helpers.solveByHints, pieceAt: helpers.pieceAt, waitHome: nav.waitHome, openLevel: nav.openLevel };
  } catch (e) {
    throw new Error(`pilote tools/e2e/ introuvable (il n'est pas publié ; cet outil se lance depuis le dépôt de travail) : ${e.message}`);
  }
}

function parseArgs(argv) {
  const i = argv.indexOf('--out');
  return { out: path.resolve(i === -1 ? path.join(REPO, 'docs', 'media') : argv[i + 1]), gif: !argv.includes('--no-gif') };
}

/** Capture en JPEG, en baissant la qualité jusqu'à tenir la limite de poids. */
async function shotJpeg(page, file) {
  for (const quality of QUALITIES) {
    await page.screenshot({ path: file, type: 'jpeg', quality });
    const size = fs.statSync(file).size;
    if (size <= MAX_JPEG_BYTES) return { size, quality };
  }
  throw new Error(`${file} : plus de ${MAX_JPEG_BYTES} octets même à la qualité la plus basse`);
}

const pageUrl = (base, query) => new URL(`?debug&nosw&r=gl&camera=1&autohide=1${query}`, base).href; // ?debug : crochet de lecture ; r=gl, camera, autohide : mêmes chemins que le joueur

async function newPage(driver, browser, errors) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  driver.watchErrors(page, errors);
  return { ctx, page };
}

/** Identifiants des niveaux livrés, dans l'ordre (levels/index.json). */
const ALL_IDS = JSON.parse(fs.readFileSync(path.join(REPO, 'levels', 'index.json'), 'utf8')).chapters.flatMap((c) => c.levels);
/** Sauvegarde factice v3 (aucune donnée de joueur) : `list` gagnés, étoiles 3 sauf un sur cinq à 2. */
function fakeSave(list) {
  const levels = {};
  list.forEach((id, i) => { levels[id] = { done: true, best: 3, stars: i % 5 === 3 ? 2 : 3 }; });
  return { v: 3, levels, daily: {}, dailyCache: null, settings: {}, drafts: [], last: list[list.length - 1], ach: {}, flags: {}, seen: { howto: true } };
}
const levelReady = (page) => page.waitForFunction(() => window.__prismaze && window.__prismaze.getState().view);
const victoryShown = (page) => page.waitForFunction(() => { const s = window.__prismaze.getState(); return s.won && s.fx.victory && s.fx.victory.revealed; });

async function shootMenu(driver, browser, base, errors, out) {
  const { ctx, page } = await newPage(driver, browser, errors);
  await page.goto(pageUrl(base, ''));
  await driver.waitHome(page);
  await page.evaluate((text) => localStorage.setItem('prismaze.save', text), JSON.stringify(fakeSave(ALL_IDS.slice(0, SEEDED_LEVELS))));
  await page.reload();
  await driver.waitHome(page);
  await driver.sleep(600);
  // Diapason (2026-11-11) : photo quand le rayon de la scène allume toutes ses cibles (sinon la vitrine montre une scène éteinte, entre deux parcours).
  for (let t = 0; t < 12000; t += 200) {
    const s = await page.evaluate(() => { const h = window.__prismaze && window.__prismaze.getState().home; return h && h.scene ? { lit: h.scene.lit, targets: (h.scene.pieces.match(/T/g) || []).length } : null; });
    if (s && s.targets > 0 && s.lit === s.targets) { await driver.sleep(400); break; }
    await driver.sleep(200);
  }
  const r = await shotJpeg(page, path.join(out, 'menu.jpg'));
  await ctx.close();
  return r;
}

/** Une étape d'indice jouée à vitesse lisible, à la souris réelle. Renvoie false s'il n'y a plus rien à jouer. */
async function playHintSlowly(driver, page) {
  await page.focus('#game');
  await page.keyboard.press('h');
  await driver.sleep(650);
  const s = await driver.getState(page);
  const h = s.hint;
  if (!h) return false;
  if (h.moves) {
    const a = driver.cellCenter(s.view, h.source.c, h.source.r);
    const b = driver.cellCenter(s.view, h.ghost.c, h.ghost.r);
    await page.mouse.move(a.x, a.y, { steps: 8 });
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 24 });
    await page.mouse.up();
    await driver.sleep(350);
  }
  const after = await driver.getState(page);
  const p = driver.pieceAt(after, h.ghost.c, h.ghost.r);
  if (p && (p.type === 'mirror' || p.type === 'splitter')) {
    for (let k = 0; k < 4 && driver.pieceAt(await driver.getState(page), h.ghost.c, h.ghost.r).o !== h.ghost.o; k++) {
      const c = driver.cellCenter(after.view, h.ghost.c, h.ghost.r);
      await page.mouse.click(c.x, c.y);
      await driver.sleep(320);
    }
  }
  await driver.sleep(250);
  return true;
}

async function shootGameAndVictory(driver, browser, base, errors, out) {
  // V10 : le VRAI parcours du joueur (V12 : accueil, Niveaux, chapitre, niveau livré), et non `?level=` : le panneau de victoire montre alors étoiles et « niveau suivant ».
  // Progression factice (aucune donnée de joueur) : tous les niveaux AVANT celui de la capture sont gagnés, celui-ci ne l'est pas (premier passage).
  const { ctx, page } = await newPage(driver, browser, errors);
  if (!ALL_IDS.includes(SHOT_LEVEL)) throw new Error(`${SHOT_LEVEL} : absent de levels/index.json`);
  const before = ALL_IDS.slice(0, ALL_IDS.indexOf(SHOT_LEVEL));
  await page.goto(pageUrl(base, ''));
  await driver.waitHome(page);
  await page.evaluate((text) => localStorage.setItem('prismaze.save', text), JSON.stringify(fakeSave(before)));
  await page.reload();
  await driver.waitHome(page);
  await driver.openLevel(page, SHOT_LEVEL); // vrais clics : accueil -> Niveaux -> chapitre -> niveau
  await levelReady(page);
  await driver.sleep(900);
  for (let i = 0; i < HINTS_BEFORE_SHOT; i++) await playHintSlowly(driver, page);
  await page.mouse.move(4, 4);
  await driver.sleep(500);
  const game = await shotJpeg(page, path.join(out, 'jeu.jpg'));
  await driver.solveByHints(page, 16);
  await victoryShown(page);
  await page.waitForFunction(() => document.querySelectorAll('#win-stars.shown .st.on').length > 0, null, { timeout: 5000 }); // étoiles affichées (sinon : échec visible)
  await driver.sleep(1000); // les étoiles CSS arrivent une à une (0,25 s d'écart, 0,45 s chacune)
  const stars = await page.evaluate(() => document.querySelectorAll('#win-stars .st.on').length);
  const next = await page.evaluate(() => { const b = document.getElementById('btn-next'); return b !== null && !b.hidden ? b.textContent.trim() : null; });
  console.log(`victoire : ${stars} étoile(s) allumée(s), bouton suivant : ${next === null ? 'absent' : next}`);
  await page.waitForFunction(() => { const e = document.getElementById('toast'); return !e || !e.classList.contains('on'); }, null, { timeout: 12000 }).catch(() => {}); // V12 : le message « Succès obtenu » (V11) éteint avant la capture
  await driver.sleep(400);
  const victory = await shotJpeg(page, path.join(out, 'victoire.jpg'));
  await ctx.close();
  return { game, victory };
}

function encodeGif(frames, dir, file) {
  const lines = [];
  frames.forEach((f, i) => {
    const next = frames[i + 1];
    lines.push(`file '${f.name}'`, `duration ${(next ? Math.max(next.t - f.t, 0.001) : 0.5).toFixed(4)}`);
  });
  lines.push(`file '${frames[frames.length - 1].name}'`); // ffmpeg ignore la durée de la dernière entrée sinon
  fs.writeFileSync(path.join(dir, 'frames.ffconcat'), `${lines.join('\n')}\n`);
  const filter = `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,hqdn3d=0:0:6:6,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', 'frames.ffconcat', '-vf', filter, '-loop', '0', '-map_metadata', '-1', file], { cwd: dir, stdio: 'pipe' });
}

async function recordGif(driver, browser, base, errors, out) {
  const { ctx, page } = await newPage(driver, browser, errors);
  await page.goto(pageUrl(base, `&level=${GIF_LEVEL}`));
  await levelReady(page);
  await driver.sleep(700);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismaze-frames-'));
  const client = await driver.cdpSession(page);
  const frames = [];
  client.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(data, 'base64'));
    frames.push({ name, t: metadata.timestamp });
    client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  try {
    await client.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });
    for (let i = 0; i < 12 && !(await driver.getState(page)).won; i++) {
      if (!(await playHintSlowly(driver, page))) break;
    }
    if (!(await driver.getState(page)).won) throw new Error(`${GIF_LEVEL} : non résolu en suivant l'indice`);
    await victoryShown(page);
    await driver.sleep(1200);
    await client.send('Page.stopScreencast');
    await driver.sleep(100);
    if (frames.length < 10) throw new Error(`trop peu d'images enregistrées : ${frames.length}`);
    const file = path.join(out, 'demo.gif');
    try {
      encodeGif(frames, dir, file);
    } catch (e) {
      if (e.code === 'ENOENT') throw new Error('ffmpeg introuvable : il sert seulement à fabriquer le GIF (relancer avec --no-gif pour s\'en passer)');
      throw e;
    }
    return { frames: frames.length, seconds: frames[frames.length - 1].t - frames[0].t, size: fs.statSync(file).size };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await ctx.close();
  }
}

async function main() {
  const { out, gif } = parseArgs(process.argv.slice(2));
  const driver = await loadDriver();
  fs.mkdirSync(out, { recursive: true });
  const errors = [];
  await driver.runWithBrowser(async ({ base, browser }) => {
    const menu = await shootMenu(driver, browser, base, errors, out);
    console.log(`menu.jpg : ${menu.size} octets (qualité ${menu.quality})`);
    const { game, victory } = await shootGameAndVictory(driver, browser, base, errors, out);
    console.log(`jeu.jpg : ${game.size} octets (qualité ${game.quality})`);
    console.log(`victoire.jpg : ${victory.size} octets (qualité ${victory.quality})`);
    if (gif) {
      const r = await recordGif(driver, browser, base, errors, out);
      console.log(`demo.gif : ${r.size} octets, ${r.frames} images enregistrées, ${r.seconds.toFixed(1)} s`);
    }
  });
  if (errors.length > 0) throw new Error(`erreurs de console pendant la capture :\n${errors.join('\n')}`);
  console.log(`médias écrits dans ${path.relative(REPO, out) || out}`);
}

main().catch((e) => { console.error(`capture : ${e.message}`); process.exit(1); });
