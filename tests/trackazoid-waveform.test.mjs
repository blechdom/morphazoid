import test from "node:test";
import assert from "node:assert/strict";
import { peakEnvelope, beatLoop, syncTarget, formatTime, snapTime, selectionRange, WaveformView } from "../src/instruments/trackazoid/waveform.js";

const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
const phase = (position, bpm, offset) => (((position - offset) * bpm / 60) % 1 + 1) % 1;
function nearPhase(actual, expected) {
  const distance = Math.abs(actual - expected);
  assert.ok(Math.min(distance, 1 - distance) < 1e-8, `Beat phase ${actual} matches ${expected}`);
}

test("waveform envelopes preserve stereo polarity and transients in every uneven bin", () => {
  const left = Float32Array.from([0, 0.25, 0, -0.75, 0, 0, 0.5]);
  const right = Float32Array.from([0, -0.25, 1, 0, -1, 0, 0]);
  assert.deepEqual([...peakEnvelope([left, right], 3)], [-0.25, 0.25, -0.75, 1, -1, 0.5]);
  assert.deepEqual([...peakEnvelope([left, right], 1)], [-1, 1]);
  assert.equal(peakEnvelope([left, right], 10000).length, 14, "Small buffers cannot allocate more bins than samples");
});

test("waveform envelopes stay finite for bad samples and empty or silent tracks", () => {
  assert.deepEqual([...peakEnvelope([Float32Array.from([NaN, Infinity, -Infinity, 0.5])], 2)], [0, 0, 0, 0.5]);
  assert.deepEqual([...peakEnvelope([], 4)], []);
  assert.deepEqual([...peakEnvelope([new Float32Array(5)], 2)], [0, 0, 0, 0]);
  assert.equal(peakEnvelope([new Float32Array(5)], 0).length, 2);
});

test("beat loops use the manual downbeat and selected beat count", () => {
  const loop = beatLoop(2.2, 120, 0.125, 4, 60);
  near(loop.start, 2.125); near(loop.end, 4.125);
  const fast = beatLoop(3.75, 240, 0, 8, 60);
  near(fast.start, 3.75); near(fast.end, 5.75);
  const slow = beatLoop(4.6, 40, 0.125, 2, 60);
  near(slow.start, 3.125); near(slow.end, 6.125);
  const fallback = beatLoop(2, NaN, 0, 99, 60);
  near(fallback.start, 2); near(fallback.end, 4);
});

test("beat loops respect file boundaries and the engine’s 50 ms minimum", () => {
  assert.equal(beatLoop(0, 120, 0, 4, 0), null);
  assert.equal(beatLoop(0, 120, 0, 4, 0.049), null);
  assert.deepEqual(beatLoop(0, 120, 0, 4, 0.05), { start: 0, end: 0.05 });
  assert.equal(beatLoop(2.01, 120, 0, 4, 2.049), null);
  assert.equal(beatLoop(30, 120, 0, 4, 30), null);
  const clipped = beatLoop(27.7, 120, 0, 16, 30);
  assert.deepEqual(clipped, { start: 27.5, end: 30 });
  const beforeDownbeat = beatLoop(0.01, 120, 0.125, 1, 30);
  assert.ok(beforeDownbeat.start >= 0 && beforeDownbeat.end <= 30);
  near(beatLoop(2 - 1e-8, 120, 0, 1, 30).start, 2, 1e-12);
});

test("sync matches effective tempo and beat phase across source BPMs and manual offsets", () => {
  const scenarios = [
    { bpm: 120, offset: 0, otherBpm: 126, otherOffset: 0.12, otherRate: 0.98 },
    { bpm: 83.5, offset: 0.375, otherBpm: 89.2, otherOffset: 2.21, otherRate: 0.94 },
    { bpm: 175, offset: 4.2, otherBpm: 158, otherOffset: 0, otherRate: 1.05 },
    { bpm: 65, offset: 0.16, otherBpm: 70, otherOffset: 6.5, otherRate: 1 },
  ];
  for (const options of scenarios) for (const position of [0, 0.01, 1.125, 17.33, 120]) {
    const otherPosition = 13.37;
    const target = syncTarget({ ...options, position, otherPosition });
    assert.ok(target && target.position >= 0);
    near(options.bpm * target.rate, options.otherBpm * options.otherRate, 1e-10);
    nearPhase(phase(target.position, options.bpm, options.offset), phase(otherPosition, options.otherBpm, options.otherOffset));
    // The selected phase-aligned location should be the closest valid beat.
    const beat = 60 / options.bpm;
    for (const alternate of [target.position - beat, target.position + beat]) {
      if (alternate >= 0) assert.ok(Math.abs(target.position - position) <= Math.abs(alternate - position) + 1e-10);
    }
  }
});

test("sync at the start advances to a matching phase instead of clamping an invalid negative target", () => {
  const target = syncTarget({ position: 0, bpm: 120, otherPosition: 0.4, otherBpm: 120, otherRate: 1 });
  near(target.position, 0.4);
  near(target.rate, 1);
});

test("sync near the end chooses a phase-aligned point within the track or reports no usable point", () => {
  const options = { position: 2.05, duration: 2.05, bpm: 120, otherPosition: 0.4, otherBpm: 120, otherRate: 1 };
  const target = syncTarget(options);
  near(target.position, 1.9);
  assert.ok(target.position <= options.duration);
  nearPhase(phase(target.position, 120, 0), phase(0.4, 120, 0));
  assert.equal(syncTarget({ ...options, position: 0.2, duration: 0.3 }), null);
  near(syncTarget({ ...options, position: 0.2, duration: 0.4 }).position, 0.4);
});

test("sync admits exactly ±16 percent and rejects tempos beyond the deck range", () => {
  const options = { position: 2, bpm: 120, otherPosition: 3, otherBpm: 120, otherRate: 1 };
  near(syncTarget({ ...options, otherRate: 0.84 }).rate, 0.84);
  near(syncTarget({ ...options, otherRate: 1.16 }).rate, 1.16);
  for (const otherRate of [0.839, 1.161, 0, -1, NaN, Infinity]) assert.equal(syncTarget({ ...options, otherRate }), null);
  assert.equal(syncTarget({ ...options, bpm: 0 }), null);
  assert.equal(syncTarget({ ...options, otherBpm: 180 }), null);
});

test("track time readouts keep elapsed minutes and tenths at useful boundaries", () => {
  assert.equal(formatTime(-1), "00:00.0");
  assert.equal(formatTime(0), "00:00.0");
  assert.equal(formatTime(61.25), "01:01.2");
  assert.equal(formatTime(3600), "60:00.0");
});

function waveform(initial = {}) {
  const state = { duration: 60, position: 0, bpm: 120, beatOffset: 0, gridReady: true, snap: true,
    cues: [null, null, null, null], loop: null, selection: null, ...initial };
  const calls = { seek: [], selection: [], cue: [], mark: [], loop: [], view: [], error: [] };
  class Surface extends EventTarget {
    capture = null;
    drawing = [];
    getBoundingClientRect() { return { left: 10, top: 20, width: 800, height: this === overview ? 40 : 160 }; }
    focus() {}
    setPointerCapture(id) { this.capture = id; }
    hasPointerCapture(id) { return this.capture === id; }
    releasePointerCapture(id) { if (this.capture === id) this.capture = null; }
    setAttribute() {}
    getContext() { return new Proxy({}, { get: (_, method) => (...args) => { this.drawing.push([method, ...args]); }, set: () => true }); }
  }
  const canvas = new Surface(), overview = new Surface();
  const view = new WaveformView(canvas, overview, {
    color: "#f88", getState: () => state,
    seek: (time) => { calls.seek.push(time); state.position = time; },
    selectRange: (range) => { calls.selection.push(range); state.selection = range; },
    changeCue: (index, time) => { calls.cue.push([index, time]); state.cues[index] = time; },
    mark: (time) => calls.mark.push(time), changeLoop: (start, end) => { calls.loop.push([start, end]); state.loop = { start, end }; },
    onViewChange: (value) => calls.view.push(value), onError: (error) => calls.error.push(error),
  });
  function event(type, x, { surface = canvas, ...options } = {}) {
    const value = new Event(type, { cancelable: true });
    Object.assign(value, { clientX: 10 + x, clientY: 80, pointerId: 1, button: 0, shiftKey: false, altKey: false, detail: 1, ...options });
    surface.dispatchEvent(value); return value;
  }
  function drag(from, to, options = {}) {
    event("pointerdown", from, options); event("pointermove", to, options); event("pointerup", to, options);
  }
  return { view, state, calls, canvas, overview, event, drag };
}

test("selection and cue snapping honor the known grid, Alt, and file boundaries", () => {
  const state = { duration: 10, bpm: 120, beatOffset: 0.125, gridReady: true, snap: true };
  near(snapTime(1.27, state), 1.125);
  near(snapTime(1.27, state, true), 1.27);
  near(snapTime(1.27, { ...state, gridReady: false }), 1.27);
  near(snapTime(1.27, { ...state, snap: false }), 1.27);
  assert.equal(snapTime(-5, state), 0); assert.equal(snapTime(20, state), 10);
  assert.deepEqual(selectionRange(7, 3, 10), { start: 3, end: 7 });
  for (const [anchor, time] of [[0, 0], [10, 10], [0.01, 0.005], [9.99, 10], [-1, -2], [11, 12]]) {
    const range = selectionRange(anchor, time, 10);
    assert.ok(range.start >= 0 && range.end <= 10 && range.end - range.start >= 0.05 - 1e-12);
  }
  assert.equal(selectionRange(0, 0, 0.049), null);
});

test("main click seeks only on release; a reverse drag selects without touching playback or loops", () => {
  const { view, state, calls, event, drag } = waveform();
  event("pointerdown", 150); assert.deepEqual(calls.seek, []);
  event("pointerup", 150); assert.deepEqual(calls.seek, [1.5]);
  calls.seek.length = 0;
  event("pointerdown", 500); event("pointermove", 100);
  assert.equal(state.selection, null, "Selection is a local preview until release");
  assert.deepEqual(calls.seek, []);
  event("pointerup", 100);
  assert.deepEqual(state.selection, { start: 1, end: 5 });
  assert.deepEqual(calls.loop, []); assert.equal(state.position, 1.5);
  drag(650, 654); assert.equal(calls.seek.length, 1, "Exactly 4 px remains a click");
  view.destroy();
});

test("range edits snap by default, Alt is precise, and selection handles take precedence over loops", () => {
  const { view, state, calls, drag } = waveform({ loop: { start: 0, end: 6 } });
  drag(123, 327); assert.deepEqual(state.selection, { start: 1, end: 3.5 });
  drag(123, 327, { altKey: true }); near(state.selection.start, 1.23); near(state.selection.end, 3.27);
  drag(123, 221, { altKey: true }); near(state.selection.start, 2.21); near(state.selection.end, 3.27);
  drag(327, 700); assert.deepEqual(state.selection, { start: 2.21, end: 7 });
  assert.deepEqual(calls.loop, []); assert.deepEqual(calls.seek, []);
  drag(221, 790, { altKey: true }); near(state.selection.end - state.selection.start, 0.05);
  state.selection = null;
  drag(600, 450); assert.deepEqual(state.loop, { start: 0, end: 4.5 });
  assert.equal(calls.loop.length, 1); assert.deepEqual(calls.seek, []);
  view.destroy();
});

test("Shift drag pans a frozen viewport without seek; Shift click extends selection from start or playhead", () => {
  const { view, state, calls, event, drag } = waveform({ position: 20 });
  const before = view.getViewport();
  event("pointerdown", 400, { shiftKey: true }); state.position = 22;
  event("pointermove", 200, { shiftKey: true }); event("pointerup", 200, { shiftKey: true });
  near(view.getViewport().start, before.start + 2); assert.equal(view.getViewport().following, false);
  assert.deepEqual(calls.seek, []); assert.deepEqual(calls.selection, []);
  view.fit();
  drag(400, 400, { shiftKey: true }); assert.deepEqual(state.selection, { start: 22, end: 30 });
  state.selection = { start: 22.13, end: 30 };
  drag(500, 500, { shiftKey: true }); assert.deepEqual(state.selection, { start: 22.13, end: 37.5 });
  drag(700, -9000, { shiftKey: true }); assert.equal(view.getViewport().start, 0, "Fit view cannot pan beyond full track");
  assert.deepEqual(calls.seek, []); assert.deepEqual(calls.loop, []);
  view.destroy();
});

test("playback cannot move a selection gesture’s coordinates and cancelled pan restores follow", () => {
  const { view, state, calls, event } = waveform({ position: 20 });
  const before = view.getViewport();
  event("pointerdown", 200); state.position = 35; event("pointermove", 400);
  assert.deepEqual(view.getViewport(), before); view.draw(); event("pointerup", 400);
  assert.deepEqual(state.selection, { start: 19.5, end: 21.5 }); assert.deepEqual(calls.seek, []);
  event("pointerdown", 400, { shiftKey: true }); event("pointermove", 300, { shiftKey: true });
  assert.equal(view.getViewport().following, false); event("pointercancel", 300);
  assert.equal(view.getViewport().following, true); near(view.getViewport().start, 32.6);
  view.destroy();
});

test("view controls follow playhead, clamp zoom and notify; overview keeps navigating after manual pan", () => {
  const { view, state, calls, drag, overview } = waveform({ position: 20 });
  const initial = view.getViewport(); view.zoom(2); near(view.getViewport().span, initial.span / 2);
  view.zoom(0.5); near(view.getViewport().span, initial.span);
  drag(500, 300, { shiftKey: true }); const panned = view.getViewport();
  state.position = 40; assert.deepEqual(view.getViewport(), panned);
  drag(500, 600, { surface: overview }); near(state.position, 45); assert.ok(view.getViewport().start <= 45 && view.getViewport().start + view.getViewport().span >= 45);
  view.follow(); assert.equal(view.getViewport().following, true); near(view.getViewport().start, 42.6);
  state.position = 50; view.draw(); near(view.getViewport().start, 47.6);
  view.fit(); assert.deepEqual(view.getViewport(), { start: 0, span: 60, following: false });
  view.zoom(1e10); near(view.getViewport().span, 0.25);
  view.zoom(1e-10); near(view.getViewport().span, 60);
  view.reset(); assert.deepEqual(view.getViewport(), { start: 47.6, span: 8, following: true });
  assert.ok(calls.view.length >= 8); view.destroy();
});

test("cue flags drag existing cue with snapping or Alt; double-click marks at the clicked timeline", () => {
  const { view, state, calls, event, drag } = waveform({ cues: [2, null, null, null] });
  drag(208, 335, { clientY: 170 }); assert.deepEqual(calls.cue, [[0, 3.5]]);
  assert.deepEqual(calls.seek, []); assert.deepEqual(calls.mark, []);
  drag(358, 481, { clientY: 170, altKey: true }); near(state.cues[0], 4.73);
  event("pointerdown", 600); event("pointerup", 600);
  event("dblclick", 600); assert.deepEqual(calls.mark, [6], "Seek-follow movement cannot relocate the double-click marker");
  view.destroy();
});

test("cancel, lost capture, loading, replacement and disposal never commit stale selection or cue previews", async () => {
  const { view, state, calls, event, canvas } = waveform({ selection: { start: 1, end: 4 }, cues: [2, null] });
  event("pointerdown", 100); event("pointermove", 200); event("pointercancel", 200); event("pointerup", 200);
  assert.deepEqual(state.selection, { start: 1, end: 4 }); assert.deepEqual(calls.selection, []);
  event("pointerdown", 205, { clientY: 170 }); event("pointermove", 305, { clientY: 170 }); event("lostpointercapture", 305);
  assert.equal(state.cues[0], 2); assert.deepEqual(calls.cue, []);
  event("pointerdown", 100); state.loading = true; event("pointerup", 300); state.loading = false;
  assert.deepEqual(calls.selection, []);
  const worker = globalThis.Worker;
  const workers = [];
  globalThis.Worker = class { constructor() { workers.push(this); } terminate() {} postMessage() {} };
  try {
    event("pointerdown", 100); event("pointermove", 250);
    await view.setBuffer({ numberOfChannels: 1, getChannelData: () => new Float32Array(10) });
    event("pointerup", 250); assert.deepEqual(calls.selection, []); assert.equal(canvas.capture, null);
    event("dblclick", 250); assert.deepEqual(calls.mark, [], "Late double-click cannot mark a replacement track");
    const old = workers[0]; await view.setBuffer({ numberOfChannels: 1, getChannelData: () => new Float32Array(10) });
    old.onmessage({ data: { peaks: Float32Array.of(1) } }); assert.equal(view.peaks, null);
    event("pointerdown", 100); event("pointermove", 300); view.destroy(); event("pointerup", 300);
    workers[1].onerror(); assert.deepEqual(calls.selection, []); assert.deepEqual(calls.error, []);
    assert.equal(canvas.capture, null);
  } finally { globalThis.Worker = worker; view.destroy(); }
});

test("gestures ignore other pointers and right buttons; only existing seek keys are handled", () => {
  const { view, calls, event, drag } = waveform();
  drag(100, 300, { button: 2 }); assert.deepEqual(calls.selection, []); assert.deepEqual(calls.seek, []);
  event("pointerdown", 100); event("pointermove", 500, { pointerId: 2 }); event("pointerup", 500, { pointerId: 2 });
  event("pointerup", 100); assert.deepEqual(calls.seek, [1]);
  for (const key of [" ", "l", "i", "o", "m", "Delete"]) assert.equal(event("keydown", 0, { key }).defaultPrevented, false);
  for (const [key, shiftKey, expected] of [["ArrowRight", false, 1.5], ["ArrowLeft", true, 0], ["End", false, 60], ["Home", false, 0]]) {
    assert.equal(event("keydown", 0, { key, shiftKey }).defaultPrevented, true); assert.equal(calls.seek.at(-1), expected);
  }
  view.destroy();
});

test("selection, loop, cue flags and overview viewport render distinctly with bounded beat grid work", () => {
  const { view, canvas, overview } = waveform({ duration: 36000, selection: { start: 1, end: 3 }, loop: { start: 2, end: 4 }, cues: [2] });
  view.draw(); assert.ok(canvas.drawing.some(([method]) => method === "strokeRect"));
  assert.ok(canvas.drawing.some(([method, text]) => method === "fillText" && text === "1"));
  assert.ok(overview.drawing.some(([method]) => method === "strokeRect"));
  view.fit(); canvas.drawing.length = 0; view.draw();
  assert.ok(canvas.drawing.length < 1000, "Full-track view cannot render one line for every beat in hours of audio");
  view.destroy();
});
