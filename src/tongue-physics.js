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
  tongueExtension: 0.08,
  tongueCurl: 0.5,
  tongueLateral: 0.12,
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
    tongueExtension: clamp(value.tongueExtension ?? fallback.tongueExtension ?? 0.08),
    tongueCurl: clamp(value.tongueCurl ?? fallback.tongueCurl ?? 0.5),
    tongueLateral: clamp(value.tongueLateral ?? fallback.tongueLateral ?? 0.12),
  };
}

const gaussian = (value, center, width) => {
  const normalized = (value - center) / Math.max(0.01, width);
  return Math.exp(-0.5 * normalized * normalized);
};

export function tongueGeometry(configuration = {}) {
  const state = sanitizeTongueState(configuration);
  const prior = TONGUE_ANATOMIES[state.tongueAnatomy];
  const naturalCenter = prior.reach[0]
    + (prior.reach[1] - prior.reach[0]) * state.tonguePosition;
  const center = Math.min(0.992, naturalCenter + state.tongueExtension * 0.075);
  const width = prior.bodyWidth
    * (1.28 - state.tongueShape * 0.64)
    * (1 - state.tongueExtension * 0.34);
  const curlLift = (state.tongueCurl - 0.5) * 0.15;
  const tipCenter = Math.min(
    0.997,
    Math.max(center + width * 0.72, 0.78 + state.tongueTip * 0.17 + curlLift),
  );
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
  const curlLift = clamp((state.tongueCurl - 0.5) * 2);
  const effectiveTip = clamp(state.tongueTip + curlLift * 0.34);
  const bodyOcclusion = state.tongueHeight * prior.bodyDepth * body;
  const tipOcclusion = effectiveTip * prior.tipDepth * tip;

  // The old model deliberately stopped at 93% occlusion, which made tongue
  // contact incapable of behaving like a playable valve. A high focused body
  // or curled tip now enters a contact regime. Lateral opening leaves a
  // controllable side channel so an L can stay voiced without becoming T.
  const bodyContact = clamp((state.tongueHeight - 0.76) / 0.24)
    * (0.58 + state.tongueShape * 0.42)
    * body;
  const tipContact = clamp((effectiveTip - 0.72) / 0.28)
    * (0.52 + state.tongueShape * 0.48)
    * tip;
  const ordinaryOcclusion = clamp(bodyOcclusion + tipOcclusion, 0, 0.965);
  const contactOcclusion = 1 - (1 - bodyContact) * (1 - tipContact);
  const lateralFloor = 0.0025 + state.tongueLateral * 0.22;
  const occlusion = Math.min(
    1 - lateralFloor,
    1 - (1 - ordinaryOcclusion) * (1 - contactOcclusion),
  );
  const compensation = 1 + prior.compensation * state.tongueHeight * shoulders * (1 - body);
  return Math.max(0.001, base * (1 - occlusion) * compensation);
}

/**
 * A normalized valve opening derived from the tightest tongue section. Values
 * below the contact threshold become a true worklet valve; ordinary vowel
 * constrictions remain fully open at the valve layer and are shaped by the
 * area function above.
 */
export function tongueAirwayAperture(configuration = {}) {
  return tongueAirwayState(configuration).aperture;
}

/**
 * Resolve the tightest active articulator once per configuration update. The
 * worklet caches this result; scanning a whole tract at audio rate is far too
 * expensive and made the multi-tongue path prone to dropouts.
 */
export function tongueAirwayState(configuration = {}) {
  if (configuration.tongueEnabled === false) {
    return Object.freeze({ aperture: 1, position: 0.5, minimumRatio: 1 });
  }
  let minimumRatio = 1;
  let position = 0.5;
  for (let index = 0; index <= 80; index += 1) {
    const samplePosition = index / 80;
    const ratio = applyTonguesToDiameter(samplePosition, 1, configuration);
    if (ratio < minimumRatio) {
      minimumRatio = ratio;
      position = samplePosition;
    }
  }
  const amount = clamp((minimumRatio - 0.028) / 0.24);
  return Object.freeze({
    aperture: amount * amount * (3 - 2 * amount),
    position,
    minimumRatio,
  });
}

function arrayTongueState(tongue = {}, fallback = {}) {
  return {
    tongueEnabled: tongue.tongueEnabled ?? true,
    tongueAnatomy: tongue.tongueAnatomy ?? fallback.tongueAnatomy ?? "human",
    tonguePosition: tongue.tonguePosition ?? tongue.position ?? fallback.tonguePosition,
    tongueHeight: tongue.tongueHeight ?? tongue.height ?? fallback.tongueHeight,
    tongueShape: tongue.tongueShape ?? tongue.curl ?? fallback.tongueShape,
    tongueTip: tongue.tongueTip ?? tongue.curl ?? fallback.tongueTip,
    tongueExtension: tongue.tongueExtension ?? tongue.extension ?? fallback.tongueExtension,
    tongueCurl: tongue.tongueCurl ?? tongue.curl ?? fallback.tongueCurl,
    tongueLateral: tongue.tongueLateral ?? tongue.lateral ?? fallback.tongueLateral,
  };
}

/**
 * Combine a small bank of articulators without letting stacked constrictions
 * collapse the tube. The first tongue keeps its full vowel shape; additional
 * tongues contribute progressively softer, spatially independent closures.
 */
export function applyTonguesToDiameter(position, baseDiameter, configuration = {}) {
  const base = Math.max(0.001, Number(baseDiameter) || 0.001);
  if (configuration.tongueEnabled === false) return base;
  const requested = Math.round(Number(configuration.tongueCount));
  const tongues = Array.isArray(configuration.tongues) ? configuration.tongues : [];
  const count = Math.min(
    5,
    Math.max(1, Number.isFinite(requested) ? requested : tongues.length || 1),
  );
  if (!tongues.length) return applyTongueToDiameter(position, base, configuration);

  const first = applyTongueToDiameter(
    position,
    base,
    arrayTongueState(tongues[0], configuration),
  );
  if (count === 1) return first;

  let openRatio = first / base;
  const extraWeight = count > 1 ? 0.62 / Math.sqrt(count - 1) : 0;
  for (let index = 1; index < count; index += 1) {
    const tongue = tongues[index] ?? tongues[0];
    const shaped = applyTongueToDiameter(
      position,
      base,
      arrayTongueState(tongue, configuration),
    );
    const occlusion = clamp(1 - shaped / base);
    openRatio *= 1 - occlusion * extraWeight;
  }
  return Math.max(0.001, base * Math.max(0.05, openRatio));
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
