const DEFAULT_SAMPLE_RATE = 48_000;

function clamp(value, low, high, fallback = low) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
}

function sanitizeVoice(voice, index) {
  return {
    key: typeof voice?.key === "string" ? voice.key : `generation:${index}`,
    delay: clamp(voice?.delay, 0.000005, 58, 0.2),
    rate: clamp(voice?.rate, 0.125, 8, 1),
    gain: clamp(voice?.gain, 0, 1, 0),
    pan: clamp(voice?.pan, -1, 1, 0),
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

/** A single rolling mic recorder with virtual, pitchable generation taps. */
export class MicmicGenerationDSP {
  constructor({ sampleRate = DEFAULT_SAMPLE_RATE, historySeconds = 60, maxVoices = 64 } = {}) {
    this.sampleRate = clamp(sampleRate, 8_000, 192_000, DEFAULT_SAMPLE_RATE);
    this.history = new Float32Array(Math.ceil(clamp(historySeconds, 4, 64, 60) * this.sampleRate));
    this.maxVoices = Math.max(1, Math.floor(clamp(maxVoices, 1, 128, 64)));
    this.minimumGrainSamples = Math.max(64, Math.round(this.sampleRate * 0.008));
    this.maximumGrainSamples = Math.max(this.minimumGrainSamples, Math.round(this.sampleRate * 0.11));
    this.writeIndex = 0;
    this.recordedSamples = 0;
    this.voices = new Map();
  }

  setVoices(specs) {
    const next = new Map();
    (Array.isArray(specs) ? specs : []).slice(0, this.maxVoices).forEach((candidate, index) => {
      const target = sanitizeVoice(candidate, index);
      const prior = this.voices.get(target.key);
      if (prior) {
        const currentLane = prior.delayFade >= 0.5 ? prior.delayTo : prior.delayFrom;
        const currentDelay = prior.delayValues[currentLane];
        if (Math.abs(target.delay - currentDelay) > 1 / this.sampleRate) {
          const nextLane = 1 - currentLane;
          prior.delayValues[nextLane] = target.delay;
          prior.delayFrom = currentLane;
          prior.delayTo = nextLane;
          prior.delayFade = 0;
        }
        next.set(target.key, { ...prior, target, releasing: false });
      } else {
        next.set(target.key, {
          target,
          gain: 0,
          rate: target.rate,
          pan: target.pan,
          phase: hashUnit(target.key),
          delayValues: [target.delay, target.delay],
          delayFrom: 0,
          delayTo: 0,
          delayFade: 1,
          releasing: false,
        });
      }
    });
    for (const [key, prior] of this.voices) {
      if (next.has(key) || next.size >= this.maxVoices + 16) continue;
      next.set(key, { ...prior, target: { ...prior.target, gain: 0 }, releasing: true });
    }
    this.voices = next;
  }

  read(position) {
    const floor = Math.floor(position);
    const fraction = position - floor;
    const length = this.history.length;
    const left = ((floor % length) + length) % length;
    const right = (left + 1) % length;
    return this.history[left] * (1 - fraction) + this.history[right] * fraction;
  }

  grainLength(voice) {
    // The original 110 ms overlap is intentionally fixed: shortening ordinary
    // descendant grains turns speech into a pitched buzz.
    return this.maximumGrainSamples;
  }

  directDelay(voice, writePosition, delaySeconds) {
    const delaySamples = Math.max(1, delaySeconds * this.sampleRate);
    if (this.recordedSamples < Math.ceil(delaySamples) + 2) return 0;
    return this.read(writePosition - delaySamples);
  }

  grain(voice, age, writePosition, grainSamples, delaySeconds) {
    const ageSamples = age * grainSamples;
    const requestedDelay = delaySeconds * this.sampleRate;
    const rateHeadroom = Math.max(0, voice.rate - 1) * grainSamples;
    const delay = Math.max(grainSamples * 1.25, requestedDelay + rateHeadroom);
    if (this.recordedSamples < delay + grainSamples) return 0;
    return this.read(writePosition - delay + ageSamples * (voice.rate - 1));
  }

  renderAtDelay(voice, writePosition, delaySeconds) {
    const grainSamples = this.grainLength(voice);
    if (Math.abs(voice.rate - 1) < 0.0005) {
      return this.directDelay(voice, writePosition, delaySeconds);
    }
    const otherPhase = (voice.phase + 0.5) % 1;
    const windowA = Math.sin(Math.PI * voice.phase) ** 2;
    const windowB = Math.sin(Math.PI * otherPhase) ** 2;
    return (
      this.grain(voice, voice.phase, writePosition, grainSamples, delaySeconds) * windowA
      + this.grain(voice, otherPhase, writePosition, grainSamples, delaySeconds) * windowB
    ) / Math.max(0.5, windowA + windowB);
  }

  process(inputLeft, inputRight, outputLeft, outputRight) {
    const gainSmoothing = 1 - Math.exp(-1 / (this.sampleRate * 0.015));
    const parameterSmoothing = 1 - Math.exp(-1 / (this.sampleRate * 0.035));
    for (let frame = 0; frame < outputLeft.length; frame += 1) {
      const leftIn = inputLeft?.[frame] ?? 0;
      const rightIn = inputRight?.[frame] ?? leftIn;
      this.history[this.writeIndex] = Math.tanh((leftIn + rightIn) * 0.5);
      const writePosition = this.writeIndex;
      this.writeIndex = (this.writeIndex + 1) % this.history.length;
      this.recordedSamples = Math.min(this.history.length, this.recordedSamples + 1);

      let left = 0;
      let right = 0;
      for (const voice of this.voices.values()) {
        voice.gain += (voice.target.gain - voice.gain) * gainSmoothing;
        voice.rate += (voice.target.rate - voice.rate) * parameterSmoothing;
        voice.pan += (voice.target.pan - voice.pan) * parameterSmoothing;
        const grainSamples = this.grainLength(voice);
        if (Math.abs(voice.rate - 1) >= 0.0005) {
          voice.phase = (voice.phase + 1 / grainSamples) % 1;
        }
        const fromSample = this.renderAtDelay(
          voice,
          writePosition,
          voice.delayValues[voice.delayFrom],
        );
        let sample = fromSample;
        if (voice.delayFade < 1) {
          const toSample = this.renderAtDelay(
            voice,
            writePosition,
            voice.delayValues[voice.delayTo],
          );
          const mix = Math.min(1, voice.delayFade);
          sample = fromSample * Math.cos(mix * Math.PI * 0.5)
            + toSample * Math.sin(mix * Math.PI * 0.5);
          voice.delayFade = Math.min(1, voice.delayFade + 1 / (this.sampleRate * 0.065));
          if (voice.delayFade >= 1) voice.delayFrom = voice.delayTo;
        }
        left += sample * voice.gain * Math.sqrt((1 - voice.pan) * 0.5);
        right += sample * voice.gain * Math.sqrt((1 + voice.pan) * 0.5);
      }
      outputLeft[frame] = Math.tanh(left);
      outputRight[frame] = Math.tanh(right);
    }
    for (const [key, voice] of this.voices) {
      if (voice.releasing && voice.gain < 0.0001) this.voices.delete(key);
    }
    return true;
  }
}
