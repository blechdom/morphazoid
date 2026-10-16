import { registerHeaderPresets } from "../../site/header-presets.js";
import { clonePresetData } from "../../site/preset-random.js";
import { EXPERIMENT_PRESET_SPECS } from "./experiment-presets.js";

export function applyExperimentPreset(experiment, snapshot, { state, $ = () => null, painters = new Map(), hooks = {} }) {
  const spec = EXPERIMENT_PRESET_SPECS[experiment];
  spec.validate(snapshot);
  const values = clonePresetData(snapshot);
  const painted = new Set(painters.keys());
  for (const key of spec.keys) {
    if (key === "orbitalLevelProcessors") state.orbitalLevelProcessors = ["voice", ...values[key]];
    else state[key] = values[key];
  }
  for (const key of spec.keys) if (painted.has(key)) painters.get(key)();
  if (experiment === "moire") {
    const box = $("moireSecondPair");
    if (box) { box.checked = values.moireSecondPair; box.dispatchEvent(new Event("change")); }
  }
  if (experiment === "springs") hooks.ensureSpringState?.(true);
  if (experiment === "primes") hooks.resetPrimeSieve?.();
  if (experiment === "doublependulum") hooks.resetDoublePendulum?.();
  if (experiment === "reaction") hooks.resetReactionDiffusion?.();
  if (experiment === "orbitals") hooks.setOrbital?.(values.orbitalN, values.orbitalL, values.orbitalM);
  if (experiment === "dna") {
    const input = $("dnaSequence");
    if (input) input.value = values.dnaSequence;
    hooks.setDnaSequence?.(values.dnaSequence);
  }
  if (experiment === "neural") hooks.fireNeuralInput?.(values.neuralInput, false);
  if (experiment === "fourier") hooks.setFourierWave?.(values.fourierWave);
  if (experiment === "orbitalFerris") {
    hooks.invalidateOrbitalFerrisScene?.();
    hooks.updateOrbitalFerrisControls?.();
  }
  hooks.updateCommonAudio?.();
  hooks.updateSummaries?.();
}

export function registerExperimentPresets(context) {
  const spec = EXPERIMENT_PRESET_SPECS[context.experiment];
  if (!spec) return null;
  return registerHeaderPresets({
    id: spec.id, presets: spec.presets, randomize: spec.randomize,
    capture: () => spec.capture(context.state),
    apply: snapshot => applyExperimentPreset(context.experiment, snapshot, context),
  });
}
