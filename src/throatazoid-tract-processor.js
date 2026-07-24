const TRACT_LENGTH = 44;
const NOSE_LENGTH = 28;
const MAX_VOICES = 7;
const GLOTTIS_REFLECTION = 0.75;
const LIP_REFLECTION = -0.85;

function clamp(value, minimum = 0, maximum = 1) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : 0));
}

function unit(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number) : clamp(fallback);
}

function placeIndex(position) {
  return clamp(12 + unit(position, 0.5) * 30, 2, TRACT_LENGTH - 2);
}

function constrictionDiameter(aperture) {
  const opening = unit(aperture, 1);
  if (opening >= 0.92) return 3;
  return Math.max(0, opening * 1.38 - 0.035);
}

class WaveguideVoice {
  constructor(index) {
    this.index = index;
    this.active = index === 0;
    this.right = new Float64Array(TRACT_LENGTH);
    this.left = new Float64Array(TRACT_LENGTH);
    this.rightJunction = new Float64Array(TRACT_LENGTH + 1);
    this.leftJunction = new Float64Array(TRACT_LENGTH + 1);
    this.diameter = new Float64Array(TRACT_LENGTH);
    this.targetDiameter = new Float64Array(TRACT_LENGTH);
    this.area = new Float64Array(TRACT_LENGTH);
    this.reflection = new Float64Array(TRACT_LENGTH + 1);
    this.noseRight = new Float64Array(NOSE_LENGTH);
    this.noseLeft = new Float64Array(NOSE_LENGTH);
    this.noseRightJunction = new Float64Array(NOSE_LENGTH + 1);
    this.noseLeftJunction = new Float64Array(NOSE_LENGTH + 1);
    this.noseDiameter = new Float64Array(NOSE_LENGTH);
    this.noseArea = new Float64Array(NOSE_LENGTH);
    this.noseReflection = new Float64Array(NOSE_LENGTH + 1);
    this.noseStart = 17;
    this.velum = 0.01;
    this.leftReflection = 0;
    this.rightReflection = 0;
    this.noseJunctionReflection = 0;
    this.pan = 0;
    this.gain = 1;
    this.constrictionIndex = 28;
    this.constrictionDiameter = 3;
    this.frication = 0;
    this.voicing = 1;
    this.glottalTarget = 0;
    this.glottalSeal = 0;
    this.pressure = 0;
    this.wasSealed = false;
    this.wasOralSealed = false;
    this.wasGlottalSealed = false;
    this.transientAge = 1;
    this.transientStrength = 0;
    this.glottalTransientAge = 1;
    this.glottalTransientStrength = 0;
    this.lastMouth = 0;
    this.lastNose = 0;
    this.configure({}, index, true);
    this.diameter.set(this.targetDiameter);
    this.updateReflections();
  }

  configure(config, index, immediate = false) {
    const count = Math.round(clamp(config.throatCount ?? 1, 1, MAX_VOICES));
    const throat = config.throats?.[index] ?? {};
    const active = index < count && !throat.muted;
    const previousOralSeal = this.wasOralSealed;
    const previousGlottalSeal = this.wasGlottalSealed;
    const aperture = unit(config.articulationAperture, 1 - unit(config.oralClosure));
    const glottalTarget = unit(config.glottalClosure);
    const targetConstrictionDiameter = constrictionDiameter(aperture);
    const nasalOpening = clamp(
      Math.max(
        unit(config.nasalCoupling),
        ...(config.noses ?? []).map((nose) => unit(nose?.openness)),
      ),
    );

    this.active = active;
    this.pan = count <= 1
      ? 0
      : clamp((index / (count - 1)) * 2 - 1) * unit(config.spread, 0.8);
    this.gain = active ? 0.82 / Math.sqrt(count) : 0;
    this.voicing = unit(config.articulationVoicing, 1);
    this.glottalTarget = glottalTarget;
    this.constrictionIndex = placeIndex(config.articulationPlace);
    this.constrictionDiameter = targetConstrictionDiameter;
    this.velum = 0.01 + nasalOpening * 0.52;
    this.buildTargetDiameter(config, throat);
    this.buildNose(config);

    const oralSeal = targetConstrictionDiameter <= 0.045;
    const glottalSeal = glottalTarget >= 0.84;
    this.wasSealed = oralSeal || glottalSeal;
    this.wasOralSealed = oralSeal;
    this.wasGlottalSealed = glottalSeal;
    if (previousOralSeal && !oralSeal) {
      const isNasal = nasalOpening > 0.55;
      if (!isNasal) {
        this.transientAge = 0;
        this.transientStrength = 0.16 + this.pressure * 0.62;
      }
      this.pressure *= 0.24;
    }
    if (previousGlottalSeal && !glottalSeal) this.pressure *= 0.32;

    if (immediate) {
      this.diameter.set(this.targetDiameter);
      this.glottalSeal = glottalTarget;
      this.updateReflections();
    }
  }

  buildTargetDiameter(config, throat) {
    const bodyLength = unit(config.bodyLength, 0.56);
    const throatAperture = unit(throat.aperture, 0.5);
    const lengthScale = 0.9 + bodyLength * 0.2 + unit(throat.length, 0.5) * 0.08;

    for (let index = 0; index < TRACT_LENGTH; index += 1) {
      let diameter;
      if (index < 7) diameter = 0.58;
      else if (index < 12) diameter = 1.08;
      else diameter = 1.5;
      const lipProgress = clamp((index - 35) / 8);
      diameter *= lengthScale * (1 - lipProgress * (1 - throatAperture) * 0.34);
      this.targetDiameter[index] = Math.max(0.08, diameter);
    }

    const tongues = config.tongues ?? [];
    const primary = tongues[0] ?? {};
    const tonguePosition = unit(primary.position, 0.38);
    const tongueHeight = unit(primary.height, 0.18);
    const tongueDiameter = 3.5 - tongueHeight * 1.45;
    const tongueIndex = 12.9 + tonguePosition * 17.5;
    for (let index = 10; index < 39; index += 1) {
      const interpolation = (tongueIndex - index) / 22;
      const angle = 1.1 * Math.PI * interpolation;
      const normalizedDiameter = 2 + (tongueDiameter - 2) / 1.5;
      let curve = (1.5 - normalizedDiameter + 1.7) * Math.cos(angle);
      if (index === 10 || index === 37) curve *= 0.94;
      const diameter = Math.max(0.12, 1.5 - curve);
      this.targetDiameter[index] = Math.min(this.targetDiameter[index], diameter);
    }

    for (let tongueIndexValue = 1; tongueIndexValue < tongues.length; tongueIndexValue += 1) {
      const tongue = tongues[tongueIndexValue];
      const center = 12 + unit(tongue?.position, 0.5) * 29;
      const depth = unit(tongue?.height) * (0.22 + unit(tongue?.curl) * 0.28);
      for (let index = Math.max(2, Math.floor(center - 5)); index <= Math.min(42, Math.ceil(center + 5)); index += 1) {
        const distance = Math.abs(index - center) / 5;
        const influence = 0.5 + 0.5 * Math.cos(Math.PI * clamp(distance));
        this.targetDiameter[index] = Math.max(
          0.08,
          this.targetDiameter[index] - depth * influence,
        );
      }
    }

    if (this.constrictionDiameter < 3) {
      const center = this.constrictionIndex;
      const normalized = center / TRACT_LENGTH;
      const radius = normalized < 25 / 44
        ? 8.5
        : 8.5 - clamp((normalized - 25 / 44) / (32 / 44 - 25 / 44)) * 4.2;
      const start = Math.max(1, Math.floor(center - radius - 1));
      const end = Math.min(TRACT_LENGTH - 1, Math.ceil(center + radius + 1));
      for (let index = start; index <= end; index += 1) {
        const offset = Math.max(0, Math.abs(index - center) - 0.5);
        const scalar = offset >= radius
          ? 1
          : 0.5 * (1 - Math.cos(Math.PI * offset / radius));
        const difference = this.targetDiameter[index] - this.constrictionDiameter;
        if (difference > 0) {
          this.targetDiameter[index] = Math.max(
            0,
            this.constrictionDiameter + difference * scalar,
          );
        }
      }
    }

    const thinness = clamp(8 * (0.7 - this.constrictionDiameter));
    const openness = clamp(30 * (this.constrictionDiameter - 0.3));
    this.frication = thinness * openness;
  }

  buildNose(config) {
    const noses = config.noses ?? [];
    const first = noses[0] ?? {};
    const resonance = unit(first.resonance, 0.5);
    const length = unit(first.length, 0.5);
    for (let index = 0; index < NOSE_LENGTH; index += 1) {
      const progress = index / (NOSE_LENGTH - 1);
      const taper = 0.52 + Math.sin(progress * Math.PI) * (0.5 + resonance * 0.32);
      this.noseDiameter[index] = index === 0
        ? this.velum
        : Math.max(0.18, taper * (0.88 + length * 0.24));
      this.noseArea[index] = this.noseDiameter[index] ** 2;
      if (index > 0) {
        const sum = this.noseArea[index - 1] + this.noseArea[index];
        this.noseReflection[index] = sum > 0
          ? (this.noseArea[index - 1] - this.noseArea[index]) / sum
          : 0.999;
      }
    }
  }

  updateReflections() {
    for (let index = 0; index < TRACT_LENGTH; index += 1) {
      this.area[index] = this.diameter[index] ** 2;
      if (index > 0) {
        const sum = this.area[index - 1] + this.area[index];
        this.reflection[index] = sum > 0
          ? (this.area[index - 1] - this.area[index]) / sum
          : 0.999;
      }
    }
    const leftArea = this.area[this.noseStart];
    const rightArea = this.area[this.noseStart + 1];
    const noseArea = this.noseArea[0];
    const sum = Math.max(0.000001, leftArea + rightArea + noseArea);
    this.leftReflection = (2 * leftArea - sum) / sum;
    this.rightReflection = (2 * rightArea - sum) / sum;
    this.noseJunctionReflection = (2 * noseArea - sum) / sum;
  }

  prepareBlock() {
    let changed = false;
    for (let index = 0; index < TRACT_LENGTH; index += 1) {
      const current = this.diameter[index];
      const target = this.targetDiameter[index];
      const next = current + (target - current) * 0.24;
      if (Math.abs(next - current) > 0.00001) changed = true;
      this.diameter[index] = next;
    }
    if (changed) this.updateReflections();
  }

  injectFrication(noise, modulator) {
    if (this.frication <= 0.0001) return;
    const turbulence = noise * modulator * this.frication * 0.34;
    const lower = Math.floor(this.constrictionIndex);
    const fraction = this.constrictionIndex - lower;
    const lowerNoise = turbulence * (1 - fraction);
    const upperNoise = turbulence * fraction;
    this.right[Math.min(TRACT_LENGTH - 1, lower + 1)] += lowerNoise;
    this.left[Math.min(TRACT_LENGTH - 1, lower + 1)] += lowerNoise;
    this.right[Math.min(TRACT_LENGTH - 1, lower + 2)] += upperNoise;
    this.left[Math.min(TRACT_LENGTH - 1, lower + 2)] += upperNoise;
  }

  injectTransient(noise) {
    if (this.transientAge < 0.2) {
      const envelope = this.transientStrength * 2 ** (-this.transientAge * 195);
      const position = Math.round(this.constrictionIndex);
      const shaped = envelope * (0.58 + noise * 0.42);
      this.left[position] += shaped;
      this.right[Math.max(0, position - 1)] += shaped * 0.34;
      this.transientAge += 1 / sampleRate;
    }
  }

  processSample(input, noise, intensity) {
    const glottalRate = this.glottalTarget > this.glottalSeal ? 0.0035 : 0.0017;
    this.glottalSeal += (this.glottalTarget - this.glottalSeal) * glottalRate;
    const closed = this.constrictionDiameter <= 0.045 || this.glottalSeal > 0.72;
    if (closed) {
      this.pressure = Math.min(
        1,
        this.pressure + (Math.abs(input) * 4.2 + intensity * 0.32 + 0.08) / sampleRate,
      );
    } else {
      this.pressure *= 0.9995;
    }

    let excitation = input * (0.12 + this.voicing * 0.88) * (1 - this.glottalSeal);
    if (this.glottalTransientAge < 0.12) {
      const envelope = this.glottalTransientStrength * 2 ** (-this.glottalTransientAge * 92);
      excitation += envelope * (0.72 + noise * 0.16);
      this.glottalTransientAge += 1 / sampleRate;
    }

    this.injectFrication(noise, 0.3 + Math.min(1, Math.abs(input) * 3.4) * 0.7);
    this.injectTransient(noise);

    this.rightJunction[0] = this.left[0] * GLOTTIS_REFLECTION + excitation;
    this.leftJunction[TRACT_LENGTH] = this.right[TRACT_LENGTH - 1] * LIP_REFLECTION;

    for (let index = 1; index < TRACT_LENGTH; index += 1) {
      if (index === this.noseStart) continue;
      const offset = this.reflection[index] * (this.right[index - 1] + this.left[index]);
      this.rightJunction[index] = this.right[index - 1] - offset;
      this.leftJunction[index] = this.left[index] + offset;
    }

    const junction = this.noseStart;
    this.leftJunction[junction] = (
      this.leftReflection * this.right[junction - 1]
      + (this.leftReflection + 1) * (this.noseLeft[0] + this.left[junction])
    );
    this.rightJunction[junction] = (
      this.rightReflection * this.left[junction]
      + (this.rightReflection + 1) * (this.noseLeft[0] + this.right[junction - 1])
    );
    this.noseRightJunction[0] = (
      this.noseJunctionReflection * this.noseLeft[0]
      + (this.noseJunctionReflection + 1) * (this.left[junction] + this.right[junction - 1])
    );

    for (let index = 0; index < TRACT_LENGTH; index += 1) {
      this.right[index] = this.rightJunction[index] * 0.999;
      this.left[index] = this.leftJunction[index + 1] * 0.999;
    }

    this.noseLeftJunction[NOSE_LENGTH] = this.noseRight[NOSE_LENGTH - 1] * LIP_REFLECTION;
    for (let index = 1; index < NOSE_LENGTH; index += 1) {
      const offset = this.noseReflection[index] * (
        this.noseLeft[index] + this.noseRight[index - 1]
      );
      this.noseLeftJunction[index] = this.noseLeft[index] + offset;
      this.noseRightJunction[index] = this.noseRight[index - 1] - offset;
    }
    for (let index = 0; index < NOSE_LENGTH; index += 1) {
      this.noseLeft[index] = this.noseLeftJunction[index + 1] * 0.999;
      this.noseRight[index] = this.noseRightJunction[index] * 0.999;
    }

    this.lastMouth = this.right[TRACT_LENGTH - 1];
    this.lastNose = this.noseRight[NOSE_LENGTH - 1] * clamp(this.velum * 2.2);
    return this.lastMouth + this.lastNose;
  }
}

class ThroatazoidTractProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = Array.from({ length: MAX_VOICES }, (_, index) => new WaveguideVoice(index));
    this.config = {};
    this.seed = 0x7f4a7c15;
    this.blockCount = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type !== "configure") return;
      this.config = event.data.state ?? {};
      for (let index = 0; index < MAX_VOICES; index += 1) {
        this.voices[index].configure(this.config, index);
      }
    };
  }

  noise() {
    let value = this.seed >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.seed = value >>> 0;
    return this.seed / 0x80000000 - 1;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1] ?? left;
    if (!left || !right) return true;

    for (const voice of this.voices) voice.prepareBlock();
    const intensity = unit(this.config.exciterIntensity, 0.72);
    for (let sampleIndex = 0; sampleIndex < left.length; sampleIndex += 1) {
      const source = (input?.[sampleIndex] ?? 0) * unit(this.config.performanceGate, 1);
      const noise = this.noise();
      let leftSample = 0;
      let rightSample = 0;
      for (const voice of this.voices) {
        if (!voice.active) continue;
        const sample = voice.processSample(source, noise, intensity) * voice.gain;
        const panAngle = (voice.pan + 1) * Math.PI * 0.25;
        leftSample += sample * Math.cos(panAngle);
        rightSample += sample * Math.sin(panAngle);
      }
      left[sampleIndex] = Math.tanh(leftSample * 0.82);
      right[sampleIndex] = Math.tanh(rightSample * 0.82);
    }

    this.blockCount += 1;
    if (this.blockCount % 18 === 0) {
      let pressure = 0;
      for (const voice of this.voices) {
        if (voice.active) pressure = Math.max(pressure, voice.pressure);
      }
      this.port.postMessage({ type: "pressure", value: pressure });
    }
    return true;
  }
}

registerProcessor("throatazoid-tract", ThroatazoidTractProcessor);
