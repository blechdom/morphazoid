import { createAmplitudeControl } from "../../amplitude-control.js";
import { createLinearControl } from "./controls.js";

const DEFAULTS = Object.freeze({ attack: 0.018, decay: 0.22, sustain: 0.8, release: 0.35 });
const STAGES = Object.freeze([
  { id: "attack", label: "Attack", min: 0.001, max: 12, step: 0.001, unit: "s" },
  { id: "decay", label: "Decay", min: 0.002, max: 12, step: 0.002, unit: "s" },
  { id: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01, unit: "%" },
  { id: "release", label: "Release", min: 0.003, max: 16, step: 0.003, unit: "s" },
]);
const LANES = Object.freeze({ attack: [.055, .29], decay: [.36, .58], release: [.77, .975] });
let nextId = 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const rounded = value => Number(value.toFixed(6));
const numberText = value => String(rounded(value));
const secondsText = value => value < 1 ? `${numberText(value * 1000)} ms` : `${numberText(value)} s`;

function normalized(input, fallback = DEFAULTS) {
  return Object.fromEntries(STAGES.map(stage => {
    const value = Number(input?.[stage.id]);
    return [stage.id, Number.isFinite(value) ? clamp(value, stage.min, stage.max) : fallback[stage.id]];
  }));
}

function encode(key, value) {
  const stage = STAGES.find(candidate => candidate.id === key);
  const [left, right] = LANES[key];
  return left + Math.log(clamp(value, stage.min, stage.max) / stage.min) / Math.log(stage.max / stage.min) * (right - left);
}

function decode(key, position) {
  const stage = STAGES.find(candidate => candidate.id === key);
  const [left, right] = LANES[key];
  const amount = (clamp(position, left, right) - left) / (right - left);
  return stage.min * (stage.max / stage.min) ** amount;
}

export function adsrPoints(input = DEFAULTS) {
  const value = normalized(input);
  return [
    { x: .022, y: .022 },
    { x: encode("attack", value.attack), y: 1 },
    { x: encode("decay", value.decay), y: value.sustain },
    { x: .675, y: value.sustain },
    { x: encode("release", value.release), y: 0 },
  ];
}

export function adsrFromPoints(points) {
  const fallback = adsrPoints(DEFAULTS);
  return normalized({
    attack: decode("attack", points?.[1]?.x ?? fallback[1].x),
    decay: decode("decay", points?.[2]?.x ?? fallback[2].x),
    sustain: clamp(points?.[3]?.y ?? points?.[2]?.y ?? DEFAULTS.sustain, 0, 1),
    release: decode("release", points?.[4]?.x ?? fallback[4].x),
  });
}

/** Shape-family five-node interaction adapted to Synthesaurus's gate ADSR. */
export const SYNTH_ADSR_EDITOR_MODEL = Object.freeze({
  labels: ["T", "A", "D", "S", "R"],
  fixedNodes: [0],
  presetPoints: () => adsrPoints(DEFAULTS),
  normalizePoints: points => adsrPoints(adsrFromPoints(points)),
  nodeAria(points, index) {
    const value = adsrFromPoints(points);
    if (index === 1) return { min: .001, max: 12, value: value.attack, orientation: "horizontal" };
    // Decay's breakpoint owns both time and sustain level, so it is a
    // two-dimensional button rather than pretending to be one ARIA slider.
    if (index === 2) return false;
    if (index === 3) return { min: 0, max: 1, value: value.sustain, orientation: "vertical" };
    if (index === 4) return { min: .003, max: 16, value: value.release, orientation: "horizontal" };
    return false;
  },
  moveNode(points, index, point) {
    const value = adsrFromPoints(points);
    if (index === 1) value.attack = decode("attack", point.x);
    if (index === 2) { value.decay = decode("decay", point.x); value.sustain = clamp(point.y, 0, 1); }
    if (index === 3) value.sustain = clamp(point.y, 0, 1);
    if (index === 4) value.release = decode("release", point.x);
    return adsrPoints(value);
  },
  describeNode(points, index) {
    const value = adsrFromPoints(points);
    return [
      "T · note gate opens",
      `A · Attack ${secondsText(value.attack)} · drag left/right`,
      `D · Decay ${secondsText(value.decay)} · sustain ${numberText(value.sustain * 100)}%`,
      `S · Sustain ${numberText(value.sustain * 100)}% until note off · drag up/down`,
      `R · Release ${secondsText(value.release)} · drag left/right`,
    ][index];
  },
  axis(points) {
    const value = adsrFromPoints(points);
    return [`A ${secondsText(value.attack)}`, `D ${secondsText(value.decay)}`, `S ${numberText(value.sustain * 100)}%`, `R ${secondsText(value.release)}`];
  },
  note: "T is the fixed trigger · drag A/D/R for time · drag D/S for sustain",
});

/** Mount a shared Shape-style graph plus four exact, always-visible fields. */
export function createEnvelopeEditor(host, { onChange = () => {} } = {}) {
  if (!host?.append) throw new TypeError("An envelope editor needs a host element.");
  const id = `synth-envelope-${++nextId}`;
  const root = document.createElement("div"); root.className = "synth-envelope";
  // The shared control owns its host's className while it renders. Keep our
  // instrument-specific styling hook on a stable wrapper around that host.
  const graph = document.createElement("div"); graph.className = "synth-envelope__shared";
  const sharedHost = document.createElement("div"); graph.append(sharedHost);
  const fields = document.createElement("div"); fields.className = "synth-envelope__fields";
  root.append(graph, fields); host.append(root);
  let value = { ...DEFAULTS }, syncing = false, destroyed = false;
  let controls = [];
  const shared = createAmplitudeControl(sharedHost, {
    label: "Amplitude shape · T/A/D/S/R",
    presets: [], showLevel: false, allowDisable: false,
    editorModel: SYNTH_ADSR_EDITOR_MODEL,
    onChange(controller) {
      if (syncing || destroyed) return;
      value = adsrFromPoints(controller.state.points);
      controls.forEach((control, index) => {
        const stage = STAGES[index];
        control.setValue(value[stage.id] * (stage.id === "sustain" ? 100 : 1));
      });
      onChange({ ...value });
    },
  });
  const syncGraph = () => {
    syncing = true;
    shared.applyState({ enabled: true, preset: "custom", level: 1, points: adsrPoints(value) });
    syncing = false;
  };
  controls = STAGES.map(stage => {
    const percent = stage.id === "sustain";
    const control = createLinearControl({
      id: `${id}-${stage.id}`, editorId: `${id}-${stage.id}-value`, label: stage.label,
      min: stage.min, max: percent ? 100 : stage.max, step: percent ? .1 : "any",
      unit: stage.unit, scale: percent ? "linear" : "log",
      value: value[stage.id] * (percent ? 100 : 1),
      formatValue: raw => percent ? `${Number(raw.toFixed(1))}%` : secondsText(raw),
      onInput: raw => {
        value = { ...value, [stage.id]: rounded(raw / (percent ? 100 : 1)) };
        syncGraph(); onChange({ ...value });
      },
    });
    control.classList.add("synth-envelope__field");
    control.dataset.stage = stage.id;
    control.editor.classList.add("synth-envelope__number");
    control.editor.dataset.stage = stage.id;
    fields.append(control);
    return control;
  });
  syncGraph();
  return Object.freeze({
    setValue(envelope) {
      if (destroyed) return;
      value = normalized(envelope, value);
      controls.forEach((control, index) => {
        const stage = STAGES[index];
        control.setValue(value[stage.id] * (stage.id === "sustain" ? 100 : 1));
      });
      syncGraph();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      shared.destroy(); controls.forEach(control => control.destroy()); root.remove();
    },
  });
}
