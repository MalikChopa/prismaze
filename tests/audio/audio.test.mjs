// Sons (U6) et moteur audio (MVP §9) avec un faux contexte Web Audio. Le rendu réel (crête < 1, énergie > 0) est dans tools/e2e/audio.e2e.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOUNDS, SOUND_NAMES, chordFor, NOTE_HZ } from '../../src/audio/sounds.js';
import { createAudio } from '../../src/audio/audio.js';

/** Faux AudioContext : enregistre les nœuds, leurs connexions et les valeurs programmées. */
function makeFakeContext() {
  const nodes = [];
  const bad = [];
  const checkNum = (what, v) => { if (typeof v === 'number' && !Number.isFinite(v)) bad.push(what); };
  const param = (name) => ({
    value: 0,
    setValueAtTime(v, t) { checkNum(`${name}.v`, v); checkNum(`${name}.t`, t); },
    linearRampToValueAtTime(v, t) { checkNum(`${name}.v`, v); checkNum(`${name}.t`, t); },
    exponentialRampToValueAtTime(v, t) { checkNum(`${name}.v`, v); checkNum(`${name}.t`, t); if (!(v > 0)) bad.push(`${name} rampe exponentielle vers ${v}`); },
    setTargetAtTime() {},
  });
  const node = (kind, extra = {}) => {
    const n = { kind, outs: [], started: null, stopped: null, connect(to) { this.outs.push(to); return to; }, ...extra };
    nodes.push(n);
    return n;
  };
  const ctx = {
    sampleRate: 48000, currentTime: 1, state: 'suspended', destination: node('destination'), resumed: 0,
    createGain: () => node('gain', { gain: param('gain') }),
    createOscillator: () => node('osc', { frequency: param('freq'), type: 'sine', start(t) { this.started = t; }, stop(t) { this.stopped = t; } }),
    createBiquadFilter: () => node('biquad', { frequency: param('bf'), Q: param('Q'), type: 'lowpass' }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len), length: len }),
    createBufferSource: () => node('src', { buffer: null, start(t) { this.started = t; }, stop(t) { this.stopped = t; } }),
    resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); },
  };
  return { ctx, nodes, bad };
}

test('chordFor : une note par couleur, accord pour un mélange (U6)', () => {
  assert.deepEqual([NOTE_HZ[1], NOTE_HZ[2], NOTE_HZ[4]], [392, 494, 587]);
  assert.deepEqual(chordFor(1), [392]);
  assert.deepEqual(chordFor(2), [494]);
  assert.deepEqual(chordFor(4), [587]);
  assert.deepEqual(chordFor(3), [392, 494]);
  assert.deepEqual(chordFor(7), [392, 494, 587]);
  assert.deepEqual(chordFor(0), [392], 'masque nul : repli sur une note');
});

test('les 12 sons de U6 existent', () => {
  for (const n of ['take', 'drop', 'rotate', 'light', 'lost', 'merge', 'prism', 'gate', 'portal', 'invalid', 'victory', 'stars']) assert.ok(SOUND_NAMES.includes(n), n);
  assert.equal(SOUND_NAMES.length, 12);
});

for (const name of Object.keys(SOUNDS)) {
  for (const arg of name === 'light' || name === 'merge' ? [1, 3, 7] : name === 'stars' ? [1, 2, 3] : [undefined]) {
    test(`son « ${name} »${arg === undefined ? '' : ' ' + arg} : nœuds bien branchés jusqu'à la sortie, valeurs finies, durée > 0 et < 2 s`, () => {
      const { ctx, nodes, bad } = makeFakeContext();
      const out = ctx.createGain();
      const dur = SOUNDS[name](ctx, out, 1, arg);
      assert.ok(dur > 0 && dur < 2, `durée ${dur}`);
      assert.deepEqual(bad, []);
      const sources = nodes.filter((n) => n.kind === 'osc' || n.kind === 'src');
      assert.ok(sources.length >= 1, 'au moins une source');
      for (const s of sources) {
        assert.ok(Number.isFinite(s.started) && Number.isFinite(s.stopped) && s.stopped > s.started && s.started >= 1, 'start / stop');
        // chaque source atteint `out` par des nœuds
        const seen = new Set();
        const walk = (n) => { if (seen.has(n)) return false; seen.add(n); return n === out || n.outs.some(walk); };
        assert.ok(walk(s), `une source de « ${name} » n'atteint pas la sortie`);
      }
    });
  }
}

/** Faux window avec écouteurs. */
function makeTarget() {
  const l = new Map();
  return {
    l,
    addEventListener(t, f) { if (!l.has(t)) l.set(t, new Set()); l.get(t).add(f); },
    removeEventListener(t, f) { l.get(t)?.delete(f); },
    fire(t, e) { for (const f of [...(l.get(t) || [])]) f({ type: t, isTrusted: true, ...e }); },
    count: () => [...l.values()].reduce((n, s) => n + s.size, 0),
  };
}

test('moteur : aucun contexte avant le premier geste ; pointerdown n\'active pas ; Échap et événement non fiable non plus', async () => {
  const made = [];
  class FakeAC { constructor() { const f = makeFakeContext(); Object.assign(this, f.ctx); made.push(this); } }
  const target = makeTarget();
  const audio = createAudio({ AudioContextClass: FakeAC, target, now: () => 0 });
  assert.equal(made.length, 0);
  assert.equal(audio.play('take'), false, 'verrouillé : rien joué');
  assert.deepEqual([...target.l.keys()].sort(), ['keydown', 'mousedown', 'pointerup', 'touchend'], 'pas de pointerdown');
  target.fire('keydown', { key: 'Escape' });
  target.fire('mousedown', { isTrusted: false });
  assert.equal(made.length, 0);
  target.fire('pointerup', {});
  assert.equal(made.length, 1, 'un geste fiable crée le contexte');
  await Promise.resolve();
  assert.equal(audio.running, true);
  assert.equal(target.count(), 0, 'écouteurs retirés une fois « running »');
  target.fire('keydown', { key: 'a' });
  assert.equal(made.length, 1, 'un seul AudioContext');
  assert.equal(audio.play('take'), true);
  assert.equal(audio.stats.played, 1);
});

test('moteur : suspendu au premier geste -> resume() rappelé à chaque geste tant qu\'il ne tourne pas', async () => {
  let resumes = 0;
  class StuckAC {
    constructor() { Object.assign(this, makeFakeContext().ctx); this.state = 'suspended'; this.resume = () => { resumes++; return Promise.resolve(); }; }
  }
  const target = makeTarget();
  createAudio({ AudioContextClass: StuckAC, target });
  target.fire('mousedown', {});
  target.fire('keydown', { key: 'x' });
  target.fire('touchend', {});
  await Promise.resolve();
  assert.equal(resumes, 3);
  assert.ok(target.count() > 0, 'écouteurs gardés tant que non « running »');
});

test('moteur : muet = rien programmé ; son inconnu refusé ; deux fois le même son très vite : le second ignoré', () => {
  class FakeAC { constructor() { Object.assign(this, makeFakeContext().ctx); } }
  const target = makeTarget();
  let t = 0;
  const audio = createAudio({ AudioContextClass: FakeAC, target, now: () => t, muted: true });
  audio.unlock();
  audio.unlock();
  assert.equal(audio.play('victory'), false);
  assert.equal(audio.stats.skippedMuted, 1);
  audio.setMuted(false);
  assert.equal(audio.muted, false);
  assert.equal(audio.play('nimporte'), false);
  assert.equal(audio.play('__proto__'), false);
  assert.equal(audio.play('rotate'), true);
  assert.equal(audio.play('rotate'), false, 'trop rapproché');
  t = 100;
  assert.equal(audio.play('rotate'), true);
  assert.equal(audio.play('light', 1), true);
  assert.equal(audio.play('light', 2), true, 'une autre couleur n\'est pas le même son');
});

test('moteur : sans Web Audio (classe absente) : ne lève pas, ne joue rien', () => {
  const audio = createAudio({ AudioContextClass: null, target: makeTarget() });
  assert.equal(audio.supported, false);
  assert.equal(audio.unlock(), false);
  assert.equal(audio.play('take'), false);
});

test('moteur : un contexte qui lève à la création ou en jouant ne casse pas le jeu', () => {
  class Boom { constructor() { throw new Error('NotSupportedError'); } }
  const a = createAudio({ AudioContextClass: Boom, target: makeTarget() });
  assert.equal(a.unlock(), false);
  assert.equal(a.stats.errors, 1);
  class Half { constructor() { Object.assign(this, makeFakeContext().ctx); this.createOscillator = () => { throw new Error('x'); }; } }
  const b = createAudio({ AudioContextClass: Half, target: makeTarget() });
  b.unlock();
  assert.equal(b.play('take'), false);
  assert.equal(b.stats.errors, 1);
});
