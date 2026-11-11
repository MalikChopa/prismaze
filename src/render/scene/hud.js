// Automate de masquage de l'interface flottante (ARCHITECTURE_V3_RENDU V3-21). Module PUR, horloge injectable.
// `visible → idle` après 3,6 s sans entrée ; retour au moindre pointermove, pointerdown, touchstart, keydown ou focus dans la zone.
// Jamais masquée : réglages ouverts, focus dans la zone, message affiché depuis moins de 2,2 s, état gagné, indice affiché.
// Deux transitions d'opacité (appliquées en CSS) : apparition 80 ms, disparition 700 ms. Jamais `visibility:hidden` ni `display:none`.
export const HUD = Object.freeze({ IDLE_MS: 3600, MESSAGE_MS: 2200, SHOW_MS: 80, HIDE_MS: 700, WAKE_EVENTS: Object.freeze(['pointermove', 'pointerdown', 'touchstart', 'keydown', 'focusin']) });

/**
 * @param {{enabled?:boolean}} [opt]  enabled=false (réglage « masquage auto » coupé, ou ?autohide=0) : toujours visible
 */
export function createHud(opt = {}) {
  let enabled = opt.enabled !== false, lastInput = 0, state = 'visible', msgAt = -Infinity;
  const pin = { settings: false, focus: false, won: false, hint: false };
  const sticky = (now) => pin.settings || pin.focus || pin.won || pin.hint || now - msgAt < HUD.MESSAGE_MS;
  return {
    get state() { return state; },
    set(o) { if (o.enabled !== undefined) enabled = o.enabled !== false; },
    /** Événement d'entrée (voir HUD.WAKE_EVENTS) : réveille l'interface. Le `keydown` doit être transmis AVANT le déplacement du focus. */
    input(now) { lastInput = now; state = 'visible'; },
    /** Épingles : 'settings' (réglages ouverts), 'focus' (focus dans la zone), 'won' (état gagné), 'hint' (indice affiché). */
    pin(name, on, now) { if (name in pin) { pin[name] = on === true; if (on) { state = 'visible'; lastInput = now; } else lastInput = Math.max(lastInput, now); } },
    /** Message affiché (annonce visible) : l'interface reste visible 2,2 s. */
    message(now) { msgAt = now; lastInput = Math.max(lastInput, now); state = 'visible'; },
    /** Avance l'horloge ; renvoie { state, transitionMs } : transitionMs = durée de la transition d'opacité vers cet état. */
    tick(now) {
      if (!enabled) { state = 'visible'; lastInput = now; }
      else if (sticky(now)) state = 'visible';
      else if (state === 'visible' && now - lastInput >= HUD.IDLE_MS) state = 'idle';
      return { state, transitionMs: state === 'visible' ? HUD.SHOW_MS : HUD.HIDE_MS };
    },
    /** Instant où l'interface passera à `idle` sans nouvelle entrée (pour armer un minuteur) ; Infinity si elle ne se masquera pas. */
    idleAt(now) { return !enabled || sticky(now) || state === 'idle' ? Infinity : lastInput + HUD.IDLE_MS; },
  };
}

/** Opacité modélisée (linéaire) d'un élément qui passe de `from` à `to` en `transitionMs` : sert aux tests (le rendu réel est une transition CSS). */
export function opacityAfter(state, sinceMs) {
  return state === 'visible' ? Math.min(1, sinceMs / HUD.SHOW_MS) : Math.max(0, 1 - sinceMs / HUD.HIDE_MS);
}
