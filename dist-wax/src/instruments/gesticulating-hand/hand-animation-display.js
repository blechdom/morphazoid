import {
  FINGERS, HAND_DEFAULTS, clampHand, createHandPose, evaluateHandPose,
  handAnimationLanes, handAnimationValue, handMotionPeriod, handTremorRate,
} from './hand-model.js';

export const HAND_ANIMATION_DISPLAY_MAX_COLUMNS = 256;
export const HAND_ANIMATION_DISPLAY_MAX_SAMPLES = 4096;

function fastestTremor(config) {
  const settings = config.tremor;
  if (!settings || clampHand(settings.amount, 0, 45, 0) === 0) return 0;
  const finger = FINGERS.indexOf(settings.finger);
  const spread = clampHand(settings.rateSpread, 0, 1, 0);
  const exponent = settings.joint === 'wrist' || finger < 0 ? .9 : (finger - 2) * .45;
  return handTremorRate(config) * 2 ** (exponent * spread);
}

// Deterministic stratified jitter avoids equal-spacing aliases when a tremor
// completes an integer number of cycles between display anchors.
function jitter(column, sample) {
  let hash = Math.imul(column + 1, 0x9e3779b1) ^ Math.imul(sample + 1, 0x85ebca6b);
  hash = Math.imul(hash ^ hash >>> 16, 0x7feb352d);
  hash = Math.imul(hash ^ hash >>> 15, 0x846ca68b);
  return ((hash ^ hash >>> 16) >>> 0) / 4294967296 + .5 / 4294967296;
}

/** Sample the final pose used by the rig and sound, without baking or changing
 * its animation. Values are exact model evaluations at the column boundaries;
 * min/max are sampled envelopes, not guaranteed analytical extrema. Work is
 * shared across every lane and bounded independently of duration and rate.
 */
export function sampleHandAnimationDisplay(value = HAND_DEFAULTS, options = {}) {
  const config = value && typeof value === 'object' ? value : HAND_DEFAULTS;
  const settings = options && typeof options === 'object' ? options : {};
  const nativePeriod = handMotionPeriod(config.motion);
  const period = clampHand(settings.period, 1e-6, 1e6, nativePeriod);
  const startTime = clampHand(settings.startTime, 0, 1e9 - period, 0);
  const tremorOffset = clampHand(settings.tremorOffset, -1e9, 1e9, 0);
  const columns = Math.round(clampHand(settings.columns, 1, HAND_ANIMATION_DISPLAY_MAX_COLUMNS, 128));
  const flat = [];
  const lanes = handAnimationLanes(config.form).map(({ index, keys }) => {
    const curves = {};
    for (const joint of keys) {
      const curve = {
        values: new Float64Array(columns + 1),
        min: new Float64Array(columns).fill(Infinity),
        max: new Float64Array(columns).fill(-Infinity),
      };
      curves[joint] = curve;
      flat.push({ index, joint, ...curve });
    }
    return { index, keys: [...keys], curves };
  });
  const density = Math.max(64 / nativePeriod, fastestTremor(config) * 12);
  const available = Math.floor((HAND_ANIMATION_DISPLAY_MAX_SAMPLES - columns - 1) / columns);
  const interiors = Math.min(available, Math.max(2, Math.ceil(period / columns * density)));
  const pose = createHandPose();
  let samples = 0;
  function evaluate(time) {
    evaluateHandPose(config, time, pose, time + tremorOffset);
    samples++;
  }
  for (let column = 0; column <= columns; column++) {
    evaluate(startTime + period * column / columns);
    for (const curve of flat) {
      const current = handAnimationValue(pose, curve.index, curve.joint);
      curve.values[column] = current;
      if (column > 0) {
        curve.min[column - 1] = Math.min(curve.min[column - 1], current);
        curve.max[column - 1] = Math.max(curve.max[column - 1], current);
      }
      if (column < columns) {
        curve.min[column] = current;
        curve.max[column] = current;
      }
    }
  }
  for (let column = 0; column < columns; column++) {
    for (let sample = 0; sample < interiors; sample++) {
      const fraction = (sample + jitter(column, sample)) / interiors;
      evaluate(startTime + period * (column + fraction) / columns);
      for (const curve of flat) {
        const current = handAnimationValue(pose, curve.index, curve.joint);
        curve.min[column] = Math.min(curve.min[column], current);
        curve.max[column] = Math.max(curve.max[column], current);
      }
    }
  }
  return { startTime, period, tremorOffset, columns, samples, lanes };
}
