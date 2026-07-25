const PROCESSOR_NAME = "morphazoid-shepard-risset";
const TAU = Math.PI * 2;
const PARTIAL_COUNT = 17;
const PARTIAL_CENTER = Math.floor(PARTIAL_COUNT / 2);
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20_000;
const DEFAULT_SAMPLE_RATE = 48_000;

export const SHEPARD_DEFAULTS = Object.freeze({
  centerFrequency: 220,
  rate: 0.12,
  width: 5,
  spread: 0.26,
  cutoff: 12_000,
  level: 0.58,
});

export const SHEPARD_PRESETS = Object.freeze([
  Object.freeze({
    id: "classic-rise",
    label: "Classic rise",
    centerFrequency: 220,
    rate: 0.12,
    width: 5,
    spread: 0.26,
    cutoff: 12_000,
  }),
  Object.freeze({
    id: "classic-fall",
    label: "Classic fall",
    centerFrequency: 220,
    rate: -0.12,
    width: 5,
    spread: 0.26,
    cutoff: 12_000,
  }),
  Object.freeze({
    id: "tight-spiral",
    label: "Tight spiral",
    centerFrequency: 330,
    rate: 0.42,
    width: 3.5,
    spread: 0.52,
    cutoff: 14_000,
  }),
  Object.freeze({
    id: "deep-descent",
    label: "Deep descent",
    centerFrequency: 82,
    rate: -0.07,
    width: 7,
    spread: 0.18,
    cutoff: 8_500,
  }),
]);

export function clamp(value, low, high, fallback = low) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(high, Math.max(low, numeric));
}

export function wrapUnit(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return ((numeric % 1) + 1) % 1;
}

/**
 * Advance a unit phasor while retaining the number and direction of wraps.
 * Keeping this information lets the worklet rotate oscillator phases onto
 * their octave neighbours at the otherwise discontinuous seam.
 */
export function advanceUnitPosition(position, delta) {
  const raw = wrapUnit(position) + (Number.isFinite(delta) ? delta : 0);
  const wraps = Math.floor(raw);
  return Object.freeze({
    position: wrapUnit(raw),
    wraps,
  });
}

export function shepardWindow(octaveOffset, width) {
  const safeWidth = clamp(width, 3, 9, SHEPARD_DEFAULTS.width);
  const distance = Math.abs(octaveOffset) / (safeWidth * 0.5);
  if (distance >= 1) return 0;
  return 0.5 + 0.5 * Math.cos(Math.PI * distance);
}

export function sanitizeShepardParams(params = {}) {
  return Object.freeze({
    centerFrequency: clamp(
      params.centerFrequency,
      40,
      2_000,
      SHEPARD_DEFAULTS.centerFrequency,
    ),
    rate: clamp(params.rate, -2, 2, SHEPARD_DEFAULTS.rate),
    width: clamp(params.width, 3, 9, SHEPARD_DEFAULTS.width),
    spread: clamp(params.spread, 0, 1, SHEPARD_DEFAULTS.spread),
    cutoff: clamp(params.cutoff, 800, 18_000, SHEPARD_DEFAULTS.cutoff),
    level: clamp(params.level, 0, 0.82, SHEPARD_DEFAULTS.level),
  });
}

/**
 * Describe the current octave bank without allocating or generating audio.
 * This is shared by tests and explanatory UI; the worklet uses the same
 * frequency/window rules in its sample loop.
 */
export function calculateShepardPartials({
  position = 0,
  centerFrequency = SHEPARD_DEFAULTS.centerFrequency,
  width = SHEPARD_DEFAULTS.width,
  spread = SHEPARD_DEFAULTS.spread,
  sampleRate = DEFAULT_SAMPLE_RATE,
  partialCount = PARTIAL_COUNT,
} = {}) {
  const safe = sanitizeShepardParams({ centerFrequency, width, spread });
  const count = Math.max(3, Math.floor(clamp(partialCount, 3, 33, PARTIAL_COUNT)));
  const center = Math.floor(count / 2);
  const phase = wrapUnit(position);
  const frequencyCeiling = Math.min(MAX_FREQUENCY, sampleRate * 0.45);
  const partials = [];
  let weightPower = 0;

  for (let index = 0; index < count; index += 1) {
    const octaveOffset = -center + phase + index;
    const frequency = safe.centerFrequency * 2 ** octaveOffset;
    const inBand = frequency >= MIN_FREQUENCY && frequency <= frequencyCeiling;
    const weight = inBand ? shepardWindow(octaveOffset, safe.width) : 0;
    const pan = clamp(
      octaveOffset / Math.max(1, safe.width * 0.5),
      -1,
      1,
      0,
    ) * safe.spread;
    weightPower += weight * weight;
    partials.push(Object.freeze({
      index,
      octaveOffset,
      frequency,
      weight,
      pan,
      active: weight > 0,
    }));
  }

  return Object.freeze({
    partials: Object.freeze(partials),
    weightPower,
    normalization: weightPower > 1e-12 ? 1 / Math.sqrt(weightPower) : 0,
  });
}

export function createSoftCeilingCurve(length = 2_049, drive = 1.3, ceiling = 0.92) {
  const size = Math.max(33, Math.floor(clamp(length, 33, 65_537, 2_049)));
  const safeDrive = clamp(drive, 0.5, 4, 1.3);
  const safeCeiling = clamp(ceiling, 0.5, 0.98, 0.92);
  const scale = Math.tanh(safeDrive);
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const input = index / (size - 1) * 2 - 1;
    curve[index] = Math.tanh(input * safeDrive) / scale * safeCeiling;
  }
  return curve;
}

function rotatePhasesUp(phases) {
  for (let index = phases.length - 1; index > 0; index -= 1) {
    phases[index] = phases[index - 1];
  }
  phases[0] = phases[1] * 0.754877666;
}

function rotatePhasesDown(phases) {
  for (let index = 0; index < phases.length - 1; index += 1) {
    phases[index] = phases[index + 1];
  }
  phases[phases.length - 1] = phases[phases.length - 2] * 1.324717957;
}

function rotateForWraps(phases, wraps) {
  if (wraps > 0) {
    for (let index = 0; index < wraps; index += 1) rotatePhasesUp(phases);
  } else if (wraps < 0) {
    for (let index = 0; index > wraps; index -= 1) rotatePhasesDown(phases);
  }
}

function createProcessorClass(AudioWorkletBase) {
  return class MorphazoidShepardRissetProcessor extends AudioWorkletBase {
    constructor(options) {
      super();
      const initial = sanitizeShepardParams(options.processorOptions);
      this.target = { ...initial };
      this.current = { ...initial };
      this.position = 0;
      this.phases = Array.from(
        { length: PARTIAL_COUNT },
        (_, index) => wrapUnit(index * 0.61803398875) * TAU,
      );
      this.activeTarget = 0;
      this.activeGain = 0;
      this.port.onmessage = (event) => {
        if (event.data?.type === "parameters") {
          this.target = {
            ...this.target,
            ...sanitizeShepardParams({ ...this.target, ...event.data.parameters }),
          };
        } else if (event.data?.type === "active") {
          this.activeTarget = event.data.value ? 1 : 0;
        }
      };
    }

    process(_inputs, outputs) {
      const output = outputs[0];
      if (!output?.length) return true;
      const left = output[0];
      const right = output[1] ?? left;
      left.fill(0);
      if (right !== left) right.fill(0);

      const workletSampleRate = Number(globalThis.sampleRate) || DEFAULT_SAMPLE_RATE;
      const frequencyCeiling = Math.min(MAX_FREQUENCY, workletSampleRate * 0.45);
      const parameterSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.035));
      const activeSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.008));
      const outputScale = 0.42;

      for (let sampleIndex = 0; sampleIndex < left.length; sampleIndex += 1) {
        this.current.centerFrequency += (
          this.target.centerFrequency - this.current.centerFrequency
        ) * parameterSlew;
        this.current.rate += (this.target.rate - this.current.rate) * parameterSlew;
        this.current.width += (this.target.width - this.current.width) * parameterSlew;
        this.current.spread += (this.target.spread - this.current.spread) * parameterSlew;
        this.activeGain += (this.activeTarget - this.activeGain) * activeSlew;

        // This is deliberately inlined instead of calling the exported helper:
        // the render thread must not allocate one result object per sample.
        const rawPosition = this.position + this.current.rate / workletSampleRate;
        const wraps = Math.floor(rawPosition);
        this.position = ((rawPosition % 1) + 1) % 1;
        if (wraps !== 0) rotateForWraps(this.phases, wraps);

        const halfWidth = Math.max(1.5, this.current.width * 0.5);
        const firstOffset = -PARTIAL_CENTER + this.position;
        let nextFrequency = this.current.centerFrequency * 2 ** firstOffset;
        let leftSum = 0;
        let rightSum = 0;
        let weightPower = 0;

        for (let index = 0; index < PARTIAL_COUNT; index += 1) {
          const octaveOffset = firstOffset + index;
          const frequency = nextFrequency;
          nextFrequency *= 2;

          this.phases[index] = (
            this.phases[index] + TAU * frequency / workletSampleRate
          ) % TAU;

          const distance = Math.abs(octaveOffset) / halfWidth;
          if (
            distance >= 1
            || frequency < MIN_FREQUENCY
            || frequency > frequencyCeiling
          ) continue;

          const weight = 0.5 + 0.5 * Math.cos(Math.PI * distance);
          const normalizedOffset = octaveOffset / halfWidth;
          const pan = Math.max(-1, Math.min(1, normalizedOffset))
            * this.current.spread;
          const panAngle = (pan + 1) * Math.PI * 0.25;
          const sample = Math.sin(this.phases[index]) * weight;
          leftSum += sample * Math.cos(panAngle);
          rightSum += sample * Math.sin(panAngle);
          weightPower += weight * weight;
        }

        const normalization = weightPower > 1e-12
          ? outputScale * this.activeGain / Math.sqrt(weightPower)
          : 0;
        left[sampleIndex] = leftSum * normalization;
        if (right !== left) right[sampleIndex] = rightSum * normalization;
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
 * A self-contained Web Audio graph. Construction is inert: the AudioContext
 * is deliberately created only by start(), which the page calls from the
 * user's Audio button gesture.
 */
export class ShepardRissetAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.node = null;
    this.highpass = null;
    this.lowpass = null;
    this.compressor = null;
    this.ceiling = null;
    this.master = null;
    this.analyser = null;
    this.enabled = false;
    this.params = { ...SHEPARD_DEFAULTS };
    this.suspendTimer = null;
  }

  get isInitialized() {
    return Boolean(this.context && this.context.state !== "closed");
  }

  async initialize() {
    if (this.isInitialized) return;
    const AudioContextConstructor = (
      this.runtime.AudioContext ?? this.runtime.webkitAudioContext
    );
    if (typeof AudioContextConstructor !== "function") {
      throw new Error("Web Audio is not available in this browser.");
    }

    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    if (!context.audioWorklet) {
      await context.close();
      throw new Error("This instrument requires AudioWorklet support.");
    }

    try {
      await context.audioWorklet.addModule(
        new URL("./shepard-risset.js", import.meta.url),
      );

      const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: this.params,
      });
      const highpass = context.createBiquadFilter();
      const lowpass = context.createBiquadFilter();
      const compressor = context.createDynamicsCompressor();
      const ceiling = context.createWaveShaper();
      const master = context.createGain();
      const analyser = context.createAnalyser();

      highpass.type = "highpass";
      highpass.frequency.value = 28;
      highpass.Q.value = 0.707;
      lowpass.type = "lowpass";
      lowpass.frequency.value = this.params.cutoff;
      lowpass.Q.value = 0.707;
      compressor.threshold.value = -12;
      compressor.knee.value = 7;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.18;
      ceiling.curve = createSoftCeilingCurve();
      ceiling.oversample = "2x";
      master.gain.value = 0;
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;

      node
        .connect(highpass)
        .connect(lowpass)
        .connect(compressor)
        .connect(ceiling)
        .connect(master)
        .connect(analyser)
        .connect(context.destination);

      this.context = context;
      this.node = node;
      this.highpass = highpass;
      this.lowpass = lowpass;
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

  async start() {
    await this.initialize();
    if (this.suspendTimer !== null) {
      this.runtime.clearTimeout?.(this.suspendTimer);
      this.suspendTimer = null;
    }
    await this.context.resume();
    const now = this.context.currentTime;
    this.node.port.postMessage({ type: "active", value: true });
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.params.level, now + 0.035);
    this.enabled = true;
  }

  stop() {
    if (!this.isInitialized || !this.enabled) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.035);
    this.node.port.postMessage({ type: "active", value: false });
    this.enabled = false;
    this.suspendTimer = this.runtime.setTimeout?.(() => {
      this.suspendTimer = null;
      if (!this.enabled && this.context?.state === "running") {
        this.context.suspend().catch(() => {});
      }
    }, 55) ?? null;
  }

  setParameters(params = {}) {
    this.params = {
      ...this.params,
      ...sanitizeShepardParams({ ...this.params, ...params }),
    };
    if (!this.isInitialized) return;
    this.node.port.postMessage({
      type: "parameters",
      parameters: {
        centerFrequency: this.params.centerFrequency,
        rate: this.params.rate,
        width: this.params.width,
        spread: this.params.spread,
      },
    });
    this.lowpass.frequency.setTargetAtTime(
      this.params.cutoff,
      this.context.currentTime,
      0.025,
    );
    if (this.enabled) {
      this.master.gain.setTargetAtTime(
        this.params.level,
        this.context.currentTime,
        0.015,
      );
    }
  }

  getWaveform(target) {
    if (!this.analyser || !(target instanceof Float32Array)) return false;
    this.analyser.getFloatTimeDomainData(target);
    return true;
  }

  async close() {
    if (this.suspendTimer !== null) {
      this.runtime.clearTimeout?.(this.suspendTimer);
      this.suspendTimer = null;
    }
    this.enabled = false;
    this.node?.port.postMessage({ type: "active", value: false });
    this.node?.disconnect();
    this.highpass?.disconnect();
    this.lowpass?.disconnect();
    this.compressor?.disconnect();
    this.ceiling?.disconnect();
    this.master?.disconnect();
    this.analyser?.disconnect();
    const context = this.context;
    this.context = null;
    this.node = null;
    this.highpass = null;
    this.lowpass = null;
    this.compressor = null;
    this.ceiling = null;
    this.master = null;
    this.analyser = null;
    if (context && context.state !== "closed") {
      await context.close().catch(() => {});
    }
  }
}
