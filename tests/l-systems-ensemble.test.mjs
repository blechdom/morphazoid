import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { L_SYSTEM_PRESETS, traceLSystem, branchingSnapshotAtPhase } from "../src/instruments/l-system/l-system.js";
import { lSystemDrumTraversalStepSize, groupedLSystemDrumEvents } from "../src/instruments/l-system-drum-machine/l-system-drum-machine.js";
import { sampleAmplitudeEnvelope } from "../src/audio.js";
import { createDefaultState } from "../src/instruments/l-systems/state.js";
import { lSystemsTrace } from "../src/instruments/l-systems/branch-parameters.js";
import { L_SYSTEMS_FULL_PRESETS, randomizeLSystemsPreset } from "../src/instruments/l-systems/full-presets.js";
import { LSystemEventClock, lSystemNoteVoice } from "../src/instruments/l-systems/discrete-audio.js";
import { lSystemsPlaybackAtPhase, lSystemsPlaybackHeads, lSystemsFrequency, lSystemsEventsForTraversal, lSystemsNoteGroups, lSystemsPresetSpeed } from "../src/instruments/l-systems/ensemble.js";

const stateFor = p => Object.assign(createDefaultState(), p.shared, { mode: p.mode, synth: p.synth, drums: p.drums });
const tracesFor = state => Array.from({ length: Math.max(1, state.iterations) }, (_, i) => lSystemsTrace(L_SYSTEM_PRESETS.find(g => g.id === state.presetId), state.iterations ? i + 1 : 0, state));
const headsAt = (traces, phase, mode = "final", readers = "regions") => lSystemsPlaybackHeads(lSystemsPlaybackAtPhase(traces, phase, mode, readers));
function random(seed) {
  return () => { seed += 0x6B2B79F5; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

test("optional regions give every non-rest path three on-path readers, not a hidden chord", () => {
  for (const g of L_SYSTEM_PRESETS.filter(g => !["plant", "pythagorean", "coral", "cantor"].includes(g.id))) {
    const trace = { ...traceLSystem({ ...g, iterations: 3 }), iteration: 3 }, traces = [trace];
    const unchanged = structuredClone(trace);
    for (const phase of [.01, .22, .47, .81, .999]) {
      const heads = headsAt(traces, phase);
      assert.equal(heads.length, 3, g.id);
      assert.equal(new Set(heads.map(h => h.voiceKey)).size, 3);
      for (const head of heads) {
        const original = branchingSnapshotAtPhase(trace, (head.reader + phase) / 3).heads[0];
        assert.ok(Math.abs(head.x - original.x) < 1e-8 && Math.abs(head.y - original.y) < 1e-8);
        assert.equal(head.index, original.index);
      }
    }
    assert.deepEqual(trace, unchanged);
  }
});

test("layered iterations retain independent voice keys instead of collapsing every root:0", () => {
  const state = stateFor(L_SYSTEMS_FULL_PRESETS[15].snapshot), traces = tracesFor(state);
  for (const mode of ["sequence", "accumulate", "together", "canon"]) {
    const heads = headsAt(traces, .85, mode);
    assert.equal(new Set(heads.map(h => h.voiceKey)).size, heads.length);
    assert.ok(heads.length >= 3);
    const pitches = heads.map(h => lSystemsFrequency(h, state.synth));
    assert.ok(new Set(pitches.map(f => f.toFixed(1))).size > 1, mode);
  }
});

test("branchless depth and flat height are meaningful path coordinates; real forks are retained", () => {
  const flat = { ...traceLSystem({ axiom: "FFF" }), iteration: 1 };
  const heads = headsAt([flat], .4);
  for (const pitchSource of ["depth", "height", "angle", "progress"]) {
    const synth = { ...createDefaultState().synth, pitchSource };
    const frequencies = heads.map(h => lSystemsFrequency(h, synth));
    assert.equal(new Set(frequencies).size, 3, pitchSource);
    assert.ok(frequencies[0] < frequencies[1] && frequencies[1] < frequencies[2]);
  }
  const tree = { ...traceLSystem({ axiom: "F[+F][-F]F", angle: 45 }), iteration: 1 };
  const poly = headsAt([tree], .5);
  assert.ok(poly.length > 3, "the real branch frontier still bifurcates");
  assert.ok(poly.some(h => h.depth > 0));
});

test("a Cantor pen-up gap stays a visible rest, never an invisible filler oscillator", () => {
  const g = L_SYSTEM_PRESETS.find(g => g.id === "cantor");
  const trace = { ...traceLSystem({ ...g, iterations: 3 }), iteration: 3 };
  let rests = 0, poly = 0;
  for (let i = 0; i < 100; i++) {
    const heads = headsAt([trace], (i + .5) / 100);
    rests += heads.length === 0; poly += heads.length >= 2;
    for (const h of heads) assert.ok(h.snapshotDistance >= h.segment.startDistance && h.snapshotDistance < h.segment.endDistance);
  }
  assert.ok(rests > 0 && poly > 0);
});

test("all factory and seeded-random synth scenes have geometry-driven pitch diversity inside a useful register", () => {
  const scenes = L_SYSTEMS_FULL_PRESETS.map(p => p.snapshot);
  const rng = random(301);
  for (let i = 0; i < 200; i++) scenes.push(randomizeLSystemsPreset(scenes[0], rng));
  for (const p of scenes.filter(p => p.mode !== "triggers")) {
    const state = stateFor(p), traces = tracesFor(state);
    const pitches = new Set(); let polyphonic = false;
    for (let i = 0; i < 32; i++) {
      const heads = headsAt(traces, (i + .5) / 32, state.structureMode, state.readerMode);
      const simultaneous = new Set();
      for (const head of heads) {
        const frequency = lSystemsFrequency(head, state.synth);
        assert.ok(Number.isFinite(frequency) && frequency >= 65 && frequency <= 1600, `${state.presetId}: ${frequency}`);
        pitches.add(frequency.toFixed(1)); simultaneous.add(frequency.toFixed(1));
      }
      polyphonic ||= simultaneous.size >= 2;
    }
    if (state.readerMode === "regions" || traces.at(-1).maxForkDepth > 0) assert.ok(polyphonic, `${state.presetId}/${state.synth.pitchSource} never makes a polyphonic harmony`);
    assert.ok(pitches.size > 3, `${state.presetId}/${state.synth.pitchSource} is stuck on one pitch`);
  }
});

test("unbounded winding/asymmetry cannot send the earlier Koch/Sierpinski failures to 20 Hz or 20 kHz", () => {
  for (const [presetId, turnAsymmetry] of [["koch", -.221], ["sierpinski", .237]]) {
    const state = Object.assign(createDefaultState(), { presetId, iterations: 5, turnAsymmetry, mutation: .09 });
    const traces = tracesFor(state);
    for (let i = 0; i < 128; i++) for (const head of headsAt(traces, (i + .5) / 128)) {
      const frequency = lSystemsFrequency(head, state.synth);
      assert.ok(frequency >= 110 && frequency <= 440);
    }
  }
});

test("notes retain distinct reader pitches even when percussion coalesces the same drum cell", () => {
  const trace = { ...traceLSystem({ axiom: "FFF" }), iteration: 1 };
  const { events } = lSystemsEventsForTraversal([trace], [{ position: 0, direction: 1 }], { readerMode: "regions" });
  assert.equal(events.length, 3);
  assert.equal(groupedLSystemDrumEvents(events, { mode: "branch-depth-turn" }).length, 1);
  const notes = lSystemsNoteGroups(events);
  assert.equal(notes.length, 3);
  assert.equal(new Set(notes.map(({event}) => lSystemNoteVoice(event, 3, createDefaultState()).frequency)).size, 3);
  assert.equal(new Set(events.map(e => e.key)).size, 3);
});

test("density-aware pacing slows subdivision-heavy paths without changing manual instrument limits", () => {
  const s = createDefaultState(); s.mode = "notes";
  const sparse = [{ ...traceLSystem({ axiom: "F".repeat(24) }), iteration: 1 }];
  const dense = [{ ...traceLSystem({ axiom: "F".repeat(96) }), iteration: 1 }];
  const slow = lSystemsPresetSpeed(dense, s, .1);
  assert.ok(slow < lSystemsPresetSpeed(sparse, s, .1));
  assert.equal(s.speed, .22, "pacing is pure, not a hidden manual tempo clamp");
  s.drums.subdivisions = 8;
  assert.ok(lSystemsPresetSpeed(dense, s, .1) < slow);
  for (const {snapshot} of L_SYSTEMS_FULL_PRESETS) {
    assert.ok(snapshot.shared.speed >= .08 && snapshot.shared.speed <= .65);
    assert.ok(snapshot.drums.subdivisions <= 4);
  }
  const html = readFileSync(new URL("../src/pages/l-systems.html", import.meta.url), "utf8");
  assert.match(html, /id="speed"[^>]*min="0" max="3" step="0.001"/);
  assert.match(html, /id="subdivisions"[^>]*min="1" max="16"/);
});

test("Continuous uses audio-clock motion with no note events and survives stalls/tempo edits", () => {
  const traces = [{ ...traceLSystem({ axiom: "FFF" }), iteration: 1 }];
  const clock = new LSystemEventClock({ traces, position: .2, direction: 1, rate: .1, behavior: "loop", structureMode: "final", now: 0, playingMode: "continuous", subdivisions: 4, maxPhaseStep: lSystemDrumTraversalStepSize(traces,4) });
  assert.deepEqual(clock.read(0), []);
  const before = clock.positionAt(.06), boundary = clock.positionAt(clock.until);
  clock.configure({rate: .2}); clock.read(.025);
  assert.deepEqual(clock.positionAt(.06), before);
  assert.deepEqual(clock.positionAt(.085), boundary);
  assert.deepEqual(clock.read(1), []);
  assert.ok(clock.positionAt(1).position > .3);
  clock.configure({rate: 0}); clock.read(1.025);
  assert.deepEqual(clock.positionAt(1.11),clock.positionAt(2));
});


test("factory Continuous contours sound within each segment without an added generation fade", () => {
  for (const {snapshot} of L_SYSTEMS_FULL_PRESETS.filter(p => p.snapshot.mode === "continuous")) {
    assert.equal(snapshot.shared.branchDecay, 1, "power sharing must not also exponentially fade the tree");
    const state = stateFor(snapshot), traces = tracesFor(state);
    let checked = 0;
    for (let i = 0; i < 128; i++) {
      const heads = headsAt(traces, (i + .5) / 128, state.structureMode, state.readerMode);
      // Attack/release and pen-up gaps are intentional. Middle-of-segment
      // articulation must work just as well on late branches as at the root.
      for (const head of heads.filter(h => h.progress >= .2 && h.progress <= .8)) {
        assert.ok(sampleAmplitudeEnvelope(head.progress, snapshot.envelope.points) > .1, state.presetId);
        checked++;
      }
    }
    assert.ok(checked > 0, state.presetId);
  }
});


test("default and favorite final Pythagorean scene grow 1 -> 2 -> 4 from the root, not from thirds", () => {
  for (const state of [createDefaultState(), ...["continuous-1", "notes-1", "triggers-1"].map(id => stateFor(L_SYSTEMS_FULL_PRESETS.find(p => p.id === id).snapshot))]) {
    assert.equal(state.readerMode, "end-to-end"); assert.equal(state.structureMode, "final");
    assert.equal(state.direction, 1);
    const traces = tracesFor(state), trace = traces.at(-1);
    const start = lSystemsPlaybackHeads(lSystemsPlaybackAtPhase(traces, 0));
    assert.equal(start.length, 1); assert.equal(start[0].x, 0); assert.equal(start[0].y, 0);
    for (let depth = 0; depth < 3; depth++) {
      const segment = trace.segments.find(s => s.forkDepth === depth);
      const phase = (segment.startDistance + segment.endDistance) / (2 * trace.duration);
      const heads = headsAt(traces, phase, "final", state.readerMode);
      assert.equal(heads.length, 2 ** depth);
      assert.ok(heads.every(h => h.reader === 0 && h.depth === depth));
    }
  }
});

test("end-to-end follows the original whole path, including reverse traversal, without virtual extra playheads", () => {
  for (const grammar of L_SYSTEM_PRESETS) {
    const trace = { ...traceLSystem({ ...grammar, iterations: 3 }), iteration: 3 };
    for (const phase of [0, .01, .25, .5, .8, 1 - 1e-9]) {
      const original = branchingSnapshotAtPhase(trace, phase).heads;
      const actual = headsAt([trace], phase, "final", "end-to-end");
      assert.deepEqual(actual.map(h => [h.index, h.x, h.y]), original.map(h => [h.index, h.x, h.y]), grammar.id);
    }
  }
});

test("each factory bank is mostly medium, with five fast and only two slow scenes", () => {
  for (const mode of ["continuous", "notes", "triggers"]) {
    const scenes = L_SYSTEMS_FULL_PRESETS.filter(p => p.snapshot.mode === mode).map(p => p.snapshot);
    assert.equal(scenes.filter(p => p.shared.speed < .18).length, 2);
    assert.equal(scenes.filter(p => p.shared.speed >= .18 && p.shared.speed < .4).length, 9);
    assert.equal(scenes.filter(p => p.shared.speed >= .4).length, 5);
    assert.ok(scenes.filter(p => p.shared.readerMode === "end-to-end" && p.shared.structureMode === "final" && p.shared.direction === 1).length >= 9);
  }
});

test("seeded Random retains its intended tempo mix and favors forward end-to-end final images", () => {
  const rng = random(801), current = L_SYSTEMS_FULL_PRESETS[0].snapshot;
  const scenes = Array.from({length: 1000}, () => randomizeLSystemsPreset(current, rng));
  for (const mode of ["continuous", "notes", "triggers"]) {
    const group = scenes.filter(p => p.mode === mode);
    const share = predicate => group.filter(predicate).length / group.length;
    assert.ok(share(p => p.shared.speed < .18) >= .04 && share(p => p.shared.speed < .18) < .17);
    assert.ok(share(p => p.shared.speed >= .18 && p.shared.speed < .4) > .45);
    assert.ok(share(p => p.shared.speed >= .4) > .25);
    assert.ok(share(p => p.shared.structureMode === "final" && p.shared.readerMode === "end-to-end" && p.shared.direction === 1) > .68);
  }
  for (const p of scenes) {
    const s=stateFor(p), traces=tracesFor(s);
    const activity = s.speed < .18 ? 18 : s.speed < .4 ? 36 : 64;
    assert.ok(s.speed >= .08 && s.speed <= .65, "density must not collapse a scene into a glacial traversal");
    assert.ok(lSystemsPresetSpeed(traces,s,s.speed,activity) >= s.speed - 1e-9, "tempo retains density headroom");
  }
});
