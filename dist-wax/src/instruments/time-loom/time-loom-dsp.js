import { CORD_COUNT, clamp, cordEntry, createDefaultState, normalizeState, sanitizeSource } from "./time-loom-model.js";

const MAX_GRAINS = 12;
const ALIGNMENT_POINTS = 32;

function readWrapped(samples, position, start, span) {
  const wrapped = start + ((position - start) % span + span) % span;
  return samples[Math.max(0, Math.min(samples.length - 1, Math.floor(wrapped)))];
}

/** One route reader, with four overlapping fixed-pitch grains. The trajectory
 * advances at 1/stretch while each grain reads at the source's original rate.
 * This is a deliberately lightweight granular approximation, not phase-vocoder
 * resynthesis; extreme stretching gives short transients a woven texture. */
export class TimeLoomDSP {
  constructor(sampleRate = 48000) {
    this.sampleRate = Math.round(clamp(sampleRate, 8000, 192000, 48000));
    this.state = createDefaultState();
    this.sources = Array(CORD_COUNT).fill(null);
    this.activeCord = 0; this.position = cordEntry(this.state.cords[0]);
    this.playing = false; this.armed = false; this.volume = 0.65;
    this.gain = 0; this.stretch = this.state.cords[0].stretch;
    this.transitions = 0; this.frames = 0; this.nextGrain = 0;
    this.grainLength = Math.round(this.sampleRate * 0.064 / 4) * 4;
    this.grainHop = this.grainLength / 4;
    this.window = Float32Array.from({ length: this.grainLength }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / this.grainLength));
    this.grains = Array.from({ length: MAX_GRAINS }, () => ({ samples: null, age: 0, retiring: 0, retirement: 1 }));
    this.gainSlew = 1 - Math.exp(-1 / (this.sampleRate * 0.008));
    this.stretchSlew = 1 - Math.exp(-1 / (this.sampleRate * 0.018));
  }

  retireGrains() {
    const length = Math.round(this.sampleRate * 0.018);
    for (const grain of this.grains) if (grain.samples && !grain.retiring) grain.retiring = grain.retirement = length;
    this.nextGrain = 0;
  }

  setState(value) {
    const before = this.state.cords[this.activeCord];
    const next = normalizeState(value, { ...this.state, activeCord: this.activeCord });
    const changedCord = next.activeCord !== this.activeCord;
    this.state = next;
    if (changedCord) { this.seek(next.activeCord, cordEntry(next.cords[next.activeCord])); return; }
    const cord = next.cords[this.activeCord];
    if (cord.start !== before.start || cord.end !== before.end || cord.reverse !== before.reverse) {
      this.position = clamp(this.position, cord.start, cord.end, cordEntry(cord));
      this.retireGrains();
    }
    if (!this.playing) this.stretch = cord.stretch;
  }

  setSource(index, samples, sampleRate) {
    if (!Number.isInteger(index) || index < 0 || index >= CORD_COUNT) return false;
    this.sources[index] = sanitizeSource(samples, sampleRate);
    if (index === this.activeCord) this.retireGrains();
    return true;
  }

  seek(index, position) {
    if (!Number.isInteger(index) || index < 0 || index >= CORD_COUNT) return;
    this.activeCord = this.state.activeCord = index;
    const cord = this.state.cords[index];
    this.position = clamp(position, cord.start, cord.end, cordEntry(cord));
    this.stretch = cord.stretch; this.retireGrains();
  }

  setPlaying(value) {
    const playing = Boolean(value);
    if (playing && !this.playing) this.nextGrain = 0;
    this.playing = playing;
  }
  setArmed(value) { this.armed = Boolean(value); }
  setVolume(value) { this.volume = clamp(value, 0, 1, 0.65); }

  launchGrain() {
    const source = this.sources[this.activeCord];
    if (!source?.samples.length) return;
    let grain = this.grains.find(candidate => !candidate.samples);
    if (!grain) grain = this.grains.reduce((oldest, candidate) => candidate.age > oldest.age ? candidate : oldest);
    const cord = this.state.cords[this.activeCord];
    const step = (cord.reverse ? -1 : 1) * source.sampleRate / this.sampleRate;
    grain.samples = source.samples; grain.age = 0; grain.retiring = 0;
    grain.start = cord.start * source.samples.length;
    grain.end = cord.end * source.samples.length;
    grain.span = Math.max(1, grain.end - grain.start);
    grain.step = step;
    grain.position = this.position * source.samples.length + step * this.grainLength * 0.5 * (1 / this.stretch - 1);
    grain.seam = Math.max(1, Math.min(source.sampleRate * 0.002, grain.span * 0.12));
    if (Math.abs(this.stretch - 1) > 0.001) this.alignGrain(grain, source.sampleRate);
  }

  // A bounded WSOLA-style search matches the overlapping waveform without
  // changing the route clock. It avoids the beating/pitch drift of unrelated
  // grain phases. The search stays within 12ms of the requested source moment.
  alignGrain(grain, sourceRate) {
    let reference = null;
    for (const candidate of this.grains) {
      if (candidate !== grain && candidate.samples === grain.samples && !candidate.retiring
        && candidate.step === grain.step && candidate.start === grain.start && candidate.end === grain.end
        && (!reference || candidate.age < reference.age)) reference = candidate;
    }
    if (!reference) return;
    const stride = Math.max(1, Math.round(sourceRate * 0.009 / ALIGNMENT_POINTS)) * Math.sign(grain.step);
    const search = Math.min(Math.round(sourceRate * 0.012), Math.floor(grain.span * 0.2));
    const coarseStep = Math.max(1, Math.round(sourceRate / 4000));
    const expected = grain.position;
    let bestOffset = 0; let bestScore = -Infinity;
    let referenceEnergy = 0;
    for (let point = 0; point < ALIGNMENT_POINTS; point++) {
      const value = readWrapped(reference.samples, reference.position + point * stride, reference.start, reference.span);
      referenceEnergy += value * value;
    }
    if (referenceEnergy < 1e-7 || search < 1) return;
    const scoreOffset = offset => {
      let product = 0; let energy = 0;
      for (let point = 0; point < ALIGNMENT_POINTS; point++) {
        const a = readWrapped(reference.samples, reference.position + point * stride, reference.start, reference.span);
        const b = readWrapped(grain.samples, expected + offset + point * stride, grain.start, grain.span);
        product += a * b; energy += b * b;
      }
      if (energy < 1e-7) return;
      const score = product / Math.sqrt(referenceEnergy * energy) - Math.abs(offset) / search * 0.025;
      if (score > bestScore) { bestScore = score; bestOffset = offset; }
    };
    for (let offset = -search; offset <= search; offset += coarseStep) scoreOffset(offset);
    const coarse = bestOffset;
    for (let offset = Math.max(-search, coarse - coarseStep); offset <= Math.min(search, coarse + coarseStep); offset++) scoreOffset(offset);
    if (bestScore > 0.1) grain.position = expected + bestOffset;
  }

  advance() {
    const cord = this.state.cords[this.activeCord];
    const source = this.sources[this.activeCord];
    const duration = source?.samples.length ? source.samples.length / source.sampleRate : 8;
    this.stretch += (cord.stretch - this.stretch) * this.stretchSlew;
    this.position += (cord.reverse ? -1 : 1) / (duration * this.sampleRate * this.stretch);
    if ((!cord.reverse && this.position >= cord.end) || (cord.reverse && this.position <= cord.start)) {
      // Preserve the fractional sample remainder at a route exit.
      const over = Math.abs(this.position - (cord.reverse ? cord.start : cord.end)) * duration * this.stretch;
      const index = cord.next ?? this.activeCord;
      const target = this.state.cords[index];
      const nextSource = this.sources[index];
      const nextDuration = nextSource?.samples.length ? nextSource.samples.length / nextSource.sampleRate : 8;
      if (index !== this.activeCord) this.retireGrains();
      this.activeCord = this.state.activeCord = index;
      this.stretch = target.stretch;
      this.position = clamp(cordEntry(target) + (target.reverse ? -1 : 1) * over / (nextDuration * this.stretch), target.start, target.end, cordEntry(target));
      this.transitions++;
    }
  }

  tick() {
    if (this.playing && this.nextGrain-- <= 0) { this.launchGrain(); this.nextGrain = this.grainHop - 1; }
    let value = 0; let weights = 0;
    for (const grain of this.grains) {
      if (!grain.samples) continue;
      let position = grain.start + ((grain.position - grain.start) % grain.span + grain.span) % grain.span;
      position = Math.min(grain.samples.length - 1, Math.max(0, position));
      const first = Math.floor(position);
      const second = Math.min(first + 1, grain.samples.length - 1);
      const fraction = position - first;
      const sample = grain.samples[first] + (grain.samples[second] - grain.samples[first]) * fraction;
      const edge = Math.min(1, Math.max(0, Math.min(position - grain.start, grain.end - position)) / grain.seam);
      let weight = this.window[grain.age];
      if (grain.retiring) weight *= grain.retiring / grain.retirement;
      value += sample * weight * Math.sin(edge * Math.PI * 0.5); weights += weight;
      grain.age++; grain.position += grain.step;
      if ((grain.retiring && --grain.retiring <= 0) || grain.age >= this.grainLength) grain.samples = null;
    }
    const target = this.armed && this.playing ? this.volume * 0.72 : 0;
    this.gain += (target - this.gain) * this.gainSlew;
    if (target === 0 && this.gain < 1e-9) this.gain = 0;
    if (this.playing) this.advance();
    this.frames++;
    return clamp(value / Math.max(2, weights) * this.gain, -0.98, 0.98, 0);
  }

  process(left, right = left) {
    for (let i = 0; i < left.length; i++) {
      const value = this.tick(); left[i] = value;
      if (right !== left && i < right.length) right[i] = value;
    }
  }

  snapshot() {
    const cord = this.state.cords[this.activeCord];
    return {
      cords: this.state.cords.map(value => ({ ...value })), activeCord: this.activeCord,
      position: this.position, phase: clamp((this.position - cord.start) / (cord.end - cord.start), 0, 1),
      playing: this.playing, armed: this.armed, transitions: this.transitions,
      durations: this.sources.map(source => source?.samples.length ? source.samples.length / source.sampleRate : 0),
      time: this.frames / this.sampleRate,
    };
  }
}
