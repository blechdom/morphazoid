import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  L_SYSTEM_PRESETS,
  allocateIterationVoiceHeads,
  bifurcatingVoiceGain,
  branchAngleFrequency,
  branchVoiceGain,
  branchingPlayheadsAtPhase,
  branchingSnapshotAtPhase,
  expandLSystem,
  iterationPlaybackAtPhase,
  iterationPlaybackPhaseRate,
  normalizeLSystemPoint,
  pointOnLSystem,
  traceLSystem,
} from "../src/l-system.js";

test("L-system expansion applies simultaneous production passes", () => {
  assert.equal(expandLSystem("FX", { F: "FF", X: "+F" }, 2), "FFFF+FF");
  assert.throws(() => expandLSystem("F", { F: "FF" }, 20, 100), RangeError);
});

test("L-system tracing preserves branches and grows left to right", () => {
  const trace = traceLSystem({ axiom: "F[+F]F[-F]F", angle: 90 });
  assert.equal(trace.segments.length, 5);
  assert.equal(trace.segments[0].start.x, 0);
  assert.ok(trace.bounds.maxX > trace.bounds.minX);
  assert.ok(trace.bounds.maxY > trace.bounds.minY);
  assert.equal(trace.segments[1].depth, 1);
  assert.deepEqual(trace.segments[2].start, trace.segments[0].end);
});

test("Pythagorean growth bifurcates one playhead into powers of two", () => {
  const trace = traceLSystem({ ...L_SYSTEM_PRESETS[0], iterations: 3 });
  assert.deepEqual(trace.generations.map((segments) => segments.length), [1, 2, 4, 8]);
  assert.deepEqual(
    trace.generations.map((segments) => {
      const segment = segments[0];
      const midpoint = (segment.startDistance + segment.endDistance) * 0.5;
      return branchingPlayheadsAtPhase(trace, midpoint / trace.duration).length;
    }),
    [1, 2, 4, 8],
  );
  assert.equal(trace.generations[0][0].parentIndex, null);
  assert.ok(trace.generations[1].every((segment) => segment.parentIndex === 0));
  assert.deepEqual(
    trace.generations[1].map((segment) => Math.round(segment.heading * 180 / Math.PI)),
    [-45, 45],
  );
  const firstFork = branchingSnapshotAtPhase(trace, 1 / trace.duration);
  assert.equal(firstFork.heads.length, 2);
  assert.ok(firstFork.heads.every((head) => head.progress === 0));
  assert.equal(new Set(firstFork.heads.map((head) => head.voiceKey)).size, 2);
  assert.ok(Math.abs(firstFork.heads.reduce((sum, head) => sum + head.powerShare, 0) - 1) < 1e-12);
});

test("bifurcating oscillators preserve power and inherit angle as pitch", () => {
  const totalGain = 0.38;
  for (const count of [1, 2, 4, 8, 16, 128]) {
    const gain = bifurcatingVoiceGain(count, totalGain);
    assert.ok(Math.abs(Math.sqrt(count * gain ** 2) - totalGain) < 1e-12);
    const share = 1 / count;
    const branchGain = branchVoiceGain(share, 1, totalGain);
    assert.ok(Math.abs(Math.sqrt(count * branchGain ** 2) - totalGain) < 1e-12);
  }
  const tinyShares = [1e-14, 2e-14, 3e-14, 4e-14];
  const tinyPower = tinyShares.reduce((sum, share) => sum + share, 0);
  const tinyGains = tinyShares.map((share) => branchVoiceGain(share, tinyPower, totalGain));
  assert.ok(Math.abs(Math.hypot(...tinyGains) - totalGain) < 1e-12);
  assert.equal(branchAngleFrequency(0, 110, 2), 110);
  assert.ok(Math.abs(branchAngleFrequency(Math.PI / 4, 110, 2) - 110 * 2 ** 0.25) < 1e-9);
  assert.ok(Math.abs(branchAngleFrequency(-Math.PI / 4, 110, 2) - 110 * 2 ** -0.25) < 1e-9);
});

test("branch time keeps advancing when the drawing folds backward", () => {
  const trace = traceLSystem({ axiom: "FF++F", angle: 90 });
  const snapshot = branchingSnapshotAtPhase(trace, 2.5 / trace.duration);
  assert.equal(snapshot.heads.length, 1);
  assert.equal(snapshot.heads[0].index, 2);
  assert.ok(snapshot.heads[0].x < snapshot.heads[0].segment.start.x);
  assert.ok(Math.abs(snapshot.distance - 2.5) < 1e-12);
});

test("iteration structures play for equal time in sequence or phase-lock together", () => {
  const traces = [1, 2, 3].map((iteration) => ({
    ...traceLSystem({ ...L_SYSTEM_PRESETS[0], iterations: iteration }),
    iteration,
  }));
  const sequenceMidpoints = [0, 1, 2].map((index) => (
    iterationPlaybackAtPhase(traces, (index + 0.5) / 3, "sequence")
  ));
  assert.deepEqual(sequenceMidpoints.map((playback) => playback.activeIteration), [1, 2, 3]);
  assert.ok(sequenceMidpoints.every((playback) => (
    Math.abs(playback.entries[0].localPhase - 0.5) < 1e-12
  )));
  const traversalSpeed = 0.2;
  const sequencePhaseRate = iterationPlaybackPhaseRate("sequence", traces.length, traversalSpeed);
  assert.equal((1 / traces.length) / sequencePhaseRate, 1 / traversalSpeed);
  assert.equal(iterationPlaybackPhaseRate("together", traces.length, traversalSpeed), traversalSpeed);

  const accumulate = [0, 1, 2].map((index) => (
    iterationPlaybackAtPhase(traces, (index + 0.5) / 3, "accumulate")
  ));
  assert.deepEqual(accumulate.map((playback) => playback.entries.length), [1, 2, 3]);
  assert.ok(accumulate.every((playback) => (
    playback.entries.every((entry) => Math.abs(entry.localPhase - 0.5) < 1e-12)
  )));
  assert.equal(
    iterationPlaybackPhaseRate("accumulate", traces.length, traversalSpeed),
    sequencePhaseRate,
  );

  const together = iterationPlaybackAtPhase(traces, 0.37, "together");
  assert.deepEqual(together.entries.map((entry) => entry.iteration), [1, 2, 3]);
  assert.ok(together.entries.every((entry) => Math.abs(entry.localPhase - 0.37) < 1e-12));

  const canon = iterationPlaybackAtPhase(traces, 0, "canon");
  assert.deepEqual(canon.entries.map((entry) => entry.localPhase), [0, 1 / 3, 2 / 3]);
  const final = iterationPlaybackAtPhase(traces, 0.2, "final");
  assert.equal(final.entries.length, 1);
  assert.equal(final.activeIteration, 3);

  const denseHeads = traces.flatMap((trace) => Array.from(
    { length: 2 ** trace.iteration },
    (_, index) => ({ iteration: trace.iteration, index }),
  ));
  const allocated = allocateIterationVoiceHeads(denseHeads, 7);
  assert.equal(allocated.length, 7);
  assert.deepEqual([...new Set(allocated.map((head) => head.iteration))], [1, 2, 3]);
});

test("L-system playhead wraps and exposes normalized audio data", () => {
  const trace = traceLSystem({ axiom: "FF+F", angle: 90 });
  const start = pointOnLSystem(trace, 0);
  const wrapped = pointOnLSystem(trace, 1);
  assert.deepEqual(start, wrapped);
  const middle = pointOnLSystem(trace, 0.5);
  const normalized = normalizeLSystemPoint(middle, trace.bounds);
  assert.ok(normalized.x >= 0 && normalized.x <= 1);
  assert.ok(normalized.y >= 0 && normalized.y <= 1);
});

test("L-system page exposes presets, traversal, mapping, audio, and reciprocal navigation", async () => {
  const root = new URL("../", import.meta.url);
  const [html, app] = await Promise.all([
    readFile(new URL("l-system.html", root), "utf8"),
    readFile(new URL("l-system-app.js", root), "utf8"),
  ]);
  assert.equal(L_SYSTEM_PRESETS.length, 4);
  for (const id of ["playButton", "position", "speed", "structureMode", "structureFinal", "structureSequence", "structureTogether", "structureAccumulate", "structureCanon", "preset", "iterations", "angle", "lengthScale", "pitchSource", "baseFrequency", "pitchRange", "soundMode"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /hyper<\/a><a class="tab active"[^>]+>l-system<\/a><a class="tab"[^>]+>julia<\/a><a class="tab"[^>]+>lumber<\/a>/);
  assert.match(html, /src="l-system-app\.js"/);
  assert.match(app, /iterationPlaybackAtPhase/);
  assert.match(app, /allocateIterationVoiceHeads/);
  assert.match(app, /new VoicePool\(MAX_L_SYSTEM_VOICES\)/);
  assert.match(app, /branchVoiceGain/);
  assert.match(app, /branchAngleFrequency/);
  assert.match(app, /pitch01ToFrequency/);
  assert.match(app, /setVoiceTrajectory/);
});
