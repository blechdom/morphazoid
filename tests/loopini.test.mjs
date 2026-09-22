import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Loopini, LOOPINI_LIMITS, readLoop, makeLoopiniDemo } from "../src/instruments/loopini/loopini.js";
import { instrumentById } from "../src/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/instrument-midi-capabilities.js";
import { readRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";

const rate = 8000;
function run(core, count, amplitude = 0.2) {
  let peak = 0;
  for (let i = 0; i < count; i++) {
    const value = core.tick(Math.sin(i * 2 * Math.PI * 233 / core.rate) * amplitude);
    assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value));
  }
  return peak;
}
function recorded(seconds = 0.6) {
  const core = new Loopini(rate); core.record(0); run(core, rate * seconds); core.finish(); return core;
}

test("first recording defines a sample-exact loop, starts playback and never monitors input", () => {
  const core = new Loopini(rate);
  assert.equal(core.filled(), 0); assert.equal(core.playing, false);
  assert.equal(run(core, rate), 0);
  assert.ok(core.record(0)); assert.equal(core.record(1), false);
  assert.equal(run(core, 5600), 0, "live microphone is never monitored");
  assert.ok(core.finish()); assert.equal(core.length, 5600);
  assert.equal(core.slots[0].samples.length, 5600); assert.equal(core.playing, true);
  assert.ok(run(core, 5600) > 0.01);
  assert.equal(core.phase, 0);
});

test("later takes start at a shared boundary, fill exactly one turn and auto-finish", () => {
  const core = recorded();
  run(core, 911); core.record(1);
  const wait = core.recording.wait;
  run(core, wait);
  assert.equal(core.phase, 0); assert.equal(core.recording.count, 0);
  run(core, core.length - 1); assert.equal(core.recording.count, core.length - 1);
  core.tick(0.2);
  assert.equal(core.recording, null);
  assert.equal(core.phase, 0);
  assert.equal(core.slots[1].samples.length, core.length);
  assert.equal(core.slots[0].samples.length, core.length);
});

test("tiny, silent and cancelled takes do not consume a slot or replace an old loop", () => {
  const core = new Loopini(rate);
  core.record(0); run(core, 100); assert.equal(core.finish(), false);
  assert.equal(core.length, 0); assert.equal(core.filled(), 0);
  core.record(0); run(core, rate, 0); assert.equal(core.finish(), false);
  assert.equal(core.notice, "quiet");
  const old = recorded(); const samples = old.slots[0].samples;
  old.record(0); old.finish();
  assert.equal(old.slots[0].samples, samples);
  old.record(0); run(old, old.recording.wait); run(old, 800); old.cancel();
  assert.equal(old.slots[0].samples, samples);
});

test("record limit, early finish padding and original loop deletion preserve synchronization", () => {
  const core = new Loopini(rate);
  core.record(0); run(core, rate * LOOPINI_LIMITS.maxSeconds);
  assert.equal(core.recording, null); assert.equal(core.length, rate * 12);
  core.record(1); run(core, core.recording.wait);
  run(core, rate); core.finish();
  assert.equal(core.slots[1].samples.length, rate * 12);
  assert.ok(core.slots[1].samples.subarray(rate).every((s) => s === 0));
  core.remove(0);
  assert.equal(core.length, rate * 12, "removing the original does not retime other loops");
  assert.equal(core.filled(), 1);
});

test("Undo restores recording replacement, removal and Start over without requesting input", () => {
  const core = recorded(), old = core.slots[0].samples;
  core.record(0); run(core, core.recording.wait); run(core, core.length, 0.1);
  assert.notEqual(core.slots[0].samples, old); core.undo(); assert.equal(core.slots[0].samples, old);
  core.remove(0); assert.equal(core.length, 0);
  core.undo(); assert.equal(core.slots[0].samples, old); assert.equal(core.length, old.length);
  core.reset(); assert.equal(core.length, 0); core.undo(); assert.equal(core.slots[0].samples, old);
  assert.equal(core.undoState, null); assert.equal(core.recording, null);
});

test("pause/mute release, demo reproducibility and hostile values stay finite and bounded", () => {
  assert.deepEqual(makeLoopiniDemo(rate), makeLoopiniDemo(rate));
  const core = recorded();
  assert.equal(core.record(9), false); assert.equal(core.record(1.2), false);
  assert.ok(run(core, 2000) > 0.01);
  core.toggle(0); run(core, rate);
  assert.ok(run(core, 2000) < 1e-8);
  core.toggle(0); core.setPlaying(false); run(core, rate);
  assert.ok(run(core, 2000) < 1e-8);
  core.setPlaying(true); core.record(1); run(core, core.recording.wait);
  for (let i = 0; i < core.length; i++) assert.ok(Number.isFinite(core.tick(i % 2 ? Infinity : NaN)));
  assert.equal(core.loadDemo(), false, "demo never replaces a child's recordings");
});

test("Loopini integration advertises recording, with no microphone auto-arm or MIDI output", async () => {
  assert.equal(instrumentById("loopini").href, "loopini.html");
  const capability = instrumentMidiCapabilityForId("loopini");
  assert.equal(capability.noteMode, "processor"); assert.equal(capability.audioInput, true);
  assert.equal(capability.computerKeyboardMode, "page"); assert.equal(capability.midiOutput, false);
  const html = await readFile(new URL("../loopini.html", import.meta.url), "utf8");
  assert.match(html, /data-primary-transport/);
  assert.doesNotMatch(html, /infoButton|infoDialog|loopini-private|loopHint|Just play\./);
  assert.doesNotMatch(html, /data-morphazoid-wax-bootstrap|id="(?:makeSong|saveSong|songProgress)"/);
  assert.match(html, /id="speed"/);
  assert.match(html, /src="src\/instruments\/loopini\/loopini-app\.js"/);
  assert.match(html, /href="src\/instruments\/loopini\/loopini\.css"/);
  const inventory = await readRuntimeManifest();
  for (const path of ["loopini.html", "src/instruments/loopini/loopini-app.js",
    "src/instruments/loopini/loopini.css", "src/instruments/loopini/loopini.js",
    "src/instruments/loopini/loopini-audio.js", "src/instruments/loopini/loopini-processor.js",
    "assets/instruments/loopini.webp", "docs/loopini.md"]) {
    assert.ok(inventory.worktreeFiles.includes(path), `${path}: pre-commit inclusion`);
    assert.ok(inventory.requiredFiles.includes(path), `${path}: required build resource`);
  }
  const icon = await readFile(new URL("../assets/instruments/loopini.webp", import.meta.url));
  assert.equal(icon.subarray(0, 4).toString(), "RIFF"); assert.ok(icon.length > 1000);
});

test("six captures share one clock and dense mixes stay bounded without a graphics callback", () => {
  const core = recorded();
  for (let id = 1; id < 6; id++) {
    core.record(id); run(core, core.recording.wait); run(core, core.length, 0.9);
    assert.equal(core.recording, null);
  }
  assert.equal(core.filled(), 6);
  assert.ok(core.slots.every((s) => s.samples.length === core.length));
  const peak = run(core, core.length * 8);
  assert.ok(peak > 0.05 && peak <= 0.82);
  assert.equal(core.playing, true);
});

function tone(core, frames, frequency = 197, amplitude = 0.2) {
  for (let i = 0; i < frames; i++) core.tick(Math.sin(i * 2 * Math.PI * frequency / rate) * amplitude);
}
function measuredFrequency(samples, sampleRate) {
  // Ignore recording fades; count rising zero crossings in a known sine fixture.
  const lo = Math.round(samples.length * 0.1), hi = Math.round(samples.length * 0.9);
  const crossings = [];
  for (let i = lo + 1; i < hi; i++) if (samples[i - 1] <= 0 && samples[i] > 0) {
    crossings.push(i - 1 + -samples[i - 1] / (samples[i] - samples[i - 1]));
  }
  return (crossings.length - 1) * sampleRate / (crossings.at(-1) - crossings[0]);
}

test("half-speed recording takes twice as long, then returns as a double-speed/pitch layer at normal", () => {
  const core = recorded(1), original = core.slots[0].samples;
  core.setSpeed(0.5); core.record(1);
  run(core, core.recording.wait);
  const length = core.length;
  tone(core, length * 2 - 1);
  assert.ok(core.recording);
  core.tick(Math.sin((length * 2 - 1) * 2 * Math.PI * 197 / rate) * 0.2);
  assert.equal(core.recording, null);
  assert.equal(core.length, length); assert.equal(core.slots[0].samples, original);
  assert.equal(core.slots[1].samples.length, length);
  assert.ok(Math.abs(measuredFrequency(core.slots[1].samples, rate) - 394) < 0.5);
  const slow = Float32Array.from({ length: length * 2 }, (_, i) => readLoop(core.slots[1].samples, i * 0.5));
  assert.ok(Math.abs(measuredFrequency(slow, rate) - 197) < 0.5);
  core.setSpeed(1); const phase = core.phase;
  assert.equal(core.phase, phase, "Normal does not restart");
  assert.equal(core.slots[1].samples.length, length);
  assert.equal(core.playing, true);
});

test("first takes and fast/new takes all write into the same bounded tape coordinates", () => {
  for (const speed of [0.5, 0.73, 1, 1.25, 2]) {
    const core = new Loopini(rate); core.setSpeed(speed); core.record(0);
    tone(core, rate);
    core.finish();
    assert.equal(core.length, Math.round(rate * speed));
    assert.ok(Math.abs(measuredFrequency(core.slots[0].samples, rate) - 197 / speed) < 1);
    const length = core.length;
    run(core, 427);
    core.record(1); run(core, core.recording.wait);
    tone(core, Math.ceil(length / speed) + 2);
    assert.equal(core.recording, null);
    assert.equal(core.length, length);
    assert.equal(core.slots[1].samples.length, length);
    assert.ok(Math.abs(measuredFrequency(core.slots[1].samples, rate) - 197 / speed) < 1);
    assert.ok(core.phase < speed * 3 + 1, "both loops still share their wrap point");
  }
  const short = recorded(0.5); short.setSpeed(2); short.record(1);
  run(short, short.recording.wait); tone(short, rate / 4);
  assert.equal(short.recording, null); assert.equal(short.filled(), 2, "fast complete takes are not rejected as too short");
});

test("overdub preserves the old buffer until finish, monitors it, and Undo restores it exactly", () => {
  const core = recorded(1), original = core.slots[0].samples, copy = original.slice();
  core.record(0, "add");
  run(core, core.recording.wait);
  assert.equal(core.snapshot().recording.mode, "add");
  assert.equal(core.snapshot().slots[0].audible, true);
  assert.ok(run(core, 200) > 0.01, "old loop keeps sounding while adding");
  assert.equal(core.slots[0].samples, original);
  tone(core, core.length);
  assert.equal(core.filled(), 1); assert.equal(core.recording, null);
  assert.notDeepEqual(core.slots[0].samples, copy);
  assert.deepEqual(original, copy, "old recorded audio was not edited in place");
  assert.equal(core.undoState.slots[0].samples, original);
  core.undo(); assert.equal(core.slots[0].samples, original);
  assert.equal(core.record(5, "add"), false, "add is only for a recorded circle");
});

test("early, silent and cancelled overdubs preserve all untouched audio and older Undo", () => {
  const core = recorded(2), original = core.slots[0].samples, beforeUndo = core.undoState;
  core.record(0, "add"); core.cancel();
  assert.equal(core.slots[0].samples, original); assert.equal(core.undoState, beforeUndo);
  core.record(0, "add"); run(core, core.recording.wait); tone(core, core.length, 197, 0);
  assert.equal(core.notice, "quiet"); assert.equal(core.slots[0].samples, original);
  assert.equal(core.undoState, beforeUndo);
  core.record(0, "add"); run(core, core.recording.wait); tone(core, rate / 2); core.finish();
  assert.notDeepEqual(core.slots[0].samples.subarray(0, rate / 2), original.subarray(0, rate / 2));
  assert.deepEqual(core.slots[0].samples.subarray(rate / 2), original.subarray(rate / 2));
  core.undo(); core.record(0, "add"); run(core, core.recording.wait); tone(core, 500); core.setPlaying(false);
  assert.equal(core.slots[0].samples, original); assert.equal(core.recording, null);
});

test("half-speed overdubs are aligned with the original; repeated loud additions stay bounded", () => {
  const core = recorded(1); core.setSpeed(0.5);
  for (let pass = 0; pass < 8; pass++) {
    const old = core.slots[0].samples;
    core.record(0, "add"); run(core, core.recording.wait);
    assert.equal(core.setSpeed(2), false); assert.equal(core.speed, 0.5);
    tone(core, core.length * 2, 197, 0.95);
    assert.equal(core.recording, null);
    assert.equal(core.slots[0].samples.length, rate);
    assert.ok(core.slots[0].samples.every((v) => Number.isFinite(v) && Math.abs(v) <= 1));
    assert.equal(core.undoState.slots[0].samples, old);
  }
  assert.ok(run(core, rate) <= 0.82); core.setSpeed(1);
  assert.equal(core.slots[0].samples.length, rate);
});

test("speed is bounded, smoothed without phase reset, and unaffected by pause/Undo", () => {
  const core = recorded(1), buffer = core.slots[0].samples;
  core.setSpeed(10); assert.equal(core.speed, 2);
  core.tick(); assert.ok(core.currentSpeed > 1 && core.currentSpeed < 2);
  run(core, rate); assert.equal(core.currentSpeed, 2);
  core.setPlaying(false); core.setSpeed(0.5);
  assert.equal(core.currentSpeed, 0.5); assert.equal(core.slots[0].samples, buffer);
  core.setPlaying(true); const start = core.phase;
  run(core, 1000); assert.ok(Math.abs(core.phase - (start + 500) % core.length) < 1e-7);
  core.remove(0); core.undo(); assert.equal(core.speed, 0.5); assert.equal(core.slots[0].samples, buffer);
  core.setSpeed(NaN); assert.equal(core.speed, 1);
  core.setSpeed(-2); assert.equal(core.speed, 0.5);
  core.reset(); assert.equal(core.speed, 1); assert.equal(core.currentSpeed, 1);
});

test("re-recording replaces rather than combines old audio at normal and half speed", () => {
  for (const speed of [0.5, 1]) {
    const a = new Loopini(rate), b = new Loopini(rate);
    for (const [core, frequency] of [[a, 197], [b, 311]]) {
      core.record(0); tone(core, rate, frequency); core.finish();
      core.setSpeed(speed); core.record(0, "replace"); run(core, core.recording.wait);
      assert.equal(core.isAudible(0), false);
      tone(core, Math.ceil(core.length / speed), 419, 0.1);
      assert.equal(core.filled(), 1);
      assert.equal(core.recording, null);
      assert.ok(Math.abs(measuredFrequency(core.slots[0].samples, rate) - 419 / speed) < 1);
    }
    assert.deepEqual(a.slots[0].samples, b.slots[0].samples, "different bad takes have no effect on the replacement");
    a.undo(); b.undo();
    assert.notDeepEqual(a.slots[0].samples, b.slots[0].samples, "Undo restores each original");
  }
});
