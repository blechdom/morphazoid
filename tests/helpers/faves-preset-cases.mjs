import { SOLID_FULL_PRESETS, HYPER_FULL_PRESETS, validateGeometryPreset, randomizeGeometryPreset } from "../../src/families/geometry-presets/full-presets.js";
import { RUBIX_FULL_PRESETS, validateRubixFullPreset, randomizeRubixPreset } from "../../src/instruments/rubix/full-presets.js";
import { HYBRINX_FULL_PRESETS, validateHybrinxFullPreset, randomizeHybrinxPreset } from "../../src/families/syrinx/full-presets.js";
import { JAW_HARP_FULL_PRESETS, validateJawHarpPreset, randomizeJawHarpPreset } from "../../src/instruments/jaw-harp/full-presets.js";
import { HYPER_RUBIX_FULL_PRESETS, validateHyperRubixPreset, randomizeHyperRubixPreset } from "../../src/instruments/hyper-rubix/full-presets.js";
import { MICMIC_FULL_PRESETS, L_SYSTEM_FULL_PRESETS, validateMicmicPreset, validateLSystemPreset, randomizeMicmicPreset, randomizeLSystemPreset } from "../../src/families/branch-presets/full-presets.js";
import { GRAPH_DELAY_FULL_PRESETS, graphSynthFullPresets, validateGraphDelayPreset, validateGraphSynthPreset, randomizeGraphDelayPreset, randomizeGraphSynthPreset } from "../../src/families/graph-presets/full-presets.js";
import { graphInstrumentDefaultState } from "../../src/families/graph/graph-instrument-app.js";
import { AUTOMATA_FULL_PRESETS, validateAutomataPreset, randomizeAutomataPreset } from "../../src/families/experiments/automata-presets.js";
import { LATTICE_FULL_PRESETS, validateLatticePreset, randomizeLatticePreset } from "../../src/instruments/lattice/full-presets.js";
const graphDefaults = graphInstrumentDefaultState();
export const FAVES_PRESET_CASES = [
  ["solid-synth", SOLID_FULL_PRESETS, s => validateGeometryPreset("solid", s), (s, r) => randomizeGeometryPreset("solid", s, r)],
  ["hyper-synth", HYPER_FULL_PRESETS, s => validateGeometryPreset("hyper", s), (s, r) => randomizeGeometryPreset("hyper", s, r)],
  ["rubix", RUBIX_FULL_PRESETS, validateRubixFullPreset, randomizeRubixPreset],
  ["hybrinx", HYBRINX_FULL_PRESETS, validateHybrinxFullPreset, randomizeHybrinxPreset],
  ["jaw-harp", JAW_HARP_FULL_PRESETS, validateJawHarpPreset, randomizeJawHarpPreset],
  ["hyper-rubix", HYPER_RUBIX_FULL_PRESETS, validateHyperRubixPreset, randomizeHyperRubixPreset],
  ["micmic", MICMIC_FULL_PRESETS, validateMicmicPreset, randomizeMicmicPreset],
  ["l-system", L_SYSTEM_FULL_PRESETS, validateLSystemPreset, randomizeLSystemPreset],
  ["graph-delay", GRAPH_DELAY_FULL_PRESETS, validateGraphDelayPreset, randomizeGraphDelayPreset],
  ["graph-synth", graphSynthFullPresets(graphDefaults), s => validateGraphSynthPreset(s, graphDefaults), randomizeGraphSynthPreset],
  ["cellular-automata", AUTOMATA_FULL_PRESETS, validateAutomataPreset, randomizeAutomataPreset],
  ["lattice", LATTICE_FULL_PRESETS, validateLatticePreset, randomizeLatticePreset],
].map(([id, bank, validate, randomize]) => ({
  id, bank, validate, randomize, href: id === "cellular-automata" ? "automatapoeia.html" : `${id}.html`,
}));
