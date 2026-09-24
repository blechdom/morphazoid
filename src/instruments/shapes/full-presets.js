import { SHAPE_FULL_PRESETS, randomizeShapePreset, createShapeInitialState, captureShapePresetParameters } from "../shape-synth/full-presets.js";
import { SOLID_FULL_PRESETS, HYPER_FULL_PRESETS, randomizeGeometryPreset, captureGeometryPreset, createSolidInitialState, createHyperInitialState } from "../../families/geometry-presets/full-presets.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";
import { createShapesState, displayShapesPhase, SHAPES_TRIGGER_SOUND_BANKS } from "./shapes-state.js";
import { rebasePingPongPosition } from "../../articulation.js";
import { applyOriginalParameters } from "./parameter-bridge.js";
import { createShapesModeScenes } from "./mode-presets.js";
import { ensurePlayableShapesRandom, prepareShapesStarterSound } from "./random-playability.js";
import { percussionEnvelopeEditorX } from "../../audio.js";

export function captureShapesPreset(state) {
  const p = structuredClone(state);
  delete p.audio;
  delete p.selection.bank;
  delete p.play.continuousPhase;
  for (const [dimension, local] of Object.entries(p.dimension)) {
    delete local.rotation;
    if (dimension === "2d") {
      delete local.continuousRotation;
      delete local.traceHeadDirectionAdjustments;
      delete local.radialHeadDirectionAdjustments;
    } else {
      delete local.readerYaw; delete local.readerPitch;
      delete local.rotationRunning; delete local.rotationSpeed; // retired compatibility latches
    }
  }
  return { version: 1, parameters: p };
}

export function validateShapesPreset(snapshot) {
  presetStateKey(snapshot);
  if (snapshot?.version !== 1 || presetStateKey(captureShapesPreset(createShapesState(snapshot.parameters))) !== presetStateKey(snapshot)) {
    throw new TypeError("Invalid or incomplete Shapes preset");
  }
  return snapshot;
}

export function applyShapesPreset(state, snapshot) {
  validateShapesPreset(snapshot);
  const next = createShapesState(snapshot.parameters);
  next.audio = structuredClone(state.audio);
  next.selection.bank = state.selection.bank;
  const phase = displayShapesPhase(state);
  next.play.continuousPhase = next.play.motion === state.play.motion ? state.play.continuousPhase
    : next.play.motion === "pingpong" ? rebasePingPongPosition(state.play.continuousPhase, phase)
    : Math.floor(state.play.continuousPhase) + phase;
  // The requested shape-only studies use a readable central slice.
  if (!next.play.running && next.selection.dimension !== "2d") next.play.continuousPhase = Math.floor(next.play.continuousPhase) + 0.5;
  for (const [dimension, local] of Object.entries(next.dimension)) {
    const before = state.dimension[dimension];
    local.rotation = structuredClone(before.rotation);
    if (dimension === "2d") {
      local.continuousRotation = local.rotationMotion === before.rotationMotion ? before.continuousRotation
        : local.rotationMotion === "pingpong" ? rebasePingPongPosition(before.continuousRotation, (before.rotation + 180) / 360) : before.rotation / 360;
      for (const method of ["trace", "radial"]) {
        local[`${method}HeadDirectionAdjustments`] = local[`${method}HeadDirections`].map((direction, index) => (
          before[`${method}HeadDirections`][index] * state.play.continuousPhase + before[`${method}HeadDirectionAdjustments`][index] - direction * next.play.continuousPhase
        ));
      }
    } else if (dimension === "3d") {
      local.readerYaw = before.readerYaw; local.readerPitch = before.readerPitch;
    }
  }
  return next;
}

const banks = [["shape", SHAPE_FULL_PRESETS], ["solid", SOLID_FULL_PRESETS], ["hyper", HYPER_FULL_PRESETS]];
export const SHAPES_IMPORTED_PRESETS = Object.freeze(banks.flatMap(([kind, bank], group) => bank.map((preset, index) => {
  const state = applyOriginalParameters(createShapesState(), kind, preset.snapshot);
  return {
    id: `${kind}-${preset.id}`, label: `${preset.label} · ${state.selection.dimension.toUpperCase()} · ${state.selection.playingMode === "notes" ? "Corners & Notes · Percussion" : "Continuous"}`,
    description: preset.description, snapshot: validateShapesPreset(captureShapesPreset(state)),
    source: { kind, id: preset.id }, order: index / bank.length + group * 0.00001,
  };
})).sort((a, b) => a.order - b.order).map(({ order, ...preset }) => Object.freeze(preset)));

const tourModes = ["continuous", "notes", "triggers"];
// Keep the raw adapters/reference bank intact; only the performer-facing
// factory bank receives novice tuning. Saved/manual scenes never pass here.
const allScenes = [...SHAPES_IMPORTED_PRESETS, ...createShapesModeScenes().map(({ state, ...scene }) => ({
  ...scene, snapshot: captureShapesPreset(state),
}))].map(preset => ({ ...preset, snapshot: validateShapesPreset(captureShapesPreset(
  prepareShapesStarterSound(createShapesState(preset.snapshot.parameters)),
)) }));
// Begin with all four modes and distribute the scarcer modes through the tour.
export const SHAPES_FULL_PRESETS = Object.freeze(tourModes.flatMap((mode, group) => {
  let scenes = allScenes.filter(preset => preset.snapshot.parameters.selection.playingMode === mode);
  if (mode === "notes") scenes = [true, false].flatMap((percussion, group) => {
    const sounds = scenes.filter(preset => (preset.snapshot.parameters.voice.engine === "percussion") === percussion);
    return sounds.map((preset, index) => ({ preset, order: index / sounds.length + group * 0.00001 }));
  }).sort((a, b) => a.order - b.order).map(({ preset }) => preset);
  return scenes.map((preset, index) => ({ preset, order: index / scenes.length + group * 0.00001 }));
}).sort((a, b) => a.order - b.order).map(({ preset }) => Object.freeze(preset)));

export function randomizeShapesPreset(current, random = Math.random) {
  validateShapesPreset(current);
  const rng = presetRandom(random), state = createShapesState(current.parameters);
  // Generate a fresh scene level, never repeatedly attenuate the previous roll.
  // The separate user output level is still excluded from every snapshot.
  const originalLevel = rng.between(0.42, 0.6);
  // Generate every dimension's geometry from parameter schemas, never a factory row.
  const shape = randomizeShapePreset({ parameters: { ...captureShapePresetParameters(createShapeInitialState()), level: originalLevel } }, random);
  const originals = { shape };
  for (const [kind, initial] of [["solid", createSolidInitialState], ["hyper", createHyperInitialState]]) {
    originals[kind] = randomizeGeometryPreset(kind, captureGeometryPreset(kind, { ...initial(), level: originalLevel }, state.synthesis.envelope), random);
  }
  for (const kind of ["shape", "solid", "hyper"]) applyOriginalParameters(state, kind, originals[kind]);
  const kind = rng.pick(["shape", "solid", "hyper"]);
  applyOriginalParameters(state, kind, originals[kind]);
  state.selection.playingMode = rng.pick(tourModes);
  state.synthesis.model = state.selection.playingMode === "triggers" ? "shapes" : "geometry";
  if (state.selection.playingMode !== "triggers") state.voice.engine = rng.pick([
    "sine", "triangle", "square", "saw", "fm", "pm", "shepard", ...(state.selection.playingMode === "notes" ? ["percussion"] : []),
  ]);
  state.voice.character = rng.unit();
  state.play.divisions = rng.integer(1, 8);
  state.trigger = {
    soundBank: rng.pick(SHAPES_TRIGGER_SOUND_BANKS.map(bank => bank.id)), mapping: rng.pick(["feature", "position", "incidence"]),
    tuningDepth: rng.between(0, 24), characterDepth: rng.unit(), hitCap: rng.integer(1, 8),
    strength: rng.between(0.35, 0.7),
  };
  state.voice.spread = rng.unit();
  const attack = rng.between(12, 180), decay = attack + rng.between(70, 300);
  const hold = decay + rng.between(100, 500), release = hold + rng.between(150, 700);
  const sustain = rng.between(0.25, 0.8);
  state.notes = {
    preset: "custom", hitCap: rng.integer(1, 3), swell: rng.pick([false, true]),
    envelopePoints: [0, attack, decay, hold, release].map((ms, index) => ({ x: percussionEnvelopeEditorX(ms), y: [0, 1, sustain, sustain, 0][index] })),
  };
  ensurePlayableShapesRandom(state);
  prepareShapesStarterSound(state);
  return validateShapesPreset(captureShapesPreset(state));
}
