const TWO_PI = Math.PI * 2;
const DEFAULT_SAMPLE_RATE = 48_000;
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 384_000;
const DENORMAL_LIMIT = 1e-20;
const DC_BLOCKER_HZ = 4;
const PARAMETER_SMOOTHING_SECONDS = 0.012;
// The worklet advances this source twice per output frame. Keeping modeled
// fundamentals below 21% of the integration rate leaves transition room
// below the output-rate Nyquist frequency during the 2:1 decimation.
const DECIMATED_SOURCE_BAND_FRACTION = 0.21;
const AIR_DENSITY_KG_M3 = 1.2;
const WHISTLE_MAX_PRESSURE_PA = 2_400;
const WHISTLE_REFERENCE_PRESSURE = 0.62;
const WHISTLE_STROUHAL_NUMBERS = Object.freeze([0.145, 0.19, 0.255]);
const WHISTLE_REFERENCE_JET_SPEED = Math.sqrt(
  2 * WHISTLE_MAX_PRESSURE_PA * WHISTLE_REFERENCE_PRESSURE / AIR_DENSITY_KG_M3,
);

export const SYRINX_SOURCE_MODEL_IDS = Object.freeze({
  TWO_MASS: "twoMass",
  SYRINX: "syrinx",
  FROG: "frog",
  WHISTLE: "whistle",
});

const SOURCE_MODELS = new Set(Object.values(SYRINX_SOURCE_MODEL_IDS));

export const SYRINX_SOURCE_PARAMETER_LIMITS = Object.freeze({
  pressure: Object.freeze([0, 1]),
  tension: Object.freeze([0, 1]),
  adduction: Object.freeze([0, 1]),
  sourceScale: Object.freeze([0, 1]),
  breath: Object.freeze([0, 1]),
  roughness: Object.freeze([0, 1]),
  asymmetry: Object.freeze([-1, 1]),
  pulseRateHz: Object.freeze([0.5, 250]),
  coupling: Object.freeze([0, 1]),
  sourceBalance: Object.freeze([-1, 1]),
  feedback: Object.freeze([0, 1]),
  outputGain: Object.freeze([0, 1.5]),
});

export const SYRINX_SOURCE_FREQUENCY_LIMITS = Object.freeze({
  [SYRINX_SOURCE_MODEL_IDS.TWO_MASS]: Object.freeze([5, 2_400]),
  [SYRINX_SOURCE_MODEL_IDS.SYRINX]: Object.freeze([40, 8_000]),
  [SYRINX_SOURCE_MODEL_IDS.FROG]: Object.freeze([30, 3_000]),
  [SYRINX_SOURCE_MODEL_IDS.WHISTLE]: Object.freeze([500, 40_000]),
});

const SHARED_DEFAULTS = Object.freeze({
  pressure: 0.65,
  tension: 0.5,
  adduction: 0.65,
  sourceScale: 0.5,
  breath: 0.08,
  roughness: 0.08,
  asymmetry: 0,
  pulseRateHz: 28,
  coupling: 0.4,
  sourceBalance: 0,
  feedback: 0.3,
  outputGain: 0.8,
});

function freezeDefaults(model, values) {
  return Object.freeze({ ...SHARED_DEFAULTS, model, ...values });
}

export const SYRINX_SOURCE_DEFAULTS = Object.freeze({
  [SYRINX_SOURCE_MODEL_IDS.TWO_MASS]: freezeDefaults(
    SYRINX_SOURCE_MODEL_IDS.TWO_MASS,
    {
      frequencyHz: 115,
      pressure: 0.68,
      adduction: 0.72,
      roughness: 0.12,
      asymmetry: 0.04,
      coupling: 0.58,
      outputGain: 0.82,
    },
  ),
  [SYRINX_SOURCE_MODEL_IDS.SYRINX]: freezeDefaults(
    SYRINX_SOURCE_MODEL_IDS.SYRINX,
    {
      frequencyHz: 900,
      pressure: 0.58,
      tension: 0.7,
      adduction: 0.56,
      roughness: 0.04,
      asymmetry: 0.12,
      coupling: 0.24,
      outputGain: 0.72,
    },
  ),
  [SYRINX_SOURCE_MODEL_IDS.FROG]: freezeDefaults(
    SYRINX_SOURCE_MODEL_IDS.FROG,
    {
      frequencyHz: 210,
      pressure: 0.76,
      tension: 0.34,
      adduction: 0.68,
      breath: 0.04,
      pulseRateHz: 26,
      coupling: 0.1,
      outputGain: 0.9,
    },
  ),
  [SYRINX_SOURCE_MODEL_IDS.WHISTLE]: freezeDefaults(
    SYRINX_SOURCE_MODEL_IDS.WHISTLE,
    {
      frequencyHz: 11_500,
      pressure: 0.62,
      tension: 0.5,
      adduction: 0.3,
      breath: 0.12,
      roughness: 0.03,
      coupling: 0.08,
      feedback: 0.16,
      outputGain: 0.58,
    },
  ),
});

const NUMERIC_PARAMETER_KEYS = Object.freeze([
  "frequencyHz",
  "pressure",
  "tension",
  "adduction",
  "sourceScale",
  "breath",
  "roughness",
  "asymmetry",
  "pulseRateHz",
  "coupling",
  "sourceBalance",
  "feedback",
  "outputGain",
]);

function freezePreset(id, label, family, description, parameters) {
  return Object.freeze({
    id,
    label,
    family,
    description,
    parameters: Object.freeze({ ...parameters }),
  });
}

/**
 * Small source-family examples for isolated DSP audition and compatibility.
 * The page's larger `ANIMALS` registry in `syrinx.js` is authoritative; these
 * are not claims of exact individual-animal anatomy.
 */
export const SYRINX_SOURCE_EXAMPLES = Object.freeze({
  wolf: freezePreset(
    "wolf",
    "Wolf howl",
    "mammal",
    "A sustained, moderately asymmetric vocal-fold oscillation.",
    {
      ...SYRINX_SOURCE_DEFAULTS.twoMass,
      frequencyHz: 128,
      pressure: 0.72,
      tension: 0.48,
      breath: 0.12,
      roughness: 0.09,
      asymmetry: 0.07,
      feedback: 0.42,
    },
  ),
  lion: freezePreset(
    "lion",
    "Lion roar",
    "mammal",
    "Heavy folds, high pressure, and asymmetry favor a rough low source.",
    {
      ...SYRINX_SOURCE_DEFAULTS.twoMass,
      frequencyHz: 58,
      pressure: 0.9,
      tension: 0.2,
      adduction: 0.82,
      breath: 0.18,
      roughness: 0.58,
      asymmetry: 0.32,
      coupling: 0.38,
      outputGain: 0.9,
    },
  ),
  cat: freezePreset(
    "cat",
    "Cat purr",
    "mammal",
    "A low laryngeal oscillation with soft closure and audible airflow.",
    {
      ...SYRINX_SOURCE_DEFAULTS.twoMass,
      frequencyHz: 27,
      pressure: 0.54,
      tension: 0.16,
      adduction: 0.58,
      breath: 0.2,
      roughness: 0.16,
      asymmetry: 0.05,
      coupling: 0.72,
      outputGain: 0.88,
    },
  ),
  canary: freezePreset(
    "canary",
    "Canary phrase",
    "bird",
    "Two lightly coupled syringeal sides produce a bright biphonic source.",
    {
      ...SYRINX_SOURCE_DEFAULTS.syrinx,
      frequencyHz: 1_650,
      pressure: 0.62,
      tension: 0.82,
      adduction: 0.48,
      roughness: 0.025,
      asymmetry: 0.18,
      coupling: 0.16,
      sourceBalance: 0.08,
      outputGain: 0.68,
    },
  ),
  raven: freezePreset(
    "raven",
    "Raven croak",
    "bird",
    "Low bilateral labia with loose coupling and pronounced asymmetry.",
    {
      ...SYRINX_SOURCE_DEFAULTS.syrinx,
      frequencyHz: 310,
      pressure: 0.78,
      tension: 0.28,
      adduction: 0.74,
      breath: 0.13,
      roughness: 0.48,
      asymmetry: 0.36,
      coupling: 0.08,
      sourceBalance: -0.12,
      outputGain: 0.82,
    },
  ),
  bullfrog: freezePreset(
    "bullfrog",
    "Bullfrog pulse",
    "frog",
    "Pressure pulses excite a damped laryngeal membrane resonator.",
    {
      ...SYRINX_SOURCE_DEFAULTS.frog,
      frequencyHz: 185,
      pressure: 0.86,
      tension: 0.26,
      adduction: 0.78,
      breath: 0.035,
      roughness: 0.1,
      pulseRateHz: 23,
      feedback: 0.48,
      outputGain: 0.95,
    },
  ),
  mouse: freezePreset(
    "mouse",
    "Mouse whistle",
    "rodent",
    "An audible-range wall-impingement jet whistle with mode jumps.",
    {
      ...SYRINX_SOURCE_DEFAULTS.whistle,
      frequencyHz: 13_500,
      pressure: 0.68,
      tension: 0.52,
      adduction: 0.22,
      breath: 0.1,
      roughness: 0.04,
      asymmetry: 0.04,
      outputGain: 0.52,
    },
  ),
});

/**
 * @deprecated The page-level animal authority is `ANIMALS` in `syrinx.js`.
 * This alias remains for saved integrations; these are source-family examples.
 */
export const SYRINX_ANIMAL_PRESETS = SYRINX_SOURCE_EXAMPLES;

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function unit(value, fallback = 0) {
  return clamp(finiteNumber(value, fallback), 0, 1);
}

function bipolar(value, fallback = 0) {
  return clamp(finiteNumber(value, fallback), -1, 1);
}

function safeSampleRate(value) {
  return clamp(finiteNumber(value, DEFAULT_SAMPLE_RATE), MIN_SAMPLE_RATE, MAX_SAMPLE_RATE);
}

function normalizeSeed(value) {
  const seed = finiteNumber(value, 0x51f15e) >>> 0;
  return seed || 0x6d2b79f5;
}

export function syrinxSourceModelId(value) {
  if (SOURCE_MODELS.has(value)) return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "mammal" || normalized === "twomass" || normalized === "two-mass") {
    return SYRINX_SOURCE_MODEL_IDS.TWO_MASS;
  }
  if (normalized === "bird" || normalized === "avian" || normalized === "dual-syrinx") {
    return SYRINX_SOURCE_MODEL_IDS.SYRINX;
  }
  if (normalized === "anuran" || normalized === "membrane") {
    return SYRINX_SOURCE_MODEL_IDS.FROG;
  }
  if (normalized === "rodent" || normalized === "jet" || normalized === "usv") {
    return SYRINX_SOURCE_MODEL_IDS.WHISTLE;
  }
  return SYRINX_SOURCE_MODEL_IDS.TWO_MASS;
}

function frequencyRange(model, sampleRate) {
  const limits = SYRINX_SOURCE_FREQUENCY_LIMITS[model];
  return [
    limits[0],
    Math.max(
      limits[0],
      Math.min(limits[1], sampleRate * DECIMATED_SOURCE_BAND_FRACTION),
    ),
  ];
}

/**
 * Turns arbitrary saved/UI data into a complete AudioWorklet-safe parameter
 * object. Frequencies are kept below 21% of the integration sample rate so
 * the dedicated worklet can safely reduce its 2x physical simulation.
 */
export function sanitizeSyrinxSourceParameters(input = {}, sampleRate = DEFAULT_SAMPLE_RATE) {
  const rate = safeSampleRate(sampleRate);
  const model = syrinxSourceModelId(input.model ?? input.sourceModel);
  const defaults = SYRINX_SOURCE_DEFAULTS[model];
  const [minimumFrequency, maximumFrequency] = frequencyRange(model, rate);
  return {
    model,
    frequencyHz: clamp(
      finiteNumber(input.frequencyHz ?? input.pitchHz, defaults.frequencyHz),
      minimumFrequency,
      maximumFrequency,
    ),
    pressure: unit(input.pressure ?? input.intensity, defaults.pressure),
    tension: unit(input.tension, defaults.tension),
    adduction: unit(input.adduction ?? input.closure, defaults.adduction),
    sourceScale: unit(input.sourceScale, defaults.sourceScale),
    breath: unit(input.breath, defaults.breath),
    roughness: unit(input.roughness, defaults.roughness),
    asymmetry: bipolar(input.asymmetry, defaults.asymmetry),
    pulseRateHz: clamp(
      finiteNumber(input.pulseRateHz, defaults.pulseRateHz),
      ...SYRINX_SOURCE_PARAMETER_LIMITS.pulseRateHz,
    ),
    coupling: unit(input.coupling, defaults.coupling),
    sourceBalance: bipolar(input.sourceBalance ?? input.balance, defaults.sourceBalance),
    feedback: unit(input.feedback, defaults.feedback),
    outputGain: clamp(
      finiteNumber(input.outputGain ?? input.output, defaults.outputGain),
      ...SYRINX_SOURCE_PARAMETER_LIMITS.outputGain,
    ),
  };
}

/**
 * Maps normalized panel controls to physical-model parameters. `pitch`,
 * `pulseRate`, `asymmetry`, and `balance` are 0..1 controls; pitch is
 * logarithmic and the two bipolar controls are centered at 0.5.
 */
export function mapSyrinxSourceControls(
  modelValue,
  controls = {},
  sampleRate = DEFAULT_SAMPLE_RATE,
) {
  const rate = safeSampleRate(sampleRate);
  const model = syrinxSourceModelId(modelValue);
  const defaults = SYRINX_SOURCE_DEFAULTS[model];
  const [minimumFrequency, maximumFrequency] = frequencyRange(model, rate);
  const defaultPitch = Math.log(defaults.frequencyHz / minimumFrequency)
    / Math.log(maximumFrequency / minimumFrequency);
  const pitch = unit(controls.pitch, defaultPitch);
  const pulseRate = unit(
    controls.pulseRate,
    (defaults.pulseRateHz - SYRINX_SOURCE_PARAMETER_LIMITS.pulseRateHz[0])
      / (SYRINX_SOURCE_PARAMETER_LIMITS.pulseRateHz[1]
        - SYRINX_SOURCE_PARAMETER_LIMITS.pulseRateHz[0]),
  );
  return sanitizeSyrinxSourceParameters({
    model,
    frequencyHz: minimumFrequency
      * Math.pow(maximumFrequency / minimumFrequency, pitch),
    pressure: controls.pressure,
    tension: controls.tension,
    adduction: controls.adduction,
    sourceScale: controls.sourceScale,
    breath: controls.breath,
    roughness: controls.roughness,
    asymmetry: controls.asymmetry === undefined
      ? defaults.asymmetry
      : unit(controls.asymmetry, 0.5) * 2 - 1,
    pulseRateHz: SYRINX_SOURCE_PARAMETER_LIMITS.pulseRateHz[0]
      + pulseRate * (
        SYRINX_SOURCE_PARAMETER_LIMITS.pulseRateHz[1]
        - SYRINX_SOURCE_PARAMETER_LIMITS.pulseRateHz[0]
      ),
    coupling: controls.coupling,
    sourceBalance: controls.balance === undefined
      ? defaults.sourceBalance
      : unit(controls.balance, 0.5) * 2 - 1,
    feedback: controls.feedback,
    outputGain: controls.output,
  }, rate);
}

export function syrinxSourceExample(id = "wolf") {
  const key = Object.hasOwn(SYRINX_SOURCE_EXAMPLES, id) ? id : "wolf";
  const preset = SYRINX_SOURCE_EXAMPLES[key];
  return {
    ...preset,
    parameters: { ...preset.parameters },
  };
}

/** @deprecated Use `syrinxSourceExample`; retained for compatibility. */
export function syrinxAnimalPreset(id = "wolf") {
  return syrinxSourceExample(id);
}

function cleanState(value, limit = 8) {
  if (!Number.isFinite(value) || Math.abs(value) < DENORMAL_LIMIT) return 0;
  return clamp(value, -limit, limit);
}

function validOutputBuffer(output) {
  return output
    && Number.isSafeInteger(output.length)
    && output.length >= 0
    && typeof output !== "string";
}

/**
 * A deterministic, allocation-free-at-sample-rate source bank. The returned
 * signal is intended to feed the glottal/source entrance of Throatazoid's
 * tract waveguide. `tractPressure` is a normalized supraglottal-pressure
 * feedback signal, not an audio mix input.
 */
export class SyrinxSourceEngine {
  constructor(options = {}) {
    const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    const parameters = options.parameters ?? {};
    const model = options.model
      ?? parameters.model
      ?? parameters.sourceModel
      ?? SYRINX_SOURCE_MODEL_IDS.TWO_MASS;
    const seed = options.seed ?? 0x51f15e;
    this.sampleRate = safeSampleRate(sampleRate);
    this.seed = normalizeSeed(seed);
    this.target = sanitizeSyrinxSourceParameters({ ...parameters, model }, this.sampleRate);
    this.current = { ...this.target };
    this.smoothing = 1 - Math.exp(
      -1 / (this.sampleRate * PARAMETER_SMOOTHING_SECONDS),
    );
    this.dcBlockerPole = Math.exp(-TWO_PI * DC_BLOCKER_HZ / this.sampleRate);
    this.reset(this.seed);
  }

  setParameters(parameters = {}) {
    const requestedModel = syrinxSourceModelId(
      parameters.model ?? parameters.sourceModel ?? this.target.model,
    );
    const changedModel = requestedModel !== this.target.model;
    const base = changedModel
      ? SYRINX_SOURCE_DEFAULTS[requestedModel]
      : this.target;
    this.target = sanitizeSyrinxSourceParameters({
      ...base,
      ...parameters,
      model: requestedModel,
    }, this.sampleRate);
    if (changedModel) {
      this.current = { ...this.target };
      this._resetPhysicalState();
    }
    return { ...this.target };
  }

  reset(seed = this.seed) {
    this.seed = normalizeSeed(seed);
    this.noiseState = this.seed;
    this.current = { ...this.target };
    this._resetPhysicalState();
    return this;
  }

  _resetPhysicalState() {
    const perturbation = ((this.seed & 0xffff) / 0xffff - 0.5) * 0.001;
    this.mammalX1 = 0.001 + perturbation;
    this.mammalV1 = 0;
    this.mammalX2 = -0.0007 - perturbation * 0.5;
    this.mammalV2 = 0;
    this.mammalPreviousFlow = 0;
    this.mammalFlow = 0;

    this.birdXLeft = -0.24 + perturbation;
    this.birdYLeft = 0;
    this.birdXRight = -0.22 - perturbation;
    this.birdYRight = 0;
    this.birdPreviousFlowLeft = 0;
    this.birdPreviousFlowRight = 0;
    this.birdTensionNoise = 0;
    this.bilateralDifference = 0;

    this.frogCallPhase = 0.17;
    this.frogMembraneX = 0.001 + perturbation;
    this.frogMembraneVelocity = 0;
    this.frogPreviousFlow = 0;
    this.frogDrivingPressure = 0;

    this.whistlePhase = 0;
    this.whistleAmplitude = 0.001;
    this.whistleMode = 1;
    this.whistleNoise = 0;
    this.whistleJetSpeed = 0;
    this.whistleImpingementLength = 0;
    this.whistleFrequencyHz = 0;
    this.whistleStrouhalNumber = WHISTLE_STROUHAL_NUMBERS[1];

    this.breathNoise = 0;
    this.dcInput = 0;
    this.dcOutput = 0;
  }

  _nextNoise() {
    let value = this.noiseState;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.noiseState = value >>> 0;
    return this.noiseState / 0x80000000 - 1;
  }

  _smoothParameters() {
    for (let index = 0; index < NUMERIC_PARAMETER_KEYS.length; index += 1) {
      const key = NUMERIC_PARAMETER_KEYS[index];
      this.current[key] += (this.target[key] - this.current[key]) * this.smoothing;
    }
  }

  _effectivePressure(tractPressure) {
    const feedbackPressure = clamp(finiteNumber(tractPressure, 0), -1, 1);
    return clamp(
      // Signed supraglottal pressure: compression opposes lung pressure while
      // rarefaction increases the instantaneous transglottal pressure drop.
      this.current.pressure - feedbackPressure * this.current.feedback * 0.72,
      0,
      1,
    );
  }

  _renderTwoMass(tractPressure) {
    const parameters = this.current;
    const pressure = this._effectivePressure(tractPressure);
    const scale = parameters.sourceScale;

    // A normalized Ishizaka-Flanagan two-mass system: inferior and superior
    // tissue masses each retain displacement and velocity, with their own
    // stiffness/damping and an inter-mass spring. The quasi-steady glottal
    // flow below is Bernoulli-like. Lineage: Ishizaka & Flanagan (1972),
    // doi:10.1002/j.1538-7305.1972.tb02651. This is an original reduced
    // implementation, not code transcribed from that work.
    const lowerMass = 0.82 + scale * 0.36;
    const upperMass = 0.2 + scale * 0.18;
    const lowerStiffness = 0.72 + parameters.tension * 0.72;
    const upperStiffness = 0.5 + parameters.tension * 0.62;
    const couplingStiffness = 0.08 + parameters.coupling * 0.66;
    const lowerDamping = 0.075 + (1 - parameters.tension) * 0.035;
    const upperDamping = 0.085
      + (1 - parameters.tension) * 0.04
      + parameters.asymmetry * 0.025;

    // Compensate the integration clock for the lower eigenmode so the public
    // frequency control remains useful while mass and tension alter timbre.
    const matrixA = (lowerStiffness + couplingStiffness) / lowerMass;
    const matrixD = (upperStiffness + couplingStiffness) / upperMass;
    const matrixBC = couplingStiffness * couplingStiffness
      / (lowerMass * upperMass);
    const lowerEigenvalue = Math.max(
      0.08,
      0.5 * (
        matrixA + matrixD
        - Math.sqrt((matrixA - matrixD) ** 2 + 4 * matrixBC)
      ),
    );
    const normalizedStep = TWO_PI * parameters.frequencyHz
      / (Math.sqrt(lowerEigenvalue) * this.sampleRate);
    const substeps = Math.max(1, Math.min(64, Math.ceil(normalizedStep / 0.035)));
    const step = normalizedStep / substeps;
    const lowerRestGap = 0.035 + (1 - parameters.adduction) * 0.23;
    const upperRestGap = 0.03 + (1 - parameters.adduction) * 0.2;
    const phonationThreshold = 0.11 + (1 - parameters.adduction) * 0.14;
    const energyTransfer = Math.max(0, pressure - phonationThreshold)
      * (0.72 + parameters.roughness * 1.25);
    const collisionStiffness = 7 + parameters.adduction * 22;
    const collisionDamping = 0.24 + parameters.adduction * 0.5;
    let flow = this.mammalFlow;

    for (let substep = 0; substep < substeps; substep += 1) {
      const lowerGap = lowerRestGap + this.mammalX1;
      const upperGap = upperRestGap + this.mammalX2;
      const openLower = Math.max(0.0001, lowerGap);
      const openUpper = Math.max(0.0001, upperGap);
      const minimumGap = Math.max(0, Math.min(lowerGap, upperGap));
      flow = 0.78 * minimumGap * Math.sqrt(2 * pressure);

      const lowerJetSpeed = flow / openLower;
      const upperJetSpeed = flow / openUpper;
      const lowerDynamicPressure = 0.5 * lowerJetSpeed * lowerJetSpeed;
      const upperDynamicPressure = 0.5 * upperJetSpeed * upperJetSpeed;
      const lowerWallPressure = Math.max(0, pressure - lowerDynamicPressure);
      // A divergent glottis separates the jet near the inferior mass, leaving
      // little pressure recovery at the superior mass; a convergent glottis
      // retains part of that pressure. Their alternation transfers flow energy.
      const divergent = upperGap > lowerGap;
      const upperWallPressure = divergent
        ? lowerWallPressure * 0.08
        : Math.max(0, pressure - upperDynamicPressure) * 0.58;
      const flowWork = energyTransfer * flow / Math.max(0.025, minimumGap + 0.025);
      const lowerAerodynamicForce = lowerWallPressure * (0.44 + scale * 0.34)
        + flowWork * (1 - 0.32 * this.mammalX1 * this.mammalX1) * this.mammalV1;
      const upperAerodynamicForce = upperWallPressure * (0.3 + scale * 0.26)
        + flowWork * 0.68
          * (1 - 0.38 * this.mammalX2 * this.mammalX2)
          * this.mammalV2;
      const lowerPenetration = Math.max(0, -lowerGap);
      const upperPenetration = Math.max(0, -upperGap);
      const lowerCollision = collisionStiffness * lowerPenetration ** 1.5
        - Math.min(0, this.mammalV1) * collisionDamping * lowerPenetration;
      const upperCollision = collisionStiffness * upperPenetration ** 1.5
        - Math.min(0, this.mammalV2) * collisionDamping * upperPenetration;
      const lowerAcceleration = (
        lowerAerodynamicForce
        - lowerDamping * this.mammalV1
        - lowerStiffness * this.mammalX1
        - couplingStiffness * (this.mammalX1 - this.mammalX2)
        + lowerCollision
      ) / lowerMass;
      const upperAcceleration = (
        upperAerodynamicForce
        - upperDamping * this.mammalV2
        - upperStiffness * this.mammalX2
        - couplingStiffness * (this.mammalX2 - this.mammalX1)
        + upperCollision
      ) / upperMass;
      this.mammalV1 = cleanState(this.mammalV1 + lowerAcceleration * step, 10);
      this.mammalV2 = cleanState(this.mammalV2 + upperAcceleration * step, 10);
      this.mammalX1 = cleanState(this.mammalX1 + this.mammalV1 * step, 2.5);
      this.mammalX2 = cleanState(this.mammalX2 + this.mammalV2 * step, 2.5);
    }
    this.mammalFlow = flow;

    const derivativeScale = Math.min(
      8,
      this.sampleRate / Math.max(1, TWO_PI * parameters.frequencyHz),
    );
    const flowDerivative = (flow - this.mammalPreviousFlow) * derivativeScale;
    this.mammalPreviousFlow = flow;

    const noise = this._nextNoise();
    this.breathNoise += (noise - this.breathNoise) * 0.17;
    const turbulence = (noise - this.breathNoise)
      * parameters.breath
      * Math.sqrt(pressure)
      * (0.08 + 0.18 * (1 - Math.min(1, flow)));
    // A differentiating lip/tract load follows this source. Keep the tissue
    // flow derivative in the same practical range as the other source
    // families so switching animals does not create a large level step.
    return flowDerivative * (2.65 + parameters.tension * 1.25) + turbulence;
  }

  _renderSyrinx(tractPressure) {
    const parameters = this.current;
    const pressure = this._effectivePressure(tractPressure);
    const noise = this._nextNoise();
    this.birdTensionNoise += (noise - this.birdTensionNoise) * 0.0025;

    // Each bronchial side follows the two-state normal form used by
    // Laje/Mindlin and Alonso et al. for labial displacement x and scaled
    // velocity y: x'=y; y'=-alpha-beta*x-x^3+x^2-(x^2+x)*y.
    // alpha is pressure-like, beta is tension-like, and the clock gamma is
    // chosen from frequencyHz. Adduction narrows the resting labial opening
    // and reduces leak losses; asymmetry gives the two sides opposite pressure
    // and tension offsets. doi:10.1152/jn.00385.2015.
    const leftPressure = clamp(pressure * (1 - parameters.asymmetry * 0.08), 0, 1);
    const rightPressure = clamp(pressure * (1 + parameters.asymmetry * 0.08), 0, 1);
    const alphaLeft = -0.18 + leftPressure * 0.46 + parameters.adduction * 0.08;
    const alphaRight = -0.18 + rightPressure * 0.46 + parameters.adduction * 0.08;
    const betaBase = 0.12 + parameters.tension * 1.9;
    const betaNoise = parameters.roughness * this.birdTensionNoise * 0.1;
    const betaLeft = Math.max(
      0.08,
      betaBase * (1 + parameters.asymmetry * 0.28) + betaNoise,
    );
    const betaRight = Math.max(
      0.08,
      betaBase * (1 - parameters.asymmetry * 0.28) - betaNoise,
    );
    const nativeAngularFrequency = Math.sqrt(betaBase + 0.2);
    const normalizedStep = TWO_PI * parameters.frequencyHz
      / (nativeAngularFrequency * this.sampleRate);
    const substeps = Math.max(1, Math.min(96, Math.ceil(normalizedStep / 0.035)));
    const step = normalizedStep / substeps;
    const bilateralCoupling = parameters.coupling * 0.055;
    const leakDamping = (1 - parameters.adduction) * 0.035;

    for (let substep = 0; substep < substeps; substep += 1) {
      const couplingLeft = bilateralCoupling * (this.birdXRight - this.birdXLeft);
      const couplingRight = bilateralCoupling * (this.birdXLeft - this.birdXRight);
      const accelerationLeft = -alphaLeft
        - betaLeft * this.birdXLeft
        - this.birdXLeft ** 3
        + this.birdXLeft * this.birdXLeft
        - (this.birdXLeft * this.birdXLeft + this.birdXLeft) * this.birdYLeft
        - leakDamping * this.birdYLeft
        + couplingLeft;
      const accelerationRight = -alphaRight
        - betaRight * this.birdXRight
        - this.birdXRight ** 3
        + this.birdXRight * this.birdXRight
        - (this.birdXRight * this.birdXRight + this.birdXRight) * this.birdYRight
        - leakDamping * this.birdYRight
        + couplingRight;
      this.birdYLeft = cleanState(this.birdYLeft + accelerationLeft * step, 8);
      this.birdYRight = cleanState(this.birdYRight + accelerationRight * step, 8);
      this.birdXLeft = cleanState(this.birdXLeft + this.birdYLeft * step, 3);
      this.birdXRight = cleanState(this.birdXRight + this.birdYRight * step, 3);
    }

    const restOpening = (0.055 + (1 - parameters.adduction) * 0.17)
      * (0.82 + parameters.sourceScale * 0.36);
    const leftOpening = Math.max(0, restOpening + this.birdXLeft * 0.24);
    const rightOpening = Math.max(0, restOpening + this.birdXRight * 0.24);
    const leftFlow = leftOpening * Math.sqrt(2 * leftPressure);
    const rightFlow = rightOpening * Math.sqrt(2 * rightPressure);
    const derivativeScale = Math.min(
      8,
      this.sampleRate / Math.max(1, TWO_PI * parameters.frequencyHz),
    );
    const left = (leftFlow - this.birdPreviousFlowLeft) * derivativeScale * 2.8;
    const right = (rightFlow - this.birdPreviousFlowRight) * derivativeScale * 2.8;
    this.birdPreviousFlowLeft = leftFlow;
    this.birdPreviousFlowRight = rightFlow;
    this.bilateralDifference = clamp((left - right) * 0.72, -1, 1);
    const leftGain = Math.sqrt((1 - parameters.sourceBalance) * 0.5);
    const rightGain = Math.sqrt((1 + parameters.sourceBalance) * 0.5);

    this.breathNoise += (noise - this.breathNoise) * 0.11;
    const airflow = parameters.breath * Math.sqrt(pressure)
      * (noise - this.breathNoise) * 0.12;
    return (left * leftGain + right * rightGain) * 0.82 + airflow;
  }

  _renderFrog(tractPressure) {
    const parameters = this.current;
    const pressure = this._effectivePressure(tractPressure);
    const noise = this._nextNoise();

    // Kime, Ryan & Wilson's anuran source is an air-driven, pressure-threshold
    // mass/spring system (JASA 2013, doi:10.1121/1.4802743). This compact
    // membrane reduction uses pressure-dependent nonlinear damping to cross
    // the same stationary/self-oscillating boundary; pulseRate only modulates
    // the calling pressure and never clocks or strikes the carrier.
    const modulationRate = Math.min(
      parameters.pulseRateHz,
      Math.max(0.5, parameters.frequencyHz * 0.25),
    );
    this.frogCallPhase += TWO_PI * modulationRate / this.sampleRate;
    if (this.frogCallPhase >= TWO_PI) this.frogCallPhase %= TWO_PI;
    const pressureDepth = 0.2 + parameters.coupling * 0.48;
    const pressureCycle = 0.5 + 0.5 * Math.sin(this.frogCallPhase);
    const drivingPressure = pressure * (1 - pressureDepth + pressureDepth * pressureCycle);
    this.frogDrivingPressure = drivingPressure;
    const threshold = 0.12 + (1 - parameters.adduction) * 0.16;
    const nonlinearDrive = (drivingPressure - threshold)
      * (3.8 + parameters.roughness * 5.2);
    // The single state pair is an equivalent mode of paired laryngeal
    // membranes. Asymmetry skews its linear/cubic stiffness and damping,
    // moving the reduced mode toward the irregular regimes seen in excised
    // anuran larynges instead of becoming a post-process stereo effect.
    const membraneSkew = parameters.asymmetry;
    const stiffness = (0.82 + parameters.tension * 0.42) * (1 + membraneSkew * 0.16);
    const cubicStiffness = 0.08
      + parameters.roughness * 0.72
      + Math.abs(membraneSkew) * 0.38;
    const passiveDamping = (0.035 + (1 - parameters.adduction) * 0.09)
      * (1 - Math.abs(membraneSkew) * 0.14);
    const normalizedStep = TWO_PI * parameters.frequencyHz
      / (Math.sqrt(stiffness) * this.sampleRate);
    const substeps = Math.max(1, Math.min(64, Math.ceil(normalizedStep / 0.04)));
    const step = normalizedStep / substeps;
    const restGap = 0.045 + (1 - parameters.adduction) * 0.2;
    const pressureForce = drivingPressure * (0.12 + parameters.sourceScale * 0.08);
    const collisionStiffness = 5 + parameters.adduction * 16;

    for (let substep = 0; substep < substeps; substep += 1) {
      const gap = restGap + this.frogMembraneX;
      const penetration = Math.max(0, -gap);
      const collision = collisionStiffness * penetration ** 1.5
        - Math.min(0, this.frogMembraneVelocity) * penetration * 0.42;
      const acceleration = pressureForce
        - stiffness * this.frogMembraneX
        - cubicStiffness * this.frogMembraneX ** 3
        + nonlinearDrive
          * (1 - this.frogMembraneX * this.frogMembraneX)
          * this.frogMembraneVelocity
        - passiveDamping * this.frogMembraneVelocity
        + collision;
      this.frogMembraneVelocity = cleanState(
        this.frogMembraneVelocity + acceleration * step,
        9,
      );
      this.frogMembraneX = cleanState(
        this.frogMembraneX + this.frogMembraneVelocity * step,
        3,
      );
    }

    const membraneGap = Math.max(0, restGap + this.frogMembraneX);
    const flow = membraneGap * Math.sqrt(2 * drivingPressure);
    const derivativeScale = Math.min(
      8,
      this.sampleRate / Math.max(1, TWO_PI * parameters.frequencyHz),
    );
    const membrane = (flow - this.frogPreviousFlow) * derivativeScale * 3.2;
    this.frogPreviousFlow = flow;
    this.breathNoise += (noise - this.breathNoise) * 0.08;
    const pulseAir = (noise - this.breathNoise)
      * parameters.breath
      * drivingPressure
      * 0.18;
    return membrane * (0.74 + drivingPressure * 0.42) + pulseAir;
  }

  _updateWhistleMode(control) {
    if (this.whistleMode === 0 && control > 0.36) this.whistleMode = 1;
    if (this.whistleMode === 1 && control < 0.26) this.whistleMode = 0;
    if (this.whistleMode === 1 && control > 0.68) this.whistleMode = 2;
    if (this.whistleMode === 2 && control < 0.58) this.whistleMode = 1;
  }

  _renderWhistle(tractPressure) {
    const parameters = this.current;
    const pressure = this._effectivePressure(tractPressure);
    const modeControl = parameters.tension
      + (pressure - WHISTLE_REFERENCE_PRESSURE) * 0.14
      - (parameters.sourceScale - 0.5) * 0.05
      + parameters.asymmetry * 0.04;
    this._updateWhistleMode(modeControl);

    const threshold = 0.16 + parameters.adduction * 0.08;
    const growth = (pressure - threshold) * 90;
    const saturation = 64;
    const squared = this.whistleAmplitude * this.whistleAmplitude;
    const noise = this._nextNoise();
    // Turbulent jet fluctuations are an additive physical onset seed, so a
    // source that has decayed to exact zero during a long idle can restart.
    const onsetForcing = Math.max(0, pressure - threshold)
      * (0.025 + parameters.roughness * (noise + 1) * 0.012);
    this.whistleAmplitude += (
      growth * this.whistleAmplitude
      - saturation * squared * this.whistleAmplitude
      + onsetForcing
    ) / this.sampleRate;
    this.whistleAmplitude = clamp(cleanState(this.whistleAmplitude, 1.25), 0, 1.25);

    this.whistleNoise += (noise - this.whistleNoise) * 0.025;

    // Wall-impingement reduction: Bernoulli gives jet speed u=sqrt(2P/rho),
    // and a stable mode follows f=St*u/x for impingement length x. Mahrt et
    // al. (2016), doi:10.1016/j.cub.2016.08.032; Riede et al. (2021),
    // doi:10.1186/s12915-021-01185-z. frequencyHz calibrates x at reference
    // pressure; live pressure and geometry then determine the actual pitch.
    const pressurePa = pressure * WHISTLE_MAX_PRESSURE_PA;
    const jetSpeed = Math.sqrt(2 * pressurePa / AIR_DENSITY_KG_M3);
    const sourceLengthScale = 0.75 + parameters.sourceScale * 0.5;
    const muscleLengthScale = 1.12 - parameters.tension * 0.24;
    const asymmetryLengthScale = 1 + parameters.asymmetry * 0.08;
    const referenceLength = WHISTLE_STROUHAL_NUMBERS[1]
      * WHISTLE_REFERENCE_JET_SPEED
      / Math.max(1, parameters.frequencyHz);
    const impingementLength = clamp(
      referenceLength * sourceLengthScale * muscleLengthScale * asymmetryLengthScale,
      0.00012,
      0.006,
    );
    const strouhalNumber = WHISTLE_STROUHAL_NUMBERS[this.whistleMode];
    const jitteredJetSpeed = jetSpeed
      * (1 + parameters.roughness * this.whistleNoise * 0.012);
    const sourceBandLimit = this.sampleRate * DECIMATED_SOURCE_BAND_FRACTION;
    const frequency = Math.min(
      sourceBandLimit,
      strouhalNumber * jitteredJetSpeed / impingementLength,
    );
    this.whistleJetSpeed = jetSpeed;
    this.whistleImpingementLength = impingementLength;
    this.whistleFrequencyHz = frequency;
    this.whistleStrouhalNumber = strouhalNumber;
    this.whistlePhase += TWO_PI * frequency / this.sampleRate;
    if (this.whistlePhase >= TWO_PI) this.whistlePhase %= TWO_PI;

    // Include the explicit second partial only while it remains below the
    // conservative band limit used before 2:1 output-rate decimation.
    const harmonicGain = frequency * 2 < sourceBandLimit * 0.96
      ? 0.04 + parameters.tension * 0.08
      : 0;
    const coherentJet = Math.sin(this.whistlePhase)
      + harmonicGain * Math.sin(this.whistlePhase * 2);
    const turbulence = (noise - this.whistleNoise)
      * parameters.breath
      * pressure
      * 0.12;
    return coherentJet * this.whistleAmplitude * Math.sqrt(pressure) * 0.82 + turbulence;
  }

  renderSample(tractPressure = 0) {
    this._smoothParameters();
    this.bilateralDifference = 0;
    let source = 0;
    switch (this.target.model) {
      case SYRINX_SOURCE_MODEL_IDS.SYRINX:
        source = this._renderSyrinx(tractPressure);
        break;
      case SYRINX_SOURCE_MODEL_IDS.FROG:
        source = this._renderFrog(tractPressure);
        break;
      case SYRINX_SOURCE_MODEL_IDS.WHISTLE:
        source = this._renderWhistle(tractPressure);
        break;
      case SYRINX_SOURCE_MODEL_IDS.TWO_MASS:
      default:
        source = this._renderTwoMass(tractPressure);
        break;
    }

    const dcBlocked = source - this.dcInput + this.dcBlockerPole * this.dcOutput;
    this.dcInput = source;
    this.dcOutput = cleanState(dcBlocked, 4);
    return Math.tanh(this.dcOutput * 1.3) * this.current.outputGain;
  }

  renderBlock(output, parameters, tractPressure = 0) {
    if (!validOutputBuffer(output)) {
      throw new TypeError("SyrinxSourceEngine.renderBlock requires a writable array-like output");
    }
    if (parameters) this.setParameters(parameters);
    const pressureSignal = tractPressure && typeof tractPressure !== "number"
      ? tractPressure
      : null;
    const constantPressure = pressureSignal ? 0 : finiteNumber(tractPressure, 0);
    for (let index = 0; index < output.length; index += 1) {
      output[index] = this.renderSample(
        pressureSignal ? finiteNumber(pressureSignal[index], 0) : constantPressure,
      );
    }
    return output;
  }

  diagnostics() {
    return {
      model: this.target.model,
      parameters: { ...this.target },
      whistleMode: this.whistleMode,
      bilateralDifference: this.bilateralDifference,
      twoMassState: [
        this.mammalX1,
        this.mammalV1,
        this.mammalX2,
        this.mammalV2,
      ],
      glottalFlow: this.mammalFlow,
      birdState: [
        this.birdXLeft,
        this.birdYLeft,
        this.birdXRight,
        this.birdYRight,
      ],
      frogState: [this.frogMembraneX, this.frogMembraneVelocity],
      frogDrivingPressure: this.frogDrivingPressure,
      jetSpeedMps: this.whistleJetSpeed,
      impingementLengthM: this.whistleImpingementLength,
      strouhalNumber: this.whistleStrouhalNumber,
      whistleFrequencyHz: this.whistleFrequencyHz,
      dcBlockerCutoffHz: DC_BLOCKER_HZ,
      dcBlockerPole: this.dcBlockerPole,
      finite: Number.isFinite(this.dcOutput),
    };
  }
}

export function createSyrinxSourceEngine(options) {
  return new SyrinxSourceEngine(options);
}
