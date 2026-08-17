/*
 * Morphazoid Spelling Synthesizer: speech-focused channel vocoder AudioWorklet.
 * The filter sections use Robert Bristow-Johnson's Audio EQ Cookbook equations.
 */

const BAND_COUNT = 20;
const MINIMUM_FREQUENCY = 45;
const MAXIMUM_FREQUENCY = 720;
const DENORMAL_LIMIT = 1e-18;
const NOISE_CALIBRATION_STEPS = 384;

function clamp(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  return Math.min(
    maximum,
    Math.max(minimum, Number.isFinite(number) ? number : fallback),
  );
}

function smoothingAlpha(milliseconds) {
  return 1 - Math.exp(-1 / Math.max(1, sampleRate * milliseconds / 1_000));
}

function smoothstep(minimum, maximum, value) {
  const amount = clamp((value - minimum) / (maximum - minimum), 0, 1, 0);
  return amount * amount * (3 - 2 * amount);
}

function hzToErb(frequency) {
  return 21.4 * Math.log10(1 + 0.00437 * frequency);
}

function erbToHz(erb) {
  return (10 ** (erb / 21.4) - 1) / 0.00437;
}

function polyBlep(phase, increment) {
  if (phase < increment) {
    const position = phase / increment;
    return position + position - position * position - 1;
  }
  if (phase > 1 - increment) {
    const position = (phase - 1) / increment;
    return position * position + position + position + 1;
  }
  return 0;
}

class SpellingVocoderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.phase = 0;
    this.noiseState = 0x51f15e3d;
    this.previousOutputInput = 0;
    this.previousOutput = 0;
    this.previousInput = 0;
    this.previousDirectInput = 0;
    this.previousDirectOutput = 0;

    this.frequency = 132;
    this.targetFrequency = 132;
    // Kept under the old property name for compatibility. It is now an
    // unvoiced prior; the signal detector supplies most of the decision.
    this.noiseMix = 0.18;
    this.targetNoiseMix = 0.18;
    this.unvoicedProbability = 0.18;
    this.drive = 1.4;
    this.targetDrive = 1.4;
    this.clarity = 0.13;
    this.targetClarity = 0.13;
    this.brightness = 0.5;
    this.crossingRate = 0;
    this.inputPower = 0;

    this.controlAlpha = smoothingAlpha(18);
    // Square-law smoothing is followed by sqrt(), so half these power-domain
    // time constants produces approximately 3.5/12 ms amplitude envelopes.
    this.analysisAttackAlpha = smoothingAlpha(1.8);
    this.analysisReleaseAlpha = smoothingAlpha(6);
    this.detectorAlpha = smoothingAlpha(9);
    this.unvoicedAttackAlpha = smoothingAlpha(4);
    this.unvoicedReleaseAlpha = smoothingAlpha(22);
    this.bandAlpha = smoothingAlpha(24);
    this.directHighpassCoefficient = Math.exp(-2 * Math.PI * 620 / sampleRate);

    this.b0 = new Float64Array(BAND_COUNT);
    this.b1 = new Float64Array(BAND_COUNT);
    this.b2 = new Float64Array(BAND_COUNT);
    this.a1 = new Float64Array(BAND_COUNT);
    this.a2 = new Float64Array(BAND_COUNT);
    this.bandCenters = new Float64Array(BAND_COUNT);
    this.bandPositions = new Float64Array(BAND_COUNT);
    this.modZ1 = new Float64Array(BAND_COUNT);
    this.modZ2 = new Float64Array(BAND_COUNT);
    this.sawZ1 = new Float64Array(BAND_COUNT);
    this.sawZ2 = new Float64Array(BAND_COUNT);
    this.noiseZ1 = new Float64Array(BAND_COUNT);
    this.noiseZ2 = new Float64Array(BAND_COUNT);
    this.envelopePowers = new Float64Array(BAND_COUNT);
    this.envelopes = new Float64Array(BAND_COUNT);
    this.bandGains = new Float64Array(BAND_COUNT);
    this.targetBandGains = new Float64Array(BAND_COUNT);
    this.sawBandGains = new Float64Array(BAND_COUNT);
    this.targetSawBandGains = new Float64Array(BAND_COUNT);
    this.noiseBandGains = new Float64Array(BAND_COUNT);

    this.configureBands();
    this.configureNoiseNormalizers();
    this.updateSawNormalizers(this.frequency, true);
    this.updateBrightness(0.5, true);

    this.port.onmessage = ({ data }) => {
      if (data?.type === "reset") {
        this.reset();
        return;
      }
      if (data?.type !== "voice") return;
      this.targetFrequency = clamp(
        data.frequency,
        MINIMUM_FREQUENCY,
        MAXIMUM_FREQUENCY,
        this.targetFrequency,
      );
      if (Number.isFinite(Number(data.unvoicedHint))) {
        this.targetNoiseMix = clamp(data.unvoicedHint, 0, 1, this.targetNoiseMix);
      } else if (Number.isFinite(Number(data.voicednessHint))) {
        this.targetNoiseMix = 1 - clamp(
          data.voicednessHint,
          0,
          1,
          1 - this.targetNoiseMix,
        );
      } else {
        this.targetNoiseMix = clamp(data.noiseMix, 0, 1, this.targetNoiseMix);
      }
      this.targetDrive = clamp(data.drive, 0.25, 6, this.targetDrive);
      this.targetClarity = clamp(data.clarity, 0.04, 0.28, this.targetClarity);
      this.updateSawNormalizers(this.targetFrequency);
      this.updateBrightness(clamp(data.brightness, 0, 1, this.brightness));
    };
  }

  configureBands() {
    const lowest = 120;
    const highest = Math.max(lowest * 2, Math.min(7_600, sampleRate * 0.44));
    const lowestErb = hzToErb(lowest);
    const erbSpan = hzToErb(highest) - lowestErb;

    for (let index = 0; index < BAND_COUNT; index += 1) {
      const position = index / (BAND_COUNT - 1);
      this.bandPositions[index] = position;
      this.bandCenters[index] = erbToHz(lowestErb + erbSpan * position);
    }

    for (let index = 0; index < BAND_COUNT; index += 1) {
      const frequency = this.bandCenters[index];
      const lower = index === 0
        ? Math.max(55, frequency - (this.bandCenters[1] - frequency) * 0.64)
        : (this.bandCenters[index - 1] + frequency) * 0.5;
      const upper = index === BAND_COUNT - 1
        ? Math.min(
          sampleRate * 0.47,
          frequency + (frequency - this.bandCenters[index - 1]) * 0.64,
        )
        : (frequency + this.bandCenters[index + 1]) * 0.5;
      const q = clamp(frequency / Math.max(20, upper - lower), 1.35, 7.4, 3.6);
      const omega = 2 * Math.PI * frequency / sampleRate;
      const sine = Math.sin(omega);
      const cosine = Math.cos(omega);
      const alpha = sine / (2 * q);
      const inverseA0 = 1 / (1 + alpha);

      this.b0[index] = alpha * inverseA0;
      this.b1[index] = 0;
      this.b2[index] = -alpha * inverseA0;
      this.a1[index] = -2 * cosine * inverseA0;
      this.a2[index] = (1 - alpha) * inverseA0;
    }
  }

  filterMagnitudeSquared(index, frequency) {
    const omega = 2 * Math.PI * frequency / sampleRate;
    const cosine = Math.cos(omega);
    const sine = Math.sin(omega);
    const cosine2 = Math.cos(omega * 2);
    const sine2 = Math.sin(omega * 2);
    const numeratorReal = this.b0[index]
      + this.b1[index] * cosine
      + this.b2[index] * cosine2;
    const numeratorImaginary = -this.b1[index] * sine - this.b2[index] * sine2;
    const denominatorReal = 1
      + this.a1[index] * cosine
      + this.a2[index] * cosine2;
    const denominatorImaginary = -this.a1[index] * sine - this.a2[index] * sine2;
    const numeratorPower = numeratorReal * numeratorReal
      + numeratorImaginary * numeratorImaginary;
    const denominatorPower = denominatorReal * denominatorReal
      + denominatorImaginary * denominatorImaginary;
    return numeratorPower / Math.max(DENORMAL_LIMIT, denominatorPower);
  }

  configureNoiseNormalizers() {
    const nyquist = sampleRate * 0.5;
    for (let band = 0; band < BAND_COUNT; band += 1) {
      let magnitudeSum = 0;
      for (let step = 0; step <= NOISE_CALIBRATION_STEPS; step += 1) {
        const weight = step === 0 || step === NOISE_CALIBRATION_STEPS ? 0.5 : 1;
        magnitudeSum += weight * this.filterMagnitudeSquared(
          band,
          nyquist * step / NOISE_CALIBRATION_STEPS,
        );
      }
      // The xorshift source is uniform over [-1, 1], with variance 1/3.
      const outputPower = magnitudeSum / NOISE_CALIBRATION_STEPS / 3;
      this.noiseBandGains[band] = clamp(
        1 / Math.sqrt(Math.max(1e-7, outputPower)),
        0.7,
        32,
        1,
      );
    }
  }

  updateSawNormalizers(frequency, immediate = false) {
    const fundamental = clamp(
      frequency,
      MINIMUM_FREQUENCY,
      MAXIMUM_FREQUENCY,
      this.targetFrequency,
    );
    const harmonicCount = Math.floor(sampleRate * 0.5 / fundamental);
    for (let band = 0; band < BAND_COUNT; band += 1) {
      let outputPower = 0;
      for (let harmonic = 1; harmonic <= harmonicCount; harmonic += 1) {
        const amplitude = 2 / (Math.PI * harmonic);
        outputPower += amplitude * amplitude * 0.5
          * this.filterMagnitudeSquared(band, harmonic * fundamental);
      }
      const gain = clamp(
        1 / Math.sqrt(Math.max(1e-6, outputPower)),
        0.7,
        24,
        1,
      );
      this.targetSawBandGains[band] = gain;
      if (immediate) this.sawBandGains[band] = gain;
    }
  }

  updateBrightness(value, immediate = false) {
    this.brightness = value;
    const tilt = (value - 0.5) * 1.55;
    for (let index = 0; index < BAND_COUNT; index += 1) {
      const centered = this.bandPositions[index] * 2 - 1;
      const gain = Math.exp(tilt * centered * 0.48);
      this.targetBandGains[index] = Math.min(1.72, Math.max(0.58, gain));
      if (immediate) this.bandGains[index] = this.targetBandGains[index];
    }
  }

  reset() {
    this.phase = 0;
    this.noiseState = 0x51f15e3d;
    this.previousOutputInput = 0;
    this.previousOutput = 0;
    this.previousInput = 0;
    this.previousDirectInput = 0;
    this.previousDirectOutput = 0;
    this.crossingRate = 0;
    this.inputPower = 0;
    this.unvoicedProbability = this.noiseMix;
    this.modZ1.fill(0);
    this.modZ2.fill(0);
    this.sawZ1.fill(0);
    this.sawZ2.fill(0);
    this.noiseZ1.fill(0);
    this.noiseZ2.fill(0);
    this.envelopePowers.fill(0);
    this.envelopes.fill(0);
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const firstChannel = output?.[0];
    if (!firstChannel) return true;

    const modulator = inputs[0]?.[0];
    const frameCount = firstChannel.length;
    let phase = this.phase;
    let noiseState = this.noiseState;
    let frequency = this.frequency;
    let noiseMix = this.noiseMix;
    let drive = this.drive;
    let clarity = this.clarity;
    let crossingRate = this.crossingRate;
    let inputPower = this.inputPower;
    let unvoicedProbability = this.unvoicedProbability;
    let previousInput = this.previousInput;
    let previousDirectInput = this.previousDirectInput;
    let previousDirectOutput = this.previousDirectOutput;
    let previousOutputInput = this.previousOutputInput;
    let previousOutput = this.previousOutput;

    for (let frame = 0; frame < frameCount; frame += 1) {
      frequency += (this.targetFrequency - frequency) * this.controlAlpha;
      noiseMix += (this.targetNoiseMix - noiseMix) * this.controlAlpha;
      drive += (this.targetDrive - drive) * this.controlAlpha;
      clarity += (this.targetClarity - clarity) * this.controlAlpha;

      const rawInput = modulator?.[frame] ?? 0;
      const input = Number.isFinite(rawInput) ? clamp(rawInput, -4, 4, 0) : 0;
      const meaningfulCrossing = Math.abs(input - previousInput) > 1e-5;
      const crossing = meaningfulCrossing && (
        (input >= 0 && previousInput < 0)
        || (input < 0 && previousInput >= 0)
      ) ? 1 : 0;
      crossingRate += (crossing - crossingRate) * this.detectorAlpha;
      inputPower += (input * input - inputPower) * this.detectorAlpha;
      previousInput = input;

      let totalEnvelopePower = 0;
      let highEnvelopePower = 0;
      for (let band = 0; band < BAND_COUNT; band += 1) {
        const modulated = this.b0[band] * input + this.modZ1[band];
        this.modZ1[band] = this.b1[band] * input
          - this.a1[band] * modulated
          + this.modZ2[band];
        this.modZ2[band] = this.b2[band] * input - this.a2[band] * modulated;

        const targetPower = modulated * modulated;
        let envelopePower = this.envelopePowers[band];
        envelopePower += (targetPower - envelopePower) * (
          targetPower > envelopePower
            ? this.analysisAttackAlpha
            : this.analysisReleaseAlpha
        );
        if (envelopePower < DENORMAL_LIMIT) envelopePower = 0;
        this.envelopePowers[band] = envelopePower;
        this.envelopes[band] = Math.sqrt(envelopePower);
        totalEnvelopePower += envelopePower;
        if (this.bandCenters[band] >= 1_800) highEnvelopePower += envelopePower;
      }

      const activity = smoothstep(1e-7, 2e-4, inputPower);
      const crossingsPerSecond = crossingRate * sampleRate;
      const crossingEvidence = smoothstep(850, 3_400, crossingsPerSecond);
      const highRatio = highEnvelopePower / Math.max(1e-10, totalEnvelopePower);
      const spectralEvidence = smoothstep(0.16, 0.48, highRatio);
      const detectedUnvoiced = crossingEvidence * 0.64 + spectralEvidence * 0.36;
      const activeDecision = detectedUnvoiced * 0.78 + noiseMix * 0.22;
      const targetUnvoiced = noiseMix * (1 - activity) + activeDecision * activity;
      unvoicedProbability += (targetUnvoiced - unvoicedProbability) * (
        targetUnvoiced > unvoicedProbability
          ? this.unvoicedAttackAlpha
          : this.unvoicedReleaseAlpha
      );

      const increment = Math.min(0.45, frequency / sampleRate);
      let saw = phase + phase - 1;
      saw -= polyBlep(phase, increment);
      phase += increment;
      if (phase >= 1) phase -= 1;

      noiseState ^= noiseState << 13;
      noiseState ^= noiseState >>> 17;
      noiseState ^= noiseState << 5;
      noiseState >>>= 0;
      const noise = noiseState / 0x80000000 - 1;
      let sum = 0;

      for (let band = 0; band < BAND_COUNT; band += 1) {
        const sawBand = this.b0[band] * saw + this.sawZ1[band];
        this.sawZ1[band] = this.b1[band] * saw
          - this.a1[band] * sawBand
          + this.sawZ2[band];
        this.sawZ2[band] = this.b2[band] * saw - this.a2[band] * sawBand;

        const noiseBand = this.b0[band] * noise + this.noiseZ1[band];
        this.noiseZ1[band] = this.b1[band] * noise
          - this.a1[band] * noiseBand
          + this.noiseZ2[band];
        this.noiseZ2[band] = this.b2[band] * noise - this.a2[band] * noiseBand;

        const sawGain = this.sawBandGains[band]
          + (this.targetSawBandGains[band] - this.sawBandGains[band]) * this.bandAlpha;
        this.sawBandGains[band] = sawGain;
        const gain = this.bandGains[band]
          + (this.targetBandGains[band] - this.bandGains[band]) * this.bandAlpha;
        this.bandGains[band] = gain;

        const position = this.bandPositions[band];
        const voicedNoiseFloor = 0.018 + position * 0.062;
        const noisePower = clamp(
          voicedNoiseFloor + unvoicedProbability * (0.91 - voicedNoiseFloor),
          0,
          0.94,
          voicedNoiseFloor,
        );
        const carrier = sawBand * sawGain * Math.sqrt(1 - noisePower)
          + noiseBand * this.noiseBandGains[band] * Math.sqrt(noisePower);
        // A shared periodic carrier makes adjacent low bands add coherently.
        // This restrained reconstruction tilt offsets that overlap without
        // imposing a personality EQ on the transferred speech envelope.
        const reconstructionGain = 0.7 + position * 0.44;
        sum += carrier * this.envelopes[band] * gain * reconstructionGain;
      }

      const directHighpass = input - previousDirectInput
        + previousDirectOutput * this.directHighpassCoefficient;
      previousDirectInput = input;
      previousDirectOutput = directHighpass;
      // Preserve unvoiced consonants with the standard vocoder bypass: /f/
      // carries important low-mid noise that a high-pass-only clarity path
      // turns into generic hiss. Voiced material still uses a restrained mix.
      const direct = input * clarity * (0.9 + unvoicedProbability * 4.5)
        + directHighpass * clarity * 0.08;
      const wetScale = 0.188 + drive * 0.021;
      const outputInput = sum * wetScale * (1 - clarity * 0.32) + direct;
      const dcBlocked = outputInput - previousOutputInput + previousOutput * 0.995;
      previousOutputInput = outputInput;
      previousOutput = Number.isFinite(dcBlocked) ? dcBlocked : 0;
      const sample = Math.tanh(previousOutput * 0.92);

      for (let channel = 0; channel < output.length; channel += 1) {
        output[channel][frame] = sample;
      }
    }

    this.phase = phase;
    this.noiseState = noiseState;
    this.frequency = frequency;
    this.noiseMix = noiseMix;
    this.drive = drive;
    this.clarity = clarity;
    this.crossingRate = crossingRate;
    this.inputPower = inputPower;
    this.unvoicedProbability = unvoicedProbability;
    this.previousInput = previousInput;
    this.previousDirectInput = previousDirectInput;
    this.previousDirectOutput = previousDirectOutput;
    this.previousOutputInput = previousOutputInput;
    this.previousOutput = previousOutput;
    return true;
  }
}

registerProcessor("spelling-vocoder", SpellingVocoderProcessor);
