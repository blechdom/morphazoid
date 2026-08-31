// Public entry point for the visual and advanced state catalogs plus their
// conditional GPU runtime. The aggregate keeps graph and engine imports in
// one place while the two registries remain independently testable.

import {
  SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_CASES,
  SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KINDS,
  SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KIND_SET,
  SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_MODULES,
  isShaderSynthPlaygroundVisualStateKind,
} from "./shader-synth-playground-visual-state.js";
import {
  SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_CASES,
  SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_KINDS,
  SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_MODULES,
  isShaderSynthPlaygroundAdvancedStateKind,
} from "./shader-synth-playground-advanced-state.js?v=20260831-modules125";

const freeze = (value) => Object.freeze(value);

export {
  SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_CASES,
  SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KINDS,
  SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KIND_SET,
  SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_MODULES,
  isShaderSynthPlaygroundVisualStateKind,
} from "./shader-synth-playground-visual-state.js";

export {
  SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_CASES,
  SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_KINDS,
  SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_KIND_SET,
  SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_MODULES,
  isShaderSynthPlaygroundAdvancedStateKind,
} from "./shader-synth-playground-advanced-state.js?v=20260831-modules125";

export const SHADER_SYNTH_PLAYGROUND_STATEFUL_CASES = /* wgsl */ `
${SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_CASES}
${SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_CASES}
`;

export const SHADER_SYNTH_PLAYGROUND_STATEFUL_KINDS = freeze({
  ...SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KINDS,
  ...SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_KINDS,
});

export const SHADER_SYNTH_PLAYGROUND_STATEFUL_MODULES = freeze([
  ...SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_MODULES,
  ...SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_MODULES,
]);

export const SHADER_SYNTH_PLAYGROUND_STATEFUL_KIND_SET = freeze(new Set(
  Object.values(SHADER_SYNTH_PLAYGROUND_STATEFUL_KINDS),
));

export function isShaderSynthPlaygroundStatefulKind(kind) {
  return isShaderSynthPlaygroundVisualStateKind(kind)
    || isShaderSynthPlaygroundAdvancedStateKind(kind);
}

export {
  SHADER_SYNTH_PLAYGROUND_STATE_ENGINE_KINDS,
  SHADER_SYNTH_PLAYGROUND_STATE_ENGINE_LIMITS,
  SHADER_SYNTH_PLAYGROUND_STATE_SHADER,
  SHADER_SYNTH_PLAYGROUND_STATE_SHADER as SHADER_SYNTH_PLAYGROUND_STATEFUL_SHADER,
  ShaderSynthPlaygroundStateEngine,
  isShaderSynthPlaygroundStateEngineKind,
  shaderSynthPlaygroundStateEngineNodes,
  shaderSynthPlaygroundStatePersistentByteSize,
} from "./shader-synth-playground-state-engine.js?v=20260831-modules125";
