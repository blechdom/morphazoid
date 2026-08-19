import {
  WEBGPU_303_BUFFER_PARAM_ORDER,
  WEBGPU_303_DEFAULTS,
  WEBGPU_303_SEQUENCE_LENGTH,
  WEBGPU_303_STEP_MODULATION_LIMITS,
  sanitizeWebGpu303Params,
} from "./webgpu-303.js";
import {
  HYPER_RUBIX_AXES,
  createHyperRubixStickerStream,
  hyperRubixDisorder,
  hyperRubixSizeMetrics,
  rotateHyperRubixPoint4,
} from "./hyper-rubix.js";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finiteOr = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const RADIAL_VALUE = Object.freeze({
  center: 0,
  face: 1 / 3,
  edge: 2 / 3,
  corner: 1,
});

const DEFAULT_ROTATION = Object.freeze({
  xy: 0,
  xz: 0,
  xw: 0,
  yz: 0,
  yw: 0,
  zw: 0,
});

/**
 * A lower-output acid patch with enough headroom for eight-cell geometry to
 * add resonance, filter motion, stereo spread, and disorder drive.
 */
export const HYPER_RUBIX_WEBGPU_303_DEFAULTS = Object.freeze(sanitizeWebGpu303Params({
  ...WEBGPU_303_DEFAULTS,
  partials: 88,
  frequency: 72,
  timeMod: 27,
  timeScale: 112 / 30,
  gain: 0.082,
  dist: 0.76,
  dur: 0.2,
  ratio: 3.4,
  sampOffset: 1,
  fundamental: 220,
  stereo: 0.08,
  nse: 21703,
  res: 4.6,
  lfo: 0.72,
  flt: -5,
  swing: 0.08,
}));

function normalizedRotation(rotation = DEFAULT_ROTATION) {
  if (!rotation || typeof rotation !== "object" || Array.isArray(rotation)) {
    throw new TypeError("Hyper Rubix WebGPU rotation must be an object.");
  }
  return Object.freeze(Object.fromEntries(Object.keys(DEFAULT_ROTATION).map((plane) => {
    const degrees = finiteOr(rotation[plane], DEFAULT_ROTATION[plane]);
    return [plane, degrees];
  })));
}

function influence(value, fallback) {
  return clamp(finiteOr(value, fallback), 0, 2);
}

function normalizedPosition(position, radius) {
  return Object.fromEntries(HYPER_RUBIX_AXES.map((axis) => [
    axis,
    clamp(finiteOr(position?.[axis], 0) / radius, -1, 1),
  ]));
}

function rotationSignals(rotation) {
  const wave = Object.fromEntries(Object.entries(rotation).map(([plane, degrees]) => [
    plane,
    Math.sin(degrees * Math.PI / 180),
  ]));
  return Object.freeze({
    pitch: clamp(wave.xw * 0.42 + wave.yw * 0.31 + wave.zw * 0.27, -1, 1),
    filter: clamp(wave.xy * 0.18 + wave.xz * 0.16 + wave.yz * 0.14
      + wave.xw * 0.24 - wave.yw * 0.16 + wave.zw * 0.12, -1, 1),
    stereo: clamp(wave.xy * 0.26 + wave.yz * 0.16 + wave.yw * 0.34
      - wave.zw * 0.24, -1, 1),
    energy: Object.values(wave).reduce((sum, value) => sum + Math.abs(value), 0)
      / Object.keys(wave).length,
  });
}

function eventGeometry(event, metrics, rotation) {
  const position = normalizedPosition(event.position, Math.max(0.5, metrics.radius));
  const rotated = rotateHyperRubixPoint4(position, rotation);
  const configuration = event.configuration ?? {};
  const neighborCount = Math.max(1, finiteOr(configuration.neighborCount, 1));
  const sameColorNeighbors = clamp(
    finiteOr(configuration.sameColorNeighbors, 0),
    0,
    neighborCount,
  );
  const diversity = clamp(
    finiteOr(configuration.neighborDiversity, (neighborCount - sameColorNeighbors) / neighborCount),
    0,
    1,
  );
  const cohesion = clamp(sameColorNeighbors / neighborCount, 0, 1);
  const radial = RADIAL_VALUE[configuration.radialClass] ?? 0;
  const displaced = Number(Boolean(configuration.displaced));
  return Object.freeze({
    rotated: Object.freeze(rotated),
    diversity,
    cohesion,
    radial,
    displaced,
  });
}

function stepFromEvent(event, stepIndex, metrics, rotation, settings, frequencySpan) {
  const geometry = eventGeometry(event, metrics, rotation);
  const midi = (
    finiteOr(event.voice?.baseMidi, 48)
    + geometry.rotated.y * 1.6 * settings.pitchInfluence
    + geometry.rotated.z * 2.4 * settings.pitchInfluence
    + geometry.rotated.w * 3.2 * settings.wInfluence
    + geometry.diversity * 3.4 * settings.disorderInfluence
    + geometry.displaced * 2.2 * settings.disorderInfluence
  );
  const sequenceValue = clamp((midi - 20) / Math.max(0.2, frequencySpan), 0, 0.9999);
  const gain = clamp(
    0.48
      + Number(Boolean(event.gate)) * 0.22
      + Number(Boolean(event.accent)) * 0.18
      + geometry.cohesion * settings.neighborResponse * 0.06,
    0.36,
    1,
  );
  const filterDelta = clamp(
    (
      -geometry.rotated.y * 12
      + geometry.rotated.w * 9 * settings.wInfluence
      + geometry.diversity * 10 * settings.neighborResponse
      + geometry.displaced * 5 * settings.disorderInfluence
    ) * settings.filterInfluence,
    -64,
    64,
  );
  const resonanceDelta = clamp(
    (
      (geometry.radial - 0.35) * 3.5
      + geometry.diversity * 4.5 * settings.neighborResponse
      + geometry.displaced * 1.8 * settings.disorderInfluence
    ) * settings.filterInfluence,
    -15,
    15,
  );
  const stereoDelta = clamp(
    (geometry.rotated.x * 0.48 + geometry.rotated.z * 0.14) * settings.stereoInfluence,
    -8,
    8,
  );

  return Object.freeze({
    index: stepIndex,
    stickerId: event.stickerId,
    homeCell: event.homeCell,
    cell: event.cell,
    diversity: geometry.diversity,
    displaced: Boolean(geometry.displaced),
    pitchMidi: midi,
    sequenceValue,
    modulation: Object.freeze([gain, filterDelta, resonanceDelta, stereoDelta]),
  });
}

function patternFingerprint(params, sequence, stepModulation, steps) {
  return [
    ...WEBGPU_303_BUFFER_PARAM_ORDER.map((key) => Number(params[key]).toFixed(5)),
    ...sequence.map((value) => Number(value).toFixed(5)),
    ...stepModulation
      .flatMap((step) => step.map((value) => Number(value).toFixed(4))),
    ...steps.map((step) => `${step.stickerId}:${step.homeCell}:${step.cell}`),
  ].join("|");
}

function sanitizeVariableSequence(sequence) {
  return sequence.map((value) => clamp(finiteOr(value, 0), 0, 0.9999));
}

function sanitizeVariableStepModulation(stepModulation) {
  return stepModulation.map((step) => step.map((value, componentIndex) => {
    const [minimum, maximum] = WEBGPU_303_STEP_MODULATION_LIMITS[componentIndex];
    return clamp(finiteOr(value, componentIndex === 0 ? 1 : 0), minimum, maximum);
  }));
}

/**
 * Convert one Hyper Rubix state into a continuously gated WebGPU 303 loop.
 * Every sticker gets one forward serial pulse, so orders two through four
 * produce 64, 216, and 512 notes respectively.
 */
export function createHyperRubixWebGpu303Pattern(puzzle, options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Hyper Rubix WebGPU pattern options must be an object.");
  }
  const metrics = hyperRubixSizeMetrics(puzzle);
  const rotation = normalizedRotation(options.rotation);
  const baseParams = sanitizeWebGpu303Params({
    ...HYPER_RUBIX_WEBGPU_303_DEFAULTS,
    ...(options.baseParams ?? {}),
  });
  const settings = Object.freeze({
    pitchInfluence: influence(options.pitchInfluence, 0.72),
    filterInfluence: influence(options.filterInfluence, 0.72),
    stereoInfluence: influence(options.stereoInfluence, 0.72),
    neighborResponse: influence(options.neighborResponse, 1),
    wInfluence: influence(options.wInfluence, 0.72),
    disorderInfluence: influence(options.disorderInfluence, 0.6),
  });
  const tempo = clamp(finiteOr(options.tempo, 112), 30, 300);
  const subdivisionsPerBeat = clamp(
    Math.round(finiteOr(options.subdivisionsPerBeat, 2)),
    1,
    16,
  );
  const disorder = hyperRubixDisorder(puzzle);
  const signals = rotationSignals(rotation);
  const stream = createHyperRubixStickerStream(puzzle);
  const steps = Object.freeze(stream.map((event, stepIndex) => stepFromEvent(
    event,
    stepIndex,
    metrics,
    rotation,
    settings,
    baseParams.frequency,
  )));
  const rawSequence = steps.map(({ sequenceValue }) => sequenceValue);
  const rawStepModulation = steps.map(({ modulation }) => modulation);
  const params = Object.freeze(sanitizeWebGpu303Params({
    ...baseParams,
    timeMod: metrics.stickerStreamLength,
    timeScale: tempo * subdivisionsPerBeat / 60,
    swing: finiteOr(options.swing, baseParams.swing),
    fundamental: baseParams.fundamental * (2 ** (
      signals.pitch * settings.pitchInfluence * 4 / 12
    )),
    dist: baseParams.dist + disorder * settings.disorderInfluence * 1.2
      + signals.energy * 0.14,
    res: baseParams.res + disorder * settings.disorderInfluence * 2.4
      + signals.energy * settings.filterInfluence * 0.65,
    lfo: baseParams.lfo + signals.energy * settings.filterInfluence * 1.6,
    flt: baseParams.flt + signals.filter * settings.filterInfluence * 18
      + disorder * settings.disorderInfluence * 8,
    stereo: baseParams.stereo + signals.stereo * settings.stereoInfluence * 1.8,
  }));
  const sequence = Object.freeze(sanitizeVariableSequence(rawSequence));
  const stepModulation = Object.freeze(
    sanitizeVariableStepModulation(rawStepModulation)
      .map((step) => Object.freeze(step)),
  );
  const fingerprint = patternFingerprint(params, sequence, stepModulation, steps);

  return Object.freeze({
    params,
    sequence,
    stepModulation,
    steps,
    fingerprint,
    requiredSequenceCapacity: metrics.stickerStreamLength,
    runtimeCompatible: metrics.stickerStreamLength <= WEBGPU_303_SEQUENCE_LENGTH,
  });
}
