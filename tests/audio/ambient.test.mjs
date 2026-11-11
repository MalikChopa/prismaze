// V11 : nappe d'ambiance : jamais sans contexte « running » (donc jamais sans geste), fondu d'entrée et de sortie, planification
// arrêtée à l'arrêt, niveau bas. Faux contexte Web Audio (aucun son produit sous Node).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAmbient, AMBIENT_LEVEL, FADE_IN_S, FADE_OUT_S } from '../../src/audio/ambient.js';

function fakeCtx(state = 'running') {
  const ramps = [];
  const param = (v = 0) => ({ value: v, setValueAtTime(x) { this.value = x; }, linearRampToValueAtTime(x, t) { ramps.push([x, t]); this.value = x; }, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ connect() {}, gain: param(1), frequency: param(), Q: param(), detune: param(), type: '', threshold: param(), ratio: param(), start() {}, stop() {}, buffer: null });
  const ctx = {
    state, currentTime: 10, sampleRate: 8000, destination: {}, oscillators: 0,
    createGain: node, createBiquadFilter: node, createConvolver: node, createDynamicsCompressor: node,
    createOscillator() { ctx.oscillators++; return node(); },
    createBuffer(ch, n) { return { getChannelData: () => new Float32Array(n) }; },
  };
  return { ctx, ramps };
}
const timers = () => { const t = { active: 0, fns: [] }; return { t, setInterval: (f) => { t.active++; t.fns.push(f); return t.fns.length; }, clearInterval: (id) => { if (id) t.active = Math.max(0, t.active - 1); } }; };

test('sans contexte (aucun geste) ou contexte suspendu : rien ne démarre, rien n\'est créé', () => {
  const tm = timers();
  const a = createAmbient({ audioContext: () => null, rnd: () => 0.5, ...tm });
  assert.equal(a.start(), false);
  assert.equal(a.playing, false);
  const { ctx } = fakeCtx('suspended');
  const b = createAmbient({ audioContext: () => ctx, rnd: () => 0.5, ...tm });
  assert.equal(b.start(), false);
  assert.equal(ctx.oscillators, 0);
  assert.equal(tm.t.active, 0);
});

test('démarrage : fondu d\'entrée de 2,5 s jusqu\'au niveau bas ; accords planifiés ; arrêt : fondu de 0,6 s et planificateur coupé', () => {
  const tm = timers();
  const { ctx, ramps } = fakeCtx();
  const a = createAmbient({ audioContext: () => ctx, rnd: () => 0.3, ...tm });
  assert.equal(a.start(), true);
  assert.equal(a.playing, true);
  assert.deepEqual(ramps[0], [AMBIENT_LEVEL, 10 + FADE_IN_S]);
  assert.ok(AMBIENT_LEVEL <= 0.33, 'niveau général bas');
  assert.ok(a.stats.chords >= 1 && ctx.oscillators > 0, 'un accord est planifié tout de suite');
  assert.equal(tm.t.active, 1);
  assert.equal(a.start(), true, 'deuxième démarrage : sans effet');
  assert.equal(a.stats.starts, 1);
  a.stop();
  assert.equal(a.playing, false);
  assert.deepEqual(ramps[ramps.length - 1], [0, 10 + FADE_OUT_S]);
  assert.equal(tm.t.active, 0, 'plus rien n\'est planifié');
  const before = a.stats.chords;
  for (const f of tm.t.fns) f();
  assert.equal(a.stats.chords, before, 'un rappel tardif du planificateur ne joue rien');
  a.stop();
  assert.equal(a.stats.stops, 1);
});
