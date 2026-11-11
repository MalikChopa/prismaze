// Moteur audio (ARCHITECTURE.md §9, V2 U6) : UN AudioContext, créé au premier geste d'activation (jamais avant), relancé par resume().
// Gestes écoutés (spécification HTML, « activation triggering input event ») : keydown sauf Échap, mousedown, pointerup, touchend, seulement
// si event.isTrusted. PAS pointerdown : pour un doigt il n'active pas. À chaque geste, tant que l'état n'est pas « running », on rappelle
// resume() ; les écouteurs sont retirés une fois « running ». Retour sur l'onglet : resume() aussi (iOS peut passer en « interrupted » : non vérifié).
// Muet = rien n'est programmé (et le gain général passe à 0) ; l'état est celui de la sauvegarde, tenu par l'appelant via setMuted().
import { SOUNDS } from './sounds.js';

const MIN_GAP_MS = 35; // même son répété plus vite : ignoré (évite l'empilement)
const MAX_VOICES = 6; // sons simultanés au plus

/**
 * @param {{AudioContextClass?:Function|null, target?:object, doc?:object, now?:()=>number, muted?:boolean}} [opts]
 *   target : objet qui reçoit les événements de geste (window) ; doc : document (visibilitychange) ; tous injectables pour les tests.
 */
export function createAudio(opts = {}) {
  const AC = opts.AudioContextClass !== undefined ? opts.AudioContextClass : (typeof globalThis.AudioContext === 'function' ? globalThis.AudioContext : null);
  const target = opts.target || null;
  const doc = opts.doc || null;
  const now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() : 0));
  let muted = opts.muted === true;
  let ctx = null;
  let master = null;
  let voices = 0;
  let attached = false;
  const lastPlayed = new Map();
  const runningListeners = new Set(); // V11 : prévenus quand le contexte tourne (la nappe d'ambiance démarre au premier geste)
  const notifyRunning = () => { for (const fn of [...runningListeners]) { try { fn(); } catch { /* un abonné ne casse pas le son */ } } };
  const stats = { played: 0, skippedMuted: 0, skippedLocked: 0, skippedRate: 0, errors: 0 };

  const GESTURES = ['keydown', 'mousedown', 'pointerup', 'touchend'];

  function onGesture(e) {
    if (e && e.isTrusted === false) return;
    if (e && e.type === 'keydown' && e.key === 'Escape') return;
    unlock();
  }

  function detach() {
    if (!attached || target === null) return;
    attached = false;
    for (const t of GESTURES) target.removeEventListener(t, onGesture, true);
  }

  /** Crée le contexte (premier geste) ou le relance ; retire les écouteurs une fois « running ». */
  function unlock() {
    if (AC === null) return false;
    try {
      if (ctx === null) {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.8;
        master.connect(ctx.destination);
      }
      if (ctx.state !== 'running' && typeof ctx.resume === 'function') {
        const p = ctx.resume();
        if (p && typeof p.then === 'function') p.then(() => { if (ctx.state === 'running') { detach(); notifyRunning(); } }, () => {});
      }
      if (ctx.state === 'running') { detach(); notifyRunning(); }
      return true;
    } catch {
      stats.errors++;
      return false;
    }
  }

  function attach() {
    if (attached || target === null) return;
    attached = true;
    for (const t of GESTURES) target.addEventListener(t, onGesture, true);
    if (doc !== null && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'visible' && ctx !== null && ctx.state !== 'running') unlock();
      });
    }
  }

  attach();

  return {
    /** Appelé par un geste (tests : direct). */
    unlock,
    get supported() { return AC !== null; },
    /** Le contexte existe-t-il et tourne-t-il ? */
    get running() { return ctx !== null && ctx.state === 'running'; },
    get state() { return ctx === null ? 'none' : ctx.state; },
    /** V11 : le contexte (null avant le premier geste), partagé avec la nappe d'ambiance (ambient.js) : jamais créé hors d'un geste. */
    get context() { return ctx; },
    /** V11 : `fn` est appelé chaque fois qu'un geste laisse le contexte « running » ; renvoie la fonction de désabonnement. */
    onRunning(fn) { runningListeners.add(fn); return () => runningListeners.delete(fn); },
    get muted() { return muted; },
    get stats() { return { ...stats }; },
    setMuted(m) {
      muted = m === true;
      if (master === null) return;
      if (typeof master.gain.setTargetAtTime === 'function') master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.01);
      else master.gain.value = muted ? 0 : 0.8;
    },
    /**
     * Joue un son nommé. Renvoie true s'il a été programmé. Sans geste préalable, muet, ou trop rapproché du précédent : false.
     * @param {string} name  clé de SOUNDS
     * @param {*} [arg]  paramètre du son (masque de couleur, nombre d'étoiles)
     */
    play(name, arg) {
      if (!Object.prototype.hasOwnProperty.call(SOUNDS, name)) return false;
      if (muted) { stats.skippedMuted++; return false; }
      if (ctx === null || ctx.state !== 'running') { stats.skippedLocked++; return false; }
      const t = now();
      const key = `${name}:${arg === undefined ? '' : arg}`;
      const last = lastPlayed.get(key);
      if ((last !== undefined && t - last < MIN_GAP_MS) || voices >= MAX_VOICES) { stats.skippedRate++; return false; }
      lastPlayed.set(key, t);
      try {
        voices++;
        const dur = SOUNDS[name](ctx, master, ctx.currentTime + 0.005, arg);
        setTimeout(() => { voices = Math.max(0, voices - 1); }, Math.ceil(dur * 1000) + 60);
        stats.played++;
        return true;
      } catch {
        voices = Math.max(0, voices - 1);
        stats.errors++;
        return false;
      }
    },
  };
}
