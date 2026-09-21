// Offline model evidence, not a browser recording or a human listening verdict.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deriveCascadeStack as deriveFm } from "../../src/cascading-fm.js";
import { deriveCascadeStack as derivePm } from "../../src/cascading-pm.js";

const TAU = Math.PI * 2;
const root = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The FM reference follows the page's sine -> next frequency wiring. PM uses
 * its model's bounded radian indices. No limiter, EQ, envelope, tempo gate or
 * gain modulation is added; only the final operator is returned.
 */
export function renderCascadeReference(kind, settings, {
  sampleRate = 48000, seconds = 12, phaseOffset = 0,
} = {}) {
  if (!["fm", "pm"].includes(kind)) throw new TypeError("Use fm or pm");
  if (!(sampleRate >= 8000 && sampleRate <= 96000 && seconds > 0 && seconds <= 30)) {
    throw new RangeError("Bounded offline rendering requires 8–96 kHz and at most 30 seconds");
  }
  const stack = (kind === "fm" ? deriveFm : derivePm)(settings, { sampleRate });
  const count = stack.oscillators.length;
  const phases = Float64Array.from({ length: count }, (_, i) => (phaseOffset * (i + 1)) % TAU);
  const outputs = new Float64Array(count);
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let frame = 0; frame < samples.length; frame++) {
    for (let stage = 0; stage < count; stage++) {
      const phaseMod = kind === "pm" && stage > 0
        ? outputs[stage - 1] * stack.connections[stage - 1].phaseIndex : 0;
      outputs[stage] = Math.sin(phases[stage] + phaseMod);
    }
    samples[frame] = outputs[count - 1];
    for (let stage = 0; stage < count; stage++) {
      const frequencyMod = kind === "fm" && stage > 0
        ? outputs[stage - 1] * stack.connections[stage - 1].depthHz : 0;
      const next = phases[stage] + TAU * (stack.oscillators[stage].freq + frequencyMod) / sampleRate;
      phases[stage] = next - Math.floor(next / TAU) * TAU;
    }
  }
  return { samples, stack, sampleRate };
}

const quantile = (sorted, p) => sorted[Math.floor(p * (sorted.length - 1))];

/** 50 ms amplitude and spectral-activity traces, with no beat-grid assumption. */
export function summarizeCascadeRhythm(samples, sampleRate) {
  const window = Math.round(sampleRate * 0.05);
  const amplitude = [], activity = [];
  let peak = 0, sumSquares = 0, maximumStep = 0;
  for (let start = 0; start + window <= samples.length; start += window) {
    let power = 0, differencePower = 0;
    for (let i = start; i < start + window; i++) {
      const value = samples[i];
      if (!Number.isFinite(value)) throw new Error("Non-finite audio sample");
      power += value * value;
      peak = Math.max(peak, Math.abs(value));
      if (i > 0) {
        const difference = value - samples[i - 1];
        differencePower += difference * difference;
        maximumStep = Math.max(maximumStep, Math.abs(difference));
      }
    }
    sumSquares += power;
    amplitude.push(Math.sqrt(power / window));
    activity.push(Math.sqrt(differencePower / window));
  }
  const orderedAmplitude = [...amplitude].sort((a, b) => a - b);
  const orderedActivity = [...activity].sort((a, b) => a - b);
  const meanActivity = activity.reduce((sum, value) => sum + value, 0) / activity.length;
  const seconds = [];
  for (let i = 0; i < activity.length; i += 20) {
    const frame = activity.slice(i, i + 20);
    seconds.push(frame.reduce((sum, value) => sum + value, 0) / frame.length);
  }
  const threshold = quantile(orderedActivity, 0.65);
  const accents = [];
  for (let i = 1; i < activity.length - 1; i++) {
    if (activity[i] > threshold && activity[i] > activity[i - 1] && activity[i] >= activity[i + 1]
      && (!accents.length || i * 0.05 - accents.at(-1) >= 0.15)) accents.push(i * 0.05);
  }
  const intervals = accents.slice(1).map((time, i) => time - accents[i]);
  return {
    peak, rms: Math.sqrt(sumSquares / (amplitude.length * window)), maximumStep,
    amplitudeContrastDb: 20 * Math.log10(quantile(orderedAmplitude, 0.9) / Math.max(1e-12, quantile(orderedAmplitude, 0.1))),
    activityContrast: quantile(orderedActivity, 0.9) / Math.max(1e-12, quantile(orderedActivity, 0.1)),
    slowActivitySpread: (Math.max(...seconds) - Math.min(...seconds)) / Math.max(1e-12, meanActivity),
    activityEquivalentHz: meanActivity / Math.max(1e-12, Math.sqrt(sumSquares / (amplitude.length * window))) * sampleRate / TAU,
    accentCount: accents.length,
    // This indicates unequal model accents, not proof of musical syncopation.
    accentIntervalKinds: new Set(intervals.map(interval => Math.round(interval / 0.05))).size,
  };
}

/** Hann-window FFT over evenly spaced slices to inspect brightness over time. */
export function spectrumOfCascade(samples, sampleRate, windows = 6) {
  const n = 32768;
  if (samples.length < n) throw new Error("Need at least 32768 samples");
  let energy = 0, above2k = 0, above5k = 0, maxRolloff = 0;
  for (let slice = 0; slice < windows; slice++) {
    const start = Math.floor((samples.length - n) * slice / Math.max(1, windows - 1));
    const real = new Float64Array(n), imaginary = new Float64Array(n);
    for (let i = 0; i < n; i++) real[i] = samples[start + i] * (0.5 - 0.5 * Math.cos(TAU * i / (n - 1)));
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      while (j & bit) { j ^= bit; bit >>= 1; }
      j ^= bit;
      if (i < j) [real[i], real[j]] = [real[j], real[i]];
    }
    for (let length = 2; length <= n; length <<= 1) {
      const stepReal = Math.cos(-TAU / length), stepImag = Math.sin(-TAU / length);
      for (let offset = 0; offset < n; offset += length) {
        let wr = 1, wi = 0;
        for (let i = 0; i < length / 2; i++) {
          const even = offset + i, odd = even + length / 2;
          const r = real[odd] * wr - imaginary[odd] * wi;
          const im = real[odd] * wi + imaginary[odd] * wr;
          real[odd] = real[even] - r; imaginary[odd] = imaginary[even] - im;
          real[even] += r; imaginary[even] += im;
          const next = wr * stepReal - wi * stepImag;
          wi = wr * stepImag + wi * stepReal; wr = next;
        }
      }
    }
    const powers = new Float64Array(n / 2);
    let total = 0;
    for (let bin = 1; bin < n / 2; bin++) {
      const power = real[bin] ** 2 + imaginary[bin] ** 2;
      powers[bin] = power; total += power;
      if (bin * sampleRate / n >= 2000) above2k += power;
      if (bin * sampleRate / n >= 5000) above5k += power;
    }
    energy += total;
    let cumulative = 0;
    for (let bin = 1; bin < n / 2; bin++) {
      cumulative += powers[bin];
      if (cumulative >= total * 0.99) {
        maxRolloff = Math.max(maxRolloff, bin * sampleRate / n); break;
      }
    }
  }
  return { highEnergyAbove2k: above2k / energy, highEnergyAbove5k: above5k / energy, maximumRolloff99Hz: maxRolloff };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { CASCADING_FM_FULL_PRESETS, CASCADING_PM_FULL_PRESETS } = await import("../../src/families/cascading/full-presets.js");
  const output = path.resolve(root, process.argv[2] ?? "test-results/cascade-rhythm");
  const report = {
    note: "Offline sine-chain references only; not browser recordings, compressor models, or listening approval.",
    node: process.version, sampleRate: 48000, seconds: 12,
    phaseOffsets: [0, 0.37, 1.1], fftWindowsPerRender: 6,
    spectrumScope: "Evenly spaced Hann-window slices, not exhaustive continuous-time bandwidth proof.",
    presets: [],
  };
  for (const [kind, bank] of [["fm", CASCADING_FM_FULL_PRESETS], ["pm", CASCADING_PM_FULL_PRESETS]]) {
    for (const preset of bank) {
      const runs = [0, 0.37, 1.1].map(phaseOffset => {
        const { samples, stack } = renderCascadeReference(kind, preset.snapshot.settings, { phaseOffset });
        return { phaseOffset, ...summarizeCascadeRhythm(samples, 48000), ...spectrumOfCascade(samples, 48000),
          estimatedPreCompressorPeak: preset.snapshot.level * stack.normalizedGain,
          ratesHz: stack.oscillators.map(oscillator => oscillator.freq) };
      });
      report.presets.push({ kind, id: preset.id, label: preset.label, settings: preset.snapshot.settings, level: preset.snapshot.level, runs });
      console.log(kind, preset.id, "activity", runs.map(run => run.activityContrast.toFixed(2)).join("/"),
        "rolloff", Math.max(...runs.map(run => run.maximumRolloff99Hz)).toFixed(0));
    }
  }
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "analysis.json"), JSON.stringify(report, null, 2) + "\n");
}
