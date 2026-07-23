const DEFAULT_SAMPLE_RATE = 48_000;

function clamp(value, low, high, fallback = low) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
}

function sanitizeVoice(voice, index, maximumDelay, maximumInputs) {
  return {
    key: typeof voice?.key === "string" ? voice.key : `tap:${index}`,
    sourceIndex: Math.round(clamp(voice?.sourceIndex, 0, maximumInputs - 1, 0)),
    delay: clamp(voice?.delay, 1 / DEFAULT_SAMPLE_RATE, maximumDelay, 0.2),
    gain: clamp(voice?.gain, 0, 1, 0),
    pan: clamp(voice?.pan, -1, 1, 0),
  };
}

/**
 * One bounded rolling history per fixed pitch slot.  All L-system branches
 * are virtual read heads, so changing the grammar allocates no DelayNodes.
 */
export class SignalsmithGenerationMixerDSP {
  constructor({
    sampleRate = DEFAULT_SAMPLE_RATE,
    historySeconds = 32,
    maxInputs = 6,
    maxVoices = 48,
  } = {}) {
    this.sampleRate = clamp(sampleRate, 8_000, 192_000, DEFAULT_SAMPLE_RATE);
    this.maxInputs = Math.max(1, Math.round(clamp(maxInputs, 1, 12, 6)));
    this.maxVoices = Math.max(1, Math.round(clamp(maxVoices, 1, 96, 48)));
    this.historyLength = Math.ceil(clamp(historySeconds, 4, 40, 32) * this.sampleRate);
    this.maximumDelay = (this.historyLength - 3) / this.sampleRate;
    this.histories = Array.from(
      { length: this.maxInputs },
      () => new Float32Array(this.historyLength),
    );
    this.writeIndex = 0;
    this.recordedSamples = 0;
    this.voices = new Map();
  }

  setVoices(specifications) {
    const next = new Map();
    (Array.isArray(specifications) ? specifications : [])
      .slice(0, this.maxVoices)
      .forEach((candidate, index) => {
        const target = sanitizeVoice(
          candidate,
          index,
          this.maximumDelay,
          this.maxInputs,
        );
        const prior = this.voices.get(target.key);
        if (!prior) {
          next.set(target.key, {
            target,
            gain: 0,
            pan: target.pan,
            delayValues: [target.delay, target.delay],
            delayFrom: 0,
            delayTo: 0,
            delayFade: 1,
            releasing: false,
          });
          return;
        }
        const currentLane = prior.delayFade >= 0.5 ? prior.delayTo : prior.delayFrom;
        const currentDelay = prior.delayValues[currentLane];
        if (
          target.sourceIndex !== prior.target.sourceIndex
          || Math.abs(target.delay - currentDelay) > 1 / this.sampleRate
        ) {
          const nextLane = 1 - currentLane;
          prior.delayValues[nextLane] = target.delay;
          prior.delayFrom = currentLane;
          prior.delayTo = nextLane;
          prior.delayFade = 0;
          prior.previousSourceIndex = prior.target.sourceIndex;
        }
        next.set(target.key, { ...prior, target, releasing: false });
      });
    for (const [key, prior] of this.voices) {
      if (next.has(key) || next.size >= this.maxVoices + 12) continue;
      next.set(key, {
        ...prior,
        target: { ...prior.target, gain: 0 },
        releasing: true,
      });
    }
    this.voices = next;
  }

  read(sourceIndex, delaySeconds, writePosition) {
    const delaySamples = Math.max(1, delaySeconds * this.sampleRate);
    if (this.recordedSamples < Math.ceil(delaySamples) + 2) return 0;
    const position = writePosition - delaySamples;
    const floor = Math.floor(position);
    const fraction = position - floor;
    const left = ((floor % this.historyLength) + this.historyLength) % this.historyLength;
    const right = (left + 1) % this.historyLength;
    const history = this.histories[sourceIndex] ?? this.histories[0];
    return history[left] * (1 - fraction) + history[right] * fraction;
  }

  process(inputs, outputLeft, outputRight) {
    const gainSmoothing = 1 - Math.exp(-1 / (this.sampleRate * 0.02));
    const panSmoothing = 1 - Math.exp(-1 / (this.sampleRate * 0.03));
    for (let frame = 0; frame < outputLeft.length; frame += 1) {
      for (let input = 0; input < this.maxInputs; input += 1) {
        this.histories[input][this.writeIndex] = inputs[input]?.[frame] ?? 0;
      }
      const writePosition = this.writeIndex;
      this.writeIndex = (this.writeIndex + 1) % this.historyLength;
      this.recordedSamples = Math.min(this.historyLength, this.recordedSamples + 1);

      let left = 0;
      let right = 0;
      for (const voice of this.voices.values()) {
        voice.gain += (voice.target.gain - voice.gain) * gainSmoothing;
        voice.pan += (voice.target.pan - voice.pan) * panSmoothing;
        const fromSource = voice.previousSourceIndex ?? voice.target.sourceIndex;
        const fromSample = this.read(
          fromSource,
          voice.delayValues[voice.delayFrom],
          writePosition,
        );
        let sample = fromSample;
        if (voice.delayFade < 1) {
          const toSample = this.read(
            voice.target.sourceIndex,
            voice.delayValues[voice.delayTo],
            writePosition,
          );
          const mix = Math.min(1, voice.delayFade);
          sample = fromSample * Math.cos(mix * Math.PI * 0.5)
            + toSample * Math.sin(mix * Math.PI * 0.5);
          voice.delayFade = Math.min(1, voice.delayFade + 1 / (this.sampleRate * 0.065));
          if (voice.delayFade >= 1) {
            voice.delayFrom = voice.delayTo;
            voice.previousSourceIndex = voice.target.sourceIndex;
          }
        }
        left += sample * voice.gain * Math.sqrt((1 - voice.pan) * 0.5);
        right += sample * voice.gain * Math.sqrt((1 + voice.pan) * 0.5);
      }
      outputLeft[frame] = clamp(left, -1, 1, 0);
      outputRight[frame] = clamp(right, -1, 1, 0);
    }
    for (const [key, voice] of this.voices) {
      if (voice.releasing && voice.gain < 0.0001) this.voices.delete(key);
    }
    return true;
  }
}
