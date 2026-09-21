import { VoicePool } from "../../src/audio.js";

// A recording Web Audio facade for the real VoicePool.strike scheduling code.
// It is not a browser or a model of compression, devices or scheduling latency.
function parameter(value = 0) {
  return {
    value, calls: [],
    setValueAtTime(...args) { this.calls.push(["value", ...args]); },
    linearRampToValueAtTime(...args) { this.calls.push(["linear", ...args]); },
    exponentialRampToValueAtTime(...args) { this.calls.push(["exponential", ...args]); },
    setTargetAtTime(...args) { this.calls.push(["target", ...args]); },
    cancelScheduledValues(...args) { this.calls.push(["cancel", ...args]); },
    cancelAndHoldAtTime(...args) { this.calls.push(["hold", ...args]); },
  };
}
const node = extra => ({ ...extra, connect() { return this; }, disconnect() {} });

export function recordNativeStrike({ envelopePoints, attackNoise = 0, attackCurve, frequency = 220, gain = 0.5, sampleRate = 48000 }) {
  const pool = new VoicePool(0);
  const context = {
    currentTime: 0,
    sampleRate,
    createOscillator() {
      return node({ frequency: parameter(frequency), startTime: null, stopTime: null,
        start(time) { this.startTime = time; }, stop(time) { this.stopTime = time; } });
    },
    createGain() { return node({ gain: parameter() }); },
    createStereoPanner() { return node({ pan: parameter() }); },
    createBufferSource() { return node({ buffer: null, start() {}, stop() {} }); },
  };
  pool.context = context;
  pool.master = node({});
  pool.enabled = true;
  let seed = 0x54cafe12;
  const noise = Float32Array.from({ length: Math.ceil(sampleRate * 0.04) }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x80000000 - 1;
  });
  pool.attackNoiseBuffer = { getChannelData: () => noise };
  const accepted = pool.strike({ key: "reference", frequency, gain, pan: 0, waveform: "sine" },
    { envelopePoints, attackNoise, ...(attackCurve ? { attackCurve } : {}) });
  if (!accepted) throw new Error("Reference strike was rejected");
  const strike = [...pool.activeStrikes][0];
  return { pool, context, strike, sampleRate, frequency, noise };
}

export function scheduledEnvelopeAt(calls, time) {
  let lastTime = 0, lastValue = 0;
  for (const [kind, value, at] of calls) {
    if (!["value", "linear", "exponential"].includes(kind)) {
      throw new Error(`Reference envelope cannot claim to simulate ${kind}`);
    }
    if (at > time) {
      if (kind === "value" || at === lastTime) return lastValue;
      const progress = Math.max(0, (time - lastTime) / (at - lastTime));
      return kind === "linear"
        ? lastValue + (value - lastValue) * progress
        : lastValue * (value / lastValue) ** progress;
    }
    lastTime = at;
    lastValue = value;
  }
  return lastValue;
}

export function renderNativeStrikeReference(options) {
  const recorded = recordNativeStrike(options);
  const { strike, sampleRate, frequency, noise } = recorded;
  const samples = new Float32Array(Math.ceil((strike.endedAt + 0.02) * sampleRate));
  let maxStep = 0, peak = 0, energy = 0, envelopeSlope = 0, previousEnvelope = 0;
  let ten = null, ninety = null;
  const target = scheduledEnvelopeAt(strike.gain.gain.calls, strike.attackEndsAt);
  for (let frame = 0; frame < samples.length; frame++) {
    const time = frame / sampleRate;
    const envelope = scheduledEnvelopeAt(strike.gain.gain.calls, time);
    const noiseLevel = strike.noiseGain ? scheduledEnvelopeAt(strike.noiseGain.gain.calls, time) : 0;
    samples[frame] = Math.sin(Math.PI * 2 * frequency * time) * envelope
      + (noise[frame] ?? 0) * noiseLevel;
    if (time <= strike.attackEndsAt) {
      envelopeSlope = Math.max(envelopeSlope, (envelope - previousEnvelope) * sampleRate / target);
      if (ten === null && envelope >= target * 0.1) ten = time;
      if (ninety === null && envelope >= target * 0.9) ninety = time;
    }
    previousEnvelope = envelope;
    if (frame) maxStep = Math.max(maxStep, Math.abs(samples[frame] - samples[frame - 1]));
    peak = Math.max(peak, Math.abs(samples[frame]));
    energy += samples[frame] ** 2;
  }
  return {
    ...recorded, samples,
    summary: {
      sampleRate, frequency, peak, rms: Math.sqrt(energy / samples.length), maxStep,
      attackMs: strike.attackEndsAt * 1000,
      rise10To90Ms: ten !== null && ninety !== null ? (ninety - ten) * 1000 : null,
      maximumNormalizedAttackSlope: envelopeSlope,
      noisePeak: strike.noiseGain ? Math.max(...strike.noiseGain.gain.calls.map(([, value]) => value)) : 0,
    },
  };
}
