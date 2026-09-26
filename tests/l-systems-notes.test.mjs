import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { amplitudeEnvelopePreset, percussionEnvelopeTimeMs } from "../src/audio.js";
import { lSystemTraversalBoundaryGain, traceLSystem } from "../src/instruments/l-system/l-system.js";
import { lSystemDrumTraversalStepSize } from "../src/instruments/l-system-drum-machine/l-system-drum-machine.js";
import { LSystemEventClock, lSystemNoteDuration, lSystemNoteEnvelope, lSystemNoteVoice } from "../src/instruments/l-systems/discrete-audio.js";

const state = { speed: 0.5, direction: 1, traversalBehavior: "loop", drums: { subdivisions: 4 }, synth: { pitchSource: "angle", baseFrequency: 220, pitchRange: 2, depthAmount: 0.65, soundMode: "sine", modulationIndex: 3, stereoSpread: 0.9 } };
const traces = [traceLSystem({ axiom: "F[+F][-F]F", angle: 45 }), traceLSystem({ axiom: "FF[+F][-F]F", angle: 45 })].map((trace, index) => ({ ...trace, iteration: index + 1 }));
function clock(options = {}) {
  const settings = { traces, position: 0, direction: 1, rate: 0.5, behavior: "loop", structureMode: "final", subdivisions: 4, mappingMode: "branch-depth-turn", now: 0, ...options };
  return new LSystemEventClock({ ...settings, maxPhaseStep: lSystemDrumTraversalStepSize(settings.traces, settings.subdivisions, settings.structureMode) });
}
function cycle(c, seconds = 2) {
  const entries = [];
  for (let now = 0; now < seconds - 0.085; now += 0.025) entries.push(...c.read(now));
  return entries;
}

test("Notes first subdivision is a complete attack, not the old continuous boundary fade", () => {
  const event = { key: "first", cumulativeTurn: 0, depth: 1, maxForkDepth: 2, powerShare: 0.5, normalizedX: 0, subdivisionIndex: 0, subdivisions: 4 };
  const first = lSystemNoteVoice(event, 2, state);
  const next = lSystemNoteVoice({ ...event, subdivisionIndex: 1 }, 2, state);
  assert.equal(lSystemTraversalBoundaryGain(0, "loop"), 0, "the old multiplication muted every subdivision-zero event");
  assert.equal(first.gain, next.gain);
  assert.ok(first.gain > 0.1);
  assert.equal(first.pan, -0.9, "the leftmost position is not mistaken for missing data");
});

for (const subdivisions of Array.from({ length: 16 }, (_, i) => i + 1)) test(`subdivisions ${subdivisions}: every trunk marker including zero is admitted once`, () => {
  const entries = cycle(clock({ traces: [{ ...traceLSystem({ axiom: "F" }), iteration: 1 }], subdivisions }));
  assert.deepEqual(entries.map(({ event }) => event.subdivisionIndex), Array.from({ length: subdivisions }, (_, i) => i));
  assert.equal(entries[0].startAt, 0.012);
  for (let i = 1; i < entries.length; i++) assert.ok(entries[i].startAt > entries[i - 1].startAt);
});

for (const structureMode of ["final", "sequence", "accumulate", "together", "canon"]) {
  for (const direction of [1, -1]) test(`${structureMode}/${direction}: Notes and Triggers share the same ordered audio-clock events`, () => {
    const options = { structureMode, direction, position: direction > 0 ? 0 : 1 - 1e-9 };
    const notes = cycle(clock(options));
    const triggers = cycle(clock(options));
    assert.deepEqual(notes, triggers);
    assert.ok(notes.some(entry => entry.event.subdivisionIndex === 0));
    assert.ok(notes.every(entry => Number.isFinite(entry.startAt) && entry.eventCount > 0));
    for (let i = 1; i < notes.length; i++) assert.ok(notes[i].startAt >= notes[i - 1].startAt - 1e-8);
  });
}

test("both ping-pong turns and loop wraps keep clocks monotonic without repeated sample keys", () => {
  for (const behavior of ["loop", "ping-pong"]) {
    const entries = cycle(clock({ behavior, rate: 1 }), 4);
    assert.ok(entries.length > 12);
    for (let i = 1; i < entries.length; i++) {
      assert.ok(entries[i].startAt >= entries[i - 1].startAt - 1e-8);
      assert.notEqual(`${entries[i].startAt}:${entries[i].event.key}`, `${entries[i - 1].startAt}:${entries[i - 1].event.key}`);
    }
  }
});

test("a stalled scheduler skips stale attacks and rejoins the current phase", () => {
  const c = clock(); c.read(0);
  const after = c.read(0.95);
  assert.ok(after.every(entry => entry.startAt >= 0.962));
  assert.deepEqual(c.positionAt(1.012), { position: 0.5, direction: 1 });
  assert.ok(after.length <= 16);
});

test("dense subdivisions have bounded starts, chords and tails instead of native node bursts", () => {
  const dense = traceLSystem({ axiom: "F", rules: { F: "F[+F][-F]" }, iterations: 6 });
  const entries = cycle(clock({ traces: [dense], subdivisions: 16, rate: 3 }), 2);
  assert.ok(entries.length > 30);
  assert.ok(entries.length <= 16 + 2 * 128);
  const times = new Map();
  for (const entry of entries) times.set(entry.startAt, (times.get(entry.startAt) ?? 0) + 1);
  assert.ok([...times.values()].every(count => count <= 8));
});

test("all amplitude presets yield smooth full envelopes and preserve branch-onset level", () => {
  for (const preset of ["pluck", "note", "sustain", "pad"]) {
    for (const count of [1, 8, 1000]) {
      const duration = lSystemNoteDuration({ ...state, speed: 3, drums: { subdivisions: 16 } }, count);
      const points = lSystemNoteEnvelope(duration, { enabled: true, points: amplitudeEnvelopePreset(preset) });
      const times = points.map(point => percussionEnvelopeTimeMs(point.x) / 1000);
      assert.ok(times[1] >= 0.008 - 1e-8);
      assert.ok(times[4] - times[3] >= 0.02 - 1e-8);
      assert.equal(points[0].y, 0); assert.equal(points[4].y, 0);
      assert.ok(times.every((time, index) => index === 0 || time >= times[index - 1]));
    }
  }
});

test("the subdivision slider is shared near Speed and never inside the hidden Triggers bank", () => {
  const html = readFileSync(new URL("../l-systems.html", import.meta.url), "utf8");
  assert.match(html, /id="speed"[\s\S]*id="subdivisions"[^>]*min="1" max="16" step="1"[\s\S]*id="systemRackTitle"/);
  assert.equal(html.match(/id="subdivisions"/g).length, 1);
  assert.doesNotMatch(html.slice(html.indexOf('id="drumsBank"')), /id="subdivisions"/);
});

// Render the real worklet, not a substitute oscillator. This is mechanical
// waveform evidence; it is not a human listening or real-phone acceptance.
let Processor;
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = (_, constructor) => { Processor = constructor; };
await import("../src/contour-synth-processor.js?l-systems-notes-test");
for (const mode of ["sine", "fm", "pm", "shepard"]) test(`${mode}: dense full notes render finite, bounded output and finish their tails`, () => {
  const processor = new Processor({ processorOptions: { maxVoices: 128 } });
  const settings = { ...state, synth: { ...state.synth, soundMode: mode }, speed: 2, drums: { subdivisions: 16 } };
  const entries = cycle(clock({ rate: 2, subdivisions: 16 }), 1);
  for (const entry of entries) {
    processor.port.onmessage({ data: { type: "notes", voices: [lSystemNoteVoice(entry.event, entry.eventCount, settings)], startAt: entry.startAt, voiceLimit: 128,
      envelope: lSystemNoteEnvelope(lSystemNoteDuration(settings, entry.eventCount)).map(point => ({ time: percussionEnvelopeTimeMs(point.x) / 1000, level: point.y })) } });
  }
  let peak = 0, energy = 0, lastPeak = 0, maxDelta = 0, previous = 0;
  for (let block = 0; block < 800; block++) {
    const left = new Float32Array(128), right = new Float32Array(128);
    processor.process([], [[left, right]]);
    for (const sample of left) { assert.ok(Number.isFinite(sample)); peak = Math.max(peak, Math.abs(sample)); energy += sample ** 2; maxDelta = Math.max(maxDelta, Math.abs(sample - previous)); previous = sample; }
    if (block > 780) lastPeak = Math.max(lastPeak, ...left.map(Math.abs));
    assert.ok(processor.voices.size <= 128);
  }
  assert.ok(peak < 0.98); assert.ok(energy > 0.01); assert.ok(lastPeak < 1e-5);
  if (mode === "sine") assert.ok(maxDelta < 0.08, `unexpected sine transient: ${maxDelta}`);
});

test("rapid control changes share a start budget instead of refreshing the burst allowance", () => {
  const dense = traceLSystem({ axiom: "F", rules: { F: "F[+F][-F]" }, iterations: 5 });
  let budget, total = 0;
  for (let i = 0; i < 20; i++) {
    const c = clock({ traces: [dense], rate: 3, subdivisions: 16, budget });
    total += c.read(0).length;
    budget = c.budget;
  }
  assert.ok(total <= 16 + 128 * 0.085, `${total} notes bypassed the shared start budget`);
});

test("unchanged live configuration preserves the exact event timeline and frontier", () => {
  const reference = clock(), edited = clock();
  for (let now = 0; now < 3; now += 0.025) {
    for (let step = 0; step < 10; step++) edited.configure({ traces, rate: 0.5, structureMode: "final", subdivisions: 4 });
    assert.deepEqual(edited.read(now), reference.read(now));
    assert.deepEqual(edited.positionAt(now), reference.positionAt(now));
  }
});

test("speed changes join the next unscheduled window without moving already scheduled audio", () => {
  const c = clock();
  c.read(0);
  const boundary = c.until, atBoundary = c.positionAt(boundary), audible = c.positionAt(0.06);
  const budget = c.budget;
  for (const rate of [0.1, 3, 0.8, 2]) c.configure({ rate });
  assert.equal(c.until, boundary);
  assert.equal(c.rate, 0.5);
  c.read(0.025);
  assert.equal(c.rate, 2);
  assert.equal(c.budget, budget);
  assert.deepEqual(c.positionAt(0.06), audible);
  assert.deepEqual(c.positionAt(boundary), atBoundary);
  assert.ok(Math.abs(c.positionAt(boundary + 0.02).position - atBoundary.position - 0.04) < 1e-10);
});

test("rapid timing and topology edits keep advancing with bounded motion history and start budget", () => {
  const c = clock({ subdivisions: 8, rate: 1 });
  const budget = c.budget;
  const events = [];
  for (let step = 0; step < 500; step++) {
    const now = step * 0.025;
    c.configure({ rate: 0.9 + 0.2 * Math.sin(step / 15), subdivisions: 6 + step % 4 });
    const entries = c.read(now);
    events.push(...entries);
    assert.ok(c.until > now);
    assert.ok(c.motion.length <= 6, "history is bounded to the current audio and lookahead, not every slider event");
    assert.equal(c.budget, budget);
    assert.ok(entries.every(entry => entry.startAt >= now));
  }
  assert.ok(events.length > 100, "events must continue while edits are still arriving");
  assert.ok(events.length <= 16 + 128 * 12.6);
  for (let i = 1; i < events.length; i++) assert.ok(events[i].startAt >= events[i - 1].startAt - 1e-8);
});

test("changing iterations and mapping updates the existing clock at the committed frontier", () => {
  const c = clock({ rate: 1 }); c.read(0);
  const previousUntil = c.until;
  c.configure({ traces: [traces[0]], structureMode: "together", subdivisions: 8, mappingMode: "position-grid" });
  const events = c.read(0.025);
  assert.equal(c.traces.length, 1);
  assert.equal(c.structureMode, "together");
  assert.equal(c.subdivisions, 8);
  assert.equal(c.mappingMode, "position-grid");
  assert.ok(c.until > previousUntil);
  assert.ok(events.every(entry => entry.event.iteration === 1 && entry.startAt >= previousUntil));
});

test("intentional zero speed holds position and resumes without restarting or bursting", () => {
  const c = clock(); c.read(0);
  const stoppedAt = c.until;
  const position = c.positionAt(stoppedAt).position;
  c.configure({ rate: 0 }); c.read(0.025);
  for (let step = 2; step < 20; step++) assert.deepEqual(c.read(step * 0.025), []);
  assert.ok(Math.abs(c.positionAt(0.5).position - position) < 1e-12);
  const resumedAt = c.until;
  c.configure({ rate: 0.5 }); c.read(0.5);
  assert.ok(Math.abs(c.positionAt(resumedAt).position - position) < 1e-12);
  assert.ok(Math.abs(c.positionAt(resumedAt + 0.1).position - position - 0.05) < 1e-12);
});

test("reader seeks join the queue without deleting pending hits or sounding tails", () => {
  const c = clock(); c.read(0);
  const boundary = c.until, before = c.positionAt(boundary - 0.01);
  c.configure({ position: 0.4 });
  const entries = c.read(0.025);
  assert.deepEqual(c.positionAt(boundary - 0.01), before);
  assert.ok(Math.abs(c.positionAt(boundary).position - 0.4) < 1e-12);
  assert.ok(entries.some(entry => Math.abs(entry.startAt - boundary) < 1e-9));
});

test("note/envelope and structural parameter handlers never invalidate the playback clock", () => {
  const app = readFileSync(new URL("../src/instruments/l-systems/l-systems-app.js", import.meta.url), "utf8");
  for (const name of ["bindRange", "bindSelect", "rebuildTrace", "applyMixPreset", "applyPresetDefaults", "setupAmplitude"]) {
    const body = app.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0];
    assert.ok(body, name);
    assert.doesNotMatch(body, /invalidateDiscreteScheduler|cancelScheduled|releaseNotes|silence\(/, name);
  }
});
