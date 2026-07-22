const DEFAULT_SAMPLE_RATE = 48_000;

export function clampMicValue(value, low, high, fallback = low) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
}

export function micBranchPlaybackRate(pitchValue, octaves = 2, trunkRate = 1) {
  const pitch = clampMicValue(pitchValue, -4, 4, 0);
  const span = clampMicValue(octaves, 0, 8, 2);
  const root = clampMicValue(trunkRate, 0.25, 4, 1);
  return clampMicValue(root * (2 ** (pitch * span)), 0.25, 4, 1);
}

export function sanitizeMicBranchVoice(voice, index = 0) {
  return {
    key: typeof voice?.key === "string" ? voice.key : `branch:${index}`,
    rate: clampMicValue(voice?.rate, 0.25, 4, 1),
    gain: clampMicValue(voice?.gain, 0, 1, 0),
    pan: clampMicValue(voice?.pan, -1, 1, 0),
    depth: clampMicValue(voice?.depth, 0, 64, 0),
    sourceKey: typeof voice?.sourceKey === "string" ? voice.sourceKey : "base",
    bounceKey: typeof voice?.bounceKey === "string" ? voice.bounceKey : null,
  };
}

function hashUnit(key) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

/**
 * One rolling recorder and granular resampler for every L-system branch.
 * Branches are plain records in this renderer, not Web Audio graph nodes.
 */
export class MicBranchDSP {
  constructor({ sampleRate = DEFAULT_SAMPLE_RATE, historySeconds = 6, maxVoices = 1024, maxBounces = 96 } = {}) {
    this.sampleRate = clampMicValue(sampleRate, 8_000, 192_000, DEFAULT_SAMPLE_RATE);
    this.historyLength = Math.max(2048, Math.ceil(
      clampMicValue(historySeconds, 1, 20, 6) * this.sampleRate,
    ));
    this.history = new Float32Array(this.historyLength);
    this.maxVoices = Math.max(1, Math.floor(clampMicValue(maxVoices, 1, 4096, 1024)));
    this.runtimeLimit = this.maxVoices;
    this.activeTargetCount = 0;
    this.grainSamples = Math.max(256, Math.round(this.sampleRate * 0.12));
    this.bounceLength = Math.max(this.grainSamples * 3, Math.round(this.sampleRate * 1.25));
    this.maxBounces = Math.max(4, Math.floor(clampMicValue(maxBounces, 4, 256, 96)));
    this.writeIndex = 0;
    this.recordedSamples = 0;
    this.feedback = 0.32;
    this.lastWet = 0;
    this.voices = new Map();
    this.bounces = new Map();
    this.bounceClock = 0;
  }

  setFeedback(value) {
    this.feedback = clampMicValue(value, 0, 0.82, 0.32);
  }

  setVoices(specs, voiceLimit = this.runtimeLimit) {
    this.runtimeLimit = Math.max(0, Math.min(
      this.maxVoices,
      Math.floor(clampMicValue(voiceLimit, 0, this.maxVoices, this.runtimeLimit)),
    ));
    const next = new Map();
    const source = Array.isArray(specs) ? specs.slice(0, this.runtimeLimit) : [];
    source.forEach((candidate, index) => {
      const spec = sanitizeMicBranchVoice(candidate, index);
      const previous = this.voices.get(spec.key);
      next.set(spec.key, previous
        ? { ...previous, target: spec, releasing: false }
        : {
          target: spec,
          rate: spec.rate,
          gain: 0,
          pan: spec.pan,
          phase: hashUnit(spec.key),
          releasing: false,
        });
    });
    for (const [key, previous] of this.voices) {
      if (next.has(key)) continue;
      const releaseAllowance = Math.min(64, Math.ceil(this.runtimeLimit * 0.125));
      if (next.size >= Math.min(this.maxVoices, this.runtimeLimit + releaseAllowance)) break;
      next.set(key, {
        ...previous,
        target: { ...previous.target, gain: 0 },
        releasing: true,
      });
    }
    this.voices = next;
    this.activeTargetCount = source.length;
    this.prepareBounceHistories();
  }

  prepareBounceHistories() {
    const sourceKeys = new Set();
    const writeKeys = new Set();
    for (const voice of this.voices.values()) {
      if (voice.target.sourceKey !== "base") sourceKeys.add(voice.target.sourceKey);
      if (voice.target.bounceKey) writeKeys.add(voice.target.bounceKey);
    }
    const required = new Set([...sourceKeys, ...writeKeys].slice(0, this.maxBounces));
    for (const key of [...this.bounces.keys()]) {
      if (!required.has(key)) this.bounces.delete(key);
    }
    for (const key of required) {
      let bounce = this.bounces.get(key);
      if (!bounce) {
        bounce = {
          data: new Float32Array(this.bounceLength),
          writeIndex: 0,
          recordedSamples: 0,
          touched: 0,
          mix: 0,
        };
        this.bounces.set(key, bounce);
      }
      bounce.touched = ++this.bounceClock;
    }
  }

  readHistory(position, history = this.history) {
    const floor = Math.floor(position);
    const fraction = position - floor;
    const length = history.length;
    const leftIndex = ((floor % length) + length) % length;
    const rightIndex = (leftIndex + 1) % length;
    return history[leftIndex] * (1 - fraction) + history[rightIndex] * fraction;
  }

  grainSample(voice, age01, writePosition) {
    const ageSamples = age01 * this.grainSamples;
    const bounce = voice.target.sourceKey === "base"
      ? null
      : this.bounces.get(voice.target.sourceKey);
    if (bounce && bounce.recordedSamples >= this.grainSamples * 1.5) {
      const available = Math.min(bounce.recordedSamples, bounce.data.length);
      const sourceSpan = Math.min(available - 2, this.grainSamples * Math.max(1, voice.rate));
      const readPosition = bounce.writeIndex - sourceSpan + ageSamples * voice.rate;
      return this.readHistory(readPosition, bounce.data);
    }
    const rateHeadroom = Math.max(0, voice.rate - 1) * this.grainSamples;
    const depthDelay = voice.target.depth * this.sampleRate * 0.018;
    const delay = this.sampleRate * 0.14 + rateHeadroom + depthDelay;
    if (this.recordedSamples < delay + this.grainSamples) return 0;
    const readPosition = writePosition - delay + ageSamples * (voice.rate - 1);
    return this.readHistory(readPosition, this.history);
  }

  process(inputLeft, inputRight, outputLeft, outputRight) {
    const frames = outputLeft.length;
    const gainSmoothing = 1 - Math.exp(-1 / (this.sampleRate * 0.012));
    const parameterSmoothing = 1 - Math.exp(-1 / (this.sampleRate * 0.025));

    for (let frame = 0; frame < frames; frame += 1) {
      for (const bounce of this.bounces.values()) bounce.mix = 0;
      const micLeft = inputLeft?.[frame] ?? 0;
      const micRight = inputRight?.[frame] ?? micLeft;
      const mic = (micLeft + micRight) * 0.5;
      const recorded = Math.tanh(mic + this.lastWet * this.feedback);
      this.history[this.writeIndex] = recorded;
      const writePosition = this.writeIndex;
      this.writeIndex = (this.writeIndex + 1) % this.historyLength;
      this.recordedSamples = Math.min(this.historyLength, this.recordedSamples + 1);

      let wetLeft = 0;
      let wetRight = 0;
      for (const voice of this.voices.values()) {
        voice.gain += (voice.target.gain - voice.gain) * gainSmoothing;
        voice.pan += (voice.target.pan - voice.pan) * parameterSmoothing;
        voice.rate += (voice.target.rate - voice.rate) * parameterSmoothing;
        voice.phase += 1 / this.grainSamples;
        if (voice.phase >= 1) voice.phase -= 1;

        const phaseA = voice.phase;
        const phaseB = (voice.phase + 0.5) % 1;
        const windowA = Math.sin(Math.PI * phaseA) ** 2;
        const windowB = Math.sin(Math.PI * phaseB) ** 2;
        const sample = (
          this.grainSample(voice, phaseA, writePosition) * windowA
          + this.grainSample(voice, phaseB, writePosition) * windowB
        ) / Math.max(0.5, windowA + windowB);
        const leftPan = Math.sqrt((1 - voice.pan) * 0.5);
        const rightPan = Math.sqrt((1 + voice.pan) * 0.5);
        wetLeft += sample * voice.gain * leftPan;
        wetRight += sample * voice.gain * rightPan;
        if (voice.target.bounceKey) {
          const bounce = this.bounces.get(voice.target.bounceKey);
          if (bounce) bounce.mix += sample * voice.gain;
        }
      }

      for (const bounce of this.bounces.values()) {
        if (bounce.mix === 0) continue;
        bounce.data[bounce.writeIndex] = Math.tanh(bounce.mix);
        bounce.writeIndex = (bounce.writeIndex + 1) % bounce.data.length;
        bounce.recordedSamples = Math.min(bounce.data.length, bounce.recordedSamples + 1);
      }

      outputLeft[frame] = Math.tanh(wetLeft);
      outputRight[frame] = Math.tanh(wetRight);
      this.lastWet = (outputLeft[frame] + outputRight[frame]) * 0.5;
    }
    for (const [key, voice] of this.voices) {
      if (voice.releasing && voice.gain < 0.0001) this.voices.delete(key);
    }
    return true;
  }
}
