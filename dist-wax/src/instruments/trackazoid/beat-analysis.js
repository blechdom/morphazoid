// Original, bounded constant-tempo estimator. Onset autocorrelation follows the
// general approach described by Ellis, not a port of his implementation:
// https://www.ee.columbia.edu/~dpwe/LabROSA/matlab/beat_simple/
// This estimates a pulse and phase, not musical meter or the first bar downbeat.
export const BEAT_ANALYSIS_VERSION = 1;
export const ANALYSIS_LIMITS = Object.freeze({ windows: 3, windowSeconds: 24, sampleRate: 12000, channels: 2, minSeconds: 6 });
const HOP_SECONDS = 0.01;
const MIN_BPM = 40;
const MAX_BPM = 240;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mod = (value, period) => ((value % period) + period) % period;
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

function emptyResult(reason, analyzedSeconds = 0) {
  return { version: BEAT_ANALYSIS_VERSION, status: "unreliable", bpm: null, beatOffset: null, confidence: 0, candidates: [], reason, analyzedSeconds };
}

function onsetEnvelope(window, sampleRate) {
  const channels = window.channels.slice(0, ANALYSIS_LIMITS.channels);
  const length = Math.min(...channels.map(channel => channel.length), Math.floor(sampleRate * ANALYSIS_LIMITS.windowSeconds));
  const hop = Math.max(1, Math.round(sampleRate * HOP_SECONDS));
  const frames = Math.floor(length / hop);
  const bands = [new Float64Array(frames), new Float64Array(frames), new Float64Array(frames)];
  const energy = new Float64Array(frames);
  const lowCoefficient = 1 - Math.exp(-2 * Math.PI * 180 / sampleRate);
  const midCoefficient = 1 - Math.exp(-2 * Math.PI * 1600 / sampleRate);
  for (const channel of channels) {
    let low = 0; let mid = 0;
    for (let frame = 0; frame < frames; frame++) {
      for (let i = frame * hop; i < (frame + 1) * hop; i++) {
        const sample = Number.isFinite(channel[i]) ? clamp(channel[i], -8, 8) : 0;
        low += lowCoefficient * (sample - low);
        mid += midCoefficient * (sample - mid);
        bands[0][frame] += low * low;
        bands[1][frame] += (mid - low) ** 2;
        bands[2][frame] += (sample - mid) ** 2;
        energy[frame] += sample * sample;
      }
    }
  }
  const divisor = hop * channels.length;
  const rms = Math.sqrt(energy.reduce((sum, value) => sum + value, 0) / Math.max(1, frames * divisor));
  // 100 ms blocks reject constant tones, DC and carrier-induced envelope ripple.
  const coarse = [];
  for (let i = 10; i + 10 <= frames; i += 10) {
    let sum = 0;
    for (let j = i; j < i + 10; j++) sum += energy[j];
    coarse.push(Math.sqrt(sum / (10 * divisor)));
  }
  const coarseMean = coarse.reduce((sum, value) => sum + value, 0) / Math.max(1, coarse.length);
  const dynamics = Math.sqrt(coarse.reduce((sum, value) => sum + (value - coarseMean) ** 2, 0) / Math.max(1, coarse.length)) / Math.max(1e-9, coarseMean);
  const envelope = new Float64Array(frames);
  for (let band = 0; band < bands.length; band++) {
    const values = bands[band];
    for (let i = 0; i < frames; i++) values[i] = Math.sqrt(values[i] / divisor);
    // Positive changes across a 30 ms history emphasize attacks over sustain.
    for (let i = 15; i < frames; i++) {
      const previous = (values[i - 1] + values[i - 2] + values[i - 3]) / 3;
      envelope[i] += [1.4, 1, 0.7][band] * Math.max(0, values[i] - previous);
    }
  }
  const maximum = Math.max(...envelope);
  const onsetMean = envelope.reduce((sum, value) => sum + value, 0) / Math.max(1, frames);
  // A sinusoid's carrier or two sustained pitches beating against each other
  // can be periodic without attacks. Require a concentrated, audible attack.
  const hasAttacks = maximum > rms * 0.4 && maximum > onsetMean * 4.5;
  const threshold = Math.max(maximum * 0.12, median(envelope) * 3, rms * 0.025);
  const peaks = [];
  for (let i = 2; i < frames - 2; i++) {
    if (envelope[i] < threshold || envelope[i] < envelope[i - 1] || envelope[i] <= envelope[i + 1]) continue;
    const previous = peaks[peaks.length - 1];
    const peak = { time: window.startTime + i * hop / sampleRate, weight: envelope[i] };
    if (previous && peak.time - previous.time < 0.09) {
      if (peak.weight > previous.weight) peaks[peaks.length - 1] = peak;
    } else peaks.push(peak);
  }
  // Remove the low-level noise floor without turning every detected peak into
  // an equally strong click: accents help distinguish beats from subdivisions.
  const floor = median(envelope) * 1.5;
  for (let i = 0; i < frames; i++) envelope[i] = Math.max(0, envelope[i] - floor);
  return { envelope, peaks, rms, dynamics, hasAttacks, seconds: length / sampleRate, hopSeconds: hop / sampleRate, startTime: window.startTime };
}

function autocorrelation(envelope, maximumLag) {
  const result = new Float64Array(maximumLag + 1);
  const mean = envelope.reduce((sum, value) => sum + value, 0) / envelope.length;
  for (let lag = 1; lag <= maximumLag; lag++) {
    let dot = 0; let left = 0; let right = 0;
    for (let i = lag; i < envelope.length; i++) {
      const a = envelope[i] - mean; const b = envelope[i - lag] - mean;
      dot += a * b; left += a * a; right += b * b;
    }
    result[lag] = Math.max(0, dot / Math.max(1e-20, Math.sqrt(left * right)));
  }
  return result;
}

function at(values, position) {
  const index = Math.floor(position); const fraction = position - index;
  return (values[index] || 0) * (1 - fraction) + (values[index + 1] || 0) * fraction;
}

function fitGrid(bpm, peaks, windows) {
  let period = 60 / bpm;
  const bins = Math.ceil(period / 0.005);
  const histogram = new Float64Array(bins);
  for (const peak of peaks) {
    const center = mod(peak.time, period) / period * bins;
    for (let offset = -4; offset <= 4; offset++) {
      const index = Math.round(center) + offset;
      const distance = (index - center) * period / bins;
      histogram[mod(index, bins)] += peak.weight * Math.exp(-0.5 * (distance / 0.015) ** 2);
    }
  }
  let strongest = 0;
  for (let i = 1; i < bins; i++) if (histogram[i] > histogram[strongest]) strongest = i;
  let phase = strongest / bins * period;
  // Regression of observed attacks onto nearby grid points refines the coarse
  // autocorrelation lag. Absolute window times keep the estimate phase coherent.
  for (let pass = 0; pass < 3; pass++) {
    let weight = 0; let x = 0; let y = 0; let xx = 0; let xy = 0;
    for (const peak of peaks) {
      const beat = Math.round((peak.time - phase) / period);
      if (Math.abs(peak.time - phase - beat * period) > Math.min(0.055, period * 0.13)) continue;
      weight += peak.weight; x += peak.weight * beat; y += peak.weight * peak.time;
      xx += peak.weight * beat * beat; xy += peak.weight * beat * peak.time;
    }
    const denominator = weight * xx - x * x;
    if (denominator <= 1e-9) break;
    const refinedPeriod = (weight * xy - x * y) / denominator;
    if (Math.abs(refinedPeriod / period - 1) > 0.025) break;
    period = clamp(refinedPeriod, 60 / MAX_BPM, 60 / MIN_BPM);
    phase = mod((y - period * x) / weight, period);
  }
  let alignedWeight = 0; let totalWeight = 0; let residual = 0;
  const beats = new Set();
  for (const peak of peaks) {
    const beat = Math.round((peak.time - phase) / period);
    const distance = Math.abs(peak.time - phase - beat * period);
    totalWeight += peak.weight;
    if (distance < Math.min(0.04, period * 0.1)) {
      alignedWeight += peak.weight; residual += peak.weight * distance; beats.add(beat);
    }
  }
  let possibleBeats = 0;
  for (const window of windows) possibleBeats += Math.max(1, (window.peaks.at(-1).time - window.peaks[0].time) / period + 1);
  return { bpm: 60 / period, beatOffset: phase, alignment: alignedWeight / Math.max(totalWeight, 1e-9), coverage: Math.min(1, beats.size / possibleBeats), residual: residual / Math.max(alignedWeight, 1e-9) };
}

/** Analyze up to three bounded PCM windows. Run this pure function in a Worker.
 * Each window has an absolute startTime (seconds) and one/two Float32Array channels.
 * A successful beatOffset is phase modulo 60/bpm, not a semantic bar downbeat.
 * Confidence is a heuristic quality indicator, not a calibrated probability.
 */
export function analyzeBeatWindows({ sampleRate, windows } = {}) {
  if (!Number.isFinite(sampleRate) || sampleRate < 1000 || sampleRate > ANALYSIS_LIMITS.sampleRate || !Array.isArray(windows)) throw new TypeError("Invalid beat-analysis PCM");
  const prepared = windows.slice(0, ANALYSIS_LIMITS.windows).filter(window =>
    Number.isFinite(window?.startTime) && window.startTime >= 0 && Array.isArray(window.channels) && window.channels.length &&
    window.channels.slice(0, ANALYSIS_LIMITS.channels).every(channel => channel instanceof Float32Array && channel.length));
  const sections = prepared.map(window => onsetEnvelope(window, sampleRate));
  const analyzedSeconds = sections.reduce((sum, section) => sum + section.seconds, 0);
  if (!sections.some(section => section.seconds >= ANALYSIS_LIMITS.minSeconds)) return emptyResult("too-short", analyzedSeconds);
  if (!sections.some(section => section.rms > 1e-5)) return emptyResult("silence", analyzedSeconds);
  const active = sections.filter(section => section.seconds >= ANALYSIS_LIMITS.minSeconds && section.rms > 1e-5 && section.dynamics > 0.055 && section.hasAttacks && section.peaks.length >= 6);
  if (!active.length) return emptyResult("no-stable-beat", analyzedSeconds);
  const hop = active[0].hopSeconds;
  const minimumLag = 60 / MAX_BPM / hop;
  const maximumLag = 60 / MIN_BPM / hop;
  for (const section of active) section.correlation = autocorrelation(section.envelope, Math.ceil(maximumLag * 3) + 2);
  const scores = new Float64Array(Math.ceil(maximumLag) + 2);
  const scoreLag = lag => active.reduce((sum, section) => sum + 0.7 * at(section.correlation, lag) + 0.2 * at(section.correlation, lag * 2) + 0.1 * at(section.correlation, lag * 3), 0) / active.length;
  for (let lag = Math.floor(minimumLag) - 1; lag <= Math.ceil(maximumLag) + 1; lag++) scores[lag] = scoreLag(lag);
  const lags = [];
  for (let lag = Math.ceil(minimumLag); lag <= Math.floor(maximumLag); lag++) {
    if (scores[lag] < scores[lag - 1] || scores[lag] < scores[lag + 1]) continue;
    const curvature = scores[lag - 1] - 2 * scores[lag] + scores[lag + 1];
    const adjustment = curvature < -1e-9 ? clamp(0.5 * (scores[lag - 1] - scores[lag + 1]) / curvature, -0.5, 0.5) : 0;
    lags.push({ lag: clamp(lag + adjustment, minimumLag, maximumLag), score: scores[lag] });
  }
  // Include range edges even if the autocorrelation peak is fractionally beyond.
  lags.push({ lag: minimumLag, score: scoreLag(minimumLag) }, { lag: maximumLag, score: scoreLag(maximumLag) });
  lags.sort((a, b) => b.score - a.score);
  const peaks = active.flatMap(section => section.peaks);
  const choices = lags.slice(0, 14).map(({ lag }) => {
    const grid = fitGrid(60 / (lag * hop), peaks, active);
    const periodicity = scoreLag(60 / grid.bpm / hop);
    const consistency = active.filter(section => at(section.correlation, 60 / grid.bpm / hop) >= 0.22).length / active.length;
    const confidence = clamp(periodicity * 0.65 + grid.alignment * 0.2 + grid.coverage * 0.15, 0, 1) * consistency;
    // Small, explicit tie-break preference for common dance tempi; alternate
    // metrical levels remain visible. Signal evidence dominates the prior.
    const ranking = confidence - 0.035 * Math.abs(Math.log2(grid.bpm / 115));
    return { ...grid, periodicity, confidence, consistency, ranking };
  }).sort((a, b) => b.ranking - a.ranking);
  const best = choices[0];
  if (!best || best.periodicity < 0.3 || best.confidence < 0.42 || best.coverage < 0.35 || best.alignment < 0.35 || best.consistency < 0.67) return emptyResult("no-stable-beat", analyzedSeconds);
  const candidates = [];
  for (const choice of choices) {
    if (choice.confidence < best.confidence * 0.65 || candidates.some(candidate => Math.abs(candidate.bpm - choice.bpm) < 1)) continue;
    const bpm = Math.round(choice.bpm * 100) / 100;
    candidates.push({ bpm, beatOffset: mod(Math.round(choice.beatOffset * 10000) / 10000, 60 / bpm), confidence: Math.round(choice.confidence * 1000) / 1000 });
    if (candidates.length === 5) break;
  }
  return { version: BEAT_ANALYSIS_VERSION, status: "ok", ...candidates[0], candidates, reason: null, analyzedSeconds };
}
