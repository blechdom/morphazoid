import { QUADRUPED_LIMITS, QUADRUPED_PACE_RATIOS, QUADRUPED_STEP_COUNT } from "./quadruped.js";

/**
 * Contact-driven artistic voices, not recordings or animal/acoustic models.
 * Inspired by Morphazoid's Karplus Strong excitation/delay loop, FM Drums'
 * decaying modulation, Object Forge/Dentaphone's inharmonic modes, and Shapes'
 * prepared percussion buffers. No sibling engine or browser lifecycle is imported.
 *
 * The caller schedules one buffer for each actual touchdown/load/push/toe-off.
 * There is deliberately no free-running scratch oscillator or noise loop.
 */
const TAU = Math.PI * 2;
const MAX_VELOCITY = QUADRUPED_LIMITS.tempoBpm[1] * QUADRUPED_STEP_COUNT / 60 * Math.max(...QUADRUPED_PACE_RATIOS);
const clamp = (value, low, high, fallback = low) => {
  const number = Number(value);
  return Math.max(low, Math.min(high, Number.isFinite(number) ? number : fallback));
};

export const QUADRUPED_SOUND_SKINS = Object.freeze([
  Object.freeze({ id: "ground", label: "Ground", description: "Weight, earth and broken contact grains" }),
  Object.freeze({ id: "tendon", label: "Tendon", description: "Damped plucked strings and elastic tension" }),
  Object.freeze({ id: "porcelain", label: "Porcelain", description: "Struck inharmonic ceramic resonances" }),
  Object.freeze({ id: "voltage", label: "Voltage", description: "Bending FM percussion" }),
  Object.freeze({ id: "breath", label: "Breath", description: "Short hollow air and reed impulses" }),
]);
export const QUADRUPED_SOUND_LIMITS = Object.freeze({
  sampleRate: 24_000,
  maxDuration: 0.42,
  maxPeak: 0.34,
  maxCacheEntries: 256,
});
const SKIN_IDS = new Set(QUADRUPED_SOUND_SKINS.map(({ id }) => id));
const PHASES = Object.freeze({
  touchdown: Object.freeze({ duration: 1, level: 1, pitch: 1 }),
  load: Object.freeze({ duration: 0.48, level: 0.32, pitch: 0.66 }),
  push: Object.freeze({ duration: 0.38, level: 0.30, pitch: 1.15 }),
  "toe-off": Object.freeze({ duration: 0.25, level: 0.20, pitch: 1.55 }),
});

export function sanitizeQuadrupedSoundSkin(value) {
  return SKIN_IDS.has(value) ? value : "ground";
}

function hash(value) {
  let result = 2166136261;
  for (const char of String(value ?? 0)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function seededRandom(seed) {
  let state = hash(seed) || 1;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function requestView(options = {}) {
  const animal = options.animal ?? {};
  const terrain = options.terrain ?? {};
  const contact = options.contact ?? {};
  return {
    skinId: sanitizeQuadrupedSoundSkin(options.skinId),
    phase: Object.hasOwn(PHASES, options.phase) ? options.phase : "touchdown",
    sampleRate: Math.round(clamp(options.sampleRate, 8_000, 96_000, QUADRUPED_SOUND_LIMITS.sampleRate)),
    mass: clamp(animal.mass, 0.3, 2, 1),
    compliance: clamp(animal.compliance, 0.4, 1.6, 1),
    power: clamp(animal.power, 0.4, 1.8, 1),
    hardness: clamp(terrain.hardness, 0, 1, 0.54),
    damping: clamp(terrain.damping, 0, 1, 0.58),
    roughness: clamp(terrain.roughness, 0, 1, 0.62),
    brightness: clamp(terrain.brightness, 0, 1, 0.3),
    resonance: clamp(options.resonance, 0, 1, 0.55),
    scrape: clamp(options.scrape, 0, 1, 0.45),
    limbId: String(contact.id ?? contact.laneId ?? "front-left"),
    intensity: clamp(contact.intensity, 0, 1, 1),
    velocity: clamp(options.velocity, 0, MAX_VELOCITY, 24),
    pitchRatio: clamp(options.pitchRatio, 0.25, 4, 1),
    seed: options.seed ?? contact.eventId ?? 1,
  };
}

function motionGain(view) {
  const phaseGain = view.phase === "toe-off" ? 0.18 + view.scrape * 0.82
    : view.phase === "push" ? 0.45 + view.scrape * 0.55 : 1;
  return view.intensity * (0.62 + 0.38 * Math.sqrt(view.velocity / MAX_VELOCITY)) * phaseGain;
}

function motionPitch(view) {
  return view.pitchRatio * (0.94 + 0.12 * Math.sqrt(view.velocity / MAX_VELOCITY));
}

function bandpass(frequency, q, sampleRate) {
  const omega = TAU * clamp(frequency, 35, sampleRate * 0.38) / sampleRate;
  const alpha = Math.sin(omega) / (2 * q);
  const b0 = alpha / (1 + alpha), a1 = -2 * Math.cos(omega) / (1 + alpha);
  const a2 = (1 - alpha) / (1 + alpha);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return input => {
    const value = b0 * (input - x2) - a1 * y1 - a2 * y2;
    x2 = x1; x1 = input; y2 = y1; y1 = value;
    return value;
  };
}

// Irregular, separately windowed grains have silence between releases. A seeded
// event selects contact texture, so repeating a gait does not replay one buzz.
function contactGrains(view, frames, random) {
  const grains = new Float32Array(frames);
  const count = view.phase === "touchdown" ? 3 : 2 + Math.floor(view.roughness * 4);
  const color = 0.06 + view.brightness * 0.52 + view.hardness * 0.2;
  const activeFrames = Math.floor(frames * (view.phase === "load" ? 0.52 : 0.76));
  for (let grain = 0; grain < count; grain += 1) {
    const start = grain === 0 ? 0 : Math.floor(random() * activeFrames * 0.82);
    const length = Math.min(frames - start, Math.ceil(view.sampleRate * (0.0015 + random() ** 2 * 0.012)));
    const level = (0.4 + random() * 0.6) / Math.sqrt(count);
    let low = 0;
    for (let index = 0; index < length; index += 1) {
      low += ((random() * 2 - 1) - low) * color;
      const envelope = Math.sin(Math.PI * index / Math.max(1, length - 1));
      grains[start + index] += low * envelope * envelope * level;
    }
  }
  return grains;
}

function renderUnit(view) {
  const phase = PHASES[view.phase];
  const random = seededRandom(`${view.seed}:${view.limbId}:${view.phase}`);
  const fore = view.limbId.startsWith("front") ? 1.17 : 0.86;
  const side = view.limbId.endsWith("right") ? 1.067 : 0.981;
  const bodyPitch = (108 / Math.sqrt(view.mass * view.compliance)) * fore * side;
  const roots = { ground: 0.86, tendon: 2.15, porcelain: 3.45, voltage: 1.28, breath: 1.65 };
  const frequency = clamp(bodyPitch * roots[view.skinId] * phase.pitch * (0.84 + view.hardness * 0.35), 30, view.sampleRate * 0.08);
  const lengths = { ground: 0.21, tendon: 0.30, porcelain: 0.38, voltage: 0.22, breath: 0.17 };
  const duration = clamp(lengths[view.skinId] * phase.duration * (0.64 + view.resonance * 0.6) * (1.1 - view.damping * 0.35), 0.025, QUADRUPED_SOUND_LIMITS.maxDuration);
  const frames = Math.ceil(duration * view.sampleRate);
  const samples = new Float32Array(frames);
  const grains = contactGrains(view, frames, random);
  const attackFrames = Math.max(8, Math.round(view.sampleRate * (view.phase === "load" ? 0.004 : 0.0015)));
  const releaseFrames = Math.min(Math.floor(frames / 4), Math.ceil(view.sampleRate * 0.008));
  const decayStep = Math.exp(-5.2 / frames);
  let envelope = 1;
  let oscillatorPhase = 0, bend = 1;
  const bendDecay = Math.exp(-1 / (view.sampleRate * 0.013));
  const step = TAU * frequency / view.sampleRate;
  let readString = null;
  if (view.skinId === "tendon") {
    const period = view.sampleRate / frequency;
    const ring = new Float32Array(Math.ceil(period) + 2);
    let write = 0, previous = 0;
    for (let index = 0; index < ring.length; index += 1) {
      ring[index] = (random() * 2 - 1) * Math.sin(Math.PI * index / ring.length);
    }
    const feedback = Math.exp(-4.4 * period / frames);
    const damping = 0.13 + view.damping * 0.61;
    readString = () => {
      const read = (write - period + ring.length) % ring.length;
      const left = Math.floor(read), fraction = read - left;
      const value = ring[left] * (1 - fraction) + ring[(left + 1) % ring.length] * fraction;
      ring[write] = (value * (1 - damping) + previous * damping) * feedback;
      previous = value; write = (write + 1) % ring.length;
      return value;
    };
  }
  const modes = view.skinId === "porcelain" ? [1, 2.713, 4.087, 6.431].map((ratio, index) => {
    const omega = TAU * Math.min(view.sampleRate * 0.4, frequency * ratio) / view.sampleRate;
    const loss = Math.exp(-(3.8 + index * (0.6 + view.damping)) / frames);
    return { a: 2 * Math.cos(omega) * loss, b: loss * loss, y1: Math.sin(omega), y2: 0,
      gain: (1 / (1 + index * 0.7)) * (index === 0 ? 1 : 0.3 + view.hardness * 0.7) };
  }) : [];
  const throat = bandpass(frequency * 2.7, 2.5, view.sampleRate);
  const air = bandpass(920 + view.brightness * 2800, 1.3, view.sampleRate);
  let lowNoise = 0;
  for (let index = 0; index < frames; index += 1) {
    let value = 0;
    const attack = Math.min(1, index / attackFrames);
    const release = Math.min(1, (frames - 1 - index) / Math.max(1, releaseFrames));
    if (view.skinId === "ground") {
      oscillatorPhase += step * (1 + bend * 0.45);
      lowNoise += ((random() * 2 - 1) - lowNoise) * (0.06 + view.hardness * 0.07);
      value = (Math.sin(oscillatorPhase) * 0.72 + lowNoise * 0.2) * envelope
        + grains[index] * (0.7 + view.roughness * 1.8) * (view.phase === "touchdown" ? 1 : view.scrape);
    } else if (view.skinId === "tendon") {
      value = readString() * (0.85 + 0.15 * envelope) + grains[index] * 0.1;
    } else if (view.skinId === "porcelain") {
      for (const mode of modes) {
        const next = mode.a * mode.y1 - mode.b * mode.y2;
        value += next * mode.gain;
        mode.y2 = mode.y1; mode.y1 = next;
      }
      value = value * 0.24 + grains[index] * 0.12;
    } else if (view.skinId === "voltage") {
      oscillatorPhase += step * (1 + bend * (1.6 + view.power * 0.75));
      const modulation = Math.sin(index * step * (1.39 + view.hardness * 1.47));
      const indexEnvelope = (1.5 + view.hardness * 4.5) * envelope * envelope;
      value = Math.sin(oscillatorPhase + modulation * indexEnvelope) * envelope + grains[index] * 0.13;
    } else {
      oscillatorPhase += step * (1 + bend * 0.08);
      const noise = random() * 2 - 1;
      // Air is excited only by the short contact envelope; neither formant loops.
      const pressure = envelope * (0.7 + 0.3 * Math.sin(index * step * 0.31));
      value = (throat(noise + Math.sin(oscillatorPhase) * 0.28) * 1.7
        + air(noise) * (0.25 + view.brightness * 0.6)) * pressure;
    }
    samples[index] = value * attack * release;
    envelope *= decayStep;
    bend *= bendDecay;
  }
  // Level-match before velocity/intensity gain. A gentle bounded peak curve
  // keeps the high-crest air/string excitations from becoming much quieter than
  // modal or FM contacts. It acts within each event, never pumps between steps.
  let energy = 0;
  for (const value of samples) energy += value * value;
  const rms = Math.sqrt(energy / frames);
  const normalization = 0.086 / Math.max(rms, 1e-9);
  for (let index = 0; index < frames; index += 1) {
    samples[index] = QUADRUPED_SOUND_LIMITS.maxPeak
      * Math.tanh(samples[index] * normalization / QUADRUPED_SOUND_LIMITS.maxPeak) * phase.level;
  }
  return Object.freeze({ samples, sampleRate: view.sampleRate, duration: frames / view.sampleRate,
    frequency, skinId: view.skinId, phase: view.phase });
}

/** Pure, deterministic render for offline analysis or a one-off contact. */
export function renderQuadrupedContact(options = {}) {
  const view = requestView(options);
  const result = renderUnit(view);
  const gain = motionGain(view);
  for (let index = 0; index < result.samples.length; index += 1) result.samples[index] *= gain;
  return { ...result, gain: 1, playbackRate: motionPitch(view) };
}

/** Bounded prepared-buffer cache. Treat returned samples as read-only. A browser
 * can cache AudioBuffers by sample-array identity in a WeakMap. Output gain and
 * playbackRate stay continuous when velocity, intensity or world pitch moves;
 * no synthesis or copying occurs on a warm get(). clear() releases every entry.
 */
export function createQuadrupedSoundBank({ sampleRate = QUADRUPED_SOUND_LIMITS.sampleRate, maxEntries = QUADRUPED_SOUND_LIMITS.maxCacheEntries } = {}) {
  const entries = new Map();
  const limit = Math.floor(clamp(maxEntries, 1, QUADRUPED_SOUND_LIMITS.maxCacheEntries, QUADRUPED_SOUND_LIMITS.maxCacheEntries));
  return {
    get size() { return entries.size; },
    clear() { entries.clear(); },
    get(options = {}) {
      const view = requestView({ ...options, sampleRate });
      const variant = hash(view.seed) % 4;
      const key = [view.skinId, view.phase, view.limbId, view.mass, view.compliance, view.power,
        view.hardness, view.damping, view.roughness, view.brightness, view.resonance, view.scrape, variant].join(":");
      let result = entries.get(key);
      if (result) entries.delete(key);
      else result = renderUnit({ ...view, seed: variant });
      entries.set(key, result);
      if (entries.size > limit) entries.delete(entries.keys().next().value);
      return { ...result, gain: motionGain(view), playbackRate: motionPitch(view) };
    },
  };
}

/** Mix a scheduler window before allocating Web Audio nodes. Dense trios keep
 * every contact and stereo position without reserving hundreds of future voices.
 * The caller supplies finite prepared voices, offsets in seconds, gain and pan.
 */
export function mixQuadrupedContacts(events, sampleRate = QUADRUPED_SOUND_LIMITS.sampleRate, resampleCache = null) {
  if (!events.length) return null;
  const duration = Math.max(...events.map(event => event.offset + event.voice.duration / event.voice.playbackRate));
  const channels = [new Float32Array(Math.ceil(duration * sampleRate) + 1), new Float32Array(Math.ceil(duration * sampleRate) + 1)];
  for (const { voice, offset, gain, pan } of events) {
    const start = Math.round(offset * sampleRate);
    const increment = voice.playbackRate * voice.sampleRate / sampleRate;
    let samples = voice.samples;
    if (increment !== 1) {
      let variants = resampleCache?.get(voice.samples);
      samples = variants?.get(increment);
      if (!samples) {
        samples = new Float32Array(Math.ceil(voice.samples.length / increment));
        for (let frame = 0; frame < samples.length; frame += 1) {
          const position = frame * increment;
          const index = Math.floor(position);
          const fraction = position - index;
          samples[frame] = (voice.samples[index] ?? 0) * (1 - fraction) + (voice.samples[index + 1] ?? 0) * fraction;
        }
        if (resampleCache) {
          if (!variants) { variants = new Map(); resampleCache.set(voice.samples, variants); }
          variants.set(increment, samples);
          if (variants.size > 4) variants.delete(variants.keys().next().value);
        }
      }
    }
    const angle = (clamp(pan, -1, 1, 0) + 1) * Math.PI / 4;
    const leftGain = Math.cos(angle) * gain;
    const rightGain = Math.sin(angle) * gain;
    const [left, right] = channels;
    const frames = Math.min(samples.length, left.length - start);
    for (let frame = 0; frame < frames; frame += 1) {
      left[start + frame] += samples[frame] * leftGain;
      right[start + frame] += samples[frame] * rightGain;
    }
  }
  return { channels, duration: channels[0].length / sampleRate, sampleRate };
}
