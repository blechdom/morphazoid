import {
  WEBGPU_303_DEFAULTS,
  WEBGPU_303_DEFAULT_STEP_MODULATION,
  WEBGPU_303_SEQUENCE_LENGTH,
  sanitizeWebGpu303Params,
  sanitizeWebGpu303Sequence,
  sanitizeWebGpu303StepModulation,
} from "./webgpu-303.js";
import {
  RUBIX_FACE_DEFINITIONS,
  RUBIX_READ_MODES,
  rubixFaceForNormal,
  rubixReadFrame,
} from "./rubix.js";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finiteOr = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const dot = (first, second) => (
  first.x * second.x + first.y * second.y + first.z * second.z
);

const FACE_TONE = Object.freeze({
  up: 0.46,
  down: -0.46,
  front: 0.18,
  back: -0.18,
  right: 0.34,
  left: -0.34,
});

/** A conservative Rubix patch that leaves headroom for per-sticker modulation. */
export const RUBIX_WEBGPU_303_DEFAULTS = Object.freeze(sanitizeWebGpu303Params({
  ...WEBGPU_303_DEFAULTS,
  partials: 80,
  frequency: 38,
  timeMod: 9,
  timeScale: 8.4,
  gain: 0.1,
  dist: 0.9,
  dur: 0.22,
  ratio: 3.6,
  fundamental: 880,
  stereo: 0.08,
  res: 5.4,
  lfo: 0.72,
  flt: -3,
}));

function faceLocalPosition(sticker, size) {
  const face = rubixFaceForNormal(sticker?.normal);
  const definition = RUBIX_FACE_DEFINITIONS[face];
  const radius = Math.max(0.5, (size - 1) / 2);
  return {
    face,
    horizontal: clamp(dot(sticker.position, definition.right) / radius, -1, 1),
    vertical: clamp(dot(sticker.position, definition.down) / radius, -1, 1),
  };
}

/**
 * Convert a sticker's current face-local placement into one WebGPU vec4:
 * gain/gate, filter delta, resonance delta, and stereo delta.
 */
export function rubixWebGpu303Placement(
  sticker,
  cellIndex,
  size,
  visibility = 1,
  amount = 0.68,
) {
  if (!sticker?.position || !sticker?.normal) {
    throw new TypeError("Rubix WebGPU placement requires a positioned sticker.");
  }
  if (!Number.isInteger(size) || size < 2) {
    throw new RangeError("Rubix WebGPU placement size must be an integer of at least 2.");
  }
  const local = faceLocalPosition(sticker, size);
  const influence = clamp(finiteOr(amount, 0.68), 0, 1);
  const gain = clamp(finiteOr(visibility, 0), 0, 1);
  const edge = Math.max(Math.abs(local.horizontal), Math.abs(local.vertical));
  const corner = Math.abs(local.horizontal * local.vertical);
  const moved = sticker.homeFace === local.face ? 0 : 1;
  const faceTone = FACE_TONE[local.face] ?? 0;
  const filterDelta = influence === 0
    ? 0
    : influence * (-local.vertical * 18 + faceTone * 4);
  const resonanceDelta = influence === 0
    ? 0
    : influence * ((edge - 0.35) * 4 + corner * 2 + moved * 0.8);
  const stereoDelta = influence === 0
    ? 0
    : influence * (local.horizontal * 0.16 + faceTone * 0.02);
  const modulation = Object.freeze([
    gain,
    filterDelta,
    resonanceDelta,
    stereoDelta,
  ]);
  return Object.freeze({
    cellIndex: Math.max(0, Math.trunc(finiteOr(cellIndex, 0))),
    face: local.face,
    horizontal: local.horizontal,
    vertical: local.vertical,
    edge,
    corner,
    moved,
    visibility: gain,
    amount: influence,
    filterDelta,
    resonanceDelta,
    stereoDelta,
    modulation,
  });
}

function stickerVisibility(visibilityById, stickerId) {
  if (typeof visibilityById === "function") {
    return clamp(finiteOr(visibilityById(stickerId), 0), 0, 1);
  }
  if (visibilityById && Object.hasOwn(visibilityById, stickerId)) {
    return clamp(finiteOr(visibilityById[stickerId], 0), 0, 1);
  }
  return 1;
}

/** Build the beat-ordered GPU sequence and its matching placement-modulation lane. */
export function createRubixWebGpu303Pattern(snapshot, {
  readingMode = "parallel",
  tempo = 126,
  visibilityById = null,
  amount = 0.68,
  baseParams = RUBIX_WEBGPU_303_DEFAULTS,
} = {}) {
  const lane = snapshot?.lanes?.acid;
  const normalizedNotes = snapshot?.audio?.acidNormalized;
  if (!Array.isArray(lane) || !Array.isArray(normalizedNotes) || lane.length !== normalizedNotes.length) {
    throw new TypeError("Rubix WebGPU patterns require a complete acid snapshot lane.");
  }
  const cellCount = lane.length;
  const size = Math.sqrt(cellCount);
  if (!Number.isInteger(size)) {
    throw new RangeError("Rubix WebGPU acid lanes must describe a square face.");
  }
  if (cellCount > WEBGPU_303_SEQUENCE_LENGTH) {
    throw new RangeError(
      `Rubix WebGPU 303 supports at most ${WEBGPU_303_SEQUENCE_LENGTH} stickers per face.`,
    );
  }

  const config = Object.hasOwn(RUBIX_READ_MODES, readingMode)
    ? RUBIX_READ_MODES[readingMode]
    : RUBIX_READ_MODES.parallel;
  const sequence = Array.from({ length: WEBGPU_303_SEQUENCE_LENGTH }, () => -1);
  const stepModulation = Array.from(
    { length: WEBGPU_303_SEQUENCE_LENGTH },
    () => WEBGPU_303_DEFAULT_STEP_MODULATION,
  );
  const placements = [];
  for (let beat = 0; beat < cellCount; beat += 1) {
    const frame = rubixReadFrame(
      config.id,
      beat * config.subdivisionsPerBeat,
      cellCount,
    );
    const cellIndex = frame.cellIndex;
    const sticker = lane[cellIndex];
    const placement = rubixWebGpu303Placement(
      sticker,
      cellIndex,
      size,
      stickerVisibility(visibilityById, sticker.id),
      amount,
    );
    sequence[beat] = normalizedNotes[cellIndex];
    stepModulation[beat] = placement.modulation;
    placements.push(placement);
  }

  const params = Object.freeze(sanitizeWebGpu303Params({
    ...baseParams,
    timeMod: cellCount,
    timeScale: clamp(finiteOr(tempo, 126) / 15, 0.01, 30),
  }));
  return Object.freeze({
    params,
    sequence: Object.freeze(sanitizeWebGpu303Sequence(sequence)),
    stepModulation: Object.freeze(
      sanitizeWebGpu303StepModulation(stepModulation)
        .map((step) => Object.freeze(step)),
    ),
    placements: Object.freeze(placements),
  });
}
