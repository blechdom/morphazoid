// SPARTIAL's browser-free additive engine. All timing advances on the sample
// clock; the application only supplies note gates and displays snapshots.
export const SPARTIAL_MAX_PARTIALS = 32;
export const SPARTIAL_MAX_VOICES = 8;
export const SPARTIAL_MAX_SPEAKERS = 16;
export const SPARTIAL_DEFAULTS = Object.freeze({
  partials: 16,
  rolloff: 1.2,
  attack: 0.04,
  release: 1.2,
  cascade: 0.045,
  cascadeStart: 0,
  cascadeCurve: 0,
  cascadeVariation: 0,
  cascadeOrder: "up",
  pattern: "wrap",
  rotation: 0,
  cycles: 1,
  stretch: 1,
  inharmonicity: 0,
  spread: 1,
  lock: 0,
  target: 0,
  speakerCount: 8,
  offset: 0,
  level: 0.65,
  counterRotate: false,
  seed: 17,
  gains: Object.freeze(Array(SPARTIAL_MAX_PARTIALS).fill(1)),
});

const TAU = 2 * Math.PI;
const CONTROL_FRAMES = 32;
const SMOOTH_SECONDS = 0.02;
const OUTPUT_CEILING = 0.72;

function finite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function wrap(value, length = 1) {
  return ((value % length) + length) % length;
}

function circleDelta(from, to, length) {
  return wrap(to - from + length / 2, length) - length / 2;
}

function seededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function spectralPreset(id, name, rolloff, gain, stretch = 1, inharmonicity = 0) {
  return Object.freeze({ id, name, settings: Object.freeze({
    rolloff, stretch, inharmonicity,
    gains: Object.freeze(Array.from({ length: SPARTIAL_MAX_PARTIALS }, (_, index) => gain(index + 1))),
  }) });
}

/** Fingerprints reshape timbre without changing notes, routing, or transport. */
export const SPARTIAL_SPECTRAL_PRESETS = Object.freeze([
  spectralPreset("full", "Full spectrum", 1.2, () => 1),
  spectralPreset("odd", "Odd partials", 0.8, (harmonic) => harmonic % 2 ? 1 : 0),
  spectralPreset("even", "Even + root", 0.8, (harmonic) => harmonic === 1 || harmonic % 2 === 0 ? 1 : 0),
  spectralPreset("hollow", "Hollow", 0.65, (harmonic) => harmonic === 1 ? 0.55 : harmonic % 3 === 0 ? 1 : 0.08),
  spectralPreset("soft", "Soft cloud", 1.8, (harmonic) => Math.exp(-(harmonic - 1) / 8)),
  spectralPreset("bright", "Bright ridge", 0.3, (harmonic) => 0.2 + 0.8 * Math.exp(-(((harmonic - 9) / 5) ** 2))),
  spectralPreset("bell", "Split bell", 0.8, (harmonic) => harmonic === 1 || harmonic % 3 === 0 ? 1 : 0.12, 1.16, 0.45),
  spectralPreset("cluster", "Close cluster", 0.45, (harmonic) => harmonic < 10 ? 1 : 0.1, 0.6, 0.2),
]);

/** A reproducible, bounded fingerprint, always keeping the fundamental. */
export function randomSpartialSpectrum(seed = 17) {
  const random = seededRandom(finite(seed, 17));
  const rolloff = 0.5 + random() * 1.2;
  const stretch = 0.75 + random() * 0.65;
  const inharmonicity = random() * 0.65;
  const gains = Array.from({ length: SPARTIAL_MAX_PARTIALS }, (_, index) => (
    index === 0 ? 1 : random() < 0.22 ? 0 : 0.15 + random() * 0.85
  ));
  return { rolloff, stretch, inharmonicity, gains };
}

/** Pure full-instrument dice; preserve performer clocks, volume and devices. */
export function randomSpartialInstrument(current, seed = 17) {
  const random = seededRandom(Math.imul(finite(seed, 17), 0x9e3779b1) ^ 0x53504152);
  const pick = values => values[Math.floor(random() * values.length)];
  const between = (low, high, step) => low + Math.round(random() * (high - low) / step) * step;
  const previous = sanitizeSpartialSettings(current.settings);
  const mode = pick(["single", "chord"]);
  const chord = pick(["minor", "major", "sus", "fifth", "minor7", "major7"]);
  const motion = pick(["off", "cw", "ccw", "counter"]);
  const beatsPerTurn = pick([4, 8, 16, 32, 64]);
  const routingMode = pick(["spread", "spread", "spread", "focus"]);
  const settingsSeed = Math.floor(random() * 0x80000000);
  const spectrum = randomSpartialSpectrum(settingsSeed);
  spectrum.gains[0] = between(0.65, 1, 0.01);
  const running = current.playing && motion !== "off" && routingMode !== "focus";
  return {
    ...current,
    mode, chord, motion, beatsPerTurn, routingMode,
    settings: sanitizeSpartialSettings({
      ...spectrum,
      partials: pick([4, 8, 12, 16, 24, 32]),
      attack: between(0.005, 0.8, 0.005),
      release: between(0.1, 3, 0.01),
      cascade: between(0, 0.125, 0.001),
      cascadeStart: between(0, 0.3, 0.001),
      cascadeCurve: between(-1, 1, 0.01),
      cascadeVariation: between(0, 0.8, 0.01),
      cascadeOrder: pick(["up", "down", "alternate"]),
      pattern: pick(["wrap", "reverse", "alternate", "scatter"]),
      cycles: between(0, 4, 0.01),
      offset: between(0, 0.995, 0.005),
      target: Math.floor(random() * previous.speakerCount),
      seed: settingsSeed,
      // Cycles is this UI's span control; legacy spread stays at unity.
      spread: 1,
      lock: routingMode === "focus" ? 1 : 0,
      rotation: running ? finite(current.tempo, 90) / 60 / beatsPerTurn * (motion === "ccw" ? -1 : 1) : 0,
      counterRotate: motion === "counter",
      level: previous.level,
      speakerCount: previous.speakerCount,
    }),
  };
}

function frequencyRatio(index, settings) {
  if (index === 0) return 1;
  // A stable per-partial deviation makes the irregular spacing reproducible;
  // it is an additive-synthesis texture, not a physical string/bar model.
  const random = seededRandom((settings.seed + 1) * 0x9e3779b1 ^ (index + 1) * 0x85ebca6b);
  const deviation = (random() * 2 - 1) * 0.22 * settings.inharmonicity;
  return ((index + 1) ** settings.stretch) * (1 + deviation);
}

/** Stretch 1 and inharmonicity 0 give exact integer harmonic ratios. */
export function partialFrequencyRatio(index, settings = SPARTIAL_DEFAULTS) {
  return frequencyRatio(
    clamp(Math.floor(finite(index, 0)), 0, SPARTIAL_MAX_PARTIALS - 1),
    sanitizeSpartialSettings(settings),
  );
}

export function sanitizeSpartialSettings(input = {}, previous = SPARTIAL_DEFAULTS) {
  const patch = input && typeof input === "object" ? input : {};
  const base = previous && typeof previous === "object" ? previous : SPARTIAL_DEFAULTS;
  const number = (key, low, high) => clamp(
    finite(patch[key], finite(base[key], SPARTIAL_DEFAULTS[key])), low, high,
  );
  const choice = (key, options) => options.includes(patch[key]) ? patch[key]
    : options.includes(base[key]) ? base[key] : SPARTIAL_DEFAULTS[key];
  const speakerCount = Math.round(number("speakerCount", 4, SPARTIAL_MAX_SPEAKERS));
  const rawGains = Array.isArray(patch.gains) || ArrayBuffer.isView(patch.gains)
    ? patch.gains : base.gains;
  return {
    partials: Math.round(number("partials", 1, SPARTIAL_MAX_PARTIALS)),
    rolloff: number("rolloff", 0, 3),
    attack: number("attack", 0.002, 8),
    release: number("release", 0.005, 12),
    cascade: number("cascade", 0, 0.5),
    cascadeStart: number("cascadeStart", 0, 2),
    cascadeCurve: number("cascadeCurve", -1, 1),
    cascadeVariation: number("cascadeVariation", 0, 1),
    cascadeOrder: choice("cascadeOrder", ["up", "down", "alternate"]),
    pattern: choice("pattern", ["wrap", "reverse", "alternate", "scatter"]),
    rotation: number("rotation", -2, 2),
    cycles: number("cycles", 0, 4),
    stretch: number("stretch", 0.5, 2),
    inharmonicity: number("inharmonicity", 0, 1),
    spread: number("spread", 0, 1),
    lock: number("lock", 0, 1),
    target: clamp(Math.round(number("target", 0, 15)), 0, speakerCount - 1),
    speakerCount,
    offset: wrap(number("offset", -1e6, 1e6)),
    level: number("level", 0, 1),
    counterRotate: typeof patch.counterRotate === "boolean" ? patch.counterRotate
      : base.counterRotate === true,
    seed: Math.round(number("seed", 0, 0x7fffffff)),
    gains: Array.from({ length: SPARTIAL_MAX_PARTIALS }, (_, index) => clamp(
      finite(rawGains?.[index], finite(base.gains?.[index], 1)), 0, 1,
    )),
  };
}

function fillCascadeTimes(settings, times) {
  const count = settings.partials;
  const gapCount = count - 1;
  times[0] = settings.cascadeStart;
  if (!gapCount) return times;
  if (settings.cascade === 0) {
    for (let rank = 1; rank < count; rank += 1) times[rank] = settings.cascadeStart;
    return times;
  }
  const random = seededRandom(settings.seed ^ 0x43415343);
  let weightSum = 0;
  for (let rank = 1; rank < count; rank += 1) {
    const progress = gapCount > 1 ? 2 * (rank - 1) / (gapCount - 1) - 1 : 0;
    const curveWeight = 1 + 0.9 * settings.cascadeCurve * progress;
    const variationWeight = 1 + 0.8 * settings.cascadeVariation * (2 * random() - 1);
    times[rank] = curveWeight * variationWeight;
    weightSum += times[rank];
  }
  const span = gapCount * settings.cascade;
  let elapsed = 0;
  for (let rank = 1; rank < count; rank += 1) {
    elapsed += times[rank] * span / weightSum;
    times[rank] = settings.cascadeStart + elapsed;
  }
  // Keep the displayed and scheduled span exact despite accumulated rounding.
  times[count - 1] = settings.cascadeStart + span;
  return times;
}

/** Onset seconds by entrance rank; pitch direction is applied separately. */
export function spartialCascadeTimes(settings = SPARTIAL_DEFAULTS) {
  const safe = sanitizeSpartialSettings(settings);
  return fillCascadeTimes(safe, Array(safe.partials).fill(0));
}

/** Each speaker appears once per cycle, including the seeded scatter pattern. */
function speakerPattern(settings) {
  const count = settings.speakerCount;
  const values = Array.from({ length: count }, (_, index) => index);
  if (settings.pattern === "reverse") return values.map((index) => wrap(-index, count));
  if (settings.pattern === "alternate") {
    return values.map((index) => index % 2 ? count - Math.ceil(index / 2) : index / 2);
  }
  if (settings.pattern === "scatter") {
    let state = (settings.seed >>> 0) || 1;
    for (let index = count - 1; index > 0; index -= 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const other = (state >>> 0) % (index + 1);
      [values[index], values[other]] = [values[other], values[index]];
    }
  }
  // Keep the first partial at the angular origin so squeezing any pattern
  // down to zero cycles converges on the same visible source position.
  return values.map((value) => wrap(value - values[0], count));
}

function positionFromPattern(index, settings, phase, pattern) {
  const count = settings.speakerCount;
  const direction = settings.counterRotate && index % 2 ? -1 : 1;
  // The complete active bank spans `cycles` turns: one turn spreads all
  // partials around the ring, zero gathers them, and two repeats the ring.
  const slot = index * settings.cycles * count / settings.partials;
  const whole = Math.floor(slot);
  const start = pattern[whole % count];
  const end = pattern[(whole + 1) % count];
  const base = (start + circleDelta(start, end, count) * (slot - whole)) * settings.spread;
  const rotated = wrap(base + (settings.offset + phase * direction) * count, count);
  return wrap(rotated + circleDelta(rotated, settings.target, count) * settings.lock, count);
}

/** A fractional, zero-based speaker index. Phase and offset are turns. */
export function partialPosition(index, settings = SPARTIAL_DEFAULTS, phase = 0) {
  const safe = sanitizeSpartialSettings(settings);
  return positionFromPattern(
    clamp(Math.floor(finite(index, 0)), 0, SPARTIAL_MAX_PARTIALS - 1),
    safe, finite(phase, 0), speakerPattern(safe),
  );
}

/** Rank zero starts first. Alternate order interleaves lowest/highest partials. */
export function partialCascadeRank(index, count, order = "up") {
  const size = clamp(Math.round(finite(count, 1)), 1, SPARTIAL_MAX_PARTIALS);
  const item = clamp(Math.floor(finite(index, 0)), 0, size - 1);
  if (order === "down") return size - 1 - item;
  if (order === "alternate") return item < Math.ceil(size / 2)
    ? item * 2 : (size - 1 - item) * 2 + 1;
  return item;
}

export function equalPowerRoute(position, speakerCount = 8) {
  const count = clamp(Math.round(finite(speakerCount, 8)), 4, SPARTIAL_MAX_SPEAKERS);
  const wrapped = wrap(finite(position, 0), count);
  const left = Math.floor(wrapped);
  const mix = wrapped - left;
  return {
    left,
    right: (left + 1) % count,
    leftGain: Math.cos(mix * Math.PI / 2),
    rightGain: Math.sin(mix * Math.PI / 2),
  };
}

function makeVoice() {
  return {
    active: false, id: null, note: 60, velocity: 1, age: 0, serial: 0,
    gate: false, pending: null, releaseFrames: 0,
    panicGain: 1, panicStep: 0,
    phases: new Float64Array(SPARTIAL_MAX_PARTIALS),
    increments: new Float64Array(SPARTIAL_MAX_PARTIALS),
    targetIncrements: new Float64Array(SPARTIAL_MAX_PARTIALS),
    spectralGains: new Float64Array(SPARTIAL_MAX_PARTIALS),
    envelopes: new Float64Array(SPARTIAL_MAX_PARTIALS),
    releaseSteps: new Float64Array(SPARTIAL_MAX_PARTIALS),
    onsets: new Int32Array(SPARTIAL_MAX_PARTIALS),
    audible: new Uint8Array(SPARTIAL_MAX_PARTIALS),
  };
}

export class SpartialEngine {
  constructor({ sampleRate = 48000, settings = {}, phase = 0 } = {}) {
    this.sampleRate = clamp(finite(sampleRate, 48000), 8000, 192000);
    this.settings = sanitizeSpartialSettings(settings);
    this.voices = Array.from({ length: SPARTIAL_MAX_VOICES }, makeVoice);
    this.phase = wrap(finite(phase, 0));
    this.frame = 0;
    this.serial = 0;
    this.rotation = this.settings.rotation;
    this.level = this.settings.level;
    this.approach = 1 - Math.exp(-1 / (this.sampleRate * SMOOTH_SECONDS));
    this.routeApproach = 1 - Math.exp(-CONTROL_FRAMES / (this.sampleRate * SMOOTH_SECONDS));
    this.pattern = speakerPattern(this.settings);
    this.weights = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.targetWeights = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.frequencyRatios = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.frequencyRanks = new Uint8Array(SPARTIAL_MAX_PARTIALS);
    this.cascadeTimes = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.cascadeOnsets = new Int32Array(SPARTIAL_MAX_PARTIALS);
    this.partialSignals = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.partialEnergy = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.positions = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.routes = new Float64Array(SPARTIAL_MAX_PARTIALS * SPARTIAL_MAX_SPEAKERS);
    this.routeSteps = new Float64Array(this.routes.length);
    this.updateWeights();
    this.updateSpectralRatios();
    this.updateCascadeSchedule();
    this.weights.set(this.targetWeights);
    this.updateRoutes(true);
  }

  setSettings(patch) {
    this.settings = sanitizeSpartialSettings(patch, this.settings);
    this.pattern = speakerPattern(this.settings);
    this.updateWeights();
    this.updateSpectralRatios();
    this.updateCascadeSchedule();
    for (const voice of this.voices) {
      if (voice.active) this.updateVoiceFrequencies(voice);
    }
  }

  /** Reset spatial phase without restarting voices or stepping speaker gains. */
  setPhase(phase) {
    if (typeof phase !== "number" || !Number.isFinite(phase)) return false;
    this.phase = wrap(phase);
    // Adopt the requested speed immediately so a reset to stationary settings
    // cannot drift past the reset position while the old speed decelerates.
    this.rotation = this.settings.rotation;
    this.updateRoutes();
    return true;
  }

  updateSpectralRatios() {
    for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
      this.frequencyRatios[partial] = frequencyRatio(partial, this.settings);
    }
    // Inharmonic offsets may reorder adjacent frequencies. Cascade direction
    // follows pitch, while each partial keeps its own gain and speaker route.
    // The fixed-size rank pass also avoids sorting/allocating on note starts.
    for (let partial = 0; partial < this.settings.partials; partial += 1) {
      let rank = 0;
      for (let other = 0; other < this.settings.partials; other += 1) {
        if (this.frequencyRatios[other] < this.frequencyRatios[partial]
          || (this.frequencyRatios[other] === this.frequencyRatios[partial] && other < partial)) rank += 1;
      }
      this.frequencyRanks[partial] = rank;
    }
  }

  updateVoiceFrequencies(voice, initial = false) {
    const fundamental = 440 * 2 ** ((voice.note - 69) / 12);
    for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
      const frequency = fundamental * this.frequencyRatios[partial];
      voice.audible[partial] = frequency < this.sampleRate * 0.49 ? 1 : 0;
      // Out-of-band targets fade to silence without ever sweeping through
      // aliased frequencies. A newly audible partial fades in at its target.
      voice.targetIncrements[partial] = TAU * Math.min(frequency, this.sampleRate * 0.49) / this.sampleRate;
      if (initial || voice.spectralGains[partial] === 0) {
        voice.increments[partial] = voice.targetIncrements[partial];
      }
      if (initial) voice.spectralGains[partial] = voice.audible[partial];
    }
  }

  updateCascadeSchedule() {
    fillCascadeTimes(this.settings, this.cascadeTimes);
    for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
      const rank = partialCascadeRank(this.frequencyRanks[partial], this.settings.partials, this.settings.cascadeOrder);
      this.cascadeOnsets[partial] = partial < this.settings.partials
        ? Math.round(this.cascadeTimes[rank] * this.sampleRate) : 0;
    }
  }

  updateWeights() {
    const settings = this.settings;
    let total = 0;
    for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
      const baselineWeight = partial < settings.partials
        ? 1 / ((partial + 1) ** settings.rolloff) : 0;
      this.targetWeights[partial] = baselineWeight * settings.gains[partial];
      total += baselineWeight;
    }
    // Normalize against the unpainted bank, not the edited gains. A bar at
    // 0.5 then halves that partial without turning up its neighbors. Since
    // every bar is <=1, the resulting L1 sum remains bounded by one.
    if (total > 0) {
      for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
        this.targetWeights[partial] /= total;
      }
    }
  }

  updateRoutes(initial = false) {
    const settings = this.settings;
    for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
      const position = positionFromPattern(partial, settings, this.phase, this.pattern);
      this.positions[partial] = position;
      const left = Math.floor(position);
      const right = (left + 1) % settings.speakerCount;
      const mix = position - left;
      const leftGain = Math.cos(mix * Math.PI / 2);
      const rightGain = Math.sin(mix * Math.PI / 2);
      for (let speaker = 0; speaker < SPARTIAL_MAX_SPEAKERS; speaker += 1) {
        const index = partial * SPARTIAL_MAX_SPEAKERS + speaker;
        const target = speaker === left ? leftGain : speaker === right ? rightGain : 0;
        if (initial) {
          this.routes[index] = target;
          this.routeSteps[index] = 0;
        } else {
          // Interpolate at audio rate between control-rate route updates. This
          // also fades discrete pattern/array edits without restarting voices.
          const difference = target - this.routes[index];
          this.routeSteps[index] = difference * this.routeApproach / CONTROL_FRAMES;
        }
      }
    }
  }

  startVoice(voice, id, note, velocity) {
    voice.active = true;
    voice.id = id;
    voice.note = note;
    voice.velocity = velocity;
    voice.age = 0;
    voice.serial = ++this.serial;
    voice.gate = true;
    voice.pending = null;
    voice.releaseFrames = 0;
    voice.panicGain = 1;
    voice.panicStep = 0;
    voice.phases.fill(0);
    voice.envelopes.fill(0);
    voice.releaseSteps.fill(0);
    this.updateVoiceFrequencies(voice, true);
    voice.onsets.set(this.cascadeOnsets);
  }

  noteOn(id, note, velocity = 1) {
    if ((typeof id !== "string" && typeof id !== "number")
      || !Number.isFinite(note) || !Number.isFinite(velocity)) return false;
    const safeNote = clamp(note, 0, 127);
    const safeVelocity = clamp(velocity, 0, 1);
    if (safeVelocity === 0) { this.noteOff(id); return false; }
    // Repeated held IDs are idempotent; a retrigger needs a new ID or note-off.
    if (this.voices.some((voice) => voice.active && voice.gate && voice.id === id)) return false;
    let voice = this.voices.find((candidate) => !candidate.active);
    if (voice) {
      this.startVoice(voice, id, safeNote, safeVelocity);
    } else {
      voice = this.voices.reduce((oldest, candidate) => (
        candidate.serial < oldest.serial ? candidate : oldest
      ));
      voice.pending = { id, note: safeNote, velocity: safeVelocity };
      // Give a pending replacement its own age so dense chords rotate through
      // all eight slots rather than repeatedly overwriting the same slot.
      voice.serial = ++this.serial;
      this.releaseVoice(voice, 0.006);
    }
    return true;
  }

  /** Restart one note after a 6 ms fade; other note IDs keep sounding. */
  retrigger(id, note, velocity = 1) {
    if ((typeof id !== "string" && typeof id !== "number")
      || !Number.isFinite(note) || !Number.isFinite(velocity)) return false;
    const safeNote = clamp(note, 0, 127);
    const safeVelocity = clamp(velocity, 0, 1);
    if (safeVelocity === 0) { this.noteOff(id); return false; }
    let destination = null;
    for (const voice of this.voices) {
      if (voice.active && voice.id === id && (!voice.pending || voice.pending.id === id)) {
        if (!destination || voice.gate) destination = voice;
      }
    }
    if (!destination) destination = this.voices.find((voice) => !voice.active);
    // A restart must not steal an unrelated held note. If this ID is already
    // queued behind a stolen voice, replacing that pending request is enough.
    if (!destination) destination = this.voices.find((voice) => voice.pending?.id === id);
    if (!destination) return false;
    for (const voice of this.voices) {
      if (voice.pending?.id === id) voice.pending = null;
      if (voice.active && voice.id === id) {
        // A different note may already be queued behind this old tail. Its
        // release countdown owns that entrance time, so leave it unchanged.
        if (!voice.pending) this.releaseVoice(voice, 0.006);
        // Keep the fade effective even when polyphonic gain normalization
        // would otherwise compensate for the descending release envelopes.
        voice.panicStep = voice.panicGain / voice.releaseFrames;
      }
    }
    const fadeFrames = Math.max(1, Math.round(0.006 * this.sampleRate));
    if (!destination.active) {
      // An empty slot waits silently for the same fixed restart interval.
      this.startVoice(destination, id, safeNote, safeVelocity);
      this.releaseVoice(destination, 0.006);
    }
    // An unrelated release may already own a queued replacement's slot. Keep
    // its remaining fade and add the rest of the fixed wait to the new voice.
    const delayFrames = Math.max(0, fadeFrames - destination.releaseFrames);
    destination.pending = { id, note: safeNote, velocity: safeVelocity, delayFrames };
    destination.serial = ++this.serial;
    return true;
  }

  releaseVoice(voice, seconds) {
    voice.gate = false;
    voice.releaseFrames = Math.max(1, Math.round(seconds * this.sampleRate));
    for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
      voice.releaseSteps[partial] = voice.envelopes[partial] / voice.releaseFrames;
    }
  }

  noteOff(id) {
    for (const voice of this.voices) {
      if (voice.pending?.id === id) voice.pending = null;
      if (voice.active && voice.id === id && voice.gate) {
        this.releaseVoice(voice, this.settings.release);
      }
    }
  }

  panic() {
    for (const voice of this.voices) {
      voice.pending = null;
      if (voice.active) {
        this.releaseVoice(voice, 0.006);
        // This extra ramp sits outside envelope normalization, so dense
        // chords fade throughout the six milliseconds as single notes do.
        voice.panicStep = voice.panicGain / voice.releaseFrames;
      }
    }
  }

  /** Fill caller-owned channels; no AudioContext, DOM, timers or frame loop. */
  render(channels) {
    const length = channels[0]?.length || 0;
    for (const channel of channels) channel.fill(0);
    const outputCount = Math.min(channels.length, SPARTIAL_MAX_SPEAKERS);
    const attackStep = 1 / (this.settings.attack * this.sampleRate);
    const energyDecay = Math.exp(-1 / (this.sampleRate * 0.07));
    for (let frame = 0; frame < length; frame += 1) {
      if (this.frame % CONTROL_FRAMES === 0) this.updateRoutes();
      this.rotation += (this.settings.rotation - this.rotation) * this.approach;
      this.level += (this.settings.level - this.level) * this.approach;
      this.phase = wrap(this.phase + this.rotation / this.sampleRate);
      this.partialSignals.fill(0);
      let envelopeSum = 0;
      for (const voice of this.voices) {
        if (!voice.active) continue;
        let peakEnvelope = 0;
        const voiceGain = voice.velocity * voice.panicGain;
        for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
          voice.spectralGains[partial] += (voice.audible[partial] - voice.spectralGains[partial]) * this.approach;
          if (!voice.audible[partial] && voice.spectralGains[partial] < 1e-7) {
            voice.spectralGains[partial] = 0;
            continue;
          }
          voice.increments[partial] += (voice.targetIncrements[partial] - voice.increments[partial]) * this.approach;
          let envelope = voice.envelopes[partial];
          if (voice.gate) {
            if (voice.age >= voice.onsets[partial]) envelope = Math.min(1, envelope + attackStep);
          } else {
            envelope = Math.max(0, envelope - voice.releaseSteps[partial]);
          }
          voice.envelopes[partial] = envelope;
          peakEnvelope = Math.max(peakEnvelope, envelope);
          let phase = voice.phases[partial] + voice.increments[partial];
          if (phase >= TAU) phase -= TAU;
          voice.phases[partial] = phase;
          this.partialSignals[partial] += Math.sin(phase) * envelope * voiceGain * voice.spectralGains[partial];
        }
        envelopeSum += peakEnvelope * voice.velocity;
        voice.panicGain = Math.max(0, voice.panicGain - voice.panicStep);
        voice.age += 1;
        if (!voice.gate) {
          voice.releaseFrames -= 1;
          if (voice.releaseFrames <= 0) {
            const next = voice.pending;
            voice.active = false;
            if (next) {
              this.startVoice(voice, next.id, next.note, next.velocity);
              if (next.delayFrames) {
                for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
                  voice.onsets[partial] += next.delayFrames;
                }
              }
            }
          }
        }
      }
      // Per-sample envelope normalization cannot overshoot when voices start
      // or release. Sum of weights <=1, route gains <=1, envelopes <=1, so even
      // eight phase-aligned notes gathered into one speaker stay <=0.72.
      const gain = OUTPUT_CEILING * this.level / Math.max(1, envelopeSum);
      for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
        this.weights[partial] += (this.targetWeights[partial] - this.weights[partial]) * this.approach;
        const signal = this.partialSignals[partial] * this.weights[partial] * gain;
        this.partialEnergy[partial] = this.partialEnergy[partial] * energyDecay
          + Math.abs(signal) * (1 - energyDecay);
        for (let speaker = 0; speaker < SPARTIAL_MAX_SPEAKERS; speaker += 1) {
          const index = partial * SPARTIAL_MAX_SPEAKERS + speaker;
          this.routes[index] += this.routeSteps[index];
          if (speaker < outputCount) channels[speaker][frame] += signal * this.routes[index];
        }
      }
      this.frame += 1;
    }
  }

  snapshot() {
    return {
      phase: this.phase,
      voices: this.voices.filter((voice) => voice.active).length,
      positions: Array.from(this.positions.slice(0, this.settings.partials)),
      partialEnergy: Array.from(this.partialEnergy.slice(0, this.settings.partials)),
    };
  }
}
