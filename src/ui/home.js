// V11 : l'accueil (maquette D2, variante 2) et ses écrans : chapitres, niveaux d'un chapitre, comment jouer, succès, à propos.
// Un seul conteneur (#screen-menu) : la scène vivante derrière, un écran visible à la fois, transition par un trait de lumière (aucune en
// mouvement réduit). Focus : titre de l'écran à l'arrivée, élément d'origine au retour (U2). Échap = retour (géré par app.js).
// Aucune donnée n'est insérée en HTML : textContent seulement (les seuls innerHTML sont des dessins constants du code).
import { buildWordmark } from './wordmark.js';
import { createHomeScene } from './home-scene.js';
import { renderChapters, renderLevels, frenchDate, levelName, ROMAN } from './menu.js';
import { achievementRight } from './achievements.js';
import { VERSION } from './version.js';

/** Écrans de l'accueil : adresse (fragment), section, profondeur (sens de la transition), parent. */
export const HOME_SCREENS = Object.freeze({
  home: { section: 'home', depth: 0, hash: '' },
  chapters: { section: 'home-chapters', depth: 1, hash: 'niveaux', parent: 'home' },
  levels: { section: 'home-levels', depth: 2, parent: 'chapters' },
  howto: { section: 'home-howto', depth: 1, hash: 'aide', parent: 'home' },
  ach: { section: 'home-ach', depth: 1, hash: 'succes', parent: 'home' },
  about: { section: 'home-about', depth: 1, hash: 'apropos', parent: 'home' },
});
/** Fragment d'un écran de l'accueil (« #niveaux », « #chapitre-2 »...). */
export function homeHash(sub, chapter = 0) {
  if (sub === 'levels') return `#chapitre-${chapter + 1}`;
  const s = HOME_SCREENS[sub];
  return s && s.hash ? `#${s.hash}` : '#';
}
const TITLE = { home: 'Prismaze', chapters: 'Niveaux · Prismaze', levels: 'Niveaux · Prismaze', howto: 'Comment jouer · Prismaze', ach: 'Succès · Prismaze', about: 'À propos · Prismaze' };

/** V13b : délai de calme après le dernier événement resize avant de refaire la scène (ms). */
export const RESIZE_SETTLE_MS = 150;
/**
 * Regroupe des demandes : `fn` tourne au plus une fois par image (`delay` = 0), ou une seule fois `delay` ms après la dernière demande
 * (redimensionnement continu). Renvoie la fonction de demande. Testable sous Node avec une fausse fenêtre.
 */
export function frameScheduler(win, fn, delay = 0) {
  let frame = 0, timer = 0;
  const run = () => { if (frame) return; frame = win.requestAnimationFrame(() => { frame = 0; fn(); }); };
  return () => {
    if (delay <= 0) { run(); return; }
    win.clearTimeout(timer);
    timer = win.setTimeout(() => { timer = 0; run(); }, delay);
  };
}

/** Texte de la ligne du défi (accueil) et son libellé lu. Pur. */
export function dailyLine({ date, done, streak, countdown }) {
  const sr = streak > 0 ? `série ${streak} · ` : '';
  if (done) return { mark: true, text: `relevé · ${sr}prochain dans ${countdown}`, label: `Défi du jour du ${frenchDate(date)} : relevé, série de ${streak} jour${streak > 1 ? 's' : ''}, prochain défi dans ${countdown}` };
  return { mark: false, text: `à relever · ${sr}encore ${countdown}`, label: `Défi du jour du ${frenchDate(date)} : pas encore relevé${streak > 0 ? `, série de ${streak} jour${streak > 1 ? 's' : ''}` : ''}, encore ${countdown} pour le relever` };
}

/** Action principale : « Jouer » (nouveau joueur), « Reprendre », « Rejouer » (tout est fini). Pur. */
export function playLabel(progress, resume, names) {
  if (resume === null) return { a: 'Jouer', b: '', label: 'Jouer' };
  const a = progress.done === 0 ? 'Jouer' : progress.nextId === null ? 'Rejouer' : 'Reprendre';
  let b = '';
  for (const ch of progress.chapters) for (const l of ch.levels) if (l.id === resume) b = `${ch.name} ${String(l.n).padStart(2, '0')} · ${levelName(names, l.id)}`;
  if (progress.nextId === null && progress.total > 0) b = `${b} · tout est fini`;
  return { a, b, label: `${a} : ${b.replace(/ · /g, ', ')}` };
}

/**
 * @param {Document} doc
 * @param {Window} win
 * @param {object} deps
 *   names : noms des niveaux ; seed : graine de la scène (essais) ; go(hash) : navigation ; back(parentHash) ;
 *   onPlay(id, from), onDaily(), onEditor(), onSettings(from), onAmbient(), onOfferSeen(), say(text)
 */
export function createHome(doc, win, deps) {
  const $ = (id) => doc.getElementById(id);
  const root = $('screen-menu');
  const sections = Object.fromEntries(Object.entries(HOME_SCREENS).map(([k, v]) => [k, $(v.section)]));
  const el = {
    banner: $('menu-banner'), note: $('menu-note'), noteClose: $('menu-note-close'), title: $('menu-title'),
    play: $('menu-continue'), playA: $('play-a'), playB: $('play-b'), offer: $('home-offer'), offerYes: $('home-offer-yes'),
    levels: $('menu-levels'), daily: $('menu-daily'), editor: $('menu-editor'), settings: $('menu-settings'),
    dailyLine: $('home-daily'), progLine: $('home-progress'), howto: $('menu-howto'), ach: $('menu-ach'), achN: $('menu-ach-n'), about: $('menu-about'),
    chMeta: $('chapters-meta'), chList: $('chapters-list'), lvTitle: $('levels-title'), lvLead: $('levels-lead'), lvArt: $('levels-art'), lvList: $('levels-list'),
    achMeta: $('ach-meta'), achList: $('ach-list'), ambient: $('btn-ambient'), ambientT: $('btn-ambient-t'), wipe: $('wipe'), howtoGo: $('howto-go'), toast: $('toast'),
  };
  buildWordmark(doc, $('home-wm'), 'home');
  buildWordmark(doc, $('about-wm'), 'about');
  $('about-version').textContent = VERSION;
  // grille des démonstrations « comment jouer »
  for (const g of sections.howto.querySelectorAll('.demo .grid')) {
    for (let x = 10; x <= 250; x += 60) { const p = doc.createElementNS(g.namespaceURI, 'path'); p.setAttribute('class', 'cell'); p.setAttribute('d', `M${x} 10V190`); g.appendChild(p); }
    for (let y = 10; y <= 190; y += 60) { const p = doc.createElementNS(g.namespaceURI, 'path'); p.setAttribute('class', 'cell'); p.setAttribute('d', `M10 ${y}H250`); g.appendChild(p); }
  }

  const scene = createHomeScene({
    canvas: $('home-scene'), win, doc, seed: deps.seed, context2d: deps.context2d,
    avoid: () => (sections.home.hidden ? [] : [...sections.home.querySelectorAll('[data-avoid]:not([hidden])'), el.ambient]),
    textBlock: () => (sections.home.hidden ? [] : [...sections.home.querySelectorAll('.blk, .foot')]),
    onAccent: (hex) => doc.documentElement.style.setProperty('--beam', hex),
  });

  let current = 'home', chapterIndex = 0, model = null, reduced = false, visible = false, offerOn = false, toastTimer = 0, tick = 0, lastCountdown = '';
  const openers = {}; // écran -> id de l'élément qui l'a ouvert (focus rendu au retour)

  // ---- rendu ----
  function renderHome() {
    if (!model) return;
    const p = model.progress;
    const pl = playLabel(p, model.resume, deps.names);
    el.playA.textContent = pl.a;
    el.playB.textContent = pl.b;
    el.play.setAttribute('aria-label', pl.label);
    el.play.dataset.id = model.resume || '';
    el.progLine.replaceChildren(`${p.stars}/${p.maxStars} `, mk('span', 'st', '★'), ` · ${p.done}/${p.total} niveaux`);
    el.levels.setAttribute('aria-label', `Niveaux : ${p.stars} étoiles sur ${p.maxStars}, ${p.done} niveaux sur ${p.total}`);
    const got = model.achievements.filter((a) => a.earned).length;
    el.achN.textContent = `${got}/${model.achievements.length}`;
    el.ach.setAttribute('aria-label', `Succès : ${got} sur ${model.achievements.length}`);
    el.offer.hidden = !offerOn;
    renderDaily(true);
    setAmbient(model.ambientOn);
  }
  function mk(tag, cls, text) { const n = doc.createElement(tag); if (cls) n.className = cls; n.setAttribute('aria-hidden', 'true'); n.textContent = text; return n; }
  function renderDaily(force) {
    if (!model) return;
    const d = model.daily();
    if (!force && d.countdown === lastCountdown) return;
    lastCountdown = d.countdown;
    const line = dailyLine(d);
    el.dailyLine.replaceChildren('Défi du jour ', ...(line.mark ? [mk('span', 'ok', '✓'), ' '] : []), line.text);
    el.daily.setAttribute('aria-label', line.label);
  }
  function renderChaptersScreen() {
    const p = model.progress;
    el.chMeta.replaceChildren(`${p.stars}/${p.maxStars} `, mk('span', 'st', '★'), ` · ${p.done}/${p.total} niveaux · chapitre suivant ouvert après 7 niveaux`);
    renderChapters(doc, el.chList, p, {
      onOpen: (i) => go('levels', i),
      onLocked: (text) => toast(text),
    });
    bindBeam(el.chList);
  }
  function renderLevelsScreen(i) {
    renderLevels(doc, { title: el.lvTitle, lead: el.lvLead, art: el.lvArt, list: el.lvList }, model.progress.chapters[i], deps.names, {
      onPlay: (id) => deps.onPlay(id, doc.activeElement),
      onLocked: (text) => toast(text),
    });
  }
  function hexSvg(color, on) {
    const svg = doc.createElementNS(el.ambient.querySelector('svg').namespaceURI, 'svg');
    svg.setAttribute('viewBox', '-14 -14 28 28'); svg.setAttribute('aria-hidden', 'true');
    const poly = doc.createElementNS(svg.namespaceURI, 'polygon');
    poly.setAttribute('points', '0,-12 10.4,-6 10.4,6 0,12 -10.4,6 -10.4,-6');
    poly.setAttribute('stroke-width', '1.4');
    if (on) { poly.setAttribute('fill', color); poly.setAttribute('stroke', color); poly.setAttribute('style', `filter:drop-shadow(0 0 5px ${color})`); } else { poly.setAttribute('fill', 'none'); poly.setAttribute('stroke', 'rgba(222,226,255,.45)'); }
    svg.appendChild(poly);
    if (on) { const c = doc.createElementNS(svg.namespaceURI, 'circle'); c.setAttribute('r', '3.2'); c.setAttribute('fill', '#06061a'); svg.appendChild(c); }
    return svg;
  }
  function renderAchScreen() {
    const list = model.achievements;
    const got = list.filter((a) => a.earned).length;
    el.achMeta.textContent = `${got} sur ${list.length} obtenus`;
    el.achList.replaceChildren();
    for (const a of list) {
      const li = doc.createElement('li');
      li.className = a.earned ? 'got' : '';
      li.dataset.id = a.id;
      const mid = doc.createElement('div');
      const b = doc.createElement('b'); b.textContent = a.name;
      const d = doc.createElement('span'); d.className = 'd'; d.textContent = a.desc;
      mid.append(b, d);
      const r = doc.createElement('span'); r.className = 'r num'; r.setAttribute('aria-hidden', 'true'); r.textContent = achievementRight(a);
      li.append(hexSvg(a.color, a.earned), mid, r);
      li.setAttribute('aria-label', `${a.name} : ${a.desc} ${a.earned ? 'Obtenu.' : `Pas encore obtenu${a.progress ? `, ${a.progress[0]} sur ${a.progress[1]}` : ''}.`}`);
      el.achList.append(li);
    }
  }

  // ---- navigation ----
  function go(sub, chapter = 0) {
    const ae = doc.activeElement;
    if (ae && root.contains(ae) && ae.id) openers[sub] = `#${ae.id}`;
    else if (ae && root.contains(ae) && ae.dataset && ae.dataset.ch !== undefined) openers[sub] = `[data-ch="${ae.dataset.ch}"]`;
    deps.go(homeHash(sub, chapter));
  }
  function back() {
    const s = HOME_SCREENS[current];
    if (!s || !s.parent) return false;
    deps.back(homeHash(s.parent, chapterIndex));
    return true;
  }
  function wipe(section, backwards) {
    if (reduced) return;
    section.classList.remove('wipe-f', 'wipe-b');
    void section.offsetWidth; // relance l'animation
    section.classList.add(backwards ? 'wipe-b' : 'wipe-f');
    el.wipe.className = '';
    void el.wipe.offsetWidth;
    el.wipe.className = backwards ? 'run-b' : 'run-f';
  }
  /** Survol ou focus clavier d'une entrée : le faisceau s'avive, une étincelle court sous l'action. */
  function bindBeam(container) {
    for (const b of container.querySelectorAll('[data-beam]')) {
      if (b.dataset.beamBound) continue;
      b.dataset.beamBound = '1';
      const on = () => { scene.hover(true); const s = b.querySelector('.spk'); if (s && !reduced) { s.classList.remove('go'); void s.offsetWidth; s.classList.add('go'); } };
      const off = () => scene.hover(false);
      b.addEventListener('pointerenter', on);
      b.addEventListener('pointerleave', off);
      b.addEventListener('focus', () => { if (b.matches(':focus-visible')) on(); });
      b.addEventListener('blur', off);
    }
  }
  bindBeam(root);

  function toast(text, ms = 3600) {
    el.toast.textContent = text;
    el.toast.classList.add('on');
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => { el.toast.classList.remove('on'); }, ms);
  }
  /** V13 : un message passager ne survit pas à un changement d'écran (« Verrouillé : … » restait sur l'éditeur). */
  function clearToast() {
    win.clearTimeout(toastTimer);
    el.toast.classList.remove('on');
    el.toast.textContent = '';
  }

  // ---- événements ----
  el.play.addEventListener('click', () => { if (model && model.resume) deps.onPlay(model.resume, el.play); });
  el.howtoGo.addEventListener('click', () => { if (model && model.resume) deps.onPlay(model.resume, null, { replace: true }); });
  // V13b (revue n° 8) : l'invitation disparaît : au retour de « Comment jouer », le focus va sur « Jouer » (posé APRÈS go(), qui sinon noterait
  // le bouton caché « Voir comment jouer » comme origine, introuvable au retour : le focus tombait sur le titre)
  el.offerYes.addEventListener('click', () => { offerOn = false; go('howto'); el.offer.hidden = true; openers.howto = '#menu-continue'; });
  el.levels.addEventListener('click', () => go('chapters'));
  el.daily.addEventListener('click', () => deps.onDaily());
  el.editor.addEventListener('click', () => deps.onEditor());
  el.settings.addEventListener('click', () => deps.onSettings(el.settings));
  el.howto.addEventListener('click', () => go('howto'));
  el.ach.addEventListener('click', () => go('ach'));
  el.about.addEventListener('click', () => go('about'));
  el.ambient.addEventListener('click', () => deps.onAmbient());
  for (const b of root.querySelectorAll('[data-back]')) b.addEventListener('click', () => back());
  el.noteClose.addEventListener('click', () => {
    el.note.textContent = '';
    el.banner.hidden = true;
    el.title.focus({ preventScroll: true });
    scene.layout();
  });
  // V13b (revue n° 5) : mises en page de la scène regroupées : au plus une par image (bloc de texte, défilement), et une seule à la fin
  // d'un redimensionnement continu de la fenêtre (150 ms sans nouvel événement) ; avant, chaque événement resize refaisait tout.
  const relayout = frameScheduler(win, () => { if (visible && current === 'home') scene.layout(); });
  const relayoutAfterResize = frameScheduler(win, () => { if (visible) scene.layout(); }, RESIZE_SETTLE_MS);
  win.addEventListener('resize', () => { if (visible) relayoutAfterResize(); });
  if (typeof win.ResizeObserver === 'function') new win.ResizeObserver(relayout).observe(sections.home.querySelector('.blk'));
  // V13b (revue n° 11) : l'accueil défile en fenêtre basse (568×320) : le masque (rien sous le texte) suit le texte qui bouge
  sections.home.addEventListener('scroll', relayout, { passive: true });

  function setAmbient(on) {
    el.ambient.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.ambient.setAttribute('aria-label', on ? 'Musique d\'ambiance active : couper (touche M)' : 'Musique d\'ambiance coupée : activer (touche M)');
    el.ambientT.textContent = 'Ambiance'; // V13 : toujours « Ambiance » ; l'état se lit au trait (plat = coupée, onde = active) et à aria-pressed
  }

  return {
    /** Données de l'accueil : {progress, resume, achievements, ambientOn, daily:()=>{date, done, streak, countdown}}. */
    setModel(m) { model = m; },
    get current() { return current; },
    get chapter() { return chapterIndex; },
    get visible() { return visible; },
    get offer() { return offerOn; },
    scene,
    /**
     * Montre un écran de l'accueil (rendu compris).
     * @param {string} sub  clé de HOME_SCREENS
     * @param {{chapter?:number, focusId?:string|null, booting?:boolean}} [opts]
     */
    show(sub, { chapter = 0, focusId = null, booting = false } = {}) {
      const prev = current;
      const wasVisible = visible;
      if (!wasVisible || prev !== sub) clearToast();
      if (!HOME_SCREENS[sub]) sub = 'home';
      if (sub === 'levels') { chapterIndex = chapter; sections.levels.dataset.ch = String(chapter); }
      current = sub;
      visible = true;
      if (sub !== 'home') offerOn = false;
      for (const [k, s] of Object.entries(sections)) s.hidden = k !== sub;
      const section = sections[sub];
      section.scrollTop = 0;
      if (sub === 'home') renderHome();
      else if (sub === 'chapters') renderChaptersScreen();
      else if (sub === 'levels') renderLevelsScreen(chapterIndex);
      else if (sub === 'ach') renderAchScreen();
      doc.title = TITLE[sub];
      scene.setDim(sub === 'home' ? 0 : 1);
      scene.setActive(true);
      if (sub === 'home') win.requestAnimationFrame(() => { if (visible && current === 'home') scene.layout(); });
      if (wasVisible && prev !== sub && !booting) wipe(section, HOME_SCREENS[sub].depth < HOME_SCREENS[prev].depth || (sub === 'home' && prev !== 'home'));
      win.clearInterval(tick);
      if (sub === 'home') tick = win.setInterval(() => renderDaily(false), 1000);
      // focus : l'élément demandé (niveau quitté), sinon celui qui avait ouvert l'écran quitté, sinon le titre
      let target = null;
      if (focusId) target = (focusId.startsWith('#') ? section.querySelector(focusId) : section.querySelector(`[data-id="${focusId}"]`)) || (sub === 'home' && el.play.dataset.id === focusId ? el.play : null); // V13 : « #menu-editor », « #menu-daily » (retour de l'éditeur, du défi)
      if (!target && wasVisible && prev !== sub && openers[prev]) { const o = section.querySelector(openers[prev]); if (o && o.offsetParent !== null) target = o; }
      if (!target) target = sub === 'home' ? el.title : section.querySelector('h2');
      if (target) target.focus({ preventScroll: sub !== 'levels' && sub !== 'chapters' });
    },
    /** L'accueil est quitté (jeu, éditeur) : la scène s'arrête. */
    hide() {
      if (visible) clearToast();
      visible = false;
      offerOn = false;
      win.clearInterval(tick);
      scene.setActive(false);
      scene.hover(false);
    },
    back,
    /** Re-rendu de l'écran courant (sauvegarde changée dans un autre onglet, réglages). */
    refresh() {
      if (!visible) return;
      // les listes sont reconstruites : le focus revient à la même commande (sauvegarde relue d'un autre onglet, réglage...)
      const ae = doc.activeElement;
      const key = ae && root.contains(ae) ? (ae.dataset.id ? `[data-id="${ae.dataset.id}"]` : ae.dataset.ch !== undefined ? `[data-ch="${ae.dataset.ch}"]` : ae.id ? `#${ae.id}` : null) : null;
      if (current === 'home') renderHome(); else if (current === 'chapters') renderChaptersScreen(); else if (current === 'levels') renderLevelsScreen(chapterIndex); else if (current === 'ach') renderAchScreen();
      if (key && !root.contains(doc.activeElement)) { const n = sections[current].querySelector(key); if (n) n.focus({ preventScroll: true }); }
    },
    /** Bandeau de l'accueil (lien invalide, niveau verrouillé...) : texte seul ; vide = caché. */
    note(text) { el.note.textContent = text; el.banner.hidden = text === ''; },
    /** Invitation « Première fois ? » (nouveau joueur, une fois). */
    showOffer(on) { offerOn = on; el.offer.hidden = !on; if (visible && current === 'home') scene.layout(); },
    toast,
    clearToast,
    setAmbient,
    setReducedMotion(r) { reduced = r; scene.setReducedMotion(r); },
    focusTitle() { el.title.focus({ preventScroll: true }); },
    /** Identifiant du chapitre (index) d'un écran « niveaux », pour l'adresse. */
    romanOf: (i) => ROMAN[i] || String(i + 1),
  };
}
