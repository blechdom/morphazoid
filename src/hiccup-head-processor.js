import {
  HICCUP_HEAD_DEFAULTS,
  HICCUP_HEAD_TOOTH_TINE_PROFILES,
  HICCUP_HEAD_TOOTH_GAP_ANATOMY,
  HICCUP_HEAD_TRACT_SECTION_COUNT,
  hiccupHeadGestureFrame,
  hiccupHeadSound,
  hiccupHeadTargetOralDiameters,
  physicalVoiceParameters,
  sanitizeHiccupHeadState,
  sanitizeHiccupHeadVoice,
} from "./hiccup-head.js?v=hiccup-head-model-20260902-4";

// Hiccup Head's tract is a single, persistent Kelly-Lochbaum volume-flow tube.
// The scattering convention, losses, and 44-section source geometry follow
// Morphazoid's Throatazoid/Pink Trombone lineage; gestures move the same tube
// instead of instantiating independent filtered voices.
const SUBSTEPS = 2;
const SPEED_OF_SOUND_MPS = 343;
const MAX_ORAL_SECTIONS = 152;
const MAX_TRACT_LENGTH_M = 0.52;
const MIN_ORAL_SECTIONS = 10;
const NOSE_SECTIONS = 28;
const CHEEK_SECTIONS = 18;
// Pure gesture/geometry helpers intentionally allocate immutable structures.
// Sampling them every 2/3 ms is ample because every tube diameter continues
// toward those targets at the two-times-audio-rate propagation cadence.
const CONTROL_INTERVAL_FRAMES = 32;
const TELEMETRY_BLOCKS = 12;
// The delay buffers behind the face effects are much larger than the tract.
// Audit a bounded rotating window so corruption which has not reached a read
// head is still found without putting a 39k-element scan in one render frame.
const FINITE_AUDIT_INTERVAL_FRAMES = 256;
const FACE_FINITE_AUDIT_WINDOW = 128;
const GLOTTAL_REFLECTION = 0.75;
const LIP_REFLECTION = -0.85;
const NOSE_REFLECTION = -0.82;
const TUBE_LOSS = 0.9988;
const JUNCTION_LOSS = 0.999;
const AREA_MINIMUM = 0.000001;
const DIAMETER_MINIMUM = 0.001;
const REFLECTION_LIMIT = 0.9995;
const DENORMAL_LIMIT = 1e-20;
const NASAL_BYPASS_EPSILON = 0.000001;
const OUTPUT_CEILING = 0.72;
const LID_HIGHPASS_OCTAVES = Math.log2(10_000 / 30);
const TOOTH_TINE_MINIMUM_HZ = 80;
const TOOTH_TINE_MAXIMUM_HZ = 4_800;
const TOOTH_TINE_COUNT = 12;
// A tooth tap should read as a little piece of dead, uneven wood rather than
// a tuned bar. Each visible tooth keeps its own slightly crooked stiffness
// and damping, while only two dull bending modes survive the contact.
const TOOTH_WOOD_MODE_COUNT = 2;
// The contact launches volume flow into a lossy tube, so its microscopic
// cantilever displacement needs this acoustic area conversion to remain
// audible beside the tongue release. It does not extend modal decay or Q.
const TOOTH_WOOD_IMPACT_GAIN = 15;
const TOOTH_WOOD_FREQUENCY_OFFSETS_HZ = Object.freeze([
  -1.2, 0.8, -0.6, 1.1, -0.9, 0.5, 0.9, -0.4, 0.6, -1, 1.2, -0.2,
]);
const TOOTH_WOOD_DECAY_SCALES = Object.freeze([
  0.86, 1.02, 0.9, 1.08, 0.84, 0.98, 1.04, 0.88, 1, 0.82, 1.1, 0.92,
]);
const HICCUP_GESTURE_IDS = new Set(["hiccup", "hiccuplong"]);
const TONGUE_TRILL_GESTURE_IDS = new Set(["drr", "lala", "rrrr", "lrroll"]);
// BOP receives a focused pre-tube lift so its stored bilabial release speaks.
// Sustained vocal outliers are compensated at the same source boundary;
// rattle keeps its pressure-valve dynamics and receives a smoothed radiation
// trim after the tube. Other gestures and the output safety knee stay intact.
const GESTURE_SOURCE_GAIN = Object.freeze({
  bop: 3,
  boop: 2,
  pop: 3.2,
  pff: 1.55,
  hiccup: 2.35,
  kiss: 1.85,
  grunt: 1.38,
  aah: 1.025,
  ooh: 1.035,
  wail: 0.8,
  yodel: 0.84,
  growl: 1.02,
  holler: 0.565,
  hum: 0.33,
  moan: 1.025,
  lala: 1.24,
  huff: 1.32,
  waow: 1.08,
  whoop: 1.08,
  doodoo: 1.16,
  llll: 1.18,
  purr: 1.14,
  rrrr: 1.24,
  lrroll: 1.28,
  lalatrip: 1.22,
  hiccuplong: 2.5,
  zzzz: 1.2,
  ehyeah: 1.04,
});
const GESTURE_OUTPUT_GAIN = Object.freeze({
  bop: 1.15,
  boop: 2.35,
  pop: 2.8,
  shh: 2.15,
  pff: 2.6,
  hiccup: 3,
  mwah: 2.35,
  kiss: 2.7,
  pbpb: 2.15,
  tomhi: 2.1,
  braap: 1.7,
  brush: 0.72,
  huff: 2.1,
  waow: 0.82,
  whoop: 0.72,
  doodoo: 1,
  llll: 0.75,
  purr: 0.98,
  grunt: 1.18,
  klikklak: 1.55,
  rrrr: 0.92,
  lrroll: 0.72,
  lalatrip: 0.9,
  hiccuplong: 1.35,
  zzzz: 1.35,
  ehyeah: 0.9,
  rattle: 0.35,
});
// These trims live after the shared presence knee. They keep highly resonant
// phrases from pinning the exact same limiter value without weakening the
// pressure which drives their physical valves and tongue contacts.
const GESTURE_POST_GAIN = Object.freeze({
  grunt: 0.36,
  bop: 0.9,
  pop: 1.45,
  slap: 0.86,
  smack: 0.86,
  tomhi: 1.6,
  hiccuplong: 0.62,
  klikklak: 0.65,
  lrroll: 1,
  lalatrip: 1.15,
});
// Open/modal voices must remain physically audible on small speakers even
// when a mutated character pulls the folds below their useful radiation
// range. Rough growls, grunts, burps, and percussion deliberately keep their
// lower unrestricted registers.
const VOCAL_FREQUENCY_FLOOR_HZ = Object.freeze({
  hee: 55,
  haw: 48,
  doo: 48,
  aah: 48,
  ooh: 48,
  wail: 55,
  yodel: 52,
  holler: 52,
  hum: 48,
  grunt: 46,
  moan: 48,
  waow: 48,
  whoop: 52,
  doodoo: 48,
  llll: 48,
  purr: 36,
  rrrr: 48,
  lrroll: 48,
  lalatrip: 48,
  hiccuplong: 48,
  zzzz: 50,
  ehyeah: 55,
});

const RELEASE_PHASES = Object.freeze({
  // BOP's lips part at phase .282. Releasing at .35 used to mute the actual
  // bilabial crack and leave only a tiny low-frequency after-ring.
  bop: 0.275,
  boop: 0.43,
  pop: 0.415,
  tlik: 0.545,
  shh: 0.22,
  shack: 0.08,
  slap: 0.09,
  pff: 0.18,
  kick: 0.07,
  smack: 0.075,
  hee: 0.035,
  haw: 0.04,
  doo: 0.035,
  mwah: 0.535,
  kiss: 0.43,
  drr: 0.045,
  burp: 0.04,
  aah: 0.045,
  ooh: 0.045,
  wail: 0.04,
  yodel: 0.04,
  growl: 0.04,
  holler: 0.035,
  hum: 0.045,
  rattle: 0.04,
  whistle: 0.045,
  grunt: 0.04,
  moan: 0.04,
  lala: 0.035,
  pbpb: 0.035,
  slurp: 0.5,
  hiccup: 0.34,
  eef: 0.045,
  snare: 0.3,
  snap: 0.375,
  tomlo: 0.18,
  tomhi: 0.14,
  braap: 0.14,
  brush: 0.04,
  huff: 0.04,
  waow: 0.04,
  whoop: 0.04,
  doodoo: 0.055,
  llll: 0.04,
  purr: 0.04,
  klikklak: 0.18,
  rrrr: 0.045,
  lrroll: 0.04,
  lalatrip: 0.04,
  hiccuplong: 0.35,
  zzzz: 0.04,
  ehyeah: 0.04,
});

const LIVE_PREPARATION_SECONDS = Object.freeze({
  bop: 0.016,
  boop: 0.02,
  pop: 0.018,
  tlik: 0.024,
  shh: 0.014,
  shack: 0.01,
  slap: 0.006,
  pff: 0.022,
  kick: 0.006,
  smack: 0.006,
  hee: 0.012,
  haw: 0.012,
  doo: 0.012,
  mwah: 0.025,
  drr: 0.014,
  burp: 0.016,
  aah: 0.016,
  ooh: 0.016,
  wail: 0.014,
  yodel: 0.014,
  growl: 0.014,
  holler: 0.012,
  hum: 0.016,
  rattle: 0.014,
  whistle: 0.016,
  grunt: 0.012,
  moan: 0.016,
  lala: 0.012,
  pbpb: 0.014,
  slurp: 0.022,
  hiccup: 0.018,
  eef: 0.014,
  snare: 0.016,
  snap: 0.012,
  tomlo: 0.01,
  tomhi: 0.008,
  braap: 0.016,
  brush: 0.006,
  kiss: 0.012,
  huff: 0.014,
  waow: 0.016,
  whoop: 0.016,
  doodoo: 0.014,
  llll: 0.016,
  purr: 0.016,
  klikklak: 0.018,
  rrrr: 0.014,
  lrroll: 0.014,
  lalatrip: 0.014,
  hiccuplong: 0.018,
  zzzz: 0.014,
  ehyeah: 0.016,
});

const finite = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, finite(value, minimum)))
);

const cleanWave = (value) => (
  !Number.isFinite(value) || Math.abs(value) < DENORMAL_LIMIT ? 0 : value
);

const safeArea = (diameter) => Math.max(
  AREA_MINIMUM,
  finite(diameter, DIAMETER_MINIMUM) ** 2,
);

const timeAlpha = (milliseconds, rate) => (
  1 - Math.exp(-1 / Math.max(1, rate * milliseconds / 1_000))
);

const smoothstep = (value) => {
  const amount = clamp(value);
  return amount * amount * (3 - 2 * amount);
};

function sanitizeToothTine(source) {
  if (!source || typeof source !== "object") return null;
  return Object.freeze({
    frequencyHz: clamp(
      finite(source.frequencyHz, 520),
      TOOTH_TINE_MINIMUM_HZ,
      TOOTH_TINE_MAXIMUM_HZ,
    ),
    position: clamp(finite(source.position, 0.72)),
    brightness: clamp(finite(source.brightness, 0.68)),
    toothIndex: Math.round(clamp(
      finite(source.toothIndex, 5),
      0,
      TOOTH_TINE_COUNT - 1,
    )),
  });
}

function xorshift(value) {
  let state = value | 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state | 0;
}

function arraysAreFinite(arrays, lengths = []) {
  for (let arrayIndex = 0; arrayIndex < arrays.length; arrayIndex += 1) {
    const values = arrays[arrayIndex];
    const length = lengths[arrayIndex] ?? values.length;
    for (let index = 0; index < length; index += 1) {
      if (!Number.isFinite(values[index])) return false;
    }
  }
  return true;
}

// Ears, bilateral hair, and eyes are global face parameters after the one
// resonating tract. Ears own only fixed short width; each hair side owns its
// own feedback delay; outward/crossed eyes open two characters of the diffused
// room, and the independently smoothed lids drive post-effect bus processing.
class FaceSpace {
  constructor(rate, externalReverb = false) {
    this.rate = rate;
    this.externalReverb = Boolean(externalReverb);
    // Three fixed all-pass sections per side share exactly the same 5.17 ms
    // total delay but use different section lengths. Their difference supplies
    // a stable stereo side without a moving comb or a left/right Haas lead.
    const matchedWidthFrames = Math.max(12, Math.round(rate * 0.00517));
    const widthLeftFrames = Math.max(4, Math.round(rate * 0.00073));
    const widthLeftTailFrames = Math.max(4, Math.round(rate * 0.00161));
    const widthRightFrames = Math.max(4, Math.round(rate * 0.00103));
    const widthRightTailFrames = Math.max(4, Math.round(rate * 0.00197));
    this.widthLeftBuffer = new Float64Array(widthLeftFrames);
    this.widthLeftTailBuffer = new Float64Array(widthLeftTailFrames);
    this.widthLeftThirdBuffer = new Float64Array(Math.max(
      4,
      matchedWidthFrames - widthLeftFrames - widthLeftTailFrames,
    ));
    this.widthRightBuffer = new Float64Array(widthRightFrames);
    this.widthRightTailBuffer = new Float64Array(widthRightTailFrames);
    this.widthRightThirdBuffer = new Float64Array(Math.max(
      4,
      matchedWidthFrames - widthRightFrames - widthRightTailFrames,
    ));
    // Compatibility alias retained for diagnostics that predate matched ears.
    this.widthBuffer = this.widthLeftBuffer;
    this.leftHairBuffer = new Float64Array(Math.ceil(rate * 0.46) + 4);
    this.rightHairBuffer = new Float64Array(Math.ceil(rate * 0.46) + 4);
    this.eyeLeftBuffer = new Float64Array(
      externalReverb ? 4 : Math.ceil(rate * 0.39) + 4,
    );
    this.eyeRightBuffer = new Float64Array(
      externalReverb ? 4 : Math.ceil(rate * 0.39) + 4,
    );
    this.eyeDiffuseLeftA = new Float64Array(
      externalReverb ? 4 : Math.max(4, Math.round(rate * 0.00473)),
    );
    this.eyeDiffuseLeftB = new Float64Array(
      externalReverb ? 4 : Math.max(4, Math.round(rate * 0.01117)),
    );
    this.eyeDiffuseRightA = new Float64Array(
      externalReverb ? 4 : Math.max(4, Math.round(rate * 0.00631)),
    );
    this.eyeDiffuseRightB = new Float64Array(
      externalReverb ? 4 : Math.max(4, Math.round(rate * 0.01379)),
    );
    // Read-only compatibility alias for diagnostics which knew the old buffer.
    this.earBuffer = this.leftHairBuffer;
    this.widthIndex = 0;
    this.widthLeftIndex = 0;
    this.widthLeftTailIndex = 0;
    this.widthLeftThirdIndex = 0;
    this.widthRightIndex = 0;
    this.widthRightTailIndex = 0;
    this.widthRightThirdIndex = 0;
    this.widthSideLow = 0;
    this.widthSideHighpassAlpha = 1 - Math.exp(-Math.PI * 2 * 120 / rate);
    this.eyeDiffuseLeftAIndex = 0;
    this.eyeDiffuseLeftBIndex = 0;
    this.eyeDiffuseRightAIndex = 0;
    this.eyeDiffuseRightBIndex = 0;
    this.hairIndex = 0;
    this.eyeIndex = 0;
    this.earAmount = 0;
    this.leftHairLength = 0;
    this.rightHairLength = 0;
    this.leftHairAngle = 0;
    this.rightHairAngle = 0;
    this.eyeAmount = 0;
    this.eyeReverbAmount = 0;
    this.eyelidHighpassAmount = 0;
    this.eyelidFuzzAmount = 0;
    this.eyeDampedLeft = 0;
    this.eyeDampedRight = 0;
    this.eyeClosureAmount = 0;
    this.leftEyeClosureAmount = 0;
    this.rightEyeClosureAmount = 0;
    this.left = 0;
    this.right = 0;
    this.stereoDelayMs = 0;
    this.stereoWidth = 1;
    this.leftHairDelayMs = 0;
    this.rightHairDelayMs = 0;
    this.leftHairFeedback = 0;
    this.rightHairFeedback = 0;
    this.leftHairMix = 0;
    this.rightHairMix = 0;
    // Aggregate aliases remain telemetry-compatible, but never drive sound.
    this.hairAmount = 0;
    this.hairDelayMs = 0;
    this.hairFeedback = 0;
    this.hairMix = 0;
    this.earSmoothingAlpha = timeAlpha(24, rate);
    this.hairSmoothingAlpha = timeAlpha(32, rate);
    this.hairAngleSmoothingAlpha = timeAlpha(28, rate);
    this.eyeSmoothingAlpha = timeAlpha(36, rate);
    this.eyeClosureSmoothingAlpha = timeAlpha(24, rate);
    this.finiteAuditBuffers = Object.freeze([
      this.leftHairBuffer,
      this.rightHairBuffer,
      this.eyeLeftBuffer,
      this.eyeRightBuffer,
      this.eyeDiffuseLeftA,
      this.eyeDiffuseLeftB,
      this.eyeDiffuseRightA,
      this.eyeDiffuseRightB,
      this.widthLeftBuffer,
      this.widthLeftTailBuffer,
      this.widthLeftThirdBuffer,
      this.widthRightBuffer,
      this.widthRightTailBuffer,
      this.widthRightThirdBuffer,
    ]);
    this.finiteAuditBufferIndex = 0;
    this.finiteAuditOffset = 0;
  }

  _tap(buffer, writeIndex, delayFrames) {
    const length = buffer.length;
    const position = (writeIndex - delayFrames + length) % length;
    const lower = Math.floor(position);
    const upper = (lower + 1) % length;
    const mix = position - lower;
    return buffer[lower] + (buffer[upper] - buffer[lower]) * mix;
  }

  _allpass(buffer, indexKey, input, coefficient) {
    const index = this[indexKey];
    const delayed = buffer[index];
    const output = delayed - input * coefficient;
    buffer[index] = clamp(input + output * coefficient, -1.5, 1.5);
    this[indexKey] = (index + 1) % buffer.length;
    return cleanWave(output);
  }

  process(left, right, configuration) {
    const earTarget = clamp(finite(configuration?.earSpread, 0));
    const leftLengthTarget = clamp(finite(configuration?.leftHairLength, 0));
    const rightLengthTarget = clamp(finite(configuration?.rightHairLength, 0));
    const leftAngleTarget = clamp(finite(configuration?.leftHairAngle, 0), -1, 1);
    const rightAngleTarget = clamp(finite(configuration?.rightHairAngle, 0), -1, 1);
    const eyeTarget = clamp(finite(configuration?.eyeDivergence, 0), -1, 1);
    const leftEyeClosure = clamp(finite(configuration?.leftEyeClosure, configuration?.eyeClosure));
    const rightEyeClosure = clamp(finite(configuration?.rightEyeClosure, configuration?.eyeClosure));
    const eyeClosureTarget = Math.max(leftEyeClosure, rightEyeClosure);
    this.earAmount += (earTarget - this.earAmount) * this.earSmoothingAlpha;
    this.leftHairLength += (
      leftLengthTarget - this.leftHairLength
    ) * this.hairSmoothingAlpha;
    this.rightHairLength += (
      rightLengthTarget - this.rightHairLength
    ) * this.hairSmoothingAlpha;
    this.leftHairAngle += (
      leftAngleTarget - this.leftHairAngle
    ) * this.hairAngleSmoothingAlpha;
    this.rightHairAngle += (
      rightAngleTarget - this.rightHairAngle
    ) * this.hairAngleSmoothingAlpha;
    this.eyeAmount += (eyeTarget - this.eyeAmount) * this.eyeSmoothingAlpha;
    if (eyeTarget === 0 && Math.abs(this.eyeAmount) < 0.000001) this.eyeAmount = 0;
    // Eyelids shade the same reverb network; they never gate or bitcrush.
    this.eyeClosureAmount += (
      eyeClosureTarget - this.eyeClosureAmount
    ) * this.eyeClosureSmoothingAlpha;
    this.leftEyeClosureAmount += (
      leftEyeClosure - this.leftEyeClosureAmount
    ) * this.eyeClosureSmoothingAlpha;
    this.rightEyeClosureAmount += (
      rightEyeClosure - this.rightEyeClosureAmount
    ) * this.eyeClosureSmoothingAlpha;
    if (eyeClosureTarget === 0 && this.eyeClosureAmount < 0.000001) {
      this.eyeClosureAmount = 0;
    }

    const midpoint = (left + right) * 0.5;
    const inputSide = (left - right) * 0.5;

    const leftCurve = smoothstep(this.leftHairLength);
    const rightCurve = smoothstep(this.rightHairLength);
    const leftAngleNormalized = (this.leftHairAngle + 1) * 0.5;
    const rightAngleNormalized = (this.rightHairAngle + 1) * 0.5;
    // Hair angle sweeps delay time from a tight doubling zone through slapback
    // and into slow rhythmic echoes; radial length controls feedback and mix.
    const leftDelayFrames = this.rate * (0.012 + leftAngleNormalized ** 1.7 * 0.408);
    const rightDelayFrames = this.rate * (0.012 + rightAngleNormalized ** 1.7 * 0.408);
    const leftHairTap = this._tap(this.leftHairBuffer, this.hairIndex, leftDelayFrames);
    const rightHairTap = this._tap(this.rightHairBuffer, this.hairIndex, rightDelayFrames);
    this.leftHairFeedback = this.leftHairLength <= 0.000001 ? 0 : 0.08 + leftCurve * 0.78;
    this.rightHairFeedback = this.rightHairLength <= 0.000001 ? 0 : 0.08 + rightCurve * 0.78;
    this.leftHairMix = leftCurve * 0.78;
    this.rightHairMix = rightCurve * 0.78;
    // Both hairs feed a centered two-tap delay network. They independently
    // choose time, feedback, and wet contribution without panning echoes.
    this.leftHairBuffer[this.hairIndex] = clamp(
      midpoint + leftHairTap * this.leftHairFeedback,
      -1.5,
      1.5,
    );
    this.rightHairBuffer[this.hairIndex] = clamp(
      midpoint + rightHairTap * this.rightHairFeedback,
      -1.5,
      1.5,
    );
    this.hairIndex = (this.hairIndex + 1) % this.leftHairBuffer.length;
    this.leftHairDelayMs = leftDelayFrames / this.rate * 1_000;
    this.rightHairDelayMs = rightDelayFrames / this.rate * 1_000;
    const leftDelayBlend = this.leftHairMix * 0.48;
    const rightDelayBlend = this.rightHairMix * 0.48;
    const centeredDelay = (
      leftHairTap * leftDelayBlend * (0.76 - this.leftHairFeedback * 0.12)
      + rightHairTap * rightDelayBlend * (0.76 - this.rightHairFeedback * 0.12)
    ) / Math.max(1, 1 + (leftDelayBlend + rightDelayBlend) * 0.18);
    const hairActivity = Math.max(leftCurve, rightCurve);
    const hairDryGain = 1 - hairActivity * 0.06;
    const hairMidpoint = cleanWave(midpoint * hairDryGain + centeredDelay);
    const hairInputSide = inputSide * hairDryGain;

    // Ears widen the complete dry + centered-hair result. The fixed matched-
    // total all-pass field creates only a side signal; it cancels exactly when
    // folded to mono and has no parameter-modulated delay or coefficient.
    const earCurve = Math.sqrt(this.earAmount);
    const widthCoefficient = 0.35;
    const widthLeftHead = this._allpass(
      this.widthLeftBuffer,
      "widthLeftIndex",
      hairMidpoint,
      widthCoefficient,
    );
    const widthLeftTail = this._allpass(
      this.widthLeftTailBuffer,
      "widthLeftTailIndex",
      widthLeftHead,
      widthCoefficient,
    );
    const phaseLeft = this._allpass(
      this.widthLeftThirdBuffer,
      "widthLeftThirdIndex",
      widthLeftTail,
      widthCoefficient,
    );
    const widthRightHead = this._allpass(
      this.widthRightBuffer,
      "widthRightIndex",
      hairMidpoint,
      widthCoefficient,
    );
    const widthRightTail = this._allpass(
      this.widthRightTailBuffer,
      "widthRightTailIndex",
      widthRightHead,
      widthCoefficient,
    );
    const phaseRight = this._allpass(
      this.widthRightThirdBuffer,
      "widthRightThirdIndex",
      widthRightTail,
      widthCoefficient,
    );
    const rawDecorrelatedSide = (phaseLeft - phaseRight) * 0.5;
    this.widthSideLow += (
      rawDecorrelatedSide - this.widthSideLow
    ) * this.widthSideHighpassAlpha;
    const decorrelatedSide = rawDecorrelatedSide - this.widthSideLow;
    // Preserve a restrained center of travel, then open decisively near the
    // fully stretched ears. Both terms remain an anti-symmetric side field,
    // so the widened result folds back to the untouched hair midpoint.
    const existingSideGain = 1 + this.earAmount * 1.25;
    const diffuseSideGain = earCurve * (0.35 + this.earAmount * 0.65);
    const widenedSide = hairInputSide * existingSideGain
      + decorrelatedSide * diffuseSideGain;
    const hairLeft = cleanWave(hairMidpoint + widenedSide);
    const hairRight = cleanWave(hairMidpoint - widenedSide);
    this.widthIndex = this.widthLeftIndex;
    this.stereoWidth = existingSideGain;
    this.stereoDelayMs = 0;
    this.hairAmount = Math.max(this.leftHairLength, this.rightHairLength);
    this.hairDelayMs = (this.leftHairDelayMs + this.rightHairDelayMs) * 0.5;
    this.hairFeedback = Math.max(this.leftHairFeedback, this.rightHairFeedback);
    this.hairMix = Math.max(this.leftHairMix, this.rightHairMix);

    const cathedralAmount = smoothstep(clamp(Math.max(0, this.eyeAmount) / 0.9));
    const plateAmount = smoothstep(clamp(Math.max(0, -this.eyeAmount) / 0.9));
    const eyeActivation = Math.max(cathedralAmount, plateAmount);
    const leftLidHighpass = leftEyeClosure ** 0.75;
    const rightLidFuzz = rightEyeClosure;
    this.eyeReverbAmount = eyeActivation;
    this.eyelidHighpassAmount = leftLidHighpass;
    this.eyelidFuzzAmount = rightLidFuzz;
    if (this.externalReverb) {
      // Captured native convolution owns only the pupils' room. Lid telemetry
      // continues through the worklet so fuzz remains immediate and physical.
      this.left = hairLeft;
      this.right = hairRight;
      return;
    }

    // Restore the original smooth cross-fed room that gave Hiccup Head its
    // cathedral tail. Outward eyes grow that room; crossed eyes shorten the
    // same network into a restrained plate, and straight eyes remain dry.
    const diffusion = 0.48 + plateAmount * 0.1 + cathedralAmount * 0.18;
    const diffusedLeftA = this._allpass(
      this.eyeDiffuseLeftA,
      "eyeDiffuseLeftAIndex",
      hairLeft,
      diffusion,
    );
    const diffusedLeft = this._allpass(
      this.eyeDiffuseLeftB,
      "eyeDiffuseLeftBIndex",
      diffusedLeftA,
      diffusion * 0.93,
    );
    const diffusedRightA = this._allpass(
      this.eyeDiffuseRightA,
      "eyeDiffuseRightAIndex",
      hairRight,
      diffusion * 0.96,
    );
    const diffusedRight = this._allpass(
      this.eyeDiffuseRightB,
      "eyeDiffuseRightBIndex",
      diffusedRightA,
      diffusion * 0.9,
    );
    const roomLeftDelay = this.rate * (
      0.042 + plateAmount * 0.012 + cathedralAmount * 0.1
    );
    const roomRightDelay = this.rate * (
      0.057 + plateAmount * 0.016 + cathedralAmount * 0.148
    );
    const reflectedLeft = this._tap(this.eyeLeftBuffer, this.eyeIndex, roomLeftDelay);
    const reflectedRight = this._tap(this.eyeRightBuffer, this.eyeIndex, roomRightDelay);
    const roomDamping = clamp(
      0.2 + plateAmount * 0.06 - cathedralAmount * 0.095,
      0.075,
      0.27,
    );
    this.eyeDampedLeft += (reflectedLeft - this.eyeDampedLeft) * roomDamping;
    this.eyeDampedRight += (reflectedRight - this.eyeDampedRight) * roomDamping * 0.92;
    const roomFeedback = clamp(
      0.34 + plateAmount * 0.45 + cathedralAmount * 0.49,
      0.28,
      0.86,
    );
    this.eyeLeftBuffer[this.eyeIndex] = clamp(
      diffusedLeft * (0.22 + eyeActivation * 0.12)
        + this.eyeDampedRight * roomFeedback,
      -1.5,
      1.5,
    );
    this.eyeRightBuffer[this.eyeIndex] = clamp(
      diffusedRight * (0.22 + eyeActivation * 0.12)
        + this.eyeDampedLeft * roomFeedback,
      -1.5,
      1.5,
    );
    this.eyeIndex = (this.eyeIndex + 1) % this.eyeLeftBuffer.length;
    const roomWet = plateAmount * 0.74 + cathedralAmount * 0.8;
    const earlyField = 0.16 + plateAmount * 0.18 + cathedralAmount * 0.08;
    const wetLeft = diffusedLeft * earlyField
      + this.eyeDampedLeft * (1 - earlyField * 0.35);
    const wetRight = diffusedRight * earlyField
      + this.eyeDampedRight * (1 - earlyField * 0.35);
    const roomLeft = cleanWave(
      hairLeft * (1 - roomWet * 0.2) + wetLeft * roomWet,
    );
    const roomRight = cleanWave(
      hairRight * (1 - roomWet * 0.2) + wetRight * roomWet,
    );

    // Lids are global post-effect gestures. Their DSP runs after the presence
    // stage below, so this room remains independent and naturally decaying.
    this.left = roomLeft;
    this.right = roomRight;
    this.eyelidHighpassAmount = leftLidHighpass;
    this.eyelidFuzzAmount = rightLidFuzz;
  }

  reset() {
    this.widthLeftBuffer.fill(0);
    this.widthLeftTailBuffer.fill(0);
    this.widthLeftThirdBuffer.fill(0);
    this.widthRightBuffer.fill(0);
    this.widthRightTailBuffer.fill(0);
    this.widthRightThirdBuffer.fill(0);
    this.leftHairBuffer.fill(0);
    this.rightHairBuffer.fill(0);
    this.eyeLeftBuffer.fill(0);
    this.eyeRightBuffer.fill(0);
    this.eyeDiffuseLeftA.fill(0);
    this.eyeDiffuseLeftB.fill(0);
    this.eyeDiffuseRightA.fill(0);
    this.eyeDiffuseRightB.fill(0);
    this.widthIndex = 0;
    this.widthLeftIndex = 0;
    this.widthLeftTailIndex = 0;
    this.widthLeftThirdIndex = 0;
    this.widthRightIndex = 0;
    this.widthRightTailIndex = 0;
    this.widthRightThirdIndex = 0;
    this.widthSideLow = 0;
    this.hairIndex = 0;
    this.eyeIndex = 0;
    this.eyeDiffuseLeftAIndex = 0;
    this.eyeDiffuseLeftBIndex = 0;
    this.eyeDiffuseRightAIndex = 0;
    this.eyeDiffuseRightBIndex = 0;
    this.earAmount = 0;
    this.leftHairLength = 0;
    this.rightHairLength = 0;
    this.leftHairAngle = 0;
    this.rightHairAngle = 0;
    this.eyeAmount = 0;
    this.eyeReverbAmount = 0;
    this.eyelidHighpassAmount = 0;
    this.eyelidFuzzAmount = 0;
    this.eyeDampedLeft = 0;
    this.eyeDampedRight = 0;
    this.eyeClosureAmount = 0;
    this.leftEyeClosureAmount = 0;
    this.rightEyeClosureAmount = 0;
    this.left = 0;
    this.right = 0;
    this.stereoDelayMs = 0;
    this.stereoWidth = 1;
    this.leftHairDelayMs = 0;
    this.rightHairDelayMs = 0;
    this.leftHairFeedback = 0;
    this.rightHairFeedback = 0;
    this.leftHairMix = 0;
    this.rightHairMix = 0;
    this.hairAmount = 0;
    this.hairDelayMs = 0;
    this.hairFeedback = 0;
    this.hairMix = 0;
    this.finiteAuditBufferIndex = 0;
    this.finiteAuditOffset = 0;
  }

  scalarsAreFinite() {
    return Number.isFinite(this.earAmount)
      && Number.isFinite(this.leftHairLength)
      && Number.isFinite(this.rightHairLength)
      && Number.isFinite(this.leftHairAngle)
      && Number.isFinite(this.rightHairAngle)
      && Number.isFinite(this.eyeAmount)
      && Number.isFinite(this.eyeReverbAmount)
      && Number.isFinite(this.eyelidHighpassAmount)
      && Number.isFinite(this.eyelidFuzzAmount)
      && Number.isFinite(this.eyeClosureAmount)
      && Number.isFinite(this.leftEyeClosureAmount)
      && Number.isFinite(this.rightEyeClosureAmount)
      && Number.isFinite(this.eyeDampedLeft)
      && Number.isFinite(this.eyeDampedRight)
      && Number.isFinite(this.left)
      && Number.isFinite(this.right)
      && Number.isFinite(this.stereoDelayMs)
      && Number.isFinite(this.stereoWidth)
      && Number.isFinite(this.widthSideLow)
      && Number.isFinite(this.leftHairDelayMs)
      && Number.isFinite(this.rightHairDelayMs)
      && Number.isFinite(this.leftHairFeedback)
      && Number.isFinite(this.rightHairFeedback)
      && Number.isFinite(this.leftHairMix)
      && Number.isFinite(this.rightHairMix)
      && Number.isInteger(this.widthIndex)
      && this.widthIndex >= 0
      && this.widthIndex < this.widthBuffer.length
      && Number.isInteger(this.widthLeftIndex)
      && this.widthLeftIndex >= 0
      && this.widthLeftIndex < this.widthLeftBuffer.length
      && Number.isInteger(this.widthLeftTailIndex)
      && this.widthLeftTailIndex >= 0
      && this.widthLeftTailIndex < this.widthLeftTailBuffer.length
      && Number.isInteger(this.widthLeftThirdIndex)
      && this.widthLeftThirdIndex >= 0
      && this.widthLeftThirdIndex < this.widthLeftThirdBuffer.length
      && Number.isInteger(this.widthRightIndex)
      && this.widthRightIndex >= 0
      && this.widthRightIndex < this.widthRightBuffer.length
      && Number.isInteger(this.widthRightTailIndex)
      && this.widthRightTailIndex >= 0
      && this.widthRightTailIndex < this.widthRightTailBuffer.length
      && Number.isInteger(this.widthRightThirdIndex)
      && this.widthRightThirdIndex >= 0
      && this.widthRightThirdIndex < this.widthRightThirdBuffer.length
      && Number.isInteger(this.hairIndex)
      && this.hairIndex >= 0
      && this.hairIndex < this.leftHairBuffer.length
      && Number.isInteger(this.eyeIndex)
      && this.eyeIndex >= 0
      && this.eyeIndex < this.eyeLeftBuffer.length
      && Number.isInteger(this.eyeDiffuseLeftAIndex)
      && this.eyeDiffuseLeftAIndex >= 0
      && this.eyeDiffuseLeftAIndex < this.eyeDiffuseLeftA.length
      && Number.isInteger(this.eyeDiffuseLeftBIndex)
      && this.eyeDiffuseLeftBIndex >= 0
      && this.eyeDiffuseLeftBIndex < this.eyeDiffuseLeftB.length
      && Number.isInteger(this.eyeDiffuseRightAIndex)
      && this.eyeDiffuseRightAIndex >= 0
      && this.eyeDiffuseRightAIndex < this.eyeDiffuseRightA.length
      && Number.isInteger(this.eyeDiffuseRightBIndex)
      && this.eyeDiffuseRightBIndex >= 0
      && this.eyeDiffuseRightBIndex < this.eyeDiffuseRightB.length;
  }

  auditFiniteWindow(windowSize = FACE_FINITE_AUDIT_WINDOW) {
    if (!this.scalarsAreFinite()) return false;
    let remaining = Math.max(1, Math.trunc(finite(windowSize, 1)));
    while (remaining > 0) {
      const values = this.finiteAuditBuffers[this.finiteAuditBufferIndex];
      const available = values.length - this.finiteAuditOffset;
      const count = Math.min(remaining, available);
      const end = this.finiteAuditOffset + count;
      for (let index = this.finiteAuditOffset; index < end; index += 1) {
        if (!Number.isFinite(values[index])) return false;
      }
      remaining -= count;
      this.finiteAuditOffset = end;
      if (this.finiteAuditOffset >= values.length) {
        this.finiteAuditOffset = 0;
        this.finiteAuditBufferIndex = (
          this.finiteAuditBufferIndex + 1
        ) % this.finiteAuditBuffers.length;
      }
    }
    return true;
  }
}

function updateReflections(diameter, area, reflection, length) {
  for (let index = 0; index < length; index += 1) {
    area[index] = safeArea(diameter[index]);
    if (index === 0) continue;
    const sum = area[index - 1] + area[index];
    reflection[index] = clamp(
      (area[index - 1] - area[index]) / Math.max(AREA_MINIMUM, sum),
      -REFLECTION_LIMIT,
      REFLECTION_LIMIT,
    );
  }
}

function resample(values, position) {
  const maximum = Math.max(0, values.length - 1);
  const index = clamp(position, 0, maximum);
  const lower = Math.floor(index);
  const upper = Math.min(maximum, lower + 1);
  const mix = index - lower;
  return finite(values[lower], DIAMETER_MINIMUM)
    + (finite(values[upper], DIAMETER_MINIMUM) - finite(values[lower], DIAMETER_MINIMUM)) * mix;
}

function mappedConstrictionIndex(position, sectionCount) {
  // hiccupHeadTargetOralDiameters maps its normalized articulation domain across
  // canonical sections 2..41, leaving the glottal and lip boundaries intact.
  // Use the identical mapping after delay-line resampling so pressure storage,
  // turbulence, and telemetry follow the actual geometric minimum.
  const canonical = 2 + clamp(finite(position, 0.5)) * (HICCUP_HEAD_TRACT_SECTION_COUNT - 4);
  return clamp(
    Math.round(canonical / (HICCUP_HEAD_TRACT_SECTION_COUNT - 1) * (sectionCount - 1)),
    1,
    sectionCount - 2,
  );
}

// Liljencrants-Fant glottal pulse, matching the implementation used by
// Throatazoid. Coefficients are calculated once per gesture, not per sample.
function glottalCoefficients(tenseness = 0.6) {
  const value = clamp(tenseness);
  const rd = clamp(3 * (1 - value), 0.5, 2.7);
  const ra = -0.01 + 0.048 * rd;
  const rk = 0.224 + 0.118 * rd;
  const rg = ((rk / 4) * (0.5 + 1.2 * rk)) / (0.11 * rd - ra * (0.5 + 1.2 * rk));
  const tp = 1 / (2 * rg);
  const te = tp * (1 + rk);
  const epsilon = 1 / ra;
  const shift = Math.exp(-epsilon * (1 - te));
  const delta = 1 - shift;
  const rhs = ((shift - 1) / epsilon + (1 - te) * shift) / delta;
  const lowerIntegral = -(te - tp) / 2 + rhs;
  const upperIntegral = -lowerIntegral;
  const omega = Math.PI / tp;
  const sineAtClosure = Math.sin(omega * te);
  const logarithmInput = Math.max(
    1e-8,
    (-Math.PI * sineAtClosure * upperIntegral) / (tp * 2),
  );
  const alpha = Math.log(logarithmInput) / (tp / 2 - te);
  const e0 = -1 / (sineAtClosure * Math.exp(alpha * te));
  return { alpha, delta, e0, epsilon, omega, shift, te };
}

function glottalSample(phase, coefficients) {
  const interpolation = ((phase % 1) + 1) % 1;
  if (interpolation > coefficients.te) {
    return (
      -Math.exp(-coefficients.epsilon * (interpolation - coefficients.te))
      + coefficients.shift
    ) / coefficients.delta;
  }
  return coefficients.e0
    * Math.exp(coefficients.alpha * interpolation)
    * Math.sin(coefficients.omega * interpolation);
}

class NasalBranch {
  constructor(rate) {
    this.rate = rate;
    this.substepRate = rate * SUBSTEPS;
    this.openingAlphaFast = timeAlpha(15, this.substepRate);
    this.openingAlphaSlow = timeAlpha(40, this.substepRate);
    this.diameterAlpha = timeAlpha(22, this.substepRate);
    this.right = new Float64Array(NOSE_SECTIONS);
    this.left = new Float64Array(NOSE_SECTIONS);
    this.rightJunction = new Float64Array(NOSE_SECTIONS + 1);
    this.leftJunction = new Float64Array(NOSE_SECTIONS + 1);
    this.diameter = new Float64Array(NOSE_SECTIONS);
    this.targetDiameter = new Float64Array(NOSE_SECTIONS);
    this.area = new Float64Array(NOSE_SECTIONS);
    this.reflection = new Float64Array(NOSE_SECTIONS + 1);
    this.opening = 0;
    this.targetOpening = 0;
    this.configure(0, 0.165, true);
  }

  get incomingAtJunction() {
    return this.left[0];
  }

  get junctionArea() {
    return Math.max(AREA_MINIMUM, this.area[0]);
  }

  configure(opening, tractLengthM, immediate = false) {
    this.targetOpening = clamp(opening);
    const lengthScale = clamp(Math.cbrt(Math.max(0.01, tractLengthM / 0.165)), 0.72, 1.52);
    for (let index = 0; index < NOSE_SECTIONS; index += 1) {
      const progress = index / (NOSE_SECTIONS - 1);
      // Pronounced alternating nasal chambers create the pole/antiresonance
      // pattern acoustically in the side tube instead of with an output EQ.
      const chamber = 0.31
        + Math.sin(progress * Math.PI) * 0.9
        + Math.sin(progress * Math.PI * 3.1) * 0.11;
      this.targetDiameter[index] = Math.max(0.09, chamber * lengthScale);
    }
    this.targetDiameter[0] = DIAMETER_MINIMUM + this.targetOpening * 1.08;
    if (immediate) {
      this.opening = this.targetOpening;
      this.diameter.set(this.targetDiameter);
    }
    updateReflections(this.diameter, this.area, this.reflection, NOSE_SECTIONS);
  }

  advanceGeometry() {
    this.opening += (this.targetOpening - this.opening)
      * (this.targetOpening > this.opening
        ? this.openingAlphaFast
        : this.openingAlphaSlow);
    this.targetDiameter[0] = DIAMETER_MINIMUM + this.opening * 1.08;
    for (let index = 0; index < NOSE_SECTIONS; index += 1) {
      this.diameter[index] = Math.max(
        DIAMETER_MINIMUM,
        this.diameter[index]
          + (this.targetDiameter[index] - this.diameter[index]) * this.diameterAlpha,
      );
    }
    updateReflections(this.diameter, this.area, this.reflection, NOSE_SECTIONS);
  }

  process(junctionInput, lossScale = 1) {
    this.rightJunction[0] = junctionInput;
    this.leftJunction[NOSE_SECTIONS] = this.right[NOSE_SECTIONS - 1] * NOSE_REFLECTION;
    for (let index = 1; index < NOSE_SECTIONS; index += 1) {
      const offset = this.reflection[index] * (this.right[index - 1] + this.left[index]);
      this.rightJunction[index] = this.right[index - 1] - offset;
      this.leftJunction[index] = this.left[index] + offset;
    }
    const propagationLoss = TUBE_LOSS * clamp(lossScale, 0.9, 1);
    for (let index = 0; index < NOSE_SECTIONS; index += 1) {
      this.right[index] = cleanWave(this.rightJunction[index] * propagationLoss);
      this.left[index] = cleanWave(this.leftJunction[index + 1] * propagationLoss);
    }
    return this.right[NOSE_SECTIONS - 1];
  }

  reset() {
    this.right.fill(0);
    this.left.fill(0);
    this.rightJunction.fill(0);
    this.leftJunction.fill(0);
  }

  isFinite() {
    return arraysAreFinite([
      this.right,
      this.left,
      this.rightJunction,
      this.leftJunction,
      this.diameter,
    ]);
  }
}

class CompliantCheekBranch {
  constructor(rate) {
    this.rate = rate;
    this.substepRate = rate * SUBSTEPS;
    this.geometryAlpha = timeAlpha(24, this.substepRate);
    this.boundaryAlpha = timeAlpha(18, this.substepRate);
    this.right = new Float64Array(CHEEK_SECTIONS);
    this.left = new Float64Array(CHEEK_SECTIONS);
    this.rightJunction = new Float64Array(CHEEK_SECTIONS + 1);
    this.leftJunction = new Float64Array(CHEEK_SECTIONS + 1);
    this.diameter = new Float64Array(CHEEK_SECTIONS);
    this.targetDiameter = new Float64Array(CHEEK_SECTIONS);
    this.area = new Float64Array(CHEEK_SECTIONS);
    this.reflection = new Float64Array(CHEEK_SECTIONS + 1);
    this.displacement = 0;
    this.velocity = 0;
    this.wallDrive = 0;
    this.collisionDrive = 0;
    this.lastExternalForce = 0;
    this.lastSuction = 0;
    this.boundaryReflection = 0.97;
    this.targetBoundaryReflection = 0.97;
    this.configure(HICCUP_HEAD_DEFAULTS, true);
  }

  get incomingAtJunction() {
    return this.left[0];
  }

  get junctionArea() {
    return Math.max(AREA_MINIMUM, this.area[0]);
  }

  configure(configuration, immediate = false) {
    const volume = finite(configuration.cheekVolume, HICCUP_HEAD_DEFAULTS.cheekVolume);
    const tension = finite(configuration.cheekTension, HICCUP_HEAD_DEFAULTS.cheekTension);
    const diameterScale = clamp(0.46 + volume * 0.34, 0.16, 1.36);
    for (let index = 0; index < CHEEK_SECTIONS; index += 1) {
      const progress = index / (CHEEK_SECTIONS - 1);
      const diameter = diameterScale * (0.48 + Math.sin(progress * Math.PI) * 0.58);
      this.targetDiameter[index] = Math.max(DIAMETER_MINIMUM, diameter);
    }
    this.targetDiameter[0] = Math.max(0.08, diameterScale * 0.34);
    this.targetBoundaryReflection = clamp(0.925 + tension * 0.035, 0.88, 0.997);
    if (immediate) {
      this.diameter.set(this.targetDiameter);
      this.boundaryReflection = this.targetBoundaryReflection;
    }
    updateReflections(this.diameter, this.area, this.reflection, CHEEK_SECTIONS);
    if (immediate) {
      this.displacement = 0;
      this.velocity = 0;
      this.wallDrive = 0;
      this.collisionDrive = 0;
      this.lastExternalForce = 0;
      this.lastSuction = 0;
    }
  }

  advance(frame, configuration, localPressure, plan = null) {
    for (let index = 0; index < CHEEK_SECTIONS; index += 1) {
      this.diameter[index] = Math.max(
        DIAMETER_MINIMUM,
        this.diameter[index]
          + (this.targetDiameter[index] - this.diameter[index]) * this.geometryAlpha,
      );
    }
    this.boundaryReflection += (this.targetBoundaryReflection - this.boundaryReflection)
      * this.boundaryAlpha;
    updateReflections(this.diameter, this.area, this.reflection, CHEEK_SECTIONS);
    const tension = finite(frame?.cheekTension, configuration.cheekTension);
    const isHand = frame?.soundId === "slap" || frame?.soundId === "smack";
    const volume = finite(frame?.cheekVolume, configuration.cheekVolume);
    const naturalFrequency = frame?.soundId === "tomlo" || frame?.soundId === "tomhi"
      ? clamp(finite(plan?.membraneFrequencyHz, 120), 34, 620)
      : frame?.soundId === "kick"
      ? clamp(38 + tension * 24, 30, 78)
      : isHand
        ? clamp(68 + tension * 238 + (0.72 - volume) * 66, 38, 520)
        : clamp(74 + tension * 180, 34, 460);
    const omega = Math.PI * 2 * naturalFrequency;
    const damping = clamp(0.08 + tension * 0.055, 0.025, 0.34);
    const pneumaticGesture = frame?.soundId === "bop"
      || frame?.soundId === "boop"
      || frame?.soundId === "shh"
      || frame?.soundId === "pff"
      || frame?.soundId === "pbpb"
      || frame?.soundId === "snare"
      || frame?.soundId === "braap"
      || frame?.soundId === "slurp"
      || frame?.soundId === "whistle";
    const lungScale = pneumaticGesture
      ? clamp(finite(configuration.lungPressure, 0) / HICCUP_HEAD_DEFAULTS.lungPressure)
      : 1;
    const externalForce = (
      finite(frame?.cheekImpulse, 0) * 1.08
      - finite(frame?.suction, 0) * 0.72
    ) * lungScale;
    const forceChange = externalForce - this.lastExternalForce;
    this.lastExternalForce = externalForce;
    const suction = finite(frame?.suction, 0);
    const suctionChange = suction - this.lastSuction;
    this.lastSuction = suction;
    // A hand/tongue collision moves the closed cheek wall faster than its
    // low-frequency compliant mode. The differentiated displacement is
    // injected at that wall and can reach the output only by returning through
    // the oral side junction.
    this.collisionDrive += forceChange * (0.032 + clamp(tension) * 0.018);
    // Tongue/cheek withdrawal expands the sealed pocket: its volume-flow sign
    // is negative while suction rises, positive on the release rebound.
    const suctionCollisionScale = frame?.soundId === "slurp"
      ? 0.28
      : frame?.soundId === "mwah" || frame?.soundId === "kiss"
        ? 0.24
        : 0.12;
    this.collisionDrive -= suctionChange * suctionCollisionScale;
    this.collisionDrive *= 0.88;
    const cheekForce = externalForce + clamp(localPressure, -2, 2) * 0.06;
    const acceleration = omega * omega * (cheekForce * 0.32 - this.displacement)
      - 2 * damping * omega * this.velocity;
    this.velocity = clamp(
      this.velocity + acceleration / this.substepRate,
      -1_200,
      1_200,
    );
    this.displacement = clamp(
      this.displacement + this.velocity / this.substepRate,
      -1.7,
      1.7,
    );
    this.wallDrive = clamp(
      this.velocity / Math.max(80, omega) * 0.11 + this.collisionDrive,
      -0.24,
      0.24,
    );
  }

  process(junctionInput, lossScale = 1) {
    this.rightJunction[0] = junctionInput;
    this.leftJunction[CHEEK_SECTIONS] = cleanWave(
      this.right[CHEEK_SECTIONS - 1] * this.boundaryReflection + this.wallDrive,
    );
    for (let index = 1; index < CHEEK_SECTIONS; index += 1) {
      const offset = this.reflection[index] * (this.right[index - 1] + this.left[index]);
      this.rightJunction[index] = this.right[index - 1] - offset;
      this.leftJunction[index] = this.left[index] + offset;
    }
    const propagationLoss = TUBE_LOSS * clamp(lossScale, 0.9, 1);
    for (let index = 0; index < CHEEK_SECTIONS; index += 1) {
      this.right[index] = cleanWave(this.rightJunction[index] * propagationLoss);
      this.left[index] = cleanWave(this.leftJunction[index + 1] * propagationLoss);
    }
  }

  reset() {
    this.right.fill(0);
    this.left.fill(0);
    this.rightJunction.fill(0);
    this.leftJunction.fill(0);
    this.displacement = 0;
    this.velocity = 0;
    this.wallDrive = 0;
    this.collisionDrive = 0;
    this.lastExternalForce = 0;
    this.lastSuction = 0;
  }

  isFinite() {
    return Number.isFinite(this.displacement)
      && Number.isFinite(this.velocity)
      && arraysAreFinite([
        this.right,
        this.left,
        this.rightJunction,
        this.leftJunction,
      ]);
  }
}

// A pressure-excited mass/spring valve. PFF never uses a periodic sine gate:
// lung/tract pressure opens the lip mass, Bernoulli unloading and the spring
// close it, and collisions seed the next parting.
class PressureDrivenLipValve {
  constructor(rate) {
    this.substepRate = rate * SUBSTEPS;
    this.positionRelease = 1 - timeAlpha(14, this.substepRate);
    this.velocityRelease = 1 - timeAlpha(10, this.substepRate);
    this.collisionRadiationAlpha = 1 - Math.exp(
      -Math.PI * 2 * 3_200 / this.substepRate,
    );
    this.braapCollisionRadiationAlpha = 1 - Math.exp(
      -Math.PI * 2 * 1_550 / this.substepRate,
    );
    this.positionCm = 0;
    this.velocityCmPerSecond = 0;
    this.apertureCm = DIAMETER_MINIMUM;
    this.collisionFlow = 0;
    this.radiatedCollisionFlow = 0;
  }

  advance(frame, plan, tractPressure, lungPressure = 1) {
    const enabled = (
      frame?.soundId === "pff"
      || frame?.soundId === "pbpb"
      || frame?.soundId === "braap"
    ) && finite(frame?.lipFlutter, 0) > 0.001;
    if (
      !enabled
      && this.positionCm === 0
      && this.velocityCmPerSecond === 0
      && this.collisionFlow === 0
      && this.radiatedCollisionFlow === 0
    ) {
      this.apertureCm = DIAMETER_MINIMUM;
      return this.apertureCm;
    }
    const flutter = enabled ? clamp(frame.lipFlutter) : 0;
    const isBraap = frame?.soundId === "braap";
    const frequency = clamp(finite(plan?.flutterFrequencyHz, 38), 12, 92);
    const omega = Math.PI * 2 * frequency;
    const tension = finite(frame?.lipTension, 0.4);
    const restPosition = enabled
      ? (isBraap ? -0.048 : -0.036) - Math.max(0, -tension) * (isBraap ? 0.06 : 0.045)
      : 0;
    const pressure = enabled && finite(lungPressure, 0) > 0.000001
      ? Math.max(
        0,
        // The softened PFRR gesture has a slower, lower pressure envelope;
        // retain enough trans-labial force to part the physical lip mass.
        finite(frame.pressureDrive, 0) * (isBraap ? 0.5 : 0.44)
          - finite(tractPressure, 0) * (isBraap ? 3 : 3.4),
      )
      : 0;
    const opening = Math.max(0, this.positionCm);
    // Flow across loose lips unloads them after opening and contributes
    // negative damping. With no pressure the damping is positive and the
    // valve cannot buzz on its own.
    const damping = clamp(
      (isBraap ? 0.07 : 0.085)
        + Math.max(0, tension) * 0.028
        - pressure * flutter * (isBraap ? 0.37 : 0.34),
      isBraap ? -0.13 : -0.11,
      0.22,
    );
    const aerodynamicForce = pressure * flutter * (
      (isBraap ? 0.275 : 0.23) - opening * (isBraap ? 2.75 : 3.25)
    );
    const acceleration = omega * omega * (
      restPosition + aerodynamicForce - this.positionCm
    ) - 2 * damping * omega * this.velocityCmPerSecond;
    const previousPositionCm = this.positionCm;
    this.velocityCmPerSecond = clamp(
      this.velocityCmPerSecond + acceleration / this.substepRate,
      -180,
      180,
    );
    this.positionCm += this.velocityCmPerSecond / this.substepRate;
    if (this.positionCm < 0) {
      const collisionVelocity = Math.min(0, this.velocityCmPerSecond);
      this.positionCm = 0;
      if (this.velocityCmPerSecond < 0) {
        this.velocityCmPerSecond *= isBraap ? -0.075 : -0.045;
      }
      // Contact emits energy only after pressure actually parted the lips.
      // A valve resting at zero aperture must not manufacture a collision on
      // every substep when lung pressure is zero.
      if (previousPositionCm > 0.0001 && finite(lungPressure, 0) > 0.000001) {
        this.collisionFlow += clamp(
          -collisionVelocity * (isBraap ? 0.00072 : 0.00062),
          0,
          0.1,
        );
      }
    }
    this.collisionFlow *= 0.88;
    // Lip contact is still generated by the pressure-driven valve, but soft
    // tissue cannot radiate the mathematically sharp collision edge. This
    // one-pole radiation memory removes the brittle ultrasonic click without
    // changing the low flutter rate or the pressure feedback which sustains it.
    this.radiatedCollisionFlow = cleanWave(
      this.radiatedCollisionFlow
        + (this.collisionFlow - this.radiatedCollisionFlow)
          * (isBraap ? this.braapCollisionRadiationAlpha : this.collisionRadiationAlpha),
    );
    if (!enabled) {
      this.positionCm *= this.positionRelease;
      this.velocityCmPerSecond *= this.velocityRelease;
    }
    this.apertureCm = clamp(
      DIAMETER_MINIMUM + Math.max(0, this.positionCm - 0.0012) * 3,
      DIAMETER_MINIMUM,
      1.15,
    );
    return this.apertureCm;
  }

  reset() {
    this.positionCm = 0;
    this.velocityCmPerSecond = 0;
    this.apertureCm = DIAMETER_MINIMUM;
    this.collisionFlow = 0;
    this.radiatedCollisionFlow = 0;
  }

  isFinite() {
    return Number.isFinite(this.positionCm)
      && Number.isFinite(this.velocityCmPerSecond)
      && Number.isFinite(this.apertureCm)
      && Number.isFinite(this.collisionFlow)
      && Number.isFinite(this.radiatedCollisionFlow);
  }
}

// A compliant tongue-tip mass. DRR supplies breath and a near-alveolar
// constriction, but no clocked oscillator: the local pressure drop parts the
// tip, aerodynamic unloading lets the spring close it, and each collision
// feeds a small volume pulse back into the same oral tube.
class PressureDrivenTongueValve {
  constructor(rate) {
    this.substepRate = rate * SUBSTEPS;
    this.positionRelease = 1 - timeAlpha(12, this.substepRate);
    this.velocityRelease = 1 - timeAlpha(8, this.substepRate);
    this.positionCm = 0;
    this.velocityCmPerSecond = 0;
    this.apertureCm = DIAMETER_MINIMUM;
    this.collisionFlow = 0;
  }

  advance(frame, plan, pressureDrop) {
    const enabled = TONGUE_TRILL_GESTURE_IDS.has(frame?.soundId)
      && finite(frame?.tongueTrill, 0) > 0.001;
    if (
      !enabled
      && this.positionCm === 0
      && this.velocityCmPerSecond === 0
      && this.collisionFlow === 0
    ) {
      this.apertureCm = DIAMETER_MINIMUM;
      return this.apertureCm;
    }
    const trill = enabled ? clamp(frame.tongueTrill) : 0;
    const frequency = clamp(finite(plan?.trillFrequencyHz, 34), 16, 72);
    const omega = Math.PI * 2 * frequency;
    const curl = finite(frame?.tongueCurl, 0.7);
    const pressure = enabled
      ? Math.max(0, finite(frame?.pressureDrive, 0) * 0.42 + finite(pressureDrop, 0) * 1.2)
      : 0;
    // Flow across a loose tip contributes negative damping; without pressure
    // the same tissue is positively damped and cannot self-oscillate.
    const damping = clamp(
      0.052 + Math.max(0, curl) * 0.01 - pressure * trill * 0.48,
      -0.12,
      0.13,
    );
    const opening = Math.max(0, this.positionCm);
    const restPosition = enabled ? -0.032 - Math.max(0, curl - 0.8) * 0.012 : 0;
    const aerodynamicForce = pressure * trill * (0.22 - opening * 3.8);
    const acceleration = omega * omega * (
      restPosition + aerodynamicForce - this.positionCm
    ) - 2 * damping * omega * this.velocityCmPerSecond;
    const previousPosition = this.positionCm;
    this.velocityCmPerSecond = clamp(
      this.velocityCmPerSecond + acceleration / this.substepRate,
      -220,
      220,
    );
    this.positionCm = clamp(
      this.positionCm + this.velocityCmPerSecond / this.substepRate,
      -0.08,
      0.42,
    );
    const contactThresholdCm = enabled ? 0.0007 : 0;
    if (this.positionCm < contactThresholdCm) {
      const collisionVelocity = Math.min(0, this.velocityCmPerSecond);
      this.positionCm = 0;
      if (this.velocityCmPerSecond < 0) this.velocityCmPerSecond *= -0.2;
      if (
        enabled
        && previousPosition > contactThresholdCm + 0.00001
        && pressure > 0.0001
      ) {
        this.collisionFlow += clamp(-collisionVelocity * 0.00034, 0, 0.065);
      }
    }
    this.collisionFlow *= 0.84;
    if (!enabled) {
      this.positionCm *= this.positionRelease;
      this.velocityCmPerSecond *= this.velocityRelease;
    }
    this.apertureCm = clamp(
      DIAMETER_MINIMUM + Math.max(0, this.positionCm) * 2.8,
      DIAMETER_MINIMUM,
      0.82,
    );
    return this.apertureCm;
  }

  reset() {
    this.positionCm = 0;
    this.velocityCmPerSecond = 0;
    this.apertureCm = DIAMETER_MINIMUM;
    this.collisionFlow = 0;
  }

  isFinite() {
    return Number.isFinite(this.positionCm)
      && Number.isFinite(this.velocityCmPerSecond)
      && Number.isFinite(this.apertureCm)
      && Number.isFinite(this.collisionFlow);
  }
}

// A heavier compliant flap in the uvular/epiglottal region. Like the tongue
// roll it has no metronomic oscillator: local pressure provides negative
// damping, the tissue spring returns it toward contact, and collisions feed
// volume flow back into this same tract.
class PressureDrivenThroatValve {
  constructor(rate) {
    this.substepRate = rate * SUBSTEPS;
    this.positionRelease = 1 - timeAlpha(16, this.substepRate);
    this.velocityRelease = 1 - timeAlpha(10, this.substepRate);
    this.positionCm = 0;
    this.velocityCmPerSecond = 0;
    this.apertureCm = DIAMETER_MINIMUM;
    this.collisionFlow = 0;
    // A wet throat flap cannot radiate an ideal hard contact. Keep its
    // pressure-driven motion intact, but round the collision edge before the
    // rattle gesture feeds it back into the oral tube.
    this.collisionRadiationAlpha = 1 - Math.exp(
      -Math.PI * 2 * 1_150 / this.substepRate,
    );
    this.radiatedCollisionFlow = 0;
  }

  advance(frame, plan, pressureDrop) {
    const enabled = (
      frame?.soundId === "rattle"
      || frame?.soundId === "grunt"
      || HICCUP_GESTURE_IDS.has(frame?.soundId)
    ) && finite(frame?.throatRattle, 0) > 0.001;
    if (
      !enabled
      && this.positionCm === 0
      && this.velocityCmPerSecond === 0
      && this.collisionFlow === 0
      && this.radiatedCollisionFlow === 0
    ) {
      this.apertureCm = DIAMETER_MINIMUM;
      return this.apertureCm;
    }
    const amount = enabled ? clamp(frame.throatRattle) : 0;
    const frequency = clamp(finite(plan?.rattleFrequencyHz, 27), 14, 52);
    const omega = Math.PI * 2 * frequency;
    const pressure = enabled
      ? Math.max(0, finite(frame?.pressureDrive, 0) * 0.5 + finite(pressureDrop, 0) * 1.35)
      : 0;
    const damping = clamp(0.075 - pressure * amount * 0.42, -0.105, 0.16);
    const opening = Math.max(0, this.positionCm);
    const restPosition = enabled ? -0.026 : 0;
    const aerodynamicForce = pressure * amount * (0.19 - opening * 3.1);
    const acceleration = omega * omega * (
      restPosition + aerodynamicForce - this.positionCm
    ) - 2 * damping * omega * this.velocityCmPerSecond;
    const previousPosition = this.positionCm;
    this.velocityCmPerSecond = clamp(
      this.velocityCmPerSecond + acceleration / this.substepRate,
      -180,
      180,
    );
    this.positionCm = clamp(
      this.positionCm + this.velocityCmPerSecond / this.substepRate,
      -0.07,
      0.36,
    );
    if (this.positionCm < 0.0006) {
      const collisionVelocity = Math.min(0, this.velocityCmPerSecond);
      this.positionCm = 0;
      if (this.velocityCmPerSecond < 0) this.velocityCmPerSecond *= -0.24;
      if (enabled && previousPosition > 0.00062 && pressure > 0.0001) {
        this.collisionFlow += clamp(-collisionVelocity * 0.00048, 0, 0.072);
      }
    }
    this.collisionFlow *= 0.86;
    this.radiatedCollisionFlow = cleanWave(
      this.radiatedCollisionFlow
        + (this.collisionFlow - this.radiatedCollisionFlow)
          * this.collisionRadiationAlpha,
    );
    if (!enabled) {
      this.positionCm *= this.positionRelease;
      this.velocityCmPerSecond *= this.velocityRelease;
      if (Math.abs(this.radiatedCollisionFlow) < 1e-12) {
        this.radiatedCollisionFlow = 0;
      }
    }
    this.apertureCm = clamp(
      DIAMETER_MINIMUM + Math.max(0, this.positionCm) * 2.9,
      DIAMETER_MINIMUM,
      0.76,
    );
    return this.apertureCm;
  }

  reset() {
    this.positionCm = 0;
    this.velocityCmPerSecond = 0;
    this.apertureCm = DIAMETER_MINIMUM;
    this.collisionFlow = 0;
    this.radiatedCollisionFlow = 0;
  }

  isFinite() {
    return Number.isFinite(this.positionCm)
      && Number.isFinite(this.velocityCmPerSecond)
      && Number.isFinite(this.apertureCm)
      && Number.isFinite(this.collisionFlow)
      && Number.isFinite(this.radiatedCollisionFlow);
  }
}

// A wall-impingement edge tone at the missing incisor. Bernoulli flow sets
// jet speed and f = St*u/x sets the coherent edge-tone frequency. The source
// is pressure-thresholded, hysteretic between jet modes, and is injected into
// the anterior oral delay line below; it is not an output-side oscillator or
// filter. Local oral pressure feeds back into the jet so the living tube can
// pull and roughen the tone.
class PressureDrivenToothGapJet {
  constructor(rate) {
    this.rate = rate;
    this.substepRate = rate * SUBSTEPS;
    this.amplitudeRelease = 1 - timeAlpha(8, this.substepRate);
    this.mode = 1;
    this.phase = 0;
    this.amplitude = 0;
    this.noiseMemory = 0;
    this.jetSpeedMps = 0;
    this.frequencyHz = 0;
    this.impingementLengthM = HICCUP_HEAD_TOOTH_GAP_ANATOMY.baseImpingementLengthM;
    this.strouhalNumber = HICCUP_HEAD_TOOTH_GAP_ANATOMY.strouhalNumbers[1];
    this.flow = 0;
  }

  _updateMode(control) {
    if (this.mode === 0 && control > 0.34) this.mode = 1;
    if (this.mode === 1 && control < 0.24) this.mode = 0;
    if (this.mode === 1 && control > 0.72) this.mode = 2;
    if (this.mode === 2 && control < 0.58) this.mode = 1;
  }

  advanceInactive(frame, plan, noise) {
    // Preserve the inaudible oscillator's decay/mode/noise history so the next
    // whistle starts exactly as before, but avoid pressure taps, Bernoulli
    // flow, phase synthesis, and trigonometry while the tooth jet is closed.
    const tension = clamp((finite(frame?.lipTension, 0.46) + 0.35) / 2);
    const tongueAim = clamp((finite(frame?.tonguePosition, 0.58) + 0.65) / 2.3);
    this._updateMode(tension * 0.38 + tongueAim * 0.22);
    const threshold = 0.075 + (1 - tongueAim) * 0.035;
    const squaredAmplitude = this.amplitude * this.amplitude;
    this.amplitude += (
      -threshold * 145 * this.amplitude
      - 84 * squaredAmplitude * this.amplitude
    ) / this.substepRate;
    this.amplitude *= this.amplitudeRelease;
    this.amplitude = clamp(cleanWave(this.amplitude), 0, 1.32);
    this.noiseMemory += (noise - this.noiseMemory) * 0.024;
    this.jetSpeedMps = 0;
    this.frequencyHz = 0;
    this.impingementLengthM = clamp(
      finite(
        plan?.toothJetImpingementLengthM,
        HICCUP_HEAD_TOOTH_GAP_ANATOMY.baseImpingementLengthM,
      ),
      0.00072,
      0.0038,
    );
    this.strouhalNumber = HICCUP_HEAD_TOOTH_GAP_ANATOMY.strouhalNumbers[this.mode];
    this.flow = 0;
    return this.flow;
  }

  advance(frame, plan, localOralPressure, noise) {
    const enabled = frame?.soundId === "whistle"
      && finite(frame?.toothJet, 0) > 0.001;
    if (!enabled) return this.advanceInactive(frame, plan, noise);
    const jetGesture = clamp(frame.toothJet);
    const suppliedPressure = Math.max(0, finite(frame.pressureDrive, 0));
    const normalizedPressure = suppliedPressure > 0.000001
      ? clamp(
        suppliedPressure
          + clamp(Math.abs(finite(localOralPressure, 0)) * 0.42, 0, 0.24),
        0,
        1.8,
      ) * jetGesture
      : 0;
    const tension = clamp((finite(frame?.lipTension, 0.46) + 0.35) / 2);
    const tongueAim = clamp((finite(frame?.tonguePosition, 0.58) + 0.65) / 2.3);
    this._updateMode(tension * 0.38 + tongueAim * 0.22 + normalizedPressure * 0.34);

    const threshold = 0.075 + (1 - tongueAim) * 0.035;
    const excessPressure = Math.max(0, normalizedPressure - threshold);
    const growth = (normalizedPressure - threshold) * 145;
    const saturation = 84;
    const squaredAmplitude = this.amplitude * this.amplitude;
    // Turbulent onset forcing is proportional to real flow, allowing an idle
    // whistle to restart but making both tone and seed vanish at zero breath.
    const onsetForcing = excessPressure * (0.12 + Math.abs(noise) * 0.045);
    this.amplitude += (
      growth * this.amplitude
      - saturation * squaredAmplitude * this.amplitude
      + onsetForcing
    ) / this.substepRate;
    this.amplitude = clamp(cleanWave(this.amplitude), 0, 1.32);

    this.noiseMemory += (noise - this.noiseMemory) * 0.024;
    const pressurePa = normalizedPressure
      * finite(plan?.toothWhistleMaximumPressurePa, HICCUP_HEAD_TOOTH_GAP_ANATOMY.maximumOralPressurePa);
    const jetSpeedMps = Math.sqrt(
      2 * Math.max(0, pressurePa) / HICCUP_HEAD_TOOTH_GAP_ANATOMY.airDensityKgM3,
    );
    const breathiness = clamp(finite(plan?.breathiness, 0.12));
    const roughness = clamp(finite(plan?.roughness, 0.08));
    const acousticLengthPull = clamp(localOralPressure * 0.018, -0.08, 0.08);
    const impingementLengthM = clamp(
      finite(
        plan?.toothJetImpingementLengthM,
        HICCUP_HEAD_TOOTH_GAP_ANATOMY.baseImpingementLengthM,
      ) * (1 + acousticLengthPull),
      0.00072,
      0.0038,
    );
    const strouhalNumber = HICCUP_HEAD_TOOTH_GAP_ANATOMY.strouhalNumbers[this.mode];
    const jitteredJetSpeed = jetSpeedMps * (
      1 + roughness * (noise - this.noiseMemory) * 0.018
    );
    const frequencyHz = clamp(
      strouhalNumber * jitteredJetSpeed / impingementLengthM,
      0,
      this.rate * 0.38,
    );
    this.phase += Math.PI * 2 * frequencyHz / this.substepRate;
    if (this.phase >= Math.PI * 2) this.phase %= Math.PI * 2;

    const edgeAngle = clamp(
      finite(plan?.toothEdgeAngleDegrees, HICCUP_HEAD_TOOTH_GAP_ANATOMY.edgeAngleDegrees),
      10,
      70,
    );
    const harmonicGain = frequencyHz * 2 < this.rate * 0.38
      ? 0.045 + tension * 0.075 + Math.abs(edgeAngle - 34) / 360
      : 0;
    const coherentJet = Math.sin(this.phase)
      + harmonicGain * Math.sin(this.phase * 2);
    const noisyJet = (noise - this.noiseMemory)
      * (0.025 + breathiness * 0.075)
      * normalizedPressure;
    // sqrt(P) follows jet momentum. It multiplies the entire edge tone, so
    // any residual oscillator state is rigorously inaudible without flow.
    const source = (
      coherentJet * this.amplitude * Math.sqrt(normalizedPressure) * 0.012
      + noisyJet * 0.0028
    ) * jetGesture;
    this.jetSpeedMps = jetSpeedMps;
    this.frequencyHz = frequencyHz;
    this.impingementLengthM = impingementLengthM;
    this.strouhalNumber = strouhalNumber;
    this.flow = cleanWave(clamp(source, -0.065, 0.065));
    return this.flow;
  }

  reset() {
    this.mode = 1;
    this.phase = 0;
    this.amplitude = 0;
    this.noiseMemory = 0;
    this.jetSpeedMps = 0;
    this.frequencyHz = 0;
    this.impingementLengthM = HICCUP_HEAD_TOOTH_GAP_ANATOMY.baseImpingementLengthM;
    this.strouhalNumber = HICCUP_HEAD_TOOTH_GAP_ANATOMY.strouhalNumbers[1];
    this.flow = 0;
  }

  isFinite() {
    return Number.isFinite(this.phase)
      && Number.isFinite(this.amplitude)
      && Number.isFinite(this.noiseMemory)
      && Number.isFinite(this.jetSpeedMps)
      && Number.isFinite(this.frequencyHz)
      && Number.isFinite(this.impingementLengthM)
      && Number.isFinite(this.flow);
  }
}

// A struck tooth is a short, lossy cantilever rather than another voice. Two
// crooked bending modes and a low-passed contact pulse launch volume flow into
// the anterior oral tube. Their deliberately low Q makes a dry dead-wood knock
// which the one mouth colors, not a clean tuned bar layered over the mouth.
class ToothTineResonator {
  constructor(rate) {
    this.rate = rate;
    this.substepRate = rate * SUBSTEPS;
    this.eventToken = null;
    // Keep the requested profile frequency visible to the app while the
    // physical resonator compresses it into the dull wooden stiffness range.
    this.frequencyHz = 0;
    this.resonantFrequencyHz = 0;
    this.position = 0;
    this.brightness = 0;
    this.toothIndex = 0;
    this.canonicalSection = HICCUP_HEAD_TOOTH_GAP_ANATOMY.canonicalOralSection;
    this.coefficient = new Float64Array(3);
    this.coefficientLimit = new Float64Array(3);
    this.radiusSquared = new Float64Array(3);
    this.strikeGain = new Float64Array(3);
    this.previousPhaseScale = new Float64Array(3);
    this.state1 = new Float64Array(3);
    this.state2 = new Float64Array(3);
    this.contactBody = 0;
    this.contactNoiseMemory = 0;
    this.detuneMemory = 0;
    this.contactRelease = 0;
    this.contactNoiseAlpha = 0;
    this.previousContact = 0;
    this.previousPhase = 0;
    this.armed = false;
    this.triggered = false;
    this.active = false;
    this.flow = 0;
  }

  _beginEvent(metadata, frame) {
    this.eventToken = metadata;
    this.previousContact = clamp(finite(frame?.tongueContact, 0));
    this.previousPhase = clamp(finite(frame?.phase, 0));
    this.armed = this.previousContact > 0.62;
    this.triggered = false;
    if (!metadata) return;

    this.frequencyHz = clamp(
      finite(metadata.frequencyHz, 520),
      TOOTH_TINE_MINIMUM_HZ,
      TOOTH_TINE_MAXIMUM_HZ,
    );
    this.position = clamp(finite(metadata.position, 0.72));
    this.brightness = clamp(finite(metadata.brightness, 0.68));
    this.toothIndex = Math.round(clamp(
      finite(metadata.toothIndex, 5),
      0,
      TOOTH_TINE_COUNT - 1,
    ));
    this.canonicalSection = 35.8
      + this.toothIndex / (TOOTH_TINE_COUNT - 1) * 6.1;

    // Track the requested tooth bank much more directly than the former
    // square-root compression. A 130–700 Hz app bank now spans roughly
    // 116–566 Hz physically, while small crooked-tooth offsets retain wood
    // character without scrambling the ordered pitches.
    this.resonantFrequencyHz = clamp(
      this.frequencyHz
        + TOOTH_WOOD_FREQUENCY_OFFSETS_HZ[this.toothIndex],
      96,
      820,
    );
    const x = 0.03 + this.position * 0.97;
    const toothCrookedness = (this.toothIndex % 5 - 2) * 0.017;
    const baseDecaySeconds = (
      0.082 + (1 - this.brightness) * 0.038 + this.position * 0.018
    ) * TOOTH_WOOD_DECAY_SCALES[this.toothIndex];
    for (let mode = 0; mode < TOOTH_WOOD_MODE_COUNT; mode += 1) {
      const modeRatio = mode === 0 ? 1 : 3.92 + toothCrookedness;
      const modeFrequency = Math.min(
        this.resonantFrequencyHz * modeRatio,
        this.rate * 0.24,
      );
      const omega = Math.PI * 2 * modeFrequency / this.substepRate;
      const decaySeconds = baseDecaySeconds * (mode === 0 ? 1 : 0.26);
      const radius = Math.exp(
        Math.log(0.001) / Math.max(1, decaySeconds * this.substepRate),
      );
      this.coefficient[mode] = 2 * radius * Math.cos(omega);
      this.coefficientLimit[mode] = 2 * radius * (1 - 1e-7);
      this.radiusSquared[mode] = radius * radius;
      this.previousPhaseScale[mode] = Math.cos(omega) / radius;
      // A gum-line tap transfers less bending energy than a free-edge tap,
      // but a real tooth/root is not a perfect modal node. Keep a restrained
      // floor so every one of the twelve crooked stiffnesses remains audible.
      const bendingShape = 0.32
        + Math.abs(Math.sin((mode + 0.62) * Math.PI * x)) * 0.68;
      const brightnessGain = mode === 0
        ? 0.82
        : 0.018 + this.brightness * 0.038;
      this.strikeGain[mode] = bendingShape * brightnessGain;
      // Retargeting one mouth lightly damps any preceding tooth rather than
      // layering an independent tine voice over the new strike.
      this.state1[mode] *= 0.12;
      this.state2[mode] *= 0.12;
    }
    this.coefficient[2] = 0;
    this.coefficientLimit[2] = 0;
    this.radiusSquared[2] = 0;
    this.strikeGain[2] = 0;
    this.previousPhaseScale[2] = 0;
    this.state1[2] = 0;
    this.state2[2] = 0;
    const contactDecaySeconds = 0.0075
      + this.position * 0.0045
      + (1 - this.brightness) * 0.0025;
    this.contactRelease = Math.exp(
      Math.log(0.001) / Math.max(1, contactDecaySeconds * this.substepRate),
    );
    const contactCutoffHz = 620 + this.brightness * 760;
    this.contactNoiseAlpha = 1 - Math.exp(
      -Math.PI * 2 * contactCutoffHz / this.substepRate,
    );
    this.contactBody *= 0.12;
    this.contactNoiseMemory *= 0.12;
    this.detuneMemory *= 0.12;
  }

  _strike(frame, localPressure, noise) {
    const velocity = clamp(finite(frame?.velocity, 0.72), 0.01, 1);
    const releaseSpeed = clamp(this.previousContact - finite(frame?.tongueContact, 0));
    const pressureCoupling = 1 + clamp(Math.abs(finite(localPressure, 0)) * 0.32, 0, 0.28);
    const edgeReach = 0.58 + Math.sqrt(this.position) * 0.52;
    const frequencyBalance = 0.88
      + Math.sqrt(this.resonantFrequencyHz / 260) * 0.12;
    const impulse = (0.00125 + velocity * 0.00215)
      * (0.78 + releaseSpeed * 0.34)
      * pressureCoupling
      * edgeReach
      * frequencyBalance
      * (0.94 + noise * 0.06)
      * TOOTH_WOOD_IMPACT_GAIN;
    for (let mode = 0; mode < TOOTH_WOOD_MODE_COUNT; mode += 1) {
      const displacement = impulse * this.strikeGain[mode];
      this.state1[mode] = cleanWave(this.state1[mode] + displacement);
      this.state2[mode] = cleanWave(
        this.state2[mode] + displacement * this.previousPhaseScale[mode],
      );
    }
    this.contactBody = cleanWave(
      this.contactBody + impulse * (0.32 + (1 - this.position) * 0.18),
    );
    this.contactNoiseMemory = noise * 0.18;
    this.active = true;
    this.triggered = true;
  }

  strikeNow(metadata, frame, localPressure, noise) {
    // BRUSH contacts are imposed by a physical bristle crossing each tooth,
    // rather than by twelve replacement mouth gestures. Prime the same
    // release-sensitive cantilever with a completed contact and let its
    // existing modes continue inside the shared tract.
    const plantedFrame = { ...frame, tongueContact: 1 };
    this._beginEvent(metadata, plantedFrame);
    this.armed = true;
    this.previousContact = 1;
    this._strike({ ...frame, tongueContact: 0 }, localPressure, noise);
  }

  advance(frame, plan, localPressure, noise) {
    const metadata = plan?.toothTine ?? null;
    if (metadata !== this.eventToken) this._beginEvent(metadata, frame);
    if (metadata && frame?.soundId === "tlik") {
      const contact = clamp(finite(frame.tongueContact, 0));
      const phase = clamp(finite(frame.phase, 0));
      if (contact > 0.62) this.armed = true;
      const contactReleased = this.armed
        && this.previousContact > 0.46
        && contact <= 0.46;
      const phaseReleased = this.armed
        && this.previousPhase < 0.545
        && phase >= 0.545;
      if (!this.triggered && (contactReleased || phaseReleased)) {
        this._strike(frame, localPressure, noise);
      }
      this.previousContact = contact;
      this.previousPhase = phase;
    }
    if (!this.active) {
      this.flow = 0;
      return this.flow;
    }

    // Tiny low-passed stiffness wander removes the fixed-pitch fingerprint.
    // A radius-derived hard limit keeps the time-varying recurrence stable.
    this.detuneMemory += (noise - this.detuneMemory) * 0.0032;
    const detuneScale = 1 + this.detuneMemory * 0.0005;
    let modalFlow = 0;
    let energy = this.contactBody * this.contactBody;
    for (let mode = 0; mode < TOOTH_WOOD_MODE_COUNT; mode += 1) {
      const detunedCoefficient = clamp(
        this.coefficient[mode] * detuneScale,
        -this.coefficientLimit[mode],
        this.coefficientLimit[mode],
      );
      const next = cleanWave(
        detunedCoefficient * this.state1[mode]
          - this.radiusSquared[mode] * this.state2[mode],
      );
      this.state2[mode] = this.state1[mode];
      this.state1[mode] = next;
      modalFlow += next;
      energy += next * next;
    }
    this.contactNoiseMemory += (
      noise - this.contactNoiseMemory
    ) * this.contactNoiseAlpha;
    const contactFlow = this.contactBody * (
      0.68 + this.contactNoiseMemory * (0.23 + this.brightness * 0.11)
    );
    this.contactBody = cleanWave(this.contactBody * this.contactRelease);
    if (energy < 1e-16) {
      this.state1.fill(0);
      this.state2.fill(0);
      this.contactBody = 0;
      this.contactNoiseMemory = 0;
      this.detuneMemory = 0;
      this.active = false;
      this.flow = 0;
      return this.flow;
    }
    this.flow = cleanWave(clamp(modalFlow + contactFlow, -0.05, 0.05));
    return this.flow;
  }

  choke(amount = 0.24) {
    const keep = clamp(amount, 0, 1);
    for (let mode = 0; mode < TOOTH_WOOD_MODE_COUNT; mode += 1) {
      this.state1[mode] *= keep;
      this.state2[mode] *= keep;
    }
    this.contactBody *= keep;
    this.contactNoiseMemory *= keep;
    this.flow *= keep;
  }

  reset() {
    this.eventToken = null;
    this.frequencyHz = 0;
    this.resonantFrequencyHz = 0;
    this.position = 0;
    this.brightness = 0;
    this.toothIndex = 0;
    this.canonicalSection = HICCUP_HEAD_TOOTH_GAP_ANATOMY.canonicalOralSection;
    this.coefficient.fill(0);
    this.coefficientLimit.fill(0);
    this.radiusSquared.fill(0);
    this.strikeGain.fill(0);
    this.previousPhaseScale.fill(0);
    this.state1.fill(0);
    this.state2.fill(0);
    this.contactBody = 0;
    this.contactNoiseMemory = 0;
    this.detuneMemory = 0;
    this.contactRelease = 0;
    this.contactNoiseAlpha = 0;
    this.previousContact = 0;
    this.previousPhase = 0;
    this.armed = false;
    this.triggered = false;
    this.active = false;
    this.flow = 0;
  }

  isFinite() {
    return Number.isFinite(this.frequencyHz)
      && Number.isFinite(this.resonantFrequencyHz)
      && Number.isFinite(this.position)
      && Number.isFinite(this.brightness)
      && Number.isFinite(this.toothIndex)
      && Number.isFinite(this.canonicalSection)
      && Number.isFinite(this.previousContact)
      && Number.isFinite(this.previousPhase)
      && Number.isFinite(this.contactBody)
      && Number.isFinite(this.contactNoiseMemory)
      && Number.isFinite(this.detuneMemory)
      && Number.isFinite(this.contactRelease)
      && Number.isFinite(this.contactNoiseAlpha)
      && Number.isFinite(this.flow)
      && arraysAreFinite([
        this.coefficient,
        this.coefficientLimit,
        this.radiusSquared,
        this.strikeGain,
        this.previousPhaseScale,
        this.state1,
        this.state2,
      ]);
  }
}

class OrganicMouthTract {
  constructor(rate, configuration) {
    this.rate = rate;
    this.substepRate = rate * SUBSTEPS;
    this.sealChargeAlpha = timeAlpha(18, this.substepRate);
    this.sealEnergyAlpha = timeAlpha(28, this.substepRate);
    this.sealVacuumAttackAlpha = timeAlpha(4, this.substepRate);
    this.sealVacuumReleaseAlpha = timeAlpha(45, this.substepRate);
    this.sealClosedVacuumRelease = 1 - timeAlpha(32, this.substepRate);
    this.sealReservoirRelease = 1 - timeAlpha(55, this.substepRate);
    this.sealEnergyRelease = 1 - timeAlpha(70, this.substepRate);
    this.sealVacuumRelease = 1 - timeAlpha(24, this.substepRate);
    this.sealBoostRelease = 1 - timeAlpha(34, this.substepRate);
    this.sealMemoryRelease = 1 - timeAlpha(8, this.substepRate);
    this.signedPressureAlpha = timeAlpha(16, this.substepRate);
    this.pffTurbulenceAlpha = 1 - Math.exp(
      -Math.PI * 2 * 3_600 / this.substepRate,
    );
    this.huffTurbulenceAlpha = 1 - Math.exp(
      -Math.PI * 2 * 1_650 / this.substepRate,
    );
    this.slurpWetAlpha = 1 - Math.exp(
      -Math.PI * 2 * 1_650 / this.substepRate,
    );
    // 152 covers Hiccup Head's 52 cm limit at 48 kHz. Higher-rate worklets get
    // proportionally more preallocated cells so the length control continues
    // to change propagation delay instead of silently saturating.
    this.capacity = Math.max(
      MAX_ORAL_SECTIONS,
      Math.ceil(MAX_TRACT_LENGTH_M * rate * SUBSTEPS / SPEED_OF_SOUND_MPS) + 3,
    );
    this.sectionCount = 0;
    this.right = new Float64Array(this.capacity);
    this.left = new Float64Array(this.capacity);
    this.rightJunction = new Float64Array(this.capacity + 1);
    this.leftJunction = new Float64Array(this.capacity + 1);
    this.diameter = new Float64Array(this.capacity);
    this.targetDiameter = new Float64Array(this.capacity);
    this.area = new Float64Array(this.capacity);
    this.reflection = new Float64Array(this.capacity + 1);
    this.resizeRight = new Float64Array(this.capacity);
    this.resizeLeft = new Float64Array(this.capacity);
    this.resizeDiameter = new Float64Array(this.capacity);
    this.nose = new NasalBranch(rate);
    this.cheek = new CompliantCheekBranch(rate);
    this.lipValve = new PressureDrivenLipValve(rate);
    this.tongueValve = new PressureDrivenTongueValve(rate);
    this.throatValve = new PressureDrivenThroatValve(rate);
    this.toothJet = new PressureDrivenToothGapJet(rate);
    this.toothTine = new ToothTineResonator(rate);
    this.brushPlanToken = null;
    this.brushContactIndex = -1;
    this.brushSweepActive = false;
    this.brushSweepPhase = 1;
    this.brushSweepPhaseStep = 0;
    this.brushSweepDirection = 1;
    this.brushSweepFrame = null;
    this.brushCarryActive = false;
    this.articulationSpeedScale = 1;
    this.noseJunction = 4;
    this.cheekJunction = 7;
    this.activeConstrictionIndex = 5;
    this.currentFrame = null;
    this.currentPlan = null;
    this.tailLoss = 1;
    this.tractPressure = 0;
    this.signedPressure = 0;
    this.lastOralOutput = 0;
    this.lastNasalOutput = 0;
    this.surfaceContactOutput = 0;
    this.previousLipImpulse = 0;
    this.previousPrimaryConstriction = 0;
    this.previousSecondaryConstriction = 0;
    this.pffTurbulenceMemory = 0;
    this.huffTurbulenceMemory = 0;
    this.slurpWetMemory = 0;
    this.seals = [
      this._newSeal("lip"),
      this._newSeal("primary"),
      this._newSeal("secondary"),
      this._newSeal("tongueTip"),
    ];
    this.transients = Array.from({ length: 10 }, () => ({
      active: false,
      index: 0,
      strength: 0,
      ageSeconds: 1,
      delaySeconds: 0,
      decayRate: 260,
      durationSeconds: 0.028,
      noiseMix: 0.26,
      surfaceMix: 0,
      surfaceNoiseMemory: 0,
    }));
    this.handContactSound = "";
    this.previousHandPhase = 1;
    this.handContactTriggered = false;
    this.configure(configuration, true);
  }

  _newSeal(name) {
    return {
      name,
      index: 0,
      enabled: false,
      sealed: false,
      reservoir: 0,
      energy: 0,
      vacuumPressure: 0,
      releaseBoost: 0,
      releaseMemory: 0,
    };
  }

  _sectionCountForLength(lengthM) {
    return Math.round(clamp(
      finite(lengthM, HICCUP_HEAD_DEFAULTS.tractLengthM) * this.rate * SUBSTEPS / SPEED_OF_SOUND_MPS,
      MIN_ORAL_SECTIONS,
      this.capacity,
    ));
  }

  _resize(nextCount) {
    const count = clamp(Math.round(nextCount), MIN_ORAL_SECTIONS, this.capacity);
    if (count === this.sectionCount) return;
    const previousCount = this.sectionCount;
    if (previousCount > 1) {
      for (let index = 0; index < count; index += 1) {
        const previousPosition = index / Math.max(1, count - 1) * (previousCount - 1);
        this.resizeRight[index] = resample(this.right.subarray(0, previousCount), previousPosition);
        this.resizeLeft[index] = resample(this.left.subarray(0, previousCount), previousPosition);
        this.resizeDiameter[index] = resample(
          this.diameter.subarray(0, previousCount),
          previousPosition,
        );
      }
      this.right.set(this.resizeRight.subarray(0, count));
      this.left.set(this.resizeLeft.subarray(0, count));
      this.diameter.set(this.resizeDiameter.subarray(0, count));
    }
    if (count < previousCount) {
      this.right.fill(0, count, previousCount);
      this.left.fill(0, count, previousCount);
      this.diameter.fill(DIAMETER_MINIMUM, count, previousCount);
    }
    this.sectionCount = count;
    this.noseJunction = clamp(
      Math.round(17 / (HICCUP_HEAD_TRACT_SECTION_COUNT - 1) * (count - 1)),
      2,
      count - 3,
    );
    this.cheekJunction = clamp(
      Math.round(29 / (HICCUP_HEAD_TRACT_SECTION_COUNT - 1) * (count - 1)),
      2,
      count - 3,
    );
    for (const seal of this.seals) {
      seal.index = clamp(seal.index, 1, count - 1);
    }
  }

  _restFrame(configuration) {
    return {
      soundId: "",
      pressureDrive: 0,
      lipClosure: 0,
      lipImpulse: 0,
      tongueContact: 0,
      constrictionPosition: 0.5,
      constriction: 0,
      secondaryConstrictionPosition: 22 / 43,
      secondaryConstriction: 0,
      velum: configuration.nasalMix,
      turbulence: 0,
      suction: 0,
      cheekImpulse: 0,
      jawImpulse: 0,
      voicing: 0,
      aspiration: 0,
      lipFlutter: 0,
      tongueTrill: 0,
      throatRattle: 0,
      registerLift: 0,
      breathDirection: 0,
      diaphragmCatch: 0,
      lipTension: configuration.lipTension,
      cheekVolume: configuration.cheekVolume,
      cheekTension: configuration.cheekTension,
      tonguePosition: configuration.tonguePosition,
      tongueCurl: configuration.tongueCurl,
      tongueOut: finite(configuration.tongueOut, 0),
      mouthOpening: configuration.mouthOpening,
      tractLengthM: configuration.tractLengthM,
    };
  }

  configure(configuration, immediate = false) {
    this.configuration = configuration;
    const restFrame = this._restFrame(configuration);
    this.setArticulation(configuration, restFrame, null, immediate);
    this.cheek.configure(restFrame, immediate);
  }

  setArticulation(configuration, frame, plan = null, immediate = false) {
    this.configuration = configuration;
    const articulation = frame ?? this._restFrame(configuration);
    const sectionCount = this._sectionCountForLength(
      finite(articulation.tractLengthM, configuration.tractLengthM),
    );
    this._resize(sectionCount);
    const targetArticulation = articulation.soundId === "pff"
      || articulation.soundId === "pbpb"
      || articulation.soundId === "braap"
      ? { ...articulation, lipClosure: 0, constriction: 0 }
      : articulation;
    const canonical = hiccupHeadTargetOralDiameters(configuration, targetArticulation);
    for (let index = 0; index < this.sectionCount; index += 1) {
      const canonicalPosition = index / Math.max(1, this.sectionCount - 1)
        * (HICCUP_HEAD_TRACT_SECTION_COUNT - 1);
      this.targetDiameter[index] = clamp(
        resample(canonical, canonicalPosition),
        DIAMETER_MINIMUM,
        6.5,
      );
    }
    if (immediate) this.diameter.set(this.targetDiameter.subarray(0, this.sectionCount));
    updateReflections(this.diameter, this.area, this.reflection, this.sectionCount);
    this.currentFrame = articulation;
    this.currentPlan = plan;
    const isOralStop = articulation.soundId === "bop"
      || articulation.soundId === "boop"
      || articulation.soundId === "pop"
      || articulation.soundId === "tlik"
      || articulation.soundId === "shh"
      || articulation.soundId === "shack"
      || articulation.soundId === "pff"
      || articulation.soundId === "pbpb"
      || articulation.soundId === "lala"
      || articulation.soundId === "llll"
      || articulation.soundId === "klikklak"
      || articulation.soundId === "rrrr"
      || articulation.soundId === "lrroll"
      || articulation.soundId === "lalatrip"
      || articulation.soundId === "slurp"
      || HICCUP_GESTURE_IDS.has(articulation.soundId)
      || articulation.soundId === "snare"
      || articulation.soundId === "snap"
      || articulation.soundId === "braap"
      || articulation.soundId === "mwah"
      || articulation.soundId === "kiss"
      || articulation.soundId === "doodoo";
    const closureAmount = Math.max(
      finite(articulation.lipClosure, 0),
      finite(articulation.constriction, 0),
      finite(articulation.secondaryConstriction, 0),
      finite(articulation.tongueContact, 0),
      finite(articulation.lipFlutter, 0),
    );
    // A literal zero is an effect bypass, not merely a low nasal preference:
    // gesture-intrinsic velum curves cannot reopen the side branch while the
    // user has Nasal OFF.
    const nasalBypass = finite(configuration.nasalMix, 0) <= NASAL_BYPASS_EPSILON;
    let rawVelum = nasalBypass
      ? 0
      : clamp(finite(articulation.velum, configuration.nasalMix));
    if (isOralStop) {
      const intentionalNasalMutation = smoothstep(
        (configuration.nasalMix - 0.25) / 0.4,
      );
      rawVelum *= 1 - clamp(
        closureAmount * 1.08 * (1 - intentionalNasalMutation),
      );
    }
    const physicalVelum = rawVelum <= 0.03
      ? 0
      : Math.pow(clamp((rawVelum - 0.03) / 0.97), 0.72);
    this.nose.configure(
      physicalVelum,
      finite(articulation.tractLengthM, configuration.tractLengthM),
      immediate || nasalBypass,
    );
    this.cheek.configure(articulation);
    this._updateSealTargets(articulation);
    this._scheduleHandContactIfNeeded(articulation, plan);
    this.activeConstrictionIndex = finite(articulation.secondaryConstriction, 0)
      > finite(articulation.constriction, 0)
      ? mappedConstrictionIndex(
        articulation.secondaryConstrictionPosition,
        this.sectionCount,
      )
      : mappedConstrictionIndex(articulation.constrictionPosition, this.sectionCount);
  }

  _updateSealTargets(frame) {
    const maximum = this.sectionCount - 1;
    const lip = this.seals[0];
    const primary = this.seals[1];
    const secondary = this.seals[2];
    const tongueTip = this.seals[3];
    if (!lip.sealed) lip.index = maximum;
    if (!primary.sealed) {
      primary.index = mappedConstrictionIndex(frame.constrictionPosition, this.sectionCount);
    }
    if (!secondary.sealed) {
      secondary.index = mappedConstrictionIndex(
        finite(frame.secondaryConstrictionPosition, 0.5),
        this.sectionCount,
      );
    }
    if (!tongueTip.sealed) {
      const tongueBodyCanonical = clamp(
        12.9 + finite(frame.tonguePosition, 0.58) * (30.4 - 12.9),
        2,
        HICCUP_HEAD_TRACT_SECTION_COUNT - 2,
      );
      const tongueTipCanonical = clamp(
        tongueBodyCanonical + 5.5 + finite(frame.tongueCurl, 0.4) * 1.8,
        2,
        HICCUP_HEAD_TRACT_SECTION_COUNT - 2,
      );
      tongueTip.index = clamp(
        Math.round(
          tongueTipCanonical / (HICCUP_HEAD_TRACT_SECTION_COUNT - 1) * maximum,
        ),
        1,
        maximum,
      );
    }
    lip.enabled = finite(frame.lipClosure, 0) > 0.34
      || finite(frame.lipFlutter, 0) > 0.04
      || lip.sealed;
    primary.enabled = finite(frame.constriction, 0) > 0.48
      && Math.abs(primary.index - lip.index) > 2;
    secondary.enabled = finite(frame.secondaryConstriction, 0) > 0.48
      && Math.abs(secondary.index - lip.index) > 2
      && Math.abs(secondary.index - primary.index) > 2;
    tongueTip.enabled = finite(frame.tongueContact, 0) > 0.48
      && (!lip.enabled || Math.abs(tongueTip.index - lip.index) > 1)
      && (!primary.enabled || Math.abs(tongueTip.index - primary.index) > 1)
      && (!secondary.enabled || Math.abs(tongueTip.index - secondary.index) > 1);
    for (const seal of [primary, secondary, tongueTip]) {
      if (seal.sealed || !seal.enabled) continue;
      let minimumIndex = seal.index;
      let minimumDiameter = this.targetDiameter[minimumIndex];
      for (
        let index = Math.max(1, seal.index - 3);
        index <= Math.min(maximum - 1, seal.index + 3);
        index += 1
      ) {
        if (this.targetDiameter[index] < minimumDiameter) {
          minimumDiameter = this.targetDiameter[index];
          minimumIndex = index;
        }
      }
      seal.index = minimumIndex;
    }
    const uniqueSeals = [];
    for (const seal of [lip, primary, secondary, tongueTip]) {
      if (!seal.enabled && !seal.sealed) continue;
      const alias = uniqueSeals.find((candidate) => (
        Math.abs(candidate.index - seal.index) <= 2
      ));
      if (!alias) {
        uniqueSeals.push(seal);
        continue;
      }
      if (Math.abs(seal.reservoir) > Math.abs(alias.reservoir)) {
        alias.reservoir = seal.reservoir;
      }
      alias.energy = Math.max(alias.energy, seal.energy);
      alias.vacuumPressure = Math.min(alias.vacuumPressure, seal.vacuumPressure);
      alias.releaseBoost = Math.max(alias.releaseBoost, seal.releaseBoost);
      alias.releaseMemory = Math.max(alias.releaseMemory, seal.releaseMemory);
      seal.enabled = false;
      seal.sealed = false;
      seal.reservoir = 0;
      seal.energy = 0;
      seal.vacuumPressure = 0;
      seal.releaseBoost = 0;
      seal.releaseMemory = 0;
    }

    const lipImpulse = finite(frame.lipImpulse, 0);
    if (frame.soundId !== "pff" && lipImpulse > this.previousLipImpulse + 0.04) {
      const kissBoost = frame.soundId === "kiss" ? 2.2 : frame.soundId === "mwah" ? 1.42 : 1;
      lip.releaseBoost = Math.max(lip.releaseBoost, lipImpulse * kissBoost);
    }
    const primaryAmount = finite(frame.constriction, 0);
    if (primaryAmount < this.previousPrimaryConstriction - 0.08) {
      primary.releaseBoost = Math.max(
        primary.releaseBoost,
        this.previousPrimaryConstriction - primaryAmount,
      );
    }
    const secondaryAmount = finite(frame.secondaryConstriction, 0);
    if (secondaryAmount < this.previousSecondaryConstriction - 0.08) {
      secondary.releaseBoost = Math.max(
        secondary.releaseBoost,
        this.previousSecondaryConstriction - secondaryAmount,
      );
    }
    this.previousLipImpulse = lipImpulse;
    this.previousPrimaryConstriction = primaryAmount;
    this.previousSecondaryConstriction = secondaryAmount;
  }

  _advanceOralGeometry() {
    const speedScale = clamp(this.articulationSpeedScale, 0.25, 10);
    const closingStep = 82 * speedScale / this.substepRate;
    const openingStep = 360 * speedScale / this.substepRate;
    for (let index = 0; index < this.sectionCount; index += 1) {
      const difference = this.targetDiameter[index] - this.diameter[index];
      this.diameter[index] = Math.max(
        DIAMETER_MINIMUM,
        this.diameter[index] + clamp(difference, -closingStep, openingStep),
      );
    }

    if (
      this.currentFrame?.soundId === "pff"
      || this.currentFrame?.soundId === "pbpb"
      || this.currentFrame?.soundId === "braap"
    ) {
      const lipIndex = this.sectionCount - 1;
      const lipAperture = this.lipValve.advance(
        this.currentFrame,
        this.currentPlan,
        this._localPressure(Math.max(0, lipIndex - 1)),
        this.configuration.lungPressure,
      );
      const last = lipIndex;
      for (let offset = 0; offset < 4; offset += 1) {
        const index = Math.max(0, last - offset);
        const blend = 1 - offset / 4;
        const dynamicDiameter = lipAperture
          + (this.targetDiameter[index] - lipAperture) * (1 - blend);
        this.diameter[index] = Math.min(this.diameter[index], dynamicDiameter);
      }
      if (this.lipValve.radiatedCollisionFlow > 0.0000001) {
        const collisionBody = this.currentFrame.soundId === "pbpb"
          ? 1.38
          : this.currentFrame.soundId === "braap"
            ? 1.5
            : 1;
        this.left[Math.max(0, last - 1)]
          += this.lipValve.radiatedCollisionFlow * collisionBody;
      }
    } else {
      this.lipValve.advance(null, null, 0);
    }

    if (
      TONGUE_TRILL_GESTURE_IDS.has(this.currentFrame?.soundId)
      && finite(this.currentFrame?.tongueTrill, 0) > 0.001
    ) {
      const tipIndex = mappedConstrictionIndex(
        finite(this.currentFrame.constrictionPosition, 0.84),
        this.sectionCount,
      );
      const upstreamPressure = this._localPressure(Math.max(0, tipIndex - 1));
      const downstreamPressure = this._localPressure(
        Math.min(this.sectionCount - 1, tipIndex + 1),
      );
      const aperture = this.tongueValve.advance(
        this.currentFrame,
        this.currentPlan,
        Math.abs(upstreamPressure - downstreamPressure),
      );
      for (let offset = -2; offset <= 2; offset += 1) {
        const index = clamp(tipIndex + offset, 1, this.sectionCount - 2);
        const weight = 1 - Math.abs(offset) / 3;
        const dynamicDiameter = aperture
          + (this.targetDiameter[index] - aperture) * (1 - weight);
        this.diameter[index] = Math.min(this.diameter[index], dynamicDiameter);
      }
      if (this.tongueValve.collisionFlow > 0.0000001) {
        this.right[Math.min(this.sectionCount - 1, tipIndex + 1)]
          += this.tongueValve.collisionFlow * 0.62;
        this.left[Math.max(0, tipIndex - 1)]
          += this.tongueValve.collisionFlow * 0.38;
      }
      this.activeConstrictionIndex = tipIndex;
    } else {
      this.tongueValve.advance(null, null, 0);
    }

    const lateralBypass = clamp(finite(this.currentFrame?.lateralBypass, 0));
    if (lateralBypass > 0.001) {
      // Model the two side passages around a planted tongue as their
      // equivalent acoustic aperture at the tongue-tip constriction. This is
      // a real parallel path through the oral tube, rather than the previous
      // shortcut of merely making the blind cheek branch larger.
      const lateralIndex = mappedConstrictionIndex(
        finite(this.currentFrame?.constrictionPosition, 0.86),
        this.sectionCount,
      );
      const equivalentDiameter = 0.075 + lateralBypass * 0.5;
      for (let offset = -1; offset <= 1; offset += 1) {
        const index = clamp(lateralIndex + offset, 1, this.sectionCount - 2);
        const edgeScale = offset === 0 ? 1 : 0.78;
        this.diameter[index] = Math.max(
          this.diameter[index],
          equivalentDiameter * edgeScale,
        );
      }
      this.activeConstrictionIndex = lateralIndex;
    }

    if (
      this.currentFrame?.soundId === "rattle"
      || this.currentFrame?.soundId === "grunt"
      || HICCUP_GESTURE_IDS.has(this.currentFrame?.soundId)
    ) {
      const throatIndex = mappedConstrictionIndex(
        finite(this.currentFrame.constrictionPosition, 0.22),
        this.sectionCount,
      );
      const upstreamPressure = this._localPressure(Math.max(0, throatIndex - 1));
      const downstreamPressure = this._localPressure(
        Math.min(this.sectionCount - 1, throatIndex + 1),
      );
      const aperture = this.throatValve.advance(
        this.currentFrame,
        this.currentPlan,
        Math.abs(upstreamPressure - downstreamPressure),
      );
      for (let offset = -3; offset <= 3; offset += 1) {
        const index = clamp(throatIndex + offset, 1, this.sectionCount - 2);
        const weight = 1 - Math.abs(offset) / 4;
        const dynamicDiameter = aperture
          + (this.targetDiameter[index] - aperture) * (1 - weight);
        this.diameter[index] = Math.min(this.diameter[index], dynamicDiameter);
      }
      if (this.throatValve.collisionFlow > 0.0000001) {
        const collisionFlow = this.currentFrame.soundId === "rattle"
          ? this.throatValve.radiatedCollisionFlow * 0.035
          : this.throatValve.collisionFlow;
        this.right[Math.min(this.sectionCount - 1, throatIndex + 1)]
          += collisionFlow * 0.58;
        this.left[Math.max(0, throatIndex - 1)]
          += collisionFlow * 0.42;
      }
      this.activeConstrictionIndex = throatIndex;
    } else {
      this.throatValve.advance(null, null, 0);
    }
    updateReflections(this.diameter, this.area, this.reflection, this.sectionCount);
  }

  _localPressure(index) {
    const safeIndex = clamp(Math.round(index), 0, this.sectionCount - 1);
    return (this.right[safeIndex] + this.left[safeIndex])
      / Math.sqrt(Math.max(AREA_MINIMUM, this.area[safeIndex]));
  }

  _startTransient(
    index,
    strength,
    delaySeconds = 0,
    decayRate = 260,
    durationSeconds = 0.028,
    noiseMix = 0.26,
    surfaceMix = 0,
  ) {
    const transient = this.transients.find(({ active }) => !active)
      ?? this.transients.reduce((oldest, candidate) => (
        candidate.ageSeconds > oldest.ageSeconds ? candidate : oldest
      ));
    transient.active = true;
    transient.index = clamp(Math.round(index), 0, this.sectionCount - 1);
    transient.strength = clamp(strength, -0.64, 0.64);
    transient.ageSeconds = 0;
    transient.delaySeconds = clamp(delaySeconds, 0, 0.04);
    transient.decayRate = clamp(decayRate, 45, 520);
    transient.durationSeconds = clamp(durationSeconds, 0.012, 0.12);
    transient.noiseMix = clamp(noiseMix, 0, 0.88);
    transient.surfaceMix = clamp(surfaceMix, 0, 0.75);
    transient.surfaceNoiseMemory = 0;
  }

  _scheduleHandContactIfNeeded(frame, plan) {
    const isHand = frame?.soundId === "slap" || frame?.soundId === "smack";
    if (!isHand) {
      this.handContactSound = "";
      this.previousHandPhase = 1;
      this.handContactTriggered = false;
      return;
    }
    const phase = clamp(finite(frame.phase, 0));
    if (
      frame.soundId !== this.handContactSound
      || phase + 0.015 < this.previousHandPhase
    ) {
      this.handContactSound = frame.soundId;
      this.handContactTriggered = false;
    }
    this.previousHandPhase = phase;
    const impact = Math.abs(finite(frame.cheekImpulse, 0));
    // Scheduled gestures prepare their tissue before the audible beat. Palm
    // contacts must wait for that beat; otherwise the crack is generated in
    // the muted preparation window and only the sub-bass cheek wobble remains.
    if (phase < (RELEASE_PHASES[frame.soundId] ?? 0)) return;
    if (this.handContactTriggered || impact < 0.16) return;
    this.handContactTriggered = true;

    const velocity = clamp(finite(frame.velocity, 0.8), 0.01, 1);
    const brightness = clamp(finite(plan?.handImpactBrightness, 0.5));
    const spacingSeconds = clamp(
      finite(plan?.handContactSpacingMs, 2) / 1_000,
      0.0007,
      0.0048,
    );
    const tail = clamp(finite(plan?.handTail, 0.56));
    const side = frame.soundId === "slap" ? -1 : 1;
    const available = Math.max(3, this.sectionCount - this.cheekJunction - 3);
    const contactIndex = clamp(
      Math.round(this.cheekJunction + 1 + available * (0.18 + brightness * 0.54)),
      2,
      this.sectionCount - 2,
    );
    const contactGain = frame.soundId === "slap" ? 0.68 : 0.74;
    const baseStrength = (0.21 + brightness * 0.13) * velocity * contactGain;
    const decayRate = 300 - tail * 130 + brightness * 90;
    const durationSeconds = 0.045 + tail * 0.07;
    // Palm, fingers, and reflected skin fold arrive as a short asymmetric
    // doublet/triplet; every impulse then propagates through cheek and mouth.
    this._startTransient(
      contactIndex,
      side * baseStrength,
      0,
      decayRate,
      durationSeconds,
      0.72,
      0.42,
    );
    this._startTransient(
      clamp(contactIndex + side * (1 + Math.round(brightness * 2)), 1, this.sectionCount - 2),
      -side * baseStrength * (0.62 + tail * 0.12),
      spacingSeconds,
      decayRate * 1.18,
      durationSeconds * 0.82,
      0.62,
      0.28,
    );
    this._startTransient(
      clamp(contactIndex - side * 2, 1, this.sectionCount - 2),
      side * baseStrength * (0.32 + tail * 0.22),
      spacingSeconds * (2.1 + (1 - brightness) * 0.55),
      decayRate * 0.86,
      durationSeconds,
      0.5,
      0.16,
    );
    this.cheek.collisionDrive += side * baseStrength * (0.28 + tail * 0.22);
  }

  _pressureStoredAtSeal(seal) {
    const upstream = this._localPressure(seal.index - 1);
    if (finite(this.currentFrame?.suction, 0) <= 0.001) return upstream;
    let start;
    let end;
    if (seal.index > this.cheekJunction) {
      let rear = this.cheekJunction;
      for (const candidate of this.seals) {
        if (candidate === seal || candidate.index >= seal.index) continue;
        const closed = candidate.sealed || (
          candidate.enabled
          && this.diameter[clamp(candidate.index, 0, this.sectionCount - 1)] <= 0.055
        );
        if (closed) rear = Math.max(rear, candidate.index);
      }
      start = rear + 1;
      end = seal.index - 1;
    } else {
      let front = this.sectionCount - 1;
      for (const candidate of this.seals) {
        if (candidate === seal || candidate.index <= seal.index) continue;
        const closed = candidate.sealed || (
          candidate.enabled
          && this.diameter[clamp(candidate.index, 0, this.sectionCount - 1)] <= 0.055
        );
        if (closed) front = Math.min(front, candidate.index);
      }
      start = seal.index + 1;
      end = Math.max(start, front - 1);
    }
    start = clamp(Math.round(start), 0, this.sectionCount - 1);
    end = clamp(Math.round(end), start, this.sectionCount - 1);
    let pressure = 0;
    for (let index = start; index <= end; index += 1) {
      pressure += this._localPressure(index);
    }
    return pressure / Math.max(1, end - start + 1);
  }

  _advanceSeals(noise) {
    let strongestSigned = 0;
    for (const seal of this.seals) {
      if (
        !seal.enabled
        && !seal.sealed
        && seal.reservoir === 0
        && seal.energy === 0
        && seal.vacuumPressure === 0
        && seal.releaseBoost === 0
        && seal.releaseMemory === 0
      ) continue;
      const index = clamp(Math.round(seal.index), 1, this.sectionCount - 1);
      const diameter = this.diameter[index];
      const localPressure = this._pressureStoredAtSeal(seal);
      if ((seal.enabled || seal.sealed) && diameter <= 0.035) {
        seal.sealed = true;
        // Only pressure already present in the upstream waveguide may charge a
        // closure. Gesture curves position the articulators but never invent a
        // pressure reservoir or a click by themselves.
        seal.reservoir += (localPressure - seal.reservoir)
          * this.sealChargeAlpha;
        seal.energy += (localPressure * localPressure - seal.energy)
          * this.sealEnergyAlpha;
        if (finite(this.currentFrame?.suction, 0) > 0.001) {
          const measuredVacuum = Math.min(0, localPressure);
          seal.vacuumPressure += (measuredVacuum - seal.vacuumPressure)
            * (measuredVacuum < seal.vacuumPressure
              ? this.sealVacuumAttackAlpha
              : this.sealVacuumReleaseAlpha);
        } else {
          seal.vacuumPressure *= this.sealClosedVacuumRelease;
        }
      } else if (seal.sealed && diameter >= 0.12) {
        const storedMagnitude = Math.sqrt(Math.max(0, seal.energy));
        const measuredPressure = seal.vacuumPressure < -0.000001
          ? seal.vacuumPressure
          : seal.reservoir;
        if (storedMagnitude > 0.0001 && Math.abs(measuredPressure) > 0.000001) {
          const measuredSign = Math.sign(measuredPressure);
          const noisyRelease = measuredPressure * 0.56
            + measuredSign * storedMagnitude * seal.releaseBoost
              * (0.11 + Math.abs(noise) * 0.035);
          if (this.currentFrame?.soundId === "slurp") {
            this._startTransient(index, noisyRelease * 2.35, 0, 140, 0.072);
          } else if (this.currentFrame?.soundId === "pop" && seal.name === "lip") {
            // The cheek cavity supplies POP's low body; the short lip-edge
            // spray stops that body from disappearing on phone speakers.
            this._startTransient(index, noisyRelease * 1.55, 0, 225, 0.046, 0.58, 0.24);
          } else if (this.currentFrame?.soundId === "bop" && seal.name === "lip") {
            // Preserve the bilabial pressure pulse while moving perceptual
            // weight out of its oversized sub-bass spike.
            this._startTransient(index, noisyRelease * 1.18, 0, 285, 0.034, 0.62, 0.18);
          } else if (this.currentFrame?.soundId === "kiss" && seal.name === "lip") {
            this._startTransient(index, noisyRelease * 1.34, 0, 135, 0.082, 0.38, 0.1);
          } else if (
            this.currentFrame?.soundId === "hiccuplong"
            && seal.name === "lip"
          ) {
            // The long body's name ends in /p/. Give its physically stored
            // bilabial release a bright edge so it survives the preceding
            // diaphragm catches instead of fading into an inaudible tail.
            this._startTransient(index, noisyRelease * 2.2, 0, 275, 0.048, 0.7, 0.2);
          } else if (
            HICCUP_GESTURE_IDS.has(this.currentFrame?.soundId)
            && seal.name === "secondary"
          ) {
            // A velar release is the audible /k/ in HIC. It is still derived
            // from the pressure stored behind the modeled rear-tongue seal.
            this._startTransient(index, noisyRelease * 1.62, 0, 330, 0.036, 0.74, 0.3);
          } else {
            this._startTransient(index, noisyRelease);
          }
        }
        seal.releaseMemory = 1;
        seal.sealed = false;
        seal.reservoir *= 0.12;
        seal.energy *= 0.08;
        seal.vacuumPressure = 0;
        seal.releaseBoost = 0;
      } else if (!seal.sealed) {
        seal.reservoir *= this.sealReservoirRelease;
        seal.energy *= this.sealEnergyRelease;
        seal.vacuumPressure *= this.sealVacuumRelease;
        seal.releaseBoost *= this.sealBoostRelease;
      }
      seal.releaseMemory *= this.sealMemoryRelease;
      if (Math.abs(seal.reservoir) > Math.abs(strongestSigned)) {
        strongestSigned = seal.reservoir;
      }
      if (Math.abs(seal.vacuumPressure) > Math.abs(strongestSigned)) {
        strongestSigned = seal.vacuumPressure;
      }
    }
    this.signedPressure += (strongestSigned - this.signedPressure)
      * this.signedPressureAlpha;
  }

  _injectTransients(noise) {
    this.surfaceContactOutput = 0;
    for (const transient of this.transients) {
      if (!transient.active) continue;
      if (transient.delaySeconds > 0) {
        transient.delaySeconds -= 1 / this.substepRate;
        continue;
      }
      if (transient.ageSeconds >= transient.durationSeconds) {
        transient.active = false;
        continue;
      }
      const envelope = transient.strength
        * 2 ** (-transient.ageSeconds * transient.decayRate);
      const noiseMix = clamp(finite(transient.noiseMix, 0.26), 0, 0.88);
      // The broadband fraction is still injected into the physical tube at
      // the actual contact site. Higher hand values read as skin/palm cracks;
      // ordinary oral transients retain their rounder pressure impulse.
      const shaped = envelope * ((1 - noiseMix) + noise * noiseMix);
      const index = clamp(transient.index, 0, this.sectionCount - 1);
      this.right[index] += shaped * 0.5;
      this.left[index] += shaped * 0.5;
      if (transient.surfaceMix > 0) {
        // Skin also radiates directly at impact. Differentiate the contact
        // noise into a soft high-mid crack while retaining the larger branch
        // above, which still travels through cheek and mouth resonance.
        transient.surfaceNoiseMemory += (
          noise - transient.surfaceNoiseMemory
        ) * 0.12;
        this.surfaceContactOutput += (
          noise - transient.surfaceNoiseMemory
        ) * Math.abs(envelope) * transient.surfaceMix * 0.52;
      }
      transient.ageSeconds += 1 / this.substepRate;
    }
  }

  _injectTurbulence(noise) {
    const frame = this.currentFrame ?? {};
    const amount = clamp(finite(frame.turbulence, 0));
    if (amount <= 0.0001) return;
    let constriction = mappedConstrictionIndex(
      frame.constrictionPosition,
      this.sectionCount,
    );
    let bestScore = -1;
    let bestDrive = 0;
    // Follow whichever real aperture is producing the strongest jet. This
    // moves PHSHSHK from its lip PH release to its SH groove and finally to
    // the rear K release, instead of leaving all noise at one preset index.
    for (let candidateNumber = 0; candidateNumber < 4; candidateNumber += 1) {
      let candidate;
      let siteWeight;
      let releaseMemory;
      if (candidateNumber === 0) {
        candidate = mappedConstrictionIndex(frame.constrictionPosition, this.sectionCount);
        releaseMemory = this.seals[1].releaseMemory;
        siteWeight = clamp(
          finite(frame.constriction, 0) + this.seals[1].releaseMemory * 1.5,
          0,
          2,
        );
      } else if (candidateNumber === 1) {
        candidate = mappedConstrictionIndex(
          frame.secondaryConstrictionPosition,
          this.sectionCount,
        );
        releaseMemory = this.seals[2].releaseMemory;
        siteWeight = clamp(
          finite(frame.secondaryConstriction, 0) + this.seals[2].releaseMemory * 1.7,
          0,
          2,
        );
      } else if (candidateNumber === 2) {
        candidate = this.sectionCount - 1;
        releaseMemory = this.seals[0].releaseMemory;
        siteWeight = frame.soundId === "pff"
          || frame.soundId === "pbpb"
          || frame.soundId === "braap"
          ? clamp(finite(frame.lipFlutter, 0))
          : clamp(
            finite(frame.lipClosure, 0) + this.seals[0].releaseMemory * 1.5,
            0,
            2,
          );
      } else {
        candidate = this.seals[3].index;
        releaseMemory = this.seals[3].releaseMemory;
        const hybridRearRelease = frame.soundId === "shh" || frame.soundId === "shack";
        siteWeight = hybridRearRelease
          ? 0
          : clamp(finite(frame.tongueContact, 0) + releaseMemory);
      }
      if (siteWeight <= 0.001) continue;
      candidate = clamp(candidate, 1, this.sectionCount - 2);
      const diameter = this.diameter[candidate];
      const thinness = Math.max(
        clamp((1.28 - diameter) / 1.08),
        releaseMemory * clamp((2.2 - diameter) / 1.4) * 0.65,
      );
      const openness = clamp((diameter - 0.018) / 0.18);
      if (thinness <= 0 || openness <= 0) continue;
      const upstreamPressure = this._localPressure(candidate - 1);
      const downstreamPressure = this._localPressure(candidate + 1);
      const pressureDrop = Math.abs(upstreamPressure - downstreamPressure);
      const localFlow = Math.abs(this.right[candidate - 1] - this.left[candidate]);
      const aerodynamicDrive = Math.sqrt(pressureDrop) * 0.82
        + Math.sqrt(localFlow) * 0.28;
      const score = thinness * openness * aerodynamicDrive * siteWeight;
      if (score > bestScore) {
        bestScore = score;
        bestDrive = score;
        constriction = candidate;
      }
    }
    if (bestScore <= 0) return;
    this.activeConstrictionIndex = constriction;
    let radiatedNoise = noise;
    if (frame.soundId === "pff" || frame.soundId === "braap") {
      this.pffTurbulenceMemory += (
        noise - this.pffTurbulenceMemory
      ) * this.pffTurbulenceAlpha;
      radiatedNoise = this.pffTurbulenceMemory;
    } else if (frame.soundId === "huff") {
      this.huffTurbulenceMemory += (
        noise - this.huffTurbulenceMemory
      ) * this.huffTurbulenceAlpha;
      radiatedNoise = this.huffTurbulenceMemory;
    } else if (frame.soundId === "slurp") {
      // A wet release is dominated by the tongue/pocket flow, with the top
      // edge of the noise absorbed before it reaches the mouth opening.
      this.slurpWetMemory += (
        noise - this.slurpWetMemory
      ) * this.slurpWetAlpha;
      radiatedNoise = this.slurpWetMemory;
    }
    const wetBody = frame.soundId === "slurp" ? 1.58 : 1;
    const flow = radiatedNoise * amount * bestDrive * 0.09 * wetBody;
    const downstream = Math.min(this.sectionCount - 1, constriction + 1);
    this.right[downstream] += flow * 0.7;
    this.left[downstream] += flow * 0.3;
  }

  _injectToothWhistle(noise) {
    if (
      this.currentFrame?.soundId !== "whistle"
      || finite(this.currentFrame?.toothJet, 0) <= 0.001
    ) {
      this.toothJet.advanceInactive(this.currentFrame, this.currentPlan, noise);
      return;
    }
    const canonicalSection = finite(
      this.currentPlan?.toothGapCanonicalSection,
      HICCUP_HEAD_TOOTH_GAP_ANATOMY.canonicalOralSection,
    );
    const toothIndex = clamp(
      Math.round(
        canonicalSection / (HICCUP_HEAD_TRACT_SECTION_COUNT - 1)
          * (this.sectionCount - 1),
      ),
      2,
      this.sectionCount - 2,
    );
    const upstreamPressure = this._localPressure(toothIndex - 1);
    const downstreamPressure = this._localPressure(toothIndex + 1);
    const localOralPressure = (upstreamPressure + downstreamPressure) * 0.5;
    const toothFlow = this.toothJet.advance(
      this.currentFrame,
      this.currentPlan,
      localOralPressure,
      noise,
    );
    if (Math.abs(toothFlow) <= 1e-12) return;
    // A volume-flow source at the dental edge launches both directions. Most
    // energy radiates toward the tooth/lip opening, while the upstream share
    // travels back through the anterior oral waveguide and is scattered by
    // the current tongue, lips, and tract geometry before returning.
    this.right[Math.min(this.sectionCount - 1, toothIndex + 1)] += toothFlow * 0.72;
    this.left[Math.max(0, toothIndex - 1)] += toothFlow * 0.28;
    this.activeConstrictionIndex = toothIndex;
  }

  _injectToothTine(noise) {
    const metadata = this.currentPlan?.toothTine ?? null;
    const currentBrush = this.currentFrame?.soundId === "brush" && this.currentPlan;
    if (this.brushCarryActive && !this.brushSweepActive && !this.toothTine.active) {
      this.brushCarryActive = false;
    }
    const mayTrigger = !this.brushSweepActive
      && !this.brushCarryActive
      && metadata
      && this.currentFrame?.soundId === "tlik";
    if (currentBrush) {
      if (this.currentPlan !== this.brushPlanToken) {
        this.brushPlanToken = this.currentPlan;
        this.brushContactIndex = -1;
        this.brushSweepActive = true;
        this.brushSweepPhase = clamp(finite(this.currentFrame.phase, 0));
        this.brushSweepPhaseStep = 1 / Math.max(
          1,
          finite(this.currentPlan.durationSeconds, 0.54) * this.substepRate,
        );
        this.brushSweepDirection = this.currentPlan.brushDirection === -1 ? -1 : 1;
        this.brushSweepFrame = { ...this.currentFrame };
        this.brushCarryActive = true;
      }
      this.brushSweepPhase = Math.max(
        this.brushSweepPhase,
        clamp(finite(this.currentFrame.phase, 0)),
      );
      this.brushSweepFrame = this.currentFrame;
    }
    const brushing = this.brushSweepActive;
    if (brushing) {
      const phase = clamp(this.brushSweepPhase);
      const sweep = clamp((phase - 0.045) / 0.89);
      const nextContact = phase < 0.045
        ? -1
        : Math.min(
          HICCUP_HEAD_TOOTH_TINE_PROFILES.length - 1,
          Math.floor(sweep * HICCUP_HEAD_TOOTH_TINE_PROFILES.length),
        );
      while (this.brushContactIndex < nextContact) {
        this.brushContactIndex += 1;
        const direction = this.brushSweepDirection;
        const toothIndex = direction < 0
          ? HICCUP_HEAD_TOOTH_TINE_PROFILES.length - 1 - this.brushContactIndex
          : this.brushContactIndex;
        const profile = HICCUP_HEAD_TOOTH_TINE_PROFILES[toothIndex];
        const canonicalSection = 35.8
          + toothIndex / Math.max(1, HICCUP_HEAD_TOOTH_TINE_PROFILES.length - 1) * 6.1;
        const section = clamp(
          Math.round(
            canonicalSection / (HICCUP_HEAD_TRACT_SECTION_COUNT - 1)
              * (this.sectionCount - 1),
          ),
          2,
          this.sectionCount - 2,
        );
        const localPressure = (
          this._localPressure(section - 1) + this._localPressure(section + 1)
        ) * 0.5;
        this.toothTine.strikeNow({
          frequencyHz: profile.frequencyHz,
          position: 0.24 + toothIndex / 11 * 0.62,
          brightness: profile.brightness,
          toothIndex,
        }, this.brushSweepFrame, localPressure, noise);
      }
      this.brushSweepPhase += this.brushSweepPhaseStep;
      if (this.brushContactIndex >= HICCUP_HEAD_TOOTH_TINE_PROFILES.length - 1) {
        this.brushSweepActive = false;
      }
    } else if (!currentBrush && this.brushPlanToken) {
      this.brushPlanToken = null;
      this.brushContactIndex = -1;
      this.brushSweepFrame = null;
    }
    if (!mayTrigger && !brushing && !this.toothTine.active) {
      if (metadata === this.toothTine.eventToken) return;
      this.toothTine.advance(this.currentFrame, this.currentPlan, 0, noise);
      return;
    }
    const toothIndex = clamp(
      Math.round(
        this.toothTine.canonicalSection
          / (HICCUP_HEAD_TRACT_SECTION_COUNT - 1)
          * (this.sectionCount - 1),
      ),
      2,
      this.sectionCount - 2,
    );
    const localPressure = mayTrigger
      ? (
        this._localPressure(toothIndex - 1)
          + this._localPressure(toothIndex + 1)
      ) * 0.5
      : 0;
    const tineFlow = this.toothTine.advance(
      brushing ? this.brushSweepFrame : this.currentFrame,
      brushing ? null : this.currentPlan,
      localPressure,
      noise,
    );
    if (Math.abs(tineFlow) <= 1e-12) return;
    // A future sealed mouth (especially KISS) may begin preparing while the
    // prior BRUSH finishes between ticks. Do not trap twelve wood impacts
    // behind those new lips. Keep a reduced resonant share inside the mouth
    // and let the rest radiate directly from the exposed tooth surface.
    const detachedBrush = this.brushCarryActive && !currentBrush;
    const preparedLipClosure = detachedBrush
      ? clamp(finite(this.currentFrame?.lipClosure, 0))
      : 0;
    const tubeGain = detachedBrush ? 0.7 - preparedLipClosure * 0.42 : 1;
    this.right[Math.min(this.sectionCount - 1, toothIndex + 1)]
      += tineFlow * 0.66 * tubeGain;
    this.left[Math.max(0, toothIndex - 1)]
      += tineFlow * 0.34 * tubeGain;
    if (detachedBrush) {
      this.surfaceContactOutput += tineFlow * (1 - tubeGain) * 0.18;
    }
    if (!this.brushSweepActive && !this.toothTine.active) {
      this.brushCarryActive = false;
    }
    this.activeConstrictionIndex = toothIndex;
  }

  _scatterThreePort(junction, branchIncoming, branchArea) {
    const upstreamIncoming = this.right[junction - 1];
    const downstreamIncoming = this.left[junction];
    const upstreamArea = Math.max(AREA_MINIMUM, this.area[junction - 1]);
    const downstreamArea = Math.max(AREA_MINIMUM, this.area[junction]);
    const sideArea = Math.max(AREA_MINIMUM, branchArea);
    const totalFlow = upstreamIncoming + downstreamIncoming + branchIncoming;
    const totalArea = Math.max(AREA_MINIMUM, upstreamArea + downstreamArea + sideArea);
    this.leftJunction[junction] = cleanWave((
      -upstreamIncoming + 2 * upstreamArea / totalArea * totalFlow
    ) * JUNCTION_LOSS);
    this.rightJunction[junction] = cleanWave((
      -downstreamIncoming + 2 * downstreamArea / totalArea * totalFlow
    ) * JUNCTION_LOSS);
    return cleanWave((
      -branchIncoming + 2 * sideArea / totalArea * totalFlow
    ) * JUNCTION_LOSS);
  }

  processSubstep(sourceFlow, noise) {
    this._advanceOralGeometry();
    this.nose.advanceGeometry();
    const cheekPressure = this._localPressure(this.cheekJunction);
    this.cheek.advance(
      this.currentFrame,
      this.configuration,
      cheekPressure,
      this.currentPlan,
    );
    this._advanceSeals(noise);
    this._injectTransients(noise);
    this._injectTurbulence(noise);
    this._injectToothWhistle(noise);
    this._injectToothTine(noise);

    const count = this.sectionCount;
    this.rightJunction[0] = cleanWave(this.left[0] * GLOTTAL_REFLECTION + sourceFlow);
    this.leftJunction[count] = cleanWave(this.right[count - 1] * LIP_REFLECTION);
    for (let index = 1; index < count; index += 1) {
      if (index === this.noseJunction || index === this.cheekJunction) continue;
      const offset = this.reflection[index] * (this.right[index - 1] + this.left[index]);
      this.rightJunction[index] = this.right[index - 1] - offset;
      this.leftJunction[index] = this.left[index] + offset;
    }

    const noseInput = this._scatterThreePort(
      this.noseJunction,
      this.nose.incomingAtJunction,
      this.nose.junctionArea,
    );
    const cheekInput = this._scatterThreePort(
      this.cheekJunction,
      this.cheek.incomingAtJunction,
      // The lateral tongue aperture is handled at its actual oral location;
      // only a small fraction of that flow additionally loads the cheek wall.
      this.cheek.junctionArea * (1 + clamp(
        finite(this.currentFrame?.lateralBypass, 0),
      ) * 0.24),
    );
    const normalizedTension = clamp(
      (finite(this.currentFrame?.lipTension, 0.46) + 0.35) / 2,
    );
    const wallMemory = 0.006 + (1 - normalizedTension) * 0.012;
    const propagationLoss = TUBE_LOSS * this.tailLoss;
    for (let index = 0; index < count; index += 1) {
      const previousRight = this.right[index];
      const previousLeft = this.left[index];
      const arrivingRight = this.rightJunction[index] * propagationLoss;
      const arrivingLeft = this.leftJunction[index + 1] * propagationLoss;
      // Soft tract walls lose more ultrasonic energy per travelled section.
      // The tiny temporal memory is distributed through the tube rather than
      // imposed as a generic output EQ.
      this.right[index] = cleanWave(
        arrivingRight * (1 - wallMemory) + previousRight * wallMemory,
      );
      this.left[index] = cleanWave(
        arrivingLeft * (1 - wallMemory) + previousLeft * wallMemory,
      );
    }
    const nasalOutput = this.nose.process(noseInput, this.tailLoss);
    this.cheek.process(cheekInput, this.tailLoss);
    this.lastOralOutput = this.right[count - 1];
    this.lastNasalOutput = nasalOutput;
    if (finite(this.configuration?.nasalMix, 0) <= NASAL_BYPASS_EPSILON) {
      return this.lastOralOutput + this.surfaceContactOutput;
    }
    const nasalCoupling = smoothstep(this.nose.opening);
    return this.lastOralOutput * (1 - nasalCoupling * 0.34)
      + nasalOutput * (0.4 + nasalCoupling * 4.4)
      + this.surfaceContactOutput;
  }

  measurePressureForBlock(frameCount = 128) {
    // This pressure envelope drives only the face visualization/telemetry. A
    // block-rate measurement avoids a third full oral-tube walk at every one
    // of the 96k propagation substeps while preserving its 22 ms time scale.
    const count = this.sectionCount;
    let energy = 0;
    for (let index = 0; index < count; index += 1) {
      const pressure = this.right[index] + this.left[index];
      energy += pressure * pressure / Math.max(AREA_MINIMUM, this.area[index]);
    }
    const targetPressure = clamp(1 - Math.exp(-Math.sqrt(energy / count) * 0.82));
    const elapsedFrames = Math.max(1, Math.trunc(finite(frameCount, 128)));
    const blockAlpha = 1 - Math.exp(
      -elapsedFrames / Math.max(1, this.rate * 0.022),
    );
    this.tractPressure += (targetPressure - this.tractPressure) * blockAlpha;
  }

  resetWaveState() {
    this.right.fill(0);
    this.left.fill(0);
    this.rightJunction.fill(0);
    this.leftJunction.fill(0);
    this.nose.reset();
    this.cheek.reset();
    this.lipValve.reset();
    this.tongueValve.reset();
    this.throatValve.reset();
    this.toothJet.reset();
    this.toothTine.reset();
    this.brushPlanToken = null;
    this.brushContactIndex = -1;
    this.brushSweepActive = false;
    this.brushSweepPhase = 1;
    this.brushSweepPhaseStep = 0;
    this.brushSweepDirection = 1;
    this.brushSweepFrame = null;
    this.brushCarryActive = false;
    for (const seal of this.seals) {
      seal.sealed = false;
      seal.reservoir = 0;
      seal.energy = 0;
      seal.vacuumPressure = 0;
      seal.releaseBoost = 0;
      seal.releaseMemory = 0;
    }
    for (const transient of this.transients) transient.active = false;
    this.handContactSound = "";
    this.previousHandPhase = 1;
    this.handContactTriggered = false;
    this.pffTurbulenceMemory = 0;
    this.huffTurbulenceMemory = 0;
    this.slurpWetMemory = 0;
    this.tractPressure = 0;
    this.signedPressure = 0;
    this.lastOralOutput = 0;
    this.lastNasalOutput = 0;
    this.surfaceContactOutput = 0;
    this.tailLoss = 1;
  }

  chokeForRetarget(amount = 0.24) {
    const keep = clamp(amount, 0, 1);
    for (let index = 0; index < this.sectionCount; index += 1) {
      this.right[index] *= keep;
      this.left[index] *= keep;
    }
    for (let index = 0; index < NOSE_SECTIONS; index += 1) {
      this.nose.right[index] *= keep;
      this.nose.left[index] *= keep;
    }
    for (let index = 0; index < CHEEK_SECTIONS; index += 1) {
      this.cheek.right[index] *= keep;
      this.cheek.left[index] *= keep;
    }
    for (const seal of this.seals) {
      seal.sealed = false;
      seal.reservoir = 0;
      seal.energy = 0;
      seal.vacuumPressure = 0;
      seal.releaseBoost = 0;
      seal.releaseMemory = 0;
    }
    for (const transient of this.transients) transient.active = false;
    this.handContactSound = "";
    this.previousHandPhase = 1;
    this.handContactTriggered = false;
    this.cheek.velocity *= keep;
    this.cheek.collisionDrive = 0;
    this.lipValve.velocityCmPerSecond *= keep;
    this.lipValve.radiatedCollisionFlow *= keep;
    this.tongueValve.velocityCmPerSecond *= keep;
    this.tongueValve.collisionFlow *= keep;
    this.throatValve.velocityCmPerSecond *= keep;
    this.throatValve.collisionFlow *= keep;
    this.toothJet.amplitude *= keep;
    this.toothJet.flow *= keep;
    this.toothTine.choke(
      this.brushSweepActive || this.brushCarryActive ? Math.max(keep, 0.72) : keep,
    );
    if (!this.brushSweepActive && !this.brushCarryActive) {
      this.brushPlanToken = null;
      this.brushContactIndex = -1;
      this.brushSweepFrame = null;
    }
    this.pffTurbulenceMemory *= keep;
    this.huffTurbulenceMemory *= keep;
    this.slurpWetMemory *= keep;
    this.signedPressure *= keep;
    this.tractPressure *= keep;
    this.lastOralOutput *= keep;
    this.lastNasalOutput *= keep;
    this.tailLoss = 1;
  }

  isFinite() {
    return Number.isFinite(this.tractPressure)
      && Number.isFinite(this.signedPressure)
      && Number.isFinite(this.brushSweepPhase)
      && Number.isFinite(this.brushSweepPhaseStep)
      && Number.isFinite(this.pffTurbulenceMemory)
      && Number.isFinite(this.huffTurbulenceMemory)
      && Number.isFinite(this.slurpWetMemory)
      && this.nose.isFinite()
      && this.cheek.isFinite()
      && this.lipValve.isFinite()
      && this.tongueValve.isFinite()
      && this.throatValve.isFinite()
      && this.toothJet.isFinite()
      && this.toothTine.isFinite()
      && arraysAreFinite(
        [this.right, this.left, this.rightJunction, this.leftJunction, this.diameter],
        [this.sectionCount, this.sectionCount, this.sectionCount + 1, this.sectionCount + 1, this.sectionCount],
      );
  }
}

class HiccupHeadGestureController {
  constructor(rate, event, configuration) {
    this.rate = rate;
    this.substepRate = rate * SUBSTEPS;
    this.randomSmoothingAlpha = timeAlpha(42, this.substepRate);
    this.lipSourceRadiationAlpha = 1 - Math.exp(
      -Math.PI * 2 * 4_200 / this.substepRate,
    );
    this.braapSourceRadiationAlpha = 1 - Math.exp(
      -Math.PI * 2 * 1_650 / this.substepRate,
    );
    this.huffSourceRadiationAlpha = 1 - Math.exp(
      -Math.PI * 2 * 1_250 / this.substepRate,
    );
    this.diaphragmAttackAlpha = timeAlpha(7, this.substepRate);
    this.diaphragmReleaseAlpha = timeAlpha(38, this.substepRate);
    this.diaphragmReleaseDecay = 1 - timeAlpha(16, this.substepRate);
    this.sound = hiccupHeadSound(event.soundId);
    this.soundId = this.sound.id;
    this.velocity = clamp(event.velocity, 0.01, 1);
    this.configuration = configuration;
    this.voiceSnapshot = sanitizeHiccupHeadVoice(event.voiceSnapshot ?? {});
    this.toothTine = event.toothTine ?? null;
    this.brushDirection = event.brushDirection === -1 ? -1 : 1;
    this.bankOutputGain = clamp(finite(event.bankOutputGain, 1), 0.2, 1.8);
    const basePlan = physicalVoiceParameters(
      this.sound.id,
      configuration,
      this.velocity,
      this.voiceSnapshot,
    );
    const requestedDurationSeconds = Number(event.gestureDurationSeconds);
    const durationSeconds = Number.isFinite(requestedDurationSeconds)
      ? clamp(requestedDurationSeconds, 0.018, 2.2)
      : basePlan.durationSeconds;
    this.plan = this.toothTine || this.sound.id === "brush" || durationSeconds !== basePlan.durationSeconds
      ? Object.freeze({
        ...basePlan,
        durationSeconds,
        ...(this.toothTine ? { toothTine: this.toothTine } : {}),
        ...(this.sound.id === "brush" ? { brushDirection: this.brushDirection } : {}),
      })
      : basePlan;
    this.totalFrames = Math.max(1, Math.ceil(this.plan.durationSeconds * rate));
    this.startPhase = clamp(event.startPhase, 0, 1);
    this.releasePhase = clamp(event.releasePhase, this.startPhase, 1);
    this.preparationFrames = Math.max(1, Math.round(event.releaseFrame - event.startFrame));
    this.ageFrames = 0;
    this.releaseFrame = event.releaseFrame;
    this.glottalPhase = 0;
    this.vibratoPhase = 0;
    this.irregularPhase = 0;
    this.lipSourceMemory = 0;
    this.huffSourceMemory = 0;
    this.jitter = 0;
    this.foldCycle = 0;
    this.modulationPhase = this.voiceSnapshot.modulation.phase;
    this.modulationValue = 0;
    this.modulationRandomTarget = 0;
    this.modulationRandomValue = 0;
    this.modulationRandomInitialized = false;
    this.currentGlottalFrequencyHz = this.plan.glottalFrequencyHz;
    this.currentVibratoSemitones = 0;
    this.currentRoughness = this.plan.roughness;
    this.currentBreathDirection = finite(this.plan.airflowDirection, 1) < 0 ? -1 : 1;
    this.diaphragmPressure = 0;
    this.diaphragmDisplacement = 0;
    this.diaphragmVelocity = 0;
    this.diaphragmRelease = 0;
    this.previousDiaphragmCatch = 0;
    this.currentDiaphragmFlow = 0;
    const plannedGlottalTenseness = Number(this.plan.glottalTenseness);
    const glottalTenseness = Number.isFinite(plannedGlottalTenseness)
      ? clamp(plannedGlottalTenseness)
      : clamp(0.34 + configuration.lungPressure * 0.2 + configuration.silliness * 0.16);
    this.glottalShape = glottalCoefficients(glottalTenseness);
    this.headGlottalShape = glottalCoefficients(clamp(glottalTenseness + 0.18));
    this.lastFrame = hiccupHeadGestureFrame(
      this.sound.id,
      this.progress,
      this.configuration,
      this.velocity,
      this.voiceSnapshot,
    );
  }

  get progress() {
    if (this.ageFrames < this.preparationFrames) {
      const preparation = this.ageFrames / this.preparationFrames;
      return clamp(
        this.startPhase + (this.releasePhase - this.startPhase) * preparation,
      );
    }
    return clamp(
      this.releasePhase + (this.ageFrames - this.preparationFrames) / this.totalFrames,
    );
  }

  get complete() {
    return this.progress >= 1;
  }

  sampleControlFrame() {
    let controlVoice = this.voiceSnapshot;
    const modulation = this.voiceSnapshot.modulation;
    if (modulation.target === "tractScale" && modulation.depth > 0) {
      controlVoice = {
        ...this.voiceSnapshot,
        tractScale: clamp(
          this.voiceSnapshot.tractScale + this.modulationValue * modulation.depth * 0.16,
          0.82,
          1.18,
        ),
      };
    }
    this.lastFrame = hiccupHeadGestureFrame(
      this.sound.id,
      this.progress,
      this.configuration,
      this.velocity,
      controlVoice,
    );
    return this.lastFrame;
  }

  _advanceModulation(noise) {
    const modulation = this.voiceSnapshot.modulation;
    const previousPhase = this.modulationPhase;
    this.modulationPhase += modulation.rateHz / (this.rate * SUBSTEPS);
    if (this.modulationPhase >= 1) this.modulationPhase -= 1;
    if (modulation.source === "triangle") {
      this.modulationValue = 1 - 4 * Math.abs(this.modulationPhase - 0.5);
    } else if (modulation.source === "random") {
      if (!this.modulationRandomInitialized) {
        this.modulationRandomTarget = noise;
        this.modulationRandomInitialized = true;
      }
      if (this.modulationPhase < previousPhase) this.modulationRandomTarget = noise;
      this.modulationRandomValue += (
        this.modulationRandomTarget - this.modulationRandomValue
      ) * this.randomSmoothingAlpha;
      this.modulationValue = this.modulationRandomValue;
    } else {
      this.modulationValue = Math.sin(this.modulationPhase * Math.PI * 2);
    }
    return this.modulationValue;
  }

  _advanceDiaphragm(frame, pressure) {
    if (!HICCUP_GESTURE_IDS.has(this.sound.id) && this.sound.id !== "eef") {
      this.currentDiaphragmFlow = 0;
      return 0;
    }
    const catchAmount = clamp(finite(frame?.diaphragmCatch, 0));
    const targetPressure = pressure * catchAmount;
    const pressureAlpha = targetPressure > this.diaphragmPressure
      ? this.diaphragmAttackAlpha
      : this.diaphragmReleaseAlpha;
    this.diaphragmPressure += (
      targetPressure - this.diaphragmPressure
    ) * pressureAlpha;
    const catchDrop = Math.max(0, this.previousDiaphragmCatch - catchAmount);
    this.diaphragmRelease = Math.max(
      this.diaphragmRelease * this.diaphragmReleaseDecay,
      catchDrop * this.diaphragmPressure,
    );

    const frequencyHz = clamp(
      finite(this.plan.diaphragmFrequencyHz, 14),
      8,
      24,
    );
    const omega = Math.PI * 2 * frequencyHz;
    const targetDisplacement = catchAmount * pressure * 0.045;
    const acceleration = omega * omega * (
      targetDisplacement - this.diaphragmDisplacement
    ) - 0.44 * omega * this.diaphragmVelocity;
    this.diaphragmVelocity = clamp(
      this.diaphragmVelocity + acceleration / this.substepRate
        + catchDrop * this.diaphragmPressure * 1.7,
      -18,
      18,
    );
    this.diaphragmDisplacement = clamp(
      this.diaphragmDisplacement + this.diaphragmVelocity / this.substepRate,
      -0.14,
      0.14,
    );
    this.previousDiaphragmCatch = catchAmount;
    this.currentDiaphragmFlow = cleanWave(clamp(
      this.diaphragmVelocity * 0.00078
        + this.diaphragmRelease * 0.0022,
      -0.014,
      0.014,
    ));
    return this.currentDiaphragmFlow;
  }

  sourceFlow(noise) {
    const frame = this.lastFrame;
    const silliness = clamp(finite(this.plan.silliness, 0.5));
    const modulationValue = this._advanceModulation(noise);
    const modulation = this.voiceSnapshot.modulation;
    const modulationDepth = modulation.depth;
    const roughness = clamp(
      this.plan.roughness
        + (modulation.target === "roughness"
          ? modulationValue * modulationDepth * 0.78
          : 0),
    );
    const breathiness = clamp(
      this.plan.breathiness
        + (modulation.target === "breathiness"
          ? modulationValue * modulationDepth * 0.76
          : 0),
    );
    this.currentRoughness = roughness;
    this.jitter += (noise - this.jitter) * (
      0.0015 + silliness * 0.004 + roughness * 0.008
    );
    const burpIrregularity = this.sound.id === "burp"
      ? clamp(finite(this.plan.irregularity, 0.7))
      : 0;
    const gruntIrregularity = this.sound.id === "grunt"
      ? clamp(finite(this.plan.irregularity, 0.5))
      : 0;
    const hiccupIrregularity = HICCUP_GESTURE_IDS.has(this.sound.id)
      ? clamp(finite(this.plan.irregularity, 0.6))
      : 0;
    const braapIrregularity = this.sound.id === "braap"
      ? clamp(finite(this.plan.irregularity, 0.72))
      : 0;
    const jitterDepth = this.sound.id === "burp"
      ? 0.16 + burpIrregularity * 0.18
      : this.sound.id === "grunt"
        ? 0.11 + gruntIrregularity * 0.16
        : HICCUP_GESTURE_IDS.has(this.sound.id)
          ? 0.13 + hiccupIrregularity * 0.17
          : this.sound.id === "braap"
            ? 0.12 + braapIrregularity * 0.2
          : silliness * 0.035 + roughness * 0.075;
    const vibratoOnset = smoothstep((this.progress - 0.1) / 0.13);
    const modulatedVibratoDepth = clamp(
      this.plan.vibratoDepthSemitones
        + (modulation.target === "vibratoDepth"
          ? modulationValue * modulationDepth * 3
          : 0),
      0,
      5,
    );
    this.vibratoPhase += this.plan.vibratoRateHz / (this.rate * SUBSTEPS);
    if (this.vibratoPhase >= 1) this.vibratoPhase -= 1;
    const vibratoSemitones = Math.sin(this.vibratoPhase * Math.PI * 2)
      * modulatedVibratoDepth * vibratoOnset;
    const pitchModulationSemitones = modulation.target === "pitch"
      ? modulationValue * modulationDepth * 12
      : 0;
    const registerSemitones = finite(frame.registerLift, 0)
      * finite(this.plan.registerJumpSemitones, 0);
    const frequencyTarget = this.plan.glottalFrequencyHz
      * 2 ** ((vibratoSemitones + pitchModulationSemitones + registerSemitones) / 12)
      * (1 + this.jitter * jitterDepth);
    const vocalFrequencyFloorHz = VOCAL_FREQUENCY_FLOOR_HZ[this.sound.id] ?? 18;
    const frequency = clamp(
      frequencyTarget,
      vocalFrequencyFloorHz,
      1_600,
    );
    // A maximum 12% flow makeup accompanies only an actually engaged vocal
    // floor, compensating for the missing low-frequency radiation without
    // flattening normal voices or changing rough/percussive families.
    const lowFrequencyVocalMakeup = vocalFrequencyFloorHz > 18
      ? 1 + clamp(
        (vocalFrequencyFloorHz - finite(frequencyTarget, vocalFrequencyFloorHz))
          / vocalFrequencyFloorHz,
      ) * 0.12
      : 1;
    this.currentGlottalFrequencyHz = frequency;
    this.currentVibratoSemitones = vibratoSemitones;
    this.glottalPhase += frequency / (this.rate * SUBSTEPS);
    if (this.glottalPhase >= 1) {
      this.glottalPhase -= 1;
      this.foldCycle ^= 1;
    }
    const registerIsHead = finite(frame.registerLift, 0) >= 0.5
      || this.sound.id === "wail";
    const lf = glottalSample(
      this.glottalPhase,
      registerIsHead ? this.headGlottalShape : this.glottalShape,
    );
    const pressure = finite(this.configuration.lungPressure, 0) <= 0.000001
      ? 0
      : finite(frame.pressureDrive, 0);
    const diaphragmFlow = this._advanceDiaphragm(frame, pressure);
    const voicing = clamp(finite(frame.voicing, 0));
    const aspiration = clamp(finite(frame.aspiration, 0));
    const storesSuction = this.sound.id === "pop"
      || this.sound.id === "tlik"
      || this.sound.id === "mwah"
      || this.sound.id === "kiss"
      || this.sound.id === "slurp"
      || this.sound.id === "snap"
      || this.sound.id === "klikklak";
    let breathFlow = pressure * (
      (storesSuction ? 0 : 0.0025 + breathiness * 0.0038)
      + clamp(aspiration + breathiness * 0.42) * (0.0112 + noise * 0.0078)
    );
    // Period doubling is a cycle-to-cycle fold asymmetry, not another source.
    // Every other LF cycle loses closure in proportion to subharmonicMix.
    const alternateCycle = this.foldCycle
      ? 1
      : 1 - this.plan.subharmonicMix * 0.78;
    const roughClosure = clamp(
      alternateCycle * (1 + this.jitter * roughness * 0.46),
      0.08,
      1.3,
    );
    let voicedFlow = pressure * voicing * lf * 0.025
      * roughClosure * (1 - breathiness * 0.34);
    voicedFlow += pressure * voicing * noise * roughness * 0.0018;
    if (this.sound.id === "burp") {
      const irregularRate = 5.4 + (this.jitter + 1) * 2.1 + burpIrregularity * 2.8;
      this.irregularPhase += irregularRate / (this.rate * SUBSTEPS);
      if (this.irregularPhase >= 1) this.irregularPhase -= 1;
      const gasPulse = 0.22 + 0.78 * Math.max(
        0,
        Math.sin(this.irregularPhase * Math.PI * 2 + this.jitter * 1.7),
      ) ** 2;
      const foldRattle = 0.7 + Math.abs(noise) * 0.3;
      voicedFlow *= gasPulse * foldRattle * 1.18;
    } else if (this.sound.id === "grunt") {
      // A compact chest grunt is a rough, pressure-gated fold event rather
      // than a pitched bass note. The slow irregular fold closure remains
      // coupled to the pressure-driven throat flap below.
      const irregularRate = 7.5 + gruntIrregularity * 4.2 + (this.jitter + 1) * 1.2;
      this.irregularPhase += irregularRate / (this.rate * SUBSTEPS);
      if (this.irregularPhase >= 1) this.irregularPhase -= 1;
      const compressionPulse = 0.52 + 0.48 * Math.max(
        0,
        Math.sin(this.irregularPhase * Math.PI * 2 + this.jitter * 1.25),
      );
      voicedFlow *= compressionPulse * (0.76 + Math.abs(noise) * 0.28);
    } else if (HICCUP_GESTURE_IDS.has(this.sound.id)) {
      // The folds stay caught while the diaphragm charges, then the same
      // glottis and tract receive the compliant recoil instead of a sample or
      // a second kick oscillator.
      const catchAmount = clamp(finite(frame.diaphragmCatch, 0));
      const releaseGate = 1 - catchAmount * 0.88;
      breathFlow *= releaseGate * 0.78;
      voicedFlow *= releaseGate * (0.86 + this.diaphragmRelease * 0.92);
    } else if (this.sound.id === "eef") {
      // EEF is predominantly folded breath: its voiced fold pulse survives
      // the direction reversal while aspiration is deliberately restrained.
      const foldCompression = 0.94
        + clamp(finite(frame.diaphragmCatch, 0)) * 0.26
        + this.diaphragmRelease * 0.32;
      breathFlow *= 0.68;
      voicedFlow *= foldCompression;
    } else if (this.sound.id === "braap") {
      // BRRAP is voiced pressure through the same loose-lip valve as the
      // tract, not a parallel buzz oscillator. Slow fold irregularity makes
      // the pressure feeding that valve lurch organically while collisions
      // and tract loading determine the audible flutter.
      const irregularRate = 8.2
        + braapIrregularity * 5.4
        + (this.jitter + 1) * 1.15;
      this.irregularPhase += irregularRate / (this.rate * SUBSTEPS);
      if (this.irregularPhase >= 1) this.irregularPhase -= 1;
      const looseFoldPulse = 0.43 + 0.57 * Math.max(
        0,
        Math.sin(this.irregularPhase * Math.PI * 2 + this.jitter * 1.6),
      );
      breathFlow *= 0.72 + looseFoldPulse * 0.32;
      voicedFlow *= (0.58 + looseFoldPulse * 0.78) * (0.9 + Math.abs(noise) * 0.12);
    } else if (this.sound.id === "purr") {
      // PURR is deliberately regular and slow: a creaky fold pulse, not the
      // broadband irregularity used by GROWL or the pressure lurch of BURP.
      const purrRate = 3.1 + clamp(finite(this.plan.irregularity, 0.24)) * 2.2;
      this.irregularPhase += purrRate / (this.rate * SUBSTEPS);
      if (this.irregularPhase >= 1) this.irregularPhase -= 1;
      const creakPulse = 0.22 + 0.78 * Math.max(
        0,
        Math.sin(this.irregularPhase * Math.PI * 2),
      ) ** 1.6;
      voicedFlow *= creakPulse;
      breathFlow *= 0.5 + creakPulse * 0.34;
    }
    const plannedDirection = finite(this.plan.airflowDirection, 1) < 0 ? -1 : 1;
    const hasGestureDirection = HICCUP_GESTURE_IDS.has(this.sound.id) || this.sound.id === "eef";
    const direction = hasGestureDirection
      ? clamp(finite(frame.breathDirection, plannedDirection), -1, 1)
      : plannedDirection;
    this.currentBreathDirection = direction;
    const sourceBody = this.sound.id === "pbpb"
      ? 1.82
      : this.sound.id === "slurp"
        ? 1.5
        : HICCUP_GESTURE_IDS.has(this.sound.id)
          ? 5.2
          : this.sound.id === "braap"
            ? 1.45
          : 1;
    const source = cleanWave(
      (direction * (breathFlow + voicedFlow) + diaphragmFlow)
        * (0.62 + this.velocity * 0.62)
        * sourceBody
        * lowFrequencyVocalMakeup
        * (GESTURE_SOURCE_GAIN[this.sound.id] ?? 1),
    );
    if (this.sound.id === "huff") {
      this.huffSourceMemory = cleanWave(
        this.huffSourceMemory
          + (source - this.huffSourceMemory) * this.huffSourceRadiationAlpha,
      );
      return this.huffSourceMemory;
    }
    if (
      this.sound.id !== "pff"
      && this.sound.id !== "pbpb"
      && this.sound.id !== "braap"
    ) return source;
    const radiationAlpha = this.sound.id === "braap"
      ? this.braapSourceRadiationAlpha
      : this.lipSourceRadiationAlpha;
    this.lipSourceMemory = cleanWave(
      this.lipSourceMemory
        + (source - this.lipSourceMemory) * radiationAlpha,
    );
    return this.lipSourceMemory;
  }

  advance() {
    this.ageFrames += 1;
  }

  isFinite() {
    return Number.isFinite(this.glottalPhase)
      && Number.isFinite(this.vibratoPhase)
      && Number.isFinite(this.irregularPhase)
      && Number.isFinite(this.huffSourceMemory)
      && Number.isFinite(this.currentGlottalFrequencyHz)
      && Number.isFinite(this.currentVibratoSemitones)
      && Number.isFinite(this.currentRoughness)
      && Number.isFinite(this.currentBreathDirection)
      && Number.isFinite(this.diaphragmPressure)
      && Number.isFinite(this.diaphragmDisplacement)
      && Number.isFinite(this.diaphragmVelocity)
      && Number.isFinite(this.diaphragmRelease)
      && Number.isFinite(this.previousDiaphragmCatch)
      && Number.isFinite(this.currentDiaphragmFlow);
  }
}

function initializeStableFuzz(state, rate) {
  state.lidFuzzEnvelope = 0;
  state.lidFuzzOutputLeft = 0;
  state.lidFuzzOutputRight = 0;
  state.lidFuzzEnvelopeAttackAlpha = timeAlpha(0.5, rate);
  state.lidFuzzEnvelopeReleaseAlpha = timeAlpha(60, rate);
}

function resetStableFuzz(state) {
  state.lidFuzzEnvelope = 0;
  state.lidFuzzOutputLeft = 0;
  state.lidFuzzOutputRight = 0;
}

function envelopeRoundedFuzzSample(sample, envelope, drive) {
  const drivenInput = sample / envelope * drive;
  // A continuously rounded denominator flattens the waveform without the
  // cubic clip's abrupt upper-harmonic edge. It remains a same-sample static
  // shaper: no delayed copy, tone filter, or phase-offset parallel path.
  return drivenInput / Math.sqrt(1 + drivenInput * drivenInput) * envelope * 0.74;
}

function processStableFuzz(state, left, right, amount) {
  const lidFuzz = clamp(finite(amount, 0));
  if (lidFuzz <= 0.0001) {
    resetStableFuzz(state);
    state.lidFuzzOutputLeft = left;
    state.lidFuzzOutputRight = right;
    return;
  }
  // Normalize the clipping threshold to a linked stereo envelope. Unlike the
  // former wet/dry power matcher, this does not mathematically cancel drive on
  // quiet sounds: a whisper and a kick receive the same harmonic shape while
  // retaining their original relative scale. The static rounded curve has no
  // delay, filter, or parallel phase path, so it cannot produce a flange.
  const inputPeak = Math.max(Math.abs(left), Math.abs(right));
  const envelopeAlpha = inputPeak > state.lidFuzzEnvelope
    ? state.lidFuzzEnvelopeAttackAlpha
    : state.lidFuzzEnvelopeReleaseAlpha;
  state.lidFuzzEnvelope += (
    inputPeak - state.lidFuzzEnvelope
  ) * envelopeAlpha;
  // Use the current linked peak immediately for transients while the follower
  // supplies the slower inter-sample reference. A plosive therefore reaches
  // the flat top without being attenuated during the envelope attack window.
  const envelope = Math.max(0.0001, state.lidFuzzEnvelope, inputPeak);
  const drive = 1 + 9 * lidFuzz ** 1.1;
  const shapedLeft = envelopeRoundedFuzzSample(left, envelope, drive);
  const shapedRight = envelopeRoundedFuzzSample(right, envelope, drive);
  const blend = lidFuzz * 0.99;
  state.lidFuzzOutputLeft = clamp(
    left * (1 - blend) + shapedLeft * blend,
    -OUTPUT_CEILING,
    OUTPUT_CEILING,
  );
  state.lidFuzzOutputRight = clamp(
    right * (1 - blend) + shapedRight * blend,
    -OUTPUT_CEILING,
    OUTPUT_CEILING,
  );
}

function stableFuzzIsFinite(state) {
  return Number.isFinite(state.lidFuzzEnvelope)
    && Number.isFinite(state.lidFuzzOutputLeft)
    && Number.isFinite(state.lidFuzzOutputRight);
}

class HiccupHeadPhysicalProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this.rate = sampleRate;
    this.radiationGainAlpha = timeAlpha(4, this.rate);
    this.configuration = sanitizeHiccupHeadState(
      options.processorOptions?.configuration ?? HICCUP_HEAD_DEFAULTS,
    );
    this.externalFuzz = Boolean(options.processorOptions?.externalFuzz);
    this.externalHighpass = Boolean(options.processorOptions?.externalHighpass);
    this.externalReverb = Boolean(options.processorOptions?.externalReverb);
    this.tract = new OrganicMouthTract(this.rate, this.configuration);
    this.faceSpace = new FaceSpace(this.rate, this.externalReverb);
    this.gesture = null;
    this.queue = [];
    this.renderedFrames = 0;
    this.eventSerial = 0;
    this.seed = 0x6d6f7574;
    this.previousNoise = 0;
    this.turbulenceFast = 0;
    this.turbulenceSlow = 0;
    this.controlCountdown = 0;
    this.blockCounter = 0;
    this.finiteAuditCountdown = 0;
    this.lastSoundId = "";
    this.lastPeak = 0;
    this.lastRms = 0;
    this.dcInputLeft = 0;
    this.dcInputRight = 0;
    this.dcOutputLeft = 0;
    this.dcOutputRight = 0;
    this.lidHighpassLowLeft = 0;
    this.lidHighpassLowRight = 0;
    this.lidHighpassLowLeftB = 0;
    this.lidHighpassLowRightB = 0;
    initializeStableFuzz(this, this.rate);
    this.lastFrame = this.tract.currentFrame;
    this.renderLeft = 0;
    this.renderRight = 0;
    this.radiationGain = 1;
    this.acousticOwnerSoundId = "";
    this.acousticOwnerBankOutputGain = 1;
    this.warmupToken = null;
    this.warmupFramesRemaining = 0;
    this.port.onmessage = (event) => this._handleMessage(event.data);
  }

  _eventForMessage(message) {
    const soundId = hiccupHeadSound(message.soundId).id;
    const velocity = clamp(finite(message.velocity, 1), 0.01, 1);
    const delayFrames = Math.max(0, Math.round(clamp(finite(message.delaySeconds, 0), 0, 2) * this.rate));
    const hasFlatToothTine = message.toothTineHz !== undefined
      || message.toothTinePosition !== undefined
      || message.toothTineBrightness !== undefined
      || message.toothTineIndex !== undefined
      || message.toothIndex !== undefined;
    const toothTineSource = message.toothTine
      && typeof message.toothTine === "object"
      ? message.toothTine
      : hasFlatToothTine
        ? {
          frequencyHz: message.toothTineHz,
          position: message.toothTinePosition,
          brightness: message.toothTineBrightness,
          toothIndex: message.toothTineIndex ?? message.toothIndex,
        }
        : null;
    // Tooth taps are transient event metadata, not persistent face state, so
    // deliberately keep them outside sanitizeHiccupHeadState.
    const toothTine = soundId === "tlik"
      ? sanitizeToothTine(toothTineSource)
      : null;
    const brushDirection = soundId === "brush" && message.brushDirection === -1 ? -1 : 1;
    const configurationSnapshot = message.configuration
      && typeof message.configuration === "object"
      ? sanitizeHiccupHeadState(
        { ...this.configuration, ...message.configuration },
        this.configuration,
      )
      : null;
    const voiceSnapshot = message.voice && typeof message.voice === "object"
      ? sanitizeHiccupHeadVoice(message.voice)
      : null;
    const planningConfiguration = configurationSnapshot ?? this.configuration;
    const plan = physicalVoiceParameters(
      soundId,
      planningConfiguration,
      velocity,
      voiceSnapshot ?? {},
    );
    const requestedDurationSeconds = Number(message.gestureDurationSeconds);
    const gestureDurationSeconds = Number.isFinite(requestedDurationSeconds)
      ? clamp(requestedDurationSeconds, 0.018, 2.2)
      : plan.durationSeconds;
    const bankOutputGain = clamp(finite(message.bankOutputGain, 1), 0.2, 1.8);
    const totalFrames = Math.max(1, Math.ceil(gestureDurationSeconds * this.rate));
    const releasePhase = RELEASE_PHASES[soundId] ?? 0.1;
    const livePreparationFrames = Math.min(
      Math.round(this.rate * (LIVE_PREPARATION_SECONDS[soundId] ?? 0.014)),
      Math.max(1, Math.round(releasePhase * totalFrames)),
    );
    const releaseFrame = this.renderedFrames + (delayFrames > 0 ? delayFrames : livePreparationFrames);
    const availablePreparation = Math.max(0, releaseFrame - this.renderedFrames);
    const fullPreparation = Math.round(releasePhase * totalFrames);
    const startFrame = Math.max(this.renderedFrames, releaseFrame - fullPreparation);
    const actualPreparation = releaseFrame - startFrame;
    const startPhase = clamp(releasePhase - actualPreparation / totalFrames);
    return {
      soundId,
      velocity,
      order: this.eventSerial,
      requestedFrame: this.renderedFrames + delayFrames,
      releaseFrame,
      startFrame,
      startPhase,
      releasePhase,
      live: delayFrames === 0,
      requestedDelayFrames: delayFrames,
      availablePreparation,
      livePreparationFrames,
      configurationSnapshot,
      voiceSnapshot,
      toothTine,
      brushDirection,
      gestureDurationSeconds,
      bankOutputGain,
    };
  }

  _handleMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "warmup") {
      this.warmupToken = String(message.token ?? "");
      this.warmupFramesRemaining = Math.max(1, Math.round(this.rate * 0.04));
      return;
    }
    if (message.type === "configure") {
      this.configuration = sanitizeHiccupHeadState(
        { ...this.configuration, ...(message.configuration ?? {}) },
        this.configuration,
      );
      if (this.gesture) this.gesture.configuration = this.configuration;
      this.controlCountdown = 0;
      return;
    }
    if (message.type === "strike" || message.type === "trigger") {
      const event = this._eventForMessage(message);
      this.eventSerial += 1;
      const simultaneousIndex = this.queue.findIndex(
        (queued) => queued.requestedFrame === event.requestedFrame,
      );
      if (simultaneousIndex >= 0) {
        const current = this.queue[simultaneousIndex];
        if (event.velocity > current.velocity) this.queue[simultaneousIndex] = event;
      } else {
        this.queue.push(event);
      }
      this.queue.sort((left, right) => left.releaseFrame - right.releaseFrame || left.order - right.order);
      return;
    }
    if (message.type === "drop-scheduled") {
      this.queue.length = 0;
      return;
    }
    if (message.type === "silence" || message.type === "panic") this._silence();
  }

  _silence() {
    this.gesture = null;
    this.queue.length = 0;
    this.tract.resetWaveState();
    this.faceSpace.reset();
    this.tract.configure(this.configuration, true);
    this.controlCountdown = 0;
    this.lastPeak = 0;
    this.lastRms = 0;
    this.radiationGain = 1;
    this.acousticOwnerSoundId = "";
    this.acousticOwnerBankOutputGain = 1;
    this.dcInputLeft = 0;
    this.dcInputRight = 0;
    this.dcOutputLeft = 0;
    this.dcOutputRight = 0;
    this.lidHighpassLowLeft = 0;
    this.lidHighpassLowRight = 0;
    this.lidHighpassLowLeftB = 0;
    this.lidHighpassLowRightB = 0;
    resetStableFuzz(this);
  }

  _beginGesture(event, absoluteFrame) {
    const previousGestureWasAudible = Boolean(
      this.gesture && absoluteFrame >= this.gesture.releaseFrame,
    );
    const hasAcousticMemory = previousGestureWasAudible
      || Math.abs(this.tract.lastOralOutput) + Math.abs(this.tract.lastNasalOutput) > 1e-8;
    const preparationSoundId = hasAcousticMemory
      ? previousGestureWasAudible
        ? this.gesture.sound.id
        : this.acousticOwnerSoundId
      : "";
    const preparationBankOutputGain = previousGestureWasAudible
      ? this.gesture.bankOutputGain
      : this.acousticOwnerBankOutputGain;
    if (this.gesture || hasAcousticMemory) this.tract.chokeForRetarget(0.24);
    if (event.configurationSnapshot) {
      this.configuration = sanitizeHiccupHeadState(
        event.configurationSnapshot,
        this.configuration,
      );
    }
    const plan = physicalVoiceParameters(
      event.soundId,
      this.configuration,
      event.velocity,
      event.voiceSnapshot ?? {},
    );
    const totalFrames = Math.max(1, Math.ceil(plan.durationSeconds * this.rate));
    const remainingPreparation = Math.max(0, event.releaseFrame - absoluteFrame);
    const startPhase = event.live
      ? event.startPhase
      : clamp(event.releasePhase - remainingPreparation / totalFrames);
    const startedEvent = {
      ...event,
      startFrame: absoluteFrame,
      startPhase,
      releaseFrame: Math.max(absoluteFrame + 1, event.releaseFrame),
    };
    this.gesture = new HiccupHeadGestureController(this.rate, startedEvent, this.configuration);
    this.gesture.preparationSoundId = preparationSoundId;
    this.gesture.preparationBankOutputGain = preparationBankOutputGain;
    this.gesture.suppressPreparationSource = !event.live && Boolean(preparationSoundId);
    // With no outgoing sound, preparation is silent. When a scheduled event
    // inherits a real tail, pass that tail under its outgoing gain identity;
    // the incoming gesture contributes no source until its release frame.
    this.gesture.muteUntilRelease = !event.live || !hasAcousticMemory;
    this.lastSoundId = this.gesture.sound.id;
    this.lastFrame = this.gesture.sampleControlFrame();
    const naturalPreparation = Math.max(1, Math.round(event.releasePhase * totalFrames));
    this.tract.articulationSpeedScale = event.live
      ? 8
      : clamp(naturalPreparation / Math.max(1, remainingPreparation), 1, 8);
    this.tract.tailLoss = 1;
    // Live gestures use a short sound-specific preparation and move the
    // existing geometry; they never replace the tract or jump its diameter
    // array to a new pose.
    this.tract.setArticulation(
      this.configuration,
      this.lastFrame,
      this.gesture.plan,
    );
    this.controlCountdown = CONTROL_INTERVAL_FRAMES;
  }

  _triggerDueEvent(absoluteFrame) {
    if (!this.queue.length) return;
    const next = this.queue[0];
    // The earliest requested release owns the only mouth. A later gesture may
    // shorten its preparation, but it cannot pre-empt an earlier event before
    // that event has reached its audible release.
    if (
      this.gesture
      && !next.live
      && absoluteFrame <= this.gesture.releaseFrame + Math.round(this.rate * 0.0025)
      && next.releaseFrame >= this.gesture.releaseFrame
    ) return;
    const hasAcousticTail = Boolean(this.gesture)
      || Math.abs(this.tract.lastOralOutput) + Math.abs(this.tract.lastNasalOutput) > 1e-8;
    if (!next.live && hasAcousticTail) {
      // Finish the outgoing gesture/tail until the incoming sound's normal
      // live-preparation window. This keeps a compressed BRUSH's tooth sweep
      // intact, then gives KISS (or any other sealed gesture) its usual short
      // silent setup instead of retargeting the tract for the whole lookahead.
      const tailSafeStartFrame = Math.max(
        next.startFrame,
        next.releaseFrame - Math.max(1, finite(next.livePreparationFrames, 1)),
      );
      if (absoluteFrame < tailSafeStartFrame) return;
    }
    if (next.startFrame > absoluteFrame) return;
    const event = this.queue.shift();
    this._beginGesture(event, absoluteFrame);
  }

  _random() {
    this.seed = xorshift(this.seed);
    return (this.seed >>> 0) / 4294967295 * 2 - 1;
  }

  _resetAfterNonFinite() {
    this.gesture = null;
    this.queue.length = 0;
    this.tract.resetWaveState();
    this.faceSpace.reset();
    this.tract.configure(this.configuration, true);
    this.previousNoise = 0;
    this.turbulenceFast = 0;
    this.turbulenceSlow = 0;
    this.dcInputLeft = 0;
    this.dcInputRight = 0;
    this.dcOutputLeft = 0;
    this.dcOutputRight = 0;
    this.lidHighpassLowLeft = 0;
    this.lidHighpassLowRight = 0;
    this.lidHighpassLowLeftB = 0;
    this.lidHighpassLowRightB = 0;
    resetStableFuzz(this);
    this.lastPeak = 0;
    this.lastRms = 0;
    this.radiationGain = 1;
    this.acousticOwnerSoundId = "";
    this.acousticOwnerBankOutputGain = 1;
    this.controlCountdown = 0;
    this.finiteAuditCountdown = 0;
  }

  _renderFrame(absoluteFrame) {
    this._triggerDueEvent(absoluteFrame);
    const gestureReleased = Boolean(
      this.gesture && absoluteFrame >= this.gesture.releaseFrame,
    );
    if (gestureReleased) {
      this.acousticOwnerSoundId = this.gesture.sound.id;
      this.acousticOwnerBankOutputGain = this.gesture.bankOutputGain;
    }
    const carryingPreparationTail = Boolean(
      this.gesture
      && !gestureReleased
      && this.gesture.preparationSoundId,
    );
    if (this.controlCountdown <= 0) {
      if (this.gesture) this.lastFrame = this.gesture.sampleControlFrame();
      else this.lastFrame = this.tract._restFrame(this.configuration);
      this.tract.setArticulation(
        this.configuration,
        this.lastFrame,
        this.gesture?.plan ?? null,
      );
      this.controlCountdown = CONTROL_INTERVAL_FRAMES;
    }
    this.controlCountdown -= 1;

    let output = 0;
    for (let substep = 0; substep < SUBSTEPS; substep += 1) {
      const rawNoise = this._random();
      this.turbulenceFast += (rawNoise - this.turbulenceFast) * 0.42;
      this.turbulenceSlow += (rawNoise - this.turbulenceSlow) * 0.09;
      const turbulenceNoise = (this.turbulenceFast - this.turbulenceSlow) * 1.85;
      this.previousNoise = rawNoise;
      const sourceFlow = carryingPreparationTail
        && this.gesture.suppressPreparationSource
        ? 0
        : this.gesture?.sourceFlow(this.turbulenceFast) ?? 0;
      output += this.tract.processSubstep(sourceFlow, turbulenceNoise);
    }
    output /= SUBSTEPS;
    if (this.gesture && absoluteFrame >= this.gesture.releaseFrame) {
      this.tract.articulationSpeedScale = 1;
    }
    const audible = !this.gesture
      || absoluteFrame >= this.gesture.releaseFrame
      || !this.gesture.muteUntilRelease;
    if (!audible) output = 0;
    const acousticSoundId = carryingPreparationTail
      ? this.gesture.preparationSoundId
      : this.gesture?.sound.id;
    const radiationTarget = GESTURE_OUTPUT_GAIN[acousticSoundId] ?? 1;
    this.radiationGain += (
      radiationTarget - this.radiationGain
    ) * this.radiationGainAlpha;
    output *= this.radiationGain;

    const pan = clamp(finite(this.gesture?.plan?.pan, 0), -1, 1);
    const panAngle = (pan + 1) * Math.PI * 0.25;
    // The app owns the user-facing master gain. Keep only strike dynamics here
    // so `level` is not applied twice before the safety ceiling.
    const level = 0.66 + finite(this.gesture?.velocity, 0.65) * 0.46;
    const dryLeft = output * Math.cos(panAngle) * level;
    const dryRight = output * Math.sin(panAngle) * level;
    this.faceSpace.process(dryLeft, dryRight, this.configuration);
    const left = this.faceSpace.left;
    const right = this.faceSpace.right;
    const highpassedLeft = left - this.dcInputLeft + this.dcOutputLeft * 0.995;
    const highpassedRight = right - this.dcInputRight + this.dcOutputRight * 0.995;
    this.dcInputLeft = left;
    this.dcInputRight = right;
    this.dcOutputLeft = highpassedLeft;
    this.dcOutputRight = highpassedRight;
    // The rattle's living flap keeps its sustained pressure/body, while a
    // shallow gesture-local soft knee rounds the occasional resonant contact
    // spike which otherwise reads as a much louder digital crack.
    const rattleKnee = 0.022;
    const presenceLeft = this.gesture?.sound.id === "rattle"
      ? Math.tanh(highpassedLeft / rattleKnee) * rattleKnee
      : highpassedLeft;
    const presenceRight = this.gesture?.sound.id === "rattle"
      ? Math.tanh(highpassedRight / rattleKnee) * rattleKnee
      : highpassedRight;
    // A bounded presence stage raises small breaths and skin detail while the
    // smooth tanh knee prevents digital clipping at violent face settings.
    let boundedLeft = Math.tanh(presenceLeft * 42) * OUTPUT_CEILING;
    let boundedRight = Math.tanh(presenceRight * 42) * OUTPUT_CEILING;
    const gesturePostGain = GESTURE_POST_GAIN[acousticSoundId] ?? 1;
    const bankOutputGain = carryingPreparationTail
      ? this.gesture.preparationBankOutputGain
      : this.gesture?.bankOutputGain ?? 1;
    boundedLeft *= gesturePostGain * bankOutputGain;
    boundedRight *= gesturePostGain * bankOutputGain;
    // Preserve sequencer velocity contrast after the strong presence stage;
    // otherwise eyebrow accents collapse to almost the same loudness.
    const postVelocity = 0.42 + finite(this.gesture?.velocity, 0.65) * 0.58;
    boundedLeft *= postVelocity;
    boundedRight *= postVelocity;
    // Right-lid fuzz is a warm, level-trimmed saturation after the presence
    // stage. It has no delay line or phase branch, so it can become obviously
    // rough without ever turning into a flange.
    const lidFuzz = this.faceSpace.eyelidFuzzAmount;
    if (!this.externalFuzz) {
      processStableFuzz(this, boundedLeft, boundedRight, lidFuzz);
      boundedLeft = this.lidFuzzOutputLeft;
      boundedRight = this.lidFuzzOutputRight;
    }
    if (!this.externalHighpass) {
      // Two cascaded poles make the compatibility sweep decisive even on an
      // engine too old to expose the native resonant Biquad used in browsers.
      const lidHighpass = this.faceSpace.eyelidHighpassAmount;
      const highpassCutoffHz = 30 * 2 ** (lidHighpass * LID_HIGHPASS_OCTAVES);
      const highpassAlpha = 1 - Math.exp(
        -Math.PI * 2 * highpassCutoffHz / this.rate,
      );
      this.lidHighpassLowLeft += (
        boundedLeft - this.lidHighpassLowLeft
      ) * highpassAlpha;
      this.lidHighpassLowRight += (
        boundedRight - this.lidHighpassLowRight
      ) * highpassAlpha;
      const highpassLeftA = boundedLeft - this.lidHighpassLowLeft;
      const highpassRightA = boundedRight - this.lidHighpassLowRight;
      this.lidHighpassLowLeftB += (
        highpassLeftA - this.lidHighpassLowLeftB
      ) * highpassAlpha;
      this.lidHighpassLowRightB += (
        highpassRightA - this.lidHighpassLowRightB
      ) * highpassAlpha;
      const highpassLeft = highpassLeftA - this.lidHighpassLowLeftB;
      const highpassRight = highpassRightA - this.lidHighpassLowRightB;
      const highpassMakeup = 1 + lidHighpass * 0.32;
      boundedLeft = clamp(
        (boundedLeft * (1 - lidHighpass) + highpassLeft * lidHighpass) * highpassMakeup,
        -OUTPUT_CEILING,
        OUTPUT_CEILING,
      );
      boundedRight = clamp(
        (boundedRight * (1 - lidHighpass) + highpassRight * lidHighpass) * highpassMakeup,
        -OUTPUT_CEILING,
        OUTPUT_CEILING,
      );
    }

    this.gesture?.advance();
    if (this.gesture?.complete) {
      this.gesture = null;
      this.tract.tailLoss = clamp(
        0.9968 + this.configuration.decay * 0.0018,
        0.9974,
        0.9994,
      );
      this.controlCountdown = 0;
    }
    this.finiteAuditCountdown -= 1;
    const faceScalarsAreFinite = this.faceSpace.scalarsAreFinite();
    let modelAuditIsFinite = true;
    if (this.finiteAuditCountdown <= 0) {
      modelAuditIsFinite = (!this.gesture || this.gesture.isFinite())
        && this.tract.isFinite()
        && this.faceSpace.auditFiniteWindow(FACE_FINITE_AUDIT_WINDOW);
      this.finiteAuditCountdown = FINITE_AUDIT_INTERVAL_FRAMES;
    }
    if (
      !Number.isFinite(boundedLeft)
      || !Number.isFinite(boundedRight)
      || !Number.isFinite(this.lidHighpassLowLeft)
      || !Number.isFinite(this.lidHighpassLowRight)
      || !Number.isFinite(this.lidHighpassLowLeftB)
      || !Number.isFinite(this.lidHighpassLowRightB)
      || !stableFuzzIsFinite(this)
      || !faceScalarsAreFinite
      || !modelAuditIsFinite
    ) {
      this._resetAfterNonFinite();
      this.renderLeft = 0;
      this.renderRight = 0;
      return;
    }
    this.renderLeft = boundedLeft;
    this.renderRight = boundedRight;
  }

  _telemetry() {
    const frame = this.lastFrame ?? this.tract._restFrame(this.configuration);
    const constrictionIndex = clamp(
      this.tract.activeConstrictionIndex,
      0,
      this.tract.sectionCount - 1,
    );
    return {
      type: "telemetry",
      activeGesture: this.gesture?.sound.id ?? "",
      activeVoices: this.gesture ? 1 : 0,
      queuedEvents: this.queue.length,
      lastSoundId: this.lastSoundId,
      gestureProgress: this.gesture?.progress ?? 1,
      gestureAmount: finite(frame.poseMix, 0),
      velocity: finite(this.gesture?.velocity, 0),
      tractPressure: this.tract.tractPressure,
      signedPressure: this.tract.signedPressure,
      oralSectionCount: this.tract.sectionCount,
      lipDiameterCm: this.tract.diameter[this.tract.sectionCount - 1],
      constrictionIndex,
      constrictionDiameterCm: this.tract.diameter[constrictionIndex],
      velumOpening: this.tract.nose.opening,
      tonguePosition: finite(frame.tonguePosition, this.configuration.tonguePosition),
      tongueCurl: finite(frame.tongueCurl, this.configuration.tongueCurl),
      tongueOut: finite(frame.tongueOut, finite(this.configuration.tongueOut, 0)),
      mouthOpening: finite(frame.mouthOpening, this.configuration.mouthOpening),
      cheekDisplacement: this.tract.cheek.displacement,
      tongueTrillApertureCm: this.tract.tongueValve.apertureCm,
      throatRattleApertureCm: this.tract.throatValve.apertureCm,
      missingTooth: HICCUP_HEAD_TOOTH_GAP_ANATOMY.missingTooth,
      toothGapWidthCm: finite(
        this.gesture?.plan?.toothGapWidthCm,
        HICCUP_HEAD_TOOTH_GAP_ANATOMY.crownGapWidthCm,
      ),
      toothGapHeightCm: finite(
        this.gesture?.plan?.toothGapHeightCm,
        HICCUP_HEAD_TOOTH_GAP_ANATOMY.crownGapHeightCm,
      ),
      toothJetSlotHeightCm: finite(this.gesture?.plan?.toothJetSlotHeightCm, 0),
      toothJetAreaCm2: finite(this.gesture?.plan?.toothJetAreaCm2, 0),
      toothJetFlow: this.tract.toothJet.flow,
      toothJetSpeedMps: this.tract.toothJet.jetSpeedMps,
      toothWhistleFrequencyHz: this.tract.toothJet.frequencyHz,
      toothWhistleMode: this.tract.toothJet.mode,
      toothWhistleStrouhalNumber: this.tract.toothJet.strouhalNumber,
      toothJetImpingementLengthM: this.tract.toothJet.impingementLengthM,
      toothTineActive: this.tract.toothTine.active,
      toothTineFlow: this.tract.toothTine.flow,
      toothTineFrequencyHz: this.tract.toothTine.frequencyHz,
      toothKnockFrequencyHz: this.tract.toothTine.resonantFrequencyHz,
      toothTinePosition: this.tract.toothTine.position,
      toothTineBrightness: this.tract.toothTine.brightness,
      toothTineIndex: this.tract.toothTine.toothIndex,
      airflowDirection: finite(this.gesture?.plan?.airflowDirection, 0),
      breathDirection: finite(
        this.gesture?.currentBreathDirection,
        finite(frame.breathDirection, 0),
      ),
      diaphragmCatch: finite(frame.diaphragmCatch, 0),
      diaphragmPressure: finite(this.gesture?.diaphragmPressure, 0),
      diaphragmDisplacement: finite(this.gesture?.diaphragmDisplacement, 0),
      diaphragmFlow: finite(this.gesture?.currentDiaphragmFlow, 0),
      gestureGain: (
        GESTURE_SOURCE_GAIN[this.gesture?.sound.id] ?? 1
      ) * this.radiationGain,
      voiceCharacterId: this.gesture?.voiceSnapshot?.characterId ?? "",
      glottalFrequencyHz: finite(this.gesture?.currentGlottalFrequencyHz, 0),
      vibratoRateHz: finite(this.gesture?.plan?.vibratoRateHz, 0),
      vibratoDepthSemitones: finite(this.gesture?.plan?.vibratoDepthSemitones, 0),
      vibratoSemitones: finite(this.gesture?.currentVibratoSemitones, 0),
      roughness: finite(this.gesture?.currentRoughness, 0),
      subharmonicMix: finite(this.gesture?.plan?.subharmonicMix, 0),
      dooPitch: this.configuration.dooPitch,
      earSpread: this.faceSpace.earAmount,
      stereoWidth: this.faceSpace.stereoWidth,
      stereoDelayMs: this.faceSpace.stereoDelayMs,
      hairDelay: this.faceSpace.hairAmount,
      hairDelayMs: this.faceSpace.hairDelayMs,
      hairFeedback: this.faceSpace.hairFeedback,
      hairMix: this.faceSpace.hairMix,
      leftHairLength: this.faceSpace.leftHairLength,
      rightHairLength: this.faceSpace.rightHairLength,
      leftHairAngle: this.faceSpace.leftHairAngle,
      rightHairAngle: this.faceSpace.rightHairAngle,
      leftHairDelayMs: this.faceSpace.leftHairDelayMs,
      rightHairDelayMs: this.faceSpace.rightHairDelayMs,
      leftHairFeedback: this.faceSpace.leftHairFeedback,
      rightHairFeedback: this.faceSpace.rightHairFeedback,
      leftHairMix: this.faceSpace.leftHairMix,
      rightHairMix: this.faceSpace.rightHairMix,
      eyeDivergence: this.faceSpace.eyeAmount,
      eyeReverbAmount: this.faceSpace.eyeReverbAmount,
      eyelidHighpassAmount: this.faceSpace.eyelidHighpassAmount,
      eyeClosure: this.faceSpace.eyeClosureAmount,
      leftEyeClosure: this.faceSpace.leftEyeClosureAmount,
      rightEyeClosure: this.faceSpace.rightEyeClosureAmount,
      peak: this.lastPeak,
      rms: this.lastRms,
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1] ?? left;
    if (!left) return true;
    let peak = 0;
    let squareSum = 0;
    for (let frame = 0; frame < left.length; frame += 1) {
      this._renderFrame(this.renderedFrames + frame);
      left[frame] = this.renderLeft;
      if (right) right[frame] = this.renderRight;
      peak = Math.max(peak, Math.abs(this.renderLeft), Math.abs(this.renderRight));
      squareSum += (this.renderLeft ** 2 + this.renderRight ** 2) * 0.5;
    }
    this.tract.measurePressureForBlock(left.length);
    this.renderedFrames += left.length;
    if (this.warmupToken !== null) {
      this.warmupFramesRemaining -= left.length;
      if (this.warmupFramesRemaining <= 0) {
        this.port.postMessage({
          type: "render-ready",
          token: this.warmupToken,
          renderedFrames: this.renderedFrames,
        });
        this.warmupToken = null;
        this.warmupFramesRemaining = 0;
      }
    }
    this.lastPeak += (peak - this.lastPeak) * 0.22;
    this.lastRms += (Math.sqrt(squareSum / left.length) - this.lastRms) * 0.22;
    this.blockCounter += 1;
    if (this.blockCounter >= TELEMETRY_BLOCKS) {
      this.blockCounter = 0;
      this.port.postMessage(this._telemetry());
    }
    return true;
  }
}

class HiccupHeadFacePostProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this.rate = sampleRate;
    this.externalHighpass = Boolean(options.processorOptions?.externalHighpass);
    const configuration = options.processorOptions?.configuration ?? HICCUP_HEAD_DEFAULTS;
    const sharedClosure = clamp(finite(configuration.eyeClosure, 0));
    this.targetLeftClosure = clamp(finite(configuration.leftEyeClosure, sharedClosure));
    this.targetRightClosure = clamp(finite(configuration.rightEyeClosure, sharedClosure));
    this.leftClosure = this.targetLeftClosure;
    this.rightClosure = this.targetRightClosure;
    this.closureAlpha = timeAlpha(24, this.rate);
    this.lidHighpassLowLeft = 0;
    this.lidHighpassLowRight = 0;
    this.lidHighpassLowLeftB = 0;
    this.lidHighpassLowRightB = 0;
    initializeStableFuzz(this, this.rate);
    this.port.onmessage = (event) => this._handleMessage(event.data);
  }

  _handleMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "configure") {
      const configuration = message.configuration ?? {};
      const sharedClosure = clamp(finite(configuration.eyeClosure, 0));
      this.targetLeftClosure = clamp(finite(
        configuration.leftEyeClosure,
        sharedClosure,
      ));
      this.targetRightClosure = clamp(finite(
        configuration.rightEyeClosure,
        sharedClosure,
      ));
      return;
    }
    if (message.type === "silence" || message.type === "panic") this._resetHistory();
  }

  _resetHistory() {
    this.lidHighpassLowLeft = 0;
    this.lidHighpassLowRight = 0;
    this.lidHighpassLowLeftB = 0;
    this.lidHighpassLowRightB = 0;
    resetStableFuzz(this);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const outputLeft = output?.[0];
    const outputRight = output?.[1] ?? outputLeft;
    if (!outputLeft) return true;
    const inputLeft = input?.[0];
    const inputRight = input?.[1] ?? inputLeft;
    if (!inputLeft) {
      outputLeft.fill(0);
      if (outputRight !== outputLeft) outputRight?.fill(0);
      this._resetHistory();
      return true;
    }

    for (let frame = 0; frame < outputLeft.length; frame += 1) {
      this.leftClosure += (
        this.targetLeftClosure - this.leftClosure
      ) * this.closureAlpha;
      this.rightClosure += (
        this.targetRightClosure - this.rightClosure
      ) * this.closureAlpha;
      let left = finite(inputLeft[frame], 0);
      let right = finite(inputRight?.[frame], left);
      processStableFuzz(this, left, right, this.rightClosure);
      left = this.lidFuzzOutputLeft;
      right = this.lidFuzzOutputRight;

      if (!this.externalHighpass) {
        const highpassAmount = clamp(this.leftClosure) ** 0.75;
        const highpassCutoffHz = 30 * 2 ** (
          highpassAmount * LID_HIGHPASS_OCTAVES
        );
        const highpassAlpha = 1 - Math.exp(
          -Math.PI * 2 * highpassCutoffHz / this.rate,
        );
        this.lidHighpassLowLeft += (left - this.lidHighpassLowLeft) * highpassAlpha;
        this.lidHighpassLowRight += (right - this.lidHighpassLowRight) * highpassAlpha;
        const highpassLeftA = left - this.lidHighpassLowLeft;
        const highpassRightA = right - this.lidHighpassLowRight;
        this.lidHighpassLowLeftB += (
          highpassLeftA - this.lidHighpassLowLeftB
        ) * highpassAlpha;
        this.lidHighpassLowRightB += (
          highpassRightA - this.lidHighpassLowRightB
        ) * highpassAlpha;
        const highpassLeft = highpassLeftA - this.lidHighpassLowLeftB;
        const highpassRight = highpassRightA - this.lidHighpassLowRightB;
        const highpassMakeup = 1 + highpassAmount * 0.32;
        left = clamp(
          (left * (1 - highpassAmount) + highpassLeft * highpassAmount) * highpassMakeup,
          -1.5,
          1.5,
        );
        right = clamp(
          (right * (1 - highpassAmount) + highpassRight * highpassAmount) * highpassMakeup,
          -1.5,
          1.5,
        );
      }

      if (!Number.isFinite(left) || !Number.isFinite(right) || !stableFuzzIsFinite(this)) {
        this._resetHistory();
        left = 0;
        right = 0;
      }
      outputLeft[frame] = left;
      if (outputRight) outputRight[frame] = right;
    }
    return true;
  }
}

registerProcessor("hiccup-head-physical-model", HiccupHeadPhysicalProcessor);
registerProcessor("hiccup-head-face-post", HiccupHeadFacePostProcessor);
