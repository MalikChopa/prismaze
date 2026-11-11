// Écran de jeu (J4) : session (état + historique + prise en cours), colle entre entrées, rendu et accessibilité.
// `createSession` est pur (aucun DOM) et se teste sous `node --test` ; `createGame` touche au DOM.
import { buildBoard } from '../engine/board.js';
import { trace } from '../engine/trace.js';
import { rotatePiece, movePiece, isMovable, isRotatable, pieceAt } from '../engine/state.js';
import { createHistory, makeRotate, makeMove, makeReset } from './history-v2.js';
import { createPointerMachine, createKeyboardController, attachPointerInput } from './input.js';
import { createAnnouncer, describeCell, litMessage, rotateMessage, moveMessage, cellName, pieceDescription, MESSAGES, screenCellText } from './a11y.js';
import { summarize, diffEvents } from './events.js';
import { starsLabel } from './progress.js';
import { createStage } from './stage.js';
import { createFloatingUi, levelTitle, uiMode } from './hud.js';
import { screenDirToBoard } from '../render/scene/camera.js';
import { VICTORY, victoryFrame } from '../render/scene/victory.js';
import { COMPACT_QUERY } from '../render/scene/layout.js';
import { watchScroll } from './scroll-cue.js';

/** true si deux états ont les mêmes pièces aux mêmes cases et orientations (ordre des pièces identique). */
export function sameLayout(a, b) {
  if (a === b) return true;
  if (a.pieces.length !== b.pieces.length) return false;
  for (let i = 0; i < a.pieces.length; i++) {
    const p = a.pieces[i];
    const q = b.pieces[i];
    if (p.c !== q.c || p.r !== q.r || p.o !== q.o) return false;
  }
  return true;
}

/**
 * Session de jeu : l'état validé, l'historique, la prise en cours (glisser ou clavier) et le drapeau « résolu ».
 * Pendant une prise, `view()` montre la pièce tenue sur sa case candidate (R11) ; l'état validé ne change qu'au lâcher.
 * La victoire n'est évaluée qu'après une commande (rotation, lâcher, annuler, refaire, recommencer) : P7.
 * @param {object} initial  état initial du niveau (engine/state.js)
 * @param {{onTrace?:(ms:number)=>void, now?:()=>number}} [opts]
 */
export function createSession(initial, opts = {}) {
  const history = createHistory();
  let state = initial;
  let drag = null;
  let won = false;
  let cache = null; // {state, result}

  function runTrace(st) {
    const t0 = opts.onTrace ? opts.now() : 0;
    const result = trace(buildBoard(st));
    if (opts.onTrace) opts.onTrace(opts.now() - t0);
    return result;
  }
  function displayState() {
    if (drag === null) return state;
    return movePiece(state, drag.id, drag.to.c, drag.to.r);
  }
  function judge() {
    const result = runTrace(state);
    won = result.allLit;
    cache = drag === null ? { state, result } : null; // le tracé de l'état validé sert aussi à l'affichage
  }
  function commit(next, cmd) {
    if (next === state) return null;
    state = next;
    history.record(cmd);
    judge();
    return cmd;
  }

  return {
    get state() { return state; },
    get initial() { return initial; },
    get history() { return history; },
    get drag() { return drag; },
    get won() { return won; },
    /** @returns {{state:object, result:object}} état affiché (avec la prise éventuelle) et son tracé, en cache */
    view() {
      const shown = displayState();
      if (cache === null || cache.state !== shown) cache = { state: shown, result: runTrace(shown) };
      return cache;
    },
    /** Tourne un miroir ou un séparateur mobile d'un cran (+1 ou -1) ; renvoie la commande, ou null si rien ne change (prisme, filtre, pièce fixe). */
    rotate(id, steps = 1) {
      if (!isRotatable(state.pieces[id])) return null;
      return commit(rotatePiece(state, id, steps), makeRotate(id, steps));
    },
    /** Déplace une pièce mobile vers une case libre ; renvoie la commande, ou null (case occupée, même case, pièce fixe). */
    move(id, to) {
      const p = state.pieces[id];
      if (!isMovable(p)) return null;
      return commit(movePiece(state, id, to.c, to.r), makeMove(id, { c: p.c, r: p.r }, to));
    },
    /** Recommencer (annulable, P8). Renvoie null si le plateau est déjà au départ. */
    reset() {
      if (sameLayout(state, initial)) return null;
      return commit(initial, makeReset(state, initial));
    },
    undo() {
      const r = history.undo(state);
      if (r === null) return null;
      state = r.state;
      judge();
      return r.cmd;
    },
    redo() {
      const r = history.redo(state);
      if (r === null) return null;
      state = r.state;
      judge();
      return r.cmd;
    },
    beginDrag(id, from, source) {
      drag = { id, from: { c: from.c, r: from.r }, to: { c: from.c, r: from.r }, source };
      cache = null;
    },
    moveDrag(to) {
      if (drag === null) return;
      drag = { ...drag, to: { c: to.c, r: to.r } };
      cache = null;
    },
    endDrag() {
      drag = null;
      cache = null;
    },
  };
}

/**
 * Monte l'écran de jeu.
 * @param {{canvas:HTMLCanvasElement, renderer:object, level:object, initial:object, label:string, live:HTMLElement,
 *   hooks?:object|null, doc?:Document, symbols?:boolean, getHint?:(state:object)=>object|null, audio?:object|null,
 *   onSolved?:(used:number)=>object|null, onNext?:()=>void, onMenu?:()=>void, onSettings?:()=>void, onToggleMute?:()=>void}} opts
 *   hooks (banc d'essai seulement) : {now, onTrace(ms), onEvent(ms), onDraw(ms), onFrame(ts, workMs)}
 *   getHint : renvoie l'indice à afficher {ghost:{c,r,o,type,mask}, source:{c,r}, moves, text}, ou {none:true, text} (pas d'indice), ou null
 *   ui : {prefs:{camera,autohide,reduced}, touch, win, root} : disposition immersive (caméra, interface flottante) ; null = ancienne disposition (`?debug`)
 *   audio : {play(name, arg)} (sons, U6) ; onSolved(used) -> {stars, best, isBest, first, next:{id,n,chapter}|null, hasStars} (la coque enregistre)
 */
export function createGame(opts) {
  const { canvas, renderer, level, initial, label: rawLabel, live, hooks = null, doc = document, getHint = null, audio = null, onSolved = null, onAchievementsShown = null, onNext = null, onMenu = null, onSettings = null, onToggleMute = null, ui: uiOpts = null } = opts;
  const label = levelTitle(rawLabel, level.id); // jamais le nom de fichier d'un niveau (V3-34 ; brief 29 tâche 1)
  let symbols = opts.symbols !== false;
  const play = (name, arg) => { if (audio !== null) audio.play(name, arg); };
  const session = createSession(initial, hooks ? { onTrace: hooks.onTrace, now: hooks.now } : {});
  const announcer = createAnnouncer(live);
  const screenWords = (t) => (typeof t === 'string' && ui !== null && ui.stage.layout !== null && ui.stage.layout.rot === 1 ? screenCellText(t, initial.rows) : t); // V7 : coordonnées vues à l'écran
  const say = (t) => announcer.say(screenWords(t));

  let keyboardMode = true; // le plateau reçoit le focus au chargement : curseur visible jusqu'au premier geste souris/doigt
  let scheduled = false;
  let continuous = false;
  let flash = null;
  let flashTimer = 0;
  let placedKey = '';
  let lastAria = '';
  let lastTools = '';
  let wasWon = false;
  // V11 (succès) : la tentative en cours a-t-elle demandé un indice, annulé ou recommencé ? Remis à zéro par « Rejouer » après une victoire.
  let usedHint = false, usedUndo = false;
  let preview = null; // aperçu de la rotation dans l'autre sens (appui long, clic droit) : {c, r, o, type}
  let hint = null; // indice affiché (fantôme), effacé à la commande suivante
  let hintText = ''; // texte de l'indice, affiché sous le plateau (aucune information par le seul dessin)
  let prevSummary = null;
  let starsTimer = 0;
  let refuse = null; // lâcher refusé : {id, from, at, t0, reason} (retour visuel : la pièce glisse et tremble, la case reste marquée)
  let refuseTimer = 0;
  let noteText = ''; // message court sous le plateau (ex. « Case occupée »), en plus de l'annonce vocale
  let noteTimer = 0;
  let solved = null; // dernier résultat de onSolved
  let dead = false; // detruit : plus aucune image, plus aucun gestionnaire (les boutons du DOM sont partagés entre les niveaux)
  const cleanups = [];
  // ---- disposition immersive (V5) : null en mode classique (`?debug`) ----
  const urlParams = uiOpts !== null && uiOpts.win && uiOpts.win.location ? new URLSearchParams(uiOpts.win.location.search || '') : new URLSearchParams();
  const ui = uiOpts === null ? null : {
    stage: createStage({ gl: renderer.backend === 'gl', reduced: uiOpts.prefs.reduced, enabled: uiOpts.prefs.camera, touch: uiOpts.touch, rotation: uiMode(urlParams).rotation }),
    floating: createFloatingUi({ doc, win: uiOpts.win, root: uiOpts.root, autohide: uiOpts.prefs.autohide }),
  };
  // V13b (revue n° 2) : paysage bas = réponse de la règle CSS elle-même (matchMedia), jamais un calcul JS à part (hauteurs fractionnaires)
  const compactMq = ui !== null && uiOpts.win && typeof uiOpts.win.matchMedia === 'function' ? uiOpts.win.matchMedia(COMPACT_QUERY) : null;
  let layoutDirty = ui !== null, lastWon = false, lastBackend = renderer.backend, heldCam = false, pointer = null;
  let litFor = null, litIdx = -1, litWas = [], lastDown = null;
  let lastLayoutSeen = null, victory = null, victoryIds = 0, lastTs = 0; // victoire en cours (V3-27) : {t0, skipAt, id, risen, revealed, focused}
  const litVec = { x: 0, y: 0 };

  const timed = hooks
    ? (fn) => (...args) => {
      const t0 = hooks.now();
      try { return fn(...args); } finally { hooks.onEvent(hooks.now() - t0); }
    }
    : (fn) => fn;

  const litText = () => {
    const res = session.view().result;
    return litMessage(res.litCount, res.targets.length);
  };

  function flashCell(c, r) {
    flash = { c, r };
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flash = null; requestDraw(); }, 150);
    requestDraw();
  }

  function clearRefuse() {
    refuse = null; noteText = '';
    clearTimeout(refuseTimer); clearTimeout(noteTimer);
    lastAria = '';
  }

  /** Lâcher refusé (case occupée, hors du plateau) : retour visible (glissement + tremblement, ou cadre fixe en mouvement réduit), texte sous le plateau, annonce. */
  function refuseDrop({ id, from, cell, reason }) {
    refuse = { id, from: { c: from.c, r: from.r }, at: reason === 'occupied' && cell ? { c: cell.c, r: cell.r } : null, t0: null, reason };
    noteText = reason === 'occupied' ? MESSAGES.occupied : MESSAGES.outside;
    clearTimeout(refuseTimer); clearTimeout(noteTimer);
    refuseTimer = setTimeout(() => { refuse = null; requestDraw(); }, 1000);
    noteTimer = setTimeout(() => { noteText = ''; lastAria = ''; requestDraw(); }, 2800);
    lastAria = '';
    play('invalid');
    say(noteText);
    requestDraw();
  }

  function cancelGestures() {
    clearRefuse();
    kb.abort();
    machine.cancel();
    session.endDrag();
    preview = null;
  }

  const el = (id) => doc.getElementById(id);
  const btn = { reset: el('btn-reset'), undo: el('btn-undo'), redo: el('btn-redo'), hint: el('btn-hint'), sound: el('btn-sound'), tools: el('tools'), label: el('hud-label'), caption: el('caption'), win: el('win'), winSub: el('win-sub'), again: el('btn-again'),
    back: el('btn-back'), settings: el('btn-settings'), count: el('hud-count'), next: el('btn-next'), menu: el('btn-menu'), stars: el('win-stars'), winTitle: el('win-title'), winAch: el('win-ach') };
  if (btn.label) btn.label.textContent = label;

  /** Prépare le panneau de victoire (t = 0 : progression, texte, son) sans le montrer (V3-27). */
  function fillSolved() {
    const used = session.view().result.usedMovable;
    solved = onSolved ? onSolved(used, { hinted: usedHint, undone: usedUndo }) : null;
    const plural = (n) => (n > 1 ? 's' : '');
    let sub = `${used} pièce${plural(used)} utilisée${plural(used)}`;
    if (solved !== null && solved.best !== undefined) {
      sub = `${used} pièce${plural(used)} · meilleur : ${solved.best}`;
      if (solved.isBest && !solved.first) sub += ' · nouveau record';
    }
    if (solved !== null && typeof solved.sub === 'string') sub = solved.sub; // texte imposé par la coque (niveau partagé, test de l'éditeur, défi)
    if (btn.winSub) btn.winSub.textContent = sub;
    if (btn.winAch) { // V13 : succès gagnés par cette victoire, une ligne dans le panneau (mesurée avec lui par la mise en page)
      const names = solved !== null && Array.isArray(solved.achievements) ? solved.achievements : [];
      btn.winAch.textContent = names.length > 0 ? `Succès : ${names.join(' · ')}` : '';
    }
    if (btn.stars) {
      const n = solved !== null && solved.hasStars !== false ? solved.stars : 0;
      btn.stars.hidden = n === 0;
      btn.stars.textContent = '';
      for (let i = 0; i < 3; i++) {
        const st = doc.createElement('span');
        st.className = i < n ? 'st on' : 'st off';
        st.textContent = i < n ? '★' : '☆';
        st.setAttribute('aria-hidden', 'true');
        btn.stars.appendChild(st);
      }
      btn.stars.setAttribute('role', 'img');
      btn.stars.setAttribute('aria-label', n === 0 ? '' : starsLabel(n));
      btn.stars.classList.remove('shown');
      if (n > 0) btn.stars.dataset.n = String(n);
    }
    const next = solved !== null ? solved.next : null;
    if (btn.next) {
      btn.next.hidden = next === null;
      btn.next.textContent = next === null ? '' : `NIVEAU ${String(next.n).padStart(2, '0')} →`;
    }
    clearTimeout(starsTimer);
    play('victory');
  }

  /** Montre le panneau de victoire : les étoiles se révèlent une à une (CSS, coupé en mouvement réduit), le son des étoiles suit. */
  function revealSolved() {
    if (btn.win) btn.win.style.visibility = '';
    if (btn.winAch && btn.winAch.textContent !== '') { const t = btn.winAch.textContent; btn.winAch.textContent = ''; btn.winAch.append(doc.createTextNode(t)); } // annoncée (aria-live) quand le panneau devient visible
    if (onAchievementsShown && solved !== null && Array.isArray(solved.achievements) && solved.achievements.length > 0) onAchievementsShown(); // V13b (R3) : la coque sait que l'annonce a eu lieu
    if (btn.stars && solved !== null && solved.hasStars !== false && solved.stars > 0) { void btn.stars.offsetWidth; btn.stars.classList.add('shown'); }
    if (solved !== null && solved.hasStars !== false) { clearTimeout(starsTimer); starsTimer = setTimeout(() => { if (session.won) play('stars', solved.stars); }, 750); }
  }

  /** Le focus passe à la commande principale (U2). */
  function focusSolved() {
    const next = solved !== null ? solved.next : null;
    const focusTarget = next !== null && btn.next ? btn.next : btn.again;
    if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus({ preventScroll: true });
  }

  function showSolved() { fillSolved(); revealSolved(); focusSolved(); }

  /** Avance la chronologie de la victoire (immersif) : montée du plateau, panneau, focus (V3-27). */
  function stepVictory(ts) {
    lastTs = ts;
    if (session.won && victory === null) {
      victory = { t0: ts, skipAt: null, id: ++victoryIds, risen: false, revealed: false, focused: false };
      if (ui !== null) ui.stage.victoryPush(ts, ui.floating.obstacles({ without: ['win'] }));
    } else if (!session.won && victory !== null) {
      victory = null;
      if (ui !== null) ui.stage.clearVictoryPush();
      if (btn.win) btn.win.style.visibility = '';
    }
    if (victory === null) return null;
    const t = ts - victory.t0;
    const f = victoryFrame(t, { reduced: renderer.reducedMotion === true, skipAt: victory.skipAt });
    if (ui !== null) {
      if (f.rise && !victory.risen) victory.risen = true;
      if (f.panel && !victory.revealed) { victory.revealed = true; revealSolved(); }
      if (f.focus && !victory.focused && victory.revealed) { victory.focused = true; focusSolved(); }
    } else { victory.risen = true; victory.revealed = true; victory.focused = true; }
    return f;
  }

  function syncWin() {
    if (!btn.win) return;
    const shown = session.won;
    if (btn.win.hidden === !shown) return;
    const hadFocus = doc.activeElement !== null && btn.win.contains(doc.activeElement);
    btn.win.hidden = !shown;
    if (btn.caption) btn.caption.hidden = shown; // le texte de victoire prend la place de la légende, sous le plateau
    if (btn.tools) btn.tools.classList.toggle('won', shown); // V12 : en paysage bas (CSS), le panneau de victoire prend la place du rail des outils
    if (!shown) clearTimeout(starsTimer);
    if (!shown && hadFocus && typeof canvas.focus === 'function') canvas.focus({ preventScroll: true });
    if (!shown) return;
    if (ui === null) { showSolved(); return; }
    fillSolved(); // immersif : le panneau existe (mesuré par la mise en page) mais reste invisible jusqu'à t = 1 300 ms, sauf saut (P11)
    btn.win.style.visibility = 'hidden';
  }

  function afterCommit(prefix) {
    clearRefuse();
    hint = null; // le fantôme disparaît à la commande suivante
    hintText = '';
    preview = null;
    let text = `${prefix} ${litText()}`;
    const justWon = session.won && !wasWon;
    if (justWon) text += `. ${MESSAGES.solved}`;
    wasWon = session.won;
    const sum = summarize(session.state, session.view().result);
    const events = diffEvents(prevSummary, sum);
    prevSummary = sum;
    if (!justWon) for (const e of events.slice(0, 3)) play(e.name, e.arg); // la victoire a son propre son
    if (justWon) renderer.celebrate(session.state, session.view().result);
    say(text.trim());
    requestDraw();
  }

  function commitRotate(id, steps) {
    const cmd = session.rotate(id, steps);
    if (cmd === null) { preview = null; requestDraw(); return; }
    play('rotate');
    afterCommit(rotateMessage(session.state.pieces[id]));
  }

  function commitMove(id, to) {
    const cmd = session.move(id, to);
    if (cmd === null) return;
    play('drop');
    afterCommit(moveMessage(to, session.state.pieces[id]));
  }

  function noRotate(cell, piece) {
    flashCell(cell.c, cell.r);
    say(`${pieceDescription(piece)}. ${MESSAGES.noRotate}`);
  }

  function doUndo() {
    cancelGestures();
    const cmd = session.undo();
    if (cmd === null) { say(MESSAGES.nothingToUndo); requestDraw(); return; }
    usedUndo = true;
    afterCommit('Annulation.');
  }
  function doRedo() {
    cancelGestures();
    const cmd = session.redo();
    if (cmd === null) { say(MESSAGES.nothingToRedo); requestDraw(); return; }
    afterCommit('Refait.');
  }
  function doReset() {
    cancelGestures();
    const fresh = session.won; // « Rejouer » après une victoire : nouvelle tentative
    const cmd = session.reset();
    if (cmd !== null) { if (fresh) { usedHint = false; usedUndo = false; } else usedUndo = true; }
    if (cmd === null) { say(MESSAGES.restarted); requestDraw(); return; }
    wasWon = false;
    afterCommit(`${MESSAGES.restarted}.`);
  }

  /** Indice (bouton ou touche H) : sans effet après la victoire ou pendant une prise. Illimité, sans pénalité (S7). */
  function showHint() {
    if (session.won || session.drag !== null) return;
    const h = getHint ? getHint(session.state) : null;
    usedHint = true;
    if (h === null) { hint = null; hintText = ''; say(MESSAGES.hintSoon); } else if (h.none) { hint = null; hintText = h.text; say(h.text); } else { hint = h; hintText = screenWords(h.text || ''); say(h.text || 'Indice affiché'); }
    lastAria = ''; // force la mise à jour de la légende
    requestDraw();
  }

  const kb = createKeyboardController({ getState: () => session.state, boardDir: (dx, dy) => screenDirToBoard(ui !== null ? ui.stage.view : null, dx, dy) }, {
    onCursor(cell) {
      const res = session.view().result;
      let text = describeCell(session.state, cell.c, cell.r, res.targets);
      if (kb.holding) text += ` (pièce en main). ${litText()}`;
      say(text);
      requestDraw();
    },
    onPick({ id, from }) {
      session.beginDrag(id, from, 'keyboard');
      play('take');
      say(`${MESSAGES.picked}, ${cellName(from.c, from.r)}`);
      requestDraw();
    },
    onHoldMove({ candidate }) {
      session.moveDrag(candidate);
      requestDraw();
    },
    onDrop({ id, from, to, reason, cell }) {
      session.endDrag();
      if (reason === 'moved') commitMove(id, to);
      else if (reason === 'occupied') refuseDrop({ id, from, cell, reason });
      else say(MESSAGES.cancelled);
      requestDraw();
    },
    onCancel() {
      session.endDrag();
      say(MESSAGES.cancelled);
      requestDraw();
    },
    onRotate({ id, steps }) { commitRotate(id, steps); },
    onBlocked({ cell }) {
      flashCell(cell.c, cell.r);
      say(MESSAGES.fixed);
    },
    onNoRotate({ cell, piece }) { noRotate(cell, piece); },
    onUndo: doUndo,
    onRedo: doRedo,
  });

  const machine = createPointerMachine({
    getState: () => session.state,
    cellAt: (x, y) => cellUnder(x, y),
    cellSize: () => (ui !== null ? (ui.stage.view ? ui.stage.view.k : 0) : renderer.layout ? renderer.layout.cell : 0),
  }, {
    onTap({ id, steps }) { commitRotate(id, steps); },
    onBlockedTap({ cell }) {
      flashCell(cell.c, cell.r);
      say(MESSAGES.fixed);
    },
    onNoRotate({ cell, piece }) { noRotate(cell, piece); },
    onLongPress({ id, steps }) { // aperçu : la pièce telle qu'elle serait après la rotation dans l'autre sens
      const p = session.state.pieces[id];
      preview = { c: p.c, r: p.r, o: (p.o + (steps < 0 ? 3 : 1)) & 3, type: p.type };
      say(MESSAGES.preview);
      requestDraw();
    },
    onPreviewEnd() { preview = null; requestDraw(); },
    onDragStart({ id, from }) {
      session.beginDrag(id, from, 'pointer');
      play('take');
      requestDraw();
    },
    onDragMove({ candidate }) {
      session.moveDrag(candidate);
      requestDraw();
    },
    onDrop({ id, from, to, reason, cell }) {
      session.endDrag();
      if (reason === 'moved') commitMove(id, to);
      else if (reason === 'occupied' || reason === 'outside') refuseDrop({ id, from, cell, reason });
      requestDraw();
    },
    onCancel() {
      session.endDrag();
      requestDraw();
    },
  });

  // Curseur initial : la première pièce mobile (sinon la case 0,0).
  const firstMovable = initial.pieces.find((p) => isMovable(p));
  kb.setCursor(firstMovable ? firstMovable.c : 0, firstMovable ? firstMovable.r : 0);

  function onButton(node, fn) {
    if (!node) return;
    const handler = timed((e) => {
      fn();
      if (e.detail > 0 && typeof canvas.focus === 'function' && node !== btn.again && node !== btn.next && node !== btn.menu && node !== btn.back && node !== btn.settings) canvas.focus({ preventScroll: true }); // souris ou doigt : le plateau garde le focus
    });
    node.addEventListener('click', handler);
    cleanups.push(() => node.removeEventListener('click', handler));
  }
  onButton(btn.reset, doReset);
  onButton(btn.again, doReset);
  onButton(btn.undo, doUndo);
  onButton(btn.redo, doRedo);
  onButton(btn.hint, showHint);
  if (btn.hint) { btn.hint.removeAttribute('aria-disabled'); btn.hint.title = 'Indice (H)'; }
  onButton(btn.sound, () => { if (onToggleMute) onToggleMute(); else say(MESSAGES.soundSoon); });
  onButton(btn.settings, () => { if (onSettings) onSettings(); });
  onButton(btn.back, () => { if (onMenu) onMenu(); });
  if (ui !== null && btn.back && btn.back.parentNode && btn.back.parentNode.id === 'hud-tl') { // V9b (test final) : toute la pastille « ‹ MIROIRS · 06 » est le bouton retour ; le clavier garde le seul bouton (nom et focus inchangés)
    const pill = btn.back.parentNode;
    const onPill = (e) => { if (!btn.back.contains(e.target)) btn.back.click(); };
    pill.addEventListener('click', onPill);
    cleanups.push(() => pill.removeEventListener('click', onPill));
  }
  onButton(btn.menu, () => { if (onMenu) onMenu(); });
  onButton(btn.next, () => { if (onNext) onNext(); });

  /** Case sous un point de la fenêtre : la dernière image présentée (caméra comprise) en immersif, le renderer sinon. */
  function cellUnder(x, y) {
    return ui !== null ? ui.stage.cellAt(x, y, canvas.getBoundingClientRect()) : renderer.cellAt(x, y, session.state);
  }

  const detach = attachPointerInput(canvas, machine, {
    wrap: timed,
    onPointerStart(e) {
      keyboardMode = false;
      kb.abort();
      if (ui !== null) lastDown = { x: e.clientX, y: e.clientY, cell: cellUnder(e.clientX, e.clientY) };
      requestDraw();
    },
    onPointerEnd() { requestDraw(); },
    isMovableAt: (x, y) => {
      const cell = cellUnder(x, y);
      return cell !== null && isMovable(pieceAt(session.state, cell.c, cell.r));
    },
  });

  const onKeyDown = timed((e) => {
    const onCanvas = doc.activeElement === canvas;
    const mod = e.ctrlKey || e.metaKey;
    const shortcut = mod && /^[zy]$/i.test(e.key || '');
    if (!onCanvas && !shortcut) return;
    if (e.isComposing) return;
    if (!shortcut) keyboardMode = true;
    if (onCanvas && !mod && !e.altKey && (e.key === 'h' || e.key === 'H')) { // indice
      if (!e.repeat) showHint();
      e.preventDefault();
      requestDraw();
      return;
    }
    if (kb.key(e)) {
      e.preventDefault();
      requestDraw();
    }
  });
  doc.addEventListener('keydown', onKeyDown);
  // V13 : Échap = le bouton retour, APRÈS ses usages existants (geste en cours, pièce en main, fenêtre ouverte, saut de la victoire) :
  // un appui fait une seule chose. Écouté sur le document (focus sur le plateau, un bouton ou nulle part), après onKeyDown.
  const onEscape = timed((e) => {
    if ((e.key !== 'Escape' && e.key !== 'Esc') || e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || dead) return;
    const t = e.target;
    if (t && typeof t.closest === 'function' && t.closest('dialog')) return; // la fenêtre se ferme d'abord (réglages, partage)
    if (typeof doc.querySelector === 'function' && doc.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (e.repeat) return; // touche maintenue : jamais deux écrans d'un coup
    if (machine.phase !== 'idle') { machine.cancel(); requestDraw(); return; } // glisser ou appui long en cours : annulé
    if (kb.holding) { kb.abort(); requestDraw(); return; }
    if (onMenu) onMenu();
  });
  doc.addEventListener('keydown', onEscape);
  cleanups.push(() => doc.removeEventListener('keydown', onEscape));
  if (ui !== null) { // P11 : pendant la victoire, un appui après 300 ms saute à t = 1 300 ms ; avant, le geste est sans effet (rien ne tourne par accident)
    const onSkip = (e) => {
      if (victory === null || victory.revealed) return;
      if (e.type === 'keydown' && /^(Shift|Control|Alt|Meta|AltGraph)$/.test(e.key)) return;
      e.stopPropagation();
      if (victory.skipAt === null && lastTs - victory.t0 >= VICTORY.SKIP_MIN_MS) { victory.skipAt = lastTs - victory.t0; requestDraw(); }
    };
    doc.addEventListener('pointerdown', onSkip, { capture: true });
    doc.addEventListener('keydown', onSkip, { capture: true });
    cleanups.push(() => { doc.removeEventListener('pointerdown', onSkip, { capture: true }); doc.removeEventListener('keydown', onSkip, { capture: true }); });
  }
  if (ui !== null) { // parallaxe : souris seulement (P13 : jamais au toucher)
    const onMove = (e) => {
      if (e.pointerType === 'mouse') { const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1; pointer = { nx: (2 * e.clientX) / w - 1, ny: (2 * e.clientY) / h - 1 }; requestDraw(); } else if (e.pointerType === 'touch') pointer = null;
    };
    doc.addEventListener('pointermove', onMove, { capture: true, passive: true });
    cleanups.push(() => doc.removeEventListener('pointermove', onMove, { capture: true }));
    if (typeof renderer.onWake === 'function') { const off = renderer.onWake(() => requestDraw()); if (typeof off === 'function') cleanups.push(off); }
    cleanups.push(() => ui.floating.destroy());
    if (btn.win) { const winCue = watchScroll(btn.win); cleanups.push(() => winCue.destroy()); } // V13b : paysage très bas (640×280) : le panneau de victoire défile, une flèche le dit
    if (compactMq !== null && typeof compactMq.addEventListener === 'function') { // V13b : la règle CSS bascule : nouvelle mise en page tout de suite
      const onCompact = () => { layoutDirty = true; requestDraw(); };
      compactMq.addEventListener('change', onCompact);
      cleanups.push(() => compactMq.removeEventListener('change', onCompact));
    }
  }
  const onCanvasFocus = (e) => {
    // V13 : Tab avec une pièce en main la repose à sa case (le focus quitte le plateau : la prise ne reste jamais « en l'air »).
    // Une fenêtre qui perd le focus (autre application) garde le plateau actif : rien n'est reposé.
    if (e && e.type === 'blur' && kb.holding && doc.activeElement !== canvas) kb.abort();
    // V13b (relecture V13, R5) : le plateau reçoit le focus au clavier (Tab, même après un usage à la souris) : curseur visible tout de suite
    if (e && e.type === 'focus') { try { if (typeof canvas.matches === 'function' && canvas.matches(':focus-visible')) keyboardMode = true; } catch { /* sélecteur inconnu */ } }
    requestDraw();
  };
  canvas.addEventListener('focus', onCanvasFocus);
  canvas.addEventListener('blur', onCanvasFocus);
  cleanups.push(() => { canvas.removeEventListener('focus', onCanvasFocus); canvas.removeEventListener('blur', onCanvasFocus); });

  function cursorInfo() {
    if (!keyboardMode || doc.activeElement !== canvas) return null;
    const c = kb.cursor;
    return { c: c.c, r: c.r, holding: kb.holding };
  }

  function placeUi() {
    const L = renderer.layout;
    if (L === null) return;
    const key = `${L.w}x${L.h}:${L.cell}:${L.x0}:${L.y0}`;
    if (key === placedKey) return;
    placedKey = key;
    if (btn.reset) {
      btn.reset.style.top = `${Math.round(L.hudY - 22)}px`;
      btn.reset.style.right = `${Math.max(0, Math.round(L.padX - 12))}px`;
    }
    if (btn.back) { btn.back.style.top = `${Math.round(L.hudY - 22)}px`; btn.back.style.left = `${Math.max(0, Math.round(L.padX - 12))}px`; }
    if (btn.label) { btn.label.style.top = `${Math.round(L.hudY - 9)}px`; btn.label.style.left = `${Math.round(L.padX + (btn.back ? 40 : 0))}px`; }
    if (btn.tools) btn.tools.style.top = `${Math.round(L.toolsY)}px`;
    if (btn.caption) btn.caption.style.top = `${Math.round(L.captionY)}px`;
    if (btn.win) btn.win.style.top = `${Math.round(L.winY + 6)}px`; // le texte de victoire est SOUS le plateau
  }

  function syncTools(res) {
    const key = `${session.history.canUndo}|${session.history.canRedo}|${session.won}`;
    if (key !== lastTools) {
      lastTools = key;
      if (btn.undo) btn.undo.disabled = !session.history.canUndo;
      if (btn.redo) btn.redo.disabled = !session.history.canRedo;
      if (btn.hint) btn.hint.disabled = session.won; // inactif après la victoire
      syncWin();
    }
    const aria = `Niveau ${label} : ${litMessage(res.litCount, res.targets.length)}`;
    const capKey = `${aria}|${hintText}|${noteText}`;
    if (capKey !== lastAria) {
      lastAria = capKey;
      canvas.setAttribute('aria-label', aria);
      if (btn.caption) btn.caption.textContent = noteText !== '' ? noteText : hintText !== '' ? hintText : litMessage(res.litCount, res.targets.length);
      if (btn.count) btn.count.textContent = `${res.litCount}/${res.targets.length}`;
      if (ui !== null) {
        ui.floating.pin('hint', hintText !== '');
        if (noteText !== '') ui.floating.message();
      }
    }
    if (ui !== null) ui.floating.pin('won', session.won);
  }

  /** Vecteur (px) du centre du plateau vers la dernière cible allumée (recentrage de la caméra, V3-18), ou null. */
  function litTarget(v) {
    if (v.state !== litFor) {
      litFor = v.state;
      const ts = v.result.targets;
      for (let i = 0; i < ts.length; i++) if (ts[i].lit && !litWas[i]) litIdx = i;
      if (litIdx >= 0 && (litIdx >= ts.length || !ts[litIdx].lit)) { litIdx = -1; for (let i = ts.length - 1; i >= 0 && litIdx < 0; i--) if (ts[i].lit) litIdx = i; }
      litWas = ts.map((t) => t.lit);
    }
    if (litIdx < 0) return null;
    const L = ui.stage.layout, list = v.state.pieces.filter((p) => p.type === 'target'), p = list[litIdx];
    if (!p) return null;
    const wx = (p.c + 0.5) * L.cell - (v.state.cols * L.cell) / 2, wy = (p.r + 0.5) * L.cell - (v.state.rows * L.cell) / 2;
    litVec.x = L.rot === 1 ? -wy : wx; litVec.y = L.rot === 1 ? wx : wy;
    return litVec;
  }

  /** Immersif : mise en page (rectangles mesurés des éléments flottants), gel de la caméra (V3-19), pose de l'image. */
  function stepStage(v, ts) {
    const backend = renderer.backend;
    if (backend !== lastBackend) { lastBackend = backend; ui.stage.set({ gl: backend === 'gl' }); layoutDirty = true; }
    let morphAt;
    const wonLayout = victory !== null && victory.risen; // passage à la mise en page de victoire à t = 450 ms (V3-27), tout de suite en mouvement réduit
    if (wonLayout !== lastWon) { lastWon = wonLayout; layoutDirty = true; morphAt = ts; }
    if (layoutDirty) {
      layoutDirty = false;
      const rect = canvas.getBoundingClientRect();
      const rotationObstacles = ui.floating.obstacles({ without: ['win'] }); // la rotation se décide sans le panneau de victoire : le plateau ne bascule pas à la victoire
      ui.stage.relayout({ compact: compactMq !== null ? compactMq.matches : undefined, w: Math.max(1, Math.round(rect.width)), h: Math.max(1, Math.round(rect.height)), cols: v.state.cols, rows: v.state.rows, safe: ui.floating.safeArea(), obstacles: ui.floating.obstacles(), rotationObstacles, morphAt, morphMs: wonLayout ? VICTORY.RISE_DURATION_MS : 0 });
    }
    const hold = machine.onPiece || kb.holding;
    if (hold && !heldCam) { heldCam = true; ui.stage.camera.hold(); } else if (!hold && heldCam) { heldCam = false; ui.stage.camera.release(ts); }
    return ui.stage.frame(ts, { pointer, dragging: session.drag !== null, target: litTarget(v), dpr: Math.min(globalThis.devicePixelRatio || 1, 2) });
  }

  function frame(ts) {
    scheduled = false;
    if (dead) return;
    const t0 = hooks ? hooks.now() : 0;
    const v = session.view();
    const drag = session.drag;
    if (ui !== null) syncTools(v.result); // avant la mise en page : le panneau de victoire est mesuré comme obstacle
    const vf = stepVictory(ts);
    const camera = ui !== null ? stepStage(v, ts) : null;
    renderer.render(v.state, v.result, {
      now: ts,
      cursor: cursorInfo(),
      lift: drag === null ? null : { c: drag.to.c, r: drag.to.r },
      flash,
      refuse,
      preview,
      hint,
      symbols,
      won: session.won && drag === null,
      levelId: level.id,
      victory: victory !== null ? { t: ts - victory.t0, skipAt: victory.skipAt, id: victory.id } : null,
      ...(ui !== null ? { camera, layout: ui.stage.layout } : null),
    });
    if (ui !== null) ui.floating.scrim(ui.stage.view, v.state, v.result.segments());
    else { placeUi(); syncTools(v.result); }
    if (renderer.layout) lastLayoutSeen = renderer.layout;
    if (hooks) hooks.onDraw(hooks.now() - t0);
    if (hooks && hooks.onFrame) hooks.onFrame(ts);
    if (continuous || renderer.animating || (ui !== null && ui.stage.moving) || (vf !== null && !vf.end)) requestDraw();
  }

  function requestDraw() {
    if (dead || scheduled) return;
    scheduled = true;
    requestAnimationFrame(frame);
  }

  const resizeObserver = new ResizeObserver(() => {
    renderer.resize();
    placedKey = '';
    layoutDirty = ui !== null;
    requestDraw();
  });
  resizeObserver.observe(canvas);
  renderer.resize();
  prevSummary = summarize(session.state, session.view().result);
  frame(0);
  if (typeof canvas.focus === 'function') canvas.focus({ preventScroll: true });
  // V13 (focus visible) : le curseur du clavier n'est dessiné d'emblée que si le plateau a reçu le focus au clavier (:focus-visible,
  // heuristique du navigateur : Entrée sur la tuile oui, clic ou toucher non) ; sinon il apparaît à la première touche.
  try { if (typeof canvas.matches === 'function') keyboardMode = canvas.matches(':focus-visible'); } catch { /* sélecteur inconnu : curseur visible, comme avant */ }
  requestDraw();

  return {
    session,
    levelId: level.id,
    requestDraw,
    /** Réglages de l'interface flottante et de la caméra (V3-30) et mouvement réduit : effet immédiat. */
    setUiPrefs(p) {
      if (ui === null) return;
      ui.stage.set({ enabled: p.camera, reduced: p.reduced });
      ui.floating.setAutohide(p.autohide);
      requestDraw();
    },
    /** Épingle l'interface (ex. 'settings' : réglages ouverts). */
    pinUi(name, on) { if (ui !== null) ui.floating.pin(name, on); },
    /** Poussée de zoom de la victoire (ms de l'horloge des images) : déjà déclenchée par la chronologie ; sans effet en mouvement réduit ou caméra coupée (voir `camera`). */
    victoryPush(now) { if (ui !== null) { ui.stage.victoryPush(now, ui.floating.obstacles({ without: ['win'] })); requestDraw(); } },
    /** Symboles sur les faisceaux (réglage U8) : effet à l'image suivante. */
    setSymbols(on) { symbols = on === true; requestDraw(); },
    /** État du bouton de son (réglage U8 / touche M). */
    setMutedUi(muted) {
      if (!btn.sound) return;
      btn.sound.classList.toggle('muted', muted);
      btn.sound.setAttribute('aria-pressed', muted ? 'true' : 'false');
      const t = muted ? 'Activer le son (M)' : 'Couper le son (M)';
      btn.sound.title = t; btn.sound.setAttribute('aria-label', t);
    },
    focusBoard() { if (typeof canvas.focus === 'function') canvas.focus({ preventScroll: true }); },
    announce: say,
    /** Redessine à chaque image même sans changement (banc d'essai : pire cas). */
    setContinuous(on) {
      continuous = on === true;
      if (continuous) requestDraw();
    },
    /** Copie simple de l'état observable (utilisée par debug.js, qui la gèle). */
    snapshot() {
      const v = session.view();
      const drag = session.drag;
      const c = kb.cursor;
      const V = ui !== null ? ui.stage.view : null;
      const L = V !== null ? (V.rot === 1 ? { x0: V.tx - V.k * V.rows, y0: V.ty, cell: V.k, boardW: V.k * V.rows, boardH: V.k * V.cols, w: V.w, h: V.h, rot: 1, tx: V.tx, ty: V.ty } : { x0: V.tx, y0: V.ty, cell: V.k, boardW: V.k * V.cols, boardH: V.k * V.rows, w: V.w, h: V.h, rot: 0, tx: V.tx, ty: V.ty }) : ui !== null ? null : renderer.layout || lastLayoutSeen; // entre un redimensionnement et l'image suivante, renderer.layout vaut null : la dernière vue présentée reste la bonne
      return {
        screen: 'game',
        levelId: level.id,
        board: {
          cols: v.state.cols,
          rows: v.state.rows,
          pieces: v.state.pieces.map((p) => ({ id: p.id, type: p.type, c: p.c, r: p.r, o: p.o, mask: p.mask, need: p.need, fixed: p.fixed })),
        },
        trace: {
          litCount: v.result.litCount,
          allLit: v.result.allLit,
          usedMovable: v.result.usedMovable,
          steps: v.result.steps,
          segments: v.result.segments().count,
          targets: v.result.targets.map((t) => ({ need: t.need, got: t.got, lit: t.lit, reached: t.reached })),
          gates: v.result.gates.map((g) => ({ open: g.open })),
        },
        history: { undo: session.history.undoDepth, redo: session.history.redoDepth },
        cursor: { c: c.c, r: c.r, visible: cursorInfo() !== null, holding: kb.holding },
        drag: drag === null ? null : { id: drag.id, from: { ...drag.from }, to: { ...drag.to }, source: drag.source },
        preview: preview === null ? null : { ...preview },
        refuse: refuse === null ? null : { id: refuse.id, reason: refuse.reason, from: { ...refuse.from }, at: refuse.at === null ? null : { ...refuse.at } },
        note: noteText,
        hint: hint === null ? null : { ...hint },
        won: session.won,
        symbols,
        settings: null, // rempli par la coque (app.js)
        fx: { particlesPeak: renderer.particlesPeak, particlesAlive: renderer.particlesAlive, particlesPool: renderer.particlesPool === undefined ? null : renderer.particlesPool, animating: renderer.animating, reducedMotion: renderer.reducedMotion, victory: victory === null ? null : { t: lastTs - victory.t0, skipAt: victory.skipAt, revealed: victory.revealed, focused: victory.focused, risen: victory.risen } },
        view: L === null ? null : { x0: L.x0, y0: L.y0, cell: L.cell, boardW: L.boardW, boardH: L.boardH, w: L.w, h: L.h, rot: L.rot === 1 ? 1 : 0, tx: L.tx === undefined ? L.x0 : L.tx, ty: L.ty === undefined ? L.y0 : L.ty },
        ui: ui === null ? null : { compact: ui.stage.compact, hud: ui.floating.state, plates: ui.floating.plates, camera: { ...ui.stage.pose }, moving: ui.stage.moving, frozen: ui.stage.camera.frozen, layoutCell: ui.stage.layout ? ui.stage.layout.cell : 0, pointerDown: lastDown === null ? null : { ...lastDown } },
      };
    },
    destroy() {
      dead = true;
      for (const fn of cleanups) fn();
      detach();
      doc.removeEventListener('keydown', onKeyDown);
      resizeObserver.disconnect();
      clearTimeout(flashTimer);
      clearTimeout(starsTimer);
      clearTimeout(refuseTimer);
      clearTimeout(noteTimer);
    },
  };
}
