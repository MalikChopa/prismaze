// Coque de l'application (ARCHITECTURE_V2 U1, U2, U8) : écrans (accueil et ses sous-écrans, jeu, éditeur), routage par fragment, réglages, sauvegarde, sons.
// Un seul écran visible à la fois ; le focus suit le changement d'écran (titre de l'accueil, plateau du jeu, niveau d'origine au retour).
// V11 : nouvel accueil (home.js), intro, succès, nappe d'ambiance ; l'écran de jeu lui-même est inchangé.
import { createState } from '../engine/state.js';
import { buildBoard } from '../engine/board.js';
import { trace } from '../engine/trace.js';
import { validateLevel, replayPlacements } from '../engine/level.js';
import { parseShareCode } from '../engine/share.js';
import { createHinter, hintMessage, HINT_NONE } from '../engine/hint.js';
import { orientFromChar } from '../engine/dirs.js';
import { createHost } from '../render/host.js';
import { createGame } from './game.js';
import { uiMode, restoreClassicDom } from './hud.js';
import { FLAGS } from '../render/scene/layout.js';
import { createHome, homeHash } from './home.js';
import { createIntro, shouldPlayIntro, sessionStore, INTRO_KEY } from './intro.js';
import { computeAchievements, newlyEarned, dailyStreak, countdown, MASTERY_CHAPTER, ACHIEVEMENTS } from './achievements.js';
import { LEVEL_NAMES } from './level-names.js';
import { createAmbient } from '../audio/ambient.js';
import { createSettings, qualityNotice, QUALITY_TO_HOST } from './settings.js';
import { cellName, createAnnouncer } from './a11y.js';
import { parseHash, playHash } from './route.js';
import { computeProgress, isPlayable, nextPlayable, locate } from './progress.js';
import { starsFor } from '../storage/save.js';
import { createEditor } from './editor.js';
import { witnessPlacements } from './editor-model.js';
import { createDailyPreparer, utcDate, dailyLabel } from './daily.js';
import { shareFailureText } from './share-ui.js';
import { createSolveClient } from '../workers/solve-client.js';

const pad2 = (n) => String(n).padStart(2, '0');

/** Indice branché sur le solveur / les témoins (S7, hint.js) : renvoie l'affichage attendu par game.js. */
export function makeGetHint(level) {
  return hintFrom(createHinter(level));
}

/** Affichage d'un indice (game.js) à partir d'un générateur d'indices. */
function hintFrom(hinter) {
  return (state) => {
    const r = hinter.next(state);
    if (r.hint === null) return { none: true, text: r.reason === 'won' ? HINT_NONE.won : HINT_NONE.unavailable };
    const h = r.hint;
    // V9b (test final) : un indice sans orientation (« ranger … il gêne ») garde celle de la pièce : le fantôme la montre telle qu'elle sera posée
    const moved = h.o === null ? state.pieces.find((p) => p.c === h.from[0] && p.r === h.from[1] && p.type === h.type) : null;
    return {
      ghost: { c: h.at[0], r: h.at[1], o: h.o !== null ? orientFromChar(h.o) : moved && Number.isInteger(moved.o) ? moved.o : 0, type: h.type, mask: h.mask },
      source: { c: h.from[0], r: h.from[1] },
      moves: h.from[0] !== h.at[0] || h.from[1] !== h.at[1],
      text: hintMessage(h, cellName),
    };
  };
}

/** Paramètres donnés à l'hôte : le réglage du joueur (renderer) s'exprime par `r` ; une adresse `?r=` (essais) reste prioritaire. */
export function rendererParams(params, renderer) {
  const out = new URLSearchParams(params);
  if (params.has('r')) return out;
  if (renderer === 'webgl') out.set('r', 'gl');
  else if (renderer === 'canvas') out.set('r', '2d');
  return out;
}

/**
 * @param {object} deps
 *   doc, win : document et window ; store : sauvegarde (storage/save.js) ; audio : audio.js ; params : URLSearchParams
 *   loadIndex, loadLevel : load.js ; devLevels : niveaux de développement (?level=) ; bench : fabrique de banc (?bench) ou null
 */
export function createApp(deps) {
  const { doc, win, store, audio, params, loadIndex, loadLevel, devLevels } = deps;
  const debug = params.has('debug');
  const loadDailyPool = deps.loadDailyPool;
  const $ = (id) => doc.getElementById(id);
  const screens = { menu: $('screen-menu'), game: $('screen-game'), edit: $('screen-edit') };
  const canvas = $('game');
  const bootRenderer = store.settings.renderer; // le rendu est choisi une fois par chargement : un changement prend effet au prochain lancement
  // Hôte de rendu : un seul par page (Canvas 2D + sol WebGL derrière, V3-1). main.js le crée d'après le réglage du joueur (`rendererParams`) ; sans hôte fourni (essais), l'app en crée un.
  const host = deps.host || createHost({ doc, win, params: rendererParams(params, bootRenderer) });
  const msg = $('msg');
  // V3-17 / V3-21 : disposition immersive pour le joueur ; `?debug` garde l'ancienne (essais à leurs coordonnées)
  const mode = uiMode(params);
  FLAGS.immersiveLayout = mode.immersive;
  doc.documentElement.dataset.ui = mode.immersive ? 'immersive' : 'classic';
  if (!mode.immersive) restoreClassicDom(doc);
  const coarse = typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
  /** Réglages de l'interface pour le jeu en cours : ce que l'URL permet (`?camera=0`, `?autohide=0`) et ce que le joueur a choisi. */
  const uiPrefs = () => ({ camera: mode.camera && store.settings.camera, autohide: mode.autohide && store.settings.autohide, reduced: reducedMotion() });
  // V3-24 / P18 : plaques de verre sans flou en qualité Basse
  const applyFx = () => { doc.documentElement.dataset.fx = host.quality === 2 ? 'low' : 'full'; };
  applyFx();
  let qualityLevel = host.quality;
  let qualityNoteTimer = 0;
  if (typeof host.onChange === 'function') {
    host.onChange((ev) => {
      applyFx();
      const r = qualityNotice(qualityLevel, ev, store.settings.quality);
      qualityLevel = r.level;
      if (r.text !== null) showQualityNote(r.text);
      settings.refresh();
    });
  }
  /** P9 : mention discrète (4,5 s) quand le gouverneur baisse la qualité ; jamais de plein écran, jamais de son. */
  function showQualityNote(text) {
    const n = $('quality-note');
    n.textContent = text;
    n.hidden = false;
    clearTimeout(qualityNoteTimer);
    qualityNoteTimer = setTimeout(() => { n.hidden = true; }, 4500);
    say(text);
  }
  const announcer = createAnnouncer($('live'));
  const say = (t) => announcer.say(t);

  let index = { chapters: [], ids: [] };
  let game = null;
  let current = null; // {id, dev, level}
  let pushedFromMenu = false;
  // V13b (revue n° 6) : un niveau ou le défi est en cours de chargement (route play/daily, ni lancé ni refusé) : les commandes de l'accueil sont ignorées
  let launchPending = false;
  // V13b (relecture V13, R3) : succès accordés à une victoire mais pas encore montrés (panneau pas encore dévoilé : 1,3 s). Repris dans le panneau
  // de la victoire suivante (Annuler puis Rétablir) ou dans le message de l'accueil si l'on quitte le niveau avant le dévoilement.
  let unshownAch = [];
  let started = false;
  let routeToken = 0;
  let pendingFocus = null;
  let bench = null;
  const mq = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let renderer = null;
  let editor = null;
  let hintTask = null; // indice d'un niveau partagé / du jour / de test : témoin calculé dans un Worker (S7)
  let dailyPrep = null; // préparation du défi en cours {cancel}
  const client = createSolveClient({ WorkerCtor: deps.WorkerCtor });
  const prepareDaily = createDailyPreparer({ store, client, loadPool: (id) => loadDailyPool(id) });

  const progress = () => computeProgress(index.chapters, (id) => store.level(id));
  const fail = (text) => { msg.hidden = false; msg.textContent = text; };
  const clearFail = () => { msg.hidden = true; msg.textContent = ''; };

  // ---- mouvement réduit (D9, U8) : réglage, sinon préférence système ; `?motion=reduce|full` force (essais) ----
  function reducedMotion() {
    const forced = params.get('motion');
    if (forced === 'reduce') return true;
    if (forced === 'full') return false;
    const m = store.settings.motion;
    if (m === 'yes') return true;
    if (m === 'no') return false;
    return mq !== null && mq.matches;
  }
  function applyMotion() {
    const r = reducedMotion();
    doc.documentElement.dataset.motion = r ? 'reduce' : 'full';
    if (renderer) renderer.setReducedMotion(r);
    if (game) game.setUiPrefs(uiPrefs());
    if (editor) editor.setReducedMotion(r);
    home.setReducedMotion(r); // V11 : scène figée, aucune transition
  }
  if (mq && mq.addEventListener) mq.addEventListener('change', applyMotion);

  // ---- mention de stockage ----
  function syncStorageNote() {
    const note = $('storage-note');
    const st = store.status;
    if (st.mode === 'memory') { note.hidden = false; note.textContent = 'progression non sauvegardée'; } else if (st.mode === 'readonly') { note.hidden = false; note.textContent = 'sauvegarde d\'une version plus récente : lecture seule'; } else note.hidden = true;
  }

  // ---- son ----
  function applyMuted() {
    const muted = store.settings.muted;
    audio.setMuted(muted);
    if (game) game.setMutedUi(muted);
  }
  function toggleMute() {
    store.setSetting('muted', !store.settings.muted);
    applyMuted();
    settings.sync();
    say(store.settings.muted ? 'Son coupé' : 'Son activé');
    audio.play('take'); // retour sonore (ignoré si coupé)
  }

  // ---- qualité et rendu (V3-30) : le réglage du joueur passe par l'interface de l'hôte ; `?q=` (essais) reste prioritaire ----
  let appliedQuality = 'auto';
  function applyQuality() {
    const q = store.settings.quality;
    if (q === appliedQuality || params.has('q') || typeof host.setQuality !== 'function') return;
    appliedQuality = q;
    host.setQuality(QUALITY_TO_HOST[q]);
    qualityLevel = host.quality;
    applyFx();
  }
  function renderInfo() {
    return { backend: host.backend === 'gl' ? 'gl' : 'c2d', quality: host.quality };
  }

  // ---- réglages ----
  const settings = createSettings(doc, {
    store,
    renderInfo,
    bootRenderer,
    onReload() { win.location.reload(); },
    onChange(key, value) {
      store.setSetting(key, value);
      if (key === 'quality') applyQuality();
      if (key === 'motion') applyMotion();
      if (key === 'symbols' && game) game.setSymbols(value);
      if ((key === 'camera' || key === 'autohide') && game) game.setUiPrefs(uiPrefs());
      if (key === 'muted') { applyMuted(); say(value ? 'Son coupé' : 'Son activé'); }
      if (key === 'ambient') { syncAmbient(); say(value ? 'Musique d\'ambiance activée' : 'Musique d\'ambiance coupée'); }
    },
    onReset() {
      store.resetProgress();
      renderMenu();
      say('Progression effacée');
    },
  });
  function openSettings(from) { settings.open(from || doc.activeElement); if (game) game.pinUi('settings', settings.isOpen); }
  settings.onClosed = () => { if (game) game.pinUi('settings', false); };

  // ---- accueil (V11) ----
  const home = createHome(doc, win, {
    names: LEVEL_NAMES,
    context2d: deps.context2d, // V3-1 : le contexte 2D de la scène est fourni par main.js (aucun getContext dans src/ui/)
    seed: params.has('seed') ? Number.parseInt(params.get('seed'), 10) || 1 : undefined,
    go(hash) { if (launchPending) return; win.location.hash = hash; markInApp(); },
    back(parentHash) {
      if (launchPending) return; // V13b (revue n° 6) : un lancement est en cours : aucune autre navigation de l'accueil (l'historique ne s'empile pas)
      // retour : on revient dans l'historique si l'écran parent est l'entrée précédente ; sinon on remplace l'adresse (jamais de sortie du site)
      const st = win.history.state;
      if (st && st.prismaze === 'nav' && st.from === parentHash) win.history.back();
      else win.location.replace(parentHash === '#' ? `${win.location.pathname}${win.location.search}#` : parentHash);
    },
    onPlay(id, from, opts = {}) {
      if (launchPending) return;
      if (opts.replace) { pushedFromMenu = false; win.location.replace(playHash(id)); return; }
      pushedFromMenu = true;
      win.location.hash = playHash(id);
    },
    onDaily() { if (launchPending) return; pushedFromMenu = true; win.location.hash = 'daily'; },
    onEditor() { if (launchPending) return; pushedFromMenu = true; win.location.hash = 'edit'; },
    onSettings(from) { openSettings(from); },
    onAmbient() { toggleAmbient(); },
  });
  let lastHash = win.location.hash || '#';
  /** Marque l'entrée d'historique créée par une navigation interne : le bouton retour y revient par history.back(). */
  function markInApp() {
    try { win.history.replaceState({ prismaze: 'nav', from: lastHash === '' ? '#' : lastHash }, ''); } catch { /* sans importance */ }
  }

  /** Niveau que « Reprendre » ouvre : le dernier joué s'il est ouvert et pas encore gagné, sinon le premier non gagné, sinon le dernier joué. */
  function resumeTarget(p) {
    const last = store.data.last;
    const lastOk = typeof last === 'string' && isPlayable(p, last);
    if (lastOk && !(store.level(last) || {}).done) return last;
    if (p.nextId !== null) return p.nextId;
    if (lastOk) return last;
    return p.chapters.length > 0 && p.chapters[0].levels.length > 0 ? p.chapters[0].levels[0].id : null;
  }
  const dailyDates = () => Object.keys(store.data.daily);
  function achievementsList(p = progress()) {
    return computeAchievements({ progress: p, flags: store.flags, dailyDates: dailyDates(), today: utcDate(), granted: store.achievements });
  }
  function homeModel() {
    const p = progress();
    return {
      progress: p,
      resume: resumeTarget(p),
      achievements: achievementsList(p),
      ambientOn: store.settings.ambient && !store.settings.muted,
      daily() {
        const date = utcDate();
        return { date, done: store.daily(date) !== null, streak: dailyStreak(dailyDates(), date).current, countdown: countdown() };
      },
    };
  }
  function renderMenu() {
    if (index.chapters.length === 0) return;
    home.setModel(homeModel());
    home.refresh();
  }

  // ---- succès (V11) : calculés depuis la sauvegarde ; un succès obtenu en jouant est annoncé par un message discret ----
  function checkAchievements(announce) {
    if (index.chapters.length === 0) return [];
    const fresh = newlyEarned(achievementsList(), store.achievements);
    if (fresh.length === 0) return [];
    const granted = store.grantAchievements(fresh, utcDate());
    if (announce && granted.length > 0) home.toast(`Succès obtenu : ${achievementNames(granted).join(' · ')}`, 4500);
    return granted;
  }
  const achievementNames = (ids) => ids.map((id) => ACHIEVEMENTS.find((a) => a.id === id).name);

  // ---- intro et invitation « Comment jouer » (V11) ----
  const ss = sessionStore(win);
  let intro = null;
  function maybeOffer() {
    if (!home.visible || home.current !== 'home' || (intro && intro.state !== 'off')) return;
    if (store.seen.howto || progress().done > 0) return;
    home.showOffer(true);
    store.markSeen('howto'); // proposée une fois : retenu dans la sauvegarde
  }

  // ---- musique d'ambiance (V11) : seulement sur l'accueil, son activé, après un geste ; fondu à l'entrée d'un niveau ; coupée onglet caché ----
  const ambient = createAmbient({ audioContext: () => audio.context || null });
  const ambientWanted = () => store.settings.ambient && !store.settings.muted && !screens.menu.hidden && doc.visibilityState !== 'hidden';
  function syncAmbient() {
    if (ambientWanted()) ambient.start(); else ambient.stop();
    home.setAmbient(store.settings.ambient && !store.settings.muted);
  }
  if (typeof audio.onRunning === 'function') audio.onRunning(syncAmbient);
  doc.addEventListener('visibilitychange', syncAmbient);
  function toggleAmbient() {
    const on = !(store.settings.ambient && !store.settings.muted);
    if (on && store.settings.muted) { store.setSetting('muted', false); applyMuted(); }
    store.setSetting('ambient', on);
    if (typeof audio.unlock === 'function') audio.unlock(); // le geste qui demande la musique crée le contexte
    syncAmbient();
    settings.sync();
    say(on ? 'Musique d\'ambiance activée' : 'Musique d\'ambiance coupée');
  }

  function showScreen(name) {
    screens.menu.hidden = name !== 'menu';
    screens.game.hidden = name !== 'game';
    screens.edit.hidden = name !== 'edit';
    if (name !== 'edit' && editor) editor.hide();
    if (name !== 'menu') { hideDailyWait(); home.hide(); }
    syncAmbient();
  }

  function destroyGame() {
    if (game) { game.destroy(); game = null; }
    if (hintTask) { hintTask.cancel(); hintTask = null; }
    renderer = null;
    host.detach();
    current = null;
  }

  /**
   * Accueil ou un de ses écrans (V11). `r` : route ({sub, chapter}) ; un écran de niveaux verrouillé ou inconnu montre les chapitres.
   */
  function showMenu(note = '', focusId = null, r = { name: 'menu' }) {
    launchPending = false;
    destroyGame();
    showScreen('menu');
    let sub = r.sub || 'home';
    const chapter = Number.isInteger(r.chapter) ? r.chapter : 0;
    home.setModel(homeModel());
    if (sub === 'levels') {
      const ch = progress().chapters[chapter];
      if (!ch || !ch.unlocked) { sub = 'chapters'; try { win.history.replaceState(win.history.state, '', homeHash('chapters')); } catch { /* sans importance */ } }
    }
    home.note(sub === 'home' ? note : '');
    home.show(sub, { chapter, focusId, booting: bootRoute });
    if (note && sub !== 'home') home.toast(note);
    if (unshownAch.length > 0) { const text = `Succès obtenu : ${unshownAch.join(' · ')}`; unshownAch = []; home.toast(text, 4500); say(text); } // V13b (R3) : victoire quittée avant son panneau
    if (note) say(note);
    maybeOffer();
  }
  let bootRoute = true;

  // ---- jeu ----
  /** Indice d'un niveau sans `solutions` (partagé, du jour, test de l'éditeur) : le témoin est calculé dans un Worker (600 000 nœuds, S7). */
  function makeWorkerHint(level) {
    let phase = 'pending';
    let hinter = null;
    const task = client.solve(level, { maxNodes: 600000 });
    task.promise.then((r) => {
      if (r.cancelled) return;
      if (r.status === 'proved-optimal' && r.solutions.length > 0) { hinter = createHinter({ ...level, solutions: r.solutions.map((x) => x.witness) }); phase = 'ready'; } else phase = 'none';
    }).catch(() => { phase = 'none'; });
    const show = (st) => (phase === 'ready' ? hintFrom(hinter)(st) : { none: true, text: phase === 'pending' ? 'Indice en préparation : réessaie dans un instant' : HINT_NONE.unavailable });
    return { get: show, cancel: task.cancel };
  }

  /**
   * kind : 'level' (livré), 'dev' (?level=), 'daily' (défi), 'shared' (lien), 'test' (essai de l'éditeur).
   * extra : {date, par, fallback, key} selon le genre.
   */
  function launch(level, state, { id, dev, kind = dev ? 'dev' : 'level', label: forcedLabel = null, extra = {} }) {
    launchPending = false;
    destroyGame();
    showScreen('game');
    clearFail();
    renderer = host.attach(canvas);
    applyMotion();
    const place = kind === 'level' ? locate(index.chapters, level.id) : null;
    const label = forcedLabel || (place ? `${place.chapter.toUpperCase()} · ${pad2(place.n)}` : level.id.toUpperCase());
    doc.title = `${place ? `${place.chapter} ${pad2(place.n)}` : forcedLabel || level.name} · Prismaze`;
    const hooks = bench ? bench.hooks : null;
    const shipped = Array.isArray(level.solutions) && level.solutions.length > 0; // niveau livré ou de repli : témoins du fichier, aucun solveur
    let getHint;
    if (kind === 'level' || kind === 'dev' || shipped) getHint = makeGetHint(level);
    else { hintTask = makeWorkerHint(level); getHint = hintTask.get; }
    const plural = (n) => (n > 1 ? 's' : '');
    $('btn-menu').textContent = kind === 'test' ? 'ÉDITEUR' : 'MENU';
    $('btn-edit-copy').hidden = kind !== 'shared';
    const g = createGame({
      canvas, renderer, level, initial: state, label, live: $('live'), hooks,
      ui: mode.immersive ? { prefs: uiPrefs(), touch: coarse, win, root: screens.game } : null,
      symbols: store.settings.symbols,
      audio,
      getHint,
      onSolved(used, meta = {}) {
        if (kind === 'dev') return { hasStars: false, next: null };
        if (kind === 'level' || kind === 'daily') { // V11 : drapeaux des succès « Sans indice » et « Du premier coup »
          const p = kind === 'daily' ? extra.par : level.par;
          if (kind === 'level' && place && index.chapters[place.chapterIndex] && index.chapters[place.chapterIndex].id === MASTERY_CHAPTER && meta.hinted === false) store.setFlag('nohint');
          if (Number.isInteger(p) && p >= 1 && starsFor(used, p) === 3 && meta.undone === false) store.setFlag('firsttry');
        }
        if (kind === 'shared') return { hasStars: false, next: null, sub: `Résolu en ${used} pièce${plural(used)} utilisée${plural(used)} (niveau partagé : pas d'étoiles)` };
        if (kind === 'test') {
          // témoin de l'auteur : les pièces utilisées, rejouées par le moteur seul ; il débloque « Partager » (S4, F6)
          const res = trace(buildBoard(g.session.state));
          const rp = replayPlacements(level, witnessPlacements(g.session.state, res.used));
          if (rp.ok && editor) { editor.setWitness(extra.key, rp.usedMovable); return { hasStars: false, next: null, sub: `Résolu en ${rp.usedMovable} pièce${plural(rp.usedMovable)} : témoin enregistré, tu peux partager ce niveau` }; }
          return { hasStars: false, next: null, sub: `Résolu en ${used} pièce${plural(used)} (témoin non rejoué : partage indisponible)` };
        }
        const par = kind === 'daily' ? extra.par : level.par;
        const hasPar = Number.isInteger(par) && par >= 1;
        const rec = kind === 'daily' ? store.recordDaily(extra.date, used, hasPar ? par : undefined) : store.recordLevel(level.id, used, level.par);
        const earned = achievementNames(checkAchievements(false)); // V13 : écrits dans le panneau de victoire (« Succès : … »), plus de message posé sur le plateau
        unshownAch = [...new Set([...unshownAch, ...earned])];
        return {
          achievements: unshownAch.slice(),
          hasStars: hasPar, stars: starsFor(used, par), best: rec.best, isBest: rec.isBest, first: rec.first,
          next: kind === 'daily' ? null : nextPlayable(progress(), level.id),
        };
      },
      onNext() {
        if (kind === 'daily' || kind === 'shared' || kind === 'test') { onMenu(); return; }
        const nxt = nextPlayable(progress(), level.id);
        if (nxt) win.location.replace(playHash(nxt.id));
        else onMenu();
      },
      onMenu,
      onAchievementsShown() { unshownAch = []; },
      onSettings() { openSettings($('btn-settings')); },
      onToggleMute: toggleMute,
    });
    game = g;
    current = { id, dev: kind === 'dev', kind, level, extra };
    g.setMutedUi(store.settings.muted);
    g.setUiPrefs(uiPrefs());
    if (bench) bench.attach(g);
    if (kind === 'level') store.setLast(level.id);
    syncStorageNote();
  }

  function onMenu() {
    if (current && current.kind === 'test') { showEditor(); return; } // l'essai de l'éditeur revient à l'éditeur
    const id = current && current.kind === 'level' ? current.id : current && current.kind === 'daily' ? '#menu-daily' : null; // V13 : retour du défi : focus sur « Défi du jour »
    if (current && current.dev) { win.location.href = win.location.pathname; return; }
    if (pushedFromMenu) { pushedFromMenu = false; win.history.back(); } else win.location.hash = '';
    pendingFocus = id;
  }

  /**
   * V13b (revue n° 1) : échec d'un lancement (niveau inconnu, verrouillé, impossible à charger ; défi impossible à préparer) : l'accueil montre
   * le message ET l'adresse est nettoyée (comme startShared.refuse), sinon un nouveau clic sur le même bouton écrirait la même adresse
   * (aucun hashchange : bouton mort) et « MENU » reviendrait plus tard sur l'entrée #daily / #play=X.
   */
  function refuseLaunch(text) {
    showMenu(text);
    pushedFromMenu = false;
    lastHash = '#';
    try { win.history.replaceState(null, '', win.location.pathname + win.location.search); } catch { /* adresse non modifiable : sans importance */ }
  }

  async function startPlay(id, token) {
    if (!index.ids.includes(id)) { refuseLaunch('Ce niveau n\'existe pas.'); return; }
    if (!isPlayable(progress(), id)) { refuseLaunch('Niveau verrouillé : gagne le niveau précédent.'); return; }
    let loaded;
    try { loaded = await loadLevel(id); } catch (e) { if (token === routeToken) refuseLaunch(`Niveau impossible à charger : ${e && e.message ? e.message : e}`); return; }
    if (token !== routeToken) return; // une autre navigation a eu lieu pendant le chargement
    launch(loaded.level, loaded.state, { id, dev: false });
  }

  // ---- défi du jour (F7) ----
  const dwait = { box: $('daily-wait'), text: $('daily-wait-text'), bar: $('daily-wait-bar'), cancel: $('daily-wait-cancel') };
  let dwaitTimer = 0;
  // V13b (revue n° 7) : la fenêtre d'attente est modale : l'accueil derrière est inerte (ni clic ni Tab), Tab reste sur ANNULER, Échap annule
  function hideDailyWait() { clearTimeout(dwaitTimer); dwaitTimer = 0; dwait.box.hidden = true; screens.menu.inert = false; }
  function showDailyWait() { dwait.box.hidden = false; screens.menu.inert = true; dwait.cancel.focus(); say('Préparation du défi du jour'); }
  dwait.box.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); dwait.cancel.focus(); }
  });
  dwait.cancel.addEventListener('click', () => {
    if (dailyPrep) { dailyPrep.cancel(); dailyPrep = null; }
    hideDailyWait();
    pendingFocus = '#menu-daily'; // V13b (revue n° 8) : focus rendu à « Défi du jour »
    launchPending = false;
    say('Préparation du défi annulée');
    if (pushedFromMenu) { pushedFromMenu = false; win.history.back(); } else win.location.hash = '';
  });

  function showMenuScreenOnly() {
    destroyGame();
    showScreen('menu');
    home.setModel(homeModel());
    home.note('');
    home.show('home', { booting: true });
    doc.title = 'Défi du jour · Prismaze';
  }

  async function startDaily(token) {
    const date = utcDate();
    showMenuScreenOnly();
    dwait.text.textContent = 'Préparation du défi…';
    dwait.bar.style.width = '0%';
    // pas de clignotement quand le niveau est déjà en cache : la fenêtre n'apparaît qu'au bout de 250 ms
    screens.menu.inert = true; // V13b : pendant la préparation, l'accueil derrière ne reçoit rien (même avant l'apparition de la fenêtre, à 250 ms)
    dwaitTimer = setTimeout(showDailyWait, 250);
    const prep = prepareDaily(date, {
      onProgress(a) {
        dwait.text.textContent = `Tentative ${a.e + 1} sur 40 · ${(a.cumul ?? 0).toLocaleString('fr-FR')} nœuds`;
        dwait.bar.style.width = `${Math.min(100, ((a.cumul ?? 0) / 3000000) * 100)}%`;
      },
    });
    dailyPrep = prep;
    let r;
    try { r = await prep.promise; } catch (e) {
      if (token === routeToken) { hideDailyWait(); pendingFocus = null; refuseLaunch(`Défi du jour impossible à préparer : ${e && e.message ? e.message : e}`); }
      return;
    }
    if (dailyPrep === prep) dailyPrep = null;
    hideDailyWait();
    if (token !== routeToken || r.cancelled) return;
    if (r.fallback) say("Niveau de secours : le défi du jour n'a pas pu être calculé");
    launch(r.level, r.state, { id: `daily-${date}`, dev: false, kind: 'daily', label: dailyLabel(date, r.v, r.fallback), extra: { date, par: r.par, fallback: r.fallback } });
  }

  // ---- niveau partagé (F4, F5) : le fragment est la seule source ; tout est validé avant d'être joué ----
  function startShared(code, token) {
    // lien inutilisable : bandeau visible au menu (J8b), et l'adresse est nettoyée (un rechargement ne le répète pas ; le texte du lien n'est jamais affiché)
    const refuse = (text) => {
      showMenu(text);
      try { win.history.replaceState(null, '', win.location.pathname + win.location.search); } catch { /* adresse non modifiable : sans importance */ }
    };
    const INVALID = 'Lien invalide. Il est incomplet, abîmé ou trop long : demande-le de nouveau à la personne qui te l\'a envoyé.';
    if (code === null) { refuse(INVALID); return; }
    const r = parseShareCode(code);
    if (token !== routeToken) return;
    if (!r.ok) { refuse(r.reason === 'newer' || r.reason === 'rules' ? shareFailureText(r) : INVALID); return; }
    const level = r.level;
    const label = level.name === '' ? 'PARTAGÉ' : `PARTAGÉ · ${level.name.toUpperCase()}`;
    launch(level, createState(level), { id: 'partage', dev: false, kind: 'shared', label, extra: { code } });
  }

  // ---- éditeur (F6) ----
  function ensureEditor() {
    if (editor) return editor;
    editor = createEditor(doc, {
      store, client, win, say,
      onBack() { pendingFocus = '#menu-editor'; if (pushedFromMenu) { pushedFromMenu = false; win.history.back(); } else win.location.hash = ''; }, // V13 : focus rendu à « Éditeur »
      onTest({ level, key }) { launch(level, createState(level), { id: 'edit-test', dev: false, kind: 'test', label: 'ESSAI · ÉDITEUR', extra: { key } }); },
      onOpenShared(code) { win.location.hash = `l=${code}`; },
      onShared() { return store.setFlag('shared') ? achievementNames(checkAchievements(false)) : []; }, // V11 : succès « Architecte » ; V13 : écrit dans la fenêtre Partager (un message sous la fenêtre modale serait caché par son fond)
    });
    applyMotion();
    return editor;
  }
  function showEditor() {
    destroyGame();
    ensureEditor();
    showScreen('edit');
    doc.title = 'Éditeur · Prismaze';
    editor.show();
    say('Éditeur');
  }

  // « Éditer une copie » (niveau partagé) : l'éditeur reprend le niveau, le témoin est à refaire
  $('btn-edit-copy').addEventListener('click', () => {
    if (!current || current.kind !== 'shared') return;
    ensureEditor().loadLevel(current.level);
    pushedFromMenu = false;
    win.location.hash = 'edit';
  });

  async function startDev(id) {
    if (!Object.prototype.hasOwnProperty.call(devLevels, id)) {
      try {
        const loaded = await loadLevel(id);
        launch(loaded.level, loaded.state, { id, dev: true });
      } catch (e) { fail(`Niveau introuvable : ${e && e.message ? e.message : e}`); }
      return;
    }
    const v = validateLevel(devLevels[id]);
    if (!v.ok) { fail(`niveau de développement « ${id} » invalide : ${v.errors.map((e) => e.code).join(', ')}`); return; }
    launch(v.level, createState(v.level), { id, dev: true });
  }

  async function route() {
    const token = ++routeToken;
    const r = parseHash(win.location.hash);
    lastHash = win.location.hash || '#';
    launchPending = r.name === 'play' || r.name === 'daily';
    // V13b (revue n° 8) : retour à l'accueil depuis l'éditeur ou le défi en préparation, par n'importe quel chemin (bouton, Échap, retour du navigateur) : focus rendu au bouton d'origine
    if (r.name === 'menu' && pendingFocus === null) { if (!screens.edit.hidden) pendingFocus = '#menu-editor'; else if (dailyPrep || !dwait.box.hidden) pendingFocus = '#menu-daily'; }
    if (settings.isOpen) settings.close();
    if (r.name !== 'menu' && intro && intro.state !== 'off') intro.skip(); // un lien qui arrive pendant l'intro passe devant
    if (dailyPrep) { dailyPrep.cancel(); dailyPrep = null; }
    hideDailyWait(); // V13b : une autre navigation (retour du navigateur) pendant la préparation ferme la fenêtre et rend l'accueil actif
    if (r.name === 'play') { await startPlay(r.id, token); return; }
    if (r.name === 'daily') { await startDaily(token); return; }
    if (r.name === 'edit') { showEditor(); return; }
    if (r.name === 'shared') { startShared(r.code, token); return; }
    const focusId = pendingFocus || (current && !current.dev ? current.id : null);
    pendingFocus = null;
    pushedFromMenu = false;
    if (intro && intro.state !== 'off' && r.sub) intro.skip();
    showMenu('', focusId, r);
  }

  // ---- clavier global : M (jeu : son ; accueil : musique d'ambiance, V11), O (réglages), Échap (accueil : retour, V11) ----
  doc.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || settings.isOpen) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.key === 'Escape' && !dwait.box.hidden) { e.preventDefault(); if (!e.repeat) dwait.cancel.click(); return; } // V13b (revue n° 7) : Échap annule la préparation du défi
    const onHome = !screens.menu.hidden && dwait.box.hidden;
    if (e.key === 'm' || e.key === 'M') { e.preventDefault(); if (!e.repeat) { if (onHome) toggleAmbient(); else toggleMute(); } } else if (e.key === 'o' || e.key === 'O') { e.preventDefault(); if (!e.repeat) openSettings(); } else if (e.key === 'Escape' && onHome) {
      if (e.repeat) { e.preventDefault(); return; } // V13b (relecture V13, R4) : Échap maintenu ne remonte jamais plusieurs écrans (le niveau quitté reste la liste)
      if (home.current !== 'home') { e.preventDefault(); home.back(); } else if (home.offer) { e.preventDefault(); home.showOffer(false); }
    }
  });

  // ---- autre onglet : relecture au retour du focus (le dernier écrit gagne) ----
  win.addEventListener('focus', () => { store.reload(); });
  win.addEventListener('storage', () => { store.reload(); });
  store.subscribe(() => {
    syncStorageNote();
    applyMotion();
    applyQuality();
    audio.setMuted(store.settings.muted);
    if (game) { game.setMutedUi(store.settings.muted); game.setSymbols(store.settings.symbols); game.setUiPrefs(uiPrefs()); }
    settings.sync();
    syncAmbient();
    if (!screens.menu.hidden) renderMenu();
  });

  return {
    /** Démarre : charge l'index, applique les réglages, route vers l'écran demandé. */
    async start() {
      if (started) return;
      started = true;
      if (params.has('bench') && deps.benchFactory) bench = await deps.benchFactory();
      applyMotion();
      applyMuted();
      applyQuality();
      syncStorageNote();
      const devId = params.get('level');
      if (devId !== null) { // entrée de développement / d'essai : un niveau directement (niveaux de développement ou levels/<id>.json)
        try { index = await loadIndex(); } catch { index = { chapters: [], ids: [] }; }
        await startDev(devId);
        host.init();
        return;
      }
      try { index = await loadIndex(); } catch (e) { showScreen('menu'); fail(`Impossible de charger la liste des niveaux : ${e && e.message ? e.message : e}`); return; }
      checkAchievements(false); // V11 : succès déjà gagnés par la progression passée : accordés au premier chargement, sans message
      // V11 : intro une fois par session, seulement si l'on arrive sur l'accueil (jamais devant un lien direct), jamais en mouvement réduit
      const first = parseHash(win.location.hash);
      const forced = params.get('intro') === '1' ? 'on' : params.get('intro') === '0' ? 'off' : null;
      const playIntro = shouldPlayIntro({ route: first.name === 'menu' && !first.sub ? 'home' : 'other', reduced: reducedMotion(), seen: ss !== null && ss.getItem(INTRO_KEY) === '1', forced, debug, storage: ss !== null });
      if (playIntro) {
        try { ss.setItem(INTRO_KEY, '1'); } catch { /* stockage refusé : sans importance */ }
        intro = createIntro({ doc, win, box: $('intro'), svg: $('intro-wm'), target: () => doc.getElementById('home-wm'), onEnd() { win.setTimeout(() => doc.documentElement.classList.remove('intro-done'), 900); home.scene.layout(); maybeOffer(); } });
        intro.play();
      }
      win.addEventListener('hashchange', route);
      await route();
      bootRoute = false;
      host.init(); // détection WebGL après le premier affichage (jamais avant : ~0,1 s de blocage pour le contexte)
    },
    /** Essais (?debug, branché par main.js) : horloge de la scène de l'accueil et message discret. */
    get homeDebug() { return { scene: home.scene, toast: (text) => home.toast(text) }; },
    /** Copie de l'état observable (?debug). */
    snapshot() {
      const s = { ...store.settings };
      const st = store.status;
      if (!screens.edit.hidden && editor) return { ...editor.snapshot(), settings: s, render: renderInfo(), save: { mode: st.mode }, drafts: store.drafts.length, dialogOpen: settings.isOpen || editor.isModalOpen };
      if (game) {
        const snap = game.snapshot();
        snap.settings = s;
        snap.render = renderInfo();
        snap.save = { mode: st.mode };
        snap.dev = current ? current.dev : false;
        snap.kind = current ? current.kind : null;
        snap.daily = current && current.kind === 'daily' ? { date: current.extra.date, par: current.extra.par, fallback: current.extra.fallback } : null;
        snap.audio = { state: audio.state, played: audio.stats.played, muted: audio.muted, ambient: ambient.playing };
        snap.dialogOpen = settings.isOpen;
        return snap;
      }
      const p = progress();
      const hm = homeModel();
      return {
        screen: 'menu', levelId: null, board: null, trace: null, history: null, cursor: null, drag: null, preview: null, hint: null, won: false,
        home: { sub: home.current, chapter: home.chapter, resumeId: hm.resume, offer: home.offer, intro: intro ? intro.state : 'off', ambient: { setting: store.settings.ambient, playing: ambient.playing, level: ambient.level }, achievements: hm.achievements.filter((a) => a.earned).map((a) => a.id), granted: store.achievements, flags: store.flags, seen: store.seen, scene: home.scene.stats() },
        settings: s, render: renderInfo(), fx: null, view: null, save: { mode: st.mode, recovered: st.recovered, migrated: st.migrated },
        menu: { stars: p.stars, maxStars: p.maxStars, done: p.done, total: p.total, nextId: p.nextId, chapters: p.chapters.map((c) => ({ id: c.id, unlocked: c.unlocked, done: c.done, levels: c.levels.map((l) => ({ id: l.id, state: l.state, stars: l.stars, best: l.best })) })) },
        dialogOpen: settings.isOpen, audio: { state: audio.state, played: audio.stats.played, muted: audio.muted },
      };
    },
  };
}
