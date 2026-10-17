import assert from "node:assert/strict";
import test from "node:test";
import { createVoiceEffects } from "../src/instruments/throat-singing/voice-effects.js";

class Parameter {
  constructor(value = 0) { this.value = value; this.events = []; }
  setTargetAtTime(value, time, constant) { this.events.push({ value, time, constant }); }
  cancelScheduledValues() { throw new Error("Future phrase events must remain scheduled"); }
  cancelAndHoldAtTime() { throw new Error("Future phrase events must remain scheduled"); }
}
class Node {
  constructor(kind) {
    this.kind = kind;
    this.connections = new Set();
    for (const key of ["gain", "frequency", "Q", "detune", "delayTime"]) this[key] = new Parameter();
  }
  connect(target) { this.connections.add(target); }
  disconnect(target) {
    if (target) this.connections.delete(target);
    else { this.connections.clear(); this.disconnected = true; }
  }
  setPeriodicWave(wave) { this.wave = wave; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}
function fixture() {
  const audio = {
    sampleRate: 48_000, currentTime: 0.1, nodes: [], buffers: [],
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      const buffer = { length, sampleRate, duration: length / sampleRate, getChannelData: (channel) => data[channel] };
      this.buffers.push(buffer);
      return buffer;
    },
    createPeriodicWave(real, imaginary) { return { real, imaginary }; },
  };
  for (const [method, kind] of Object.entries({
    createGain: "gain", createBiquadFilter: "filter", createDelay: "delay",
    createConvolver: "convolver", createOscillator: "oscillator",
  })) audio[method] = () => {
    const node = new Node(kind);
    audio.nodes.push(node);
    return node;
  };
  const input = new Node("external mix");
  const overtoneInput = new Node("external tract");
  const output = new Node("external master");
  const effects = createVoiceEffects(audio, { input, overtoneInput, output });
  return { audio, input, overtoneInput, output, effects };
}
const last = (parameter) => parameter.events.at(-1)?.value;

test("extra pitches are bounded glottal voices; extra overtones filter the existing tract", () => {
  const { audio, input, overtoneInput, effects } = fixture();
  effects.update({ trueFoldHz: 180, harmonicNumber: 9, intensity: 0.8, extras: {
    pitchVoices: 4, pitchSpreadSemitones: 12, overtoneVoices: 4, overtoneSpread: 2,
  } }, 0.5);
  const pitched = audio.nodes.filter((node) => node.kind === "oscillator" && node.wave);
  assert.equal(pitched.length, 3, "three additions to the caller-owned main voice");
  assert.deepEqual(pitched.map((node) => last(node.frequency)), [90, 360, 180 * Math.sqrt(2)]);
  assert.ok(pitched[0].wave.imaginary.slice(2).some((coefficient) => Math.abs(coefficient) > 0.001), "voice source contains upper harmonics");
  const focused = [...overtoneInput.connections];
  assert.equal(focused.length, 3);
  assert.ok(focused.every((node) => node.type === "bandpass"));
  assert.deepEqual(focused.map((node) => last(node.frequency)), [1980, 2340, 2700]);
  assert.ok(focused.every((node) => [...node.connections].some((level) => level.connections.has(input))));
  effects.update({ trueFoldHz: 180, heardDroneHz: 90, harmonicNumber: 9, extras: {
    overtoneVoices: 4, overtoneSpread: 2,
  } }, 0.6);
  assert.deepEqual(focused.map(node => last(node.frequency)), [990, 1170, 1350], "divided fold cycles focus the heard drone's harmonics");
  effects.update({ extras: { pitchVoices: 1, overtoneVoices: 1 } }, 0.7);
  for (const node of [...pitched, ...focused]) {
    const level = node.wave ? [...[...node.connections][0].connections][0] : node;
    const gain = [...level.connections][0];
    assert.equal(last(gain.gain), 0, "one voice silences every additional voice");
  }
  effects.destroy();
});

test("future automation remains ordered and unsafe controls cannot escape DSP limits", () => {
  const { audio, effects } = fixture();
  const state = { trueFoldHz: 180, extras: { pitchVoices: 4, reverbMix: 0.3, delayMix: 0.4 } };
  effects.update(state, 0.5, 0.025);
  effects.update({ ...state, trueFoldHz: 240 }, 0.7, 0.04);
  for (const node of audio.nodes) for (const value of Object.values(node)) {
    if (!(value instanceof Parameter) || !value.events.length) continue;
    assert.deepEqual(value.events.map(({ time }) => time), [0.5, 0.7]);
    assert.ok(value.events.every(({ constant }) => constant > 0), "smooth scheduled changes");
  }
  effects.update({ trueFoldHz: Infinity, foldTenseness: NaN, focusQ: -100, harmonicNumber: 900,
    intensity: 999, voiceGain: -20, extras: {
      pitchVoices: 999, overtoneVoices: 999, pitchSpreadSemitones: 999,
      overtoneSpread: 999, sourceInstability: Infinity, delayTimeSeconds: 999,
      delayFeedback: 999, delayMix: 999, reverbMix: 999,
    } }, -100, NaN);
  for (const node of audio.nodes) for (const value of Object.values(node)) {
    if (!(value instanceof Parameter)) continue;
    assert.ok(value.events.every(({ value: target, time }) => Number.isFinite(target) && time >= 0.1));
  }
  const delay = audio.nodes.find(({ kind }) => kind === "delay");
  assert.equal(last(delay.delayTime), 1.5);
  const feedback = audio.nodes.find((node) => node.connections.has(delay) && node.kind === "gain");
  assert.equal(last(feedback.gain), 0.65);
  assert.ok(audio.nodes.filter((node) => node.wave).every((node) => last(node.frequency) >= 40 && last(node.frequency) <= 1000));
  effects.destroy();
});

test("room impulse is repeatable, stereo, energy-normalized and decays within 1.6 seconds", () => {
  const first = fixture();
  const second = fixture();
  const left = first.audio.buffers[0].getChannelData(0);
  const right = first.audio.buffers[0].getChannelData(1);
  assert.equal(first.audio.buffers[0].duration, 1.6);
  assert.deepEqual(left, second.audio.buffers[0].getChannelData(0));
  assert.notDeepEqual(left, right);
  const energy = (values) => values.reduce((sum, value) => sum + value * value, 0);
  assert.ok(Math.abs(energy(left) - 0.75 ** 2) < 1e-6);
  assert.ok(energy(left.slice(48_000)) < energy(left.slice(0, 24_000)) * 0.001);
  assert.ok(left.slice(0, Math.round(48_000 * 0.018)).every((sample) => sample === 0), "room arrives after the dry onset");
  first.effects.destroy();
  second.effects.destroy();
});

test("teardown stops sources, releases the room and preserves caller-owned connections", () => {
  const { audio, input, overtoneInput, output, effects } = fixture();
  const unrelated = new Node("unrelated");
  input.connect(unrelated);
  overtoneInput.connect(unrelated);
  output.connect(unrelated);
  effects.destroy();
  effects.destroy();
  effects.update({ extras: { pitchVoices: 4 } }, 1);
  assert.ok(audio.nodes.every((node) => node.disconnected));
  assert.ok(audio.nodes.filter(({ kind }) => kind === "oscillator").every((node) => node.started && node.stopped));
  assert.equal(audio.nodes.find(({ kind }) => kind === "convolver").buffer, null);
  for (const node of [input, overtoneInput, output]) assert.deepEqual([...node.connections], [unrelated]);
});

test("a direct voice release replaces stale lookahead without disturbing subsequent frames", () => {
  const { audio, effects } = fixture();
  for (const node of audio.nodes) for (const parameter of Object.values(node)) {
    if (!(parameter instanceof Parameter)) continue;
    parameter.cancelAndHoldAtTime = time => {
      parameter.events = parameter.events.filter(event => event.time < time);
      parameter.held = time;
    };
  }
  const voice = { trueFoldHz: 180, intensity: .8, voiceGain: 1, extras: { pitchVoices: 4 } };
  effects.update(voice, .5);
  effects.update(voice, .7);
  effects.update({ ...voice, voiceGain: 0 }, .1, .04, { replaceScheduled: true });
  const levels = audio.nodes.filter(node => node.kind === "oscillator" && node.wave)
    .map(source => [...[...[...source.connections][0].connections][0].connections][0]);
  assert.ok(levels.every(level => level.gain.held === .1 && level.gain.events.length === 1 && last(level.gain) === 0));
  effects.update({ ...voice, voiceGain: 0 }, .2);
  assert.ok(levels.every(level => level.gain.events.length === 2 && last(level.gain) === 0));
  effects.destroy();
});
