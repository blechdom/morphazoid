import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import vm from "node:vm";
import { sanitizeState, SYNTHESIS_METHODS } from "../src/instruments/synthesis/catalog.js";

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
