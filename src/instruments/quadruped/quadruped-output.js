import { QUADRUPED_LIMITS } from "./quadruped.js";

// Calibration follows the existing compressor so it raises the complete
// instrument without changing the compressor's response or the user's level.
export const QUADRUPED_OUTPUT_MAKEUP = 4;
export const QUADRUPED_OUTPUT_CEILING = 0.89;
const LINEAR_KNEE = 0.72;
const SOFT_CEILING = 0.84;
const HEADROOM = 8;
let protectionCurve;
let guardCurve;

export function protectQuadrupedSample(value) {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  if (magnitude <= LINEAR_KNEE) return value;
  const range = SOFT_CEILING - LINEAR_KNEE;
  return Math.sign(value) * (LINEAR_KNEE + range * Math.tanh((magnitude - LINEAR_KNEE) / range));
}

export function guardQuadrupedSample(value) {
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) <= SOFT_CEILING) return value;
  const range = QUADRUPED_OUTPUT_CEILING - SOFT_CEILING;
  return Math.sign(value) * (SOFT_CEILING + range * Math.tanh((Math.abs(value) - SOFT_CEILING) / range));
}

/** Connect compressor -> input and output -> analyser. The native master gain
 * remains available for the instrument's existing smoothed level changes. */
export function createQuadrupedOutput(context, { outputLevel = 0.62 } = {}) {
  protectionCurve ??= Float32Array.from({ length: 32769 }, (_, index) => (
    protectQuadrupedSample((index / 32768 * 2 - 1) * HEADROOM)
  ));
  guardCurve ??= Float32Array.from({ length: 8193 }, (_, index) => (
    guardQuadrupedSample(index / 8192 * 2 - 1)
  ));
  const input = context.createGain();
  input.gain.value = QUADRUPED_OUTPUT_MAKEUP;
  const masterGain = context.createGain();
  const level = Number(outputLevel);
  masterGain.gain.value = Number.isFinite(level)
    ? Math.min(QUADRUPED_LIMITS.outputLevel[1], Math.max(0, level)) : 0;
  const headroom = context.createGain();
  headroom.gain.value = 1 / HEADROOM;
  const protection = context.createWaveShaper();
  protection.curve = protectionCurve;
  protection.oversample = "2x";
  const output = context.createWaveShaper();
  output.curve = guardCurve;
  // Oversampling reconstruction can overshoot a shaper's curve. This final
  // guard bounds reconstructed samples while staying linear in normal use.
  output.oversample = "none";
  input.connect(masterGain);
  masterGain.connect(headroom);
  headroom.connect(protection);
  protection.connect(output);
  let disconnected = false;
  return {
    input,
    masterGain,
    output,
    disconnect() {
      if (disconnected) return;
      disconnected = true;
      for (const node of [input, masterGain, headroom, protection, output]) node.disconnect();
    },
  };
}
