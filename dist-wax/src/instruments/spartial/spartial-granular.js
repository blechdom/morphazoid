// A fixed-pool, sample-clock granular layer. It receives the additive engine's
// mono signal before master level, speaker routing, or the A/B mixer.
export const SPARTIAL_MAX_GRAINS = 64;
export const SPARTIAL_GRAIN_BUFFER_SECONDS = 4;
export const SPARTIAL_GRAIN_FILE_SECONDS = 20;

const SPEAKERS = 16;
const CONTROL_FRAMES = 32;
const TAU = 2 * Math.PI;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrap = (value, length) => ((value % length) + length) % length;
const delta = (from, to, length) => wrap(to - from + length / 2, length) - length / 2;
const finite = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

function makeGrain() {
  return {
    active: false, serial: 0, source: "additive", buffer: null, length: 0,
    cursor: 0, increment: 1, age: 0, duration: 1, gain: 1,
    envelope: 0, energy: 0, panicGain: 1, panicStep: 0,
    routes: new Float64Array(SPEAKERS),
    routeSteps: new Float64Array(SPEAKERS),
  };
}

export class SpartialGranularEngine {
  constructor(sampleRate, settings) {
    this.sampleRate = sampleRate;
    this.settings = settings;
    this.live = new Float32Array(Math.round(sampleRate * SPARTIAL_GRAIN_BUFFER_SECONDS));
    this.writeIndex = 0;
    this.validFrames = 0;
    this.writes = 0;
    this.lastSignalWrite = -this.live.length;
    this.lastLiveSignalFrame = -Infinity;
    this.file = null;
    this.fileRate = sampleRate;
    this.grains = Array.from({ length: SPARTIAL_MAX_GRAINS }, makeGrain);
    this.active = new Uint8Array(SPARTIAL_MAX_GRAINS);
    this.activeCount = 0;
    this.output = new Float64Array(SPEAKERS);
    this.energy = new Float64Array(SPEAKERS);
    this.pattern = new Uint8Array(SPEAKERS);
    this.randomState = (settings.seed ^ 0x47524149) >>> 0 || 1;
    this.serial = 0;
    this.nextGrainFrame = 0;
    this.scheduling = false;
    this.stopped = false;
    this.note = 60;
    this.velocity = 1;
    this.approach = 1 - Math.exp(-1 / (sampleRate * 0.02));
    this.routeApproach = 1 - Math.exp(-CONTROL_FRAMES / (sampleRate * 0.02));
    this.energyDecay = Math.exp(-1 / (sampleRate * 0.07));
    this.mix = settings.granularMix;
    this.updateSettings(settings);
  }

  random() {
    let state = this.randomState;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.randomState = state >>> 0;
    return this.randomState / 0x100000000;
  }

  updateSettings(settings) {
    if (settings.seed !== this.settings.seed) this.randomState = (settings.seed ^ 0x47524149) >>> 0 || 1;
    this.settings = settings;
    this.liveHistoryFrames = Math.ceil(this.sampleRate / 1000
      * (settings.grainLookback + settings.grainScatter + settings.grainSize * 2 ** (settings.grainPitch / 12)));
    const count = settings.speakerCount;
    for (let index = 0; index < count; index += 1) {
      this.pattern[index] = settings.grainPattern === "reverse" ? wrap(-index, count)
        : settings.grainPattern === "alternate" ? (index % 2 ? count - Math.ceil(index / 2) : index / 2)
          : index;
    }
    if (settings.grainPattern === "scatter") {
      let state = (settings.seed ^ 0x53504154) >>> 0 || 1;
      for (let index = count - 1; index > 0; index -= 1) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        const other = (state >>> 0) % (index + 1);
        const saved = this.pattern[index];
        this.pattern[index] = this.pattern[other]; this.pattern[other] = saved;
      }
    }
  }

  /** Own a bounded, sanitized copy. Source samples need not match output rate. */
  setSource(samples, sourceSampleRate = this.sampleRate) {
    if (!(samples instanceof Float32Array) || samples.length < 2) return false;
    const rate = clamp(finite(sourceSampleRate, this.sampleRate), 8000, 192000);
    const size = Math.min(samples.length, Math.floor(rate * SPARTIAL_GRAIN_FILE_SECONDS));
    const file = new Float32Array(size);
    for (let index = 0; index < size; index += 1) file[index] = clamp(finite(samples[index], 0), -1, 1);
    this.file = file;
    this.fileRate = rate;
    return true;
  }

  /** Adopt the main thread's sanitized, transferred buffer without a render-thread copy. */
  adoptSource(samples, sourceSampleRate) {
    if (!(samples instanceof Float32Array) || samples.length < 2
      || !Number.isFinite(sourceSampleRate) || sourceSampleRate < 8000 || sourceSampleRate > 192000
      || samples.length > Math.floor(sourceSampleRate * SPARTIAL_GRAIN_FILE_SECONDS)) return false;
    this.file = samples;
    this.fileRate = sourceSampleRate;
    return true;
  }

  clearSource() {
    this.file = null;
    // Existing file grains retain their own short source reference and fade.
    for (let index = 0; index < this.activeCount; index += 1) {
      const grain = this.grains[this.active[index]];
      if (grain.source === "file") grain.panicStep = grain.panicGain / Math.max(1, Math.round(this.sampleRate * 0.006));
    }
  }

  noteOn(note, velocity) {
    this.stopped = false;
    this.note = note;
    this.velocity = velocity;
  }

  panic() {
    this.stopped = true;
    this.scheduling = false;
    for (let index = 0; index < this.activeCount; index += 1) {
      const grain = this.grains[this.active[index]];
      grain.panicStep = grain.panicGain / Math.max(1, Math.round(this.sampleRate * 0.006));
    }
  }

  get bufferReady() {
    return this.validFrames >= Math.ceil(this.sampleRate * 0.01)
      && this.writes - this.lastSignalWrite < this.live.length;
  }

  capture(sample, frame) {
    if (this.settings.grainFreeze && this.settings.granularSource === "additive") return;
    this.live[this.writeIndex] = sample;
    this.writeIndex = (this.writeIndex + 1) % this.live.length;
    this.validFrames = Math.min(this.validFrames + 1, this.live.length);
    if (Math.abs(sample) > 1e-7) {
      this.lastSignalWrite = this.writes;
      this.lastLiveSignalFrame = frame;
    }
    this.writes += 1;
  }

  route(grain, phase, initial = false) {
    const settings = this.settings;
    const count = settings.speakerCount;
    const direction = settings.counterRotate && grain.serial % 2 ? -1 : 1;
    const base = this.pattern[grain.serial % count] * settings.grainSpread;
    const rotated = wrap(base + (settings.offset + phase * direction) * count, count);
    const position = wrap(rotated + delta(rotated, settings.target, count) * settings.lock, count);
    const left = Math.floor(position);
    const right = (left + 1) % count;
    const leftGain = Math.cos((position - left) * Math.PI / 2);
    const rightGain = Math.sin((position - left) * Math.PI / 2);
    for (let speaker = 0; speaker < SPEAKERS; speaker += 1) {
      const target = speaker === left ? leftGain : speaker === right ? rightGain : 0;
      if (initial) {
        grain.routes[speaker] = target;
        grain.routeSteps[speaker] = 0;
      } else grain.routeSteps[speaker] = (target - grain.routes[speaker]) * this.routeApproach / CONTROL_FRAMES;
    }
  }

  spawn(phase) {
    if (this.activeCount === SPARTIAL_MAX_GRAINS) return;
    let slot = 0;
    while (this.grains[slot].active) slot += 1;
    const grain = this.grains[slot];
    const settings = this.settings;
    const file = settings.granularSource === "file";
    const buffer = file ? this.file : this.live;
    const length = file ? buffer.length : this.validFrames;
    const sourceRate = file ? this.fileRate : this.sampleRate;
    const duration = Math.max(2, Math.round(settings.grainSize * this.sampleRate / 1000));
    const transpose = settings.grainPitch + (file ? this.note - 60 : 0);
    const speed = 2 ** (transpose / 12) * sourceRate / this.sampleRate;
    const reverse = this.random() < settings.grainReverse;
    const scatter = (2 * this.random() - 1) * settings.grainScatter * sourceRate / 1000;
    let cursor;
    if (file) {
      // Position picks a fixed file center; rate and reverse read through it.
      cursor = settings.grainPosition * (length - 1) + scatter - (reverse ? -1 : 1) * speed * duration / 2;
    } else {
      // Lookback is the gap from the newest captured sample to the nearer end
      // of the grain. Clamp against available history during the first fill.
      const span = Math.min(length - 1, speed * (duration - 1));
      // Also reserve the writer's travel over this grain's life. Otherwise a
      // slow/reversed old readhead can be overwritten with new audio before
      // its look-back delay elapses. Keep this margin when frozen, because
      // capture can resume while an existing grain is still reading.
      const reserve = reverse ? (1 + speed) * (duration - 1)
        : span + Math.max(0, 1 - speed) * (duration - 1);
      const lookback = clamp(settings.grainLookback * sourceRate / 1000 + scatter, 0, Math.max(0, length - 1 - reserve));
      const newest = this.validFrames === this.live.length ? this.writeIndex - 1 : this.validFrames - 1;
      cursor = newest - lookback - (reverse ? 0 : span);
    }
    grain.active = true;
    grain.serial = this.serial++;
    grain.source = file ? "file" : "additive";
    grain.buffer = buffer;
    grain.length = length;
    grain.cursor = wrap(cursor, length);
    grain.increment = reverse ? -speed : speed;
    grain.age = 0;
    grain.duration = duration;
    // Expected Hann overlap provides fixed grain gain, never instantaneous
    // envelope normalization. Sparse windows and released tails retain shape.
    grain.gain = (file ? this.velocity : 1) / Math.max(1, settings.grainDensity * duration / this.sampleRate * 0.5);
    grain.panicGain = 1;
    grain.panicStep = 0;
    grain.envelope = 0;
    grain.energy = 0;
    this.route(grain, phase, true);
    this.active[this.activeCount++] = slot;
  }

  /** Returns a reused 16-channel buffer of this sample's bounded grain bus. */
  tick(frame, phase, gated, level) {
    const settings = this.settings;
    this.mix += (settings.granularMix - this.mix) * this.approach;
    // Reach exact endpoints after a quiet settling interval.
    if (Math.abs(settings.granularMix - this.mix) < 1e-10) this.mix = settings.granularMix;
    const file = settings.granularSource === "file";
    const ready = file ? this.file !== null : this.bufferReady;
    const frozen = !file && settings.grainFreeze;
    // The live source is delayed history, including the additive release.
    // Key-up must not stop grain births before a short note reaches that
    // history. Bound its tail by the oldest selectable source sample, then
    // let existing grains finish. Use sample time so history ages during
    // Freeze too; thawing an old buffer cannot start another cloud by itself.
    const historyFrames = Math.min(this.validFrames - 1, this.liveHistoryFrames);
    const liveTail = !file && frame - this.lastLiveSignalFrame <= historyFrames;
    const running = !this.stopped && ready && (gated || frozen || liveTail)
      && (this.mix > 1e-10 || settings.granularMix > 0);
    if (running) {
      if (!this.scheduling) this.nextGrainFrame = frame;
      if (frame >= this.nextGrainFrame) {
        this.spawn(phase);
        const jitter = 1 + (2 * this.random() - 1) * settings.grainJitter * 0.9;
        this.nextGrainFrame = frame + Math.max(1, this.sampleRate / settings.grainDensity * jitter);
      }
    }
    this.scheduling = running;
    this.output.fill(0);
    for (let index = 0; index < this.activeCount;) {
      const grain = this.grains[this.active[index]];
      if (frame % CONTROL_FRAMES === 0) this.route(grain, phase);
      const envelope = 0.5 - 0.5 * Math.cos(TAU * grain.age / (grain.duration - 1));
      const whole = Math.floor(grain.cursor);
      const fraction = grain.cursor - whole;
      // The production sender sanitizes before transferring ownership. Keep
      // malformed direct messages finite too, without a full buffer scan here.
      const first = clamp(finite(grain.buffer[whole], 0), -1, 1);
      const second = clamp(finite(grain.buffer[(whole + 1) % grain.length], 0), -1, 1);
      const sample = first + (second - first) * fraction;
      const signal = sample * envelope * grain.gain * grain.panicGain;
      grain.envelope = envelope * grain.panicGain;
      grain.energy = grain.energy * this.energyDecay + Math.abs(signal) * (1 - this.energyDecay);
      for (let speaker = 0; speaker < SPEAKERS; speaker += 1) {
        grain.routes[speaker] += grain.routeSteps[speaker];
        this.output[speaker] += signal * grain.routes[speaker];
      }
      grain.cursor = wrap(grain.cursor + grain.increment, grain.length);
      grain.age += 1;
      grain.panicGain = Math.max(0, grain.panicGain - grain.panicStep);
      if (grain.age >= grain.duration || grain.panicGain < 1e-12) {
        grain.active = false;
        grain.buffer = null;
        this.activeCount -= 1;
        this.active[index] = this.active[this.activeCount];
      } else index += 1;
    }
    let total = 0;
    for (let speaker = 0; speaker < SPEAKERS; speaker += 1) {
      this.output[speaker] = Math.tanh(this.output[speaker]);
      total += Math.abs(this.output[speaker]);
    }
    // Independent grains can add coherently when surround folds to stereo.
    // A shared, smooth upper knee bounds the entire bus, preserving channel
    // proportions and normal levels (L1 <= 1). Its L1 ceiling matches the
    // additive equal-power routes, so the existing stereo preview stays safe.
    const knee = Math.SQRT2 - 1;
    const scale = total > 1 ? (1 + knee * Math.tanh((total - 1) / knee)) / total : 1;
    for (let speaker = 0; speaker < SPEAKERS; speaker += 1) {
      this.output[speaker] *= scale;
      const audible = this.output[speaker] * 0.72 * level * this.mix;
      this.energy[speaker] = this.energy[speaker] * this.energyDecay + Math.abs(audible) * (1 - this.energyDecay);
    }
    return this.output;
  }

  snapshot(level) {
    const grains = [];
    const count = this.settings.speakerCount;
    for (let index = 0; index < this.activeCount; index += 1) {
      const grain = this.grains[this.active[index]];
      let x = 0; let y = 0;
      for (let speaker = 0; speaker < count; speaker += 1) {
        const power = grain.routes[speaker] ** 2;
        x += Math.cos(TAU * speaker / count) * power;
        y += Math.sin(TAU * speaker / count) * power;
      }
      grains.push({
        id: grain.serial, source: grain.source,
        position: wrap(Math.atan2(y, x) / TAU * count, count),
        envelope: grain.envelope * this.mix * level,
        energy: grain.energy * 0.72 * this.mix * level,
        progress: grain.age / grain.duration,
      });
    }
    return {
      grains,
      grainEnergy: Array.from(this.energy),
      grainBufferReady: this.bufferReady,
      grainBufferDuration: this.validFrames / this.sampleRate,
      grainFileReady: this.file !== null,
      grainFileDuration: this.file ? this.file.length / this.fileRate : 0,
      grainFrozen: this.settings.grainFreeze && this.settings.granularSource === "additive",
      granularMix: this.mix,
    };
  }
}
