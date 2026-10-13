import test from 'node:test';
import assert from 'node:assert/strict';
import { TraceDSP } from '../src/instruments/vector-fractals/trace-dsp.js';

const TAU = 2 * Math.PI, SIZE = 512;
const state = { contourReader: 'traveler', traceRate: 1, travelerOctaves: 1,
  layerEnabled: [true, true, true], layerVoices: ['sine', 'sine', 'sine'], bendTimbre: 0, foldTimbre: 0 };
const values = value => new Float32Array(SIZE).fill(value);
const sampled = callback => Float32Array.from({ length: SIZE }, (_, index) => callback(index / SIZE));
const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const rms = array => Math.sqrt(array.reduce((sum, value) => sum + value * value, 0) / array.length);
const difference = (a, b) => rms(a.map((value, index) => value - b[index]));
function contact(options = {}) {
  return { x: values(0), y: values(0), bend: values(0), fold: values(0),
    turn: sampled(t => -.6 * TAU * Math.sin(t * TAU)), presence: values(1), turnPerLap: 0, ...options };
}
function bank(contacts = [contact()], options = {}) {
  return { reader: 'traveler', motif: true, id: 7, layers: contacts.map(item => ({ contacts: [item], events: [] })), ...options };
}
function make(input = bank(), options = {}, phase = 0, sampleRate = 12000) {
  const dsp = new TraceDSP(sampleRate); dsp.setState({ ...state, ...options });
  Object.assign(dsp.params, dsp.targets); dsp.rate = dsp.targetRate; dsp.travelerMix = 1;
  dsp.voiceWeights.fill(0);
  for (let layer = 0; layer < 3; layer++) dsp.voiceWeights[layer * 4 + dsp.voiceTargets[layer]] = 1;
  dsp.setBank(input); dsp.setPhase(phase); dsp.primeMotif(); return dsp;
}
function render(dsp, seconds, moving = true, reference = 160) {
  const left = new Float32Array(Math.round(seconds * dsp.sampleRate)), right = new Float32Array(left.length);
  const pair = new Float64Array(2);
  for (let index = 0; index < left.length; index++) {
    dsp.sample(pair, reference, moving); left[index] = pair[0]; right[index] = pair[1];
  }
  return { left, right };
}
function settleAt(dsp, phase) { dsp.setPhase(phase); render(dsp, .4, false); }

test('normalized phrases use direct relative turns at a shared reference, independent of lap count and geometry placement', () => {
  for (const laps of [0, 17, 50000]) {
    const input = bank([contact({ x: values(-.4), y: values(.4), turnPerLap: TAU }), contact({ x: values(.4), y: values(-.4) }), contact()]);
    const dsp = make(input, { pitchDepth: 4 }, laps + .25); render(dsp, .3, false);
    for (let layer = 0; layer < 3; layer++) {
      close(dsp.frequencies[layer], 160 * 2 ** .6, .00003);
      close(dsp.motifPitch[layer], .6); close(dsp.pans[layer], 0);
    }
    const start = Array.from(dsp.motifPitch);
    render(dsp, 1); render(dsp, .3, false);
    start.forEach((pitch, index) => close(dsp.motifPitch[index], pitch));
    assert.ok(dsp.travelerInitialized.every(value => value === 0), 'motifs must not write cumulative path history');
  }
});

test('equal A/B turns have equal frequency at corresponding phrase positions and independent silence windows', () => {
  const a = contact({ turn: sampled(t => t < .5 ? -.4 * TAU * Math.sin(2 * TAU * t) : 0),
    presence: sampled(t => t > .06 && t < .44 ? 1 : 0) });
  const b = contact({ turn: sampled(t => t >= .5 ? -.4 * TAU * Math.sin(2 * TAU * (t - .5)) : 0),
    presence: sampled(t => t > .56 && t < .94 ? 1 : 0) });
  const dsp = make(bank([a, b]));
  for (const phase of [.125, .25, .375]) {
    settleAt(dsp, phase); const frequency = dsp.frequencies[0];
    assert.ok(dsp.gains[0] * dsp.phraseGates[0] > .999); assert.equal(dsp.phraseGates[1], 0);
    settleAt(dsp, phase + .5); close(dsp.frequencies[1], frequency);
    assert.ok(dsp.gains[1] * dsp.phraseGates[1] > .999); assert.equal(dsp.phraseGates[0], 0);
  }
  settleAt(dsp, .5); assert.ok(rms(render(dsp, .1, false).left) < 1e-10);
});

test('motif cue register, pan and color are independent, optional and bounded', () => {
  const quiet = contact({ turn: values(0) });
  const plain = make(bank([quiet])); render(plain, .3, false); const original = render(plain, .2, false);
  close(plain.frequencies[0], 160); assert.deepEqual(original.left, original.right);
  const shifted = make(bank([contact({ turn: values(0), registerOctaves: .37, pan: 1 })]));
  render(shifted, .3, false); const stereo = render(shifted, .2, false);
  close(shifted.frequencies[0], 160 * 2 ** .37); assert.ok(rms(stereo.right) > .1); assert.ok(rms(stereo.left) < 1e-10);
  const colored = make(bank([contact({ turn: values(0), color: 1 })])); render(colored, .3, false);
  const color = render(colored, .2, false); close(colored.frequencies[0], 160);
  assert.ok(difference(original.left, color.left) > .005, 'color remains audible with geometry timbre disabled');
  const hostile = make(bank([contact({ turn: values(1e20), registerOctaves: 1e20, pan: -1e20, color: Infinity })]), { travelerOctaves: 4 });
  const sound = render(hostile, .3);
  assert.ok(sound.left.every(value => Number.isFinite(value) && Math.abs(value) < .91));
  assert.equal(hostile.bank.layers[0].contacts[0].registerOctaves, 4);
  assert.equal(hostile.bank.layers[0].contacts[0].pan, -1);
  assert.equal(hostile.bank.layers[0].contacts[0].color, 0);
});

test('all motif voices respect presence, layer mute and tone level while span zero returns to the reference', () => {
  for (const voice of ['sine', 'reed', 'glass', 'shepard']) {
    const dsp = make(bank(), { layerVoices: [voice, voice, voice] }, .25);
    render(dsp, .2, false); assert.ok(rms(render(dsp, .15, false).left) > .04);
    dsp.setState({ ...state, layerVoices: [voice], travelerOctaves: 0 }); render(dsp, .4, false);
    close(dsp.motifPitch[0], 0); close(dsp.frequencies[0], 160);
    dsp.setState({ ...state, layerVoices: [voice], toneLevel: 0 }); render(dsp, .4, false);
    assert.ok(rms(render(dsp, .1, false).left) < 1e-10);
    dsp.setState({ ...state, layerVoices: [voice], layerEnabled: [false, false, false] }); render(dsp, .4, false);
    assert.ok(rms(render(dsp, .1, false).left) < 1e-10);
    dsp.setState({ ...state, layerVoices: [voice] }); dsp.setBank(bank([contact({ presence: values(0) })]));
    render(dsp, .5, false); assert.ok(rms(render(dsp, .1, false).left) < 1e-10);
  }
});

test('motif playback and snapshot rearm leave accumulated path Traveler history intact', () => {
  const path = bank([contact({ turn: sampled(t => -TAU * t), turnPerLap: -TAU })], { motif: false });
  const dsp = make(path); render(dsp, .4); render(dsp, .3, false);
  const held = dsp.travelerPitch[0]; close(held, .4);
  dsp.setBank(bank()); render(dsp, .4, false); render(dsp, 2); render(dsp, .3, false);
  close(dsp.travelerPitch[0], held);
  const snapshot = dsp.snapshotTraveler();
  const resumed = make(bank(), {}, 100.25); resumed.restoreTraveler(snapshot); resumed.primeMotif();
  render(resumed, .0001, false); close(resumed.frequencies[0], 160 * 2 ** .6, .00003);
  close(resumed.travelerPitch[0], held);
  dsp.setBank(path); render(dsp, .4, false); close(dsp.travelerPitch[0], held);
  render(dsp, .2); render(dsp, .3, false); close(dsp.travelerPitch[0], held + .2);
});

test('phrase resets and live phrase/voice/cue edits stay bounded and release without impulses', () => {
  for (const voice of ['sine', 'shepard']) {
    const phrase = contact({ turn: sampled(t => t < .75 ? -TAU * t * 4 : 0),
      presence: sampled(t => t < .05 || t > .7 ? 0 : Math.min(1, (t - .05) / .05, (.7 - t) / .05)) });
    const dsp = make(bank([phrase]), { layerVoices: [voice, voice, voice] });
    render(dsp, .3); const sound = render(dsp, 2);
    let jump = 0;
    for (let index = 1; index < sound.left.length; index++) jump = Math.max(jump, Math.abs(sound.left[index] - sound.left[index - 1]));
    assert.ok(jump < .15, `${voice} phrase reset sample delta ${jump}`);
    dsp.setState({ ...state, layerVoices: ['glass', 'glass', 'glass'], travelerOctaves: 4 });
    dsp.setBank(bank([contact({ registerOctaves: -2, pan: -1, color: 1 })]));
    dsp.setBank(bank([contact({ registerOctaves: 1.5, pan: 1, color: .25 })]));
    const edited = render(dsp, .5);
    assert.ok(edited.left.every(value => Number.isFinite(value) && Math.abs(value) < .91));
    assert.equal(dsp.pending, null); assert.equal(dsp.previous, null);
  }
});

test('signed turning drums change upper-partial color with identical explicit fundamental and event timing', () => {
  const takes = [];
  for (const turnSign of [undefined, -1, 1]) {
    const input = bank([contact()]);
    input.layers[0].events = [{ phase: .2, bead: 4, x: .4, y: -.4, bend: 0, fold: 0, turnSign }];
    const dsp = make(input, { layerSustain: [false, false, false], layerDrums: [true, false, false],
      layerDrumVoices: ['wood', 'wood', 'wood'], drumPitch: 200, pitchDepth: 4 });
    const sound = render(dsp, .5); close(dsp.drumVoices[0].frequency, 200);
    assert.deepEqual(dsp.drainHits(), [{ layer: 0, bead: 4, travel: .2, bankId: 7 }]);
    takes.push(sound.left); assert.ok(rms(sound.left) > .003);
  }
  for (let i = 0; i < takes.length; i++) for (let j = i + 1; j < takes.length; j++) {
    assert.ok(difference(takes[i], takes[j]) > .003);
  }
});

test('A/B comparison links to voice A by default, permits independent voices, and smooths live link changes', () => {
  const input = bank([contact({ turn: values(0) }), contact({ turn: values(0) }), contact({ turn: values(0) })]);
  const voices = ['shepard', 'reed', 'glass'];
  for (const same of [undefined, true]) {
    const dsp = make(input, { travelerMode: 'compare', motifSameVoice: same, layerVoices: voices });
    assert.deepEqual(Array.from(dsp.voiceTargets), [3, 3, 2]);
  }
  const dsp = make(input, { travelerMode: 'compare', motifSameVoice: false, layerVoices: voices });
  render(dsp, .3, false);
  assert.deepEqual(Array.from(dsp.voiceTargets), [3, 1, 2]);
  const weights = Array.from(dsp.voiceWeights), phase = dsp.phase, carriers = Array.from(dsp.carriers);
  dsp.setState({ ...state, travelerMode: 'compare', motifSameVoice: true, layerVoices: voices });
  assert.deepEqual(Array.from(dsp.voiceWeights), weights, 'link edits retain current weights until their smooth transition');
  assert.deepEqual(Array.from(dsp.carriers), carriers); assert.equal(dsp.phase, phase);
  render(dsp, .02, false);
  assert.ok(dsp.voiceWeights[7] > .5 && dsp.voiceWeights[7] < .9, 'B is fading toward A’s Shepard voice');
  assert.ok(dsp.voiceWeights[5] > .1 && dsp.voiceWeights[5] < .5);
  render(dsp, .4, false); close(dsp.voiceWeights[7], 1);
  dsp.setState({ ...state, travelerMode: 'compare', motifSameVoice: false, layerVoices: voices });
  render(dsp, .4, false); close(dsp.voiceWeights[5], 1);
  assert.deepEqual(Array.from(dsp.voiceTargets), [3, 1, 2], 'unlink restores the retained B voice');
  for (const [reader, mode] of [['traveler', 'path'], ['traveler', 'choir'], ['traveler', 'detail'], ['trace', 'compare']]) {
    dsp.setState({ ...state, contourReader: reader, travelerMode: mode, motifSameVoice: true, layerVoices: voices });
    assert.deepEqual(Array.from(dsp.voiceTargets), [3, 1, 2], `${reader}/${mode} keeps separate layer voices`);
  }
});

test('motif worklet startup uses phrase pitch and cues immediately despite an old path snapshot', async () => {
  const keys = ['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime'];
  const original = Object.fromEntries(keys.map(key => [key, globalThis[key]])); let Processor;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  globalThis.sampleRate = 48000; globalThis.currentTime = 0;
  try {
    await import('../src/instruments/vector-fractals/processor.js');
    const snapshot = { version: 1, turns: Array(9).fill(0), pitch: Array(9).fill(90),
      smoothedPitch: Array(9).fill(90), initialized: Array(9).fill(1) };
    const processor = new Processor({ processorOptions: { state: { ...state, mode: 'explorer', pitch: 160 },
      traceBank: bank([contact({ registerOctaves: .25 })]), traceTravel: 90.25, travelerState: snapshot, playing: true } });
    processor.process([], [[new Float32Array(1), new Float32Array(1)]]);
    close(processor.dsp.trace.frequencies[0], 160 * 2 ** .85, .00003);
    assert.equal(processor.dsp.trace.travelerPitch[0], 90);
  } finally {
    for (const key of keys) if (original[key] === undefined) delete globalThis[key]; else globalThis[key] = original[key];
  }
});
