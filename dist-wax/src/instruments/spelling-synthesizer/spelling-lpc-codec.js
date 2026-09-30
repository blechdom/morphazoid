// Original LPC analysis/quantization helpers. No TI ROM tables or chip code.
export const LPC_RATE = 8000;
export const LPC_FRAME = 200;
export const LPC_ORDER = 10;
export const LPC_BITS = Object.freeze([5, 5, 4, 4, 4, 4, 4, 3, 3, 3]);
export const bounded = (x, lo, hi, fallback = lo) => Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Number(x))) : fallback;
export function reflectionValue(index, order) {
  const count = 2 ** LPC_BITS[order];
  // Finer spacing near +/-1, where low speech resonances need most precision.
  const centred = bounded(index, 0, count - 1) - count / 2;
  return order < 2 ? .985 * Math.sin(centred / (count / 2) * Math.PI / 2)
    : bounded(centred * (order < 7 ? .12 : .18), -.96, .96);
}
export function reflectionIndex(value, order) {
  let best = 0, error = Infinity;
  for (let i = 0; i < 2 ** LPC_BITS[order]; i++) {
    const next = Math.abs(reflectionValue(i, order) - value);
    if (next < error) { best = i; error = next; }
  }
  return best;
}
export const energyValue = index => index <= 0 ? 0 : .001 * 1.48 ** (bounded(index, 1, 15) - 1);
export function energyIndex(value) {
  if (!(value > .0005)) return 0;
  return Math.round(bounded(1 + Math.log(value / .001) / Math.log(1.48), 1, 15));
}
export const pitchValue = index => index <= 0 ? 0 : Math.round(20 * (120 / 20) ** ((bounded(index, 1, 31) - 1) / 30));
export function pitchIndex(period) {
  return period > 0 ? Math.round(bounded(1 + 30 * Math.log(period / 20) / Math.log(6), 1, 31)) : 0;
}

// Autocorrelation / Levinson-Durbin, with bandwidth expansion and stability caps.
// Build-time only: the realtime synthesizer consumes the resulting small atlas.
export function analyseLpcFrame(samples) {
  const n = samples.length, window = new Float64Array(n), r = new Float64Array(11);
  let weight = 0;
  for (let i = 0; i < n; i++) {
    const w = .54 - .46 * Math.cos(2 * Math.PI * i / Math.max(1, n - 1));
    window[i] = (samples[i] - .9 * (i ? samples[i - 1] : 0)) * w;
    weight += w * w;
  }
  for (let lag = 0; lag <= LPC_ORDER; lag++) {
    for (let i = lag; i < n; i++) r[lag] += window[i] * window[i - lag];
    r[lag] = r[lag] / Math.max(1, weight) * .997 ** lag;
  }
  const a = new Float64Array(11), old = new Float64Array(11), k = [];
  a[0] = 1;
  let error = Math.max(1e-12, r[0]);
  for (let m = 1; m <= LPC_ORDER; m++) {
    let sum = r[m];
    for (let j = 1; j < m; j++) sum += a[j] * r[m-j];
    const reflection = bounded(-sum / error, -.985, .985);
    old.set(a); a[m] = reflection;
    for (let j = 1; j < m; j++) a[j] = old[j] + reflection * old[m-j];
    error = Math.max(1e-12, error * (1 - reflection * reflection));
    k.push(reflectionIndex(reflection, m - 1));
  }
  // Pitch comes from the un-preemphasized waveform, not the whitened residual.
  let best = 0, period = 0;
  for (let lag = 20; lag <= Math.min(120, n / 2); lag++) {
    let cross = 0, left = 0, right = 0;
    for (let i = lag; i < n; i++) { cross += samples[i] * samples[i-lag]; left += samples[i] ** 2; right += samples[i-lag] ** 2; }
    const score = cross / Math.sqrt(Math.max(1e-16, left * right));
    if (score > best) { best = score; period = lag; }
  }
  return [energyIndex(Math.sqrt(error)), best > .45 ? pitchIndex(period) : 0, ...k];
}
