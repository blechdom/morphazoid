/**
 * Rust Garden: a synthetic bank of damped complex resonators.
 *
 * Rust SIMD renders pairs of double-precision resonances. JavaScript remains a
 * numerical reference and compatibility fallback. The material is a synthetic
 * original continuous resonance bank, with the later 32-tine model
 * retained as an alternative. Only the final audio buffers are f32.
 */
export const GARDEN_MAX_MODES = 32768;
export const GARDEN_MAX_FRAMES = 2048;
export const TINE_COUNT = 32;
export const ORIGINAL_PITCH_SPREAD = Math.log2(40);
export const GARDEN_DEFAULTS = Object.freeze({
  model: 'bank', modes: 256, baseFrequency: 110, pitchSpread: ORIGINAL_PITCH_SPREAD, decay: 3.2, dispersion: 0.36, brightness: 0.55,
});

const HEADER = 16;
const LANES = 14;
const STATE_DOUBLES = HEADER + LANES * GARDEN_MAX_MODES;
const STATE_BYTES = STATE_DOUBLES * 8;
const OUTPUT_BYTES = GARDEN_MAX_FRAMES * 2 * 4;
const TAU = 2 * Math.PI;

function bounded(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

export function sanitizeGardenSettings(settings = {}) {
  const s = settings ?? {};
  return {
    model: s.model === 'tines' ? 'tines' : 'bank',
    modes: Math.round(bounded(s.modes, 32, GARDEN_MAX_MODES, GARDEN_DEFAULTS.modes)),
    baseFrequency: bounded(s.baseFrequency, 45, 360, GARDEN_DEFAULTS.baseFrequency),
    pitchSpread: bounded(s.pitchSpread, 0, s.model === 'tines' ? 4 : 6, s.model === 'tines' ? 2 : ORIGINAL_PITCH_SPREAD),
    decay: bounded(s.decay, 0.2, 12, GARDEN_DEFAULTS.decay),
    dispersion: bounded(s.dispersion, 0, 1, GARDEN_DEFAULTS.dispersion),
    brightness: bounded(s.brightness, 0, 1, GARDEN_DEFAULTS.brightness),
  };
}


/** Equal-section clamped beams have f proportional to 1 / length squared.
 * The fundamental span is continuous, without a scale or note quantization. */
export function tineFrequency(index, baseFrequency = GARDEN_DEFAULTS.baseFrequency, pitchSpread = 2) {
  return baseFrequency * 2 ** (pitchSpread * index / (TINE_COUNT - 1));
}

/** Prepare transcendental coefficients on the page thread, away from audio.
 * Extra modes enrich narrow partial clusters; they never fill a uniform band. */
export function prepareGardenSettings(settings = {}, sampleRate = 48000) {
  const s = sanitizeGardenSettings(settings);
  const rate = bounded(sampleRate, 8000, 192000, 48000);
  const coefficients = new Float64Array(s.modes * 5);
  if (s.model === 'bank') {
    // The original demonstration's coefficient math, including its exact
    // 40:1 default span, stereo scatter and frequency-dependent damping.
    const ratio = s.pitchSpread === ORIGINAL_PITCH_SPREAD ? 40 : 2 ** s.pitchSpread;
    const ceiling = Math.min(rate * 0.43, s.baseFrequency * ratio);
    const frequencySpan = Math.log(ceiling / s.baseFrequency);
    for (let mode = 0; mode < s.modes; mode++) {
      const position = mode / (s.modes - 1);
      const denseFrequency = s.baseFrequency * Math.exp(frequencySpan * position);
      const ripple = Math.sin((mode + 1) * 2.399963229728653) * s.dispersion * 0.11;
      const frequency = Math.min(rate * 0.44, denseFrequency * (1 + ripple));
      const duration = s.decay / (1 + position * (3.5 - 2.6 * s.brightness));
      const radius = Math.exp(-Math.log(1000) / (rate * duration));
      const angle = TAU * frequency / rate;
      const spectralGain = Math.exp(-position * (4.2 - 3.5 * s.brightness));
      const pan = 0.5 + Math.sin(mode * 2.399963229728653) * 0.42;
      coefficients[mode] = radius * Math.cos(angle);
      coefficients[s.modes + mode] = radius * Math.sin(angle);
      coefficients[2 * s.modes + mode] = spectralGain * Math.cos(pan * Math.PI / 2);
      coefficients[3 * s.modes + mode] = spectralGain * Math.sin(pan * Math.PI / 2);
      coefficients[4 * s.modes + mode] = frequency;
    }
    return { settings: s, coefficients, sampleRate: rate };
  }
  const flexural = [1, 6.267, 17.548, 34.386];
  const satellites = Math.max(0, Math.ceil(s.modes / (TINE_COUNT * 4)) - 1);
  let clusterWeight = 0;
  for (let index = 1; index <= satellites; index++) clusterWeight += index ** -0.7;
  for (let mode = 0; mode < s.modes; mode++) {
    const tine = mode % TINE_COUNT;
    const local = Math.floor(mode / TINE_COUNT);
    const partial = local % 4;
    const satellite = Math.floor(local / 4);
    const ratio = (partial + 1) + (flexural[partial] - partial - 1) * s.dispersion;
    const detune = satellite ? Math.sin(satellite * 2.3999632297 + tine * 0.7) * (0.001 + s.dispersion * 0.009) * satellite / (satellite + 3) : 0;
    const rawFrequency = tineFrequency(tine, s.baseFrequency, s.pitchSpread) * ratio * (1 + detune);
    const frequency = Math.min(rate * 0.45, rawFrequency);
    const duration = s.decay / (1 + partial * (1.5 - s.brightness));
    const radius = Math.exp(-Math.log(1000) / (rate * duration));
    const angle = TAU * frequency / rate;
    const clusterGain = satellite ? 0.45 * satellite ** -0.7 / clusterWeight : 1;
    const gain = rawFrequency < rate * 0.45 ? clusterGain * Math.exp(-partial * (2 - 1.6 * s.brightness)) : 0;
    const pan = 0.15 + 0.7 * tine / (TINE_COUNT - 1);
    coefficients[mode] = radius * Math.cos(angle);
    coefficients[s.modes + mode] = radius * Math.sin(angle);
    coefficients[2 * s.modes + mode] = gain * Math.cos(pan * Math.PI / 2);
    coefficients[3 * s.modes + mode] = gain * Math.sin(pan * Math.PI / 2);
    coefficients[4 * s.modes + mode] = frequency;
  }
  return { settings: s, coefficients, sampleRate: rate };
}

/** Gaussian excitation profile. At high densities its successive ratios form
 * a geometric progression, avoiding one exponential per mode per strike.
 * Re-anchor every 64 modes to bound rounding drift; keep small banks exact. */
export function fillBankRidge(target, modes, y) {
  if (modes <= 2048) {
    for (let mode = 0; mode < modes; mode++) {
      const position = mode / (modes - 1);
      target[mode] = 0.16 + Math.exp(-((position - y) ** 2) / 0.075);
    }
    return;
  }
  const spacing = 1 / (modes - 1);
  const ratioStep = Math.exp(-2 * spacing * spacing / 0.075);
  for (let anchor = 0; anchor < modes; anchor += 64) {
    const distance = anchor * spacing - y;
    let ridge = Math.exp(-(distance * distance) / 0.075);
    let ratio = Math.exp(-(2 * distance * spacing + spacing * spacing) / 0.075);
    const end = Math.min(modes, anchor + 64);
    for (let mode = anchor; mode < end; mode++) {
      target[mode] = 0.16 + ridge;
      ridge *= ratio;
      ratio *= ratioStep;
    }
  }
}

/**
 * Instantiate a precompiled Module outside the audio render callback. With no
 * compatible module, use an identically laid-out standalone JS ArrayBuffer.
 * No imports, shared memory, allocations or memory growth are needed to render.
 * process() returns the same object/arrays: consume only the first `frames`.
 */
export function createGardenDSP({ module = null, sampleRate = 48000, settings = {}, prepared = null } = {}) {
  const rate = bounded(sampleRate, 8000, 192000, 48000);
  let instance = null;
  let wasmError = null;
  let buffer;
  let stateOffset = 0;
  let outputOffset = STATE_BYTES;
  if (module) {
    try {
      instance = new WebAssembly.Instance(module);
      const e = instance.exports;
      if (e.garden_abi_version?.() !== 1
          || e.garden_max_modes?.() !== GARDEN_MAX_MODES
          || e.garden_max_frames?.() !== GARDEN_MAX_FRAMES
          || typeof e.garden_process !== "function"
          || !(e.memory instanceof WebAssembly.Memory)) {
        throw new Error("Incompatible Volumetric Rain Wasm module.");
      }
      buffer = e.memory.buffer;
      stateOffset = e.garden_state_ptr();
      outputOffset = e.garden_output_ptr();
      if (stateOffset % 8 || outputOffset % 4 || stateOffset < 0 || outputOffset < 0
          || stateOffset + STATE_BYTES > buffer.byteLength
          || outputOffset + OUTPUT_BYTES > buffer.byteLength) {
        throw new Error("Invalid Volumetric Rain memory layout.");
      }
    } catch (error) {
      instance = null;
      wasmError = String(error?.message || error);
    }
  }
  if (!instance) {
    buffer = new ArrayBuffer(STATE_BYTES + OUTPUT_BYTES);
    stateOffset = 0;
    outputOffset = STATE_BYTES;
  }
  const state = new Float64Array(buffer, stateOffset, STATE_DOUBLES);
  const lane = (index) => new Float64Array(buffer, stateOffset + (HEADER + index * GARDEN_MAX_MODES) * 8, GARDEN_MAX_MODES);
  const real = lane(0), imaginary = lane(1), cosine = lane(2), sine = lane(3);
  const gainLeft = lane(4), gainRight = lane(5);
  const deltaCosine = lane(6), deltaSine = lane(7), deltaLeft = lane(8), deltaRight = lane(9);
  const targetCosine = lane(10), targetSine = lane(11), targetLeft = lane(12), targetRight = lane(13);
  const left = new Float32Array(buffer, outputOffset, GARDEN_MAX_FRAMES);
  const right = new Float32Array(buffer, outputOffset + GARDEN_MAX_FRAMES * 4, GARDEN_MAX_FRAMES);
  const output = { left, right };
  const frequencies = new Float64Array(GARDEN_MAX_MODES);
  const transitionFrames = Math.max(32, Math.round(rate * 0.008));
  const shapeX = new Float64Array(17), shapeY = new Float64Array(13);
  const bankRidge = new Float64Array(GARDEN_MAX_MODES);
  let ridgeY = NaN, ridgeModes = 0;
  let currentSettings;

  function configure(next = {}, prepared = null) {
    const s = sanitizeGardenSettings({ ...currentSettings, ...next });
    const plan = prepared || prepareGardenSettings(s, rate);
    if (!(plan.coefficients instanceof Float64Array) || plan.coefficients.length !== s.modes * 5
        || plan.sampleRate !== rate) throw new RangeError("Invalid prepared material coefficients.");
    const coefficients = plan.coefficients;
    const initialized = Boolean(currentSettings);
    const previousActive = state[0];
    const active = Math.max(previousActive, s.modes);
    const ramp = initialized ? transitionFrames : 0;
    for (let mode = 0; mode < active; mode += 1) {
      if (mode < s.modes) {
        targetCosine[mode] = coefficients[mode];
        targetSine[mode] = coefficients[s.modes + mode];
        targetLeft[mode] = coefficients[2 * s.modes + mode];
        targetRight[mode] = coefficients[3 * s.modes + mode];
        frequencies[mode] = coefficients[4 * s.modes + mode];
        if (mode >= previousActive) {
          real[mode] = 0;
          imaginary[mode] = 0;
          cosine[mode] = targetCosine[mode];
          sine[mode] = targetSine[mode];
        }
      } else {
        targetCosine[mode] = cosine[mode];
        targetSine[mode] = sine[mode];
        targetLeft[mode] = 0;
        targetRight[mode] = 0;
      }
      if (ramp) {
        deltaCosine[mode] = (targetCosine[mode] - cosine[mode]) / ramp;
        deltaSine[mode] = (targetSine[mode] - sine[mode]) / ramp;
        deltaLeft[mode] = (targetLeft[mode] - gainLeft[mode]) / ramp;
        deltaRight[mode] = (targetRight[mode] - gainRight[mode]) / ramp;
      } else {
        cosine[mode] = targetCosine[mode];
        sine[mode] = targetSine[mode];
        gainLeft[mode] = targetLeft[mode];
        gainRight[mode] = targetRight[mode];
      }
    }
    state[0] = active;
    state[1] = s.modes;
    state[2] = ramp;
    currentSettings = Object.freeze(s);
    return currentSettings;
  }

  function strike(x = 0.5, y = 0.5, velocity = 1, exciter = 'mallet') {
    if (currentSettings.model === 'bank') {
      const px = bounded(x, 0, 1, 0.5), py = bounded(y, 0, 1, 0.5);
      const strength = bounded(velocity, 0, 1, 0);
      const modes = currentSettings.modes;
      const scale = 0.65 * strength / Math.sqrt(modes);
      // Cache repeated shapes; values and arithmetic match the original loop.
      for (let i = 0; i < 17; i++) shapeX[i] = Math.sin((1 + i) * Math.PI * (0.04 + px * 0.92));
      for (let i = 0; i < 13; i++) shapeY[i] = Math.cos((1 + i) * Math.PI * py);
      // Fixed spectral focus often repeats the same ridge. Reuse its exact
      // values to keep expensive exponentials out of subsequent contacts.
      if (ridgeY !== py || ridgeModes !== modes) {
        fillBankRidge(bankRidge, modes, py);
        ridgeY = py; ridgeModes = modes;
      }
      for (let mode = 0; mode < modes; mode++) {
        const shape = shapeX[mode % 17] * shapeY[Math.floor(mode / 17) % 13];
        imaginary[mode] = Math.max(-2, Math.min(2, imaginary[mode] + shape * bankRidge[mode] * scale));
      }
      return;
    }
    const tine = Math.min(TINE_COUNT - 1, Math.floor(bounded(x, 0, 1, 0.5) * TINE_COUNT));
    const point = bounded(y, 0.08, 0.98, 0.7);
    const strength = bounded(velocity, 0, 1, 0);
    // Excite only this object, with bounded work even at maximum density.
    // Fixed cluster amplitudes keep the main tine audible at every detail tier.
    for (let mode = tine; mode < currentSettings.modes; mode += TINE_COUNT) {
      const local = Math.floor(mode / TINE_COUNT);
      const partial = local % 4;
      const satellite = Math.floor(local / 4);
      const shape = Math.sin((partial + 0.5) * Math.PI * point);
      const contact = exciter === 'mallet' ? Math.exp(-partial * 0.65) : exciter === 'pick' ? 1 / (1 + partial * 0.18) : 0.35;
      const phase = satellite ? Math.cos(satellite * 2.3999632297) : 1;
      const impulse = 0.42 * strength * shape * contact * phase;
      // Displacement for a pick; velocity impulse for mallet/scraper contacts.
      const destination = exciter === 'pick' ? real : imaginary;
      destination[mode] = Math.max(-2, Math.min(2, destination[mode] + impulse));
    }
  }

  function processJavaScript(frames) {
    let active = state[0];
    let remaining = state[2];
    for (let frame = 0; frame < frames; frame += 1) {
      let l = 0, r = 0;
      for (let mode = 0; mode < active; mode += 1) {
        if (remaining > 0) {
          cosine[mode] += deltaCosine[mode];
          sine[mode] += deltaSine[mode];
          gainLeft[mode] += deltaLeft[mode];
          gainRight[mode] += deltaRight[mode];
        }
        const re = real[mode], im = imaginary[mode];
        const nextReal = cosine[mode] * re - sine[mode] * im;
        imaginary[mode] = sine[mode] * re + cosine[mode] * im;
        real[mode] = nextReal;
        l += nextReal * gainLeft[mode];
        r += nextReal * gainRight[mode];
      }
      // A smooth bounded output map is shared verbatim by both kernels.
      left[frame] = 0.8 * l / (1 + Math.abs(l));
      right[frame] = 0.8 * r / (1 + Math.abs(r));
      if (remaining > 0) {
        remaining -= 1;
        if (remaining === 0) {
          for (let mode = 0; mode < active; mode += 1) {
            cosine[mode] = targetCosine[mode];
            sine[mode] = targetSine[mode];
            gainLeft[mode] = targetLeft[mode];
            gainRight[mode] = targetRight[mode];
          }
          active = state[1];
        }
      }
    }
    state[0] = active;
    state[2] = remaining;
  }

  configure(settings, prepared);
  return {
    hasWasm: Boolean(instance), wasmError, sampleRate: rate, left, right,
    get settings() { return currentSettings; },
    configure,
    strike,
    process(frames = 128, backend = "wasm") {
      if (!Number.isInteger(frames) || frames < 0 || frames > GARDEN_MAX_FRAMES) {
        throw new RangeError(`Volumetric Rain renders 0–${GARDEN_MAX_FRAMES} frames per call.`);
      }
      if (backend !== "wasm" && backend !== "js") throw new RangeError("Unknown garden backend.");
      if (backend === "wasm" && instance) instance.exports.garden_process(frames);
      else processJavaScript(frames);
      return output;
    },
    reset() {
      real.fill(0);
      imaginary.fill(0);
      left.fill(0);
      right.fill(0);
      cosine.set(targetCosine);
      sine.set(targetSine);
      gainLeft.set(targetLeft);
      gainRight.set(targetRight);
      state[0] = state[1];
      state[2] = 0;
    },
    getEnergies(target) {
      target.fill(0);
      if (!target.length) return target;
      const modes = state[0];
      for (let mode = 0; mode < modes; mode += 1) {
        const bank = currentSettings.model === 'bank';
        const band = bank ? Math.min(target.length - 1, Math.floor(mode * target.length / modes)) : (mode % TINE_COUNT) % target.length;
        const weight = bank ? 1 : gainLeft[mode] * gainLeft[mode] + gainRight[mode] * gainRight[mode];
        target[band] += (real[mode] * real[mode] + imaginary[mode] * imaginary[mode]) * weight;
      }
      for (let band = 0; band < target.length; band += 1) target[band] = Math.sqrt(target[band]);
      return target;
    },
    // Caller-owned destination; useful for plotting the actual tuning, not a
    // second independent visual model. Values above settings.modes are zero.
    getFrequencies(target) {
      target.fill(0);
      const count = Math.min(target.length, currentSettings.modes);
      for (let mode = 0; mode < count; mode += 1) target[mode] = frequencies[mode];
      return target;
    },
  };
}
