import {
  HAMBONE_DEFAULTS,
  HAMBONE_TRACT_SECTION_COUNT,
  hamboneGestureFrame,
  hamboneSound,
  hamboneTargetOralDiameters,
  physicalVoiceParameters,
  sanitizeHamboneState,
} from "./hambone.js";

// Hambone's tract is a single, persistent Kelly-Lochbaum volume-flow tube.
// The scattering convention, losses, and 44-section source geometry follow
// Morphazoid's Throatazoid/Pink Trombone lineage; gestures move the same tube
// instead of instantiating independent filtered voices.
const SUBSTEPS = 2;
const SPEED_OF_SOUND_MPS = 343;
const MAX_ORAL_SECTIONS = 152;
const MAX_TRACT_LENGTH_M = 0.52;
const MIN_ORAL_SECTIONS = 10;
const NOSE_SECTIONS = 28;
const CHEEK_SECTIONS = 18;
// Pure gesture/geometry helpers intentionally allocate immutable structures.
// Sampling them every 2/3 ms is ample because every tube diameter continues
// toward those targets at the two-times-audio-rate propagation cadence.
const CONTROL_INTERVAL_FRAMES = 32;
const TELEMETRY_BLOCKS = 12;
const GLOTTAL_REFLECTION = 0.75;
const LIP_REFLECTION = -0.85;
const NOSE_REFLECTION = -0.82;
const TUBE_LOSS = 0.9988;
const JUNCTION_LOSS = 0.999;
const AREA_MINIMUM = 0.000001;
const DIAMETER_MINIMUM = 0.001;
const REFLECTION_LIMIT = 0.9995;
const DENORMAL_LIMIT = 1e-20;
const OUTPUT_CEILING = 0.72;

const RELEASE_PHASES = Object.freeze({
  bop: 0.35,
  boop: 0.43,
  pop: 0.415,
  tlik: 0.545,
  shh: 0.22,
  shack: 0.08,
  slap: 0.09,
  pff: 0.18,
  kick: 0.07,
  smack: 0.075,
  hee: 0.035,
  haw: 0.04,
  doo: 0.035,
  mwah: 0.535,
  drr: 0.045,
  burp: 0.04,
});

const LIVE_PREPARATION_SECONDS = Object.freeze({
  bop: 0.016,
  boop: 0.02,
  pop: 0.018,
  tlik: 0.024,
  shh: 0.014,
  shack: 0.01,
  slap: 0.006,
  pff: 0.022,
  kick: 0.006,
  smack: 0.006,
  hee: 0.012,
  haw: 0.012,
  doo: 0.012,
  mwah: 0.025,
  drr: 0.014,
  burp: 0.016,
});

const finite = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, finite(value, minimum)))
);

const cleanWave = (value) => (
  !Number.isFinite(value) || Math.abs(value) < DENORMAL_LIMIT ? 0 : value
);

const safeArea = (diameter) => Math.max(
  AREA_MINIMUM,
  finite(diameter, DIAMETER_MINIMUM) ** 2,
);

const timeAlpha = (milliseconds, rate) => (
  1 - Math.exp(-1 / Math.max(1, rate * milliseconds / 1_000))
);

const smoothstep = (value) => {
  const amount = clamp(value);
  return amount * amount * (3 - 2 * amount);
};

function xorshift(value) {
  let state = value | 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state | 0;
}

function arraysAreFinite(arrays, lengths = []) {
  for (let arrayIndex = 0; arrayIndex < arrays.length; arrayIndex += 1) {
    const values = arrays[arrayIndex];
    const length = lengths[arrayIndex] ?? values.length;
    for (let index = 0; index < length; index += 1) {
      if (!Number.isFinite(values[index])) return false;
    }
  }
  return true;
}

// The ears and eyes are global face parameters, so this stage follows the
// single resonating tract instead of spawning effect voices per gesture.
// Ears create two unequal, feed-forward acoustic paths; divergent eyes open a
// restrained cross-fed room whose feedback is hard-bounded below unity.
class FaceSpace {
  constructor(rate) {
    this.rate = rate;
    this.earBuffer = new Float64Array(Math.ceil(rate * 0.024) + 4);
    this.eyeLeftBuffer = new Float64Array(Math.ceil(rate * 0.19) + 4);
    this.eyeRightBuffer = new Float64Array(Math.ceil(rate * 0.19) + 4);
    this.earIndex = 0;
    this.eyeIndex = 0;
    this.earAmount = 0;
    this.eyeAmount = 0;
    this.eyeDampedLeft = 0;
    this.eyeDampedRight = 0;
    this.left = 0;
    this.right = 0;
    this.stereoDelayMs = 0;
  }

  _tap(buffer, writeIndex, delayFrames) {
    const length = buffer.length;
    const position = (writeIndex - delayFrames + length) % length;
    const lower = Math.floor(position);
    const upper = (lower + 1) % length;
    const mix = position - lower;
    return buffer[lower] + (buffer[upper] - buffer[lower]) * mix;
  }

  process(left, right, configuration) {
    const earTarget = clamp(finite(configuration?.earSpread, 0));
    const eyeTarget = clamp(finite(configuration?.eyeDivergence, 0));
    this.earAmount += (earTarget - this.earAmount) * timeAlpha(24, this.rate);
    this.eyeAmount += (eyeTarget - this.eyeAmount) * timeAlpha(36, this.rate);

    const mono = cleanWave((left + right) * Math.SQRT1_2);
    this.earBuffer[this.earIndex] = clamp(mono, -1.5, 1.5);
    const nearDelayFrames = this.rate * (0.0007 + this.earAmount * 0.0018);
    const farDelayFrames = this.rate * (
      0.0014 + this.earAmount * this.earAmount * 0.016
    );
    const near = this._tap(this.earBuffer, this.earIndex, nearDelayFrames) * Math.SQRT1_2;
    const far = this._tap(this.earBuffer, this.earIndex, farDelayFrames) * Math.SQRT1_2;
    const earWet = this.earAmount * 0.66;
    const earLeft = cleanWave(left * (1 - earWet) + near * earWet);
    const earRight = cleanWave(right * (1 - earWet) + far * earWet);
    this.stereoDelayMs = (farDelayFrames - nearDelayFrames) / this.rate * 1_000;
    this.earIndex = (this.earIndex + 1) % this.earBuffer.length;

    const leftDelayFrames = this.rate * (0.047 + this.eyeAmount * 0.012);
    const rightDelayFrames = this.rate * (0.071 + this.eyeAmount * 0.017);
    const reflectedLeft = this._tap(this.eyeLeftBuffer, this.eyeIndex, leftDelayFrames);
    const reflectedRight = this._tap(this.eyeRightBuffer, this.eyeIndex, rightDelayFrames);
    this.eyeDampedLeft += (reflectedLeft - this.eyeDampedLeft) * 0.18;
    this.eyeDampedRight += (reflectedRight - this.eyeDampedRight) * 0.15;
    const feedback = 0.22 + this.eyeAmount * 0.38;
    this.eyeLeftBuffer[this.eyeIndex] = clamp(
      earLeft * 0.2 + this.eyeDampedRight * feedback,
      -1.5,
      1.5,
    );
    this.eyeRightBuffer[this.eyeIndex] = clamp(
      earRight * 0.2 + this.eyeDampedLeft * feedback,
      -1.5,
      1.5,
    );
    this.eyeIndex = (this.eyeIndex + 1) % this.eyeLeftBuffer.length;
    const eyeWet = this.eyeAmount * 0.3;
    this.left = cleanWave(earLeft + this.eyeDampedLeft * eyeWet);
    this.right = cleanWave(earRight + this.eyeDampedRight * eyeWet);
  }

  reset() {
    this.earBuffer.fill(0);
    this.eyeLeftBuffer.fill(0);
    this.eyeRightBuffer.fill(0);
    this.earIndex = 0;
    this.eyeIndex = 0;
    this.earAmount = 0;
    this.eyeAmount = 0;
    this.eyeDampedLeft = 0;
    this.eyeDampedRight = 0;
    this.left = 0;
    this.right = 0;
    this.stereoDelayMs = 0;
  }

  isFinite() {
    return Number.isFinite(this.earAmount)
      && Number.isFinite(this.eyeAmount)
      && Number.isFinite(this.eyeDampedLeft)
      && Number.isFinite(this.eyeDampedRight)
      && Number.isFinite(this.left)
      && Number.isFinite(this.right);
  }
}

function updateReflections(diameter, area, reflection, length) {
  for (let index = 0; index < length; index += 1) {
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

function resample(values, position) {
  const maximum = Math.max(0, values.length - 1);
  const index = clamp(position, 0, maximum);
  const lower = Math.floor(index);
  const upper = Math.min(maximum, lower + 1);
  const mix = index - lower;
  return finite(values[lower], DIAMETER_MINIMUM)
    + (finite(values[upper], DIAMETER_MINIMUM) - finite(values[lower], DIAMETER_MINIMUM)) * mix;
}

function mappedConstrictionIndex(position, sectionCount) {
  // hamboneTargetOralDiameters maps its normalized articulation domain across
  // canonical sections 2..41, leaving the glottal and lip boundaries intact.
  // Use the identical mapping after delay-line resampling so pressure storage,
  // turbulence, and telemetry follow the actual geometric minimum.
  const canonical = 2 + clamp(finite(position, 0.5)) * (HAMBONE_TRACT_SECTION_COUNT - 4);
  return clamp(
    Math.round(canonical / (HAMBONE_TRACT_SECTION_COUNT - 1) * (sectionCount - 1)),
    1,
    sectionCount - 2,
  );
}

// Liljencrants-Fant glottal pulse, matching the implementation used by
// Throatazoid. Coefficients are calculated once per gesture, not per sample.
function glottalCoefficients(tenseness = 0.6) {
  const value = clamp(tenseness);
  const rd = clamp(3 * (1 - value), 0.5, 2.7);
  const ra = -0.01 + 0.048 * rd;
  const rk = 0.224 + 0.118 * rd;
  const rg = ((rk / 4) * (0.5 + 1.2 * rk)) / (0.11 * rd - ra * (0.5 + 1.2 * rk));
  const tp = 1 / (2 * rg);
  const te = tp * (1 + rk);
  const epsilon = 1 / ra;
  const shift = Math.exp(-epsilon * (1 - te));
  const delta = 1 - shift;
  const rhs = ((shift - 1) / epsilon + (1 - te) * shift) / delta;
  const lowerIntegral = -(te - tp) / 2 + rhs;
  const upperIntegral = -lowerIntegral;
  const omega = Math.PI / tp;
  const sineAtClosure = Math.sin(omega * te);
  const logarithmInput = Math.max(
    1e-8,
    (-Math.PI * sineAtClosure * upperIntegral) / (tp * 2),
  );
  const alpha = Math.log(logarithmInput) / (tp / 2 - te);
  const e0 = -1 / (sineAtClosure * Math.exp(alpha * te));
  return { alpha, delta, e0, epsilon, omega, shift, te };
}

function glottalSample(phase, coefficients) {
  const interpolation = ((phase % 1) + 1) % 1;
  if (interpolation > coefficients.te) {
    return (
      -Math.exp(-coefficients.epsilon * (interpolation - coefficients.te))
      + coefficients.shift
    ) / coefficients.delta;
  }
  return coefficients.e0
    * Math.exp(coefficients.alpha * interpolation)
    * Math.sin(coefficients.omega * interpolation);
}

class NasalBranch {
  constructor(rate) {
    this.rate = rate;
    this.substepRate = rate * SUBSTEPS;
    this.right = new Float64Array(NOSE_SECTIONS);
    this.left = new Float64Array(NOSE_SECTIONS);
    this.rightJunction = new Float64Array(NOSE_SECTIONS + 1);
    this.leftJunction = new Float64Array(NOSE_SECTIONS + 1);
    this.diameter = new Float64Array(NOSE_SECTIONS);
    this.targetDiameter = new Float64Array(NOSE_SECTIONS);
    this.area = new Float64Array(NOSE_SECTIONS);
    this.reflection = new Float64Array(NOSE_SECTIONS + 1);
    this.opening = 0;
    this.targetOpening = 0;
    this.configure(0, 0.165, true);
  }

  get incomingAtJunction() {
    return this.left[0];
  }

  get junctionArea() {
    return Math.max(AREA_MINIMUM, this.area[0]);
  }

  configure(opening, tractLengthM, immediate = false) {
    this.targetOpening = clamp(opening);
    const lengthScale = clamp(Math.cbrt(Math.max(0.01, tractLengthM / 0.165)), 0.72, 1.52);
    for (let index = 0; index < NOSE_SECTIONS; index += 1) {
      const progress = index / (NOSE_SECTIONS - 1);
      const chamber = 0.38
        + Math.sin(progress * Math.PI) * 0.68
        + Math.sin(progress * Math.PI * 3.1) * 0.055;
      this.targetDiameter[index] = Math.max(0.12, chamber * lengthScale);
    }
    this.targetDiameter[0] = DIAMETER_MINIMUM + this.targetOpening * 0.64;
    if (immediate) {
      this.opening = this.targetOpening;
      this.diameter.set(this.targetDiameter);
    }
    updateReflections(this.diameter, this.area, this.reflection, NOSE_SECTIONS);
  }

  advanceGeometry() {
    const lagMilliseconds = this.targetOpening > this.opening ? 15 : 40;
    this.opening += (this.targetOpening - this.opening)
      * timeAlpha(lagMilliseconds, this.substepRate);
    this.targetDiameter[0] = DIAMETER_MINIMUM + this.opening * 0.64;
    const alpha = timeAlpha(22, this.substepRate);
    for (let index = 0; index < NOSE_SECTIONS; index += 1) {
      this.diameter[index] = Math.max(
        DIAMETER_MINIMUM,
        this.diameter[index] + (this.targetDiameter[index] - this.diameter[index]) * alpha,
      );
    }
    updateReflections(this.diameter, this.area, this.reflection, NOSE_SECTIONS);
  }

  process(junctionInput, lossScale = 1) {
    this.rightJunction[0] = junctionInput;
    this.leftJunction[NOSE_SECTIONS] = this.right[NOSE_SECTIONS - 1] * NOSE_REFLECTION;
    for (let index = 1; index < NOSE_SECTIONS; index += 1) {
      const offset = this.reflection[index] * (this.right[index - 1] + this.left[index]);
      this.rightJunction[index] = this.right[index - 1] - offset;
      this.leftJunction[index] = this.left[index] + offset;
    }
    for (let index = 0; index < NOSE_SECTIONS; index += 1) {
      const propagationLoss = TUBE_LOSS * clamp(lossScale, 0.9, 1);
      this.right[index] = cleanWave(this.rightJunction[index] * propagationLoss);
      this.left[index] = cleanWave(this.leftJunction[index + 1] * propagationLoss);
    }
    return this.right[NOSE_SECTIONS - 1];
  }

  reset() {
    this.right.fill(0);
    this.left.fill(0);
    this.rightJunction.fill(0);
    this.leftJunction.fill(0);
  }

  isFinite() {
    return arraysAreFinite([
      this.right,
      this.left,
      this.rightJunction,
      this.leftJunction,
      this.diameter,
    ]);
  }
}

class CompliantCheekBranch {
  constructor(rate) {
    this.rate = rate;
    this.substepRate = rate * SUBSTEPS;
    this.right = new Float64Array(CHEEK_SECTIONS);
    this.left = new Float64Array(CHEEK_SECTIONS);
    this.rightJunction = new Float64Array(CHEEK_SECTIONS + 1);
    this.leftJunction = new Float64Array(CHEEK_SECTIONS + 1);
    this.diameter = new Float64Array(CHEEK_SECTIONS);
    this.targetDiameter = new Float64Array(CHEEK_SECTIONS);
    this.area = new Float64Array(CHEEK_SECTIONS);
    this.reflection = new Float64Array(CHEEK_SECTIONS + 1);
    this.displacement = 0;
    this.velocity = 0;
    this.wallDrive = 0;
    this.collisionDrive = 0;
    this.lastExternalForce = 0;
    this.lastSuction = 0;
    this.boundaryReflection = 0.97;
    this.targetBoundaryReflection = 0.97;
    this.configure(HAMBONE_DEFAULTS, true);
  }

  get incomingAtJunction() {
    return this.left[0];
  }

  get junctionArea() {
    return Math.max(AREA_MINIMUM, this.area[0]);
  }

  configure(configuration, immediate = false) {
    const volume = finite(configuration.cheekVolume, HAMBONE_DEFAULTS.cheekVolume);
    const tension = finite(configuration.cheekTension, HAMBONE_DEFAULTS.cheekTension);
    const diameterScale = clamp(0.46 + volume * 0.34, 0.16, 1.36);
    for (let index = 0; index < CHEEK_SECTIONS; index += 1) {
      const progress = index / (CHEEK_SECTIONS - 1);
      const diameter = diameterScale * (0.48 + Math.sin(progress * Math.PI) * 0.58);
      this.targetDiameter[index] = Math.max(DIAMETER_MINIMUM, diameter);
    }
    this.targetDiameter[0] = Math.max(0.08, diameterScale * 0.34);
    this.targetBoundaryReflection = clamp(0.925 + tension * 0.035, 0.88, 0.997);
    if (immediate) {
      this.diameter.set(this.targetDiameter);
      this.boundaryReflection = this.targetBoundaryReflection;
    }
    updateReflections(this.diameter, this.area, this.reflection, CHEEK_SECTIONS);
    if (immediate) {
      this.displacement = 0;
      this.velocity = 0;
      this.wallDrive = 0;
      this.collisionDrive = 0;
      this.lastExternalForce = 0;
      this.lastSuction = 0;
    }
  }

  advance(frame, configuration, localPressure) {
    const geometryAlpha = timeAlpha(24, this.substepRate);
    for (let index = 0; index < CHEEK_SECTIONS; index += 1) {
      this.diameter[index] = Math.max(
        DIAMETER_MINIMUM,
        this.diameter[index]
          + (this.targetDiameter[index] - this.diameter[index]) * geometryAlpha,
      );
    }
    this.boundaryReflection += (this.targetBoundaryReflection - this.boundaryReflection)
      * timeAlpha(18, this.substepRate);
    updateReflections(this.diameter, this.area, this.reflection, CHEEK_SECTIONS);
    const tension = finite(frame?.cheekTension, configuration.cheekTension);
    const naturalFrequency = frame?.soundId === "kick"
      ? clamp(38 + tension * 24, 30, 78)
      : clamp(74 + tension * 180, 34, 460);
    const omega = Math.PI * 2 * naturalFrequency;
    const damping = clamp(0.08 + tension * 0.055, 0.025, 0.34);
    const pneumaticGesture = frame?.soundId === "bop"
      || frame?.soundId === "boop"
      || frame?.soundId === "shh"
      || frame?.soundId === "pff";
    const lungScale = pneumaticGesture
      ? clamp(finite(configuration.lungPressure, 0) / HAMBONE_DEFAULTS.lungPressure)
      : 1;
    const externalForce = (
      finite(frame?.cheekImpulse, 0) * 1.08
      - finite(frame?.suction, 0) * 0.72
    ) * lungScale;
    const forceChange = externalForce - this.lastExternalForce;
    this.lastExternalForce = externalForce;
    const suction = finite(frame?.suction, 0);
    const suctionChange = suction - this.lastSuction;
    this.lastSuction = suction;
    // A hand/tongue collision moves the closed cheek wall faster than its
    // low-frequency compliant mode. The differentiated displacement is
    // injected at that wall and can reach the output only by returning through
    // the oral side junction.
    this.collisionDrive += forceChange * (0.032 + clamp(tension) * 0.018);
    // Tongue/cheek withdrawal expands the sealed pocket: its volume-flow sign
    // is negative while suction rises, positive on the release rebound.
    this.collisionDrive -= suctionChange * 0.12;
    this.collisionDrive *= 0.88;
    const cheekForce = externalForce + clamp(localPressure, -2, 2) * 0.06;
    const acceleration = omega * omega * (cheekForce * 0.32 - this.displacement)
      - 2 * damping * omega * this.velocity;
    this.velocity = clamp(
      this.velocity + acceleration / this.substepRate,
      -1_200,
      1_200,
    );
    this.displacement = clamp(
      this.displacement + this.velocity / this.substepRate,
      -1.7,
      1.7,
    );
    this.wallDrive = clamp(
      this.velocity / Math.max(80, omega) * 0.11 + this.collisionDrive,
      -0.24,
      0.24,
    );
  }

  process(junctionInput, lossScale = 1) {
    this.rightJunction[0] = junctionInput;
    this.leftJunction[CHEEK_SECTIONS] = cleanWave(
      this.right[CHEEK_SECTIONS - 1] * this.boundaryReflection + this.wallDrive,
    );
    for (let index = 1; index < CHEEK_SECTIONS; index += 1) {
      const offset = this.reflection[index] * (this.right[index - 1] + this.left[index]);
      this.rightJunction[index] = this.right[index - 1] - offset;
      this.leftJunction[index] = this.left[index] + offset;
    }
    for (let index = 0; index < CHEEK_SECTIONS; index += 1) {
      const propagationLoss = TUBE_LOSS * clamp(lossScale, 0.9, 1);
      this.right[index] = cleanWave(this.rightJunction[index] * propagationLoss);
      this.left[index] = cleanWave(this.leftJunction[index + 1] * propagationLoss);
    }
  }

  reset() {
    this.right.fill(0);
    this.left.fill(0);
    this.rightJunction.fill(0);
    this.leftJunction.fill(0);
    this.displacement = 0;
    this.velocity = 0;
    this.wallDrive = 0;
    this.collisionDrive = 0;
    this.lastExternalForce = 0;
    this.lastSuction = 0;
  }

  isFinite() {
    return Number.isFinite(this.displacement)
      && Number.isFinite(this.velocity)
      && arraysAreFinite([
        this.right,
        this.left,
        this.rightJunction,
        this.leftJunction,
      ]);
  }
}

// A pressure-excited mass/spring valve. PFF never uses a periodic sine gate:
// lung/tract pressure opens the lip mass, Bernoulli unloading and the spring
// close it, and collisions seed the next parting.
class PressureDrivenLipValve {
  constructor(rate) {
    this.substepRate = rate * SUBSTEPS;
    this.positionCm = 0;
    this.velocityCmPerSecond = 0;
    this.apertureCm = DIAMETER_MINIMUM;
    this.collisionFlow = 0;
  }

  advance(frame, plan, tractPressure, lungPressure = 1) {
    const enabled = frame?.soundId === "pff" && finite(frame?.lipFlutter, 0) > 0.001;
    const flutter = enabled ? clamp(frame.lipFlutter) : 0;
    const frequency = clamp(finite(plan?.flutterFrequencyHz, 38), 12, 92);
    const omega = Math.PI * 2 * frequency;
    const tension = finite(frame?.lipTension, 0.4);
    const damping = clamp(0.075 + Math.max(0, tension) * 0.035, 0.035, 0.22);
    const restPosition = enabled ? -0.028 - Math.max(0, -tension) * 0.035 : 0;
    const pressure = enabled && finite(lungPressure, 0) > 0.000001
      ? Math.max(
        0,
        finite(frame.pressureDrive, 0) * 0.18 - finite(tractPressure, 0) * 4.2,
      )
      : 0;
    const opening = Math.max(0, this.positionCm);
    const aerodynamicForce = pressure * flutter * 0.16 * (1 - opening / 0.12 * 1.7);
    const acceleration = omega * omega * (
      restPosition + aerodynamicForce - this.positionCm
    ) - 2 * damping * omega * this.velocityCmPerSecond;
    const previousPositionCm = this.positionCm;
    this.velocityCmPerSecond = clamp(
      this.velocityCmPerSecond + acceleration / this.substepRate,
      -180,
      180,
    );
    this.positionCm += this.velocityCmPerSecond / this.substepRate;
    if (this.positionCm < 0) {
      const collisionVelocity = Math.min(0, this.velocityCmPerSecond);
      this.positionCm = 0;
      if (this.velocityCmPerSecond < 0) this.velocityCmPerSecond *= -0.16;
      // Contact emits energy only after pressure actually parted the lips.
      // A valve resting at zero aperture must not manufacture a collision on
      // every substep when lung pressure is zero.
      if (previousPositionCm > 0.0001 && finite(lungPressure, 0) > 0.000001) {
        this.collisionFlow += clamp(-collisionVelocity * 0.00042, 0, 0.075);
      }
    }
    this.collisionFlow *= 0.86;
    if (!enabled) {
      this.positionCm *= 1 - timeAlpha(14, this.substepRate);
      this.velocityCmPerSecond *= 1 - timeAlpha(10, this.substepRate);
    }
    this.apertureCm = clamp(
      DIAMETER_MINIMUM + Math.max(0, this.positionCm) * 2.4,
      DIAMETER_MINIMUM,
      1.15,
    );
    return this.apertureCm;
  }

  reset() {
    this.positionCm = 0;
    this.velocityCmPerSecond = 0;
    this.apertureCm = DIAMETER_MINIMUM;
    this.collisionFlow = 0;
  }

  isFinite() {
    return Number.isFinite(this.positionCm)
      && Number.isFinite(this.velocityCmPerSecond)
      && Number.isFinite(this.apertureCm)
      && Number.isFinite(this.collisionFlow);
  }
}

// A compliant tongue-tip mass. DRR supplies breath and a near-alveolar
// constriction, but no clocked oscillator: the local pressure drop parts the
// tip, aerodynamic unloading lets the spring close it, and each collision
// feeds a small volume pulse back into the same oral tube.
class PressureDrivenTongueValve {
  constructor(rate) {
    this.substepRate = rate * SUBSTEPS;
    this.positionCm = 0;
    this.velocityCmPerSecond = 0;
    this.apertureCm = DIAMETER_MINIMUM;
    this.collisionFlow = 0;
  }

  advance(frame, plan, pressureDrop) {
    const enabled = frame?.soundId === "drr" && finite(frame?.tongueTrill, 0) > 0.001;
    const trill = enabled ? clamp(frame.tongueTrill) : 0;
    const frequency = clamp(finite(plan?.trillFrequencyHz, 34), 16, 72);
    const omega = Math.PI * 2 * frequency;
    const curl = finite(frame?.tongueCurl, 0.7);
    const pressure = enabled
      ? Math.max(0, finite(frame?.pressureDrive, 0) * 0.42 + finite(pressureDrop, 0) * 1.2)
      : 0;
    // Flow across a loose tip contributes negative damping; without pressure
    // the same tissue is positively damped and cannot self-oscillate.
    const damping = clamp(
      0.052 + Math.max(0, curl) * 0.01 - pressure * trill * 0.48,
      -0.12,
      0.13,
    );
    const opening = Math.max(0, this.positionCm);
    const restPosition = enabled ? -0.032 - Math.max(0, curl - 0.8) * 0.012 : 0;
    const aerodynamicForce = pressure * trill * (0.22 - opening * 3.8);
    const acceleration = omega * omega * (
      restPosition + aerodynamicForce - this.positionCm
    ) - 2 * damping * omega * this.velocityCmPerSecond;
    const previousPosition = this.positionCm;
    this.velocityCmPerSecond = clamp(
      this.velocityCmPerSecond + acceleration / this.substepRate,
      -220,
      220,
    );
    this.positionCm = clamp(
      this.positionCm + this.velocityCmPerSecond / this.substepRate,
      -0.08,
      0.42,
    );
    const contactThresholdCm = enabled ? 0.0007 : 0;
    if (this.positionCm < contactThresholdCm) {
      const collisionVelocity = Math.min(0, this.velocityCmPerSecond);
      this.positionCm = 0;
      if (this.velocityCmPerSecond < 0) this.velocityCmPerSecond *= -0.2;
      if (
        enabled
        && previousPosition > contactThresholdCm + 0.00001
        && pressure > 0.0001
      ) {
        this.collisionFlow += clamp(-collisionVelocity * 0.00034, 0, 0.065);
      }
    }
    this.collisionFlow *= 0.84;
    if (!enabled) {
      this.positionCm *= 1 - timeAlpha(12, this.substepRate);
      this.velocityCmPerSecond *= 1 - timeAlpha(8, this.substepRate);
    }
    this.apertureCm = clamp(
      DIAMETER_MINIMUM + Math.max(0, this.positionCm) * 2.8,
      DIAMETER_MINIMUM,
      0.82,
    );
    return this.apertureCm;
  }

  reset() {
    this.positionCm = 0;
    this.velocityCmPerSecond = 0;
    this.apertureCm = DIAMETER_MINIMUM;
    this.collisionFlow = 0;
  }

  isFinite() {
    return Number.isFinite(this.positionCm)
      && Number.isFinite(this.velocityCmPerSecond)
      && Number.isFinite(this.apertureCm)
      && Number.isFinite(this.collisionFlow);
  }
}

class OrganicMouthTract {
  constructor(rate, configuration) {
    this.rate = rate;
    this.substepRate = rate * SUBSTEPS;
    // 152 covers Hambone's 52 cm limit at 48 kHz. Higher-rate worklets get
    // proportionally more preallocated cells so the length control continues
    // to change propagation delay instead of silently saturating.
    this.capacity = Math.max(
      MAX_ORAL_SECTIONS,
      Math.ceil(MAX_TRACT_LENGTH_M * rate * SUBSTEPS / SPEED_OF_SOUND_MPS) + 3,
    );
    this.sectionCount = 0;
    this.right = new Float64Array(this.capacity);
    this.left = new Float64Array(this.capacity);
    this.rightJunction = new Float64Array(this.capacity + 1);
    this.leftJunction = new Float64Array(this.capacity + 1);
    this.diameter = new Float64Array(this.capacity);
    this.targetDiameter = new Float64Array(this.capacity);
    this.area = new Float64Array(this.capacity);
    this.reflection = new Float64Array(this.capacity + 1);
    this.resizeRight = new Float64Array(this.capacity);
    this.resizeLeft = new Float64Array(this.capacity);
    this.resizeDiameter = new Float64Array(this.capacity);
    this.nose = new NasalBranch(rate);
    this.cheek = new CompliantCheekBranch(rate);
    this.lipValve = new PressureDrivenLipValve(rate);
    this.tongueValve = new PressureDrivenTongueValve(rate);
    this.articulationSpeedScale = 1;
    this.noseJunction = 4;
    this.cheekJunction = 7;
    this.activeConstrictionIndex = 5;
    this.currentFrame = null;
    this.currentPlan = null;
    this.tailLoss = 1;
    this.tractPressure = 0;
    this.signedPressure = 0;
    this.lastOralOutput = 0;
    this.lastNasalOutput = 0;
    this.previousLipImpulse = 0;
    this.previousPrimaryConstriction = 0;
    this.previousSecondaryConstriction = 0;
    this.seals = [
      this._newSeal("lip"),
      this._newSeal("primary"),
      this._newSeal("secondary"),
      this._newSeal("tongueTip"),
    ];
    this.transients = Array.from({ length: 4 }, () => ({
      active: false,
      index: 0,
      strength: 0,
      ageSeconds: 1,
    }));
    this.configure(configuration, true);
  }

  _newSeal(name) {
    return {
      name,
      index: 0,
      enabled: false,
      sealed: false,
      reservoir: 0,
      energy: 0,
      vacuumPressure: 0,
      releaseBoost: 0,
      releaseMemory: 0,
    };
  }

  _sectionCountForLength(lengthM) {
    return Math.round(clamp(
      finite(lengthM, HAMBONE_DEFAULTS.tractLengthM) * this.rate * SUBSTEPS / SPEED_OF_SOUND_MPS,
      MIN_ORAL_SECTIONS,
      this.capacity,
    ));
  }

  _resize(nextCount) {
    const count = clamp(Math.round(nextCount), MIN_ORAL_SECTIONS, this.capacity);
    if (count === this.sectionCount) return;
    const previousCount = this.sectionCount;
    if (previousCount > 1) {
      for (let index = 0; index < count; index += 1) {
        const previousPosition = index / Math.max(1, count - 1) * (previousCount - 1);
        this.resizeRight[index] = resample(this.right.subarray(0, previousCount), previousPosition);
        this.resizeLeft[index] = resample(this.left.subarray(0, previousCount), previousPosition);
        this.resizeDiameter[index] = resample(
          this.diameter.subarray(0, previousCount),
          previousPosition,
        );
      }
      this.right.set(this.resizeRight.subarray(0, count));
      this.left.set(this.resizeLeft.subarray(0, count));
      this.diameter.set(this.resizeDiameter.subarray(0, count));
    }
    if (count < previousCount) {
      this.right.fill(0, count, previousCount);
      this.left.fill(0, count, previousCount);
      this.diameter.fill(DIAMETER_MINIMUM, count, previousCount);
    }
    this.sectionCount = count;
    this.noseJunction = clamp(
      Math.round(17 / (HAMBONE_TRACT_SECTION_COUNT - 1) * (count - 1)),
      2,
      count - 3,
    );
    this.cheekJunction = clamp(
      Math.round(29 / (HAMBONE_TRACT_SECTION_COUNT - 1) * (count - 1)),
      2,
      count - 3,
    );
    for (const seal of this.seals) {
      seal.index = clamp(seal.index, 1, count - 1);
    }
  }

  _restFrame(configuration) {
    return {
      soundId: "",
      pressureDrive: 0,
      lipClosure: 0,
      lipImpulse: 0,
      tongueContact: 0,
      constrictionPosition: 0.5,
      constriction: 0,
      secondaryConstrictionPosition: 22 / 43,
      secondaryConstriction: 0,
      velum: configuration.nasalMix,
      turbulence: 0,
      suction: 0,
      cheekImpulse: 0,
      jawImpulse: 0,
      voicing: 0,
      aspiration: 0,
      lipFlutter: 0,
      tongueTrill: 0,
      lipTension: configuration.lipTension,
      cheekVolume: configuration.cheekVolume,
      cheekTension: configuration.cheekTension,
      tonguePosition: configuration.tonguePosition,
      tongueCurl: configuration.tongueCurl,
      mouthOpening: configuration.mouthOpening,
      tractLengthM: configuration.tractLengthM,
    };
  }

  configure(configuration, immediate = false) {
    this.configuration = configuration;
    const restFrame = this._restFrame(configuration);
    this.setArticulation(configuration, restFrame, null, immediate);
    this.cheek.configure(restFrame, immediate);
  }

  setArticulation(configuration, frame, plan = null, immediate = false) {
    this.configuration = configuration;
    const articulation = frame ?? this._restFrame(configuration);
    const sectionCount = this._sectionCountForLength(
      finite(articulation.tractLengthM, configuration.tractLengthM),
    );
    this._resize(sectionCount);
    const targetArticulation = articulation.soundId === "pff"
      ? { ...articulation, lipClosure: 0, constriction: 0 }
      : articulation;
    const canonical = hamboneTargetOralDiameters(configuration, targetArticulation);
    for (let index = 0; index < this.sectionCount; index += 1) {
      const canonicalPosition = index / Math.max(1, this.sectionCount - 1)
        * (HAMBONE_TRACT_SECTION_COUNT - 1);
      this.targetDiameter[index] = clamp(
        resample(canonical, canonicalPosition),
        DIAMETER_MINIMUM,
        6.5,
      );
    }
    if (immediate) this.diameter.set(this.targetDiameter.subarray(0, this.sectionCount));
    updateReflections(this.diameter, this.area, this.reflection, this.sectionCount);
    this.currentFrame = articulation;
    this.currentPlan = plan;
    const isOralStop = articulation.soundId === "bop"
      || articulation.soundId === "boop"
      || articulation.soundId === "pop"
      || articulation.soundId === "tlik"
      || articulation.soundId === "shh"
      || articulation.soundId === "shack"
      || articulation.soundId === "pff"
      || articulation.soundId === "mwah";
    const closureAmount = Math.max(
      finite(articulation.lipClosure, 0),
      finite(articulation.constriction, 0),
      finite(articulation.secondaryConstriction, 0),
      finite(articulation.tongueContact, 0),
      finite(articulation.lipFlutter, 0),
    );
    let rawVelum = clamp(finite(articulation.velum, configuration.nasalMix));
    if (isOralStop) {
      const intentionalNasalMutation = smoothstep(
        (configuration.nasalMix - 0.25) / 0.4,
      );
      rawVelum *= 1 - clamp(
        closureAmount * 1.08 * (1 - intentionalNasalMutation),
      );
    }
    const physicalVelum = rawVelum <= 0.03
      ? 0
      : Math.pow(clamp((rawVelum - 0.03) / 0.97), 0.72);
    this.nose.configure(
      physicalVelum,
      finite(articulation.tractLengthM, configuration.tractLengthM),
      immediate,
    );
    this.cheek.configure(articulation);
    this._updateSealTargets(articulation);
    this.activeConstrictionIndex = finite(articulation.secondaryConstriction, 0)
      > finite(articulation.constriction, 0)
      ? mappedConstrictionIndex(
        articulation.secondaryConstrictionPosition,
        this.sectionCount,
      )
      : mappedConstrictionIndex(articulation.constrictionPosition, this.sectionCount);
  }

  _updateSealTargets(frame) {
    const maximum = this.sectionCount - 1;
    const lip = this.seals[0];
    const primary = this.seals[1];
    const secondary = this.seals[2];
    const tongueTip = this.seals[3];
    if (!lip.sealed) lip.index = maximum;
    if (!primary.sealed) {
      primary.index = mappedConstrictionIndex(frame.constrictionPosition, this.sectionCount);
    }
    if (!secondary.sealed) {
      secondary.index = mappedConstrictionIndex(
        finite(frame.secondaryConstrictionPosition, 0.5),
        this.sectionCount,
      );
    }
    if (!tongueTip.sealed) {
      const tongueBodyCanonical = clamp(
        12.9 + finite(frame.tonguePosition, 0.58) * (30.4 - 12.9),
        2,
        HAMBONE_TRACT_SECTION_COUNT - 2,
      );
      const tongueTipCanonical = clamp(
        tongueBodyCanonical + 5.5 + finite(frame.tongueCurl, 0.4) * 1.8,
        2,
        HAMBONE_TRACT_SECTION_COUNT - 2,
      );
      tongueTip.index = clamp(
        Math.round(
          tongueTipCanonical / (HAMBONE_TRACT_SECTION_COUNT - 1) * maximum,
        ),
        1,
        maximum,
      );
    }
    lip.enabled = finite(frame.lipClosure, 0) > 0.34
      || finite(frame.lipFlutter, 0) > 0.04
      || lip.sealed;
    primary.enabled = finite(frame.constriction, 0) > 0.48
      && Math.abs(primary.index - lip.index) > 2;
    secondary.enabled = finite(frame.secondaryConstriction, 0) > 0.48
      && Math.abs(secondary.index - lip.index) > 2
      && Math.abs(secondary.index - primary.index) > 2;
    tongueTip.enabled = finite(frame.tongueContact, 0) > 0.48
      && (!lip.enabled || Math.abs(tongueTip.index - lip.index) > 1)
      && (!primary.enabled || Math.abs(tongueTip.index - primary.index) > 1)
      && (!secondary.enabled || Math.abs(tongueTip.index - secondary.index) > 1);
    for (const seal of [primary, secondary, tongueTip]) {
      if (seal.sealed || !seal.enabled) continue;
      let minimumIndex = seal.index;
      let minimumDiameter = this.targetDiameter[minimumIndex];
      for (
        let index = Math.max(1, seal.index - 3);
        index <= Math.min(maximum - 1, seal.index + 3);
        index += 1
      ) {
        if (this.targetDiameter[index] < minimumDiameter) {
          minimumDiameter = this.targetDiameter[index];
          minimumIndex = index;
        }
      }
      seal.index = minimumIndex;
    }
    const uniqueSeals = [];
    for (const seal of [lip, primary, secondary, tongueTip]) {
      if (!seal.enabled && !seal.sealed) continue;
      const alias = uniqueSeals.find((candidate) => (
        Math.abs(candidate.index - seal.index) <= 2
      ));
      if (!alias) {
        uniqueSeals.push(seal);
        continue;
      }
      if (Math.abs(seal.reservoir) > Math.abs(alias.reservoir)) {
        alias.reservoir = seal.reservoir;
      }
      alias.energy = Math.max(alias.energy, seal.energy);
      alias.vacuumPressure = Math.min(alias.vacuumPressure, seal.vacuumPressure);
      alias.releaseBoost = Math.max(alias.releaseBoost, seal.releaseBoost);
      alias.releaseMemory = Math.max(alias.releaseMemory, seal.releaseMemory);
      seal.enabled = false;
      seal.sealed = false;
      seal.reservoir = 0;
      seal.energy = 0;
      seal.vacuumPressure = 0;
      seal.releaseBoost = 0;
      seal.releaseMemory = 0;
    }

    const lipImpulse = finite(frame.lipImpulse, 0);
    if (frame.soundId !== "pff" && lipImpulse > this.previousLipImpulse + 0.04) {
      lip.releaseBoost = Math.max(lip.releaseBoost, lipImpulse);
    }
    const primaryAmount = finite(frame.constriction, 0);
    if (primaryAmount < this.previousPrimaryConstriction - 0.08) {
      primary.releaseBoost = Math.max(
        primary.releaseBoost,
        this.previousPrimaryConstriction - primaryAmount,
      );
    }
    const secondaryAmount = finite(frame.secondaryConstriction, 0);
    if (secondaryAmount < this.previousSecondaryConstriction - 0.08) {
      secondary.releaseBoost = Math.max(
        secondary.releaseBoost,
        this.previousSecondaryConstriction - secondaryAmount,
      );
    }
    this.previousLipImpulse = lipImpulse;
    this.previousPrimaryConstriction = primaryAmount;
    this.previousSecondaryConstriction = secondaryAmount;
  }

  _advanceOralGeometry() {
    const speedScale = clamp(this.articulationSpeedScale, 0.25, 10);
    const closingStep = 82 * speedScale / this.substepRate;
    const openingStep = 360 * speedScale / this.substepRate;
    for (let index = 0; index < this.sectionCount; index += 1) {
      const difference = this.targetDiameter[index] - this.diameter[index];
      this.diameter[index] = Math.max(
        DIAMETER_MINIMUM,
        this.diameter[index] + clamp(difference, -closingStep, openingStep),
      );
    }

    if (this.currentFrame?.soundId === "pff") {
      const lipIndex = this.sectionCount - 1;
      const lipAperture = this.lipValve.advance(
        this.currentFrame,
        this.currentPlan,
        this._localPressure(Math.max(0, lipIndex - 1)),
        this.configuration.lungPressure,
      );
      const last = lipIndex;
      for (let offset = 0; offset < 4; offset += 1) {
        const index = Math.max(0, last - offset);
        const blend = 1 - offset / 4;
        const dynamicDiameter = lipAperture
          + (this.targetDiameter[index] - lipAperture) * (1 - blend);
        this.diameter[index] = Math.min(this.diameter[index], dynamicDiameter);
      }
      if (this.lipValve.collisionFlow > 0.0000001) {
        this.left[Math.max(0, last - 1)] += this.lipValve.collisionFlow;
      }
    } else {
      this.lipValve.advance(null, null, 0);
    }

    if (this.currentFrame?.soundId === "drr") {
      const tipIndex = mappedConstrictionIndex(
        finite(this.currentFrame.constrictionPosition, 0.84),
        this.sectionCount,
      );
      const upstreamPressure = this._localPressure(Math.max(0, tipIndex - 1));
      const downstreamPressure = this._localPressure(
        Math.min(this.sectionCount - 1, tipIndex + 1),
      );
      const aperture = this.tongueValve.advance(
        this.currentFrame,
        this.currentPlan,
        Math.abs(upstreamPressure - downstreamPressure),
      );
      for (let offset = -2; offset <= 2; offset += 1) {
        const index = clamp(tipIndex + offset, 1, this.sectionCount - 2);
        const weight = 1 - Math.abs(offset) / 3;
        const dynamicDiameter = aperture
          + (this.targetDiameter[index] - aperture) * (1 - weight);
        this.diameter[index] = Math.min(this.diameter[index], dynamicDiameter);
      }
      if (this.tongueValve.collisionFlow > 0.0000001) {
        this.right[Math.min(this.sectionCount - 1, tipIndex + 1)]
          += this.tongueValve.collisionFlow * 0.62;
        this.left[Math.max(0, tipIndex - 1)]
          += this.tongueValve.collisionFlow * 0.38;
      }
      this.activeConstrictionIndex = tipIndex;
    } else {
      this.tongueValve.advance(null, null, 0);
    }
    updateReflections(this.diameter, this.area, this.reflection, this.sectionCount);
  }

  _localPressure(index) {
    const safeIndex = clamp(Math.round(index), 0, this.sectionCount - 1);
    return (this.right[safeIndex] + this.left[safeIndex])
      / Math.sqrt(Math.max(AREA_MINIMUM, this.area[safeIndex]));
  }

  _startTransient(index, strength) {
    const transient = this.transients.find(({ active }) => !active)
      ?? this.transients.reduce((oldest, candidate) => (
        candidate.ageSeconds > oldest.ageSeconds ? candidate : oldest
      ));
    transient.active = true;
    transient.index = clamp(Math.round(index), 0, this.sectionCount - 1);
    transient.strength = clamp(strength, -0.64, 0.64);
    transient.ageSeconds = 0;
  }

  _pressureStoredAtSeal(seal) {
    const upstream = this._localPressure(seal.index - 1);
    if (finite(this.currentFrame?.suction, 0) <= 0.001) return upstream;
    let start;
    let end;
    if (seal.index > this.cheekJunction) {
      let rear = this.cheekJunction;
      for (const candidate of this.seals) {
        if (candidate === seal || candidate.index >= seal.index) continue;
        const closed = candidate.sealed || (
          candidate.enabled
          && this.diameter[clamp(candidate.index, 0, this.sectionCount - 1)] <= 0.055
        );
        if (closed) rear = Math.max(rear, candidate.index);
      }
      start = rear + 1;
      end = seal.index - 1;
    } else {
      let front = this.sectionCount - 1;
      for (const candidate of this.seals) {
        if (candidate === seal || candidate.index <= seal.index) continue;
        const closed = candidate.sealed || (
          candidate.enabled
          && this.diameter[clamp(candidate.index, 0, this.sectionCount - 1)] <= 0.055
        );
        if (closed) front = Math.min(front, candidate.index);
      }
      start = seal.index + 1;
      end = Math.max(start, front - 1);
    }
    start = clamp(Math.round(start), 0, this.sectionCount - 1);
    end = clamp(Math.round(end), start, this.sectionCount - 1);
    let pressure = 0;
    for (let index = start; index <= end; index += 1) {
      pressure += this._localPressure(index);
    }
    return pressure / Math.max(1, end - start + 1);
  }

  _advanceSeals(noise) {
    let strongestSigned = 0;
    for (const seal of this.seals) {
      const index = clamp(Math.round(seal.index), 1, this.sectionCount - 1);
      const diameter = this.diameter[index];
      const localPressure = this._pressureStoredAtSeal(seal);
      if ((seal.enabled || seal.sealed) && diameter <= 0.035) {
        seal.sealed = true;
        // Only pressure already present in the upstream waveguide may charge a
        // closure. Gesture curves position the articulators but never invent a
        // pressure reservoir or a click by themselves.
        seal.reservoir += (localPressure - seal.reservoir)
          * timeAlpha(18, this.substepRate);
        seal.energy += (localPressure * localPressure - seal.energy)
          * timeAlpha(28, this.substepRate);
        if (finite(this.currentFrame?.suction, 0) > 0.001) {
          const measuredVacuum = Math.min(0, localPressure);
          const vacuumTime = measuredVacuum < seal.vacuumPressure ? 4 : 45;
          seal.vacuumPressure += (measuredVacuum - seal.vacuumPressure)
            * timeAlpha(vacuumTime, this.substepRate);
        } else {
          seal.vacuumPressure *= 1 - timeAlpha(32, this.substepRate);
        }
      } else if (seal.sealed && diameter >= 0.12) {
        const storedMagnitude = Math.sqrt(Math.max(0, seal.energy));
        const measuredPressure = seal.vacuumPressure < -0.000001
          ? seal.vacuumPressure
          : seal.reservoir;
        if (storedMagnitude > 0.0001 && Math.abs(measuredPressure) > 0.000001) {
          const measuredSign = Math.sign(measuredPressure);
          const noisyRelease = measuredPressure * 0.56
            + measuredSign * storedMagnitude * seal.releaseBoost
              * (0.11 + Math.abs(noise) * 0.035);
          this._startTransient(index, noisyRelease);
        }
        seal.releaseMemory = 1;
        seal.sealed = false;
        seal.reservoir *= 0.12;
        seal.energy *= 0.08;
        seal.vacuumPressure = 0;
        seal.releaseBoost = 0;
      } else if (!seal.sealed) {
        seal.reservoir *= 1 - timeAlpha(55, this.substepRate);
        seal.energy *= 1 - timeAlpha(70, this.substepRate);
        seal.vacuumPressure *= 1 - timeAlpha(24, this.substepRate);
        seal.releaseBoost *= 1 - timeAlpha(34, this.substepRate);
      }
      seal.releaseMemory *= 1 - timeAlpha(8, this.substepRate);
      if (Math.abs(seal.reservoir) > Math.abs(strongestSigned)) {
        strongestSigned = seal.reservoir;
      }
      if (Math.abs(seal.vacuumPressure) > Math.abs(strongestSigned)) {
        strongestSigned = seal.vacuumPressure;
      }
    }
    this.signedPressure += (strongestSigned - this.signedPressure)
      * timeAlpha(16, this.substepRate);
  }

  _injectTransients(noise) {
    for (const transient of this.transients) {
      if (!transient.active) continue;
      if (transient.ageSeconds >= 0.028) {
        transient.active = false;
        continue;
      }
      const envelope = transient.strength * 2 ** (-transient.ageSeconds * 260);
      const shaped = envelope * (0.74 + noise * 0.26);
      const index = clamp(transient.index, 0, this.sectionCount - 1);
      this.right[index] += shaped * 0.5;
      this.left[index] += shaped * 0.5;
      transient.ageSeconds += 1 / this.substepRate;
    }
  }

  _injectTurbulence(noise) {
    const frame = this.currentFrame ?? {};
    const amount = clamp(finite(frame.turbulence, 0));
    if (amount <= 0.0001) return;
    let constriction = mappedConstrictionIndex(
      frame.constrictionPosition,
      this.sectionCount,
    );
    let bestScore = -1;
    let bestDrive = 0;
    // Follow whichever real aperture is producing the strongest jet. This
    // moves PHSHSHK from its lip PH release to its SH groove and finally to
    // the rear K release, instead of leaving all noise at one preset index.
    for (let candidateNumber = 0; candidateNumber < 4; candidateNumber += 1) {
      let candidate;
      let siteWeight;
      let releaseMemory;
      if (candidateNumber === 0) {
        candidate = mappedConstrictionIndex(frame.constrictionPosition, this.sectionCount);
        releaseMemory = this.seals[1].releaseMemory;
        siteWeight = clamp(
          finite(frame.constriction, 0) + this.seals[1].releaseMemory * 1.5,
          0,
          2,
        );
      } else if (candidateNumber === 1) {
        candidate = mappedConstrictionIndex(
          frame.secondaryConstrictionPosition,
          this.sectionCount,
        );
        releaseMemory = this.seals[2].releaseMemory;
        siteWeight = clamp(
          finite(frame.secondaryConstriction, 0) + this.seals[2].releaseMemory * 1.7,
          0,
          2,
        );
      } else if (candidateNumber === 2) {
        candidate = this.sectionCount - 1;
        releaseMemory = this.seals[0].releaseMemory;
        siteWeight = frame.soundId === "pff"
          ? clamp(finite(frame.lipFlutter, 0))
          : clamp(
            finite(frame.lipClosure, 0) + this.seals[0].releaseMemory * 1.5,
            0,
            2,
          );
      } else {
        candidate = this.seals[3].index;
        releaseMemory = this.seals[3].releaseMemory;
        const hybridRearRelease = frame.soundId === "shh" || frame.soundId === "shack";
        siteWeight = hybridRearRelease
          ? 0
          : clamp(finite(frame.tongueContact, 0) + releaseMemory);
      }
      if (siteWeight <= 0.001) continue;
      candidate = clamp(candidate, 1, this.sectionCount - 2);
      const diameter = this.diameter[candidate];
      const thinness = Math.max(
        clamp((1.28 - diameter) / 1.08),
        releaseMemory * clamp((2.2 - diameter) / 1.4) * 0.65,
      );
      const openness = clamp((diameter - 0.018) / 0.18);
      if (thinness <= 0 || openness <= 0) continue;
      const upstreamPressure = this._localPressure(candidate - 1);
      const downstreamPressure = this._localPressure(candidate + 1);
      const pressureDrop = Math.abs(upstreamPressure - downstreamPressure);
      const localFlow = Math.abs(this.right[candidate - 1] - this.left[candidate]);
      const aerodynamicDrive = Math.sqrt(pressureDrop) * 0.82
        + Math.sqrt(localFlow) * 0.28;
      const score = thinness * openness * aerodynamicDrive * siteWeight;
      if (score > bestScore) {
        bestScore = score;
        bestDrive = score;
        constriction = candidate;
      }
    }
    if (bestScore <= 0) return;
    this.activeConstrictionIndex = constriction;
    const flow = noise * amount * bestDrive * 0.072;
    const downstream = Math.min(this.sectionCount - 1, constriction + 1);
    this.right[downstream] += flow * 0.7;
    this.left[downstream] += flow * 0.3;
  }

  _scatterThreePort(junction, branchIncoming, branchArea) {
    const upstreamIncoming = this.right[junction - 1];
    const downstreamIncoming = this.left[junction];
    const upstreamArea = Math.max(AREA_MINIMUM, this.area[junction - 1]);
    const downstreamArea = Math.max(AREA_MINIMUM, this.area[junction]);
    const sideArea = Math.max(AREA_MINIMUM, branchArea);
    const totalFlow = upstreamIncoming + downstreamIncoming + branchIncoming;
    const totalArea = Math.max(AREA_MINIMUM, upstreamArea + downstreamArea + sideArea);
    this.leftJunction[junction] = cleanWave((
      -upstreamIncoming + 2 * upstreamArea / totalArea * totalFlow
    ) * JUNCTION_LOSS);
    this.rightJunction[junction] = cleanWave((
      -downstreamIncoming + 2 * downstreamArea / totalArea * totalFlow
    ) * JUNCTION_LOSS);
    return cleanWave((
      -branchIncoming + 2 * sideArea / totalArea * totalFlow
    ) * JUNCTION_LOSS);
  }

  processSubstep(sourceFlow, noise) {
    this._advanceOralGeometry();
    this.nose.advanceGeometry();
    const cheekPressure = this._localPressure(this.cheekJunction);
    this.cheek.advance(this.currentFrame, this.configuration, cheekPressure);
    this._advanceSeals(noise);
    this._injectTransients(noise);
    this._injectTurbulence(noise);

    const count = this.sectionCount;
    this.rightJunction[0] = cleanWave(this.left[0] * GLOTTAL_REFLECTION + sourceFlow);
    this.leftJunction[count] = cleanWave(this.right[count - 1] * LIP_REFLECTION);
    for (let index = 1; index < count; index += 1) {
      if (index === this.noseJunction || index === this.cheekJunction) continue;
      const offset = this.reflection[index] * (this.right[index - 1] + this.left[index]);
      this.rightJunction[index] = this.right[index - 1] - offset;
      this.leftJunction[index] = this.left[index] + offset;
    }

    const noseInput = this._scatterThreePort(
      this.noseJunction,
      this.nose.incomingAtJunction,
      this.nose.junctionArea,
    );
    const cheekInput = this._scatterThreePort(
      this.cheekJunction,
      this.cheek.incomingAtJunction,
      this.cheek.junctionArea,
    );
    const normalizedTension = clamp(
      (finite(this.currentFrame?.lipTension, 0.46) + 0.35) / 2,
    );
    const wallMemory = 0.006 + (1 - normalizedTension) * 0.012;
    for (let index = 0; index < count; index += 1) {
      const propagationLoss = TUBE_LOSS * this.tailLoss;
      const previousRight = this.right[index];
      const previousLeft = this.left[index];
      const arrivingRight = this.rightJunction[index] * propagationLoss;
      const arrivingLeft = this.leftJunction[index + 1] * propagationLoss;
      // Soft tract walls lose more ultrasonic energy per travelled section.
      // The tiny temporal memory is distributed through the tube rather than
      // imposed as a generic output EQ.
      this.right[index] = cleanWave(
        arrivingRight * (1 - wallMemory) + previousRight * wallMemory,
      );
      this.left[index] = cleanWave(
        arrivingLeft * (1 - wallMemory) + previousLeft * wallMemory,
      );
    }
    const nasalOutput = this.nose.process(noseInput, this.tailLoss);
    this.cheek.process(cheekInput, this.tailLoss);
    this.lastOralOutput = this.right[count - 1];
    this.lastNasalOutput = nasalOutput;

    let energy = 0;
    for (let index = 0; index < count; index += 1) {
      const pressure = this.right[index] + this.left[index];
      energy += pressure * pressure / Math.max(AREA_MINIMUM, this.area[index]);
    }
    const targetPressure = clamp(1 - Math.exp(-Math.sqrt(energy / count) * 0.82));
    this.tractPressure += (targetPressure - this.tractPressure)
      * timeAlpha(22, this.substepRate);
    return this.lastOralOutput + nasalOutput * clamp(this.nose.opening * 2.8);
  }

  resetWaveState() {
    this.right.fill(0);
    this.left.fill(0);
    this.rightJunction.fill(0);
    this.leftJunction.fill(0);
    this.nose.reset();
    this.cheek.reset();
    this.lipValve.reset();
    this.tongueValve.reset();
    for (const seal of this.seals) {
      seal.sealed = false;
      seal.reservoir = 0;
      seal.energy = 0;
      seal.vacuumPressure = 0;
      seal.releaseBoost = 0;
      seal.releaseMemory = 0;
    }
    for (const transient of this.transients) transient.active = false;
    this.tractPressure = 0;
    this.signedPressure = 0;
    this.lastOralOutput = 0;
    this.lastNasalOutput = 0;
    this.tailLoss = 1;
  }

  chokeForRetarget(amount = 0.24) {
    const keep = clamp(amount, 0, 1);
    for (let index = 0; index < this.sectionCount; index += 1) {
      this.right[index] *= keep;
      this.left[index] *= keep;
    }
    for (let index = 0; index < NOSE_SECTIONS; index += 1) {
      this.nose.right[index] *= keep;
      this.nose.left[index] *= keep;
    }
    for (let index = 0; index < CHEEK_SECTIONS; index += 1) {
      this.cheek.right[index] *= keep;
      this.cheek.left[index] *= keep;
    }
    for (const seal of this.seals) {
      seal.sealed = false;
      seal.reservoir = 0;
      seal.energy = 0;
      seal.vacuumPressure = 0;
      seal.releaseBoost = 0;
      seal.releaseMemory = 0;
    }
    for (const transient of this.transients) transient.active = false;
    this.cheek.velocity *= keep;
    this.cheek.collisionDrive = 0;
    this.lipValve.velocityCmPerSecond *= keep;
    this.tongueValve.velocityCmPerSecond *= keep;
    this.tongueValve.collisionFlow *= keep;
    this.signedPressure *= keep;
    this.tractPressure *= keep;
    this.lastOralOutput *= keep;
    this.lastNasalOutput *= keep;
    this.tailLoss = 1;
  }

  isFinite() {
    return Number.isFinite(this.tractPressure)
      && Number.isFinite(this.signedPressure)
      && this.nose.isFinite()
      && this.cheek.isFinite()
      && this.lipValve.isFinite()
      && this.tongueValve.isFinite()
      && arraysAreFinite(
        [this.right, this.left, this.rightJunction, this.leftJunction, this.diameter],
        [this.sectionCount, this.sectionCount, this.sectionCount + 1, this.sectionCount + 1, this.sectionCount],
      );
  }
}

class HamboneGestureController {
  constructor(rate, event, configuration) {
    this.rate = rate;
    this.sound = hamboneSound(event.soundId);
    this.soundId = this.sound.id;
    this.velocity = clamp(event.velocity, 0.01, 1);
    this.configuration = configuration;
    this.plan = physicalVoiceParameters(this.sound.id, configuration, this.velocity);
    this.totalFrames = Math.max(1, Math.ceil(this.plan.durationSeconds * rate));
    this.startPhase = clamp(event.startPhase, 0, 1);
    this.releasePhase = clamp(event.releasePhase, this.startPhase, 1);
    this.preparationFrames = Math.max(1, Math.round(event.releaseFrame - event.startFrame));
    this.ageFrames = 0;
    this.releaseFrame = event.releaseFrame;
    this.glottalPhase = 0;
    this.irregularPhase = 0;
    this.jitter = 0;
    const plannedGlottalTenseness = Number(this.plan.glottalTenseness);
    const glottalTenseness = Number.isFinite(plannedGlottalTenseness)
      ? clamp(plannedGlottalTenseness)
      : clamp(0.34 + configuration.lungPressure * 0.2 + configuration.silliness * 0.16);
    this.glottalShape = glottalCoefficients(glottalTenseness);
    this.lastFrame = hamboneGestureFrame(
      this.sound.id,
      this.progress,
      this.configuration,
      this.velocity,
    );
  }

  get progress() {
    if (this.ageFrames < this.preparationFrames) {
      const preparation = this.ageFrames / this.preparationFrames;
      return clamp(
        this.startPhase + (this.releasePhase - this.startPhase) * preparation,
      );
    }
    return clamp(
      this.releasePhase + (this.ageFrames - this.preparationFrames) / this.totalFrames,
    );
  }

  get complete() {
    return this.progress >= 1;
  }

  sampleControlFrame() {
    this.lastFrame = hamboneGestureFrame(
      this.sound.id,
      this.progress,
      this.configuration,
      this.velocity,
    );
    return this.lastFrame;
  }

  sourceFlow(noise) {
    const frame = this.lastFrame;
    const silliness = clamp(finite(this.plan.silliness, 0.5));
    this.jitter += (noise - this.jitter) * (0.0015 + silliness * 0.004);
    const burpIrregularity = this.sound.id === "burp"
      ? clamp(finite(this.plan.irregularity, 0.7))
      : 0;
    const jitterDepth = this.sound.id === "burp"
      ? 0.16 + burpIrregularity * 0.18
      : silliness * 0.065;
    const frequency = this.plan.glottalFrequencyHz * (1 + this.jitter * jitterDepth);
    this.glottalPhase += frequency / (this.rate * SUBSTEPS);
    if (this.glottalPhase >= 1) this.glottalPhase -= 1;
    const lf = glottalSample(this.glottalPhase, this.glottalShape);
    const pressure = finite(this.configuration.lungPressure, 0) <= 0.000001
      ? 0
      : finite(frame.pressureDrive, 0);
    const voicing = clamp(finite(frame.voicing, 0));
    const aspiration = clamp(finite(frame.aspiration, 0));
    const storesSuction = this.sound.id === "pop"
      || this.sound.id === "tlik"
      || this.sound.id === "mwah";
    const breathFlow = pressure * (
      (storesSuction ? 0 : 0.0025) + aspiration * (0.009 + noise * 0.0065)
    );
    let voicedFlow = pressure * voicing * lf * 0.021;
    if (this.sound.id === "burp") {
      const irregularRate = 5.4 + (this.jitter + 1) * 2.1 + burpIrregularity * 2.8;
      this.irregularPhase += irregularRate / (this.rate * SUBSTEPS);
      if (this.irregularPhase >= 1) this.irregularPhase -= 1;
      const gasPulse = 0.22 + 0.78 * Math.max(
        0,
        Math.sin(this.irregularPhase * Math.PI * 2 + this.jitter * 1.7),
      ) ** 2;
      const foldRattle = 0.7 + Math.abs(noise) * 0.3;
      voicedFlow *= gasPulse * foldRattle * 1.18;
    }
    const direction = finite(this.plan.airflowDirection, 1) < 0 ? -1 : 1;
    return cleanWave(
      direction * (breathFlow + voicedFlow) * (0.62 + this.velocity * 0.62),
    );
  }

  advance() {
    this.ageFrames += 1;
  }
}

class HambonePhysicalProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this.rate = sampleRate;
    this.configuration = sanitizeHamboneState(
      options.processorOptions?.configuration ?? HAMBONE_DEFAULTS,
    );
    this.tract = new OrganicMouthTract(this.rate, this.configuration);
    this.faceSpace = new FaceSpace(this.rate);
    this.gesture = null;
    this.queue = [];
    this.renderedFrames = 0;
    this.eventSerial = 0;
    this.seed = 0x6d6f7574;
    this.previousNoise = 0;
    this.turbulenceFast = 0;
    this.turbulenceSlow = 0;
    this.controlCountdown = 0;
    this.blockCounter = 0;
    this.finiteAuditCountdown = 0;
    this.lastSoundId = "";
    this.lastPeak = 0;
    this.lastRms = 0;
    this.dcInputLeft = 0;
    this.dcInputRight = 0;
    this.dcOutputLeft = 0;
    this.dcOutputRight = 0;
    this.lastFrame = this.tract.currentFrame;
    this.renderLeft = 0;
    this.renderRight = 0;
    this.port.onmessage = (event) => this._handleMessage(event.data);
  }

  _eventForMessage(message) {
    const soundId = hamboneSound(message.soundId).id;
    const velocity = clamp(finite(message.velocity, 1), 0.01, 1);
    const delayFrames = Math.max(0, Math.round(clamp(finite(message.delaySeconds, 0), 0, 2) * this.rate));
    const configurationSnapshot = message.configuration
      && typeof message.configuration === "object"
      ? sanitizeHamboneState(
        { ...this.configuration, ...message.configuration },
        this.configuration,
      )
      : null;
    const planningConfiguration = configurationSnapshot ?? this.configuration;
    const plan = physicalVoiceParameters(soundId, planningConfiguration, velocity);
    const totalFrames = Math.max(1, Math.ceil(plan.durationSeconds * this.rate));
    const releasePhase = RELEASE_PHASES[soundId] ?? 0.1;
    const livePreparationFrames = Math.min(
      Math.round(this.rate * (LIVE_PREPARATION_SECONDS[soundId] ?? 0.014)),
      Math.max(1, Math.round(releasePhase * totalFrames)),
    );
    const releaseFrame = this.renderedFrames + (delayFrames > 0 ? delayFrames : livePreparationFrames);
    const availablePreparation = Math.max(0, releaseFrame - this.renderedFrames);
    const fullPreparation = Math.round(releasePhase * totalFrames);
    const startFrame = Math.max(this.renderedFrames, releaseFrame - fullPreparation);
    const actualPreparation = releaseFrame - startFrame;
    const startPhase = clamp(releasePhase - actualPreparation / totalFrames);
    return {
      soundId,
      velocity,
      order: this.eventSerial,
      requestedFrame: this.renderedFrames + delayFrames,
      releaseFrame,
      startFrame,
      startPhase,
      releasePhase,
      live: delayFrames === 0,
      requestedDelayFrames: delayFrames,
      availablePreparation,
      configurationSnapshot,
    };
  }

  _handleMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "configure") {
      this.configuration = sanitizeHamboneState(
        { ...this.configuration, ...(message.configuration ?? {}) },
        this.configuration,
      );
      if (this.gesture) this.gesture.configuration = this.configuration;
      this.controlCountdown = 0;
      return;
    }
    if (message.type === "strike" || message.type === "trigger") {
      const event = this._eventForMessage(message);
      this.eventSerial += 1;
      const simultaneousIndex = this.queue.findIndex(
        (queued) => queued.requestedFrame === event.requestedFrame,
      );
      if (simultaneousIndex >= 0) {
        const current = this.queue[simultaneousIndex];
        if (event.velocity > current.velocity) this.queue[simultaneousIndex] = event;
      } else {
        this.queue.push(event);
      }
      this.queue.sort((left, right) => left.releaseFrame - right.releaseFrame || left.order - right.order);
      return;
    }
    if (message.type === "silence" || message.type === "panic") this._silence();
  }

  _silence() {
    this.gesture = null;
    this.queue.length = 0;
    this.tract.resetWaveState();
    this.faceSpace.reset();
    this.tract.configure(this.configuration, true);
    this.controlCountdown = 0;
    this.lastPeak = 0;
    this.lastRms = 0;
    this.dcInputLeft = 0;
    this.dcInputRight = 0;
    this.dcOutputLeft = 0;
    this.dcOutputRight = 0;
  }

  _beginGesture(event, absoluteFrame) {
    const previousGestureWasAudible = Boolean(
      this.gesture && absoluteFrame >= this.gesture.releaseFrame,
    );
    const hasAcousticMemory = previousGestureWasAudible
      || Math.abs(this.tract.lastOralOutput) + Math.abs(this.tract.lastNasalOutput) > 1e-8;
    if (this.gesture || hasAcousticMemory) this.tract.chokeForRetarget(0.24);
    if (event.configurationSnapshot) {
      this.configuration = sanitizeHamboneState(
        event.configurationSnapshot,
        this.configuration,
      );
    }
    const plan = physicalVoiceParameters(event.soundId, this.configuration, event.velocity);
    const totalFrames = Math.max(1, Math.ceil(plan.durationSeconds * this.rate));
    const remainingPreparation = Math.max(0, event.releaseFrame - absoluteFrame);
    const startPhase = event.live
      ? event.startPhase
      : clamp(event.releasePhase - remainingPreparation / totalFrames);
    const startedEvent = {
      ...event,
      startFrame: absoluteFrame,
      startPhase,
      releaseFrame: Math.max(absoluteFrame + 1, event.releaseFrame),
    };
    this.gesture = new HamboneGestureController(this.rate, startedEvent, this.configuration);
    this.gesture.muteUntilRelease = !hasAcousticMemory;
    this.lastSoundId = this.gesture.sound.id;
    this.lastFrame = this.gesture.sampleControlFrame();
    const naturalPreparation = Math.max(1, Math.round(event.releasePhase * totalFrames));
    this.tract.articulationSpeedScale = event.live
      ? 8
      : clamp(naturalPreparation / Math.max(1, remainingPreparation), 1, 8);
    this.tract.tailLoss = 1;
    // Live gestures use a short sound-specific preparation and move the
    // existing geometry; they never replace the tract or jump its diameter
    // array to a new pose.
    this.tract.setArticulation(
      this.configuration,
      this.lastFrame,
      this.gesture.plan,
    );
    this.controlCountdown = CONTROL_INTERVAL_FRAMES;
  }

  _triggerDueEvent(absoluteFrame) {
    if (!this.queue.length) return;
    const next = this.queue[0];
    // The earliest requested release owns the only mouth. A later gesture may
    // shorten its preparation, but it cannot pre-empt an earlier event before
    // that event has reached its audible release.
    if (
      this.gesture
      && !next.live
      && absoluteFrame <= this.gesture.releaseFrame + Math.round(this.rate * 0.0025)
      && next.releaseFrame >= this.gesture.releaseFrame
    ) return;
    if (next.startFrame > absoluteFrame) return;
    const event = this.queue.shift();
    this._beginGesture(event, absoluteFrame);
  }

  _random() {
    this.seed = xorshift(this.seed);
    return (this.seed >>> 0) / 4294967295 * 2 - 1;
  }

  _resetAfterNonFinite() {
    this.gesture = null;
    this.queue.length = 0;
    this.tract.resetWaveState();
    this.faceSpace.reset();
    this.tract.configure(this.configuration, true);
    this.previousNoise = 0;
    this.turbulenceFast = 0;
    this.turbulenceSlow = 0;
    this.dcInputLeft = 0;
    this.dcInputRight = 0;
    this.dcOutputLeft = 0;
    this.dcOutputRight = 0;
    this.lastPeak = 0;
    this.lastRms = 0;
    this.controlCountdown = 0;
    this.finiteAuditCountdown = 0;
  }

  _renderFrame(absoluteFrame) {
    this._triggerDueEvent(absoluteFrame);
    if (this.controlCountdown <= 0) {
      if (this.gesture) this.lastFrame = this.gesture.sampleControlFrame();
      else this.lastFrame = this.tract._restFrame(this.configuration);
      this.tract.setArticulation(
        this.configuration,
        this.lastFrame,
        this.gesture?.plan ?? null,
      );
      this.controlCountdown = CONTROL_INTERVAL_FRAMES;
    }
    this.controlCountdown -= 1;

    let output = 0;
    for (let substep = 0; substep < SUBSTEPS; substep += 1) {
      const rawNoise = this._random();
      this.turbulenceFast += (rawNoise - this.turbulenceFast) * 0.42;
      this.turbulenceSlow += (rawNoise - this.turbulenceSlow) * 0.09;
      const turbulenceNoise = (this.turbulenceFast - this.turbulenceSlow) * 1.85;
      this.previousNoise = rawNoise;
      const sourceFlow = this.gesture?.sourceFlow(this.turbulenceFast) ?? 0;
      output += this.tract.processSubstep(sourceFlow, turbulenceNoise);
    }
    output /= SUBSTEPS;
    if (this.gesture && absoluteFrame >= this.gesture.releaseFrame) {
      this.tract.articulationSpeedScale = 1;
    }
    const audible = !this.gesture
      || absoluteFrame >= this.gesture.releaseFrame
      || !this.gesture.muteUntilRelease;
    if (!audible) output = 0;

    const pan = clamp(finite(this.gesture?.plan?.pan, 0), -1, 1);
    const panAngle = (pan + 1) * Math.PI * 0.25;
    // The app owns the user-facing master gain. Keep only strike dynamics here
    // so `level` is not applied twice before the safety ceiling.
    const level = 0.58 + finite(this.gesture?.velocity, 0.65) * 0.42;
    const dryLeft = output * Math.cos(panAngle) * level;
    const dryRight = output * Math.sin(panAngle) * level;
    this.faceSpace.process(dryLeft, dryRight, this.configuration);
    const left = this.faceSpace.left;
    const right = this.faceSpace.right;
    const highpassedLeft = left - this.dcInputLeft + this.dcOutputLeft * 0.995;
    const highpassedRight = right - this.dcInputRight + this.dcOutputRight * 0.995;
    this.dcInputLeft = left;
    this.dcInputRight = right;
    this.dcOutputLeft = highpassedLeft;
    this.dcOutputRight = highpassedRight;
    const boundedLeft = Math.tanh(highpassedLeft * 24) * OUTPUT_CEILING;
    const boundedRight = Math.tanh(highpassedRight * 24) * OUTPUT_CEILING;

    this.gesture?.advance();
    if (this.gesture?.complete) {
      this.gesture = null;
      this.tract.tailLoss = clamp(
        0.9968 + this.configuration.decay * 0.0018,
        0.9974,
        0.9994,
      );
      this.controlCountdown = 0;
    }
    this.finiteAuditCountdown -= 1;
    let tractIsFinite = true;
    if (this.finiteAuditCountdown <= 0) {
      tractIsFinite = this.tract.isFinite() && this.faceSpace.isFinite();
      this.finiteAuditCountdown = 32;
    }
    if (
      !Number.isFinite(boundedLeft)
      || !Number.isFinite(boundedRight)
      || !tractIsFinite
    ) {
      this._resetAfterNonFinite();
      this.renderLeft = 0;
      this.renderRight = 0;
      return;
    }
    this.renderLeft = boundedLeft;
    this.renderRight = boundedRight;
  }

  _telemetry() {
    const frame = this.lastFrame ?? this.tract._restFrame(this.configuration);
    const constrictionIndex = clamp(
      this.tract.activeConstrictionIndex,
      0,
      this.tract.sectionCount - 1,
    );
    return {
      type: "telemetry",
      activeGesture: this.gesture?.sound.id ?? "",
      activeVoices: this.gesture ? 1 : 0,
      queuedEvents: this.queue.length,
      lastSoundId: this.lastSoundId,
      gestureProgress: this.gesture?.progress ?? 1,
      gestureAmount: finite(frame.poseMix, 0),
      velocity: finite(this.gesture?.velocity, 0),
      tractPressure: this.tract.tractPressure,
      signedPressure: this.tract.signedPressure,
      oralSectionCount: this.tract.sectionCount,
      lipDiameterCm: this.tract.diameter[this.tract.sectionCount - 1],
      constrictionIndex,
      constrictionDiameterCm: this.tract.diameter[constrictionIndex],
      velumOpening: this.tract.nose.opening,
      tonguePosition: finite(frame.tonguePosition, this.configuration.tonguePosition),
      tongueCurl: finite(frame.tongueCurl, this.configuration.tongueCurl),
      mouthOpening: finite(frame.mouthOpening, this.configuration.mouthOpening),
      cheekDisplacement: this.tract.cheek.displacement,
      tongueTrillApertureCm: this.tract.tongueValve.apertureCm,
      airflowDirection: finite(this.gesture?.plan?.airflowDirection, 0),
      dooPitch: this.configuration.dooPitch,
      earSpread: this.faceSpace.earAmount,
      stereoDelayMs: this.faceSpace.stereoDelayMs,
      eyeDivergence: this.faceSpace.eyeAmount,
      peak: this.lastPeak,
      rms: this.lastRms,
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1] ?? left;
    if (!left) return true;
    let peak = 0;
    let squareSum = 0;
    for (let frame = 0; frame < left.length; frame += 1) {
      this._renderFrame(this.renderedFrames + frame);
      left[frame] = this.renderLeft;
      if (right) right[frame] = this.renderRight;
      peak = Math.max(peak, Math.abs(this.renderLeft), Math.abs(this.renderRight));
      squareSum += (this.renderLeft ** 2 + this.renderRight ** 2) * 0.5;
    }
    this.renderedFrames += left.length;
    this.lastPeak += (peak - this.lastPeak) * 0.22;
    this.lastRms += (Math.sqrt(squareSum / left.length) - this.lastRms) * 0.22;
    this.blockCounter += 1;
    if (this.blockCounter >= TELEMETRY_BLOCKS) {
      this.blockCounter = 0;
      this.port.postMessage(this._telemetry());
    }
    return true;
  }
}

registerProcessor("hambone-physical-model", HambonePhysicalProcessor);
