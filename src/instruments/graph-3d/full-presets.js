import { GRAPH_3D_DEFAULTS, GRAPH_3D_LAYOUTS, GRAPH_3D_SCENES, GRAPH_3D_SOURCES, GRAPH_3D_TOPOLOGIES, Graph3DModel, sanitize3DSettings } from "./graph-3d.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const GRAPH_3D_PRESET_KEYS = Object.freeze(["settings", "pins", "enabled"]);
const POSITION_LIMIT = 0.92;

export function captureGraph3DPreset(model) {
  return {
    settings: { ...model.settings },
    pins: model.nodes.flatMap(({ id, x, y, z, pinned }) => (pinned ? [{ id, x, y, z }] : [])),
    enabled: model.edges.map(edge => edge.enabled),
  };
}

export function validateGraph3DPreset(snapshot) {
  try {
    presetStateKey(snapshot);
    const { settings, pins, enabled } = snapshot;
    if (Object.keys(snapshot).length !== GRAPH_3D_PRESET_KEYS.length
      || Object.keys(settings).length !== Object.keys(GRAPH_3D_DEFAULTS).length
      || presetStateKey(sanitize3DSettings(settings)) !== presetStateKey(settings)) throw new TypeError("settings");
    const model = new Graph3DModel(settings);
    if (!Array.isArray(enabled) || enabled.length !== model.edges.length || enabled.some(value => typeof value !== "boolean")) throw new TypeError("routes");
    if (!Array.isArray(pins) || pins.some((pin, index) => !Number.isInteger(pin.id) || pin.id < 0 || pin.id >= model.nodes.length
      || (index > 0 && pin.id <= pins[index - 1].id) || ["x", "y", "z"].some(axis => !(Math.abs(pin[axis]) <= POSITION_LIMIT)))) throw new TypeError("pins");
  } catch {
    throw new TypeError("Invalid complete 3D Graph preset");
  }
  return snapshot;
}

/** Payload for Graph3DModel.restore; unpinned nodes keep their generated arrangement. */
export function graph3DRestorePayload(snapshot) {
  validateGraph3DPreset(snapshot);
  const model = new Graph3DModel(snapshot.settings);
  for (const { id, x, y, z } of snapshot.pins) Object.assign(model.nodes[id], { x, y, z, pinned: true });
  return { version: 1, settings: { ...snapshot.settings }, nodes: model.nodes.map(({ x, y, z, pinned }) => ({ x, y, z, pinned })), enabled: [...snapshot.enabled] };
}

const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fromScene = (name, edit = () => ({})) => {
  const settings = sanitize3DSettings(GRAPH_3D_SCENES[name]);
  const model = new Graph3DModel(settings);
  const { pins, enabled } = edit(model) ?? {};
  return { settings, pins: pins ?? [], enabled: enabled ?? model.edges.map(() => true) };
};
const entry = (label, snapshot, id = slug(label)) => Object.freeze({ id, label, snapshot: Object.freeze(validateGraph3DPreset(snapshot)) });
const sceneEntry = name => entry(name, fromScene(name));

export const GRAPH_3D_FULL_PRESETS = Object.freeze([
  ...["Orbital branches", "Helical return", "Floating canopy", "Elastic cube", "Flat to folded", "Turning constellation",
    "Glass meridian", "Low orbit", "Wire rain", "Slow prism", "Shell choir", "Taut metal"].map(sceneEntry),
  entry("Orbital branches · gated routes", fromScene("Orbital branches", model => ({
    enabled: model.edges.map((_, index) => index % 3 !== 1),
  }))),
  entry("Velvet helix · anchored", fromScene("Velvet helix", () => ({
    pins: [{ id: 0, x: -0.8, y: -0.6, z: 0.3 }, { id: 5, x: 0.7, y: 0.5, z: -0.4 }],
  }))),
]);

const pickSource = (rng, withBend = false) => rng.pick([...Object.keys(GRAPH_3D_SOURCES), ...(withBend ? ["bend"] : [])]);
const round = (value, digits) => Number(value.toFixed(digits));

export function randomizeGraph3DPreset(current, random = Math.random) {
  validateGraph3DPreset(current);
  const rng = presetRandom(random);
  for (let attempt = 0; attempt < 8; attempt++) {
    const settings = sanitize3DSettings({
      topology: rng.pick(GRAPH_3D_TOPOLOGIES), layout: rng.pick(GRAPH_3D_LAYOUTS), nodeCount: rng.integer(4, 20 - attempt * 2),
      density: round(rng.between(0, 0.5), 2), seed: rng.integer(1, 9999), depth: round(rng.between(0, 1.3), 2),
      twist: round(rng.between(-1, 1), 2), repel: round(rng.between(0, 1), 2), spring: round(rng.between(0.15, 0.95), 2),
      gravity: round(rng.between(0, 1), 2), shell: round(rng.between(0, 1), 2), motion: rng.unit() < 0.35,
      tempo: Math.round(Math.exp(rng.between(Math.log(40), Math.log(200)))), pulseBeats: rng.pick([0.5, 1, 2, 4, 8]),
      baseDelay: Math.round(rng.between(25, 380)), distanceRatio: round(rng.between(1, 8), 1),
      feedback: round(rng.between(0, 0.88), 2), feedbackTone: round(rng.between(0.25, 1), 2),
      rootMidiNote: rng.integer(36, 84), pitchRange: round(rng.between(0.2, 3.5), 2),
      mapping: pickSource(rng, true), soundMode: rng.pick(["sine", "triangle", "fm", "pm", "shepard"]),
      modulationIndex: round(rng.between(0, 4), 2), strain: round(rng.between(0, 1), 2),
      depthTone: round(rng.between(0, 1), 2), spread: round(rng.between(0, 1), 2),
      attack: round(rng.between(0.002, 0.35), 3), decay: round(rng.between(0.06, 1.4), 2),
      tuning: rng.pick(["free", "chromatic", "pentatonic", "minor"]),
      timeSource: pickSource(rng), timbreSource: pickSource(rng), shadeSource: pickSource(rng), panSource: pickSource(rng),
    });
    let model;
    try { model = new Graph3DModel(settings); } catch { continue; }
    const enabled = model.edges.map(() => rng.unit() < 0.88);
    if (enabled.length && !enabled.some(Boolean)) enabled[rng.integer(0, enabled.length - 1)] = true;
    const pinCount = rng.integer(0, Math.min(2, model.nodes.length));
    const ids = [];
    while (ids.length < pinCount) {
      const id = rng.integer(0, model.nodes.length - 1);
      if (!ids.includes(id)) ids.push(id);
    }
    const pins = ids.sort((a, b) => a - b).map(id => ({
      id, x: round(rng.between(-0.85, 0.85), 3), y: round(rng.between(-0.85, 0.85), 3), z: round(rng.between(-0.85, 0.85), 3),
    }));
    return validateGraph3DPreset({ settings, pins, enabled });
  }
  throw new TypeError("Could not randomize a valid 3D Graph");
}
