import { presetStateKey } from "../../site/header-presets.js";

/**
 * Audio-worklet engines report state asynchronously. Resolve once the captured
 * state equals the recalled one; reject if the engine never confirms it.
 */
export function settleOnCapture(capture, expected, {
  timeoutMs = 2000, intervalMs = 16, wait = (fn, ms) => setTimeout(fn, ms), now = () => Date.now(),
} = {}) {
  const key = presetStateKey(expected);
  const matches = () => { try { return presetStateKey(capture()) === key; } catch { return false; } };
  if (matches()) return undefined;
  const started = now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (matches()) resolve();
      else if (now() - started >= timeoutMs) reject(new Error("The audio engine did not confirm the preset"));
      else wait(poll, intervalMs);
    };
    wait(poll, intervalMs);
  });
}

export const clampNumber = (value, low, high, fallback = low) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
};
export const roundTo = (value, digits = 2) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
