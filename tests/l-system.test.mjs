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
  progressiveSampleIndices,
  traceLSystem,
} from "../src/l-system.js";

test("L-system expansion applies simultaneous production passes", () => {
  assert.equal(expandLSystem("FX", { F: "FF", X: "+F" }, 2), "FFFF+FF");
  assert.throws(() => expandLSystem("F", { F: "FF" }, 20, 100), RangeError);
});

test("Koch and Sierpiński presets produce closed drawable curves", () => {
  const koch = traceLSystem(L_SYSTEM_PRESETS.find((preset) => preset.id === "koch"));
  const sierpinski = traceLSystem(L_SYSTEM_PRESETS.find((preset) => preset.id === "sierpinski"));
  assert.equal(koch.segments.length, 3 * 4 ** 4);
  assert.equal(sierpinski.segments.length, 3 ** 6);
  for (const trace of [koch, sierpinski]) {
    const start = trace.segments[0].start;
    const end = trace.segments.at(-1).end;
    assert.ok(Math.hypot(end.x - start.x, end.y - start.y) < 1e-9);
  }
  const secondDrawingSymbol = traceLSystem({ axiom: "G", drawSymbols: "FG" });
  assert.equal(secondDrawingSymbol.segments.length, 1);
});

test("popular L-system presets have canonical geometry and safe iteration caps", () => {
  const expected = {
    hilbert: { segments: 1023, endpoint: 31, maxIterations: 7 },
    gosper: { segments: 2401, endpoint: 49, maxIterations: 5 },
    cantor: { segments: 64, endpoint: 729, maxIterations: 11 },
    levy: { segments: 4096, endpoint: 64, maxIterations: 15 },
    terdragon: { segments: 2187, endpoint: Math.sqrt(3 ** 7), maxIterations: 10 },
  };
  assert.equal(new Set(L_SYSTEM_PRESETS.map((preset) => preset.id)).size, L_SYSTEM_PRESETS.length);
  for (const [id, shape] of Object.entries(expected)) {
    const preset = L_SYSTEM_PRESETS.find((candidate) => candidate.id === id);
    assert.ok(preset, `${id} should be available`);
    assert.equal(preset.maxIterations, shape.maxIterations);
    const trace = traceLSystem(preset);
    assert.equal(trace.segments.length, shape.segments);
    const start = trace.segments[0]?.start ?? { x: 0, y: 0 };
    const end = trace.segments.at(-1)?.end ?? start;
    assert.ok(Math.abs(Math.hypot(end.x - start.x, end.y - start.y) - shape.endpoint) < 1e-8);
    assert.ok(trace.segments.every((segment) => (
      [segment.start.x, segment.start.y, segment.end.x, segment.end.y].every(Number.isFinite)
    )));
    assert.doesNotThrow(() => traceLSystem({ ...preset, iterations: preset.maxIterations }));
    assert.throws(
      () => traceLSystem({ ...preset, iterations: preset.maxIterations + 1 }),
      RangeError,
    );
  }
  const hilbert = traceLSystem(L_SYSTEM_PRESETS.find((preset) => preset.id === "hilbert"));
  assert.ok(Math.abs(hilbert.bounds.maxX - hilbert.bounds.minX - 31) < 1e-9);
  assert.ok(Math.abs(hilbert.bounds.maxY - hilbert.bounds.minY - 31) < 1e-9);
  const cantor = traceLSystem(L_SYSTEM_PRESETS.find((preset) => preset.id === "cantor"));
  assert.equal(cantor.duration, 729);
  assert.equal(cantor.bounds.maxX - cantor.bounds.minX, 729);
  assert.equal(cantor.segments.reduce(
    (length, segment) => length + Math.hypot(
      segment.end.x - segment.start.x,
      segment.end.y - segment.start.y,
    ),
    0,
  ), 64);
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

test("pen-up symbols create audible rests without collapsing path time", () => {
  const gap = traceLSystem({ axiom: "FfF", moveSymbols: "f" });
  assert.equal(gap.segments.length, 2);
  assert.deepEqual(gap.segments.map((segment) => [segment.startDistance, segment.endDistance]), [
    [0, 1],
    [2, 3],
  ]);
  assert.deepEqual(gap.segments.map((segment) => [segment.start.x, segment.end.x]), [
    [0, 1],
    [2, 3],
  ]);
  assert.equal(gap.duration, 3);
  assert.equal(gap.bounds.maxX, 3);
  assert.equal(branchingSnapshotAtPhase(gap, 1.5 / gap.duration).heads.length, 0);
  const afterGap = branchingSnapshotAtPhase(gap, 2.5 / gap.duration);
  assert.equal(afterGap.heads.length, 1);
  assert.ok(Math.abs(afterGap.heads[0].x - 2.5) < 1e-12);

  const trailingRest = traceLSystem({ axiom: "Fff", moveSymbols: "f" });
  assert.equal(trailingRest.duration, 3);
  assert.equal(branchingSnapshotAtPhase(trailingRest, 2 / 3).heads.length, 0);
  const allRest = traceLSystem({ axiom: "fff", moveSymbols: "f" });
  assert.equal(allRest.segments.length, 0);
  assert.equal(allRest.duration, 3);
  assert.equal(branchingSnapshotAtPhase(allRest, 0.5).heads.length, 0);

  const delayedBranch = traceLSystem({ axiom: "F[fF]F", moveSymbols: "f" });
  assert.equal(delayedBranch.duration, 3);
  const earlyBranchHeads = branchingSnapshotAtPhase(
    delayedBranch,
    1.5 / delayedBranch.duration,
  ).heads;
  assert.equal(earlyBranchHeads.length, 1);
  assert.ok(Math.abs(earlyBranchHeads[0].x - 1.5) < 1e-12);
  const lateBranchHeads = branchingSnapshotAtPhase(
    delayedBranch,
    2.5 / delayedBranch.duration,
  ).heads;
  assert.equal(lateBranchHeads.length, 1);
  assert.ok(Math.abs(lateBranchHeads[0].x - 2.5) < 1e-12);
  const longSilentBranch = traceLSystem({ axiom: "F[fff]F", moveSymbols: "f" });
  assert.equal(longSilentBranch.duration, 4);
  assert.equal(branchingSnapshotAtPhase(longSilentBranch, 3 / 4).heads.length, 0);

  const taperedGap = traceLSystem({
    axiom: "F>f<F",
    moveSymbols: "f",
    step: 2,
    lengthScale: 0.5,
  });
  assert.equal(taperedGap.duration, 5);
  assert.equal(taperedGap.bounds.maxX, 5);
  assert.deepEqual(taperedGap.segments.map((segment) => segment.startDistance), [0, 3]);
});

test("turn asymmetry leans forks and changes their inherited pitch intervals", () => {
  const symmetric = traceLSystem({ axiom: "F[-F][+F]", angle: 45 });
  const asymmetric = traceLSystem({
    axiom: "F[-F][+F]",
    angle: 45,
    turnAsymmetry: 0.5,
  });
  assert.deepEqual(
    symmetric.segments.slice(1).map((segment) => Math.round(segment.heading * 180 / Math.PI)),
    [-45, 45],
  );
  assert.deepEqual(
    asymmetric.segments.slice(1).map((segment) => segment.heading * 180 / Math.PI),
    [-22.5, 67.5],
  );
  assert.deepEqual(
    asymmetric.segments.slice(1).map((segment) => segment.cumulativeTurn * 180 / Math.PI),
    [-22.5, 67.5],
  );
  assert.equal(asymmetric.segments[0].cumulativeTurn, 0);
  assert.ok(branchAngleFrequency(
    asymmetric.segments[2].cumulativeTurn,
    110,
    2,
  ) > branchAngleFrequency(asymmetric.segments[1].cumulativeTurn, 110, 2));
});

test("branch length taper changes marked step length, not line width or gain", () => {
  const trace = traceLSystem({ axiom: "F>F<F", step: 2, lengthScale: 0.5 });
  assert.deepEqual(
    trace.segments.map((segment) => segment.endDistance - segment.startDistance),
    [2, 1, 2],
  );
  assert.equal(trace.duration, 5);
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

test("raising the branch ceiling adds stable, progressively spaced voices", () => {
  assert.deepEqual(progressiveSampleIndices(10, 2), [0, 9]);
  assert.deepEqual(progressiveSampleIndices(10, 3), [0, 4, 9]);
  const denseHeads = Array.from({ length: 512 }, (_, index) => ({
    iteration: 9,
    key: `branch:${index}`,
  }));
  const at128 = allocateIterationVoiceHeads(denseHeads, 128);
  const at160 = allocateIterationVoiceHeads(denseHeads, 160);
  const expandedKeys = new Set(at160.map((head) => head.key));
  assert.ok(at128.every((head) => expandedKeys.has(head.key)));
  assert.equal(new Set(at128.map((head) => head.key)).size, 128);
  assert.equal(expandedKeys.size, 160);
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

test("L-mic page exposes presets, traversal, mapping, microphone recursion, and reciprocal navigation", async () => {
  const root = new URL("../", import.meta.url);
  const [html, app] = await Promise.all([
    readFile(new URL("l-system.html", root), "utf8"),
    readFile(new URL("l-system-app.js", root), "utf8"),
  ]);
  assert.equal(L_SYSTEM_PRESETS.length, 11);
  for (const name of ["Koch snowflake", "Sierpiński triangle", "Hilbert curve", "Gosper curve", "Cantor set", "Lévy C curve", "Terdragon"]) {
    assert.match(html, new RegExp(name));
  }
  for (const id of ["playButton", "position", "speed", "structureMode", "structureFinal", "structureSequence", "structureTogether", "structureAccumulate", "structureCanon", "preset", "iterations", "angle", "turnAsymmetry", "turnAsymmetryNote", "lengthScale", "taperNote", "pitchSource", "baseFrequency", "pitchRange", "branchCompression", "branchFeedback", "polyphonyReadout", "polyphonyDescription"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Branch length taper/);
  assert.match(html, /Length only—not line width or loudness/);
  assert.match(html, /hyper<\/a><a class="tab active"[^>]+>l-mic<\/a><a class="tab"[^>]+>julia<\/a><a class="tab"[^>]+>lumber<\/a>/);
  assert.match(html, /src="l-system-app\.js"/);
  assert.match(app, /iterationPlaybackAtPhase/);
  assert.match(app, /allocateIterationVoiceHeads/);
  assert.match(app, /new MicBranchEngine\(INITIAL_L_SYSTEM_VOICES,[\s\S]*maxVoices: MAX_L_SYSTEM_VOICES/);
  assert.match(app, /branchVoiceGain/);
  assert.match(app, /micBranchPlaybackRate/);
  assert.match(app, /pool\.setVoices/);
  assert.doesNotMatch(app, /createOscillator/);
});
