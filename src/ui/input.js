// Entrées du plateau (ARCHITECTURE.md §8) : automate du pointeur, contrôleur du clavier, et la colle DOM.
// L'automate et le contrôleur sont purs (aucun accès au DOM) : ils se testent sous `node --test`.
// Ils ne modifient jamais l'état : ils appellent des gestionnaires (`handlers`), et `game.js` décide.
import { pieceAt, isMovable, isRotatable } from '../engine/state.js';

export const DRAG_MIN_PX = 6;
export const DRAG_CELL_FRACTION = 0.2;
export const LONG_PRESS_MS = 450;

/** Seuil de glisser en pixels : max(6 px, 0,2 case). */
export function dragThreshold(cellPx) {
  return Math.max(DRAG_MIN_PX, DRAG_CELL_FRACTION * (Number.isFinite(cellPx) ? cellPx : 0));
}

/**
 * Pourquoi un lâcher donne ce résultat : 'moved' (case libre), 'same' (case d'origine),
 * 'occupied' (case occupée), 'outside' (hors du plateau). Seul 'moved' crée une commande (P3).
 */
export function classifyDrop(state, id, cell) {
  const from = state.pieces[id];
  if (cell === null || cell === undefined) return { reason: 'outside', to: { c: from.c, r: from.r } };
  if (cell.c === from.c && cell.r === from.r) return { reason: 'same', to: { c: from.c, r: from.r } };
  if (pieceAt(state, cell.c, cell.r) !== undefined) return { reason: 'occupied', to: { c: from.c, r: from.r } };
  return { reason: 'moved', to: { c: cell.c, r: cell.r } };
}

const noop = () => {};

/**
 * Automate du pointeur : tap / glisser, pointeur unique.
 * @param {{getState:()=>object, cellAt:(x:number,y:number)=>({c:number,r:number}|null), cellSize:()=>number}} deps
 *   getState = état VALIDÉ (le miroir tenu reste à sa case d'origine) ; cellAt prend des coordonnées d'écran.
 * @param {object} handlers  onTap({id, cell, steps}), onBlockedTap({cell, piece}), onNoRotate({cell, piece}) (prisme, filtre : un toucher ne fait rien),
 *   onLongPress({id, cell, steps}) (appui long 450 ms ou clic droit : aperçu de la rotation dans l'autre sens), onPreviewEnd() (l'aperçu disparaît),
 *   onDragStart({id, from}), onDragMove({id, from, candidate}), onDrop({id, from, to, reason, cell}), onCancel({id})
 *   (cell : la case visée au lâcher, ou null hors du plateau ; sert au retour visuel d'un lâcher refusé)
 *   onDrop est appelé aussi pour 'same', 'occupied', 'outside' (to = case d'origine) : à l'appelant de ne créer
 *   une commande que pour 'moved'.
 */
export function createPointerMachine(deps, handlers = {}) {
  const h = { onTap: noop, onBlockedTap: noop, onNoRotate: noop, onLongPress: noop, onPreviewEnd: noop, onDragStart: noop, onDragMove: noop, onDrop: noop, onCancel: noop, ...handlers };
  const setTimer = deps.setTimer || ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimer = deps.clearTimer || ((id) => globalThis.clearTimeout(id));
  let timer = null;
  function stopTimer() { if (timer !== null) { clearTimer(timer); timer = null; } }
  /** @type {null|{pointerId:number, button:number, startX:number, startY:number, kind:string, id:number, cell:object|null,
   *   from:{c:number,r:number}|null, dragging:boolean, exceeded:boolean, candidate:{c:number,r:number}|null, rotatable:boolean, longFired:boolean}} */
  let active = null;
  function endPreview() { if (active !== null && active.longFired) { active.longFired = false; h.onPreviewEnd(); } }

  function candidateAt(x, y) {
    const state = deps.getState();
    const cell = deps.cellAt(x, y);
    const res = classifyDrop(state, active.id, cell);
    return res.reason === 'moved' ? res.to : { c: active.from.c, r: active.from.r };
  }

  return {
    get phase() { return active === null ? 'idle' : active.dragging ? 'dragging' : 'pressed'; },
    get activePointerId() { return active === null ? null : active.pointerId; },
    /** true entre l'appui sur une pièce et le lâcher (la caméra reste gelée : V3-19). */
    get onPiece() { return active !== null && active.kind !== 'none'; },

    /** @returns {boolean} true si ce pointeur devient le pointeur actif */
    down(ev) {
      if (active !== null) return false; // un second doigt (ou bouton) est ignoré tant que le premier est posé
      if (ev.isPrimary === false) return false;
      const button = ev.button === undefined ? 0 : ev.button;
      if (button !== 0 && button !== 2) return false; // clic du milieu et autres : ignorés
      const state = deps.getState();
      const cell = deps.cellAt(ev.x, ev.y);
      const piece = cell === null ? undefined : pieceAt(state, cell.c, cell.r);
      let kind = 'none';
      if (piece !== undefined) kind = isMovable(piece) ? 'movable' : 'blocked';
      active = {
        pointerId: ev.pointerId, button, startX: ev.x, startY: ev.y, kind,
        id: piece === undefined ? -1 : piece.id, cell, from: piece === undefined ? null : { c: piece.c, r: piece.r },
        dragging: false, exceeded: false, candidate: null, rotatable: isRotatable(piece), longFired: false,
      };
      stopTimer();
      if (active.rotatable) {
        const fire = () => {
          timer = null;
          if (active === null || active.exceeded || active.dragging || active.longFired) return;
          active.longFired = true;
          h.onLongPress({ id: active.id, cell: { ...active.cell }, steps: -1 });
        };
        if (button === 2) fire(); // clic droit : l'aperçu est immédiat
        else timer = setTimer(fire, LONG_PRESS_MS);
      }
      return true;
    },

    move(ev) {
      if (active === null || ev.pointerId !== active.pointerId) return;
      if (!active.dragging) {
        if (active.exceeded) return;
        const dist = Math.hypot(ev.x - active.startX, ev.y - active.startY);
        if (dist <= dragThreshold(deps.cellSize())) return;
        active.exceeded = true; // ce n'est plus un toucher
        stopTimer();
        endPreview();
        if (active.kind !== 'movable' || active.button !== 0) return;
        active.dragging = true;
        active.candidate = { c: active.from.c, r: active.from.r };
        h.onDragStart({ id: active.id, from: { ...active.from } });
      }
      const cand = candidateAt(ev.x, ev.y);
      if (cand.c !== active.candidate.c || cand.r !== active.candidate.r) {
        active.candidate = cand;
        h.onDragMove({ id: active.id, from: { ...active.from }, candidate: { ...cand } });
      }
    },

    up(ev) {
      if (active === null || ev.pointerId !== active.pointerId) return;
      const a = active;
      stopTimer();
      active = null;
      if (a.dragging) {
        const cell = deps.cellAt(ev.x, ev.y);
        const res = classifyDrop(deps.getState(), a.id, cell);
        h.onDrop({ id: a.id, from: { ...a.from }, to: res.to, reason: res.reason, cell: cell === null ? null : { c: cell.c, r: cell.r } });
        return;
      }
      if (a.exceeded) return; // mouvement sans glisser possible (pièce fixe, vide, clic droit) : rien
      if (a.kind === 'movable') {
        if (a.rotatable) h.onTap({ id: a.id, cell: { ...a.cell }, steps: a.button === 2 || a.longFired ? -1 : 1 });
        else h.onNoRotate({ cell: { ...a.cell }, piece: deps.getState().pieces[a.id] });
      } else if (a.kind === 'blocked') h.onBlockedTap({ cell: { ...a.cell }, piece: deps.getState().pieces[a.id] });
    },

    /** pointercancel, perte de capture ou Échap : le geste est annulé, aucune commande. */
    cancel(ev) {
      if (active === null) return;
      if (ev && ev.pointerId !== undefined && ev.pointerId !== active.pointerId) return;
      const a = active;
      stopTimer();
      if (a.longFired) h.onPreviewEnd();
      active = null;
      if (a.dragging) h.onCancel({ id: a.id });
    },
  };
}

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/**
 * Contrôleur du clavier (curseur, prendre/poser, tourner, annuler la prise, annuler/refaire).
 * @param {{getState:()=>object}} deps  état VALIDÉ
 * @param {object} handlers  onCursor({c,r}), onPick({id, from}), onHoldMove({id, from, candidate}),
 *   onDrop({id, from, to, reason}), onCancel({id}), onRotate({id, steps}), onBlocked({cell, piece}),
 *   onUndo(), onRedo()
 */
export function createKeyboardController(deps, handlers = {}) {
  const h = { onCursor: noop, onPick: noop, onHoldMove: noop, onDrop: noop, onCancel: noop, onRotate: noop, onBlocked: noop, onNoRotate: noop, onUndo: noop, onRedo: noop, ...handlers };
  const cursor = { c: 0, r: 0 };
  /** @type {null|{id:number, from:{c:number,r:number}, candidate:{c:number,r:number}}} */
  let hold = null;

  function cellOfCursor() { return { c: cursor.c, r: cursor.r }; }
  function pieceUnderCursor() { return pieceAt(deps.getState(), cursor.c, cursor.r); }
  function holdCandidate() {
    const res = classifyDrop(deps.getState(), hold.id, cellOfCursor());
    return res.reason === 'moved' ? res.to : { c: hold.from.c, r: hold.from.r };
  }

  const api = {
    get cursor() { return { c: cursor.c, r: cursor.r }; },
    get hold() { return hold === null ? null : { id: hold.id, from: { ...hold.from }, candidate: { ...hold.candidate } }; },
    get holding() { return hold !== null; },

    setCursor(c, r) {
      const s = deps.getState();
      cursor.c = Math.max(0, Math.min(s.cols - 1, c));
      cursor.r = Math.max(0, Math.min(s.rows - 1, r));
    },

    /** Abandonne la prise en cours (la pièce reste à sa case d'origine). @returns {boolean} true s'il y avait une prise */
    abort() {
      if (hold === null) return false;
      const id = hold.id;
      cursor.c = hold.from.c; // le curseur suit le miroir qui revient à son origine
      cursor.r = hold.from.r;
      hold = null;
      h.onCancel({ id });
      return true;
    },

    /**
     * @param {{key:string, ctrlKey?:boolean, metaKey?:boolean, shiftKey?:boolean, altKey?:boolean, repeat?:boolean}} ev
     * @returns {boolean} true si la touche est traitée (l'appelant fait alors preventDefault)
     */
    key(ev) {
      const mod = ev.ctrlKey === true || ev.metaKey === true; // Cmd = Ctrl (Mac : non vérifié)
      const k = typeof ev.key === 'string' ? ev.key : '';
      const lower = k.length === 1 ? k.toLowerCase() : k;
      if (mod && !ev.altKey) {
        if (lower === 'z') { api.abort(); (ev.shiftKey ? h.onRedo : h.onUndo)(); return true; }
        if (lower === 'y') { api.abort(); h.onRedo(); return true; }
        return false;
      }
      if (mod || ev.altKey) return false;
      const arrowOnScreen = ARROWS[k];
      if (arrowOnScreen !== undefined) {
        const arrow = deps.boardDir ? deps.boardDir(arrowOnScreen[0], arrowOnScreen[1]) : arrowOnScreen; // V7 : flèche selon l'écran, plateau tourné ou non
        const s = deps.getState();
        const c = Math.max(0, Math.min(s.cols - 1, cursor.c + arrow[0]));
        const r = Math.max(0, Math.min(s.rows - 1, cursor.r + arrow[1]));
        if (c !== cursor.c || r !== cursor.r) {
          cursor.c = c;
          cursor.r = r;
          if (hold !== null) {
            const cand = holdCandidate();
            if (cand.c !== hold.candidate.c || cand.r !== hold.candidate.r) {
              hold.candidate = cand;
              h.onHoldMove({ id: hold.id, from: { ...hold.from }, candidate: { ...cand } });
            }
          }
        }
        h.onCursor(cellOfCursor());
        return true;
      }
      if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        if (ev.repeat === true) return true;
        if (hold !== null) {
          const res = classifyDrop(deps.getState(), hold.id, cellOfCursor());
          const done = hold;
          const aimed = cellOfCursor();
          hold = null;
          if (res.reason !== 'moved') { // le miroir revient à sa case : le curseur aussi
            cursor.c = done.from.c;
            cursor.r = done.from.r;
          }
          h.onDrop({ id: done.id, from: { ...done.from }, to: res.to, reason: res.reason, cell: aimed });
          return true;
        }
        const p = pieceUnderCursor();
        if (p === undefined) return true;
        if (!isMovable(p)) { h.onBlocked({ cell: cellOfCursor(), piece: p }); return true; }
        hold = { id: p.id, from: { c: p.c, r: p.r }, candidate: { c: p.c, r: p.r } };
        h.onPick({ id: p.id, from: { c: p.c, r: p.r } });
        return true;
      }
      if (lower === 'r') {
        const steps = ev.shiftKey ? -1 : 1;
        if (hold !== null) {
          const held = deps.getState().pieces[hold.id];
          if (isRotatable(held)) h.onRotate({ id: hold.id, steps }); else h.onNoRotate({ cell: cellOfCursor(), piece: held });
          return true;
        }
        const p = pieceUnderCursor();
        if (p === undefined) return true;
        if (!isMovable(p)) { h.onBlocked({ cell: cellOfCursor(), piece: p }); return true; }
        if (!isRotatable(p)) { h.onNoRotate({ cell: cellOfCursor(), piece: p }); return true; }
        h.onRotate({ id: p.id, steps });
        return true;
      }
      if (k === 'Escape' || k === 'Esc') { // V13 : traitée seulement s'il y a une prise à annuler ; sinon l'appelant en fait « retour »
        if (hold === null) return false;
        if (ev.repeat === true) return true;
        api.abort();
        return true;
      }
      return false;
    },
  };
  return api;
}

/**
 * Colle DOM : écoute les Pointer Events du canvas et alimente l'automate. Seule fonction de ce fichier qui touche au DOM.
 * @param {HTMLElement} el
 * @param {ReturnType<typeof createPointerMachine>} machine
 * @param {{onPointerStart?:(ev:PointerEvent)=>void, isMovableAt?:(x:number,y:number)=>boolean, wrap?:(fn:Function)=>Function}} [opts]
 * @returns {() => void} fonction de retrait des écouteurs
 */
export function attachPointerInput(el, machine, opts = {}) {
  const wrap = opts.wrap || ((fn) => fn);
  const toEv = (e) => ({ pointerId: e.pointerId, pointerType: e.pointerType, button: e.button, isPrimary: e.isPrimary, x: e.clientX, y: e.clientY });
  const on = (type, fn, options) => {
    const w = wrap(fn);
    el.addEventListener(type, w, options);
    return () => el.removeEventListener(type, w, options);
  };
  const offs = [
    on('pointerdown', (e) => {
      if (opts.onPointerStart) opts.onPointerStart(e);
      if (e.button !== 0 && e.button !== 2) return;
      const accepted = machine.down(toEv(e));
      if (accepted) {
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
      }
      if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    }),
    on('pointermove', (e) => {
      machine.move(toEv(e));
      if (el.style && e.pointerType === 'mouse' && opts.isMovableAt) {
        el.style.cursor = machine.phase === 'dragging' ? 'grabbing' : opts.isMovableAt(e.clientX, e.clientY) ? 'grab' : 'default';
      }
    }),
    on('pointerup', (e) => {
      machine.up(toEv(e));
      if (opts.onPointerEnd) opts.onPointerEnd(e);
      if (el.style && e.pointerType === 'mouse' && opts.isMovableAt) el.style.cursor = opts.isMovableAt(e.clientX, e.clientY) ? 'grab' : 'default';
      try { el.releasePointerCapture(e.pointerId); } catch { /* déjà relâché */ }
    }),
    on('pointercancel', (e) => { machine.cancel(toEv(e)); if (opts.onPointerEnd) opts.onPointerEnd(e); }),
    on('lostpointercapture', (e) => machine.cancel(toEv(e))),
    on('contextmenu', (e) => e.preventDefault()),
  ];
  return () => offs.forEach((off) => off());
}
