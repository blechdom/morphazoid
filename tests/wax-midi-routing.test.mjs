import assert from "node:assert/strict";
import test from "node:test";

import {
  MidiClockTempoTracker,
  PpqMidiOutputScheduler,
  deriveCompanionNote,
  midiNoteToFrequency,
  normalizeWaxRoutingState,
  normalizedControlValue,
} from "../src/wax-midi-routing.js";
import { routeIdForLocation } from "../scripts/wax/wax-universal-adapter.js";
import {
  automationMessageForControl,
  isUniversalMidiControl,
  midiNoteValueForControl,
  pitchBendValueForControl,
  shouldDriveNativeAudio,
  updateSelectOutputs,
} from "../scripts/wax/wax-universal-adapter.js";

const emptyDocument = Object.freeze({ querySelector() { return null; } });

test("MIDI-only routing never drives a page's native audio transport", () => {
  assert.equal(shouldDriveNativeAudio({ outputMode: "midi" }), false);
  assert.equal(shouldDriveNativeAudio({ outputMode: "audio" }), true);
  assert.equal(shouldDriveNativeAudio({ outputMode: "both" }), true);
});

test("artifact routes resolve catalog ids, including aliases and nested pages", () => {
  assert.equal(routeIdForLocation({ pathname: "/dist-wax/chaotic-fm.html" }), "chaotic-fm");
  assert.equal(routeIdForLocation({ pathname: "/dist-wax/l-mic.html" }), "micmic");
  assert.equal(
    routeIdForLocation({ pathname: "/dist-wax/algorithmic-sequencers.html" }),
    "sorting-algorithms",
  );
  assert.equal(routeIdForLocation({ pathname: "/dist-wax/morphazoidical/" }), "morphazoidical");
});

test("WAX routing state is constrained by the wrapper roles", () => {
  assert.deepEqual(normalizeWaxRoutingState({ outputMode: "both", channel: 18 }, {
    roles: ["instrument", "midi-fx"],
  }), {
    outputMode: "both",
    outputId: "",
    channel: 15,
    rootNote: 48,
    division: "1/16",
    gate: 0.72,
    hostSync: true,
  });
  assert.equal(normalizeWaxRoutingState({ outputMode: "midi" }, {
    roles: ["instrument"],
  }).outputMode, "audio");
  assert.equal(normalizeWaxRoutingState({ outputMode: "audio" }, {
    roles: ["midi-fx"],
  }).outputMode, "midi");
  assert.equal(normalizeWaxRoutingState({}, {
    roles: ["instrument", "midi-fx"],
    noteMode: "drums",
    hostSync: true,
  }).channel, 9, "drum companion output defaults to General MIDI channel 10");
  assert.equal(normalizeWaxRoutingState({}, {
    roles: ["instrument"],
    hostSync: false,
  }).hostSync, false);
});

test("automatic MIDI output stays represented as Auto after a port resolves", () => {
  const documentObject = {
    createElement() {
      return { value: "", textContent: "", disabled: false };
    },
  };
  const select = {
    ownerDocument: documentObject,
    options: [],
    value: "",
    replaceChildren() { this.options = []; },
    append(option) { this.options.push(option); },
  };
  updateSelectOutputs(select, {
    outputSelectionId: null,
    selectedOutput: { id: "wax-host" },
    outputs: [{ id: "wax-host", name: "WAX Host" }],
  }, "");
  assert.equal(select.value, "", "resolved auto output must not become an explicit selection");

  updateSelectOutputs(select, {
    outputSelectionId: "wax-host",
    selectedOutput: { id: "wax-host" },
    outputs: [{ id: "wax-host", name: "WAX Host" }],
  }, "wax-host");
  assert.equal(select.value, "wax-host");

  updateSelectOutputs(select, {
    outputSelectionId: null,
    selectedOutput: null,
    outputs: [{ id: "other-port", name: "Other Port" }],
  }, "missing-port");
  assert.equal(select.value, "missing-port", "a disconnected explicit choice must remain visible");
  assert.equal(select.options.at(-1).disabled, true);
});

test("control and note conversion stay finite and within declared ranges", () => {
  assert.equal(Math.round(midiNoteToFrequency(69)), 440);
  assert.equal(normalizedControlValue(0.5, { min: 20, max: 200, step: 5 }), 110);
  assert.equal(normalizedControlValue(2, { min: 0, max: 1, step: 0.01 }), 1);
  assert.equal(deriveCompanionNote({ step: 0, rootNote: 48 }), 48);
  assert.equal(deriveCompanionNote({ step: 0, rootNote: 36, noteMode: "drums" }), 36);
});

test("generic control guards cannot map a macro onto navigation or MIDI profile selects", () => {
  const globalSelect = {
    id: "midiProfileSelect",
    tagName: "SELECT",
    disabled: false,
    closest(selector) {
      if (selector === ".wax-midi-panel") return null;
      return selector.includes("header") ? {} : null;
    },
    matches: () => true,
  };
  const instrumentRange = {
    id: "depth",
    tagName: "INPUT",
    disabled: false,
    closest: () => null,
    matches: () => true,
  };
  assert.equal(isUniversalMidiControl(globalSelect), false);
  assert.equal(isUniversalMidiControl(instrumentRange), true);
});

test("user automation maps semantic controls without substring false positives", () => {
  assert.deepEqual(automationMessageForControl({
    id: "outputLevel",
    tagName: "INPUT",
    min: "0",
    max: "1",
    value: "0.5",
    getAttribute() { return null; },
  }, 0, emptyDocument, 2), [0xb2, 7, 64]);
  assert.deepEqual(automationMessageForControl({
    id: "pitchSpan",
    tagName: "INPUT",
    min: "0",
    max: "12",
    value: "6",
    getAttribute() { return null; },
  }, 0, emptyDocument, 0), [0xb0, 14, 64], "span must not be mistaken for pan");
  const first = { value: "a" };
  assert.deepEqual(automationMessageForControl({
    id: "preset",
    tagName: "SELECT",
    options: [first, { value: "b" }],
    selectedOptions: [first],
    selectedIndex: 0,
    getAttribute() { return null; },
  }, 5, emptyDocument, 3), [0xc3, 0]);
});

test("MIDI note mapping distinguishes note numbers, hertz, and normalized controls", () => {
  assert.equal(midiNoteValueForControl({ min: "24", max: "84", step: "1", id: "rootNote" }, 60), 60);
  assert.equal(Math.round(midiNoteValueForControl({ min: "20", max: "2000", step: "1", id: "frequency" }, 69)), 440);
  assert.equal(
    midiNoteValueForControl({ min: "0", max: "1", step: "0.0001", id: "carrier" }, 66),
    0.5,
  );
  assert.equal(midiNoteValueForControl({ min: "-24", max: "24", step: "1", id: "pitch" }, 67), 7);
});

test("pitch bend is absolute around an unbent base and center restores it", () => {
  const noteControl = { min: "24", max: "84", id: "rootNote" };
  assert.equal(pitchBendValueForControl(noteControl, 60, 1), 62);
  assert.equal(pitchBendValueForControl(noteControl, 60, -1), 58);
  assert.equal(pitchBendValueForControl(noteControl, 60, 0), 60);
  const frequencyControl = { min: "20", max: "2000", id: "frequency" };
  assert.ok(Math.abs(pitchBendValueForControl(frequencyControl, 440, 1) - 493.883) < 0.01);
  assert.equal(pitchBendValueForControl(frequencyControl, 440, 0), 440);
  assert.equal(pitchBendValueForControl({ min: "-24", max: "24", id: "pitch" }, 7, -1), 5);
});

test("MIDI Clock derives tempo after enough 24 PPQN samples and resets gaps", () => {
  const tracker = new MidiClockTempoTracker();
  let bpm = null;
  const pulseMs = 60_000 / (120 * 24);
  for (let pulse = 0; pulse < 25; pulse += 1) bpm = tracker.ingest(pulse * pulseMs);
  assert.ok(Math.abs(bpm - 120) < 0.001);
  assert.equal(tracker.ingest(5000), null);
});

test("PPQ scheduler sends timestamped note pairs once and panics on stop or seek", () => {
  const sent = [];
  const panics = [];
  let now = 1000;
  const scheduler = new PpqMidiOutputScheduler({
    send: (bytes, timestamp) => sent.push({ bytes: [...bytes], timestamp }),
    clear: () => panics.push("clear"),
    panic: (reason, channel) => panics.push([reason, channel]),
    now: () => now,
    horizonMs: 20,
  });
  scheduler.configure({
    outputMode: "midi",
    channel: 2,
    rootNote: 60,
    division: "1/16",
    gate: 0.5,
  }, {
    id: "test-sequence",
    roles: ["instrument", "midi-fx"],
    noteMode: "melodic",
  });
  scheduler.setEnabled(true);

  const first = scheduler.update({ isPlaying: true, ppqPosition: 0, bpm: 120 });
  assert.equal(first.length, 1);
  assert.deepEqual(sent[0].bytes.slice(0, 2), [0x92, first[0].note]);
  assert.deepEqual(sent[1].bytes, [0x82, first[0].note, 0]);
  assert.equal(sent[0].timestamp, 1000);
  assert.equal(sent[1].timestamp, 1062.5);

  scheduler.update({ isPlaying: true, ppqPosition: 0.05, bpm: 120 });
  assert.equal(sent.length, 2, "the same quantized step must not be scheduled twice");

  now = 1100;
  scheduler.update({ isPlaying: true, ppqPosition: 0.25, bpm: 120 });
  assert.equal(sent.length, 4);
  scheduler.update({ isPlaying: true, ppqPosition: 0.01, bpm: 120 });
  assert.deepEqual(panics.slice(0, 2), ["clear", ["transport-seek", 2]]);
  scheduler.update({ isPlaying: false, ppqPosition: 0.02, bpm: 120 });
  assert.deepEqual(panics.slice(-2), ["clear", ["transport-stop", 2]]);
});

test("PPQ scheduler skips missed steps and resets immediately when division changes", () => {
  const sent = [];
  const panics = [];
  let now = 0;
  const scheduler = new PpqMidiOutputScheduler({
    send: (bytes, timestamp) => sent.push({ bytes: [...bytes], timestamp }),
    panic: (reason) => panics.push(reason),
    now: () => now,
    horizonMs: 20,
  });
  const support = {
    id: "clock-test",
    roles: ["instrument", "midi-fx"],
    noteMode: "melodic",
    hostSync: true,
  };
  scheduler.configure({ outputMode: "midi", division: "1/16", hostSync: true }, support);
  scheduler.setEnabled(true);
  scheduler.update({ isPlaying: true, ppqPosition: 0, bpm: 120 });
  assert.equal(sent.length, 2);

  now = 600;
  scheduler.update({ isPlaying: true, ppqPosition: 1.2, bpm: 120 });
  assert.equal(sent.length, 4, "a stalled callback emits only the current step, not all missed steps");
  assert.ok(panics.includes("transport-seek"));

  scheduler.configure({ outputMode: "midi", division: "1/4", hostSync: true }, support);
  assert.ok(panics.includes("division-change"));
  now = 700;
  const resumed = scheduler.update({ isPlaying: true, ppqPosition: 1.25, bpm: 120 });
  assert.equal(resumed.length, 1, "the new division resumes at the current transport position");
});
