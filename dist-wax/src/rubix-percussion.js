import { LinearDrumAudio, LINEAR_DRUM_DEFAULTS } from "./linear-drums.js";

export const RUBIX_EXTRA_KITS = Object.freeze({
  rattlesnake: Object.freeze({ model: "hybrid", decay: 0.42 }),
  "pitched-morph": Object.freeze({
    model: "pitched", decay: 0.48, pitchedOrder: ["marimba", "xylophone", "kalimba"],
  }),
  "karplus-strong": Object.freeze({ model: "karplus-strong", decay: 0.38 }),
});

/**
 * Render the existing Rattlesnake/Karplus engine once per voice, never on the
 * real-time scheduler. Rubix owns the context, gain, visibility and transport.
 */
export async function renderRubixExtraDrum(context, voice, bankId) {
  const engine = new LinearDrumAudio({});
  engine.context = context;
  engine.input = context.destination;
  engine.start = async () => context;
  engine.noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const noise = engine.noiseBuffer.getChannelData(0);
  let seed = 0x72ab91;
  for (let index = 0; index < noise.length; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    noise[index] = seed / 0x80000000 - 1;
  }
  await engine.trigger(voice.frequency, {
    ...LINEAR_DRUM_DEFAULTS,
    ...RUBIX_EXTRA_KITS[bankId],
    brightness: voice.tone,
    // Short, bounded strings rather than the long standalone instrument tails.
    karplusMorphOrder: ["muted", "nylon", "kalimba", "rubber"],
  }, { startAt: 0, velocity: 0.9, preserveDuration: true });
  return context.startRendering();
}

/** Match attack energy between kits without boosting quiet perspective gates. */
export function normalizeRubixDrumBuffer(buffer) {
  let energy = 0;
  let peak = 0;
  const frames = Math.min(buffer.length, Math.round(buffer.sampleRate * 0.12));
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index += 1) {
      if (!Number.isFinite(samples[index])) samples[index] = 0;
      peak = Math.max(peak, Math.abs(samples[index]));
      if (index < frames) energy += samples[index] ** 2;
    }
  }
  const rms = Math.sqrt(energy / Math.max(1, frames * buffer.numberOfChannels));
  const gain = Math.min(8, 0.12 / Math.max(1e-6, rms), 0.65 / Math.max(1e-6, peak));
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    const fadeFrames = Math.min(samples.length, Math.round(buffer.sampleRate * 0.025));
    for (let index = 0; index < samples.length; index += 1) {
      const fade = Math.min(1, (samples.length - 1 - index) / fadeFrames);
      samples[index] *= gain * fade;
    }
  }
  return buffer;
}

/** Discard baked trailing silence so silent six-face scores stay inexpensive. */
export function trimRubixDrumBuffer(context, buffer) {
  let last = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = samples.length - 1; index > last; index -= 1) {
      if (Math.abs(samples[index]) > 1e-5) { last = index; break; }
    }
  }
  const frames = Math.min(buffer.length, Math.max(
    Math.ceil(buffer.sampleRate * 0.06), last + Math.ceil(buffer.sampleRate * 0.025),
  ));
  if (frames === buffer.length) return buffer;
  const trimmed = context.createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    trimmed.getChannelData(channel).set(buffer.getChannelData(channel).subarray(0, frames));
  }
  return trimmed;
}
