const PROCESSOR_NAME = "morphazoid-barber-delay";
const DEFAULT_SAMPLE_RATE = 48_000;
const RENDER_QUANTUM = 128;
const TAU = Math.PI * 2;
const FEEDBACK_BUDGET = 0.95;

export const BARBER_DELAY_PROCESSOR_NAME = PROCESSOR_NAME;

export const BARBER_DELAY_LIMITS = Object.freeze({
  minimumVoices: 1,
  maximumVoices: 12,
  minimumSpeed: 0,
  maximumSpeed: 5,
  minimumRange: 0.1,
  maximumRange: 10,
  minimumFeedbackDelay: 0.001,
  maximumFeedbackDelay: 10,
  maximumFeedback: FEEDBACK_BUDGET,
  maximumGlobalFeedback: 0.5,
  maximumInputGain: 2,
  maximumOutputLevel: 1,
});

const CANDY_DEFAULTS = Object.freeze({
  numVoices: 8,
  speed: 1,
  range: 1,
  directionUp: true,
  tilt: 0,
  feedback: 0,
  fbDelay: 0.25,
  globalFeedback: 0,
  dryWet: 0.7,
  inputGain: 1,
  outputLevel: 0.5,
});

const SLUDGE_DEFAULTS = Object.freeze({
  numVoices: 8,
  speed: 0.5,
  range: 2,
  directionUp: true,
  tilt: 0,
  feedback: 0,
  fbDelay: 1,
  globalFeedback: 0,
  dryWet: 0.8,
  inputGain: 1,
  outputLevel: 0.5,
});

export const BARBER_DELAY_DEFAULTS = Object.freeze({
  candy: CANDY_DEFAULTS,
  sludge: SLUDGE_DEFAULTS,
});

export function sanitizeBarberDelayMode(mode) {
  return mode === "sludge" ? "sludge" : "candy";
}

function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, minimum, maximum, fallback = minimum) {
  return Math.min(
    maximum,
    Math.max(minimum, finiteNumber(value, fallback)),
  );
}

export function wrapBarberPhase(value) {
  const phase = finiteNumber(value, 0);
  return ((phase % 1) + 1) % 1;
}

/**
 * Bound both UI and preset values before they cross onto the render thread.
 * Local and wet-bus feedback share a single sub-unity budget so their sum can
 * never create an unbounded loop, even when both controls are raised.
 */
export function sanitizeBarberDelayParams(params = {}, mode = "candy") {
  const safeMode = sanitizeBarberDelayMode(mode);
  const defaults = BARBER_DELAY_DEFAULTS[safeMode];
  let feedback = clamp(
    params.feedback,
    0,
    BARBER_DELAY_LIMITS.maximumFeedback,
    defaults.feedback,
  );
  let globalFeedback = clamp(
    params.globalFeedback,
    0,
    BARBER_DELAY_LIMITS.maximumGlobalFeedback,
    defaults.globalFeedback,
  );
  const feedbackTotal = feedback + globalFeedback;
  if (feedbackTotal > FEEDBACK_BUDGET) {
    const normalization = FEEDBACK_BUDGET / feedbackTotal;
    feedback *= normalization;
    globalFeedback *= normalization;
  }

  return Object.freeze({
    numVoices: Math.round(clamp(
      params.numVoices,
      BARBER_DELAY_LIMITS.minimumVoices,
      BARBER_DELAY_LIMITS.maximumVoices,
      defaults.numVoices,
    )),
    speed: clamp(
      params.speed,
      BARBER_DELAY_LIMITS.minimumSpeed,
      BARBER_DELAY_LIMITS.maximumSpeed,
      defaults.speed,
    ),
    range: clamp(
      params.range,
      BARBER_DELAY_LIMITS.minimumRange,
      BARBER_DELAY_LIMITS.maximumRange,
      defaults.range,
    ),
    directionUp: params.directionUp === undefined
      ? defaults.directionUp
      : Boolean(params.directionUp),
    tilt: clamp(params.tilt, -1, 1, defaults.tilt),
    feedback,
    fbDelay: clamp(
      params.fbDelay,
      BARBER_DELAY_LIMITS.minimumFeedbackDelay,
      BARBER_DELAY_LIMITS.maximumFeedbackDelay,
      defaults.fbDelay,
    ),
    globalFeedback,
    dryWet: clamp(params.dryWet, 0, 1, defaults.dryWet),
    inputGain: clamp(
      params.inputGain,
      0,
      BARBER_DELAY_LIMITS.maximumInputGain,
      defaults.inputGain,
    ),
    outputLevel: clamp(
      params.outputLevel,
      0,
      BARBER_DELAY_LIMITS.maximumOutputLevel,
      defaults.outputLevel,
    ),
  });
}

/**
 * The two delay-head paths preserved from Morphisma.
 *
 * Candy traverses its range exponentially. Sludge makes a centered sin² hump,
 * passing from one side of the source pitch to the other during each turn.
 */
export function barberDelayCurve(
  mode,
  phase,
  directionUp = true,
) {
  const position = wrapBarberPhase(phase);
  let rising;
  if (sanitizeBarberDelayMode(mode) === "sludge") {
    const sine = Math.sin(Math.PI * position);
    rising = sine * sine;
  } else {
    rising = (2 ** (1 - position)) - 1;
  }
  return directionUp ? rising : 1 - rising;
}

/**
 * Hann window whose peak can lean earlier or later without changing its
 * bounded 0…1 output. This is the original Morphisma tilt mapping.
 */
export function barberDelayWindow(phase, tilt = 0) {
  const position = wrapBarberPhase(phase);
  const safeTilt = clamp(tilt, -1, 1, 0);
  const skew = 2 ** (safeTilt * 2);
  const skewedPosition = position ** skew;
  return 0.5 * (1 - Math.cos(TAU * skewedPosition));
}

export function barberDelayPitchEstimate(params = {}, mode = "candy") {
  const safeMode = sanitizeBarberDelayMode(mode);
  const safe = sanitizeBarberDelayParams(params, safeMode);
  if (safeMode === "sludge") {
    const product = safe.speed * safe.range * Math.PI;
    const ratio = 1 + product;
    return Object.freeze({
      product,
      ratio,
      lowRatio: 1 / ratio,
      highRatio: ratio,
      semitones: 12 * Math.log2(ratio),
      symmetric: true,
    });
  }

  const product = safe.speed * safe.range;
  const ratio = safe.directionUp
    ? 1 + product
    : Math.max(1 - product, 0.01);
  return Object.freeze({
    product,
    ratio,
    lowRatio: ratio,
    highRatio: ratio,
    semitones: 12 * Math.log2(ratio),
    symmetric: false,
  });
}

function makePreset(mode, id, label, settings) {
  return Object.freeze({
    id,
    label,
    settings: sanitizeBarberDelayParams({
      ...BARBER_DELAY_DEFAULTS[mode],
      ...settings,
    }, mode),
  });
}

const CANDY_PRESETS = Object.freeze([
  makePreset("candy", "dry-coil", "Dry Coil", {
    speed: 1, range: 1, directionUp: true, numVoices: 8, tilt: 0,
    feedback: 0, fbDelay: 0.25, globalFeedback: 0, dryWet: 0.5,
  }),
  makePreset("candy", "short-echo", "Short Echo", {
    speed: 0.3, range: 0.4, directionUp: true, numVoices: 6, tilt: -0.6,
    feedback: 0.4, fbDelay: 0.1, globalFeedback: 0, dryWet: 0.65,
  }),
  makePreset("candy", "dual-grind", "Dual Grind", {
    speed: 1.309, range: 0.104, directionUp: false, numVoices: 2, tilt: -0.5,
    feedback: 0.95, fbDelay: 0.006, globalFeedback: 0, dryWet: 1,
  }),
  makePreset("candy", "tape-sustain", "Tape Sustain", {
    speed: 2.5, range: 0.3, directionUp: false, numVoices: 3, tilt: 0.7,
    feedback: 0.85, fbDelay: 0.35, globalFeedback: 0, dryWet: 0.45,
  }),
  makePreset("candy", "dense-spiral", "Dense Spiral", {
    speed: 0.77, range: 2.032, directionUp: true, numVoices: 12, tilt: 0.28,
    feedback: 0.95, fbDelay: 4.487, globalFeedback: 0, dryWet: 1,
  }),
  makePreset("candy", "tight-comb", "Tight Comb", {
    speed: 4, range: 0.2, directionUp: true, numVoices: 4, tilt: 0,
    feedback: 0.65, fbDelay: 0.015, globalFeedback: 0, dryWet: 0.55,
  }),
  makePreset("candy", "slow-wash", "Slow Wash", {
    speed: 0.08, range: 5, directionUp: true, numVoices: 12, tilt: -0.5,
    feedback: 0.85, fbDelay: 3.5, globalFeedback: 0, dryWet: 0.9,
  }),
  makePreset("candy", "falling-deep", "Falling Deep", {
    speed: 0.6, range: 2.5, directionUp: false, numVoices: 10, tilt: 0.4,
    feedback: 0.7, fbDelay: 1.5, globalFeedback: 0, dryWet: 0.8,
  }),
  makePreset("candy", "fast-dirty", "Fast & Dirty", {
    speed: 4.5, range: 0.6, directionUp: true, numVoices: 2, tilt: 0.8,
    feedback: 0.5, fbDelay: 0.04, globalFeedback: 0, dryWet: 0.75,
  }),
  makePreset("candy", "frozen-lake", "Frozen Lake", {
    speed: 0.03, range: 7, directionUp: true, numVoices: 12, tilt: 0,
    feedback: 0.92, fbDelay: 4, globalFeedback: 0, dryWet: 1,
  }),
  makePreset("candy", "still-resonance", "Still Resonance", {
    speed: 0, range: 0.101, directionUp: true, numVoices: 6, tilt: -0.67,
    feedback: 0, fbDelay: 0.001, globalFeedback: 0, dryWet: 1,
  }),
  makePreset("candy", "long-repeat", "Long Repeat", {
    speed: 1.2, range: 3.5, directionUp: false, numVoices: 8, tilt: 0.15,
    feedback: 0.75, fbDelay: 2, globalFeedback: 0, dryWet: 0.7,
  }),
]);

const SLUDGE_PRESETS = Object.freeze([
  makePreset("sludge", "centered-rise", "Centered Rise", {
    speed: 0.5, range: 2, directionUp: true, numVoices: 8, tilt: 0,
    feedback: 0, fbDelay: 1, globalFeedback: 0, dryWet: 0.8,
  }),
  makePreset("sludge", "centered-fall", "Centered Fall", {
    speed: 0.5, range: 2, directionUp: false, numVoices: 8, tilt: 0,
    feedback: 0, fbDelay: 1, globalFeedback: 0, dryWet: 0.8,
  }),
  makePreset("sludge", "slow-sludge", "Slow Sludge", {
    speed: 0.1, range: 4, directionUp: true, numVoices: 12, tilt: 0,
    feedback: 0.7, fbDelay: 3, globalFeedback: 0, dryWet: 0.9,
  }),
  makePreset("sludge", "thick-tar", "Thick Tar", {
    speed: 0.08, range: 6, directionUp: false, numVoices: 12, tilt: -0.3,
    feedback: 0.85, fbDelay: 4, globalFeedback: 0, dryWet: 1,
  }),
  makePreset("sludge", "quick-stripe", "Quick Stripe", {
    speed: 2, range: 0.5, directionUp: true, numVoices: 4, tilt: 0.5,
    feedback: 0.4, fbDelay: 0.5, globalFeedback: 0, dryWet: 0.6,
  }),
  makePreset("sludge", "mud-churn", "Mud Churn", {
    speed: 0.3, range: 3, directionUp: false, numVoices: 10, tilt: 0.4,
    feedback: 0.8, fbDelay: 2, globalFeedback: 0, dryWet: 0.85,
  }),
  makePreset("sludge", "dual-grind", "Dual Grind", {
    speed: 1.3, range: 0.1, directionUp: false, numVoices: 2, tilt: -0.5,
    feedback: 0.95, fbDelay: 0.01, globalFeedback: 0, dryWet: 1,
  }),
  makePreset("sludge", "wide-sweep", "Wide Sweep", {
    speed: 0.15, range: 5, directionUp: true, numVoices: 12, tilt: 0,
    feedback: 0, fbDelay: 2, globalFeedback: 0, dryWet: 0.85,
  }),
  makePreset("sludge", "frozen-bog", "Frozen Bog", {
    speed: 0.02, range: 8, directionUp: true, numVoices: 12, tilt: 0,
    feedback: 0.9, fbDelay: 5, globalFeedback: 0, dryWet: 1,
  }),
  makePreset("sludge", "tight-wobble", "Tight Wobble", {
    speed: 1.5, range: 0.3, directionUp: true, numVoices: 6, tilt: -0.4,
    feedback: 0.5, fbDelay: 0.2, globalFeedback: 0, dryWet: 0.55,
  }),
  makePreset("sludge", "long-pour", "Long Pour", {
    speed: 0.06, range: 7, directionUp: false, numVoices: 12, tilt: 0.2,
    feedback: 0.75, fbDelay: 4, globalFeedback: 0, dryWet: 0.95,
  }),
  makePreset("sludge", "gentle-ooze", "Gentle Ooze", {
    speed: 0.2, range: 1.5, directionUp: true, numVoices: 8, tilt: 0.2,
    feedback: 0.3, fbDelay: 1, globalFeedback: 0, dryWet: 0.5,
  }),
]);

export const BARBER_DELAY_PRESETS = Object.freeze({
  candy: CANDY_PRESETS,
  sludge: SLUDGE_PRESETS,
});

export function createBarberSoftCeilingCurve(
  length = 2_049,
  drive = 1.25,
  ceiling = 0.92,
) {
  const size = Math.max(33, Math.round(clamp(length, 33, 65_537, 2_049)));
  const safeDrive = clamp(drive, 0.25, 4, 1.25);
  const safeCeiling = clamp(ceiling, 0.5, 0.98, 0.92);
  const normalizer = Math.tanh(safeDrive);
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const input = (index / (size - 1)) * 2 - 1;
    curve[index] = (
      Math.tanh(input * safeDrive) / normalizer
    ) * safeCeiling;
  }
  return curve;
}

function createProcessorClass(AudioWorkletBase) {
  return class MorphazoidBarberDelayProcessor extends AudioWorkletBase {
    constructor(options = {}) {
      super();
      this.mode = sanitizeBarberDelayMode(options.processorOptions?.mode);
      const initial = sanitizeBarberDelayParams(
        options.processorOptions?.parameters,
        this.mode,
      );
      this.target = {
        ...initial,
        directionMix: initial.directionUp ? 1 : 0,
      };
      this.current = { ...this.target };
      const workletSampleRate = Number(globalThis.sampleRate)
        || DEFAULT_SAMPLE_RATE;
      this.sampleRate = workletSampleRate;
      this.bufferLength = (
        Math.ceil(BARBER_DELAY_LIMITS.maximumRange * workletSampleRate)
        + RENDER_QUANTUM
        + 2
      );
      this.buffers = [
        new Float32Array(this.bufferLength),
        new Float32Array(this.bufferLength),
      ];
      this.writeIndex = 0;
      this.phase = 0;
      this.previousWetLeft = 0;
      this.previousWetRight = 0;
      this.activeTarget = 0;
      this.activeGain = 0;

      this.port.onmessage = (event) => {
        const message = event.data;
        if (message?.type === "parameters") {
          const safe = sanitizeBarberDelayParams({
            ...this.target,
            ...message.parameters,
          }, this.mode);
          this.target = {
            ...safe,
            directionMix: safe.directionUp ? 1 : 0,
          };
        } else if (message?.type === "active") {
          this.activeTarget = message.value ? 1 : 0;
        } else if (message?.type === "reset") {
          this.buffers[0].fill(0);
          this.buffers[1].fill(0);
          this.writeIndex = 0;
          this.phase = 0;
          this.previousWetLeft = 0;
          this.previousWetRight = 0;
        }
      };
    }

    read(buffer, delaySamples) {
      let readPosition = this.writeIndex - delaySamples;
      while (readPosition < 0) readPosition += this.bufferLength;
      while (readPosition >= this.bufferLength) {
        readPosition -= this.bufferLength;
      }
      const before = Math.floor(readPosition);
      const after = before + 1 === this.bufferLength ? 0 : before + 1;
      const fraction = readPosition - before;
      return buffer[before] + ((buffer[after] - buffer[before]) * fraction);
    }

    process(inputs, outputs) {
      const output = outputs[0];
      if (!output?.length) return true;
      const leftOutput = output[0];
      const rightOutput = output[1] ?? leftOutput;
      const input = inputs[0] ?? [];
      const leftInput = input[0];
      const rightInput = input[1] ?? leftInput;
      const isSludge = this.mode === "sludge";
      const parameterSlew = 1 - Math.exp(-1 / (this.sampleRate * 0.04));
      const voiceSlew = 1 - Math.exp(-1 / (this.sampleRate * 0.075));
      const activeSlew = 1 - Math.exp(-1 / (this.sampleRate * 0.008));

      for (
        let sampleIndex = 0;
        sampleIndex < leftOutput.length;
        sampleIndex += 1
      ) {
        this.current.speed += (
          this.target.speed - this.current.speed
        ) * parameterSlew;
        this.current.range += (
          this.target.range - this.current.range
        ) * parameterSlew;
        this.current.tilt += (
          this.target.tilt - this.current.tilt
        ) * parameterSlew;
        this.current.feedback += (
          this.target.feedback - this.current.feedback
        ) * parameterSlew;
        this.current.fbDelay += (
          this.target.fbDelay - this.current.fbDelay
        ) * parameterSlew;
        this.current.globalFeedback += (
          this.target.globalFeedback - this.current.globalFeedback
        ) * parameterSlew;
        this.current.dryWet += (
          this.target.dryWet - this.current.dryWet
        ) * parameterSlew;
        this.current.inputGain += (
          this.target.inputGain - this.current.inputGain
        ) * parameterSlew;
        this.current.outputLevel += (
          this.target.outputLevel - this.current.outputLevel
        ) * parameterSlew;
        this.current.directionMix += (
          this.target.directionMix - this.current.directionMix
        ) * parameterSlew;
        this.current.numVoices += (
          this.target.numVoices - this.current.numVoices
        ) * voiceSlew;
        this.activeGain += (
          this.activeTarget - this.activeGain
        ) * activeSlew;

        const phaseStep = this.current.speed / this.sampleRate;
        this.phase += phaseStep;
        if (this.phase >= 1) this.phase -= Math.floor(this.phase);

        const rawLeft = finiteNumber(leftInput?.[sampleIndex], 0);
        const rawRight = finiteNumber(rightInput?.[sampleIndex], rawLeft);
        const sourceLeft = rawLeft * this.current.inputGain;
        const sourceRight = rawRight * this.current.inputGain;
        const feedbackDelaySamples = Math.max(
          1,
          this.current.fbDelay * this.sampleRate,
        );
        const feedbackLeft = this.read(
          this.buffers[0],
          feedbackDelaySamples,
        );
        const feedbackRight = this.read(
          this.buffers[1],
          feedbackDelaySamples,
        );

        // Keep the record loop finite independently of the downstream graph.
        const recordLeft = Math.tanh(
          sourceLeft
          + (feedbackLeft * this.current.feedback)
          + (this.previousWetLeft * this.current.globalFeedback),
        );
        const recordRight = Math.tanh(
          sourceRight
          + (feedbackRight * this.current.feedback)
          + (this.previousWetRight * this.current.globalFeedback),
        );
        this.buffers[0][this.writeIndex] = recordLeft;
        this.buffers[1][this.writeIndex] = recordRight;

        const voiceCount = Math.max(1, this.current.numVoices);
        const voiceGain = 2 / voiceCount;
        const rangeSamples = this.current.range * this.sampleRate;
        const skew = 2 ** (this.current.tilt * 2);
        let wetLeft = 0;
        let wetRight = 0;

        for (
          let voiceIndex = 0;
          voiceIndex < BARBER_DELAY_LIMITS.maximumVoices;
          voiceIndex += 1
        ) {
          // A fractional final voice crossfades count changes instead of
          // abruptly inserting or removing a read head.
          const voiceActivation = Math.max(
            0,
            Math.min(1, voiceCount - voiceIndex),
          );
          if (voiceActivation <= 1e-6) continue;
          let voicePhase = this.phase + (voiceIndex / voiceCount);
          voicePhase -= Math.floor(voicePhase);

          let risingCurve;
          if (isSludge) {
            const sine = Math.sin(Math.PI * voicePhase);
            risingCurve = sine * sine;
          } else {
            risingCurve = (2 ** (1 - voicePhase)) - 1;
          }
          const curve = (
            (risingCurve * this.current.directionMix)
            + ((1 - risingCurve) * (1 - this.current.directionMix))
          );
          const delaySamples = curve * rangeSamples;
          const skewedPhase = voicePhase ** skew;
          const window = 0.5 * (1 - Math.cos(TAU * skewedPhase));
          const gain = window * voiceGain * voiceActivation;
          wetLeft += this.read(this.buffers[0], delaySamples) * gain;
          wetRight += this.read(this.buffers[1], delaySamples) * gain;
        }

        this.previousWetLeft = wetLeft;
        this.previousWetRight = wetRight;
        const dryGain = 1 - this.current.dryWet;
        const outputGain = this.current.outputLevel * this.activeGain;
        const mixedLeft = (
          (sourceLeft * dryGain) + (wetLeft * this.current.dryWet)
        ) * outputGain;
        const mixedRight = (
          (sourceRight * dryGain) + (wetRight * this.current.dryWet)
        ) * outputGain;
        leftOutput[sampleIndex] = Math.max(-0.98, Math.min(0.98, mixedLeft));
        if (rightOutput !== leftOutput) {
          rightOutput[sampleIndex] = Math.max(
            -0.98,
            Math.min(0.98, mixedRight),
          );
        }

        this.writeIndex += 1;
        if (this.writeIndex === this.bufferLength) this.writeIndex = 0;
      }
      return true;
    }
  };
}

const AudioWorkletBase = globalThis.AudioWorkletProcessor;
if (
  typeof AudioWorkletBase === "function"
  && typeof globalThis.registerProcessor === "function"
) {
  globalThis.registerProcessor(
    PROCESSOR_NAME,
    createProcessorClass(AudioWorkletBase),
  );
}

/**
 * Browser-facing graph. Construction is deliberately inert: start() must be
 * called by a user gesture before an AudioContext or microphone is created.
 */
export class BarberDelayAudio {
  constructor(mode = "candy", runtime = globalThis) {
    this.mode = sanitizeBarberDelayMode(mode);
    this.runtime = runtime;
    this.params = { ...BARBER_DELAY_DEFAULTS[this.mode] };
    this.context = null;
    this.node = null;
    this.highpass = null;
    this.compressor = null;
    this.ceiling = null;
    this.master = null;
    this.analyser = null;
    this.sourceNode = null;
    this.sourceKind = null;
    this.mediaStream = null;
    this.mediaElement = null;
    this.mediaElementNodes = new WeakMap();
    this.enabled = false;
    this.suspendTimer = null;
  }

  get isInitialized() {
    return Boolean(this.context && this.context.state !== "closed");
  }

  get state() {
    return Object.freeze({
      initialized: this.isInitialized,
      enabled: this.enabled,
      sourceKind: this.sourceKind,
      contextState: this.context?.state ?? "closed",
    });
  }

  async initialize() {
    if (this.isInitialized) return;
    const AudioContextConstructor = (
      this.runtime.AudioContext ?? this.runtime.webkitAudioContext
    );
    const AudioWorkletNodeConstructor = (
      this.runtime.AudioWorkletNode ?? globalThis.AudioWorkletNode
    );
    if (typeof AudioContextConstructor !== "function") {
      throw new Error("Web Audio is not available in this browser.");
    }
    if (typeof AudioWorkletNodeConstructor !== "function") {
      throw new Error("This effect requires AudioWorklet support.");
    }

    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    if (!context.audioWorklet) {
      await context.close().catch(() => {});
      throw new Error("This effect requires AudioWorklet support.");
    }

    try {
      await context.audioWorklet.addModule(
        new URL("./barber-delay.js", import.meta.url),
      );
      const node = new AudioWorkletNodeConstructor(context, PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          mode: this.mode,
          parameters: this.params,
        },
      });
      const highpass = context.createBiquadFilter();
      const compressor = context.createDynamicsCompressor();
      const ceiling = context.createWaveShaper();
      const master = context.createGain();
      const analyser = context.createAnalyser();

      highpass.type = "highpass";
      highpass.frequency.value = 24;
      highpass.Q.value = 0.707;
      compressor.threshold.value = -15;
      compressor.knee.value = 10;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.2;
      ceiling.curve = createBarberSoftCeilingCurve();
      ceiling.oversample = "2x";
      master.gain.value = 0;
      analyser.fftSize = 1_024;
      analyser.smoothingTimeConstant = 0.72;

      node
        .connect(highpass)
        .connect(compressor)
        .connect(ceiling)
        .connect(master)
        .connect(analyser)
        .connect(context.destination);

      this.context = context;
      this.node = node;
      this.highpass = highpass;
      this.compressor = compressor;
      this.ceiling = ceiling;
      this.master = master;
      this.analyser = analyser;
      this.setParameters(this.params);
    } catch (error) {
      await context.close().catch(() => {});
      throw error;
    }
  }

  clearSuspendTimer() {
    if (this.suspendTimer === null) return;
    this.runtime.clearTimeout?.(this.suspendTimer);
    this.suspendTimer = null;
  }

  releaseSource({ pauseElement = true } = {}) {
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    for (const track of this.mediaStream?.getTracks?.() ?? []) track.stop();
    this.mediaStream = null;
    if (pauseElement) this.mediaElement?.pause?.();
    this.mediaElement = null;
    this.sourceKind = null;
  }

  async connectSource(source) {
    if (source?.kind === "microphone") {
      const getUserMedia = (
        this.runtime.navigator?.mediaDevices?.getUserMedia
      )?.bind(this.runtime.navigator.mediaDevices);
      if (typeof getUserMedia !== "function") {
        throw new Error("Microphone input is not available in this browser.");
      }
      const stream = await getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });
      this.mediaStream = stream;
      const sourceNode = this.context.createMediaStreamSource(stream);
      sourceNode.connect(this.node);
      this.sourceNode = sourceNode;
      this.sourceKind = "microphone";
      return;
    }

    if (source?.kind === "file" && source.element) {
      const element = source.element;
      let sourceNode = this.mediaElementNodes.get(element);
      if (!sourceNode) {
        sourceNode = this.context.createMediaElementSource(element);
        this.mediaElementNodes.set(element, sourceNode);
      }
      sourceNode.connect(this.node);
      this.sourceNode = sourceNode;
      this.mediaElement = element;
      this.sourceKind = "file";
      await element.play?.();
      return;
    }

    throw new Error("Choose a microphone or local audio file first.");
  }

  async start(source) {
    await this.initialize();
    this.clearSuspendTimer();
    this.releaseSource();
    this.enabled = false;
    await this.context.resume();

    try {
      await this.connectSource(source);
      const now = this.context.currentTime;
      this.node.port.postMessage({ type: "reset" });
      this.node.port.postMessage({ type: "active", value: true });
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(1, now + 0.035);
      this.enabled = true;
    } catch (error) {
      this.releaseSource();
      this.node.port.postMessage({ type: "active", value: false });
      this.master.gain.value = 0;
      this.enabled = false;
      await this.context.suspend().catch(() => {});
      throw error;
    }
  }

  setParameters(params = {}) {
    this.params = {
      ...sanitizeBarberDelayParams({
        ...this.params,
        ...params,
      }, this.mode),
    };
    this.node?.port.postMessage({
      type: "parameters",
      parameters: this.params,
    });
    return Object.freeze({ ...this.params });
  }

  getTimeDomainData(target) {
    if (!this.analyser || !(target instanceof Float32Array)) return false;
    this.analyser.getFloatTimeDomainData(target);
    return true;
  }

  getWaveform(target) {
    return this.getTimeDomainData(target);
  }

  async stop() {
    this.clearSuspendTimer();
    this.releaseSource();
    if (!this.isInitialized) {
      this.enabled = false;
      return;
    }
    const now = this.context.currentTime;
    this.node.port.postMessage({ type: "active", value: false });
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.035);
    this.enabled = false;
    this.suspendTimer = this.runtime.setTimeout?.(() => {
      this.suspendTimer = null;
      if (!this.enabled && this.context?.state === "running") {
        this.context.suspend().catch(() => {});
      }
    }, 55) ?? null;
  }

  async close() {
    this.clearSuspendTimer();
    this.releaseSource();
    this.enabled = false;
    this.node?.port.postMessage({ type: "active", value: false });
    this.node?.disconnect();
    this.highpass?.disconnect();
    this.compressor?.disconnect();
    this.ceiling?.disconnect();
    this.master?.disconnect();
    this.analyser?.disconnect();
    const context = this.context;
    this.context = null;
    this.node = null;
    this.highpass = null;
    this.compressor = null;
    this.ceiling = null;
    this.master = null;
    this.analyser = null;
    this.sourceKind = null;
    this.mediaElementNodes = new WeakMap();
    if (context && context.state !== "closed") {
      await context.close().catch(() => {});
    }
  }
}
