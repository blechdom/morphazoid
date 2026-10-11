import { clamp, TABLE_SIZE } from './model.js';

const TAU = Math.PI * 2;
const LAYERS = 3;
const VOICES = ['sine', 'reed', 'glass'];
const REGISTERS = [.5, 1, 2];
const GLASS_RATIOS = [2.414213562373095, 3.97, 6.12];
const EMPTY_LAYER = Object.freeze({ x: new Float32Array(0), y: new Float32Array(0), bend: new Float32Array(0) });

function boundedLayer(layer) {
  const length = layer?.x?.length;
  if (!Number.isInteger(length) || length < 2 || length > TABLE_SIZE
    || layer.y?.length !== length || layer.bend?.length !== length) return EMPTY_LAYER;
  const x = new Float32Array(length), y = new Float32Array(length), bend = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    if (!Number.isFinite(layer.x[i]) || !Number.isFinite(layer.y[i]) || !Number.isFinite(layer.bend[i])) return EMPTY_LAYER;
    x[i] = clamp(layer.x[i], -4, 4); y[i] = clamp(layer.y[i], -4, 4); bend[i] = clamp(layer.bend[i], 0, 1);
  }
  return { x, y, bend };
}

function boundedBank(bank) {
  return { aspect: clamp(bank?.view?.aspect, .1, 10, 1),
    layers: Array.from({ length: LAYERS }, (_, index) => boundedLayer(bank?.layers?.[index])) };
}

function readLayer(layer, phase, aspect, out) {
  if (!layer.x.length) return false;
  const position = phase * layer.x.length, index = Math.floor(position);
  const next = (index + 1) % layer.x.length, fraction = position - index;
  out[0] = clamp(2 * (layer.x[index] + (layer.x[next] - layer.x[index]) * fraction), -1, 1);
  out[1] = clamp(2 * aspect * (layer.y[index] + (layer.y[next] - layer.y[index]) * fraction), -1, 1);
  out[2] = layer.bend[index] + (layer.bend[next] - layer.bend[index]) * fraction;
  return true;
}

// Smoothly remove partials before Nyquist rather than folding their brightness
// into low aliases. These are artistic sustained voices, not physical models.
function partialGain(frequency, sampleRate) {
  const t = clamp((sampleRate * .42 - frequency) / (sampleRate * .12), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Three geometry readers share one slow phase; all synthesis stays sample-clocked. */
export class TraceDSP {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.phase = 0; this.travel = 0; this.rate = .1; this.targetRate = .1;
    this.bank = boundedBank(null); this.previous = null; this.pending = null; this.fade = 1;
    this.smoothing = 1 - Math.exp(-1 / (.012 * sampleRate));
    this.rateSmoothing = 1 - Math.exp(-1 / (.035 * sampleRate));
    this.fadeStep = 1 / (.09 * sampleRate);
    this.enabled = new Uint8Array([1, 1, 1]);
    this.voiceTargets = new Uint8Array([0, 1, 2]);
    this.voiceWeights = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    this.gains = new Float64Array(LAYERS);
    this.pans = new Float64Array(LAYERS); this.heights = new Float64Array(LAYERS); this.bends = new Float64Array(LAYERS);
    this.frequencies = new Float64Array([55, 110, 220]);
    this.carriers = new Float64Array(LAYERS); this.glassPhases = new Float64Array(LAYERS * 3);
    this.point = new Float64Array(3); this.oldPoint = new Float64Array(3);
  }

  setState(state = {}) {
    this.targetRate = clamp(state.traceRate, .01, 1, .1);
    for (let layer = 0; layer < LAYERS; layer++) {
      this.enabled[layer] = state.layerEnabled?.[layer] === false ? 0 : 1;
      const voice = VOICES.indexOf(state.layerVoices?.[layer]);
      this.voiceTargets[layer] = voice < 0 ? layer : voice;
    }
  }

  setBank(bank) {
    const next = boundedBank(bank);
    // Keep only the latest waiting geometry. A fast stream of camera edits can
    // neither interrupt a fade nor grow a queue in the audio thread.
    if (this.previous) { this.pending = next; return; }
    this.previous = this.bank; this.bank = next; this.fade = 0;
  }

  setPhase(value) {
    this.travel = clamp(value, 0, 1e9, 0);
    this.phase = this.travel % 1;
  }

  reset() { this.setPhase(0); }

  /** Writes a stereo sample into a reused pair; allocates no per-sample objects. */
  sample(out, baseFrequency, moving) {
    out[0] = 0; out[1] = 0;
    this.rate += (this.targetRate - this.rate) * this.rateSmoothing;
    const blend = this.fade * this.fade * (3 - 2 * this.fade);
    for (let layer = 0; layer < LAYERS; layer++) {
      const present = readLayer(this.bank.layers[layer], this.phase, this.bank.aspect, this.point);
      const oldPresent = this.previous && readLayer(this.previous.layers[layer], this.phase, this.previous.aspect, this.oldPoint);
      let pan = this.pans[layer], height = this.heights[layer], bend = this.bends[layer];
      let presence = present ? 1 : 0;
      if (oldPresent && present) {
        pan = this.oldPoint[0] + (this.point[0] - this.oldPoint[0]) * blend;
        height = this.oldPoint[1] + (this.point[1] - this.oldPoint[1]) * blend;
        bend = this.oldPoint[2] + (this.point[2] - this.oldPoint[2]) * blend;
      } else if (present || oldPresent) {
        const point = present ? this.point : this.oldPoint;
        pan = point[0]; height = point[1]; bend = point[2];
      }
      if (this.previous) presence = (oldPresent ? 1 : 0) + ((present ? 1 : 0) - (oldPresent ? 1 : 0)) * blend;
      this.pans[layer] += (pan - this.pans[layer]) * this.smoothing;
      this.heights[layer] += (height - this.heights[layer]) * this.smoothing;
      this.bends[layer] += (bend - this.bends[layer]) * this.smoothing;
      this.gains[layer] += (presence * this.enabled[layer] - this.gains[layer]) * this.smoothing;

      // y spans two octaves either side of the reference; each visible level
      // retains its own low/middle/high register. Traversal rate is absent here.
      const frequency = clamp(baseFrequency * REGISTERS[layer] * 2 ** (2 * this.heights[layer]), 8, this.sampleRate * .2, 110);
      this.frequencies[layer] = frequency;
      const theta = this.carriers[layer] * TAU, fundamental = Math.sin(theta);
      const color = this.bends[layer], weightIndex = layer * 3;
      let signal = 0;
      for (let voice = 0; voice < 3; voice++) {
        const index = weightIndex + voice;
        const target = this.voiceTargets[layer] === voice ? 1 : 0;
        this.voiceWeights[index] += (target - this.voiceWeights[index]) * this.smoothing;
        const weight = this.voiceWeights[index];
        if (weight < 1e-8) continue;
        let value;
        if (voice === 0) {
          value = .94 * fundamental + .06 * color * partialGain(frequency * 2, this.sampleRate) * Math.sin(theta * 2);
        } else if (voice === 1) {
          value = .68 * fundamental
            + (.07 + .09 * color) * partialGain(frequency * 3, this.sampleRate) * Math.sin(theta * 3)
            + (.025 + .075 * color) * partialGain(frequency * 5, this.sampleRate) * Math.sin(theta * 5)
            + (.01 + .05 * color) * partialGain(frequency * 7, this.sampleRate) * Math.sin(theta * 7);
        } else {
          value = .62 * fundamental
            + (.08 + .14 * color) * partialGain(frequency * GLASS_RATIOS[0], this.sampleRate) * Math.sin(this.glassPhases[weightIndex] * TAU)
            + (.025 + .075 * color) * partialGain(frequency * GLASS_RATIOS[1], this.sampleRate) * Math.sin(this.glassPhases[weightIndex + 1] * TAU)
            + (.01 + .05 * color) * partialGain(frequency * GLASS_RATIOS[2], this.sampleRate) * Math.sin(this.glassPhases[weightIndex + 2] * TAU);
        }
        signal += value * weight;
      }
      const angle = (this.pans[layer] + 1) * Math.PI / 4;
      const gain = this.gains[layer] * .3;
      out[0] += signal * gain * Math.cos(angle);
      out[1] += signal * gain * Math.sin(angle);
      // Keep carriers and all glass partials continuous through mute/voice edits.
      this.carriers[layer] = (this.carriers[layer] + frequency / this.sampleRate) % 1;
      for (let partial = 0; partial < 3; partial++) {
        const index = weightIndex + partial;
        this.glassPhases[index] = (this.glassPhases[index] + frequency * GLASS_RATIOS[partial] / this.sampleRate) % 1;
      }
    }
    if (this.previous) {
      this.fade = Math.min(1, this.fade + this.fadeStep);
      if (this.fade === 1) {
        this.previous = null;
        if (this.pending) { this.previous = this.bank; this.bank = this.pending; this.pending = null; this.fade = 0; }
      }
    }
    if (moving) {
      const step = this.rate / this.sampleRate;
      this.phase = (this.phase + step) % 1;
      this.travel += step;
    }
  }
}
