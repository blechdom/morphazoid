const clamp = (value, minimum = 0, maximum = 1) => {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
};

const anatomy = (id, label, description, values) => Object.freeze({
  id,
  label,
  description,
  ...values,
});

// Reduced-order priors. They describe relative reach and shaping capacity inside
// a host tract, not literal transplantation dimensions.
export const TONGUE_ANATOMIES = Object.freeze({
  human: anatomy(
    "human",
    "Human muscular hydrostat",
    "A thick, rounded body with independent tip control and the largest modeled oral constriction range.",
    { reach: [0.38, 0.9], bodyWidth: 0.145, bodyDepth: 0.86, tipDepth: 0.58, compensation: 0.18 },
  ),
  macaque: anatomy(
    "macaque",
    "Macaque muscular hydrostat",
    "A primate tongue with broad vowel-capable motion, slightly flatter and less apically independent in this reduced model.",
    { reach: [0.36, 0.86], bodyWidth: 0.17, bodyDepth: 0.74, tipDepth: 0.38, compensation: 0.16 },
  ),
  canine: anatomy(
    "canine",
    "Canine long tongue",
    "A long, comparatively narrow tongue that strongly opens and damps the front cavity but makes softer palatal constrictions.",
    { reach: [0.42, 0.94], bodyWidth: 0.12, bodyDepth: 0.58, tipDepth: 0.26, compensation: 0.12 },
  ),
  avian: anatomy(
    "avian",
    "Avian slender tongue",
    "A small floor-mounted articulator: useful for subtle beak-cavity tuning, with limited occlusion in the model.",
    { reach: [0.56, 0.96], bodyWidth: 0.1, bodyDepth: 0.34, tipDepth: 0.18, compensation: 0.08 },
  ),
});

export const DEFAULT_TONGUE_STATE = Object.freeze({
  tongueEnabled: true,
  tongueAnatomy: "human",
  tonguePosition: 0.5,
  tongueHeight: 0.56,
  tongueShape: 0.48,
  tongueTip: 0.3,
});

export function sanitizeTongueState(value = {}, fallback = DEFAULT_TONGUE_STATE) {
  const anatomyId = Object.hasOwn(TONGUE_ANATOMIES, value.tongueAnatomy)
    ? value.tongueAnatomy
    : fallback.tongueAnatomy;
  return {
    tongueEnabled: value.tongueEnabled == null
      ? Boolean(fallback.tongueEnabled)
      : Boolean(value.tongueEnabled),
    tongueAnatomy: anatomyId,
    tonguePosition: clamp(value.tonguePosition ?? fallback.tonguePosition),
    tongueHeight: clamp(value.tongueHeight ?? fallback.tongueHeight),
    tongueShape: clamp(value.tongueShape ?? fallback.tongueShape),
    tongueTip: clamp(value.tongueTip ?? fallback.tongueTip),
  };
}

const gaussian = (value, center, width) => {
  const normalized = (value - center) / Math.max(0.01, width);
  return Math.exp(-0.5 * normalized * normalized);
};

export function tongueGeometry(configuration = {}) {
  const state = sanitizeTongueState(configuration);
  const prior = TONGUE_ANATOMIES[state.tongueAnatomy];
  const center = prior.reach[0]
    + (prior.reach[1] - prior.reach[0]) * state.tonguePosition;
  const width = prior.bodyWidth * (1.28 - state.tongueShape * 0.64);
  const tipCenter = Math.min(0.975, Math.max(center + width * 0.72, 0.78 + state.tongueTip * 0.17));
  return Object.freeze({ state, prior, center, width, tipCenter });
}

/**
 * Applies a volume-compensated, two-constriction tongue field to one tube cell.
 * A broad Gaussian represents tongue body displacement, a narrow Gaussian the
 * tip, and two low shoulders add back some displaced volume. This is the
 * real-time reduction of the much heavier nearly-incompressible FE problem.
 */
export function applyTongueToDiameter(position, baseDiameter, configuration = {}) {
  const base = Math.max(0.001, Number(baseDiameter) || 0.001);
  const { state, prior, center, width, tipCenter } = tongueGeometry(configuration);
  if (!state.tongueEnabled) return base;

  const x = clamp(position);
  const body = gaussian(x, center, width);
  const tip = gaussian(x, tipCenter, 0.032 + (1 - state.tongueShape) * 0.026);
  const shoulderDistance = width * 1.45;
  const shoulders = 0.5 * (
    gaussian(x, Math.max(0.32, center - shoulderDistance), width * 0.8)
    + gaussian(x, Math.min(0.98, center + shoulderDistance), width * 0.8)
  );
  const bodyOcclusion = state.tongueHeight * prior.bodyDepth * body;
  const tipOcclusion = state.tongueTip * prior.tipDepth * tip;
  const occlusion = Math.min(0.93, bodyOcclusion + tipOcclusion);
  const compensation = 1 + prior.compensation * state.tongueHeight * shoulders * (1 - body);
  return Math.max(0.001, base * (1 - occlusion) * compensation);
}

export function tongueCavityGuides(tractLengthM, configuration = {}) {
  const length = clamp(tractLengthM, 0.018, 0.82);
  const { state, center } = tongueGeometry(configuration);
  const speedOfSound = 343;
  const rearLength = Math.max(0.006, length * center);
  const frontLength = Math.max(0.006, length * (1 - center));
  return Object.freeze({
    enabled: state.tongueEnabled,
    constriction: center,
    rearQuarterWaveHz: speedOfSound / (4 * rearLength),
    frontQuarterWaveHz: speedOfSound / (4 * frontLength),
  });
}

