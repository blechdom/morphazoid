import assert from 'node:assert/strict';
import test from 'node:test';
import { FractalDSP, DSP_ENGINES, createFractalSource, sanitizeDSPState } from '../src/instruments/fractal-signals/dsp.js';
import { FractalAudio } from '../src/instruments/fractal-signals/audio.js';
import { MODES, PARAMS, MODE_PARAMETERS, createDefaultState, generateStructure, analyzeTexture } from '../src/instruments/fractal-signals/model.js';
import { FACTORY_PRESETS, openingPreset } from '../src/instruments/fractal-signals/presets.js';

const SR = 24000;
function render(state, seconds = 3, options = {}) {
  const dsp = options.dsp ?? new FractalDSP(SR, state, options.structure ?? generateStructure(state));
  if (options.source) dsp.setSource(options.source, SR, options.profile);
  if (options.microphone !== undefined) dsp.setMicrophone(options.microphone);
  if (options.level !== undefined) dsp.setLevel(options.level);
  dsp.setPlaying(options.playing ?? true);
  const count = Math.ceil(seconds * SR), left = new Float32Array(count), right = new Float32Array(count);
  for (let i = 0; i < count; i += 128) dsp.process(left.subarray(i, Math.min(i + 128, count)), right.subarray(i, Math.min(i + 128, count)), options.input?.subarray(i, Math.min(i + 128, count)));
  return { dsp, left, right };
}
function metrics(samples) {
  let squares = 0, peak = 0, differences = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i];
    assert.ok(Number.isFinite(value), 'finite audio');
    squares += value * value;
    peak = Math.max(peak, Math.abs(value));
    if (i) differences += (value - samples[i - 1]) ** 2;
  }
  return { rms: Math.sqrt(squares / samples.length), peak, brightness: differences / Math.max(1e-12, squares) };
}
function difference(a, b) {
  let power = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) power += (a[i] - b[i]) ** 2;
  return Math.sqrt(power / Math.min(a.length, b.length));
}

test('all six default scores and every factory preset render finite, bounded stereo', () => {
  for (const { id } of MODES) {
    const result = render(createDefaultState(id));
    const l = metrics(result.left), r = metrics(result.right);
    assert.ok(l.rms > .0004 && r.rms > .0004, id + ' audible on both channels');
    assert.ok(l.peak <= .881 && r.peak <= .881, id + ' bounded peak');
    assert.ok(difference(result.left, result.right) > 1e-5, id + ' has stereo structure');
  }
  for (const preset of FACTORY_PRESETS) {
    const result = render(preset.snapshot, 4);
    const measured = metrics(result.left);
    assert.ok(measured.rms > .0003, preset.id + ' produces sound');
    assert.ok(measured.peak < .881, preset.id + ' is bounded');
    const right = metrics(result.right);
    assert.ok(right.rms > .0003, preset.id + ' right channel produces sound');
    assert.ok(right.peak < .881, preset.id + ' right channel is bounded');
  }
});

test('the six opening patches have useful output at full master while retaining peak headroom', () => {
  // These are the instrument's six authored opening scenes, not an RMS target
  // imposed on sparse, muted or deliberately extreme parameter combinations.
  for (const { id } of MODES) {
    const preset = openingPreset(id);
    const result = render(preset.snapshot, 12, { level: 1 });
    const l = metrics(result.left), r = metrics(result.right);
    assert.ok(Math.max(l.peak, r.peak) >= .25, `${id}: opening attacks reach at least -12 dBFS`);
    assert.ok(Math.sqrt((l.rms ** 2 + r.rms ** 2) / 2) >= .02, `${id}: opening phrase has usable level`);
    assert.ok(l.peak <= .881 && r.peak <= .881, `${id}: retained output headroom`);
  }
});

test('every mode releases to sustained silence and freezes the sample-clock phrase', () => {
  for (const { id } of MODES) {
    const state = createDefaultState(id), { dsp } = render(state, 1.3);
    const phase = dsp.phase;
    const stopped = render(state, 1, { dsp, playing: false });
    assert.equal(dsp.phase, phase, id + ' paused phase');
    assert.equal(metrics(stopped.left.subarray(SR * .75)).peak, 0, id + ' exact sustained silence');
    assert.equal(dsp.activeEvents, 0, id + ' retires voices');
  }
});

test('state and preset updates preserve phase and remain bounded through mode changes', () => {
  const first = FACTORY_PRESETS[0].snapshot, { dsp } = render(first, .913);
  for (const preset of FACTORY_PRESETS) {
    const phase = dsp.phase;
    dsp.setState(preset.snapshot, generateStructure(preset.snapshot));
    assert.equal(dsp.phase, phase);
    const transitioned = render(preset.snapshot, .15, { dsp });
    assert.ok(metrics(transitioned.left).peak < .881);
    assert.ok(dsp.playing);
  }
});

test('score timing is sample based and independent of output block size', () => {
  const state = createDefaultState('grammar'), structure = generateStructure(state);
  const a = new FractalDSP(SR, state, structure), b = new FractalDSP(SR, state, structure);
  a.setPlaying(true); b.setPlaying(true);
  const length = SR * 2, aL = new Float32Array(length), aR = new Float32Array(length), bL = new Float32Array(length), bR = new Float32Array(length);
  for (let i = 0; i < length; i += 128) a.process(aL.subarray(i, i + 128), aR.subarray(i, i + 128));
  for (let i = 0; i < length; i += 511) b.process(bL.subarray(i, i + 511), bR.subarray(i, i + 511));
  assert.deepEqual(aL, bL);
  assert.ok(Math.abs(a.phase - (2 * state.rate / state.phrase) % 1) < 1e-9);
  assert.equal(a.phase, b.phase);
});

test('deterministic explicit reset recovers the same seeded phrase after a stopped tail', () => {
  for (const { id } of MODES) {
    const state = createDefaultState(id), dsp = new FractalDSP(SR, state, generateStructure(state));
    dsp.setPhase(0);
    const first = render(state, 1, { dsp }).left;
    render(state, 1, { dsp, playing: false });
    dsp.setPhase(0);
    const reset = render(state, 1, { dsp }).left;
    // The reset crossfade retains the preceding output for 12ms; comparison
    // starts after that deliberate transition and normal gain settling.
    assert.ok(difference(first.subarray(SR * .3), reset.subarray(SR * .3)) < 1e-6, id);
  }
});

test('all musical controls and both gesture axes affect the resulting default score', () => {
  for (const { id } of MODES) {
    const state = createDefaultState(id), baseline = render(state, 2).left;
    for (const [key, spec] of Object.entries(PARAMS)) {
      // Direct transports are exercised while running in the motion suites.
      if (/^motion.*Tempo$/.test(key)) continue;
      const specialized = Object.values(MODE_PARAMETERS).flat();
      if (specialized.includes(key) && !MODE_PARAMETERS[id].includes(key)) continue;
      if (['inputGain', 'inputMix', 'profileMemory', 'fold'].includes(key)) continue; // Live-input and folded controls have dedicated scenes below.
      const lfo = /^lfo([12])(?:Rate|Depth)$/.exec(key);
      const scene = lfo ? { ...state, [`lfo${lfo[1]}On`]: true }
        : id === 'texture' && ['grainSize', 'spray', 'scan'].includes(key)
          ? { ...state, engine: 'hybrid' } : state;
      const reference = scene === state ? baseline : render(scene, 2).left;
      const changed = { ...scene, [key]: key === 'direction' ? -1 : key === 'branchAngle' ? 90 : spec.max };
      const result = render(changed, 2).left;
      assert.ok(difference(reference, result) > 1e-5, id + ': ' + key + ' has an audible destination');
    }
    const fm = render({ ...state, synthesis: 'fm' }, 2).left;
    assert.ok(difference(baseline, fm) > 1e-5, id + ': FM differs from PM');
  }
});

test('factory scenes occupy distinct rhythmic and spectral regions within each mode', () => {
  for (const { id } of MODES) {
    const scenes = FACTORY_PRESETS.filter((preset) => preset.snapshot.mode === id).map((preset) => metrics(render(preset.snapshot, 3).left));
    assert.ok(Math.max(...scenes.map((v) => v.rms)) / Math.min(...scenes.map((v) => v.rms)) > 1.2, id + ' articulation varies');
    assert.ok(Math.max(...scenes.map((v) => v.brightness)) / Math.min(...scenes.map((v) => v.brightness)) > 1.3, id + ' spectral shape varies');
  }
});

test('recursive score actually gates notes and the real delay extends an isolated impulse', () => {
  const state = { ...createDefaultState('grammar'), space: 0, memory: 0, attack: .003, release: .04 };
  const structure = { events: [{ phase: .125, freq: 110, amp: .8, duration: .015, pan: 0 }] };
  const result = render(state, 1, { structure });
  const onset = .125 * state.phrase / state.rate * SR;
  assert.equal(metrics(result.left.subarray(0, Math.floor(onset))).peak, 0);
  assert.ok(metrics(result.left.subarray(Math.ceil(onset), Math.ceil(onset + SR * .08))).rms > .003);
  const dry = render(state, 1.4, { structure }).left;
  const wet = render({ ...state, memory: .8, space: .8 }, 1.4, { structure }).left;
  assert.ok(metrics(wet.subarray(SR * .7)).rms > metrics(dry.subarray(SR * .7)).rms + .0001);
});

test('imported local samples drive granular playback and their measured profiles drive texture resynthesis', () => {
  const sourceA = Float32Array.from({ length: SR }, (_, i) => Math.sin(i / SR * Math.PI * 2 * 160) * .3);
  const sourceB = Float32Array.from({ length: SR }, (_, i) => Math.sin(i / SR * Math.PI * 2 * 1700) * .3);
  const profileA = analyzeTexture(sourceA, SR), profileB = analyzeTexture(sourceB, SR);
  for (const id of ['grains', 'texture']) {
    const state = createDefaultState(id);
    const a = render(state, 2, { source: sourceA, profile: profileA }).left;
    const b = render(state, 2, { source: sourceB, profile: profileB }).left;
    assert.ok(difference(a, b) > .0002, id + ' responds to actual source content');
    assert.ok(metrics(b).brightness > metrics(a).brightness * 1.1, id + ' preserves source spectral distinction');
  }
  assert.deepEqual(createFractalSource(), createFractalSource(), 'original source is reproducible');
});

test('hostile and extreme state remains finite, bounded, and voice limited at full output', () => {
  assert.doesNotThrow(() => sanitizeDSPState(null));
  for (const { id } of MODES) {
    for (const bound of ['min', 'max']) {
      const state = { mode: id, synthesis: 'fm', ...Object.fromEntries(Object.entries(PARAMS).map(([key, spec]) => [key, spec[bound]])) };
      const dsp = new FractalDSP(SR, state, generateStructure(state));
      dsp.setLevel(1);
      const result = render(state, 1.5, { dsp });
      assert.ok(metrics(result.left).peak < .881 && metrics(result.right).peak < .881, id + ':' + bound);
      assert.ok(Number.isFinite(dsp.rms), id + ': finite telemetry');
      assert.ok(dsp.activeEvents <= 32);
    }
    const dsp = new FractalDSP(SR, { mode: id, base: Infinity, depth: NaN, rate: -100, memory: 9999 }, { events: [{ phase: NaN, freq: Infinity, amp: Infinity, duration: NaN }] });
    const result = render(createDefaultState(id), .2, { dsp });
    assert.ok(metrics(result.left).peak < .881);
  }
});

class FakeNode {
  constructor() { this.connections = new Set(); this.messages = []; this.closed = false; this.port = { postMessage: (message) => this.messages.push(message), close: () => { this.closed = true; } }; }
  connect(node) { this.connections.add(node); }
  disconnect(node) { if (node) this.connections.delete(node); else this.connections.clear(); }
}
class FakeContext {
  static instances = [];
  static load = () => Promise.resolve();
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = SR; this.destination = {}; this.audioWorklet = { addModule: () => FakeContext.load() }; FakeContext.instances.push(this); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createGain() { const node = new FakeNode(); node.gain = { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }; return node; }
}
class FakeWorklet extends FakeNode {
  constructor(context, name, options) { super(); this.context = context; this.name = name; this.options = options; }
}
function globals(t) {
  t.mock.method(globalThis, 'setTimeout', globalThis.setTimeout);
  const previousContext = globalThis.AudioContext, previousWorklet = globalThis.AudioWorkletNode;
  globalThis.AudioContext = FakeContext; globalThis.AudioWorkletNode = FakeWorklet;
  FakeContext.instances = []; FakeContext.load = () => Promise.resolve();
  t.after(() => { if (previousContext) globalThis.AudioContext = previousContext; else delete globalThis.AudioContext; if (previousWorklet) globalThis.AudioWorkletNode = previousWorklet; else delete globalThis.AudioWorkletNode; });
}

test('browser wrapper keeps Play separate from Audio and releases the output lease on teardown', async (t) => {
  globals(t);
  const state = createDefaultState(), audio = new FractalAudio();
  audio.setPlaying(true); audio.setState(state, generateStructure(state));
  assert.equal(FakeContext.instances.length, 0, 'Play does not arm Audio');
  await audio.start(state, generateStructure(state));
  assert.equal(audio.node.options.processorOptions.playing, false, 'Audio alone does not Play');
  assert.equal(audio.context.state, 'running');
  const context = audio.context, node = audio.node;
  audio.setPlaying(true);
  assert.equal(node.messages.at(-1).value, true);
  await audio.destroy();
  assert.equal(context.state, 'closed');
  assert.equal(node.connections.size, 0);
  assert.ok(node.closed);
  assert.equal(audio.node, null);
});

test('cancelled or failed Audio startup cannot reactivate a later session', async (t) => {
  globals(t);
  let loaded;
  FakeContext.load = () => new Promise((resolve) => { loaded = resolve; });
  const state = createDefaultState(), audio = new FractalAudio();
  const pending = audio.start(state, generateStructure(state), { playing: true });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await audio.stop();
  await rejected;
  FakeContext.load = () => Promise.resolve();
  await audio.start(state, generateStructure(state));
  const current = audio.context;
  loaded(); await Promise.resolve();
  assert.equal(audio.context, current);
  assert.equal(audio.playing, false);
  await audio.stop();
  FakeContext.load = () => Promise.reject(new Error('load failed'));
  await assert.rejects(audio.start(state, generateStructure(state)), /load failed/);
  assert.equal(audio.context, null);
  assert.equal(FakeContext.instances.at(-1).state, 'closed');
});

const inputTone = (frequency, seconds = 3, amplitude = .3) => Float32Array.from({ length: Math.ceil(SR * seconds) }, (_, i) => amplitude * Math.sin(i / SR * Math.PI * 2 * frequency));

test('all eighteen engines make distinct finite sound from the same score', () => {
  for (const { id } of MODES) {
    const base = { ...createDefaultState(id), attack: .002, decay: .08, sustain: .15, release: .07 };
    const score = generateStructure(base);
    const sounds = DSP_ENGINES[id].map(engine => render({ ...base, engine }, 2.5, { structure: score }).left);
    for (let i = 0; i < sounds.length; i++) {
      assert.ok(metrics(sounds[i]).rms > .00015, id + ' ' + DSP_ENGINES[id][i] + ' sounds');
      for (let j = i + 1; j < sounds.length; j++) assert.ok(difference(sounds[i], sounds[j]) > .0001, id + ' engines differ');
    }
  }
});

test('microphone-only silence stays silent and actual live samples affect every mode and engine', () => {
  const low = inputTone(170), high = inputTone(1510);
  for (const { id } of MODES) {
    const base = { ...createDefaultState(id), inputMix: 1, scan: .1, attack: .002, decay: .07, sustain: .3, release: .07 };
    const score = generateStructure(base), signals = [];
    for (const engine of DSP_ENGINES[id]) {
      const state = { ...base, engine };
      const silent = render(state, .6, { microphone: true, structure: score });
      assert.equal(metrics(silent.left).peak, 0, id + '/' + engine + ' does not replace silent input with synth');
      const a = render(state, 3, { microphone: true, input: low, structure: score });
      const b = render(state, 3, { microphone: true, input: high, structure: score });
      assert.ok(metrics(a.left).rms > 1e-5 && metrics(a.right).rms > 1e-5, id + '/' + engine + ' processes mic on both channels');
      assert.ok(difference(a.left, b.left) > 1e-5, id + '/' + engine + ' depends on microphone content');
      assert.ok(a.dsp.telemetry.inputRms > .1);
      assert.equal(a.dsp.telemetry.inputBands.length, 16);
      assert.ok(Array.from(a.dsp.telemetry.inputBands).every(Number.isFinite));
      signals.push(a.left);
    }
    for (let i = 0; i < signals.length; i++) for (let j = i + 1; j < signals.length; j++) assert.ok(difference(signals[i], signals[j]) > 1e-5, id + ' mic engines differ');
  }
});

test('microphone mix/gain are audible only with explicitly enabled capture', () => {
  const input = inputTone(370, 2);
  for (const { id } of MODES) {
    const base = { ...createDefaultState(id), inputMix: 0, scan: .1 };
    const dry = render(base, 2).left;
    const inactive = render({ ...base, inputMix: 1, inputGain: 4 }, 2, { input }).left;
    assert.deepEqual(inactive, dry, id + ': inactive microphone does not affect synthesis');
    const activeDry = render(base, 2, { microphone: true, input }).left;
    assert.deepEqual(activeDry, dry, id + ': mix zero preserves generated layer');
    const wet = render({ ...base, inputMix: 1 }, 2, { microphone: true, input }).left;
    const louder = render({ ...base, inputMix: 1, inputGain: 2.5 }, 2, { microphone: true, input }).left;
    assert.ok(difference(wet, dry) > .0001, id + ': input blend');
    assert.ok(difference(wet, louder) > .00001, id + ': input gain');
  }
});

test('Paths have true separate gates and ADSR controls shape held notes and release tails', () => {
  const score = { events: [{ phase: .05, freq: 530, amp: .8, duration: .4, pan: 0 }] };
  const state = { ...createDefaultState('wander'), phrase: 4, rate: 4, space: 0, memory: 0, attack: .005, decay: .07, sustain: 0, release: .03 };
  const transient = render(state, .95, { structure: score }).left;
  const sustained = render({ ...state, sustain: .8 }, .95, { structure: score }).left;
  assert.ok(metrics(sustained.subarray(SR * .22, SR * .38)).rms > metrics(transient.subarray(SR * .22, SR * .38)).rms + .005);
  const longDecay = render({ ...state, decay: .6 }, .95, { structure: score }).left;
  assert.ok(metrics(longDecay.subarray(SR * .15, SR * .3)).rms > metrics(transient.subarray(SR * .15, SR * .3)).rms + .001);
  const release = render({ ...state, sustain: .8, release: .5 }, .95, { structure: score }).left;
  assert.ok(metrics(release.subarray(SR * .6, SR * .8)).rms > .001);
  assert.ok(metrics(sustained.subarray(SR * .7)).peak < 1e-5, 'no permanent carrier in the gap');
  const empty = render(state, 1, { structure: { events: [] } });
  assert.equal(metrics(empty.left).peak, 0, 'an empty path is silent');
});

test('folding, hybrid grain controls, and measured profile memory have their declared destinations', () => {
  const wave = { ...createDefaultState('waveform'), engine: 'folded' };
  assert.ok(difference(render({ ...wave, fold: 0 }, 2).left, render({ ...wave, fold: 5 }, 2).left) > .001);
  const texture = { ...createDefaultState('texture'), engine: 'hybrid' };
  for (const key of ['grainSize', 'spray', 'scan']) assert.ok(difference(render(texture, 2).left, render({ ...texture, [key]: PARAMS[key].max }, 2).left) > 1e-5, key);
  const pulse = inputTone(630, 2); pulse.fill(0, SR * .5);
  const short = render({ ...texture, engine: 'resonant', inputMix: 1, profileMemory: .01 }, 2, { microphone: true, input: pulse });
  const long = render({ ...texture, engine: 'resonant', inputMix: 1, profileMemory: 2 }, 2, { microphone: true, input: pulse });
  assert.ok(metrics(long.left.subarray(SR * .7)).rms > metrics(short.left.subarray(SR * .7)).rms + 1e-5, 'live band memory retains measured input energy');
});

test('actual microphone impulse arrives at the configured geometric delay tap', () => {
  const state = { ...createDefaultState('echoes'), engine: 'strikes', inputMix: 1, inputGain: 1, echoTime: .21, echoRatio: 1.5, depth: 1, memory: .5, space: 0, base: 220 };
  const input = new Float32Array(SR); input[SR * .1] = .8;
  const result = render(state, 1, { microphone: true, input, structure: { events: [] } });
  assert.equal(metrics(result.left.subarray(0, SR * .309)).peak, 0, 'no bare dry monitor');
  assert.ok(metrics(result.left.subarray(SR * .309, SR * .32)).peak > .001, 'real delayed source impulse');
});

class FakeTrack {
  constructor() { this.stops = 0; this.listeners = new Map(); }
  stop() { this.stops++; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  end() { this.listeners.get('ended')?.(); }
}
function fakeStream() { const track = new FakeTrack(); return { track, getTracks: () => [track], getAudioTracks: () => [track] }; }
function microphoneGlobals(t, getUserMedia) {
  globals(t);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
  FakeContext.prototype.createMediaStreamSource = function (stream) { const node = new FakeNode(); node.stream = stream; return node; };
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete globalThis.navigator; delete FakeContext.prototype.createMediaStreamSource; });
}

test('microphone capture is explicit, persists through presets, and releases on ended/Audio off', async (t) => {
  let captures = 0; const stream = fakeStream(), state = createDefaultState();
  microphoneGlobals(t, async (constraints) => { captures++; assert.equal(constraints.video, false); return stream; });
  const observed = [], audio = new FractalAudio({ onMicrophoneState: (value) => observed.push(value) });
  await assert.rejects(audio.startMicrophone(), /Turn Audio on/);
  audio.setPlaying(true); audio.setState(state, generateStructure(state));
  await audio.start(state, generateStructure(state));
  assert.equal(captures, 0, 'Audio and Play do not request capture');
  await audio.startMicrophone();
  assert.equal(audio.microphoneActive, true);
  const source = audio.microphoneNode;
  audio.setState(createDefaultState('echoes'), generateStructure(createDefaultState('echoes')));
  assert.equal(audio.microphoneNode, source, 'mode/preset changes retain capture');
  assert.equal(captures, 1);
  stream.track.end();
  assert.equal(audio.microphoneActive, false);
  assert.equal(source.connections.size, 0);
  assert.ok(stream.track.stops >= 1);
  assert.deepEqual(observed.slice(-2), [true, false]);
  await audio.startMicrophone();
  await audio.destroy();
  assert.equal(audio.microphoneActive, false);
  assert.ok(stream.track.stops >= 2);
});

test('cancelling pending microphone permission rejects promptly and stops a late grant', async (t) => {
  let grant;
  microphoneGlobals(t, () => new Promise((resolve) => { grant = resolve; }));
  const audio = new FractalAudio(), state = createDefaultState();
  await audio.start(state, generateStructure(state));
  const pending = audio.startMicrophone();
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  audio.stopMicrophone();
  await rejected;
  const stream = fakeStream(); grant(stream);
  await Promise.resolve(); await Promise.resolve();
  assert.ok(stream.track.stops > 0);
  assert.equal(audio.microphoneActive, false);
  await audio.destroy();
});

test('dense long-release scores stay within voice budgets and finite on both channels with live input', () => {
  const events = Array.from({ length: 384 }, (_, i) => ({ phase: i / 384, freq: 90 + i % 5, amp: .8, duration: .2, pan: i % 2 ? -.6 : .6, depth: i % 12 }));
  const input = inputTone(180, .45, .8);
  for (const { id } of MODES) for (const engine of DSP_ENGINES[id]) {
    const state = { ...createDefaultState(id), engine, base: 90, rate: 2, phrase: 1, attack: .0002, decay: 8, sustain: 1, release: 16, depth: 12, roughness: 1.8, ratio: 1.2, index: 12, inputMix: .5, inputGain: 4, partialRatio: 1.1 };
    const result = render(state, .45, { microphone: true, input, structure: { events } });
    assert.ok(metrics(result.left).peak <= .881 && metrics(result.right).peak <= .881, id + '/' + engine);
    assert.ok(Number.isFinite(result.dsp.rms));
    assert.ok(result.dsp.activeEvents <= (id === 'waveform' || (id === 'wander' && engine === 'additive') ? 8 : 32), id + '/' + engine + ': bounded voices');
  }
});

test('deferred startup stays paused until the current transport is handed over', async (t) => {
  globals(t);
  let loaded;
  FakeContext.load = () => new Promise(resolve => { loaded = resolve; });
  const state = createDefaultState(), audio = new FractalAudio();
  const start = audio.start(state, generateStructure(state), { playing: true, phase: .9, deferPlaying: true });
  // Play can change during the module fetch; construction must still wait for
  // the app's final position/leg/completion snapshot before it sounds.
  audio.setPlaying(false); audio.setPlaying(true);
  loaded(); await start;
  assert.equal(audio.node.options.processorOptions.playing, false);
  audio.setPhase(1, { travelDirection: 1, completed: true, time: 2, motionTime: 2 });
  audio.setPlaying(false);
  assert.equal(audio.node.messages.at(-2).transport.completed, true);
  assert.equal(audio.node.messages.at(-1).value, false);
  await audio.destroy();
});

test('transport revisions reject stale completion telemetry after Play or Restart', async (t) => {
  globals(t);
  const observed = [], state = createDefaultState();
  const audio = new FractalAudio({ onTelemetry: data => observed.push(data) });
  await audio.start(state, generateStructure(state));
  const report = (revision, fields = {}) => audio.node.port.onmessage({ data: {
    type: 'telemetry', transportRevision: revision, phase: .6, playing: true,
    travelDirection: -1, completed: false, time: 2.8, motionTime: 1.2, ...fields,
  } });
  const oldRevision = audio.transportRevision;
  audio.setPlaying(true);
  report(oldRevision, { phase: 1, playing: false, completed: true });
  assert.equal(observed.length, 0);
  assert.equal(audio.playing, true);
  report(audio.transportRevision);
  assert.equal(audio.phase, .6);
  assert.deepEqual(audio.transport, { travelDirection: -1, completed: false, time: 2.8, motionTime: 1.2, modPhases: [0, 0] });
  const preRestartRevision = audio.transportRevision;
  audio.setPhase(0);
  report(preRestartRevision, { phase: 1, playing: false, completed: true });
  assert.equal(observed.length, 1);
  assert.equal(audio.phase, 0);
  await audio.destroy();
});
