// V5 : mode de l'interface (URL), masquage automatique en DOM factice (horloge injectable), voile de lisibilité, contrastes (V3-6, V3-21, V3-23).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uiMode, createFloatingUi } from '../../src/ui/hud.js';
import { textContrast, SCRIM } from '../../src/render/scene/scrim.js';

test('uiMode : joueur immersif ; ?debug = disposition classique (V3-35) ; voies d\'essai', () => {
  const m = (q) => { const { rotation, ...rest } = uiMode(new URLSearchParams(q)); return rest; }; // rotation : tests/render/portrait.test.mjs
  assert.deepEqual(m(''), { immersive: true, camera: true, autohide: true });
  assert.deepEqual(m('?camera=0&autohide=0'), { immersive: true, camera: false, autohide: false });
  assert.deepEqual(m('?debug'), { immersive: false, camera: false, autohide: false });
  assert.deepEqual(m('?debug&camera=1&autohide=1'), { immersive: true, camera: true, autohide: true });
  assert.deepEqual(m('?debug&immersive=1'), { immersive: true, camera: false, autohide: false });
  assert.deepEqual(m('?immersive=0'), { immersive: false, camera: false, autohide: false });
});

function fakeDom() {
  const listeners = {};
  const els = {};
  const el = (id) => (els[id] ||= { id, hidden: false, dataset: {}, props: {}, style: { setProperty(k, v) { el(id).props[k] = v; } }, closest: () => null, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40 }) });
  return {
    els, el,
    doc: {
      getElementById: el,
      addEventListener(t, fn) { (listeners[t] ||= new Set()).add(fn); },
      removeEventListener(t, fn) { listeners[t] && listeners[t].delete(fn); },
    },
    fire(t, e = {}) { for (const fn of listeners[t] || []) fn(e); },
    count: (t) => (listeners[t] ? listeners[t].size : 0),
  };
}

function setup(opts = {}) {
  const dom = fakeDom();
  let now = 0, id = 0;
  const timers = new Map();
  const ui = createFloatingUi({
    doc: dom.doc, win: { getComputedStyle: () => ({}) }, root: dom.el('screen-game'), autohide: opts.autohide !== false, now: () => now,
    setTimer: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; },
    clearTimer: (i) => timers.delete(i),
  });
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      let next = null, key = null;
      for (const [k, v] of timers) if (v.at <= end && (next === null || v.at < next.at)) { next = v; key = k; }
      if (next === null) break;
      timers.delete(key); now = next.at; next.fn();
    }
    now = end;
  };
  return { dom, ui, advance, root: dom.el('screen-game'), now: () => now };
}

test('visible puis masquée après 3,6 s sans entrée ; une entrée réveille', () => {
  const { ui, advance, root, dom } = setup();
  assert.equal(root.dataset.hud, 'visible');
  advance(3500);
  assert.equal(ui.state, 'visible');
  advance(200);
  assert.equal(ui.state, 'idle');
  assert.equal(root.dataset.hud, 'idle');
  dom.fire('keydown');
  assert.equal(ui.state, 'visible', 'une touche réveille (avant le déplacement du focus : capture)');
  advance(3700);
  assert.equal(ui.state, 'idle');
  dom.fire('pointermove');
  assert.equal(ui.state, 'visible');
  dom.fire('touchstart');
  advance(3700);
  assert.equal(ui.state, 'idle', 'réarmée après chaque entrée');
});

test('jamais masquée : focus dans la zone, réglages, état gagné, indice', () => {
  const { ui, advance, dom, now } = setup();
  const inside = { closest: (s) => (s === '.fl' ? {} : null) }, outside = { closest: () => null };
  void now;
  dom.fire('focusin', { target: inside });
  advance(9000);
  assert.equal(ui.state, 'visible', 'focus dans la zone');
  dom.fire('focusout', { target: inside, relatedTarget: outside });
  advance(3700);
  assert.equal(ui.state, 'idle', 'focus rendu au plateau');
  for (const name of ['settings', 'won', 'hint']) {
    ui.pin(name, true);
    assert.equal(ui.state, 'visible', `${name} : réveille`);
    advance(20000);
    assert.equal(ui.state, 'visible', `${name} : reste visible`);
    ui.pin(name, false);
    advance(3700);
    assert.equal(ui.state, 'idle', `${name} : se remasque ensuite`);
  }
});

test('message : visible 2,2 s au moins, puis masquage à son terme', () => {
  const { ui, advance } = setup();
  advance(3000);
  ui.message();
  advance(2100);
  assert.equal(ui.state, 'visible', 'message récent');
  advance(4000);
  assert.equal(ui.state, 'idle');
});

test('réglage coupé : toujours visible ; ré-activé : masquage rétabli', () => {
  const { ui, advance } = setup({ autohide: false });
  advance(20000);
  assert.equal(ui.state, 'visible');
  ui.setAutohide(true);
  advance(3700);
  assert.equal(ui.state, 'idle');
});

test('destroy : aucun écouteur restant, plus de réveil, ni de marque sur l\'écran', () => {
  const { ui, dom, root } = setup();
  ui.destroy();
  for (const t of ['pointermove', 'pointerdown', 'touchstart', 'keydown', 'focusin', 'focusout']) assert.equal(dom.count(t), 0, t);
  assert.equal(root.dataset.hud, undefined);
});

test('V3-23 : voile 0,30 au repos, 0,70 quand un faisceau passe près d\'un élément', () => {
  const { ui, dom } = setup();
  ui.obstacles();
  const empty = { count: 0, x0: new Float32Array(0), y0: new Float32Array(0), x1: new Float32Array(0), y1: new Float32Array(0) };
  const view = { k: 10, tx: 0, ty: 0 };
  ui.scrim(view, {}, empty);
  assert.equal(dom.els['hud-tl'].props['--plate'], String(SCRIM.LOW));
  const seg = { count: 1, x0: Float32Array.of(0), y0: Float32Array.of(0), x1: Float32Array.of(5), y1: Float32Array.of(0) };
  const state2 = {};
  ui.scrim(view, state2, seg);
  assert.equal(dom.els['hud-tl'].props['--plate'], String(SCRIM.HIGH), 'faisceau sur l\'élément');
  dom.els['hud-tl'].props['--plate'] = 'marque';
  ui.scrim(view, state2, seg);
  assert.equal(dom.els['hud-tl'].props['--plate'], 'marque', 'vue et tracé inchangés : rien n\'est recalculé');
});

test('V3-23 : contraste du texte (WCAG) aux deux opacités de plaque, sur le pire fond', () => {
  assert.ok(textContrast('#ffffff', SCRIM.HIGH) >= 4.5, 'plaque 0,70 sur faisceau blanc');
  assert.ok(textContrast('#06061a', SCRIM.LOW) >= 4.5, 'plaque 0,30 sur fond sombre');
});
