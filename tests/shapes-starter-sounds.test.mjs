import assert from "node:assert/strict";
import test from "node:test";
import { SHAPES_FULL_PRESETS, randomizeShapesPreset, captureShapesPreset, applyShapesPreset } from "../src/instruments/shapes/full-presets.js";
import { createShapesState, advanceShapesMotion } from "../src/instruments/shapes/shapes-state.js";
import { buildShapesScene } from "../src/instruments/shapes/shapes-scene.js";
import { originalSynthSpecs, noteSpecForContact, originalCornerSample, originalCornerIntents } from "../src/instruments/shapes/original-audio.js";
import { createGeometryVoicePool } from "../src/families/geometry-presets/audio-budget.js";

function seeded(seed) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

test("waveform engines reach geometry Continuous and Notes in every dimension, with bounded independent budgets", () => {
  for (const engine of ["triangle", "square", "shepard"]) {
    for (const dimension of ["2d", "3d", "4d"]) {
      const state = createShapesState({ selection: { dimension }, voice: { engine }, play: { continuousPhase: 0.4 } });
      const scene = buildShapesScene(state);
      const voices = originalSynthSpecs(scene, state);
      assert.ok(voices.length);
      assert.ok(voices.every(v => v.mode === engine));
      assert.equal(noteSpecForContact(scene.contacts[0], scene, state).mode, engine);
      assert.equal(applyShapesPreset(createShapesState(), captureShapesPreset(state)).voice.engine, engine);
    }
    const pool = createGeometryVoicePool();
    assert.equal(pool.voiceLimitFor(engine), engine === "shepard" ? 8 : 32);
    pool.observePolyphony({ mode: engine, activeVoices: 32, requestedVoices: 32, averageLoad: 1.3, peakLoad: 1.5 });
    assert.ok(pool.voiceLimitFor(engine) < (engine === "shepard" ? 8 : 32));
    assert.equal(pool.voiceLimitFor("sine"), 32);
    for (const mode of ["continuous", "notes"]) assert.ok(SHAPES_FULL_PRESETS.some(p => p.snapshot.parameters.selection.playingMode === mode && p.snapshot.parameters.voice.engine === engine));
  }
});

test("manual extremes and saved scene levels bypass all novice sound policies", () => {
  const state = createShapesState({
    play: { running: false, rateCyclesPerSecond: 0, divisions: 16 },
    voice: { engine: "fm", baseHz: 20, rangeOctaves: 7, presetLevel: 1 },
    synthesis: { tone: { fmIndex: 12, fmRatio: 8 } },
  });
  const restored = applyShapesPreset(createShapesState({ audio: { enabled: true, level: 0.19 } }), captureShapesPreset(state));
  assert.equal(restored.voice.baseHz, 20);
  assert.equal(restored.voice.rangeOctaves, 7);
  assert.equal(restored.synthesis.tone.fmIndex, 12);
  assert.equal(restored.synthesis.tone.fmRatio, 8);
  assert.equal(restored.voice.presetLevel, 1);
  assert.equal(restored.play.rateCyclesPerSecond, 0);
  assert.equal(restored.play.running, false);
  assert.equal(restored.play.divisions, 16);
  assert.deepEqual(restored.audio, { enabled: true, level: 0.19 });
});

test("factory and chained dice scenes keep audible registers, gentler FM and useful motion without level ratcheting", () => {
  const random = seeded(73125), scenes = [...SHAPES_FULL_PRESETS.map(p => p.snapshot)];
  let current = scenes[0];
  const modes = { continuous: new Set(), notes: new Set() };
  for (let i = 0; i < 600; i++) {
    current = randomizeShapesPreset(current, random); scenes.push(current);
    modes[current.parameters.selection.playingMode]?.add(current.parameters.voice.engine);
  }
  for (const mode of Object.values(modes)) for (const engine of ["triangle", "square", "shepard"]) assert.ok(mode.has(engine));
  for (const snapshot of scenes) {
    const s = createShapesState(snapshot.parameters), local = s.dimension[s.selection.dimension];
    assert.ok(s.voice.baseHz >= 110);
    assert.ok(s.voice.baseHz * 2 ** s.voice.rangeOctaves <= 3200.000001);
    assert.ok(s.voice.presetLevel >= 0.1);
    if (s.selection.playingMode !== "triggers" && s.voice.engine === "fm") {
      assert.ok(s.synthesis.tone.fmIndex <= 1.5);
      assert.ok(s.synthesis.tone.fmRatio >= 0.5 && s.synthesis.tone.fmRatio <= 2);
      assert.ok(s.voice.presetLevel <= 0.24);
    }
    if (s.play.running) assert.ok(s.play.rateCyclesPerSecond >= 0.08);
    else if (s.selection.dimension === "2d") assert.ok(local.rotationRunning && Math.abs(local.rotationSpeed) >= 0.08);
    else assert.ok(Object.values(local.rotationMotion).some(m => m.running && Math.abs(m.speed) >= 0.06));
    assert.equal("audio" in snapshot.parameters, false);
  }
});

test("sampled dice scenes produce audible mapped voices or geometric events within eight seconds", () => {
  const random = seeded(9232601), failures = [];
  let current = SHAPES_FULL_PRESETS[0].snapshot;
  for (let roll = 0; roll < 600; roll++) {
    current = randomizeShapesPreset(current, random);
    const state = applyShapesPreset(createShapesState(), current);
    let audible = false, scene = buildShapesScene(state), previous = originalCornerSample(state, scene);
    for (let i = 0; i < 160 && !audible; i++) {
      advanceShapesMotion(state, 0.05); scene = buildShapesScene(state);
      if (state.selection.playingMode === "continuous") {
        audible = originalSynthSpecs(scene, state).some(v => v.frequency >= 110 && v.gain > 0.005);
      } else {
        const next = originalCornerSample(state, scene);
        const events = originalCornerIntents(previous, next, state);
        audible = events.some(event => state.selection.playingMode === "triggers" ||
          (state.voice.engine === "percussion" ? event.spec.gain > 0.005 : noteSpecForContact(event.contact, scene, state).gain > 0.005));
        previous = next;
      }
    }
    if (!audible) failures.push({ roll, dimension: state.selection.dimension, mode: state.selection.playingMode, voice: state.voice.engine, snapshot: current });
  }
  assert.equal(failures.length, 0, JSON.stringify(failures));
});
