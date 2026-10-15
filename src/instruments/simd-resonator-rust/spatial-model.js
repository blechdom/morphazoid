// Audio-clock routing shared by the modal bank and phase-preserved FFT bins.
export const MAX_SPATIAL_CHANNELS = 16;
export const SPATIAL_DEFAULTS = Object.freeze({ enabled: false, speakerCount: 8, target: 'both',
  pattern: 'ascending', span: 1, offset: 0, motion: false, rate: .05 });
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const wrapTurn = value => ((value % 1) + 1) % 1;
export function sanitizeSpatialSettings(value = {}) {
  return Object.freeze({
    enabled: Boolean(value.enabled),
    speakerCount: clamp(Math.round(finite(value.speakerCount, 8)), 4, MAX_SPATIAL_CHANNELS),
    target: ['both', 'modes', 'fft'].includes(value.target) ? value.target : 'both',
    pattern: ['ascending', 'descending', 'alternate', 'scatter'].includes(value.pattern) ? value.pattern : 'ascending',
    span: clamp(finite(value.span, 1), 0, 4), offset: clamp(finite(value.offset, 0), 0, 1),
    motion: Boolean(value.motion), rate: clamp(finite(value.rate, .05), -1, 1),
  });
}

function scattered(index) {
  if (!index) return 0;
  let value = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b);
  value ^= value >>> 13; value = Math.imul(value, 0xc2b2ae35); value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

// The complete modal bank spans one turn at span=1. FFT uses its logarithmic
// analysis-band coordinate, preserving a continuous route between band centers.
export function spatialPosition(index, count, settings = SPATIAL_DEFAULTS, phase = 0, component = 'modes') {
  if (settings.target !== 'both' && settings.target !== component) return 0;
  const denominator = Math.max(1, count);
  let rank = index;
  if (settings.pattern === 'descending') rank = -index;
  else if (settings.pattern === 'alternate') {
    const whole = Math.floor(index), part = index - whole;
    const first = whole % 2 ? denominator - 1 - Math.floor(whole / 2) : Math.floor(whole / 2);
    const second = (whole + 1) % 2 ? denominator - 1 - Math.floor((whole + 1) / 2) : Math.floor((whole + 1) / 2);
    let delta = second - first;
    delta -= Math.round(delta / denominator) * denominator;
    rank = first + delta * part;
  } else if (settings.pattern === 'scatter') {
    const whole = Math.floor(index), part = index - whole;
    const first = scattered(whole), second = scattered(whole + 1);
    const delta = second - first - Math.round(second - first);
    rank = (first + delta * part) * denominator;
  }
  return wrapTurn(rank / denominator * settings.span + settings.offset + phase);
}

export function equalPowerRoute(turn, speakerCount, destination = {}) {
  const position = wrapTurn(turn) * speakerCount;
  const left = Math.min(speakerCount - 1, Math.floor(position));
  const mix = position - left;
  destination.left = left; destination.right = (left + 1) % speakerCount;
  destination.leftGain = Math.cos(mix * Math.PI * .5);
  destination.rightGain = Math.sin(mix * Math.PI * .5);
  return destination;
}

/** Fixed storage; arbitrary edits approach a new angle over25ms, then the
 * kernel crossfades previous/next sparse routes within each audio quantum. */
export class SpatialRouter {
  constructor(sampleRate = 48000, capacity = 4096) {
    this.sampleRate = sampleRate; this.settings = SPATIAL_DEFAULTS; this.phase = 0;
    this.positions = new Float64Array(capacity); this.count = 0;
    this.left = new Uint32Array(capacity); this.right = new Uint32Array(capacity);
    this.leftGain = new Float32Array(capacity); this.rightGain = new Float32Array(capacity);
    this.route = {};
  }
  configure(value) { this.settings = sanitizeSpatialSettings(value); }
  advance(frames) {
    if (this.settings.enabled && this.settings.motion) this.phase = wrapTurn(this.phase + frames / this.sampleRate * this.settings.rate);
  }
  prepare(kernel, count, frames) {
    const settings = this.settings;
    const approach = 1 - Math.exp(-frames / (this.sampleRate * .025));
    for (let index = 0; index < count; index++) {
      const target = spatialPosition(index, count, settings, this.phase, 'modes');
      if (index >= this.count) {
        this.positions[index] = target;
        equalPowerRoute(target, settings.speakerCount, this.route);
        this.left[index] = this.route.left; this.right[index] = this.route.right;
        this.leftGain[index] = this.route.leftGain; this.rightGain[index] = this.route.rightGain;
      }
      kernel.routeIndexA[index] = this.left[index]; kernel.routeIndexB[index] = this.right[index];
      kernel.routeGainA[index] = this.leftGain[index]; kernel.routeGainB[index] = this.rightGain[index];
      let delta = target - this.positions[index]; delta -= Math.round(delta);
      this.positions[index] = wrapTurn(this.positions[index] + delta * approach);
      equalPowerRoute(this.positions[index], settings.speakerCount, this.route);
      kernel.routeIndexC[index] = this.left[index] = this.route.left;
      kernel.routeIndexD[index] = this.right[index] = this.route.right;
      kernel.routeGainC[index] = this.leftGain[index] = this.route.leftGain;
      kernel.routeGainD[index] = this.rightGain[index] = this.route.rightGain;
    }
    this.count = count;
  }
}
