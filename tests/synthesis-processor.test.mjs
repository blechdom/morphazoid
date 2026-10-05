import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import vm from "node:vm";
import { sanitizeState, stateFromPreset, SYNTHESIS_METHODS } from "../src/instruments/synthesis/catalog.js";
import { compileSequence } from "../src/instruments/synthesis/sequence-compiler.js";
import { INSTRUMENT_PRESETS, fitRandomAttackToSequence } from "../src/instruments/synthesis/instrument-presets.js";
import { tuningRatioForDegree, tuningRatioForSemitoneCoordinate } from "../src/instruments/synthesis/tunings.js";

// The override permits an isolated reviewer to exercise an integration checkout.
// In the normal suite, source and the committed artifact come from this repo.
const root = process.env.MORPHAZOID_SYNTHESIS_TEST_ROOT
  ? resolve(process.env.MORPHAZOID_SYNTHESIS_TEST_ROOT)
  : fileURLToPath(new URL("../", import.meta.url));
const [processorSource, wasmBytes] = await Promise.all([
  readFile(resolve(root, "src/instruments/synthesis/processor.js"), "utf8"),
  readFile(resolve(root, "assets/wasm/synthesis.wasm")),
]);
const module = await WebAssembly.compile(wasmBytes);
const RATE = 48_000;

function makeHarness() {
  let Processor;
  const messages = [];
  const context = vm.createContext({
    WebAssembly, Float32Array,
    sampleRate: RATE, currentFrame: 0, currentTime: 0,
    AudioWorkletProcessor: class {
      constructor() { this.port = { postMessage: (message) => messages.push(message) }; }
    },
    registerProcessor(name, Class) {
      assert.equal(name, "roads-synthesis");
      Processor = Class;
    },
  });
  vm.runInContext(processorSource, context, { filename: "synthesis/processor.js" });
  const processor = new Processor({ processorOptions: { module } });
  const send = (message) => processor.port.onmessage({ data: message });
  const render = (frames) => {
    const result = new Float32Array(frames);
    for (let offset = 0; offset < frames; offset += 128) {
      const length = Math.min(128, frames - offset);
      const left = new Float32Array(length), right = new Float32Array(length);
      assert.equal(processor.process([], [[left, right]]), true);
      assert.ok(left.every(Number.isFinite), "actual WASM output remains finite");
      assert.deepEqual(left, right, "mono engine reaches both output channels");
      result.set(left, offset);
      context.currentFrame += length;
      context.currentTime = context.currentFrame / RATE;
    }
    assert.deepEqual(messages.filter((message) => message.type === "error"), [], "worklet reports no failure");
    return result;
  };
  return {
    processor, send, render, messages,
    renderStereo(frames, supply = () => []) {
      const result = [new Float32Array(frames), new Float32Array(frames)];
      for (let offset = 0; offset < frames; offset += 128) {
        const n = Math.min(128, frames - offset);
        const channels = [new Float32Array(n), new Float32Array(n)];
        processor.process([supply(context.currentFrame, n)], [channels]);
        channels.forEach((channel, c) => result[c].set(channel, offset));
        context.currentFrame += n; context.currentTime = context.currentFrame / RATE;
      }
      assert.deepEqual(messages.filter(m => m.type === "error"), []);
      return result;
    },
    get time() { return context.currentTime; },
    get frame() { return context.currentFrame; },
    dispose() { send({ type: "dispose" }); },
  };
}

function state(overrides = {}) {
  const patch = {
    engineId: 2, frequencyHz: 220, params: [1, 0, 0, 0, 0, 0, 0, 0], playStyle: "hold",
    envelope: { attack: 0.002, decay: 0.01, sustain: 0.8, release: 0.02 },
    ...overrides,
  };
  return { ...patch, params: sanitizeState({ ...patch, version: 1, presetId: "custom" }).params };
}
const rms = (samples) => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);

test('Small vowel orchestra gains body without the rejected upper-band emphasis or a master boost', () => {
  const snapshot = INSTRUMENT_PRESETS.find(preset => preset.id === 'performance:small-vowel-orchestra').snapshot;
  assert.equal(snapshot.sound.methodId, 'fof');
  assert.equal(snapshot.voiceMode, 'poly');
  assert.equal(snapshot.sequence.id, 'multiplexed-phrase-arp');
  assert.equal(snapshot.sequence.tempoBpm, 102);
  assert.equal(snapshot.tuningId, 'edo-12-major');
  assert.equal(snapshot.routing.effectEnabled, false);
  assert.ok(!Object.hasOwn(snapshot.sound, 'outputLevel'));
  assert.equal(snapshot.sound.levelTrimDb, stateFromPreset('fof', 'open-low-vowel').levelTrimDb);
  const cycle = structuredClone(compileSequence(snapshot.sequence.id, { tempo: snapshot.sequence.tempoBpm, parameters: snapshot.sequence.parameters }));
  cycle.steps = cycle.steps.map(step => ({ ...step, notes: step.notes.map(note => ({ ...note,
    ratio: Number.isSafeInteger(note.degree) ? tuningRatioForDegree(note.degree, snapshot.tuningId)
      : tuningRatioForSemitoneCoordinate(note.semitone, snapshot.tuningId, snapshot.sequence.parameters.pitchMode),
  })) }));
  // The former scene is a rejected comparison, not a listening-approved baseline.
  const previous = fitRandomAttackToSequence(stateFromPreset('fof', 'bright-upper-vowel'), snapshot.sequence);
  const characterize = sound => {
    const h = makeHarness();
    try {
      h.send({ type: 'state', state: { ...sound, engineId: 20, kind: 'synthesis', playStyle: 'hold', voiceMode: snapshot.voiceMode } });
      h.send({ type: 'sequence-load', sequence: cycle, tempo: cycle.tempo, rootFrequency: sound.frequencyHz });
      h.send({ type: 'sequence-start', phase: 0, tempo: cycle.tempo, rootFrequency: sound.frequencyHz });
      const samples = h.render(Math.ceil(2 * cycle.lengthBeats * 60 / cycle.tempo * RATE));
      let energy = 0, differences = 0, peak = 0;
      for (let i = 0; i < samples.length; i++) {
        energy += samples[i] ** 2;
        if (i) differences += (samples[i] - samples[i - 1]) ** 2;
        peak = Math.max(peak, Math.abs(samples[i]));
      }
      h.send({ type: 'sequence-stop' });
      assert.equal(rms(h.render(RATE * 5).subarray(-4096)), 0, 'Stop settles completely');
      // A level-invariant high-frequency-weighted metric, separate from raw RMS.
      return { rms: rms(samples), peak, normalizedDifferenceEnergy: differences / energy };
    } finally { h.dispose(); }
  };
  const before = characterize(previous), after = characterize(snapshot.sound);
  assert.ok(after.rms > before.rms * 1.1, 'the same phrase gains measurable body without changing master');
  assert.ok(after.normalizedDifferenceEnergy < before.normalizedDifferenceEnergy * .1,
    'the level-normalized spectrum is no longer dominated by the upper-band patch');
  assert.ok(after.peak < .8, 'the phrase stays below the emergency protection knee');
});

for (const voiceMode of ['mono', 'poly']) test(`${voiceMode} worklet renders independent D/S points, live edits and a nonzero release endpoint safely`, () => {
  const low = makeHarness(), high = makeHarness();
  const envelope = level => ({ attack: .02, decay: .1, sustain: .6, release: .1,
    points: [{ time: 0, level: 0 }, { time: .02, level: 1 }, { time: .12, level },
      { time: .3, level: .6 }, { time: .4, level: .8 }] });
  try {
    for (const [h, level] of [[low, .1], [high, .9]]) {
      h.send({ type: 'state', state: state({ voiceMode, envelope: envelope(level) }) });
      h.send({ type: 'note', noteId: 91, frequency: 220, velocity: .8, duration: null });
    }
    const lowBody = low.render(19200), highBody = high.render(19200);
    assert.ok(rms(highBody.subarray(4800, 5760)) > rms(lowBody.subarray(4800, 5760)) * 2, 'D has an audible independent height');
    assert.ok(Math.abs(rms(highBody.subarray(16800)) - rms(lowBody.subarray(16800))) < .00001, 'the same S level is retained');
    for (const h of [low, high]) {
      h.send({ type: 'state', state: state({ voiceMode, envelope: envelope(.4) }) });
      assert.ok(rms(h.render(2400)) > .001, 'live shape edits preserve the held note');
      h.send({ type: 'off', noteId: 91 });
      const tail = h.render(24000);
      assert.ok(rms(tail.subarray(2400, 4000)) > .001, 'R may rise after note-off');
      // The existing 8 Hz DC blocker settles after the envelope's 5 ms safety fade.
      assert.ok(rms(tail.subarray(9000, 10000)) < rms(tail.subarray(6000, 7000)) * .1, 'the DC tail decays rather than holding');
      assert.ok(rms(tail.subarray(-4096)) < 1e-6, 'nonzero R cannot leave a hanging note');
      h.send({ type: 'state', state: state({ voiceMode, envelope: { attack: .002, decay: .01, sustain: .8, release: .02 } }) });
      h.send({ type: 'note', noteId: 92, frequency: 220, velocity: .8, duration: null });
      assert.ok(rms(h.render(4800)) > .001, 'legacy ADSR recall clears point mode and sounds immediately');
      h.send({ type: 'off', noteId: 92 });
      h.render(4800);
      assert.ok(rms(h.render(4800)) < 1e-6);
    }
  } finally { low.dispose(); high.dispose(); }
});

function fundamental(samples) {
  const crossings = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) {
      crossings.push(i - 1 + -samples[i - 1] / (samples[i] - samples[i - 1]));
    }
  }
  assert.ok(crossings.length >= 5, "enough sounding periods to measure the pitch");
  return RATE * (crossings.length - 1) / (crossings.at(-1) - crossings[0]);
}
function assertPitch(samples, expected, label) {
  assert.ok(rms(samples) > 0.005, `${label} remains audible`);
  const measured = fundamental(samples);
  assert.ok(Math.abs(measured - expected) < 3, `${label}: ${measured.toFixed(2)} Hz, expected ${expected} Hz`);
}

test("scheduled notes begin inside an audio block, without sounding early", () => {
  const h = makeHarness();
  try {
    h.send({ type: "state", state: state() });
    h.send({ type: "note", frequency: 440, velocity: 0.8, duration: null, at: 47 / RATE });
    const output = h.render(128);
    assert.ok(output.subarray(0, 47).every((value) => value === 0), "silence up to the scheduled sample");
    assert.ok(rms(output.subarray(47)) > 0.001, "onset is rendered in the rest of the same block");
  } finally { h.dispose(); }
});

test("editing timbre and presets preserves the pitch of a held keyboard or MIDI note", () => {
  const h = makeHarness();
  try {
    h.send({ type: "state", state: state() });
    h.send({ type: "note", frequency: 440, velocity: 0.8, duration: null, at: h.time });
    h.render(4096);
    assertPitch(h.render(4096), 440, "initial held note");
    // The preset/base frequency stays at 220 Hz, while the performer holds 440 Hz.
    h.send({ type: "state", state: state({ params: [1, 0.15, 0, 0, 0, 0, 0, 0] }) });
    h.render(4096);
    assertPitch(h.render(4096), 440, "held note after a harmonic-slider edit");
    h.send({ type: "state", state: state({ frequencyHz: 173 }) });
    h.render(4096);
    assertPitch(h.render(4096), 440, "held note after preset/base-frequency change");
  } finally { h.dispose(); }
});

for (const underlying of ["held key", "Play drone"]) {
  test(`a finite trigger returns to the ${underlying} when it expires`, () => {
    const h = makeHarness();
    try {
      h.send({ type: "state", state: state() });
      const expected = underlying === "held key" ? 440 : 220;
      if (underlying === "held key") {
        h.send({ type: "note", frequency: expected, velocity: 0.8, duration: null, at: h.time });
      } else h.send({ type: "play", playing: true, rate: 1 });
      h.render(4096);
      h.send({ type: "note", frequency: 660, velocity: 0.8, duration: 0.08, at: h.time + 31 / RATE });
      const pulse = h.render(3072);
      assertPitch(pulse.subarray(2048), 660, "temporary triggered note");
      h.render(4096);
      assertPitch(h.render(4096), expected, `${underlying} after trigger expiry`);
      if (underlying === "held key") h.send({ type: "off", at: h.time });
      else h.send({ type: "play", playing: false, rate: 1 });
      h.render(24_000);
      assert.ok(rms(h.render(4096)) < 1e-7, "release or Stop still reaches silence");
    } finally { h.dispose(); }
  });
}

test("uploaded sources restore reproducibly through the actual worklet messages and WASM ABI", () => {
  const h = makeHarness();
  const source = Float32Array.from({ length: 16_384 }, (_, i) => Math.sin(i * Math.PI * 2 * 731 / RATE) * 0.6);
  const snapshot = () => {
    h.send({ type: "reset" });
    h.send({ type: "note", frequency: 220, velocity: 0.8, duration: null, at: h.time });
    return h.render(8192);
  };
  try {
    for (const engineId of [0, 6, 8, 28, 30]) {
      h.send({ type: "state", state: state({ engineId, params: Array(8).fill(0.5) }) });
      const original = snapshot();
      h.send({ type: "source", samples: source, sampleRate: RATE });
      const uploaded = snapshot();
      assert.ok(rms(uploaded) > 1e-5, `uploaded source sounds in method ${engineId}`);
      assert.ok(original.some((value, i) => value !== uploaded[i]), `upload changes method ${engineId}`);
      h.send({ type: "restore-source" });
      const restored = snapshot();
      assert.ok(original.every((value, i) => value === restored[i]), `restore recovers exact original samples for method ${engineId}`);
    }
  } finally { h.dispose(); }
});

test("speeding up Repeat preserves elapsed phase and produces the next strike promptly", () => {
  const h = makeHarness();
  try {
    h.send({ type: "state", state: state({
      playStyle: "strike", envelope: { attack: 0.002, decay: 0.015, sustain: 0, release: 0.02 },
    }) });
    h.send({ type: "play", playing: true, rate: 0.5 });
    const first = h.render(12_000); // 0.25 s into a 2 s interval: 7/8 of its phase remains.
    assert.ok(rms(first.subarray(0, 1024)) > 0.005, "the initial repeat strike sounds");
    h.send({ type: "play", playing: true, rate: 4 });
    const changed = h.render(24_000);
    // New interval is 0.25 s; its remaining 7/8 is 10,500 samples.
    assert.ok(rms(changed.subarray(0, 10_400)) < 1e-5, "changing rate preserves the partial interval");
    assert.ok(rms(changed.subarray(10_500, 11_200)) > 0.005, "next strike arrives at the rescaled deadline");
    assert.ok(rms(changed.subarray(22_500, 23_200)) > 0.005, "subsequent strike uses the new full interval");
  } finally { h.dispose(); }
});

for (const underlying of ["held key", "Play drone"]) {
  test(`Trigger emits one envelope attack and does not attack the ${underlying} again on expiry`, () => {
    const h = makeHarness();
    try {
      h.send({ type: "state", state: state({
        envelope: { attack: 0.005, decay: 0.02, sustain: 0.18, release: 0.03 },
      }) });
      if (underlying === "held key") {
        h.send({ type: "note", frequency: 220, velocity: 0.8, duration: null, at: h.time });
      } else h.send({ type: "play", playing: true, rate: 1 });
      h.render(12_000);
      h.send({ type: "note", frequency: 220, velocity: 0.8, duration: 0.12, at: h.time });
      const output = h.render(12_000);
      const firstAttack = rms(output.subarray(256, 768));
      const sustain = rms(output.subarray(4096, 5632));
      const afterExpiry = rms(output.subarray(5888, 6656));
      assert.ok(firstAttack > sustain * 2, "the trigger produces its requested attack");
      assert.ok(afterExpiry < sustain * 1.2, `expiry must not add a second attack: ${afterExpiry} versus sustain ${sustain}`);
      assertPitch(output.subarray(8192), 220, "underlying note continues after the single attack");
    } finally { h.dispose(); }
  });
}

test("Trigger expiry does not strike a held modal resonator a second time", () => {
  const h = makeHarness();
  try {
    h.send({ type: "state", state: state({
      engineId: 17, params: [0.3, 0.04, 0.45, 0.6, 0, 0, 0, 0],
      envelope: { attack: 0.001, decay: 0.01, sustain: 1, release: 0.02 },
    }) });
    h.send({ type: "note", frequency: 220, velocity: 0.8, duration: null, at: h.time });
    h.render(48_000);
    h.send({ type: "note", frequency: 220, velocity: 0.8, duration: 0.2, at: h.time });
    const output = h.render(16_384);
    const initialStrike = rms(output.subarray(0, 2048));
    const beforeExpiry = rms(output.subarray(7680, 9216));
    const afterExpiry = rms(output.subarray(9728, 11264));
    assert.ok(initialStrike > beforeExpiry * 5, "one modal strike starts and decays");
    assert.ok(afterExpiry < beforeExpiry * 1.2, "expiry continues the ringing decay without another excitation");
  } finally { h.dispose(); }
});

test("atomic preset audition changes a held method into a struck method with one excitation", () => {
  const h = makeHarness(), reference = makeHarness();
  const target = state({
    engineId: 17, playStyle: "strike", params: [0.3, 0.8, 0.5, 0.6, 0, 0, 0, 0],
    envelope: { attack: 0.001, decay: 0.01, sustain: 0.7, release: 0.02 },
  });
  try {
    h.send({ type: "state", state: state({ params: Array(8).fill(0.5) }) });
    h.send({ type: "play", playing: true, rate: 4 });
    h.render(48_000);
    h.send({ type: "state", state: target, audition: true, duration: 0.12, velocity: 0.8 });
    const actual = h.render(20_000);
    reference.send({ type: "state", state: target });
    reference.send({ type: "note", frequency: 220, velocity: 0.8, duration: 0.12, at: reference.time });
    const single = reference.render(4096);
    const ratio = rms(actual.subarray(1024, 4096)) / rms(single.subarray(1024));
    assert.ok(ratio > 0.94 && ratio < 1.06, `audition matches a single modal excitation; amplitude ratio ${ratio}`);
    assert.ok(rms(actual.subarray(10_000, 17_500)) < 1e-5, "old hold/repeat scheduling does not add an immediate second attack");
    assert.ok(rms(actual.subarray(17_760, 19_000)) > 0.005, "Repeat resumes one full interval after the audition ends");
  } finally { h.dispose(); reference.dispose(); }
});

test("atomic audition changing Repeat into Play holds after its sole attack", () => {
  const h = makeHarness();
  try {
    h.send({ type: "state", state: state({ playStyle: "strike" }) });
    h.send({ type: "play", playing: true, rate: 4 });
    h.render(48_000);
    const target = state({ envelope: { attack: 0.005, decay: 0.02, sustain: 0.18, release: 0.03 } });
    h.send({ type: "state", state: target, audition: true, duration: 0.12, velocity: 0.8 });
    const output = h.render(24_000);
    const sustain = rms(output.subarray(4096, 5632));
    assert.ok(rms(output.subarray(256, 768)) > sustain * 2, "preset is auditioned once");
    assert.ok(rms(output.subarray(5888, 6656)) < sustain * 1.2, "expiry does not restart Play's envelope");
    assert.ok(rms(output.subarray(12_000, 13_024)) < sustain * 1.2, "the old Repeat deadline has been removed");
    assertPitch(output.subarray(19_000), 220, "Play continues at the new preset pitch");
  } finally { h.dispose(); }
});

test("a manual finite Trigger displaces an imminent repeat instead of producing a double strike", () => {
  const h = makeHarness();
  try {
    h.send({ type: "state", state: state({
      playStyle: "strike", envelope: { attack: 0.002, decay: 0.015, sustain: 0, release: 0.02 },
    }) });
    h.send({ type: "play", playing: true, rate: 4 });
    h.render(11_520); // The old repeat is only 480 samples away.
    h.send({ type: "note", frequency: 220, velocity: 0.8, duration: 0.08, at: h.time });
    const output = h.render(20_000);
    assert.ok(rms(output.subarray(0, 1024)) > 0.005, "manual trigger sounds immediately");
    // A very quiet 8 Hz DC-filter tail can remain after the short pitched attack.
    assert.ok(rms(output.subarray(3000, 15_700)) < 1e-4, "neither the old deadline nor pulse expiry adds another audible strike");
    assert.ok(rms(output.subarray(15_840, 16_540)) > 0.005, "repeat resumes after the complete pulse and one fresh interval");
  } finally { h.dispose(); }
});

test("a new atomic audition replaces a superseded queued finite note", () => {
  const h = makeHarness();
  try {
    h.send({ type: "state", state: state() });
    h.send({ type: "note", frequency: 660, velocity: 0.8, duration: 0.1, at: 0.3 });
    h.send({ type: "state", state: state(), audition: true, duration: 0.06, velocity: 0.8 });
    const output = h.render(24_000);
    assert.ok(rms(output.subarray(0, 1024)) > 0.005, "new preset audition sounds");
    assert.ok(rms(output.subarray(12_000)) < 1e-5, "superseded finite note cannot attack later");
  } finally { h.dispose(); }
});


test("queued key release does not cut an atomic audition or restore a released key", () => {
  const h = makeHarness();
  try {
    h.send({ type: "state", state: state() });
    h.send({ type: "note", frequency: 440, velocity: 0.8, duration: null, at: h.time });
    h.render(4096);
    h.send({ type: "off", at: h.time + 0.005 });
    h.send({ type: "state", state: state({ frequencyHz: 660 }), audition: true, duration: 0.12 });
    const preview = h.render(12_000);
    assertPitch(preview.subarray(3072, 5120), 660, "preview continues past the queued release");
    assert.ok(rms(preview.subarray(10_000)) < 1e-5, "released key is not resurrected when preview finishes");
  } finally { h.dispose(); }
});


test("tempo pulses use the audio clock and note length opens a real gap even with a sustained envelope", () => {
  const h = makeHarness();
  try {
    h.send({ type: "state", state: state({ playStyle: "strike", envelope: { attack: .002, decay: .01, sustain: .8, release: .003 } }) });
    h.send({ type: "play", playing: true, rate: 4, gate: .25 });
    const output = h.render(36_000);
    for (const onset of [0, 12_000, 24_000]) {
      assert.ok(rms(output.subarray(onset + 500, onset + 2500)) > .005, "each quarter-second note sounds");
      assert.ok(rms(output.subarray(onset + 9000, onset + 11_000)) < 1e-5, `gate releases before next beat: ${rms(output.subarray(onset + 9000, onset + 11_000))}`);
    }
    h.send({ type: "play", playing: false, rate: 4, gate: .25 });
    assert.ok(rms(h.render(24_000).subarray(12_000)) < 1e-5, "Stop cancels future pulses");
  } finally { h.dispose(); }
});

test("an Auto change from a silent zero-sustain hold to repeat restores periodic sound during edits", () => {
  const h = makeHarness();
  try {
    const patch = state({ envelope: { attack: .002, decay: .015, sustain: 0, release: .003 } });
    h.send({ type: "state", state: patch });
    h.send({ type: "play", playing: true, rate: 4, gate: .65 });
    assert.ok(rms(h.render(24_000).subarray(12_000)) < 1e-5);
    h.send({ type: "state", state: { ...patch, playStyle: "strike" } });
    const output = h.render(24_000);
    assert.ok(rms(output.subarray(0, 1024)) > .005);
    assert.ok(rms(output.subarray(12_000, 13_024)) > .005);
  } finally { h.dispose(); }
});


for (const [initialRate, changedRate] of [[1, 4], [4, 1]]) {
  test(`tempo change ${initialRate} to ${changedRate} Hz rescales the open gate with the beat`, () => {
    const h = makeHarness();
    try {
      h.send({ type: "state", state: state({ playStyle: "strike",
        envelope: { attack: .002, decay: .01, sustain: .8, release: .003 } }) });
      h.send({ type: "play", playing: true, rate: initialRate, gate: .5 });
      h.render(Math.round(RATE / initialRate * .25));
      h.send({ type: "play", playing: true, rate: changedRate, gate: .5 });
      const output = h.render(Math.round(RATE / changedRate));
      assert.ok(rms(output.subarray(0, Math.round(RATE / changedRate * .2))) > .005,
        "the remaining open gate keeps sounding without another attack");
      // A monotonic 8 Hz DC-blocker tail remains after the pitched note releases.
      const gap = rms(output.subarray(Math.round(RATE / changedRate * .5), Math.round(RATE / changedRate * .65)));
      assert.ok(gap < 1e-4, `the current gate leaves the intended beat gap: ${gap}`);
      const next = Math.round(RATE / changedRate * .75);
      assert.ok(rms(output.subarray(next + 128, next + 1024)) > .005,
        "next attack retains the remaining three quarters of the beat");
    } finally { h.dispose(); }
  });
}

test("note-length edits update the open gate without reopening a released note", () => {
  for (const gate of [.2, .8]) {
    const h = makeHarness();
    try {
      h.send({ type: "state", state: state({ playStyle: "strike",
        envelope: { attack: .002, decay: .01, sustain: .8, release: .003 } }) });
      h.send({ type: "play", playing: true, rate: 1, gate: .4 });
      h.render(12_000);
      h.send({ type: "play", playing: true, rate: 1, gate });
      const output = h.render(24_000);
      const middle = rms(output.subarray(12_000, 21_000));
      assert.ok(gate === .8 ? middle > .005 : middle < 1e-5,
        "longer gates sustain this note, shorter gates close this note immediately");
      h.render(9600); // .95 s: either gate has closed, the next beat is still ahead.
      h.send({ type: "play", playing: true, rate: 1, gate: .95 });
      assert.ok(rms(h.render(2000)) < 1e-5, "gate extension cannot create an extra attack");
    } finally { h.dispose(); }
  }
});

test("Stop clears the old repeat gate and does not restart the release on later tempo edits", () => {
  const h = makeHarness();
  try {
    h.send({ type: "state", state: state({ playStyle: "strike",
      envelope: { attack: .002, decay: .01, sustain: .8, release: .2 } }) });
    h.send({ type: "play", playing: true, rate: 2, gate: .65 });
    h.render(12_000);
    h.send({ type: "play", playing: false, rate: 2, gate: .65 });
    assert.ok(rms(h.render(2400)) > .005, "Stop allows the configured release tail");
    h.send({ type: "play", playing: false, rate: 3, gate: .8 });
    const tail = h.render(12_000);
    assert.ok(rms(tail.subarray(8160, 9600)) < 1e-5,
      "the original 200 ms release finishes without a stale gate note-off extending it");
  } finally { h.dispose(); }
});

test("preset audition sends static trim through the actual worklet and calibrates the first strike", () => {
  const quiet = makeHarness(), louder = makeHarness();
  const differenceDb = 12;
  const expectedRatio = 10 ** (differenceDb / 20);
  const initial = state({ levelTrimDb: -30 });
  const target = state({
    engineId: 17, playStyle: "strike", params: [0.3, 0.8, 0.5, 0.6, 0, 0, 0, 0],
    envelope: { attack: 0.001, decay: 0.01, sustain: 0.7, release: 0.02 },
  });
  try {
    for (const h of [quiet, louder]) {
      h.send({ type: "state", state: initial });
      // A running but zero-velocity note keeps the engine live without an old
      // audible tail obscuring the exact level ratio of the new strike.
      h.send({ type: "note", frequency: 220, velocity: 0, duration: null, at: h.time });
      assert.ok(h.render(2048).every(value => value === 0));
    }
    quiet.send({ type: "state", state: { ...target, levelTrimDb: -12 }, audition: true, duration: .12, velocity: .8 });
    louder.send({ type: "state", state: { ...target, levelTrimDb: 0 }, audition: true, duration: .12, velocity: .8 });
    const low = quiet.render(8192), high = louder.render(8192);
    assert.ok(rms(high.subarray(0, 384)) > .0001, "the first 8 ms contain an audible strike");
    assert.ok(high.every(value => Math.abs(value) < .8), "comparison stays below peak protection");
    assert.ok(low.every((value, i) => Math.abs(high[i] - value * expectedRatio) < 2e-6), "+12 dB is a fixed 3.981x amplitude change from the first strike through release");
  } finally { quiet.dispose(); louder.dispose(); }
});

test("a live trim state edit smooths level without adding a new attack through the actual WASM bridge", () => {
  const stable = makeHarness(), edited = makeHarness();
  const patch = state({ levelTrimDb: -12, envelope: { attack: .002, decay: .01, sustain: .25, release: .02 } });
  try {
    for (const h of [stable, edited]) {
      h.send({ type: "state", state: patch });
      h.send({ type: "note", frequency: 220, velocity: .8, duration: null, at: h.time });
      h.render(4096);
    }
    edited.send({ type: "state", state: { ...patch, levelTrimDb: 0 } });
    const original = stable.render(4096), changed = edited.render(4096);
    const ratio = 10 ** (12 / 20);
    assert.ok(Math.abs(changed[0] - original[0]) < .001, "live gain starts smoothly instead of jumping to the target");
    assert.ok(changed.subarray(3072).every((value, i) => Math.abs(value - original[i + 3072] * ratio) < 2e-5), "settled output is the fixed gain change, with the original sustain envelope");
  } finally { stable.dispose(); edited.dispose(); }
});

test("live method and audition changes cannot apply the new trim to the previous method tail", () => {
  for (const audition of [false, true]) {
    const neutral = makeHarness(), boosted = makeHarness();
    try {
      for (const h of [neutral, boosted]) {
        h.send({ type: "source", samples: new Float32Array(256), sampleRate: RATE });
        h.send({ type: "state", state: state({ levelTrimDb: 0 }) });
        h.send({ type: "note", frequency: 220, velocity: .8, duration: null, at: h.time });
        h.render(3982);
      }
      // Loaded silence isolates the old signal's crossfade and DC tail; gain
      // changes belong only to the new method. This also exercises CLAP-like
      // no-note method switching through the actual browser state bridge.
      const target = state({ engineId: 0, params: Array(8).fill(.5) });
      neutral.send({ type: "state", state: { ...target, levelTrimDb: 0 }, audition, duration: .12, velocity: .8 });
      boosted.send({ type: "state", state: { ...target, levelTrimDb: 48 }, audition, duration: .12, velocity: .8 });
      const reference = neutral.render(4096), actual = boosted.render(4096);
      assert.ok(rms(reference.subarray(0, 384)) > .001, "the previous method has a measurable tail");
      assert.ok(reference.every((value, i) => Math.abs(value - actual[i]) < 2e-6), `a +48 dB target leaves the prior method tail unchanged (audition=${audition})`);
    } finally { neutral.dispose(); boosted.dispose(); }
  }
});

test("same-method preset audition replaces old ringing state with one authored target note", () => {
  const changed = makeHarness(), fresh = makeHarness();
  const previous = state({
    engineId: 17, playStyle: "strike", params: [.8, .9, .12, .75, 0, 0, 0, 0],
    levelTrimDb: 0, envelope: { attack: .001, decay: .01, sustain: 1, release: .2 },
  });
  const target = state({
    engineId: 17, playStyle: "strike", frequencyHz: 317,
    params: [.2, .8, .37, .65, 0, 0, 0, 0], levelTrimDb: 0,
    envelope: { attack: .004, decay: .04, sustain: .7, release: .2 },
  });
  try {
    changed.send({ type: "state", state: previous });
    changed.send({ type: "note", frequency: 173, velocity: .8, duration: null, at: changed.time });
    assert.ok(rms(changed.render(8304)) > .001, "the previous preset is ringing");
    for (const h of [changed, fresh]) {
      h.send({ type: "state", state: target, audition: true, duration: .6, velocity: .8 });
    }
    const actual = changed.render(24_000), reference = fresh.render(24_000);
    assert.ok(rms(reference.subarray(12_000)) > .001, "comparison measures the active target note");
    assert.ok(reference.subarray(12_000).every((value, i) => Math.abs(value - actual[i + 12_000]) < 2e-6), "after the short crossfade/DC tail, the new preset matches a single fresh excitation");
    assert.ok(actual.every(value => Math.abs(value) < .8), "ordinary preset audition avoids the emergency knee");
  } finally { changed.dispose(); fresh.dispose(); }
});


function effectState(overrides = {}) {
  return { kind: 'processor', processorId: 0, playStyle: 'process', frequencyHz: 220,
    source: 0, params: [0, .6, .25, .5, ...Array(12).fill(0)], wet: 1, bypass: false,
    inputDb: 0, outputDb: 0, ...overrides };
}

test('processor state selection stays silent until audition or Play and needs no ADSR', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: effectState({ source: 3 }) });
    assert.equal(rms(h.renderStereo(4096)[0]), 0);
    h.send({ type: 'play', playing: true });
    assert.ok(rms(h.renderStereo(4096)[0]) > .01);
    h.send({ type: 'play', playing: false });
    h.renderStereo(RATE);
    assert.ok(rms(h.renderStereo(4096)[0]) < .00001);
  } finally { h.dispose(); }
});

test('worklet carries actual stereo input through faithful bypass and clears absent PCM', () => {
  const h = makeHarness();
  const input = (_frame, n) => [new Float32Array(n).fill(.2), new Float32Array(n).fill(-.3)];
  try {
    h.send({ type: 'state', state: effectState({ bypass: true, inputDb: 18, outputDb: -24 }) });
    h.send({ type: 'play', playing: true });
    h.renderStereo(RATE / 4, input);
    const channels = h.renderStereo(128, input);
    assert.ok(channels[0].every(v => Math.abs(v - .2) < .00001));
    assert.ok(channels[1].every(v => Math.abs(v + .3) < .00001));
    assert.ok(h.renderStereo(128).every(channel => channel.every(v => v === 0)), 'disconnected source cannot replay stale samples');
  } finally { h.dispose(); }
});

test('processor preset auditions close their source after three seconds and permit ongoing edits', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: effectState({ source: 1, bypass: true }), audition: true });
    assert.ok(rms(h.renderStereo(4096)[0]) > .05);
    h.send({ type: 'state', state: effectState({ source: 1, bypass: true, frequencyHz: 330 }) });
    assert.ok(rms(h.renderStereo(4096)[0]) > .05, 'editing keeps finite audition alive');
    h.renderStereo(RATE * 3);
    assert.ok(rms(h.renderStereo(4096)[0]) < .00001, 'finite audition ends');
  } finally { h.dispose(); }
});

test('microphone capture is bounded, mono and transferable without processing playback', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'capture', id: 7 });
    h.renderStereo(RATE * 2, (_frame, n) => [new Float32Array(n).fill(.2), new Float32Array(n).fill(.4)]);
    const captured = h.messages.find(m => m.type === 'captured');
    assert.equal(captured.id, 7); assert.equal(captured.samples.length, RATE * 2);
    assert.ok(captured.samples.every(v => Math.abs(v - .3) < 1e-6));
    assert.equal(h.processor.capture, null);
    h.send({ type: 'capture', id: 8 }); h.send({ type: 'cancel-capture' });
    h.renderStereo(RATE * 2);
    assert.equal(h.messages.filter(m => m.type === 'captured').length, 1);
    h.processor.state = { ...h.processor.state, inputDb: -12 };
    h.send({ type: 'capture', id: 9 });
    h.renderStereo(RATE * 2, (_frame, n) => [new Float32Array(n).fill(.3)]);
    const adjusted = h.messages.find(m => m.type === 'captured' && m.id === 9);
    assert.ok(adjusted.samples.every(v => Math.abs(v - .3 * 10 ** (-12 / 20)) < 1e-6), 'the input knob changes captured PCM');
  } finally { h.dispose(); }
});

function spectralAmplitude(samples, hz) {
  let re = 0, im = 0;
  for (let i = 0; i < samples.length; i++) {
    const angle = 2 * Math.PI * hz * i / RATE;
    re += samples[i] * Math.cos(angle); im += samples[i] * Math.sin(angle);
  }
  return 2 * Math.hypot(re, im) / samples.length;
}
const polyCount = h => h.processor.api.poly_voice_count(h.processor.bank);
const heldPolyIds = h => Array.from({ length: 8 }, (_, slot) =>
  h.processor.api.poly_voice_is_held(h.processor.bank, slot)
    ? h.processor.api.poly_voice_note_id(h.processor.bank, slot) >>> 0 : null).filter(id => id !== null);

test('Poly renders independent pitches and releases just the addressed note with its own tail', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ voiceMode: 'poly', envelope: { attack: .002, decay: .01, sustain: .8, release: .2 } }) });
    for (const [noteId, frequency] of [[1, 220], [2, 330], [3, 550]]) h.send({ type: 'note', noteId, frequency, velocity: .8, duration: null });
    h.render(4800);
    const chord = h.render(4800);
    for (const hz of [220, 330, 550]) assert.ok(spectralAmplitude(chord, hz) > .02, `${hz} Hz sounds in the chord`);
    h.send({ type: 'off', noteId: 2 });
    const tail = h.render(4800);
    assert.ok(spectralAmplitude(tail, 330) > .005, 'released note has its own tail');
    h.render(12_000);
    const remaining = h.render(4800);
    assert.ok(spectralAmplitude(remaining, 330) < .0001, 'released pitch finishes');
    for (const hz of [220, 550]) assert.ok(spectralAmplitude(remaining, hz) > .02, `${hz} Hz keeps sounding`);
    assert.deepEqual(heldPolyIds(h), [1, 3]);
    h.send({ type: 'off' }); h.render(24_000);
    assert.ok(rms(h.render(4800)) < 1e-6);
  } finally { h.dispose(); }
});

test('one Poly voice retains the calibrated Mono level and same-pitch identities release separately', () => {
  const mono = makeHarness(), poly = makeHarness();
  try {
    mono.send({ type: 'state', state: state() });
    poly.send({ type: 'state', state: state({ voiceMode: 'poly' }) });
    for (const h of [mono, poly]) h.send({ type: 'note', noteId: 21, frequency: 220, velocity: .8, duration: null });
    mono.render(4800); poly.render(4800);
    const reference = mono.render(4800), actual = poly.render(4800);
    assert.ok(Math.abs(rms(reference) / rms(actual) - 1) < .001, 'one poly note is not divided by eight');
    poly.send({ type: 'note', noteId: 22, frequency: 220, velocity: .5, duration: null });
    poly.render(128);
    poly.send({ type: 'off', noteId: 21 }); poly.render(9600);
    assert.deepEqual(heldPolyIds(poly), [22]);
    assertPitch(poly.render(4800), 220, 'second same-pitch identity remains');
  } finally { mono.dispose(); poly.dispose(); }
});

test('Poly steals deterministically at eight and stale release deadlines cannot stop replacement notes', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ voiceMode: 'poly' }) });
    h.send({ type: 'note', frequency: 880, velocity: .8, duration: .05 }); h.render(128);
    for (let id = 1; id <= 9; id++) {
      h.send({ type: 'note', noteId: id, frequency: 180 + id * 30, velocity: .8, duration: null }); h.render(128);
    }
    assert.equal(polyCount(h), 8);
    assert.deepEqual(heldPolyIds(h).sort((a,b) => a-b), [2,3,4,5,6,7,8,9]);
    h.send({ type: 'off', noteId: 1 }); h.render(9600);
    assert.equal(heldPolyIds(h).length, 8, 'stolen identity and expired pulse cannot release its replacement');
    assert.ok(h.render(4096).every(value => Math.abs(value) <= .95));
  } finally { h.dispose(); }
});

test('switching Mono and Poly preserves held-note identity, latest-note priority and current method', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state() });
    for (const [noteId, frequency] of [[1,220],[2,330],[3,550]]) h.send({ type: 'note', noteId, frequency, velocity: .8, duration: null });
    assertPitch(h.render(9600).subarray(4800), 550, 'Mono has newest key');
    h.send({ type: 'state', state: state({ voiceMode: 'poly' }) }); h.render(4800);
    assert.equal(heldPolyIds(h).length, 3);
    const chord = h.render(4800);
    for (const hz of [220,330,550]) assert.ok(spectralAmplitude(chord,hz) > .02);
    h.send({ type: 'off', noteId: 3 }); h.render(2400);
    h.send({ type: 'state', state: state() }); h.render(4800);
    assertPitch(h.render(4800), 330, 'Mono resumes newest remaining key');
    h.send({ type: 'off', noteId: 2 }); h.render(4800);
    assertPitch(h.render(4800), 220, 'Mono retains older held key');
    h.send({ type: 'source', samples: new Float32Array(256), sampleRate: RATE });
    h.send({ type: 'state', state: state({ engineId: 0 }) }); h.render(24_000);
    assert.ok(rms(h.render(4096)) < 1e-6, 'old Mono method has a silent imported source');
    h.send({ type: 'state', state: state({ voiceMode: 'poly' }) }); h.render(128);
    h.send({ type: 'state', state: state() }); h.render(4800);
    assertPitch(h.render(4800), 220, 'returning to Mono uses the current method, not the stale sampling engine');
    h.send({ type: 'silence' }); h.render(24_000);
    assert.ok(rms(h.render(4096)) < 1e-6);
  } finally { h.dispose(); }
});

test('Poly Repeat overlaps release tails, keeps held keys independent, and Stop ends future beats', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ voiceMode: 'poly', playStyle: 'strike', envelope: { attack:.002, decay:.01, sustain:.8, release:.8 } }) });
    h.send({ type: 'note', noteId: 77, frequency: 550, velocity: .8, duration: null });
    h.send({ type: 'play', playing: true, rate: 4, gate: .5 });
    h.render(18_000);
    assert.ok(polyCount(h) >= 3, 'held key, release tail, and new repeat coexist');
    h.send({ type: 'play', playing: false, rate: 4, gate: .5 }); h.render(60_000);
    assert.deepEqual(heldPolyIds(h), [77]);
    assertPitch(h.render(4800), 550, 'Stop leaves the held key sounding');
    h.send({ type: 'off', noteId: 77 }); h.render(60_000);
    assert.ok(rms(h.render(4096)) < 1e-6);
  } finally { h.dispose(); }
});

test('Poly audition produces one attack and becomes the Play hold without retriggering', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ voiceMode: 'poly', playStyle: 'strike' }) });
    h.send({ type: 'play', playing: true, rate: 4 }); h.render(24_000);
    h.send({ type: 'state', state: state({ voiceMode: 'poly', envelope: { attack: .005, decay: .02, sustain: .18, release: .03 } }), audition: true, duration: .12 });
    const output = h.render(24_000), sustain = rms(output.subarray(4096,5632));
    assert.ok(rms(output.subarray(256,768)) > sustain * 2);
    assert.ok(rms(output.subarray(5888,6656)) < sustain * 1.2, 'expiry does not add another envelope attack');
    assert.equal(heldPolyIds(h).length, 1);
    assertPitch(output.subarray(19_000),220,'Play continues at the audition pitch');
  } finally { h.dispose(); }
});

test('mode changes preserve a finite audition and it still releases without Play', () => {
  for (const initial of ['mono','poly']) {
    const h = makeHarness();
    try {
      h.send({ type: 'state', state: state({ voiceMode: initial }) });
      h.send({ type: 'note', frequency: 330, velocity: .8, duration: .3 }); h.render(4800);
      h.send({ type: 'state', state: state({ voiceMode: initial === 'mono' ? 'poly' : 'mono' }) });
      assertPitch(h.render(4800).subarray(1000),330,'audition survives mode change');
      h.render(24_000);
      assert.ok(rms(h.render(4096)) < 1e-6, 'transferred audition retains its deadline');
    } finally { h.dispose(); }
  }
});

test('imported source and restore reach every Poly voice and survive mode switches', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'source', samples: new Float32Array(256), sampleRate: RATE });
    const patch = state({ voiceMode: 'poly', engineId: 0 });
    h.send({ type: 'state', state: patch });
    for (let id=1;id<=8;id++) h.send({ type:'note', noteId:id, frequency:100+id*40, velocity:.8, duration:null });
    assert.equal(rms(h.render(9600)),0,'all eight imported sources are silent');
    h.send({ type:'restore-source' });
    h.send({ type:'state', state:patch, audition:true });
    assert.ok(rms(h.render(9600))>.001,'built-in source restores across voices');
    h.send({ type:'silence' }); h.render(24_000);
    assert.equal(heldPolyIds(h).length,0);
  } finally { h.dispose(); }
});


test('every synthesis method produces a finite bounded Poly chord through the actual worklet', () => {
  const h = makeHarness();
  try {
    for (const method of SYNTHESIS_METHODS) {
      h.send({ type: 'silence' });
      const preset = method.presets[0];
      h.send({ type: 'state', state: { ...preset, voiceMode: 'poly', engineId: method.engineId, playStyle: method.playStyle } });
      for (let id = 1; id <= 3; id++) h.send({ type: 'note', noteId: id, frequency: preset.frequencyHz * [1, 1.25, 1.5][id-1], velocity: .8, duration: null });
      const output = h.render(24_000);
      assert.ok(rms(output) > 1e-5, `${method.id} chord is audible`);
      assert.ok(output.every(value => Number.isFinite(value) && Math.abs(value) <= .950001), `${method.id} is bounded`);
      assert.equal(heldPolyIds(h).length, 3, `${method.id} has three independent held notes`);
    }
  } finally { h.dispose(); }
});

test('Poly Hold resumes after eight keys steal its voice and a key releases', () => {
  const h=makeHarness();
  try {
    h.send({type:'state',state:state({voiceMode:'poly'})});
    h.send({type:'play',playing:true});h.render(128);
    for(let id=1;id<=8;id++) h.send({type:'note',noteId:id,frequency:330+id*30,velocity:.8,duration:null});
    h.render(4800);
    assert.deepEqual(heldPolyIds(h).sort((a,b)=>a-b),[1,2,3,4,5,6,7,8]);
    h.send({type:'off',noteId:1});h.render(4800);
    assert.equal(heldPolyIds(h).length,8,'seven keys and the restored Play voice sound');
    h.send({type:'off'});h.render(9600);
    assertPitch(h.render(4800),220,'Play continues after releasing all keys');
    h.send({type:'play',playing:false});h.render(9600);
    assert.ok(rms(h.render(4096))<1e-6);
  }finally{h.dispose();}
});

test('Poly reset discards a long audition deadline and restarts Repeat immediately',()=>{
  const h=makeHarness();
  try{
    h.send({type:'state',state:state({voiceMode:'poly',playStyle:'strike'})});
    h.send({type:'play',playing:true,rate:2,gate:.5});h.render(128);
    h.send({type:'note',frequency:330,velocity:.8,duration:12});h.render(128);
    h.send({type:'reset'});
    assert.ok(rms(h.render(4096))>.005,'reset does not wait for the deleted audition');
    assert.ok(h.processor.nextTrigger<h.frame+RATE);
  }finally{h.dispose();}
});

test('Audio rearm restores held-note ownership with one Mono excitation or a Poly chord',()=>{
  for(const voiceMode of ['mono','poly']){
    const h=makeHarness(),reference=makeHarness();
    try{
      const patch=state({voiceMode,engineId:17});
      h.send({type:'state',state:patch});reference.send({type:'state',state:patch});
      const notes=[{noteId:1,frequency:220,velocity:.8},{noteId:2,frequency:330,velocity:.8},{noteId:3,frequency:550,velocity:.8}];
      h.send({type:'held-notes',notes});
      for(const note of voiceMode==='mono'?notes.slice(-1):notes) reference.send({type:'note',...note,duration:null});
      const actual=h.render(4800),expected=reference.render(4800);
      assert.deepEqual(actual,expected,'restored snapshot emits exactly one attack per sounding voice');
      assert.equal(h.processor.noteOwners.size,3,'older keys retain ownership for later mode changes/releases');
    }finally{h.dispose();reference.dispose();}
  }
});

test('a simultaneous finite Poly chord attacks each voice once and expires without retriggering held notes', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ voiceMode: 'poly' }) });
    h.send({ type: 'note', frequency: 110, velocity: .8, duration: null, noteId: 7 });
    h.render(4800);
    const attacks = [], api = h.processor.api;
    h.processor.api = { ...api, poly_note_on(...args) { attacks.push(args); return api.poly_note_on(...args); } };
    const at = h.time + 47 / RATE;
    for (const frequency of [220, 330, 550]) h.send({ type: 'note', frequency, velocity: .8, duration: .15, at });
    h.render(128);
    assert.equal(attacks.length, 3, 'exactly one attack per demo note');
    assert.equal(new Set(attacks.map(args => args[1])).size, 3, 'finite notes have independent voice IDs');
    const chord = h.render(4800);
    for (const hz of [110, 220, 330, 550]) assert.ok(spectralAmplitude(chord, hz) > .01, `${hz} Hz sounds`);
    h.render(RATE / 2);
    assert.equal(attacks.length, 3, 'the chord expires without extra attacks');
    assert.deepEqual(heldPolyIds(h), [7], 'the original held note survives');
    const remaining = h.render(4800);
    assertPitch(remaining, 110, 'held note after chord');
    for (const hz of [220, 330, 550]) assert.ok(spectralAmplitude(remaining, hz) < .001, `${hz} Hz demo note has released`);
    h.send({ type: 'off' }); h.render(24_000);
    assert.deepEqual(heldPolyIds(h), [], 'the original note is released');
    assert.ok(rms(h.render(4800)) < 1e-6, 'all release tails finish');
  } finally { h.dispose(); }
});

function sequence(overrides = {}) {
  return {
    studyId: 'test-cycle', seed: 7, tempo: 120, stepBeats: .25, lengthBeats: 1,
    steps: [{ index: 7, at: .25, duration: .1, notes: [{ ratio: 2, velocity: .8, gate: 1, accent: false }] }],
    ...overrides,
  };
}

function sequenceScheduleSnapshot(processor) {
  return {
    revision: processor.sequenceRevision,
    anchorBeat: processor.sequenceAnchorBeat,
    anchorFrame: processor.sequenceAnchorFrame,
    nextStep: processor.sequenceNextStep,
    nextBeat: processor.sequenceNextBeat,
    cycleBase: processor.sequenceCycleBase,
    lastStepIndex: processor.sequenceLastStepIndex,
    lastCursor: processor.sequenceLastCursor,
  };
}

test('compiled sequence attacks land on exact sample-clock boundaries and Stop owns their cancellation', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ envelope: { attack: .001, decay: .005, sustain: .8, release: .003 } }) });
    h.send({ type: 'sequence-load', sequence: sequence(), rootFrequency: 220, tempo: 120 });
    h.send({ type: 'sequence-start', phase: 0, rootFrequency: 220, tempo: 120 });
    const output = h.render(12_000);
    assert.ok(output.subarray(0, 6000).every(value => value === 0), 'the quarter-beat note cannot sound one sample early');
    assert.ok(rms(output.subarray(6000, 9000)) > .005, 'the sequence note begins at its calculated sample');
    const status = h.messages.filter(message => message.type === 'sequence-status').at(-1);
    assert.equal(status.playing, true);
    assert.equal(status.stepIndex, 7);
    assert.equal(status.studyId, 'test-cycle');
    h.send({ type: 'sequence-stop' });
    const stopped = h.messages.filter(message => message.type === 'sequence-status').at(-1);
    assert.equal(stopped.playing, false);
    assert.ok(Math.abs(stopped.phaseBeats - .5) < 1e-9, 'stopped status retains the elapsed cursor phase');
    h.render(24_000);
    assert.ok(rms(h.render(12_000)) < 1e-6, 'Stop releases owned sound and removes all future attacks');
    assert.equal(h.processor.sequenceNextBeat, Infinity);
  } finally { h.dispose(); }
});

test('an explicitly scheduled phase-zero Start renders the authored beat-zero attack', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ envelope: { attack: .001, decay: .01, sustain: .8, release: .02 } }) });
    const score = sequence({ lengthBeats: 4, steps: [
      { index: 0, at: 0, duration: 1, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
    ] });
    const targetFrame = 47;
    h.send({ type: 'sequence-load', sequence: score, rootFrequency: 220, tempo: 120,
      at: targetFrame / RATE, phase: 0, preservePhase: true });
    const api = h.processor.api, attacks = [];
    h.processor.api = {
      ...api,
      synth_note_on(...args) { attacks.push(args.at(-2)); return api.synth_note_on(...args); },
    };
    h.send({ type: 'sequence-start', phase: 0, originBeat: 0, rootFrequency: 220,
      tempo: 120, at: targetFrame / RATE, intent: 1 });

    const output = h.render(128);
    assert.ok(output.subarray(0, targetFrame).every(value => value === 0));
    assert.ok(rms(output.subarray(targetFrame)) > .0001);
    assert.deepEqual(attacks, [220]);
    assert.equal(h.processor.sequenceAnchorFrame, targetFrame);
  } finally { h.dispose(); }
});

test('a replacement consumes an old scheduled attack inside its lead window', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ envelope: { attack: .001, decay: .01, sustain: .8, release: .02 } }) });
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4, steps: [
      { index: 1, at: .25, duration: 1, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
    ] }), rootFrequency: 220, tempo: 120 });
    h.send({ type: 'sequence-start', phase: .245, originBeat: 0, rootFrequency: 220, tempo: 120, intent: 1 });
    const oldAttackFrame = 120;
    const requestedFrame = 240;
    const phase = h.processor.sequenceBeatAt(requestedFrame);
    const api = h.processor.api, attacks = [];
    h.processor.api = {
      ...api,
      synth_note_on(...args) { attacks.push(args.at(-2)); return api.synth_note_on(...args); },
    };
    h.send({
      type: 'sequence-swap', intent: 2,
      sequence: sequence({ studyId: 'replacement-before-old-step', lengthBeats: 4, steps: [
        { index: 2, at: .75, duration: 1, notes: [{ ratio: 1.5, velocity: .8, gate: 1 }] },
      ] }),
      rootFrequency: 220, tempo: 120, at: requestedFrame / RATE,
      phase, originBeat: phase - .75, playing: true,
      preserveVoices: false, triggerCurrent: true,
    });

    assert.equal(h.processor.pendingSequenceSwap.frame, oldAttackFrame);
    const output = h.render(256);
    assert.ok(output.subarray(0, oldAttackFrame).every(value => value === 0));
    assert.ok(rms(output.subarray(oldAttackFrame)) > .0001);
    assert.deepEqual(attacks, [330], 'only the replacement attack is rendered');
    assert.equal(h.processor.sequenceAnchorFrame, oldAttackFrame);
  } finally { h.dispose(); }
});

test('Direct Note Repeat hands release and next-trigger boundaries to the score without a gap or double', () => {
  for (const boundaryKind of ['release', 'next trigger']) {
    const h = makeHarness();
    try {
      h.send({ type: 'state', state: state({
        playStyle: 'strike', envelope: { attack: .001, decay: .01, sustain: .8, release: .02 },
      }) });
      h.send({ type: 'play', playing: true, rate: 20, gate: .05 });
      if (boundaryKind === 'next trigger') h.render(2304);
      const boundary = boundaryKind === 'release' ? h.processor.releaseAt : h.processor.nextTrigger;
      const requestedFrame = h.frame + 240;
      assert.ok(boundary > h.frame && boundary < requestedFrame);
      const api = h.processor.api;
      const calls = { on: [], off: 0 };
      h.processor.api = {
        ...api,
        synth_note_on(...args) { calls.on.push(args.at(-2)); return api.synth_note_on(...args); },
        synth_note_off(...args) { calls.off++; return api.synth_note_off(...args); },
      };
      h.send({
        type: 'sequence-swap', intent: 1,
        sequence: sequence({ studyId: `direct-${boundaryKind}`, lengthBeats: 4, steps: [
          { index: 4, at: .5, duration: 1, notes: [{ ratio: 1.5, velocity: .8, gate: 1 }] },
        ] }),
        rootFrequency: 220, tempo: 120, at: requestedFrame / RATE,
        phase: 0, originBeat: -.5, playing: true, preserveVoices: false,
        triggerCurrent: true, stopPlay: true,
      });

      assert.equal(h.processor.pendingSequenceSwap.frame, boundary);
      const output = h.render(boundary - h.frame + 128);
      assert.deepEqual(calls, { on: [330], off: 0 }, `${boundaryKind} is replaced by one target attack`);
      assert.ok(rms(output.subarray(boundary - (boundaryKind === 'release' ? 0 : 2304))) > .0001);
      assert.equal(h.processor.playing, false);
    } finally { h.dispose(); }
  }
});

test('a Poly Direct Note deadline is consumed at the same sample as the incoming score chord', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ voiceMode: 'poly', playStyle: 'strike' }) });
    h.send({ type: 'play', playing: true, rate: 20, gate: .05 });
    const play = h.processor.polyDeadlines.find(note => note?.kind === 'play');
    assert.ok(play);
    const api = h.processor.api;
    const calls = { on: 0, off: 0 };
    h.processor.api = {
      ...api,
      poly_note_on(...args) { calls.on++; return api.poly_note_on(...args); },
      poly_note_off(...args) { calls.off++; return api.poly_note_off(...args); },
    };
    h.send({
      type: 'sequence-swap', intent: 1,
      sequence: sequence({ studyId: 'poly-direct-handoff', lengthBeats: 4, steps: [
        { index: 5, at: .5, duration: 1, notes: [{ ratio: 1.5, velocity: .8, gate: 1 }] },
      ] }),
      rootFrequency: 220, tempo: 120, at: 240 / RATE,
      phase: 0, originBeat: -.5, playing: true, preserveVoices: false,
      triggerCurrent: true, stopPlay: true,
    });

    assert.equal(h.processor.pendingSequenceSwap.frame, play.end);
    const output = h.render(256);
    assert.deepEqual(calls, { on: 1, off: 1 });
    assert.ok(rms(output.subarray(play.end)) > .0001);
    assert.ok(h.processor.polyDeadlines.some(note => note?.kind === 'sequence'));
  } finally { h.dispose(); }
});

test('renderer-changing swaps render processor to Mono and Mono to Poly to Mono at quantum entry', () => {
  const h = makeHarness();
  const score = (id, ratio = 1) => sequence({ studyId: id, lengthBeats: 4, steps: [
    { index: 0, at: .5, duration: 4, notes: [{ ratio, velocity: .8, gate: 1 }] },
  ] });
  const swap = (nextState, id, ratio = 1) => {
    const requestedFrame = h.frame + 47;
    const phase = h.processor.sequencePlaying ? h.processor.sequenceBeatAt(requestedFrame) : 0;
    h.send({
      type: 'sequence-swap', sequence: score(id, ratio), state: nextState,
      rootFrequency: 220, tempo: 120, at: requestedFrame / RATE,
      phase, originBeat: phase - .5, playing: true,
      preserveVoices: false, triggerCurrent: true,
    });
    assert.equal(h.processor.pendingSequenceSwap.frame, h.frame,
      'the renderer transaction is quantized to the next process entry');
    return h.render(4096);
  };
  try {
    h.send({ type: 'state', state: effectState({ source: 3 }) });
    const mono = swap(state({ kind: 'synthesis', voiceMode: 'mono' }), 'processor-to-mono');
    assert.equal(h.processor.state.kind, 'synthesis');
    assert.ok(h.processor.sequenceMono);
    assert.ok(rms(mono.subarray(256)) > .0001, 'processor to Mono renders the new synth immediately');

    const poly = swap(state({ kind: 'synthesis', voiceMode: 'poly' }), 'mono-to-poly', 1.5);
    assert.equal(h.processor.state.voiceMode, 'poly');
    assert.equal(h.processor.sequenceMono, null);
    assert.ok(h.processor.polyDeadlines.some(note => note?.kind === 'sequence'));
    assert.ok(rms(poly.subarray(256)) > .0001, 'Mono to Poly renders through the Poly bank immediately');

    const monoAgain = swap(state({ kind: 'synthesis', voiceMode: 'mono' }), 'poly-to-mono', 2);
    assert.equal(h.processor.state.voiceMode, 'mono');
    assert.ok(h.processor.sequenceMono);
    assert.equal(h.processor.polyDeadlines.filter(Boolean).length, 0);
    assert.ok(rms(monoAgain.subarray(256)) > .0001, 'Poly to Mono renders through the Mono engine immediately');
  } finally { h.dispose(); }
});

test('a tempo edit cannot pull a renderer-changing swap into a render quantum interior', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ voiceMode: 'mono' }) });
    h.send({
      type: 'sequence-swap', intent: 1,
      sequence: sequence({ lengthBeats: 4, steps: [
        { index: 0, at: 0, duration: 1, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
      ] }),
      state: state({ voiceMode: 'poly' }), rootFrequency: 220, tempo: 120,
      at: 240 / RATE, phase: 0, originBeat: 0, playing: true,
      preserveVoices: false, triggerCurrent: true,
    });
    assert.equal(h.processor.pendingSequenceSwap.frame, 128);
    h.send({ type: 'sequence-tempo', tempo: 90, at: 47 / RATE, intent: 2 });
    assert.equal(h.processor.pendingSequenceSwap.frame, 0,
      'earlier tempo intent advances the whole renderer transaction to quantum entry');
    const output = h.render(128);
    assert.equal(h.processor.state.voiceMode, 'poly');
    assert.ok(h.processor.polyDeadlines.some(note => note?.kind === 'sequence'));
    assert.ok(rms(output) > .0001);
  } finally { h.dispose(); }
});

test('sequence tempo edits preserve fractional beat phase and rescale the next authored attack', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ envelope: { attack: .001, decay: .005, sustain: .8, release: .003 } }) });
    h.send({ type: 'sequence-load', sequence: sequence({ tempo: 60, steps: [
      { index: 3, at: .75, duration: .08, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
    ] }), rootFrequency: 220, tempo: 60 });
    h.send({ type: 'sequence-start', phase: .25, rootFrequency: 220, tempo: 60 });
    assert.equal(rms(h.render(12_000)), 0); // phase .25 -> .5 at 60 BPM
    h.send({ type: 'sequence-tempo', tempo: 120 });
    const changed = h.render(10_000);
    assert.ok(changed.subarray(0, 6000).every(value => value === 0), 'remaining quarter beat is preserved at the new tempo');
    assert.ok(rms(changed.subarray(6000, 9000)) > .005, 'next attack follows the rescaled quarter beat');
  } finally { h.dispose(); }
});

test('mapped wide-register ratios reach the audio engine without a second pitch clamp', () => {
  for (const [rootFrequency, ratio] of [[20, 300], [20, 400], [8000, 1 / 300], [8000, 1 / 400]]) {
    const h = makeHarness();
    try {
      h.send({ type: 'state', state: state() });
      h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4, steps: [
        { index: 0, at: 0, duration: 4, notes: [{ ratio, velocity: .8, gate: 1 }] },
      ] }), rootFrequency, tempo: 120 });
      assert.equal(h.processor.sequence.steps[0].notes[0].ratio, ratio);
      h.send({ type: 'sequence-start', phase: 0, rootFrequency, tempo: 120 });
      h.render(4096);
      assert.equal(h.processor.sequenceMono.frequency, rootFrequency * ratio);
      assert.ok(rms(h.render(4096)) > .001, 'bounded wide-register notes remain audible and finite');
    } finally { h.dispose(); }
  }
});

test('Mono sequence pitch survives timbre edits and follows live root-frequency changes', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state() });
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4, steps: [
      { index: 0, at: 0, duration: 4, notes: [{ ratio: 2, velocity: .8, gate: 1 }] },
    ] }), rootFrequency: 220, tempo: 120 });
    h.send({ type: 'sequence-start', phase: 0, rootFrequency: 220, tempo: 120 });
    h.render(4096);
    assertPitch(h.render(4096), 440, 'initial sequence note');
    h.send({ type: 'state', state: state({ frequencyHz: 173, params: [1, .15, 0, 0, 0, 0, 0, 0] }) });
    h.render(4096);
    assertPitch(h.render(4096), 440, 'sequence note after a timbre and base-frequency edit');
    h.send({ type: 'sequence-root', rootFrequency: 165 });
    h.render(4096);
    assertPitch(h.render(4096), 330, 'sequence note after a live root-frequency edit');
    assert.equal(h.processor.sequenceMono.frequency, 330);
  } finally { h.dispose(); }
});

test('sequence-root continuously retunes an owned Mono voice without rebuilding its schedule', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state() });
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4, steps: [
      { index: 12, at: 0, duration: 4, notes: [{ ratio: 2, velocity: .8, gate: 1 }] },
    ] }), rootFrequency: 110, tempo: 120 });
    h.send({ type: 'sequence-start', phase: 0, rootFrequency: 110, tempo: 120 });
    h.render(4096);
    assertPitch(h.render(4096), 220, 'owned Mono voice before retune');

    const ownedVoice = h.processor.sequenceMono;
    const schedule = sequenceScheduleSnapshot(h.processor);
    const api = h.processor.api;
    const calls = { on: 0, off: 0, frequency: [] };
    h.processor.api = {
      ...api,
      synth_note_on(...args) { calls.on++; return api.synth_note_on(...args); },
      synth_note_off(...args) { calls.off++; return api.synth_note_off(...args); },
      synth_set_frequency(...args) { calls.frequency.push(args.at(-1)); return api.synth_set_frequency(...args); },
    };

    h.send({ type: 'sequence-root', rootFrequency: 165 });
    assert.equal(h.processor.sequenceMono, ownedVoice, 'the worklet retains the active sequence voice');
    assert.equal(h.processor.sequenceMono.frequency, 330);
    assert.deepEqual(calls, { on: 0, off: 0, frequency: [330] }, 'retune changes pitch without a note-off or reattack');
    assert.deepEqual(sequenceScheduleSnapshot(h.processor), schedule,
      'retune leaves revision, anchor, next beat, and cursor untouched');

    const changed = h.render(4096);
    assert.ok(changed.every(Number.isFinite), 'retuned Mono output remains finite');
    assert.ok(rms(changed.subarray(0, 512)) > .005, 'the already sounding voice has no silent restart gap');
    assertPitch(changed.subarray(1024), 330, 'owned Mono voice after retune');
  } finally { h.dispose(); }
});

test('sequence-root continuously retunes owned Poly voices without cancelling notes or moving the cursor', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ voiceMode: 'poly' }) });
    const ratios = [2, 3, 5];
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4, steps: [
      { index: 21, at: 0, duration: 4, notes: ratios.map(ratio => ({ ratio, velocity: .65, gate: 1 })) },
    ] }), rootFrequency: 110, tempo: 120 });
    h.send({ type: 'sequence-start', phase: 0, rootFrequency: 110, tempo: 120 });
    h.render(4096);
    const before = h.render(4096);
    assert.ok(rms(before) > .005 && before.every(Number.isFinite), 'owned Poly chord sounds before retune');

    const owned = h.processor.polyDeadlines
      .map((note, slot) => note?.kind === 'sequence' ? { slot, note } : null)
      .filter(Boolean);
    assert.equal(owned.length, ratios.length);
    assert.equal(polyCount(h), ratios.length);
    const schedule = sequenceScheduleSnapshot(h.processor);
    const noteSequence = h.processor.sequenceNoteSequence;
    const api = h.processor.api;
    const calls = { on: 0, off: 0, reset: 0, frequencies: [] };
    h.processor.api = {
      ...api,
      poly_note_on(...args) { calls.on++; return api.poly_note_on(...args); },
      poly_note_off(...args) { calls.off++; return api.poly_note_off(...args); },
      poly_reset(...args) { calls.reset++; return api.poly_reset(...args); },
      poly_set_note_frequency(...args) {
        calls.frequencies.push({ id: args[1] >>> 0, frequency: args[2] });
        return api.poly_set_note_frequency(...args);
      },
    };

    h.send({ type: 'sequence-root', rootFrequency: 165 });
    assert.equal(calls.on, 0, 'retune does not reattack Poly voices');
    assert.equal(calls.off, 0, 'retune does not cancel Poly voices');
    assert.equal(calls.reset, 0, 'retune does not reset the Poly bank');
    assert.deepEqual(calls.frequencies.map(call => call.frequency), ratios.map(ratio => 165 * ratio));
    assert.deepEqual(sequenceScheduleSnapshot(h.processor), schedule,
      'retune leaves revision, anchor, next beat, and cursor untouched');
    assert.equal(h.processor.sequenceNoteSequence, noteSequence, 'retune allocates no replacement note identities');
    assert.equal(polyCount(h), ratios.length);
    for (const { slot, note } of owned) {
      assert.equal(h.processor.polyDeadlines[slot], note, 'each owned deadline remains in its original slot');
      assert.equal(note.frequency, 165 * note.ratio);
    }

    const changed = h.render(4800);
    assert.ok(changed.every(Number.isFinite), 'retuned Poly output remains finite');
    assert.ok(rms(changed.subarray(0, 512)) > .005, 'the active chord has no silent restart gap');
    for (const frequency of ratios.map(ratio => 165 * ratio)) {
      assert.ok(spectralAmplitude(changed.subarray(1024), frequency) > .005,
        `${frequency} Hz remains audible after the in-place retune`);
    }
  } finally { h.dispose(); }
});

test('an atomic score launch hands Mono audio over on the exact scheduled sample', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state() });
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4, steps: [
      { index: 0, at: 0, duration: 4, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
      { index: 1, at: 2, duration: 1, notes: [{ ratio: 4, velocity: .8, gate: 1 }] },
    ] }), rootFrequency: 220, tempo: 120 });
    h.send({ type: 'sequence-start', phase: 0, rootFrequency: 220, tempo: 120 });
    h.render(4096);
    const beforeRevision = h.processor.sequenceRevision;
    const beforeBeat = h.processor.sequenceBeatAt(h.frame);
    const targetFrame = h.frame + 47;
    const targetBeat = beforeBeat + 47 * 120 / (60 * RATE);
    const firstAttack = 1.25;
    const api = h.processor.api;
    const calls = { on: [], off: 0 };
    h.processor.api = {
      ...api,
      synth_note_on(...args) { calls.on.push(args); return api.synth_note_on(...args); },
      synth_note_off(...args) { calls.off++; return api.synth_note_off(...args); },
    };

    h.send({
      type: 'sequence-swap',
      sequence: sequence({ studyId: 'replacement', lengthBeats: 4, steps: [
        { index: 9, at: firstAttack, duration: 1, notes: [{ ratio: 1.5, velocity: .8, gate: 1 }] },
      ] }),
      rootFrequency: 220,
      tempo: 120,
      at: targetFrame / RATE,
      phase: targetBeat,
      originBeat: targetBeat - firstAttack,
      playing: true,
      preserveVoices: false,
      triggerCurrent: true,
    });
    assert.equal(h.processor.sequenceRevision, beforeRevision, 'the score does not commit in the message handler');
    assert.equal(calls.on.length, 0);

    const crossing = h.render(128);
    assert.ok(rms(crossing.subarray(0, 47)) > .005, 'the outgoing gate sounds until the boundary');
    assert.equal(h.processor.sequenceRevision, beforeRevision + 1, 'one replacement commits');
    assert.equal(h.processor.sequenceAnchorFrame, targetFrame);
    assert.equal(h.processor.sequence.studyId, 'replacement');
    assert.equal(h.processor.sequenceMono.frequency, 330);
    assert.equal(calls.on.length, 1, 'the incoming attack occurs once');
    assert.equal(calls.off, 0, 'Mono handoff does not insert a note-off gap');
    assert.ok(rms(crossing.subarray(47)) > .0001, 'the incoming attack starts in the same render block');
    const status = h.messages.filter(message => message.type === 'sequence-status').at(-1);
    assert.ok(status.beat >= beforeBeat, 'the global transport beat never rewinds');
    assert.ok(Math.abs(status.phaseBeats - firstAttack) < 1e-9, 'pattern phase launches on its first sounding event');
    h.render(4096); // let the engine's authored frequency glide settle
    assertPitch(h.render(4096), 330, 'replacement pitch');
  } finally { h.dispose(); }
});

test('a phase-preserving score swap lets the active gate sound until the new authored attack', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state() });
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4, steps: [
      { index: 0, at: 0, duration: 1, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
    ] }), rootFrequency: 220, tempo: 120 });
    h.send({ type: 'sequence-start', phase: 0, rootFrequency: 220, tempo: 120 });
    h.render(4096);
    const ownedVoice = h.processor.sequenceMono;
    const targetFrame = h.frame + 47;
    const targetBeat = h.processor.sequenceBeatAt(targetFrame);
    const api = h.processor.api;
    const calls = { on: 0, off: 0 };
    h.processor.api = {
      ...api,
      synth_note_on(...args) { calls.on++; return api.synth_note_on(...args); },
      synth_note_off(...args) { calls.off++; return api.synth_note_off(...args); },
    };
    h.send({
      type: 'sequence-swap',
      sequence: sequence({ studyId: 'phase-replacement', lengthBeats: 4, steps: [
        { index: 5, at: .5, duration: 1, notes: [{ ratio: 2, velocity: .8, gate: 1 }] },
      ] }),
      rootFrequency: 220,
      tempo: 120,
      at: targetFrame / RATE,
      phase: targetBeat,
      originBeat: 0,
      playing: true,
      preserveVoices: true,
      triggerCurrent: false,
    });

    const crossing = h.render(128);
    assert.equal(h.processor.sequenceMono, ownedVoice, 'the outgoing owned gate survives the metadata swap');
    assert.deepEqual(calls, { on: 0, off: 0 }, 'the swap itself neither releases nor reattacks');
    assert.ok(rms(crossing) > .005, 'the preserved gate leaves no swap gap');
    const framesToNewAttack = Math.ceil((.5 - h.processor.sequenceBeatAt(h.frame)) * RATE * 60 / 120);
    h.render(Math.max(1, framesToNewAttack + 128));
    assert.equal(calls.on, 1, 'the new score takes ownership on its first authored attack');
    assert.equal(calls.off, 0, 'Mono ownership changes without an intermediate release');
    assert.equal(h.processor.sequenceMono.ratio, 2);
    assert.equal(h.processor.sequenceMono.revision, h.processor.sequenceRevision);
    h.render(4096); // let the engine's authored frequency glide settle
    assertPitch(h.render(4096), 440, 'phase-preserving replacement pitch');
  } finally { h.dispose(); }
});

test('late phase-preserving delivery advances to the actual worklet boundary without rewinding', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state() });
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4, steps: [
      { index: 0, at: 0, duration: 4, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
    ] }), rootFrequency: 220, tempo: 120 });
    h.send({ type: 'sequence-start', phase: 0, originBeat: 0, rootFrequency: 220, tempo: 120 });
    h.render(4096);
    const actualBeat = h.processor.sequenceBeatAt(h.frame);
    const delayedBeats = .04;
    h.send({
      type: 'sequence-swap',
      sequence: sequence({ studyId: 'late', lengthBeats: 4, steps: [
        { index: 2, at: .5, duration: 1, notes: [{ ratio: 1.5, velocity: .8, gate: 1 }] },
      ] }),
      rootFrequency: 220,
      tempo: 120,
      at: h.time - .02,
      phase: actualBeat - delayedBeats,
      originBeat: 0,
      playing: true,
      preserveVoices: true,
      triggerCurrent: false,
    });
    h.render(128);
    assert.equal(h.processor.sequenceAnchorFrame, 4096, 'a late message commits at the next available frame');
    assert.ok(Math.abs(h.processor.sequenceAnchorBeat - actualBeat) < 1e-12,
      'the global transport advances through delivery latency');
    assert.equal(h.processor.sequenceOriginBeat, 0,
      'phase-preserving replacement does not move the established pattern origin');
    assert.ok(h.processor.sequenceNextBeat >= actualBeat,
      'the replacement seeks from the actual boundary rather than replaying stale work');
  } finally { h.dispose(); }
});

test('a preserve-phase replacement retains authoritative worklet origin before acknowledgement', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state() });
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4 }), rootFrequency: 220, tempo: 120 });
    h.send({ type: 'sequence-start', phase: 0, originBeat: 0, rootFrequency: 220, tempo: 120 });
    h.render(4096);
    const actualBeat = h.processor.sequenceBeatAt(h.frame);
    h.send({
      type: 'sequence-swap',
      sequence: sequence({ studyId: 'late-restart', lengthBeats: 4, steps: [
        { index: 1, at: .5, duration: 1, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
      ] }),
      rootFrequency: 220, tempo: 120, at: h.time - .02,
      phase: actualBeat - .04, originBeat: actualBeat - .54,
      playing: true, preserveVoices: false, triggerCurrent: true,
    });
    h.render(128);
    const authoritativeOrigin = h.processor.sequenceOriginBeat;
    assert.ok(Math.abs(authoritativeOrigin - (actualBeat - .5)) < 1e-9);

    const phase = h.processor.sequenceBeatAt(h.frame + 47);
    h.send({
      type: 'sequence-swap',
      sequence: sequence({ studyId: 'preserved-origin', lengthBeats: 4, steps: [] }),
      rootFrequency: 220, tempo: 120, at: (h.frame + 47) / RATE,
      phase, originBeat: 999, playing: true,
      preserveVoices: true, triggerCurrent: false,
    });
    h.render(128);
    assert.equal(h.processor.sequenceOriginBeat, authoritativeOrigin,
      'stale sender origin cannot rewind a phrase-preserving transaction');

    const authoritativeBeat = h.processor.sequenceBeatAt(h.frame);
    h.send({ type: 'sequence-load', sequence: sequence({ studyId: 'paused-load' }),
      rootFrequency: 220, tempo: 120, phase: authoritativeBeat - 1,
      originBeat: 999, preservePhase: true, playing: true });
    assert.equal(h.processor.sequenceAnchorBeat, authoritativeBeat,
      'a preserve-phase load derives its beat from the worklet clock');
    assert.equal(h.processor.sequenceOriginBeat, authoritativeOrigin,
      'a preserve-phase load also retains the worklet origin');
  } finally { h.dispose(); }
});

test('a rapid Start coalesces with an armed swap instead of opening a stop-start gap', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state() });
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4, steps: [
      { index: 0, at: 0, duration: 4, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
    ] }), rootFrequency: 220, tempo: 120, intent: 1 });
    h.send({ type: 'sequence-start', phase: 0, originBeat: 0, rootFrequency: 220, tempo: 120, intent: 1 });
    h.render(4096);
    const targetFrame = h.frame + 240;
    const phase = h.processor.sequenceBeatAt(targetFrame);
    const api = h.processor.api;
    const calls = { on: [], off: 0 };
    h.processor.api = {
      ...api,
      synth_note_on(...args) { calls.on.push(args.at(-2)); return api.synth_note_on(...args); },
      synth_note_off(...args) { calls.off++; return api.synth_note_off(...args); },
    };
    h.send({
      type: 'sequence-swap', intent: 2,
      sequence: sequence({ studyId: 'coalesced-start', lengthBeats: 4, steps: [
        { index: 7, at: .75, duration: 2, notes: [{ ratio: 1.5, velocity: .8, gate: 1 }] },
      ] }),
      rootFrequency: 220, tempo: 120, at: targetFrame / RATE,
      phase, originBeat: phase - .75, playing: true,
      preserveVoices: false, triggerCurrent: true,
    });
    h.send({ type: 'sequence-start', intent: 3, tempo: 120, rootFrequency: 220,
      at: targetFrame / RATE, phase, originBeat: phase - .75 });

    assert.deepEqual(calls, { on: [], off: 0 }, 'Start does not force the transaction early');
    assert.equal(h.processor.pendingSequenceSwap.intent, 3);
    const crossing = h.render(384);
    assert.ok(rms(crossing.subarray(0, 240)) > .001, 'the outgoing gate reaches the boundary');
    assert.deepEqual(calls, { on: [330], off: 0 });
    assert.ok(rms(crossing.subarray(240)) > .0001, 'the replacement begins at that boundary');
  } finally { h.dispose(); }
});

test('tempo changes apply on the authored frame under the old worklet clock and never rewind when late', () => {
  const onTime = makeHarness(), late = makeHarness();
  try {
    for (const h of [onTime, late]) {
      h.send({ type: 'state', state: state({ envelope: { attack: .001, decay: .01, sustain: .8, release: .02 } }) });
      h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4, steps: [
        { index: 3, at: .25, duration: 1, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
      ] }), rootFrequency: 220, tempo: 120, intent: 1 });
      h.send({ type: 'sequence-start', phase: 0, originBeat: 0, rootFrequency: 220, tempo: 120, intent: 1 });
    }

    onTime.send({ type: 'sequence-tempo', tempo: 60, phase: 999, at: 6000 / RATE, intent: 2 });
    assert.equal(rms(onTime.render(6000)), 0);
    const attack = onTime.render(128);
    assert.ok(rms(attack) > .0001, 'the old-clock attack at the tempo boundary is retained');
    assert.equal(onTime.processor.sequenceAnchorFrame, 6000);
    assert.ok(Math.abs(onTime.processor.sequenceAnchorBeat - .25) < 1e-12);
    assert.equal(onTime.processor.sequenceTempo, 60);

    late.render(4800);
    late.send({ type: 'sequence-tempo', tempo: 60, phase: 999, at: late.time - .02, intent: 2 });
    late.render(128);
    assert.equal(late.processor.sequenceAnchorFrame, 4800);
    assert.ok(Math.abs(late.processor.sequenceAnchorBeat - .2) < 1e-12,
      'late delivery derives the actual old-clock beat instead of stale predicted phase');
  } finally { onTime.dispose(); late.dispose(); }
});

test('root edits join pending tempo and score intents without acknowledging stale clock state', () => {
  for (const transaction of ['tempo', 'swap']) {
    const h = makeHarness();
    try {
      h.send({ type: 'state', state: state() });
      h.send({ type: 'sequence-load', sequence: sequence({ studyId: 'old', lengthBeats: 4, steps: [
        { index: 0, at: 0, duration: 4, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
      ] }), rootFrequency: 220, tempo: 120, intent: 1 });
      h.send({ type: 'sequence-start', phase: 0, originBeat: 0, rootFrequency: 220, tempo: 120, intent: 1 });
      h.render(4096);
      h.messages.length = 0;
      const frame = h.frame + 240;
      const phase = h.processor.sequenceBeatAt(frame);
      if (transaction === 'tempo') {
        h.send({ type: 'sequence-tempo', tempo: 90, at: frame / RATE, phase: 999, intent: 2 });
      } else {
        h.send({
          type: 'sequence-swap', intent: 2,
          sequence: sequence({ studyId: 'first', lengthBeats: 4, steps: [
            { index: 1, at: .5, duration: 1, notes: [{ ratio: 1.5, velocity: .8, gate: 1 }] },
          ] }),
          rootFrequency: 220, tempo: 120, at: frame / RATE,
          phase, originBeat: phase - .5, playing: true,
          preserveVoices: false, triggerCurrent: true,
        });
      }
      h.send({ type: 'sequence-root', rootFrequency: 330, intent: 3 });
      assert.deepEqual(h.messages.filter(message => message.type === 'sequence-status'), [],
        `${transaction} + root does not publish a partially applied intent`);
      assert.equal(h.processor.sequenceIntent, 1);
      if (transaction === 'swap') {
        h.send({
          type: 'sequence-swap', intent: 4,
          sequence: sequence({ studyId: 'latest', lengthBeats: 4, steps: [
            { index: 2, at: .75, duration: 1, notes: [{ ratio: 2, velocity: .8, gate: 1 }] },
          ] }),
          rootFrequency: 330, tempo: 120, at: (frame + 20) / RATE,
          phase: h.processor.sequenceBeatAt(frame + 20), originBeat: 0,
          playing: true, preserveVoices: true, triggerCurrent: false,
        });
      }
      h.render(384);
      const status = h.messages.filter(message => message.type === 'sequence-status').at(-1);
      assert.equal(status.intent, transaction === 'swap' ? 4 : 3);
      assert.equal(status.rootFrequency, 330);
      if (transaction === 'tempo') assert.equal(status.tempo, 90);
      else assert.equal(status.studyId, 'latest');
    } finally { h.dispose(); }
  }
});

test('Stop followed immediately by resume uses the authoritative stopped worklet beat', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state() });
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4 }), rootFrequency: 220, tempo: 120, intent: 1 });
    h.send({ type: 'sequence-start', phase: 0, originBeat: 0, rootFrequency: 220, tempo: 120, intent: 1 });
    h.render(4096);
    h.send({ type: 'sequence-stop', intent: 2 });
    const authoritativeBeat = h.processor.sequenceAnchorBeat;
    h.send({ type: 'sequence-start', resume: true, at: (h.frame + 240) / RATE,
      tempo: 120, rootFrequency: 220, originBeat: 999, intent: 3 });
    assert.equal(h.processor.sequenceAnchorBeat, authoritativeBeat);
    assert.equal(h.processor.sequenceAnchorFrame, h.frame + 240);
    assert.equal(h.processor.sequenceOriginBeat, 0, 'resume ignores a stale main-thread origin');
    h.send({ type: 'sequence-stop', intent: 4 });
    h.send({ type: 'sequence-start', phase: 0, at: (h.frame + 240) / RATE,
      tempo: 120, rootFrequency: 220, intent: 5 });
    assert.equal(h.processor.sequenceAnchorBeat, 0, 'explicit phase remains an intentional restart');
  } finally { h.dispose(); }
});

test('commands before a future Start neither rewind its beat nor pull its attack early', () => {
  for (const command of ['stop', 'root', 'reset']) {
    const h = makeHarness();
    try {
      h.send({ type: 'state', state: state() });
      h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4, steps: [
        { index: 0, at: 0, duration: 1, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
      ] }), rootFrequency: 220, tempo: 120, intent: 1 });
      const api = h.processor.api, attacks = [];
      h.processor.api = {
        ...api,
        synth_note_on(...args) { attacks.push(args.at(-2)); return api.synth_note_on(...args); },
      };
      h.send({ type: 'sequence-start', phase: 0, originBeat: 0, at: 240 / RATE,
        rootFrequency: 220, tempo: 120, intent: 2 });
      if (command === 'stop') {
        h.send({ type: 'sequence-stop', intent: 3 });
        assert.equal(h.processor.sequenceAnchorBeat, 0, 'Stop freezes phase zero, never a negative pre-roll');
        assert.equal(h.processor.sequencePlaying, false);
        continue;
      }
      if (command === 'root') {
        h.send({ type: 'sequence-root', rootFrequency: 330, intent: 3 });
        const status = h.messages.filter(message => message.type === 'sequence-status').at(-1);
        assert.equal(status.beat, 0);
        assert.equal(status.at, 240 / RATE, 'the held beat is paired with its future anchor time');
      } else {
        h.send({ type: 'reset', intent: 3 });
        assert.equal(h.processor.sequenceAnchorFrame, 240);
      }
      assert.ok(h.render(240).every(value => value === 0), `${command} cannot pull Start before frame 240`);
      const onset = h.render(128);
      assert.deepEqual(attacks, [command === 'root' ? 330 : 220]);
      assert.ok(rms(onset) > .0001);
    } finally { h.dispose(); }
  }
});

test('rapid score swaps coalesce the latest score and state with sticky immediate-onset intent', () => {
  const h = makeHarness();
  try {
    const initial = sequence({ lengthBeats: 4, steps: [
      { index: 0, at: 0, duration: 4, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
    ] });
    h.send({ type: 'state', state: state({ engineId: 2 }) });
    h.send({ type: 'sequence-load', sequence: initial, rootFrequency: 220, tempo: 120, intent: 1 });
    h.send({ type: 'sequence-start', phase: 0, originBeat: 0, rootFrequency: 220, tempo: 120, intent: 1 });
    h.render(4096);
    const firstFrame = h.frame + 47, secondFrame = h.frame + 71;
    const firstPhase = h.processor.sequenceBeatAt(firstFrame);
    const secondPhase = h.processor.sequenceBeatAt(secondFrame);
    const targetState = state({ engineId: 17 });
    const calls = [], api = h.processor.api;
    h.processor.api = {
      ...api,
      synth_note_on(...args) { calls.push(args.at(-2)); return api.synth_note_on(...args); },
    };
    h.send({
      type: 'sequence-swap', intent: 2,
      sequence: sequence({ studyId: 'superseded', lengthBeats: 4, steps: [
        { index: 1, at: .25, duration: 1, notes: [{ ratio: 3, velocity: .8, gate: 1 }] },
      ] }),
      state: targetState, rootFrequency: 220, tempo: 120,
      at: firstFrame / RATE, phase: firstPhase, originBeat: firstPhase - .25,
      playing: true, preserveVoices: false, triggerCurrent: true,
    });
    h.send({
      type: 'sequence-swap', intent: 3,
      sequence: sequence({ studyId: 'latest', lengthBeats: 4, steps: [
        { index: 2, at: .75, duration: 1, notes: [{ ratio: 1.5, velocity: .8, gate: 1 }] },
      ] }),
      rootFrequency: 220, tempo: 120,
      at: secondFrame / RATE, phase: secondPhase, originBeat: 0,
      playing: true, preserveVoices: true, triggerCurrent: false,
    });

    assert.equal(h.processor.pendingSequenceSwap.frame, firstFrame, 'a later edit cannot postpone an armed boundary');
    assert.equal(h.processor.pendingSequenceSwap.sequence.studyId, 'latest');
    assert.equal(h.processor.pendingSequenceSwap.state, targetState, 'the uncommitted sound intent is retained');
    assert.equal(h.processor.pendingSequenceSwap.triggerCurrent, true, 'restart intent remains sticky');
    assert.equal(h.processor.pendingSequenceSwap.preserveVoices, false);
    assert.ok(Math.abs(h.processor.pendingSequenceSwap.originBeat - (secondPhase - .75)) < 1e-12,
      'the latest score receives a freshly authored first-attack origin');
    h.render(128);
    assert.equal(h.processor.sequence.studyId, 'latest');
    assert.equal(h.processor.state.engineId, 17);
    assert.equal(h.processor.sequenceIntent, 3);
    assert.deepEqual(calls, [330], 'only the latest score attacks, exactly once');
  } finally { h.dispose(); }
});

test('newer state, root and tempo edits patch an armed swap instead of being reverted by it', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ engineId: 2 }) });
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4, steps: [
      { index: 0, at: 0, duration: 4, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
    ] }), rootFrequency: 220, tempo: 120, intent: 1 });
    h.send({ type: 'sequence-start', phase: 0, originBeat: 0, rootFrequency: 220, tempo: 120, intent: 1 });
    h.render(4096);
    const targetFrame = h.frame + 47;
    const phase = h.processor.sequenceBeatAt(targetFrame);
    h.send({
      type: 'sequence-swap', intent: 2,
      sequence: sequence({ studyId: 'patched', lengthBeats: 4, steps: [
        { index: 4, at: .5, duration: 1, notes: [{ ratio: 2, velocity: .8, gate: 1 }] },
      ] }),
      state: state({ engineId: 17 }), rootFrequency: 330, tempo: 90,
      at: targetFrame / RATE, phase, originBeat: 0,
      playing: true, preserveVoices: true, triggerCurrent: false,
    });
    const latestState = state({ engineId: 3 });
    h.send({ type: 'state', state: latestState });
    h.send({ type: 'sequence-root', rootFrequency: 440, intent: 2 });
    h.send({ type: 'sequence-tempo', tempo: 75, phase, at: targetFrame / RATE, intent: 2 });
    assert.equal(h.processor.pendingSequenceSwap.state, latestState);
    assert.equal(h.processor.pendingSequenceSwap.rootFrequency, 440);
    assert.equal(h.processor.pendingSequenceSwap.tempo, 75);

    h.render(128);
    assert.equal(h.processor.sequence.studyId, 'patched');
    assert.equal(h.processor.state.engineId, 3);
    assert.equal(h.processor.sequenceRootFrequency, 440);
    assert.equal(h.processor.sequenceTempo, 75);
  } finally { h.dispose(); }
});

test('Stop materializes a pending score without attacking it and Start can only revive that score', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ engineId: 2 }) });
    h.send({ type: 'sequence-load', sequence: sequence({ studyId: 'old', lengthBeats: 4, steps: [
      { index: 0, at: 0, duration: 4, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
    ] }), rootFrequency: 220, tempo: 120, intent: 1 });
    h.send({ type: 'sequence-start', phase: 0, originBeat: 0, rootFrequency: 220, tempo: 120, intent: 1 });
    h.render(4096);
    const calls = [], api = h.processor.api;
    h.processor.api = {
      ...api,
      synth_note_on(...args) { calls.push(args.at(-2)); return api.synth_note_on(...args); },
    };
    const targetFrame = h.frame + 240;
    const phase = h.processor.sequenceBeatAt(targetFrame);
    h.send({
      type: 'sequence-swap', intent: 2,
      sequence: sequence({ studyId: 'selected-while-stopping', lengthBeats: 4, steps: [
        { index: 8, at: 1, duration: 1, notes: [{ ratio: 1.5, velocity: .8, gate: 1 }] },
      ] }),
      state: state({ engineId: 17 }), rootFrequency: 220, tempo: 120,
      at: targetFrame / RATE, phase, originBeat: phase - 1,
      playing: true, preserveVoices: false, triggerCurrent: true,
    });
    h.send({ type: 'sequence-stop', intent: 2 });
    assert.equal(h.processor.pendingSequenceSwap, null);
    assert.equal(h.processor.sequence.studyId, 'selected-while-stopping');
    assert.equal(h.processor.state.engineId, 17);
    assert.equal(h.processor.sequencePlaying, false);
    assert.deepEqual(calls, [], 'Stop commits selection metadata without manufacturing an attack');

    h.send({
      type: 'sequence-start', intent: 2, tempo: 120, rootFrequency: 220,
      phase: h.processor.sequenceAnchorBeat, originBeat: h.processor.sequenceOriginBeat,
    });
    h.render(128);
    assert.equal(h.processor.sequence.studyId, 'selected-while-stopping');
    assert.deepEqual(calls, [330], 'replay attacks the selected score, never the superseded score');
  } finally { h.dispose(); }
});

test('Reset materializes pending score metadata and defers its one attack until rendering resumes', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state() });
    h.send({ type: 'sequence-load', sequence: sequence({ studyId: 'old' }), rootFrequency: 220, tempo: 120, intent: 1 });
    h.send({ type: 'sequence-start', phase: 0, originBeat: 0, rootFrequency: 220, tempo: 120, intent: 1 });
    h.render(4096);
    const calls = [], api = h.processor.api;
    h.processor.api = { ...api, synth_note_on(...args) { calls.push(args); return api.synth_note_on(...args); } };
    const targetFrame = h.frame + 240, phase = h.processor.sequenceBeatAt(targetFrame);
    h.send({
      type: 'sequence-swap', intent: 2,
      sequence: sequence({ studyId: 'reset-selection', lengthBeats: 4, steps: [
        { index: 3, at: .75, duration: 1, notes: [{ ratio: 2, velocity: .8, gate: 1 }] },
      ] }),
      rootFrequency: 220, tempo: 120, at: targetFrame / RATE,
      phase, originBeat: phase - .75, playing: true, preserveVoices: false, triggerCurrent: true,
    });
    h.send({ type: 'reset' });
    assert.equal(h.processor.pendingSequenceSwap, null);
    assert.equal(h.processor.sequence.studyId, 'reset-selection');
    assert.equal(h.processor.sequenceIntent, 2);
    assert.deepEqual(calls, []);
    const resumed = h.render(128);
    assert.equal(calls.length, 1, 'the suppressed restart is emitted once after engine reset');
    assert.equal(calls[0].at(-2), 440);
    assert.ok(rms(resumed) > .0001);
  } finally { h.dispose(); }
});

test('a state-bearing immediate swap excites a struck method exactly once through actual WASM', () => {
  const atomic = makeHarness(), reference = makeHarness();
  try {
    const initialScore = sequence({ lengthBeats: 4, steps: [
      { index: 0, at: 0, duration: 4, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
    ] });
    const replacement = sequence({ studyId: 'struck-replacement', lengthBeats: 4, steps: [
      { index: 9, at: 1.25, duration: 1, notes: [{ ratio: 1.5, velocity: .8, gate: 1 }] },
    ] });
    const initial = state({ engineId: 2 });
    for (const h of [atomic, reference]) {
      h.send({ type: 'state', state: initial });
      h.send({ type: 'sequence-load', sequence: initialScore, rootFrequency: 220, tempo: 120 });
      h.send({ type: 'sequence-start', phase: 0, originBeat: 0, rootFrequency: 220, tempo: 120 });
      h.render(4096);
    }
    const target = state({
      engineId: 17,
      frequencyHz: 330,
      playStyle: 'strike',
      envelope: { attack: .001, decay: .04, sustain: 0, release: .03 },
    });
    const api = atomic.processor.api;
    const calls = { on: 0, off: 0 };
    atomic.processor.api = {
      ...api,
      synth_note_on(...args) { calls.on++; return api.synth_note_on(...args); },
      synth_note_off(...args) { calls.off++; return api.synth_note_off(...args); },
    };

    // This reference applies the complete state and one explicit attack before
    // rendering. note_on consumes method_pending, leaving nothing for render to
    // excite a second time.
    reference.send({ type: 'state', state: target });
    reference.processor.api.synth_note_on(reference.processor.engine, 330, .8);
    const beat = atomic.processor.sequenceBeatAt(atomic.frame);
    atomic.send({
      type: 'sequence-swap',
      sequence: replacement,
      state: target,
      rootFrequency: 220,
      tempo: 120,
      at: atomic.time,
      phase: beat,
      originBeat: beat - 1.25,
      playing: true,
      preserveVoices: false,
      triggerCurrent: true,
    });

    const expected = reference.render(8192);
    const actual = atomic.render(8192);
    assert.deepEqual(actual, expected,
      'the atomic state-and-score path is sample-identical to one complete struck-method attack');
    assert.deepEqual(calls, { on: 1, off: 0 },
      'the worklet adds exactly one attack and no intervening release');
    assert.equal(atomic.processor.sequenceMono.frequency, 330);
    assert.equal(atomic.processor.sequenceMono.revision, atomic.processor.sequenceRevision);
    assert.ok(rms(actual.subarray(512, 1536)) > .00001, 'the struck target sounds at the swap boundary');
  } finally { atomic.dispose(); reference.dispose(); }
});

test('method changes retain the active Mono sequence gate and schedule without a duplicate host attack', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ engineId: 2 }) });
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4, steps: [
      { index: 0, at: 0, duration: 4, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
    ] }), rootFrequency: 220, tempo: 120 });
    h.send({ type: 'sequence-start', phase: 0, rootFrequency: 220, tempo: 120 });
    h.render(4096);
    const voice = h.processor.sequenceMono;
    const schedule = sequenceScheduleSnapshot(h.processor);
    const api = h.processor.api;
    const calls = { on: 0, off: 0 };
    h.processor.api = {
      ...api,
      synth_note_on(...args) { calls.on++; return api.synth_note_on(...args); },
      synth_note_off(...args) { calls.off++; return api.synth_note_off(...args); },
    };

    h.send({ type: 'state', state: state({ engineId: 17 }) });
    const changed = h.render(4096);
    assert.equal(h.processor.sequenceMono, voice);
    assert.deepEqual(sequenceScheduleSnapshot(h.processor), schedule);
    assert.deepEqual(calls, { on: 0, off: 0 }, 'the Rust held-gate method transition owns the sole excitation');
    assert.ok(rms(changed.subarray(1024)) > .005, 'the new method sounds without waiting for the next sequence step');
  } finally { h.dispose(); }
});

test('method changes retain Poly sequence identities, deadlines and schedule', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ engineId: 2, voiceMode: 'poly' }) });
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4, steps: [
      { index: 0, at: 0, duration: 4, notes: [1, 1.5, 2].map(ratio => ({ ratio, velocity: .7, gate: 1 })) },
    ] }), rootFrequency: 110, tempo: 120 });
    h.send({ type: 'sequence-start', phase: 0, rootFrequency: 110, tempo: 120 });
    h.render(4096);
    const owned = h.processor.polyDeadlines.map((note, slot) => note?.kind === 'sequence' ? { slot, note } : null).filter(Boolean);
    const schedule = sequenceScheduleSnapshot(h.processor);
    const api = h.processor.api;
    const calls = { on: 0, off: 0, reset: 0 };
    h.processor.api = {
      ...api,
      poly_note_on(...args) { calls.on++; return api.poly_note_on(...args); },
      poly_note_off(...args) { calls.off++; return api.poly_note_off(...args); },
      poly_reset(...args) { calls.reset++; return api.poly_reset(...args); },
    };

    h.send({ type: 'state', state: state({ engineId: 17, voiceMode: 'poly' }) });
    const changed = h.render(4096);
    assert.deepEqual(sequenceScheduleSnapshot(h.processor), schedule);
    assert.deepEqual(calls, { on: 0, off: 0, reset: 0 });
    for (const { slot, note } of owned) assert.equal(h.processor.polyDeadlines[slot], note);
    assert.ok(rms(changed.subarray(1024)) > .00001,
      'the changed Poly engine sounds without waiting for another chord');
  } finally { h.dispose(); }
});

test('a live cycle replacement keeps phase but cannot leak an attack from the superseded cycle', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ envelope: { attack: .001, decay: .005, sustain: .8, release: .003 } }) });
    h.send({ type: 'sequence-load', sequence: sequence({ tempo: 60, steps: [
      { index: 1, at: .75, duration: .08, notes: [{ ratio: 1, velocity: .8, gate: 1 }] },
    ] }), rootFrequency: 220, tempo: 60 });
    h.send({ type: 'sequence-start', phase: .25, rootFrequency: 220, tempo: 60 });
    h.render(12_000); // phase .5
    h.send({ type: 'sequence-load', sequence: sequence({ tempo: 60, steps: [] }),
      rootFrequency: 220, tempo: 60, preservePhase: true, playing: true });
    assert.ok(Math.abs(h.processor.sequenceAnchorBeat - .5) < 1e-9, 'replacement inherits the live beat');
    assert.equal(rms(h.render(36_000)), 0, 'the deleted .75-beat attack is never delivered');
  } finally { h.dispose(); }
});

test('the worklet bounds hostile cycles independently of the catalog compiler', () => {
  const h = makeHarness();
  try {
    const compiled = compileSequence('three-row-voltage-walk', { steps: 8, tempo: 137, gate: .61 });
    h.send({ type: 'sequence-load', sequence: compiled, rootFrequency: 220, tempo: compiled.tempo });
    assert.equal(h.processor.sequence.steps.length, compiled.steps.length, 'compiler output loads without an adapter');
    assert.deepEqual(
      Array.from(h.processor.sequence.steps, step => step.at),
      compiled.steps.map(step => step.atBeats ?? step.at),
      'compiled beat addresses reach the sample-clock scheduler unchanged',
    );
    const notes = Array.from({ length: 100 }, (_, index) => ({
      ratio: index % 2 ? Infinity : -Infinity, semitone: index % 2 ? 12 : 0,
      velocity: 99, gate: -5, accent: NaN,
    }));
    const steps = Array.from({ length: 1000 }, (_, index) => ({
      index: Infinity, at: index * 1e100, duration: Infinity, notes,
    }));
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 0, steps }),
      rootFrequency: Infinity, tempo: 1e9 });
    assert.equal(h.processor.sequence.steps.length, 64);
    assert.equal(h.processor.sequence.steps.reduce((sum, step) => sum + step.notes.length, 0), 512);
    assert.equal(h.processor.sequence.lengthBeats, .25);
    assert.equal(h.processor.sequenceTempo, 1200);
    assert.equal(h.processor.sequenceRootFrequency, 220);
    for (const step of h.processor.sequence.steps) {
      assert.ok(Number.isFinite(step.at) && step.at >= 0 && step.at < .25);
      assert.ok(Number.isFinite(step.duration));
      for (const note of step.notes) {
        assert.ok([note.semitone, note.ratio, note.velocity, note.gate].every(Number.isFinite));
        assert.ok(note.ratio >= 1 / 256 && note.ratio <= 256);
        assert.equal(typeof note.accent, 'boolean');
        assert.ok(note.velocity >= 0 && note.velocity <= 1);
      }
    }
    h.send({ type: 'state', state: state({ voiceMode: 'poly' }) });
    h.send({ type: 'sequence-start', phase: 0, tempo: Infinity, rootFrequency: Infinity });
    assert.ok(h.render(2048).every(Number.isFinite), 'even the rejected extremes leave finite audio');
  } finally { h.dispose(); }
});

test('sequence ratios take priority while semitone-only events remain backward compatible', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'sequence-load', sequence: sequence({ steps: [{
      index: 0, at: 0, duration: 1,
      notes: [
        { ratio: 1.5, semitone: 12, velocity: .8, gate: 1 },
        { semitone: 12, velocity: .8, gate: 1 },
      ],
    }] }), rootFrequency: 220, tempo: 120 });
    assert.deepEqual(
      Array.from(h.processor.sequence.steps[0].notes, note => note.ratio),
      [1.5, 2],
      'explicit ratios are retained and legacy semitones derive an equal-tempered ratio',
    );
  } finally { h.dispose(); }
});

test('manual Poly notes evict sequence voices first and survive sequence panic', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ voiceMode: 'poly' }) });
    const chord = Array.from({ length: 8 }, (_, index) => ({ ratio: 2 ** (index / 12), velocity: .5, gate: 1 }));
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 4, steps: [
      { index: 0, at: 0, duration: 4, notes: chord },
    ] }), rootFrequency: 110, tempo: 120 });
    h.send({ type: 'sequence-start', phase: 0, rootFrequency: 110, tempo: 120 });
    h.render(128);
    assert.equal(h.processor.polyDeadlines.filter(note => note?.kind === 'sequence').length, 8);
    h.send({ type: 'note', noteId: 99, frequency: 880, velocity: .8, duration: null, at: h.time });
    h.render(128);
    assert.equal(h.processor.polyDeadlines.filter(note => note?.kind === 'sequence').length, 7);
    assert.ok(h.processor.polyDeadlines.some(note => note?.id === 99 && note.kind === 'held'));
    h.send({ type: 'sequence-panic' });
    h.render(24_000);
    assert.deepEqual(heldPolyIds(h), [99], 'panic releases only sequence-owned identities');
    assertPitch(h.render(4800), 880, 'performer note remains after sequence panic');
  } finally { h.dispose(); }
});

test('a held Mono note has priority over sequence attacks and the sequence resumes afterward', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state({ envelope: { attack: .001, decay: .005, sustain: .8, release: .003 } }) });
    h.send({ type: 'sequence-load', sequence: sequence({ lengthBeats: 1, steps: [
      { index: 0, at: 0, duration: 1, notes: [{ ratio: 1, velocity: .7, gate: 1 }] },
      { index: 1, at: .5, duration: 1, notes: [{ ratio: 2 ** (7 / 12), velocity: .7, gate: 1 }] },
    ] }), rootFrequency: 220, tempo: 120 });
    h.send({ type: 'sequence-start', phase: 0, rootFrequency: 220, tempo: 120 });
    h.render(4096);
    h.send({ type: 'note', noteId: 41, frequency: 440, velocity: .8, duration: null, at: h.time });
    h.render(14_000); // crosses the sequence's .5-beat attack while the key is held
    assertPitch(h.render(4096), 440, 'held Mono note across a sequence boundary');
    h.send({ type: 'off', noteId: 41, at: h.time });
    h.render(10_000); // reaches the next cycle's root step
    assertPitch(h.render(4096), 220, 'sequence after the held Mono note is released');
  } finally { h.dispose(); }
});
