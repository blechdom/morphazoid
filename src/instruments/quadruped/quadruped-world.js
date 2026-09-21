import { applyQuadrupedBehavior, createQuadrupedState, quadrupedGroundProfile, quadrupedTerrain, sanitizeQuadrupedState } from "./quadruped.js";

const clamp = (value, low, high, fallback = low) => Math.min(high, Math.max(low, Number.isFinite(Number(value)) ? Number(value) : fallback));
export const QUADRUPED_GROUP_MODES = Object.freeze(["solo", "herd", "trio"]);
export const QUADRUPED_SHARED_FIELDS = Object.freeze(["tempoBpm", "paceRatio", "stride", "surfaceId", "groundProfileId", "groundResonance", "outputLevel"]);
export const QUADRUPED_WORLD_DEFAULTS = Object.freeze({ version: 1, seed: 0x71756164, grain: 0.68, cavern: 0.75 });

export function sanitizeQuadrupedWorld(value = {}) {
  return Object.freeze({ version: 1, seed: (Number(value.seed) >>> 0) || QUADRUPED_WORLD_DEFAULTS.seed, grain: clamp(value.grain, 0, 1, 0.68), cavern: clamp(value.cavern, 0, 1, 0.75) });
}

export function quadrupedRandom(seed) {
  let cursor = (Number(seed) >>> 0) || 1;
  return () => {
    cursor = (Math.imul(cursor, 1664525) + 1013904223) >>> 0;
    return cursor / 0x1_0000_0000;
  };
}

export function quadrupedGroupOffsets(seed = 1) {
  const random = quadrupedRandom(seed);
  return Object.freeze([0, 0.18 + random() * 0.21, 0.58 + random() * 0.25]);
}

export function shareQuadrupedWorld(score, leader) {
  return sanitizeQuadrupedState({ ...score, ...Object.fromEntries(QUADRUPED_SHARED_FIELDS.map(key => [key, leader[key]])) }, score);
}

export function createQuadrupedGroup(leader, mode = "solo") {
  const safe = sanitizeQuadrupedState(leader);
  if (mode === "solo") return [safe];
  if (mode === "herd") {
    return [safe, applyQuadrupedBehavior(safe, "mosey"), applyQuadrupedBehavior(safe, "trot")].map(score => shareQuadrupedWorld(score, safe));
  }
  return [safe, createQuadrupedState("cat", "wander"), createQuadrupedState("gazelle", "trot")].map(score => shareQuadrupedWorld(score, safe));
}

// A composed descent/ascent color, not a claim that elevation alone defines
// room acoustics. Each tread has a distinct register before a smooth bound.
export function quadrupedStairSound(score, worldX = 0, amount = 0.75, originX = 0) {
  const profile = quadrupedGroundProfile(score?.groundProfileId);
  const strength = clamp(amount, 0, 1, 0.75);
  const tread = profile.direction ? Math.floor(clamp(worldX, -1e9, 1e9) / profile.treadLength) - Math.floor(clamp(originX, -1e9, 1e9) / profile.treadLength) : 0;
  const level = tread * profile.direction;
  const signed = Math.tanh(level / 22);
  const depth = Math.max(0, -signed) * strength;
  const semitones = signed * 18 * strength;
  return Object.freeze({
    tread, level, depth, semitones, pitchRatio: 2 ** (semitones / 12),
    cutoff: clamp(12_000 * 2 ** (signed * 3.3 * strength), 600, 18_000),
    wet: profile.direction ? 0.015 + 0.34 * depth : 0,
    feedback: 0.18 + depth * 0.52, delay: 0.09 + depth * 0.26,
    damping: 7_500 * 2 ** (-depth * 3.2),
  });
}

const FRICTION = Object.freeze({
  earth: [178, 43, 0.012, 0.17], sand: [740, 126, 0.003, 0.34],
  wood: [290, 31, 0.045, 0.06], stone: [510, 58, 0.022, 0.12],
  metal: [980, 19, 0.09, 0.035], snow: [220, 74, 0.006, 0.2],
  water: [390, 14, 0.06, 0.08], crystal: [1420, 23, 0.075, 0.025],
});

// Irregular micro-impacts excite two damped modes. Broadband grit is secondary,
// with a seedable catch/release envelope instead of a steady white-noise bed.
export function renderQuadrupedFriction({ sampleRate = 48_000, seconds = 4.3, surfaceId = "earth", seed = 1, grain = 0.68 } = {}) {
  const rate = clamp(sampleRate, 8_000, 96_000, 48_000);
  const length = Math.ceil(rate * clamp(seconds, 0.05, 5, 4.3));
  const variation = clamp(grain, 0, 1, 0.68);
  const [frequency, density, decay, noiseMix] = FRICTION[surfaceId] ?? FRICTION.earth;
  const terrain = quadrupedTerrain(surfaceId);
  const random = quadrupedRandom(seed);
  const samples = new Float32Array(length);
  const modes = [1, 2.71].map((ratio, index) => {
    const radius = Math.exp(-1 / (rate * decay * (index ? 0.58 : 1)));
    return { a: 2 * radius * Math.cos(2 * Math.PI * Math.min(rate * 0.42, frequency * ratio) / rate), b: radius * radius, y1: 0, y2: 0 };
  });
  let nextGrain = 0, catchLevel = 0.7, envelope = 0, colored = 0;
  const envelopeDecay = Math.exp(-1 / (rate * (0.006 + terrain.roughness * 0.018)));
  for (let index = 0; index < length; index += 1) {
    let impulse = 0;
    if (index >= nextGrain) {
      catchLevel = 0.2 + random() * 0.8;
      const interval = (1 - variation) + variation * (0.16 + random() ** 2 * 3.4);
      nextGrain = index + Math.max(12, rate / density * interval);
      impulse = (0.2 + catchLevel * 0.8) * (random() < 0.5 ? -1 : 1);
      envelope = Math.min(1, envelope + catchLevel);
    }
    const white = random() * 2 - 1;
    colored += (white - colored) * (0.09 + terrain.brightness * 0.35);
    envelope *= envelopeDecay;
    let resonance = 0;
    for (let modeIndex = 0; modeIndex < modes.length; modeIndex += 1) {
      const mode = modes[modeIndex];
      const y = impulse * 0.028 + mode.a * mode.y1 - mode.b * mode.y2;
      mode.y2 = mode.y1; mode.y1 = y;
      resonance += y * (modeIndex ? 0.42 : 0.8);
    }
    const sweep = 0.5 + 0.5 * Math.sin(index / rate * Math.PI * (1.1 + variation * 2.6));
    const catchEnvelope = 0.38 + (1 - variation) * 0.4 + variation * sweep * catchLevel;
    const fade = Math.min(1, index / (rate * 0.012), (length - 1 - index) / (rate * 0.012));
    samples[index] = Math.tanh((resonance + colored * noiseMix * envelope) * 2.3) * catchEnvelope * fade;
  }
  return samples;
}
