// V13b (revue V11-V12 n° 4) : une relance de la nappe (M, M ; aller dans un niveau puis revenir) n'empile jamais un nouvel accord sur un ancien
// encore en tenue : l'arrêt éteint en fondu les voix programmées et arrête leurs oscillateurs. Faux contexte Web Audio (horloge réglable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAmbient, FADE_OUT_S } from '../../src/audio/ambient.js';

function fakeCtx() {
  const oscs = [];
  const param = (v = 0) => ({ value: v, setValueAtTime(x) { this.value = x; }, linearRampToValueAtTime(x) { this.value = x; }, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ connect() {}, gain: param(1), frequency: param(), Q: param(), detune: param(), type: '', threshold: param(), ratio: param(), buffer: null });
  const ctx = {
    state: 'running', currentTime: 10, sampleRate: 8000, destination: {},
    createGain: node, createBiquadFilter: node, createConvolver: node, createDynamicsCompressor: node,
    createOscillator() { const o = { ...node(), t0: null, end: Infinity, start(t) { this.t0 = t; }, stop(t) { this.end = t; } }; oscs.push(o); return o; },
    createBuffer(ch, n) { return { getChannelData: () => new Float32Array(n) }; },
  };
  // oscillateurs sonores à l'instant t (démarrés, pas encore arrêtés), sans les deux LFO du filtre (jamais arrêtés, inaudibles)
  const sounding = (t) => oscs.filter((o) => o.t0 !== null && o.t0 <= t + 1.3 && o.end > t && o.frequency.value > 1).length;
  return { ctx, oscs, sounding };
}
const timers = { setInterval: () => 1, clearInterval: () => {} };

test('relance : l\'accord précédent est éteint (fondu de 0,6 s) avant le nouveau ; le nombre de voix ne grandit pas', () => {
  const { ctx, sounding } = fakeCtx();
  const a = createAmbient({ audioContext: () => ctx, rnd: () => 0.3, ...timers });
  a.start();
  const one = a.voices;
  const osc1 = sounding(ctx.currentTime);
  assert.ok(one >= 4 && osc1 >= 8, `un accord programmé (${one} voix, ${osc1} oscillateurs)`);
  for (let k = 0; k < 3; k++) { // M, M, M, M en 3 s : 3 relances
    ctx.currentTime += 0.5; a.stop();
    ctx.currentTime += 0.5; a.start();
  }
  const after = ctx.currentTime + FADE_OUT_S + 0.05; // les fondus de sortie sont finis
  assert.equal(sounding(after), osc1, 'autant d\'oscillateurs qu\'un seul accord (avant : 4 accords superposés)');
  ctx.currentTime = after;
  assert.equal(a.voices, one, 'voix vivantes = un seul accord');
});

test('arrêt seul : plus aucune voix après le fondu ; les voix déjà finies sont oubliées (aucune liste qui grandit)', () => {
  const { ctx, sounding } = fakeCtx();
  const a = createAmbient({ audioContext: () => ctx, rnd: () => 0.6, ...timers });
  a.start();
  ctx.currentTime += 2; a.stop();
  ctx.currentTime += FADE_OUT_S + 0.05;
  assert.equal(sounding(ctx.currentTime), 0);
  assert.equal(a.voices, 0);
});
