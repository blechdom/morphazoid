import { createShapesState, setShapes2dHeadCount } from "../../shapes-state.js";
import { SHAPE_FULL_PRESETS } from "../shape-synth/full-presets.js";
import { SOLID_FULL_PRESETS, HYPER_FULL_PRESETS } from "../../families/geometry-presets/full-presets.js";
import { applyOriginalParameters } from "./parameter-bridge.js";
import { percussionEnvelopeEditorX } from "../../audio.js";

const NOTE_ARTICULATIONS = {
  "square-ticks": ["sine", [0, 18, 100, 260, 700], 0.45, 2],
  "box-bells": ["fm", [0, 8, 90, 180, 850], 0.2, 2, 2.4, 3.5],
  "folded-notes": ["pm", [0, 65, 240, 520, 1200], 0.6, 2, 2, 1.5],
  "star-stagger": ["fm", [0, 12, 80, 160, 450], 0.3, 2, 1.1, 2],
  "prism-skips": ["sine", [0, 35, 140, 360, 900], 0.5, 2],
  "klein-drops": ["fm", [0, 80, 280, 650, 1600], 0.55, 1, 0.7, 1],
  "crossed-pips": ["pm", [0, 15, 90, 230, 560], 0.2, 2, 2.8, 2.5],
  "eight-facets": ["pm", [0, 12, 100, 220, 1000], 0.35, 2, 2.8, 3],
  "pyramid-notes": ["fm", [0, 22, 120, 300, 650], 0.42, 2, 1.8, 0.5],
  "bent-line-notes": ["sine", [0, 160, 440, 900, 1700], 0.7, 1],
  "torus-dots": ["fm", [0, 100, 260, 720, 1500], 0.65, 1, 0.8, 1.03],
  "sphere-beads": ["shepard", [0, 140, 350, 750, 1400], 0.6, 1],
};

const banks = { shape: SHAPE_FULL_PRESETS, solid: SOLID_FULL_PRESETS, hyper: HYPER_FULL_PRESETS };
function scene(kind, sourceId, mode, id, name, settings) {
  const original = banks[kind].find(preset => preset.id === sourceId);
  const state = applyOriginalParameters(createShapesState(), kind, original.snapshot);
  state.selection.playingMode = mode;
  state.synthesis.model = mode === "notes" ? "geometry" : "shapes";
  Object.assign(state.play, { running: true, rateCyclesPerSecond: settings.speed, divisions: settings.divisions, direction: settings.direction ?? 1 });
  for (const local of Object.values(state.dimension)) {
    local.rotationRunning = false;
    if (typeof local.rotationMotion === "object") for (const motion of Object.values(local.rotationMotion)) motion.running = false;
  }
  if (settings.heads) setShapes2dHeadCount(state, settings.heads);
  if (settings.offsets) state.dimension["2d"].headOffsets = settings.offsets;
  Object.assign(state.voice, {
    engine: "sine", baseHz: settings.baseHz ?? 110, rangeOctaves: settings.range ?? 2.5,
    character: settings.character ?? 0.4, spread: settings.spread ?? 0.85, presetLevel: 0.5,
  });
  Object.assign(state.trigger, {
    soundBank: settings.bank ?? "rattlesnake", mapping: settings.mapping ?? "feature",
    tuningDepth: settings.tuning ?? 12, characterDepth: settings.character ?? 0.4, hitCap: settings.hits ?? 2,
    strength: 0.75,
  });
  if (mode === "notes") {
    const [engine, times, sustain, hitCap, index = 1, ratio = 1] = NOTE_ARTICULATIONS[id];
    state.voice.engine = engine;
    state.voice.voiceLimit = kind === "hyper" ? 20 : 32;
    state.notes = {
      preset: "custom", hitCap, swell: ["folded-notes", "bent-line-notes", "torus-dots"].includes(id),
      envelopePoints: times.map((time, i) => ({ x: percussionEnvelopeEditorX(time), y: [0, 1, sustain, sustain, 0][i] })),
    };
    Object.assign(state.synthesis.tone, { fmIndex: index, fmRatio: ratio, pmIndex: index, pmRatio: ratio });
    if (["sphere-beads", "klein-drops", "torus-dots"].includes(id)) {
      state.play.rateCyclesPerSecond = 0.16; state.play.divisions = 1;
    }
  }
  return {
    id: `shapes-${id}`, label: `${name} · ${state.selection.dimension.toUpperCase()} · ${mode === "notes" ? `Corners & Notes · ${state.voice.engine.toUpperCase()}` : "Triggers"}`,
    description: mode === "notes"
      ? "Polyphonic synth notes with their own editable ADSR tails. Corners at one subdivision; extra notes between them at higher subdivisions. Audio stays under your control."
      : `${state.trigger.soundBank === "fm-kit" ? "FM drum kit" : "Rattlesnake percussion"} at reader divisions. Playhead only; Audio stays under your control.`,
    source: { kind: "shapes", id }, state,
  };
}
export function createShapesModeScenes() {
  return [
    scene("shape", "square-study", "notes", "square-ticks", "Square ticks", { speed: 0.45, divisions: 2, baseHz: 130, heads: 1 }),
    scene("solid", "original-cube", "notes", "box-bells", "Box bells", { speed: 0.5, divisions: 2, baseHz: 98, range: 2 }),
    scene("hyper", "original-tesseract", "notes", "folded-notes", "Folded notes", { speed: 0.35, divisions: 2, baseHz: 82, range: 3 }),
    scene("shape", "glass-star", "notes", "star-stagger", "Staggered star", { speed: 0.24, divisions: 2, heads: 2, offsets: [0, 0.31], baseHz: 165 }),
    scene("solid", "prism-brass", "notes", "prism-skips", "Prism skips", { speed: 0.6, divisions: 3, baseHz: 110, direction: -1 }),
    scene("hyper", "klein-reed", "notes", "klein-drops", "Klein drops", { speed: 0.2, divisions: 1, baseHz: 147, range: 1.8 }),
    scene("shape", "crossed-scanners", "notes", "crossed-pips", "Crossed pips", { speed: 0.38, divisions: 3, heads: 2, baseHz: 98, character: 0.15 }),
    scene("solid", "octahedron-chimes", "notes", "eight-facets", "Eight facets", { speed: 0.48, divisions: 4, baseHz: 196, range: 1.5 }),
    scene("hyper", "pyramid-knocks", "notes", "pyramid-notes", "Pyramid notes", { speed: 0.55, divisions: 3, baseHz: 65, range: 2.2 }),
    scene("shape", "bowed-line-reel", "notes", "bent-line-notes", "Bent-line notes", { speed: 0.65, divisions: 6, heads: 2, baseHz: 82 }),
    scene("solid", "torus-beating", "notes", "torus-dots", "Torus dots", { speed: 0.26, divisions: 2, baseHz: 130, range: 2 }),
    scene("hyper", "endless-hypersphere", "notes", "sphere-beads", "Sphere beads", { speed: 0.3, divisions: 2, baseHz: 110, range: 2.8 }),
    scene("shape", "square-study", "triggers", "box-drum", "Box drum", { speed: 0.5, divisions: 2, heads: 1, bank: "fm-kit", mapping: "position", hits: 1, character: 0.35 }),
    scene("solid", "original-cube", "triggers", "wooden-cube", "Wooden cube", { speed: 0.3, divisions: 2, hits: 2, character: 0.15, tuning: 8 }),
    scene("hyper", "original-tesseract", "triggers", "four-d-kit", "Four-dimensional kit", { speed: 0.3, divisions: 1, bank: "fm-kit", hits: 2, mapping: "feature", tuning: 7 }),
    scene("shape", "glass-star", "triggers", "star-rattle", "Star rattle", { speed: 0.2, divisions: 1, heads: 2, offsets: [0, 0.37], hits: 1, character: 0.65 }),
    scene("solid", "prism-brass", "triggers", "prism-kit", "Prism kit", { speed: 0.4, divisions: 2, bank: "fm-kit", hits: 2, mapping: "incidence", character: 0.4 }),
    scene("hyper", "pyramid-knocks", "triggers", "folded-wood", "Folded wood", { speed: 0.4, divisions: 2, hits: 1, tuning: 16, character: 0.25 }),
    scene("shape", "crossed-scanners", "triggers", "crossed-kit", "Crossed kit", { speed: 0.25, divisions: 2, heads: 2, bank: "fm-kit", hits: 2, mapping: "position", character: 0.5 }),
    scene("solid", "cone-reed", "triggers", "cone-rattle", "Cone rattle", { speed: 0.32, divisions: 1, hits: 1, tuning: 18, character: 0.7 }),
    scene("hyper", "klein-reed", "triggers", "klein-kit", "Klein kit", { speed: 0.16, divisions: 1, bank: "fm-kit", hits: 1, mapping: "position", tuning: 5 }),
    scene("shape", "bowed-line-reel", "triggers", "line-rattle", "Line rattle", { speed: 0.6, divisions: 5, heads: 2, hits: 1, tuning: 20, character: 0.5 }),
    scene("solid", "octahedron-chimes", "triggers", "facet-kit", "Facet kit", { speed: 0.42, divisions: 2, bank: "fm-kit", hits: 2, mapping: "feature", character: 0.6 }),
    scene("hyper", "endless-hypersphere", "triggers", "sphere-rattle", "Sphere rattle", { speed: 0.18, divisions: 1, hits: 1, tuning: 10, character: 0.3 }),
    scene("shape", "square-study", "triggers", "rattle-square-four", "Four-step square rattle", { speed: 0.22, divisions: 4, heads: 1, hits: 1, tuning: 9, character: 0.25 }),
    scene("shape", "triangle-pad", "triggers", "rattle-triangle-six", "Six-step triangle rattle", { speed: 0.25, divisions: 6, heads: 2, hits: 1, tuning: 16, character: 0.5 }),
    scene("solid", "original-cube", "triggers", "rattle-cube-four", "Four-cut wooden cube", { speed: 0.2, divisions: 4, hits: 1, tuning: 7, character: 0.2 }),
    scene("solid", "prism-brass", "triggers", "rattle-prism-five", "Five-cut prism rattle", { speed: 0.18, divisions: 5, hits: 1, tuning: 18, character: 0.6 }),
    scene("hyper", "original-tesseract", "triggers", "rattle-tesseract-four", "Four-fold tesseract rattle", { speed: 0.14, divisions: 4, hits: 1, tuning: 12, character: 0.4 }),
    scene("hyper", "pyramid-knocks", "triggers", "rattle-pyramid-six", "Six-fold pyramid rattle", { speed: 0.16, divisions: 6, hits: 1, tuning: 20, character: 0.55 }),
  ];
}
