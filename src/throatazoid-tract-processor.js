const ROOT_LENGTH = 8;
const MOUTH_LENGTH = 36;
const FULL_TRACT_LENGTH = ROOT_LENGTH + MOUTH_LENGTH;
const NOSE_LENGTH = 28;
const MAX_MOUTHS = 7;
const MAX_NOSES = 3;
const MAX_TONGUES = 5;
const MAX_PRESSURE_SOURCES = 4;
const PRESSURE_DUCT_LENGTHS = Object.freeze([3, 5, 7, 11]);
const SUBSTEPS = 2;
const GLOTTAL_REFLECTION = 0.75;
const LIP_REFLECTION = -0.85;
const OPEN_SOURCE_REFLECTION = 0.72;
const CLOSED_SOURCE_REFLECTION = 0.9985;
const TUBE_LOSS = 0.9988;
const JUNCTION_LOSS = 0.999;
const AREA_MINIMUM = 0.000001;
const DIAMETER_MINIMUM = 0.001;
const REFLECTION_LIMIT = 0.9995;
const DENORMAL_LIMIT = 1e-20;
const MOUTH_GATE_INDEX = 3;

function clamp(value, minimum = 0, maximum = 1) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : 0));
}

function unit(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number) : clamp(fallback);
}

function integer(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  return Math.round(clamp(Number.isFinite(number) ? number : fallback, minimum, maximum));
}

function cleanWave(value) {
  if (!Number.isFinite(value) || Math.abs(value) < DENORMAL_LIMIT) return 0;
  return value;
}

function safeArea(diameter) {
  return Math.max(AREA_MINIMUM, diameter * diameter);
}

function timeAlpha(milliseconds, rate = sampleRate * SUBSTEPS) {
  return 1 - Math.exp(-1 / Math.max(1, rate * milliseconds / 1_000));
}

function blockAlpha(frameCount, milliseconds = 18) {
  return 1 - Math.exp(
    -Math.max(1, frameCount) / Math.max(1, sampleRate * milliseconds / 1_000),
  );
}

function articulationIndex(config) {
  const supplied = Number(config.articulationIndex);
  if (Number.isFinite(supplied)) return clamp(supplied, 1, FULL_TRACT_LENGTH - 2);
  return clamp(12 + unit(config.articulationPlace, 0.5) * 30, 2, FULL_TRACT_LENGTH - 2);
}

function constrictionDiameter(aperture) {
  const opening = unit(aperture, 1);
  if (opening >= 0.92) return 3;
  return Math.max(0, opening * 1.38 - 0.035);
}

function updateTubeReflections(diameter, area, reflection) {
  for (let index = 0; index < diameter.length; index += 1) {
    area[index] = safeArea(diameter[index]);
    if (index === 0) continue;
    const sum = area[index - 1] + area[index];
    reflection[index] = clamp(
      (area[index - 1] - area[index]) / Math.max(AREA_MINIMUM, sum),
      -REFLECTION_LIMIT,
      REFLECTION_LIMIT,
    );
  }
}

function smoothTube(diameter, target, amount) {
  let changed = false;
  for (let index = 0; index < diameter.length; index += 1) {
    const current = diameter[index];
    const next = current + (target[index] - current) * amount;
    if (Math.abs(next - current) > 0.000001) changed = true;
    diameter[index] = Math.max(DIAMETER_MINIMUM, next);
  }
  return changed;
}

function smoothMouthTube(diameter, target, frameCount) {
  let changed = false;
  const amount = Math.max(1, frameCount) / Math.max(1, sampleRate) * 15;
  for (let localIndex = 0; localIndex < diameter.length; localIndex += 1) {
    const globalIndex = localIndex + ROOT_LENGTH;
    const slowReturn = globalIndex < 17
      ? 0.6
      : globalIndex >= 32
        ? 1
        : 0.6 + 0.4 * (globalIndex - 17) / (32 - 17);
    const current = diameter[localIndex];
    const destination = target[localIndex];
    const next = current < destination
      ? Math.min(current + slowReturn * amount, destination)
      : Math.max(current - 2 * amount, destination);
    if (Math.abs(next - current) > 0.000001) changed = true;
    diameter[localIndex] = Math.max(DIAMETER_MINIMUM, next);
  }
  return changed;
}

/*
 * These arrays carry volume-flow waves. For an N-port lossless junction,
 * qOut_i = -qIn_i + 2*A_i/sum(A)*sum(qIn). This is deliberately not the
 * pressure-wave form, which weights the incoming sum differently.
 */
function scatterFlowPorts(incoming, areas, outgoing, count, loss = JUNCTION_LOSS) {
  let totalFlow = 0;
  let totalArea = 0;
  for (let index = 0; index < count; index += 1) {
    totalFlow += incoming[index];
    totalArea += Math.max(AREA_MINIMUM, areas[index]);
  }
  totalArea = Math.max(AREA_MINIMUM, totalArea);
  for (let index = 0; index < count; index += 1) {
    outgoing[index] = cleanWave((
      -incoming[index]
      + 2 * Math.max(AREA_MINIMUM, areas[index]) / totalArea * totalFlow
    ) * loss);
  }
}

function arraysAreFinite(arrays) {
  for (const values of arrays) {
    for (let index = 0; index < values.length; index += 1) {
      if (!Number.isFinite(values[index])) return false;
    }
  }
  return true;
}

class RootAirway {
  constructor() {
    this.right = new Float64Array(ROOT_LENGTH);
    this.left = new Float64Array(ROOT_LENGTH);
    this.rightJunction = new Float64Array(ROOT_LENGTH + 1);
    this.leftJunction = new Float64Array(ROOT_LENGTH + 1);
    this.diameter = new Float64Array(ROOT_LENGTH);
    this.targetDiameter = new Float64Array(ROOT_LENGTH);
    this.area = new Float64Array(ROOT_LENGTH);
    this.reflection = new Float64Array(ROOT_LENGTH + 1);
    this.configure({}, true);
  }

  get incomingAtSourceHub() {
    return this.left[0];
  }

  get sourceHubArea() {
    return Math.max(AREA_MINIMUM, this.area[0]);
  }

  get incomingAtMouthManifold() {
    return this.right[ROOT_LENGTH - 1];
  }

  get mouthManifoldArea() {
    return Math.max(AREA_MINIMUM, this.area[ROOT_LENGTH - 1]);
  }

  configure(config, immediate = false) {
    const bodyLength = unit(config.bodyLength, 0.56);
    const tension = unit(config.tension, 0.58);
    const classicTopology = Boolean(config.classicTopology);
    const glottalClosure = unit(config.glottalClosure);
    const gateDiameter = DIAMETER_MINIMUM + (1 - glottalClosure) * 0.579;
    for (let index = 0; index < ROOT_LENGTH; index += 1) {
      const progress = index / (ROOT_LENGTH - 1);
      const base = classicTopology
        ? index < 7 ? 0.6 : 1.1
        : index < 6 ? 0.58 : 1.08;
      const geometryScale = classicTopology
        ? 1 + (bodyLength - 0.55) * 0.12
        : 0.92 + bodyLength * 0.12;
      const tensionWarp = classicTopology
        ? (tension - 0.56) * 0.06
        : tension * 0.06;
      this.targetDiameter[index] = base
        * geometryScale
        * (1 + Math.sin(progress * Math.PI) * tensionWarp);
    }
    this.targetDiameter[0] = Math.min(this.targetDiameter[0], gateDiameter);
    this.targetDiameter[1] = Math.min(
      this.targetDiameter[1],
      0.055 + gateDiameter * 0.92,
    );
    this.targetDiameter[2] = Math.min(
      this.targetDiameter[2],
      0.18 + gateDiameter * 1.55,
    );
    if (immediate) this.diameter.set(this.targetDiameter);
    updateTubeReflections(this.diameter, this.area, this.reflection);
  }

  prepareBlock(frameCount) {
    if (smoothTube(this.diameter, this.targetDiameter, blockAlpha(frameCount))) {
      updateTubeReflections(this.diameter, this.area, this.reflection);
    }
  }

  process(sourceHubInput, mouthManifoldReturn) {
    this.rightJunction[0] = sourceHubInput;
    this.leftJunction[ROOT_LENGTH] = mouthManifoldReturn;
    for (let index = 1; index < ROOT_LENGTH; index += 1) {
      const offset = this.reflection[index] * (this.right[index - 1] + this.left[index]);
      this.rightJunction[index] = this.right[index - 1] - offset;
      this.leftJunction[index] = this.left[index] + offset;
    }
    for (let index = 0; index < ROOT_LENGTH; index += 1) {
      this.right[index] = cleanWave(this.rightJunction[index] * TUBE_LOSS);
      this.left[index] = cleanWave(this.leftJunction[index + 1] * TUBE_LOSS);
    }
  }

  pressure() {
    let energy = 0;
    for (let index = 0; index < ROOT_LENGTH; index += 1) {
      const pressureWave = this.right[index] + this.left[index];
      energy += pressureWave * pressureWave / Math.max(AREA_MINIMUM, this.area[index]);
    }
    return clamp(1 - Math.exp(-Math.sqrt(energy / ROOT_LENGTH) * 0.65));
  }

  reset() {
    this.right.fill(0);
    this.left.fill(0);
    this.rightJunction.fill(0);
    this.leftJunction.fill(0);
  }

  isFinite() {
    return arraysAreFinite([this.right, this.left, this.rightJunction, this.leftJunction]);
  }
}

class PressureGland {
  constructor(index) {
    this.index = index;
    this.connected = index === 0;
    this.length = PRESSURE_DUCT_LENGTHS[index];
    this.right = new Float64Array(this.length);
    this.left = new Float64Array(this.length);
    this.rightJunction = new Float64Array(this.length + 1);
    this.leftJunction = new Float64Array(this.length + 1);
    this.diameter = new Float64Array(this.length);
    this.area = new Float64Array(this.length);
    this.reflection = new Float64Array(this.length + 1);
    this.valve = 0;
    this.targetValve = 0;
    this.level = 0;
    this.targetLevel = 0.8;
    this.boundaryReflection = CLOSED_SOURCE_REFLECTION;
    this.pressure = 0;
    for (let section = 0; section < this.length; section += 1) {
      const progress = section / Math.max(1, this.length - 1);
      this.diameter[section] = 0.2
        + index * 0.018
        + Math.sin(progress * Math.PI) * 0.055;
    }
    updateTubeReflections(this.diameter, this.area, this.reflection);
  }

  get incomingAtHub() {
    return this.right[this.length - 1];
  }

  get hubArea() {
    return Math.max(AREA_MINIMUM, this.area[this.length - 1]);
  }

  configure(source, connected) {
    const wasConnected = this.connected;
    this.connected = Boolean(connected);
    if (wasConnected && !this.connected) this.reset();
    this.targetValve = connected && source.open !== false ? 1 : 0;
    this.targetLevel = unit(source.level, 0.86 - this.index * 0.08);
  }

  advanceControl() {
    this.valve += (this.targetValve - this.valve) * timeAlpha(12);
    this.level += (this.targetLevel - this.level) * timeAlpha(18);
    this.boundaryReflection = (
      OPEN_SOURCE_REFLECTION * this.valve
      + CLOSED_SOURCE_REFLECTION * (1 - this.valve)
    );
    return this.valve * this.level;
  }

  process(drive, hubReturn) {
    this.rightJunction[0] = this.left[0] * this.boundaryReflection + drive;
    this.leftJunction[this.length] = hubReturn;
    for (let index = 1; index < this.length; index += 1) {
      const offset = this.reflection[index] * (this.right[index - 1] + this.left[index]);
      this.rightJunction[index] = this.right[index - 1] - offset;
      this.leftJunction[index] = this.left[index] + offset;
    }
    for (let index = 0; index < this.length; index += 1) {
      this.right[index] = cleanWave(this.rightJunction[index] * TUBE_LOSS);
      this.left[index] = cleanWave(this.leftJunction[index + 1] * TUBE_LOSS);
    }
    const localPressure = Math.abs(
      this.right[this.length - 1] + this.left[this.length - 1],
    );
    this.pressure += (clamp(localPressure * 4 + Math.abs(drive) * 2) - this.pressure)
      * timeAlpha(28);
  }

  reset() {
    this.right.fill(0);
    this.left.fill(0);
    this.rightJunction.fill(0);
    this.leftJunction.fill(0);
    this.pressure = 0;
  }

  isFinite() {
    return Number.isFinite(this.pressure)
      && arraysAreFinite([this.right, this.left, this.rightJunction, this.leftJunction]);
  }
}

class NasalAirway {
  constructor(index) {
    this.index = index;
    this.active = index === 0;
    this.right = new Float64Array(NOSE_LENGTH);
    this.left = new Float64Array(NOSE_LENGTH);
    this.rightJunction = new Float64Array(NOSE_LENGTH + 1);
    this.leftJunction = new Float64Array(NOSE_LENGTH + 1);
    this.diameter = new Float64Array(NOSE_LENGTH);
    this.targetDiameter = new Float64Array(NOSE_LENGTH);
    this.area = new Float64Array(NOSE_LENGTH);
    this.reflection = new Float64Array(NOSE_LENGTH + 1);
    this.opening = 0;
    this.targetOpening = 0;
    this.configure({}, 0, index, true);
  }

  get incomingAtJunction() {
    return this.left[0];
  }

  get junctionArea() {
    return Math.max(AREA_MINIMUM, this.area[0]);
  }

  configure(config, mouthIndex, noseIndex, immediate = false) {
    const noses = config.noses ?? [];
    const noseCount = integer(config.noseCount, 1, MAX_NOSES, noses.length || 1);
    const nose = noses[noseIndex] ?? noses[0] ?? {};
    this.active = noseIndex < noseCount;
    const requestedOpenness = Number(nose.openness);
    const rawOpenness = this.active
      ? unit(
        Number.isFinite(requestedOpenness)
          ? requestedOpenness
          : config.nasalCoupling,
      )
      : 0;
    const openness = rawOpenness <= 0.03
      ? 0
      : Math.pow(clamp((rawOpenness - 0.03) / 0.97), 0.72);
    const resonance = unit(nose.resonance, 0.5);
    const length = unit(nose.length, 0.5);
    const mutation = unit(config.mutation, 0.3);
    this.targetOpening = openness;
    for (let index = 0; index < NOSE_LENGTH; index += 1) {
      const progress = index / (NOSE_LENGTH - 1);
      const chamber = 0.48
        + Math.sin(progress * Math.PI) * (0.42 + resonance * 0.62);
      const mouthWarp = 1 + Math.sin(
        mouthIndex * 1.71 + noseIndex * 2.19 + index * 0.24,
      ) * mutation * 0.018;
      this.targetDiameter[index] = index === 0
        ? DIAMETER_MINIMUM + openness * (0.48 + noseIndex * 0.05)
        : Math.max(
          0.16,
          chamber * (0.68 + length * 0.65) * mouthWarp,
        );
    }
    if (immediate) {
      this.diameter.set(this.targetDiameter);
      this.opening = this.targetOpening;
    }
    updateTubeReflections(this.diameter, this.area, this.reflection);
  }

  prepareBlock(frameCount) {
    const amount = blockAlpha(frameCount, 22);
    this.opening += (this.targetOpening - this.opening) * amount;
    if (smoothTube(this.diameter, this.targetDiameter, amount)) {
      updateTubeReflections(this.diameter, this.area, this.reflection);
    }
  }

  process(junctionInput) {
    this.rightJunction[0] = junctionInput;
    this.leftJunction[NOSE_LENGTH] = this.right[NOSE_LENGTH - 1] * LIP_REFLECTION;
    for (let index = 1; index < NOSE_LENGTH; index += 1) {
      const offset = this.reflection[index] * (this.left[index] + this.right[index - 1]);
      this.leftJunction[index] = this.left[index] + offset;
      this.rightJunction[index] = this.right[index - 1] - offset;
    }
    for (let index = 0; index < NOSE_LENGTH; index += 1) {
      this.left[index] = cleanWave(this.leftJunction[index + 1] * TUBE_LOSS);
      this.right[index] = cleanWave(this.rightJunction[index] * TUBE_LOSS);
    }
    return this.right[NOSE_LENGTH - 1] * clamp(this.opening * 3.2);
  }

  reset() {
    this.right.fill(0);
    this.left.fill(0);
    this.rightJunction.fill(0);
    this.leftJunction.fill(0);
  }

  isFinite() {
    return arraysAreFinite([this.right, this.left, this.rightJunction, this.leftJunction]);
  }
}

class MouthAirway {
  constructor(index) {
    this.index = index;
    this.activeTarget = index === 0 ? 1 : 0;
    this.activity = this.activeTarget;
    this.clearedWhileInactive = !this.activity;
    this.gated = false;
    this.right = new Float64Array(MOUTH_LENGTH);
    this.left = new Float64Array(MOUTH_LENGTH);
    this.rightJunction = new Float64Array(MOUTH_LENGTH + 1);
    this.leftJunction = new Float64Array(MOUTH_LENGTH + 1);
    this.diameter = new Float64Array(MOUTH_LENGTH);
    this.targetDiameter = new Float64Array(MOUTH_LENGTH);
    this.area = new Float64Array(MOUTH_LENGTH);
    this.reflection = new Float64Array(MOUTH_LENGTH + 1);
    this.noses = Array.from(
      { length: MAX_NOSES },
      (_, noseIndex) => new NasalAirway(noseIndex),
    );
    this.noseIncoming = new Float64Array(MAX_NOSES + 2);
    this.noseAreas = new Float64Array(MAX_NOSES + 2);
    this.noseOutgoing = new Float64Array(MAX_NOSES + 2);
    this.noseStart = 17 - ROOT_LENGTH;
    this.pan = 0;
    this.constrictionIndex = 22 - ROOT_LENGTH;
    this.targetConstrictionDiameter = 3;
    this.frication = 0;
    this.fricationEnvelope = 0;
    this.pressure = 0;
    this.pressureEnergy = 0;
    this.actuallySealed = false;
    this.closureIndex = this.constrictionIndex;
    this.transientAge = 1;
    this.transientStrength = 0;
    this.pendingTransientStrength = 0;
    this.lastOutput = 0;
    this.configure({}, index, true);
  }

  get participating() {
    return this.activeTarget > 0 || this.activity > 0.0001;
  }

  get incomingAtManifold() {
    return this.left[0];
  }

  get manifoldArea() {
    return Math.max(AREA_MINIMUM, this.area[0] * Math.max(0.0001, this.activity));
  }

  configure(config, index, immediate = false) {
    const mouths = config.mouths ?? config.throats ?? [];
    const count = integer(config.mouthCount ?? config.throatCount, 1, MAX_MOUTHS, 1);
    const mouth = mouths[index] ?? {};
    const articulateThisMouth = Boolean(config.articulateAll) || index === integer(
      config.selectedMouth,
      0,
      MAX_MOUTHS - 1,
      0,
    );
    const aperture = articulateThisMouth
      ? unit(config.articulationAperture, 1 - unit(config.oralClosure))
      : 0.98;
    this.activeTarget = index < count ? 1 : 0;
    if (immediate) this.activity = this.activeTarget;
    this.gated = Boolean(mouth.closed ?? mouth.muted);
    this.pan = count <= 1
      ? 0
      : clamp((index / (count - 1)) * 2 - 1) * unit(config.spread, 0.8);
    this.constrictionIndex = clamp(
      articulationIndex(config) - ROOT_LENGTH,
      1,
      MOUTH_LENGTH - 2,
    );
    this.targetConstrictionDiameter = constrictionDiameter(aperture);
    this.buildTargetDiameter(config, mouth, index, articulateThisMouth);
    for (let noseIndex = 0; noseIndex < MAX_NOSES; noseIndex += 1) {
      this.noses[noseIndex].configure(config, index, noseIndex, immediate);
    }
    if (immediate) this.diameter.set(this.targetDiameter);
    updateTubeReflections(this.diameter, this.area, this.reflection);
  }

  buildTargetDiameter(config, mouth, mouthIndex, articulateThisMouth) {
    const bodyLength = unit(config.bodyLength, 0.56);
    const mouthAperture = unit(mouth.aperture, 0.5);
    const mouthLength = unit(mouth.length, 0.5);
    const mutation = unit(config.mutation, 0.3);
    const classicTopology = Boolean(config.classicTopology);
    const scale = classicTopology
      ? 1 + (bodyLength - 0.55) * 0.13 + (mouthLength - 0.56) * 0.08
      : 0.92 + bodyLength * 0.13 + mouthLength * 0.08;
    for (let localIndex = 0; localIndex < MOUTH_LENGTH; localIndex += 1) {
      const globalIndex = localIndex + ROOT_LENGTH;
      const base = globalIndex < 12
        ? classicTopology ? 1.1 : 1.08
        : 1.5;
      const lipProgress = clamp((globalIndex - 35) / 8);
      const individualWarp = 1 + Math.sin(
        (mouthIndex + 1) * 1.93 + globalIndex * 0.31,
      ) * mutation * 0.025;
      this.targetDiameter[localIndex] = Math.max(
        DIAMETER_MINIMUM,
        base
          * scale
          * individualWarp
          * (1 - lipProgress * (1 - mouthAperture) * 0.68),
      );
    }

    const tongues = config.tongues ?? [];
    const tongueCount = integer(
      config.tongueCount,
      1,
      MAX_TONGUES,
      tongues.length || 1,
    );
    for (let tongueNumber = 0; tongueNumber < tongueCount; tongueNumber += 1) {
      const tongue = tongues[tongueNumber] ?? tongues[0] ?? {};
      const tonguePosition = unit(tongue.position, 0.38);
      const tongueHeight = unit(tongue.height, 0.18);
      const tongueDiameter = 3.5 - tongueHeight * 1.45;
      const tongueIndex = 12.9 + tonguePosition * 17.5;
      for (let globalIndex = 10; globalIndex < 39; globalIndex += 1) {
        if (globalIndex < ROOT_LENGTH) continue;
        const localIndex = globalIndex - ROOT_LENGTH;
        const interpolation = (tongueIndex - globalIndex) / 22;
        const angle = 1.1 * Math.PI * interpolation;
        const normalizedDiameter = 2 + (tongueDiameter - 2) / 1.5;
        let curve = (1.5 - normalizedDiameter + 1.7) * Math.cos(angle);
        if (globalIndex === 38) curve *= 0.8;
        if (globalIndex === 10 || globalIndex === 37) curve *= 0.94;
        const individualWarp = 1 + Math.sin(
          (mouthIndex + 1) * 1.93 + globalIndex * 0.31,
        ) * mutation * 0.025;
        const tongueShape = Math.max(
          DIAMETER_MINIMUM,
          (1.5 - curve)
            * scale
            * individualWarp
            * (1 - clamp((globalIndex - 35) / 8) * (1 - mouthAperture) * 0.68),
        );
        // Pink Trombone's vowel model replaces the neutral tube with the
        // tongue curve. Clipping it with Math.min() removes every widened
        // cavity and collapses the vowel formants. Extra alien tongues still
        // combine as additional constrictions.
        this.targetDiameter[localIndex] = tongueNumber === 0
          ? tongueShape
          : Math.min(this.targetDiameter[localIndex], tongueShape);
      }
    }

    const tractDeformations = config.tractDeformations ?? [];
    for (let localIndex = 0; localIndex < MOUTH_LENGTH; localIndex += 1) {
      const globalIndex = localIndex + ROOT_LENGTH;
      let displacement = 0;
      for (const deformation of tractDeformations) {
        const center = Number(deformation?.center);
        const radius = Math.max(0.0001, Number(deformation?.radius) || 0);
        const height = Number(deformation?.height);
        const strength = Number.isFinite(Number(deformation?.strength))
          ? Number(deformation.strength)
          : 1;
        if (!Number.isFinite(center) || !Number.isFinite(height)) continue;
        const distance = Math.abs(globalIndex - center);
        if (distance >= radius) continue;
        const weight = 0.5 * (1 + Math.cos(Math.PI * distance / radius));
        displacement += height * strength * weight;
      }
      this.targetDiameter[localIndex] = clamp(
        this.targetDiameter[localIndex] + displacement,
        DIAMETER_MINIMUM,
        4,
      );
    }

    const requestedLipDiameter = Number(config.lipDiameter);
    const lipDiameter = Number.isFinite(requestedLipDiameter)
      ? clamp(requestedLipDiameter, 0.35, 3)
      : 3;
    if (lipDiameter < 2.5) {
      for (let globalIndex = 37; globalIndex < FULL_TRACT_LENGTH; globalIndex += 1) {
        const localIndex = globalIndex - ROOT_LENGTH;
        const distance = Math.abs(globalIndex - 41);
        const blend = distance >= 4
          ? 0
          : 0.5 * (1 + Math.cos(Math.PI * distance / 4));
        const current = this.targetDiameter[localIndex];
        const rounded = current + (lipDiameter - current) * blend;
        this.targetDiameter[localIndex] = Math.max(
          DIAMETER_MINIMUM,
          Math.min(current, rounded),
        );
      }
    }

    if (articulateThisMouth && this.targetConstrictionDiameter < 3) {
      const center = this.constrictionIndex;
      const globalCenter = center + ROOT_LENGTH;
      const radius = globalCenter < 25
        ? 10
        : globalCenter >= 32
          ? 5
          : 10 - 5 * (globalCenter - 25) / 7;
      const start = Math.max(1, Math.floor(center - radius - 1));
      const end = Math.min(MOUTH_LENGTH - 1, Math.ceil(center + radius + 1));
      for (let localIndex = start; localIndex <= end; localIndex += 1) {
        const offset = Math.max(0, Math.abs(localIndex - center) - 0.5);
        const scalar = offset >= radius
          ? 1
          : 0.5 * (1 - Math.cos(Math.PI * offset / radius));
        const difference = this.targetDiameter[localIndex]
          - this.targetConstrictionDiameter;
        if (difference > 0) {
          this.targetDiameter[localIndex] = Math.max(
            DIAMETER_MINIMUM,
            this.targetConstrictionDiameter + difference * scalar,
          );
        }
      }
    }

    if (this.gated) {
      this.targetDiameter[MOUTH_GATE_INDEX - 1] = Math.min(
        this.targetDiameter[MOUTH_GATE_INDEX - 1],
        0.11,
      );
      this.targetDiameter[MOUTH_GATE_INDEX] = DIAMETER_MINIMUM;
      this.targetDiameter[MOUTH_GATE_INDEX + 1] = Math.min(
        this.targetDiameter[MOUTH_GATE_INDEX + 1],
        0.11,
      );
    }

    const thinness = clamp(8 * (0.7 - this.targetConstrictionDiameter));
    const openness = clamp(30 * (this.targetConstrictionDiameter - 0.3));
    const requestedFrication = Number(config.fricationGain);
    const fricationGain = Number.isFinite(requestedFrication)
      ? clamp(requestedFrication, 0, 1.5)
      : 1;
    this.frication = articulateThisMouth
      ? thinness * openness * fricationGain
      : 0;
  }

  prepareBlock(frameCount) {
    this.pendingTransientStrength = 0;
    this.activity += (this.activeTarget - this.activity) * blockAlpha(frameCount, 42);
    if (smoothMouthTube(this.diameter, this.targetDiameter, frameCount)) {
      updateTubeReflections(this.diameter, this.area, this.reflection);
    }
    for (const nose of this.noses) nose.prepareBlock(frameCount);

    const oralIndex = Math.round(this.constrictionIndex);
    const oralDiameter = this.diameter[oralIndex];
    const gateDiameter = this.diameter[MOUTH_GATE_INDEX];
    const actualDiameter = Math.min(oralDiameter, gateDiameter);
    const actualClosureIndex = gateDiameter <= oralDiameter
      ? MOUTH_GATE_INDEX
      : oralIndex;
    if (!this.actuallySealed && actualDiameter <= 0.03) {
      this.actuallySealed = true;
      this.closureIndex = actualClosureIndex;
    } else if (this.actuallySealed && actualDiameter >= 0.12) {
      this.actuallySealed = false;
      const nasalArea = this.noses.reduce(
        (sum, nose) => sum + (nose.active ? nose.junctionArea : 0),
        0,
      );
      if (nasalArea < 0.05 && this.pressureEnergy > 0.0000001) {
        this.pendingTransientStrength = clamp(
          Math.sqrt(this.pressureEnergy) * 0.72,
        );
      }
      this.pressureEnergy *= 0.18;
      this.pressure *= 0.3;
    }

    if (this.activity < 0.00001 && this.activeTarget === 0) {
      if (!this.clearedWhileInactive) {
        this.resetWaveState();
        this.clearedWhileInactive = true;
      }
    } else {
      this.clearedWhileInactive = false;
    }
    return this.pendingTransientStrength > 0;
  }

  commitPendingRelease(scale = 1) {
    if (this.pendingTransientStrength <= 0) return;
    this.transientAge = 0;
    this.transientStrength = this.pendingTransientStrength * scale;
    this.pendingTransientStrength = 0;
  }

  injectFrication(noise, modulator) {
    const target = this.frication;
    this.fricationEnvelope += (target - this.fricationEnvelope) * timeAlpha(100);
    if (this.fricationEnvelope <= 0.0001 || modulator <= 0.0001) return;
    const turbulence = noise * modulator * this.fricationEnvelope * 0.38;
    const lower = Math.floor(this.constrictionIndex);
    const fraction = this.constrictionIndex - lower;
    const firstIndex = Math.min(MOUTH_LENGTH - 1, lower + 1);
    const secondIndex = Math.min(MOUTH_LENGTH - 1, lower + 2);
    const first = turbulence * (1 - fraction);
    const second = turbulence * fraction;
    this.right[firstIndex] += first;
    this.left[firstIndex] += first;
    this.right[secondIndex] += second;
    this.left[secondIndex] += second;
  }

  injectTransient(noise) {
    if (this.transientAge >= 0.2 || this.transientStrength <= 0) return;
    const envelope = this.transientStrength * 2 ** (-this.transientAge * 200);
    const localIndex = Math.round(this.closureIndex);
    const shaped = envelope * (0.64 + noise * 0.36);
    this.left[localIndex] += shaped * 0.5;
    this.right[localIndex] += shaped * 0.5;
    this.transientAge += 1 / (sampleRate * SUBSTEPS);
  }

  updatePressure() {
    if (this.actuallySealed) {
      const upstream = Math.max(0, Math.min(MOUTH_LENGTH - 1, this.closureIndex - 1));
      const pressureWave = this.right[upstream] + this.left[upstream];
      const energy = pressureWave * pressureWave
        / Math.max(AREA_MINIMUM, this.area[upstream]);
      this.pressureEnergy += (energy - this.pressureEnergy) * timeAlpha(38);
    } else {
      this.pressureEnergy *= 1 - timeAlpha(75);
    }
    const target = clamp(1 - Math.exp(-Math.sqrt(Math.max(0, this.pressureEnergy)) * 0.9));
    this.pressure += (target - this.pressure) * timeAlpha(26);
  }

  process(manifoldInput, noise, sourceModulator) {
    if (!this.participating) return 0;
    this.injectFrication(noise, sourceModulator);
    this.injectTransient(noise);
    this.updatePressure();

    this.rightJunction[0] = manifoldInput;
    this.leftJunction[MOUTH_LENGTH] = this.right[MOUTH_LENGTH - 1] * LIP_REFLECTION;
    for (let index = 1; index < MOUTH_LENGTH; index += 1) {
      if (index === this.noseStart) continue;
      const offset = this.reflection[index] * (this.right[index - 1] + this.left[index]);
      this.rightJunction[index] = this.right[index - 1] - offset;
      this.leftJunction[index] = this.left[index] + offset;
    }

    const junction = this.noseStart;
    let portCount = 2;
    this.noseIncoming[0] = this.right[junction - 1];
    this.noseIncoming[1] = this.left[junction];
    this.noseAreas[0] = this.area[junction];
    this.noseAreas[1] = this.area[junction + 1];
    for (const nose of this.noses) {
      this.noseIncoming[portCount] = nose.incomingAtJunction;
      this.noseAreas[portCount] = nose.junctionArea;
      portCount += 1;
    }
    scatterFlowPorts(
      this.noseIncoming,
      this.noseAreas,
      this.noseOutgoing,
      portCount,
    );
    this.leftJunction[junction] = this.noseOutgoing[0];
    this.rightJunction[junction] = this.noseOutgoing[1];

    for (let index = 0; index < MOUTH_LENGTH; index += 1) {
      this.right[index] = cleanWave(this.rightJunction[index] * TUBE_LOSS);
      this.left[index] = cleanWave(this.leftJunction[index + 1] * TUBE_LOSS);
    }

    let noseOutput = 0;
    for (let noseIndex = 0; noseIndex < this.noses.length; noseIndex += 1) {
      noseOutput += this.noses[noseIndex].process(this.noseOutgoing[noseIndex + 2]);
    }
    const mouthOutput = this.right[MOUTH_LENGTH - 1];
    this.lastOutput = (mouthOutput + noseOutput) * this.activity;
    return this.lastOutput;
  }

  resetWaveState() {
    for (const array of [
      this.right,
      this.left,
      this.rightJunction,
      this.leftJunction,
    ]) array.fill(0);
    for (const nose of this.noses) nose.reset();
    this.pressure = 0;
    this.pressureEnergy = 0;
    this.actuallySealed = false;
    this.transientAge = 1;
    this.transientStrength = 0;
    this.pendingTransientStrength = 0;
    this.fricationEnvelope = 0;
    this.lastOutput = 0;
  }

  isFinite() {
    return Number.isFinite(this.pressure)
      && Number.isFinite(this.pressureEnergy)
      && arraysAreFinite([
        this.right,
        this.left,
        this.rightJunction,
        this.leftJunction,
      ])
      && this.noses.every((nose) => nose.isFinite());
  }
}

class ThroatazoidTractProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.root = new RootAirway();
    this.glands = Array.from(
      { length: MAX_PRESSURE_SOURCES },
      (_, index) => new PressureGland(index),
    );
    this.mouths = Array.from(
      { length: MAX_MOUTHS },
      (_, index) => new MouthAirway(index),
    );
    this.sourceHubIncoming = new Float64Array(MAX_PRESSURE_SOURCES + 1);
    this.sourceHubAreas = new Float64Array(MAX_PRESSURE_SOURCES + 1);
    this.sourceHubOutgoing = new Float64Array(MAX_PRESSURE_SOURCES + 1);
    this.sourceDrive = new Float64Array(MAX_PRESSURE_SOURCES);
    this.sourcePortIndex = new Int8Array(MAX_PRESSURE_SOURCES);
    this.mouthIncoming = new Float64Array(MAX_MOUTHS + 1);
    this.mouthAreas = new Float64Array(MAX_MOUTHS + 1);
    this.mouthOutgoing = new Float64Array(MAX_MOUTHS + 1);
    this.mouthPortIndex = new Int8Array(MAX_MOUTHS);
    this.config = {};
    this.seed = 0x7f4a7c15;
    this.blockCount = 0;
    this.driveMagnitude = 0;
    this.airflowEnvelope = 0;
    this.configure({});
    this.port.onmessage = (event) => {
      if (event.data?.type === "configure") this.configure(event.data.state ?? {});
    };
  }

  configure(config) {
    this.config = config;
    this.root.configure(config);
    for (let index = 0; index < MAX_MOUTHS; index += 1) {
      this.mouths[index].configure(config, index);
    }
    const sourceCount = integer(
      config.pressureSourceCount,
      1,
      MAX_PRESSURE_SOURCES,
      1,
    );
    const sources = config.pressureSources ?? [];
    for (let index = 0; index < MAX_PRESSURE_SOURCES; index += 1) {
      this.glands[index].configure(sources[index] ?? {}, index < sourceCount);
    }
  }

  noise() {
    let value = this.seed >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.seed = value >>> 0;
    return this.seed / 0x80000000 - 1;
  }

  scatterSourceHub(rawSource) {
    this.sourceHubIncoming[0] = this.root.incomingAtSourceHub;
    this.sourceHubAreas[0] = this.root.sourceHubArea;
    this.sourcePortIndex.fill(-1);
    let portCount = 1;
    let gainSum = 0;
    for (let index = 0; index < MAX_PRESSURE_SOURCES; index += 1) {
      const gland = this.glands[index];
      const gain = gland.advanceControl();
      this.sourceDrive[index] = gland.connected ? gain : 0;
      if (!gland.connected) continue;
      gainSum += Math.abs(gain);
      this.sourcePortIndex[index] = portCount;
      this.sourceHubIncoming[portCount] = gland.incomingAtHub;
      this.sourceHubAreas[portCount] = gland.hubArea;
      portCount += 1;
    }
    const normalization = Math.max(1, gainSum);
    this.driveMagnitude = 0;
    for (let index = 0; index < MAX_PRESSURE_SOURCES; index += 1) {
      this.sourceDrive[index] = rawSource * this.sourceDrive[index] / normalization;
      this.driveMagnitude += Math.abs(this.sourceDrive[index]);
    }
    scatterFlowPorts(
      this.sourceHubIncoming,
      this.sourceHubAreas,
      this.sourceHubOutgoing,
      portCount,
    );
  }

  scatterMouthManifold() {
    const coupling = clamp(unit(this.config.coupling, 0.36) / 0.72);
    const participatingMouths = this.mouths.reduce(
      (sum, mouth) => sum + (mouth.participating ? 1 : 0),
      0,
    );
    // A single mouth is one continuous tract, not a cross-coupled network.
    // Attenuating its returning wave breaks the resonator and masks vowels.
    const returnScale = participatingMouths <= 1
      ? 1
      : 0.12 + coupling * 0.88;
    this.mouthIncoming[0] = this.root.incomingAtMouthManifold;
    this.mouthAreas[0] = this.root.mouthManifoldArea;
    let portCount = 1;
    this.mouthPortIndex.fill(-1);
    for (let mouthIndex = 0; mouthIndex < MAX_MOUTHS; mouthIndex += 1) {
      const mouth = this.mouths[mouthIndex];
      if (!mouth.participating) continue;
      this.mouthPortIndex[mouthIndex] = portCount;
      this.mouthIncoming[portCount] = mouth.incomingAtManifold * returnScale;
      this.mouthAreas[portCount] = mouth.manifoldArea;
      portCount += 1;
    }
    scatterFlowPorts(
      this.mouthIncoming,
      this.mouthAreas,
      this.mouthOutgoing,
      portCount,
    );
  }

  resetNetwork() {
    this.root.reset();
    for (const gland of this.glands) gland.reset();
    for (const mouth of this.mouths) mouth.resetWaveState();
    this.sourceHubIncoming.fill(0);
    this.sourceHubOutgoing.fill(0);
    this.sourceDrive.fill(0);
    this.mouthIncoming.fill(0);
    this.mouthOutgoing.fill(0);
    this.driveMagnitude = 0;
    this.airflowEnvelope = 0;
  }

  networkIsFinite() {
    return this.root.isFinite()
      && this.glands.every((gland) => gland.isFinite())
      && this.mouths.every((mouth) => mouth.isFinite());
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1] ?? left;
    if (!left || !right) return true;

    this.root.prepareBlock(left.length);
    let releaseCount = 0;
    for (const mouth of this.mouths) {
      if (mouth.prepareBlock(left.length)) releaseCount += 1;
    }
    const releaseScale = 1 / Math.sqrt(Math.max(1, releaseCount));
    for (const mouth of this.mouths) mouth.commitPendingRelease(releaseScale);
    const performanceGate = unit(this.config.performanceGate, 1);
    const articulationVoicing = unit(this.config.articulationVoicing, 0.94);
    const exciterIntensity = unit(this.config.exciterIntensity, 0.72);
    const classicDirect = Boolean(this.config.classicTopology)
      && integer(this.config.mouthCount ?? this.config.throatCount, 1, MAX_MOUTHS, 1) === 1
      && integer(this.config.pressureSourceCount, 1, MAX_PRESSURE_SOURCES, 1) === 1;
    const effectiveMouths = Math.max(
      1,
      this.mouths.reduce(
        (sum, mouth) => sum + mouth.activity * mouth.activity,
        0,
      ),
    );
    const outputScale = 1.12 / Math.sqrt(effectiveMouths);

    for (let sampleIndex = 0; sampleIndex < left.length; sampleIndex += 1) {
      const rawSource = (input?.[sampleIndex] ?? 0) * performanceGate;
      const airflowTarget = clamp(Math.abs(rawSource) * 7.5);
      const airflowMilliseconds = airflowTarget > this.airflowEnvelope ? 18 : 100;
      this.airflowEnvelope += (airflowTarget - this.airflowEnvelope)
        * timeAlpha(airflowMilliseconds, sampleRate);
      let leftAccumulator = 0;
      let rightAccumulator = 0;

      for (let substep = 0; substep < SUBSTEPS; substep += 1) {
        if (classicDirect) {
          this.scatterMouthManifold();
          let classicSourceGain = 0;
          for (let index = 0; index < this.glands.length; index += 1) {
            const gland = this.glands[index];
            const gain = gland.advanceControl();
            if (index === 0 && gland.connected) classicSourceGain = gain;
            gland.process(0, 0);
          }
          const classicDrive = rawSource * classicSourceGain;
          this.driveMagnitude = Math.abs(classicDrive);
          this.root.process(
            this.root.incomingAtSourceHub * GLOTTAL_REFLECTION + classicDrive,
            this.mouthOutgoing[0],
          );
        } else {
          this.scatterSourceHub(rawSource);
          this.scatterMouthManifold();
          this.root.process(this.sourceHubOutgoing[0], this.mouthOutgoing[0]);
          for (let index = 0; index < MAX_PRESSURE_SOURCES; index += 1) {
            const portIndex = this.sourcePortIndex[index];
            this.glands[index].process(
              this.sourceDrive[index],
              portIndex > 0 ? this.sourceHubOutgoing[portIndex] : 0,
            );
          }
        }

        const sourceModulator = clamp(Math.max(
          this.driveMagnitude * 4,
          this.airflowEnvelope
            * exciterIntensity
            * (0.72 + (1 - articulationVoicing) * 0.78),
        ));
        const noise = this.noise();
        for (let mouthIndex = 0; mouthIndex < MAX_MOUTHS; mouthIndex += 1) {
          const mouth = this.mouths[mouthIndex];
          if (!mouth.participating) continue;
          const portIndex = this.mouthPortIndex[mouthIndex];
          const directVoice = (
            inputs[mouthIndex + 1]?.[0]?.[sampleIndex] ?? 0
          ) * performanceGate;
          const sample = mouth.process(
            (portIndex > 0 ? this.mouthOutgoing[portIndex] : 0) + directVoice,
            noise,
            clamp(sourceModulator + Math.abs(directVoice) * 4),
          );
          const panAngle = (mouth.pan + 1) * Math.PI * 0.25;
          leftAccumulator += sample * Math.cos(panAngle);
          rightAccumulator += sample * Math.sin(panAngle);
        }
      }

      const leftSample = Math.tanh(leftAccumulator / SUBSTEPS * outputScale);
      const rightSample = Math.tanh(rightAccumulator / SUBSTEPS * outputScale);
      if (
        !Number.isFinite(leftSample)
        || !Number.isFinite(rightSample)
        || (sampleIndex % 32 === 0 && !this.networkIsFinite())
      ) {
        this.resetNetwork();
        left[sampleIndex] = 0;
        right[sampleIndex] = 0;
      } else {
        left[sampleIndex] = leftSample;
        right[sampleIndex] = rightSample;
      }
    }

    this.blockCount += 1;
    if (this.blockCount % 18 === 0) {
      const mouthPressures = this.mouths.map((mouth) => (
        mouth.participating ? clamp(mouth.pressure) : 0
      ));
      const sourcePressures = this.glands.map((gland) => clamp(gland.pressure));
      if (classicDirect) {
        sourcePressures[0] = clamp(Math.max(sourcePressures[0], this.driveMagnitude * 4));
      }
      const rootPressure = clamp(
        this.root.pressure()
          + Math.max(0, ...mouthPressures) * 0.68,
      );
      this.port.postMessage({
        type: "pressure",
        value: rootPressure,
        mouths: mouthPressures,
        sources: sourcePressures,
      });
    }
    return true;
  }
}

registerProcessor("throatazoid-tract", ThroatazoidTractProcessor);
