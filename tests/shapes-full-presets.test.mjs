import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SHAPES_FULL_PRESETS, SHAPES_IMPORTED_PRESETS, captureShapesPreset, applyShapesPreset, validateShapesPreset, randomizeShapesPreset } from "../src/instruments/shapes/full-presets.js";
import { ensurePlayableShapesRandom } from "../src/instruments/shapes/random-playability.js";
import { SHAPE_FULL_PRESETS } from "../src/instruments/shape-synth/full-presets.js";
import { SOLID_FULL_PRESETS, HYPER_FULL_PRESETS } from "../src/families/geometry-presets/full-presets.js";
import { captureOriginalParameters, originalShapeState } from "../src/instruments/shapes/parameter-bridge.js";
import { createShapesState, advanceShapesMotion, projectShapesMotion } from "../src/instruments/shapes/shapes-state.js";
import { buildShapesScene, buildShapesDivisionMarkers } from "../src/instruments/shapes/shapes-scene.js";
import { projectPoint3 } from "../src/solid.js";
import { geometryViewPoint } from "../src/families/geometry-presets/geometry-sound.js";
import { originalSynthSpecs, originalCornerIntents, originalCornerSample } from "../src/instruments/shapes/original-audio.js";
import { createShapeSoundModel } from "../src/families/geometry-presets/shape-sound.js";
import { createGeometryVoicePool } from "../src/families/geometry-presets/audio-budget.js";
import { presetStateKey } from "../src/site/header-presets.js";
import { assertReferenceVoices } from "./helpers/shapes-reference-voices.mjs";

const banks = { shape: SHAPE_FULL_PRESETS, solid: SOLID_FULL_PRESETS, hyper: HYPER_FULL_PRESETS };
const reference = JSON.parse(readFileSync(new URL("fixtures/shapes-original-voices.json", import.meta.url), "utf8"));
test("122 pre-integration reference voice sets retain frequencies, envelopes, pan and synth parameters within floating-point precision", () => {
  assert.equal(reference.cases.length, 122);
  for (const example of reference.cases) {
    const state = applyShapesPreset(createShapesState(), SHAPES_FULL_PRESETS.find(p => p.id === example.id).snapshot);
    state.play.continuousPhase = example.phase;
    assertReferenceVoices(originalSynthSpecs(buildShapesScene(state), state).map(({ key, ...voice }) => voice),
      example.voices, `${example.id} at phase ${example.phase}`);
  }
});
test("106 unique presets retain the originals and merge corner/tonal playing with six dense Rattlesnake demos", () => {
  assert.equal(SHAPES_IMPORTED_PRESETS.length, 76);
  assert.equal(SHAPES_FULL_PRESETS.length, 106);
  assert.equal(new Set(SHAPES_FULL_PRESETS.map(p => p.id)).size, 106);
  assert.equal(new Set(SHAPES_FULL_PRESETS.map(p => presetStateKey(p.snapshot))).size, 106);
  assert.deepEqual(SHAPES_FULL_PRESETS.slice(0, 3).map(p => p.snapshot.parameters.selection.playingMode), ["continuous", "notes", "triggers"]);
  for (const mode of ["notes", "triggers"]) {
    assert.equal(SHAPES_FULL_PRESETS.filter(p => p.snapshot.parameters.selection.playingMode === mode).length, mode === "notes" ? 27 : 18);
    for (const dimension of ["2d", "3d", "4d"]) assert.ok(SHAPES_FULL_PRESETS.some(p => p.snapshot.parameters.selection.playingMode === mode && p.snapshot.parameters.selection.dimension === dimension));
  }
  for (let i = 0; i < 90; i += 10) assert.equal(new Set(SHAPES_FULL_PRESETS.slice(i, i + 10).map(p => p.snapshot.parameters.selection.playingMode)).size, 3);
  assert.equal(SHAPES_IMPORTED_PRESETS.filter(p => p.source.kind === "hyper")[1].source.id, "klein-reed");
  const rattles = SHAPES_FULL_PRESETS.filter(p => p.id.startsWith("shapes-rattle-"));
  assert.equal(rattles.length, 6);
  assert.ok(rattles.every(p => p.snapshot.parameters.play.divisions >= 4 && p.snapshot.parameters.trigger.soundBank === "rattlesnake"));
  const notes = SHAPES_FULL_PRESETS.filter(p => p.source.kind === "shapes" && p.snapshot.parameters.selection.playingMode === "notes");
  assert.deepEqual([...new Set(notes.map(p => p.snapshot.parameters.voice.engine))].sort(), ["fm", "pm", "shepard", "sine"]);
  assert.equal(new Set(notes.map(p => JSON.stringify(p.snapshot.parameters.notes.envelopePoints))).size, 12);
  assert.ok(notes.some(p => p.snapshot.parameters.notes.swell));
});

test("subdivisions add note anchors without replacing the original corner events", () => {
  const count = divisions => {
    const state = createShapesState({ selection: { playingMode: "notes" }, voice: { engine: "percussion" }, play: { running: true, continuousPhase: 0.0133, rateCyclesPerSecond: 1, divisions } });
    let previous = originalCornerSample(state, buildShapesScene(state)), events = 0;
    for (let i = 0; i < 256; i++) {
      advanceShapesMotion(state, 1 / 256);
      const next = originalCornerSample(state, buildShapesScene(state));
      events += originalCornerIntents(previous, next, state).length;
      previous = next;
    }
    return events;
  };
  assert.equal(count(1), 4);
  assert.equal(count(4), 16);
  for (const [dimension, vertices] of [["3d", 44], ["4d", 112]]) {
    const state = createShapesState({ selection: { dimension, playingMode: "notes" }, play: { divisions: 4 } });
    const scene = buildShapesScene(state), sample = originalCornerSample(state, scene);
    assert.equal(sample.vertices.length, vertices);
    const firstAdded = sample.vertices[scene.geometry.vertices.length];
    const view = dimension === "3d" ? projectPoint3(firstAdded) : geometryViewPoint(firstAdded);
    const marker = buildShapesDivisionMarkers(scene, 4, { geometric: true })[0];
    assert.equal(marker.view.x, view.x);
    assert.equal(marker.view.y, view.y);
  }
  const legacy = createShapesState({ selection: { playingMode: "corners" }, play: { divisions: 8 } });
  assert.equal(legacy.selection.playingMode, "notes");
  assert.equal(legacy.voice.engine, "percussion");
  assert.equal(legacy.play.divisions, 1);
});

test("long swell forecasts advance all the way to their target without changing the live phase", () => {
  const state = createShapesState({ play: { running: true, continuousPhase: 0.2, rateCyclesPerSecond: 0.5 } });
  // The frame-step clamp must not shorten an ADSR's pre-attack forecast.
  const before = structuredClone(state);
  const projected = projectShapesMotion(state, 2.5);
  assert.equal(projected.play.continuousPhase, 1.45);
  assert.deepEqual(state, before);
});

for (const preset of SHAPES_FULL_PRESETS) {
  test(`${preset.id}: every source parameter survives adaptation, recall and live motion`, () => {
    const state = applyShapesPreset(createShapesState(), preset.snapshot);
    assert.deepEqual(captureShapesPreset(state), preset.snapshot);
    if (banks[preset.source.kind]) {
      const reference = banks[preset.source.kind].find(p => p.id === preset.source.id);
      assert.deepEqual(captureOriginalParameters(state, preset.source.kind), reference.snapshot);
    }
    advanceShapesMotion(state, 0.1);
    assert.deepEqual(captureShapesPreset(state), preset.snapshot, "evolving phase/angle never makes the preset Custom");
    const scene = buildShapesScene(state), voices = state.synthesis.model === "geometry" ? originalSynthSpecs(scene, state) : [];
    for (const voice of voices) {
      assert.ok(Number.isFinite(voice.frequency) && voice.frequency > 0);
      assert.ok(Number.isFinite(voice.gain) && voice.gain >= 0);
      assert.ok(Number.isFinite(voice.pan) && Math.abs(voice.pan) <= 1);
    }
  });
}

test("recall protects Audio, master output, tab and live angles; shape-only slices are centered", () => {
  let state = createShapesState({ audio: { enabled: true, level: 0.27 }, selection: { bank: "rotation" }, play: { continuousPhase: 7.83 } });
  state.dimension["3d"].rotation.x = 113;
  state = applyShapesPreset(state, SHAPES_FULL_PRESETS.find(p => p.id === "solid-shape-cube-orbit").snapshot);
  assert.deepEqual(state.audio, { enabled: true, level: 0.27 });
  assert.equal(state.selection.bank, "rotation");
  assert.equal(state.dimension["3d"].rotation.x, 113);
  assert.equal(state.play.continuousPhase, 7.5);
  assert.equal(state.play.running, false);
});

test("Random avoids stationary percussion and incidence-muted Point readers without unmuting output", () => {
  const state = createShapesState();
  state.audio = { enabled: false, level: 0 };
  state.voice.presetLevel = 0;
  state.selection.playingMode = "notes";
  state.voice.engine = "percussion";
  state.play.running = false;
  state.dimension["2d"].rotationRunning = true;
  state.synthesis.tone.cornerAmplitudeSource = "incidence";
  state.synthesis.tone.percussionLevelSource = "incidence";
  ensurePlayableShapesRandom(state);
  assert.equal(state.play.running, true);
  assert.equal(state.synthesis.tone.cornerAmplitudeSource, "fixed");
  assert.equal(state.synthesis.tone.percussionLevelSource, "fixed");
  assert.deepEqual(state.audio, { enabled: false, level: 0 });
  assert.equal(state.voice.presetLevel, 0);
});

test("dense random trigger scenes bound hits and keep a perceptible moving reader", () => {
  const state = createShapesState();
  state.selection.playingMode = "triggers";
  state.profile = { sides: 32, kind: "star", starDepth: 0.5 };
  state.dimension["2d"].heads = 12;
  state.dimension["2d"].headOffsets = Array.from({ length: 12 }, (_, i) => i / 12);
  state.dimension["2d"].rotationRunning = true;
  state.play.divisions = 8;
  state.trigger.hitCap = 8;
  ensurePlayableShapesRandom(state);
  assert.equal(state.dimension["2d"].heads, 3);
  assert.equal(state.dimension["2d"].headOffsets.length, 3);
  assert.equal(state.play.divisions, 1);
  assert.equal(state.trigger.hitCap, 1);
  assert.ok(state.play.rateCyclesPerSecond >= 0.08);
  state.selection.dimension = "4d";
  state.dimension["4d"].representation = "hypersphere";
  state.dimension["4d"].rotationMotion.xw.running = true;
  state.play.rateCyclesPerSecond = 0.5;
  state.play.divisions = 8;
  state.trigger.hitCap = 8;
  ensurePlayableShapesRandom(state);
  assert.equal(state.play.divisions, 1);
  assert.equal(state.trigger.hitCap, 1);
  assert.equal(state.play.running, true);
  assert.ok(state.play.rateCyclesPerSecond <= 0.18);
  assert.ok(Object.values(state.dimension["4d"].rotationMotion).every(motion => !motion.running));
});

test("random radar/form rotation cannot lock all readers between event markers", () => {
  const state = createShapesState({
    selection: { playingMode: "triggers" },
    play: { running: true, rateCyclesPerSecond: 0.2, divisions: 2 },
    dimension: { "2d": { reader: "radar", rotationRunning: true, rotationSpeed: 0.2 } },
  });
  ensurePlayableShapesRandom(state);
  const relative = state.play.rateCyclesPerSecond - state.dimension["2d"].rotationSpeed;
  assert.ok(Math.abs(relative) >= 0.08);
  assert.equal(state.dimension["2d"].rotationRunning, true);
});

test("invalid/incomplete snapshots fail before mutating state", () => {
  const original = createShapesState(), before = structuredClone(original);
  for (const mutate of [p => { delete p.voice; }, p => { p.voice.baseHz = Infinity; }, p => { p.audio = { enabled: true }; }, p => { p.synthesis.tone.fmRatio = 99; }]) {
    const value = structuredClone(SHAPES_FULL_PRESETS[0].snapshot); mutate(value.parameters);
    assert.throws(() => applyShapesPreset(original, value));
    assert.deepEqual(original, before);
  }
});

test("seeded Random generates parameters, all dimensions and extra modes; preserves scene level", () => {
  let seed = 93517;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const current = captureShapesPreset(createShapesState());
  current.parameters.voice.presetLevel = 0.37;
  const dimensions = new Set(), modes = new Set(), fm = new Set(), spacings = new Set(), envelopes = new Set();
  const factory = new Set(SHAPES_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  for (let i = 0; i < 300; i++) {
    const next = randomizeShapesPreset(current, random); validateShapesPreset(next);
    assert.equal(next.parameters.voice.presetLevel, 0.37);
    assert.equal(factory.has(presetStateKey(next)), false);
    dimensions.add(next.parameters.selection.dimension); modes.add(next.parameters.selection.playingMode);
    fm.add(next.parameters.synthesis.tone.fmRatio);
    spacings.add(JSON.stringify(next.parameters.dimension["2d"].headOffsets));
    envelopes.add(JSON.stringify(next.parameters.synthesis.tone.percussionEnvelopePoints));
  }
  assert.deepEqual([...dimensions].sort(), ["2d", "3d", "4d"]);
  assert.deepEqual([...modes].sort(), ["continuous", "notes", "triggers"]);
  for (const values of [fm, spacings, envelopes]) assert.ok(values.size > 100);
});

test("2D rotation ping-pongs without reversing the playhead or changing preset state", () => {
  const state = createShapesState();
  Object.assign(state.dimension["2d"], { rotationMotion: "pingpong", continuousRotation: 0.99, rotation: 176.4, rotationRunning: true, rotationSpeed: 0.2 });
  const before = captureShapesPreset(state);
  advanceShapesMotion(state, 0.2);
  assert.ok(Math.abs(state.dimension["2d"].rotation - 169.2) < 1e-8);
  assert.equal(state.play.continuousPhase, 0.18);
  assert.deepEqual(captureShapesPreset(state), before);
});

test("FM/PM index/ratio, pitch curve, stereo inversion, envelopes and Shepard controls reach synthesis", () => {
  const state = applyShapesPreset(createShapesState(), SHAPES_FULL_PRESETS.find(p => p.id === "shape-glass-star").snapshot);
  state.play.continuousPhase = 0.231;
  const scene = buildShapesScene(state);
  const get = () => originalSynthSpecs(scene, state);
  const before = get();
  state.synthesis.tone.fmRatio = 0.75;
  assert.notDeepEqual(get(), before);
  const base = get()[0];
  state.synthesis.tone.stereoInverted = true;
  assert.equal(get()[0].pan, -base.pan);
  state.synthesis.tone.pitchCurveNodes = state.synthesis.tone.pitchCurveNodes.map(p => ({ ...p, y: 0 }));
  assert.equal(get()[0].frequency, state.voice.baseHz);
  state.synthesis.tone.cornerAmplitudeSource = "fixed";
  state.synthesis.tone.amplitudeEnvelopeEnabled = false;
  assert.ok(get().every(v => v.gain > 0));
  state.voice.engine = "shepard";
  const p = originalShapeState(state), model = createShapeSoundModel(p), contact = scene.contacts[0];
  p.shepardCycles = 2;
  const a = model.shepardTravelForContact(contact, scene.geometry);
  p.shepardDirection *= -1;
  assert.equal(model.shepardTravelForContact(contact, scene.geometry), -a);
});

test("shared Shape sound reads the live MIDI overlay rather than freezing it at construction", () => {
  const state = applyShapesPreset(createShapesState(), SHAPES_FULL_PRESETS[0].snapshot);
  const scene = buildShapesScene(state);
  let midi = { pitchRatio: 1, gain: 1 };
  const model = createShapeSoundModel(originalShapeState(state), { getMidiSnapshot: () => midi });
  const before = model.continuousSynthVoices(scene.contacts, scene.geometry);
  midi = { pitchRatio: 2, gain: 0.3 };
  const after = model.continuousSynthVoices(scene.contacts, scene.geometry);
  after.forEach((voice, i) => {
    assert.equal(voice.frequency, before[i].frequency * 2);
    assert.ok(Math.abs(voice.gain - before[i].gain * 0.3) < 1e-12);
  });
});

test("all imported percussion studies emit original corner/vertex strikes, not drum-bank substitutions", () => {
  for (const preset of SHAPES_FULL_PRESETS.filter(p => p.snapshot.parameters.voice.engine === "percussion")) {
    const state = applyShapesPreset(createShapesState(), preset.snapshot);
    let before = originalCornerSample(state, buildShapesScene(state)), count = 0;
    for (let i = 0; i < 256; i++) {
      advanceShapesMotion(state, 1 / 64);
      const after = originalCornerSample(state, buildShapesScene(state));
      for (const intent of originalCornerIntents(before, after, state)) {
        count++; assert.ok(intent.spec.frequency > 0 && Number.isFinite(intent.spec.gain));
        if (preset.source.kind === "shape") {
          assert.deepEqual(intent.envelope.envelopePoints, state.synthesis.tone.percussionEnvelopePoints);
          assert.equal(intent.envelope.attackCurve, "smooth");
        } else assert.equal(intent.envelope.attackSeconds, state.synthesis.percussionAttack / 1000);
      }
      before = after;
    }
    assert.ok(count > 0, `${preset.id} should strike`);
  }
});

test("device budgets learn per mode in single voices; growth is demand-driven and not preset state", () => {
  const pool = createGeometryVoicePool();
  assert.equal(pool.voiceLimitFor("shepard"), 8);
  const before = captureShapesPreset(createShapesState());
  for (let i = 0; i < 3; i++) pool.observePolyphony({ mode: "shepard", activeVoices: 8, requestedVoices: 20, averageLoad: 0.1, peakLoad: 0.2 });
  assert.ok(pool.voiceLimitFor("shepard") > 8);
  pool.observePolyphony({ mode: "shepard", activeVoices: 8, requestedVoices: 20, averageLoad: 1.2, peakLoad: 1.5 });
  assert.ok(pool.voiceLimitFor("shepard") < 8);
  assert.equal(pool.voiceLimitFor("sine"), 32);
  pool.useAdaptiveFallback();
  assert.equal(pool.voiceLimitFor("shepard"), 8);
  assert.deepEqual(captureShapesPreset(createShapesState()), before);
});

test("coarse timing spikes do not repeatedly crush a light scene; sustained load and underruns still reduce it", () => {
  const pool = createGeometryVoicePool();
  for (let i = 0; i < 12; i++) pool.observePolyphony({ mode: "sine", activeVoices: 32, requestedVoices: 32, averageLoad: 0.15, peakLoad: 1.125, source: "worklet-coarse" });
  assert.equal(pool.voiceLimitFor("sine"), 32);
  for (let i = 0; i < 2; i++) pool.observePolyphony({ mode: "sine", activeVoices: 32, requestedVoices: 32, averageLoad: 0.8, peakLoad: 1.125, source: "worklet-coarse" });
  assert.ok(pool.voiceLimitFor("sine") < 32);
  const before = pool.voiceLimitFor("sine");
  pool.observePolyphony({ mode: "sine", activeVoices: before, requestedVoices: 32, averageLoad: 0.2, peakLoad: 0.3, underrunRatio: 0.01, source: "playback-stats" });
  assert.ok(pool.voiceLimitFor("sine") < before);
});
