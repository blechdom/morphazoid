import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const LUMBER_RING_SLOTS = 5;
export const LUMBER_DELAY_POINTS = 12;
const LENGTH_RATIOS = Object.freeze([0.25, 0.5, 1, 2]);
const RING_OFFSET_RANGE = Object.freeze([-0.42, 0.62]);
const DELAY_OFFSET_RANGE = Object.freeze([-0.34, 0.34]);

const clamp = (value, low, high, fallback = low) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
};
const round = (value, digits = 3) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
const sign = value => (Number(value) < 0 ? -1 : 1);

export function defaultLumberRing(slot = 0) {
  return {
    direction: 1, volume: 1, pan: 0, filterTone: 0.86, filterResonance: 0, depth: round(slot * 0.22, 2),
    shapePitchDepth: 0.65, radialOffsets: Array(12).fill(0), timingMode: "free", lengthRatio: 1,
    headCount: 1, headOffsets: [0],
  };
}

export function defaultLumberDelay() {
  return { enabled: false, radialOffsets: Array(LUMBER_DELAY_POINTS).fill(0), rotationPlaying: false, rotationSpeed: 0.08, spread: 0.65 };
}

export function defaultLumberDepth() {
  return { view3d: false, reverbEnabled: false, reverbDirection: 1, fuzzEnabled: false, fuzzDirection: 1, fuzzLevel: 0.2 };
}

export function normalizeHeadOffsets(offsets, count) {
  const stored = Array.isArray(offsets) ? offsets : [];
  return Array.from({ length: count }, (_, index) => (
    index === 0 ? 0 : clamp(stored[index] ?? index / count, 0.02, 0.98)
  ));
}

function sanitizeRing(ring, slot) {
  const source = ring && typeof ring === "object" ? ring : {};
  const base = defaultLumberRing(slot);
  const offsets = Array.isArray(source.radialOffsets) ? source.radialOffsets : base.radialOffsets;
  const headCount = Math.round(clamp(source.headCount, 1, 4, 1));
  const ratio = Number(source.lengthRatio);
  return {
    direction: sign(source.direction),
    volume: clamp(source.volume, 0, 1.25, base.volume),
    pan: clamp(source.pan, -1, 1, 0),
    filterTone: clamp(source.filterTone, 0, 1, base.filterTone),
    filterResonance: clamp(source.filterResonance, 0, 12, 0),
    depth: clamp(source.depth, -1, 1, base.depth),
    shapePitchDepth: clamp(source.shapePitchDepth, 0.1, 1, base.shapePitchDepth),
    radialOffsets: offsets.slice(0, 64).map(value => clamp(value, ...RING_OFFSET_RANGE, 0))
      .concat(Array(Math.max(0, 3 - offsets.length)).fill(0)),
    timingMode: slot > 0 && source.timingMode === "sync" ? "sync" : "free",
    lengthRatio: LENGTH_RATIOS.includes(ratio) ? ratio : 1,
    headCount,
    headOffsets: normalizeHeadOffsets(source.headOffsets, headCount),
  };
}

function sanitizeDelay(delay) {
  const source = delay && typeof delay === "object" ? delay : {};
  const enabled = source.enabled === true;
  const offsets = Array.isArray(source.radialOffsets) ? source.radialOffsets : [];
  return {
    enabled,
    radialOffsets: Array.from({ length: LUMBER_DELAY_POINTS }, (_, index) => clamp(offsets[index], ...DELAY_OFFSET_RANGE, 0)),
    rotationPlaying: enabled && source.rotationPlaying === true,
    rotationSpeed: clamp(source.rotationSpeed, -0.5, 0.5, 0.08),
    spread: clamp(source.spread, 0, 1, 0.65),
  };
}

function sanitizeDepth(depth) {
  const source = depth && typeof depth === "object" ? depth : {};
  return {
    view3d: source.view3d === true,
    reverbEnabled: source.reverbEnabled === true,
    reverbDirection: sign(source.reverbDirection),
    fuzzEnabled: source.fuzzEnabled === true,
    fuzzDirection: sign(source.fuzzDirection),
    fuzzLevel: clamp(source.fuzzLevel, 0, 1, 0.2),
  };
}

export function captureLumberPreset(raw) {
  const rings = Array.isArray(raw?.rings) ? raw.rings : [];
  return {
    rings: Array.from({ length: LUMBER_RING_SLOTS }, (_, slot) => sanitizeRing(rings[slot], slot)),
    delay: sanitizeDelay(raw?.delay),
    depth: sanitizeDepth(raw?.depth),
  };
}

export function validateLumberPreset(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.rings) || snapshot.rings.length !== LUMBER_RING_SLOTS
    || presetStateKey(snapshot) !== presetStateKey(captureLumberPreset(snapshot))) {
    throw new TypeError("Invalid complete Lumber Loops preset");
  }
  return snapshot;
}

const lobes = (count, amplitude, points = 12, phase = 0) => Array.from({ length: points }, (_, index) => (
  round(amplitude * Math.sin(Math.PI * 2 * count * index / points + phase))
));
const spikes = (amplitude, every = 3, points = 12) => Array.from({ length: points }, (_, index) => (
  index % every === 0 ? amplitude : -amplitude * 0.25
));
const saw = (amplitude, points = 12) => Array.from({ length: points }, (_, index) => round(amplitude * (index / (points - 1) * 2 - 1)));
const delayLobes = (count, amplitude, phase = 0) => lobes(count, amplitude, LUMBER_DELAY_POINTS, phase);
const spread = (value = 0.3, slots = LUMBER_RING_SLOTS) => Array.from({ length: slots }, (_, index) => round((index - (slots - 1) / 2) * value, 2));

const ringsFrom = per => Array.from({ length: LUMBER_RING_SLOTS }, (_, slot) => {
  const entry = typeof per === "function" ? per(slot) : per[slot] ?? {};
  return { ...defaultLumberRing(slot), ...entry };
});

const scene = (id, label, { rings = {}, delay = {}, depth = {} } = {}) => {
  const snapshot = captureLumberPreset({
    rings: ringsFrom(rings),
    delay: { ...defaultLumberDelay(), ...delay },
    depth: { ...defaultLumberDepth(), ...depth },
  });
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const LUMBER_FULL_PRESETS = Object.freeze([
  scene("open-rings", "Open rings"),
  scene("warped-vinyl", "Warped vinyl", {
    rings: slot => ({ radialOffsets: lobes(3, 0.34, 12, slot), shapePitchDepth: 0.9, filterTone: 0.7 - slot * 0.04, depth: 0 }),
  }),
  scene("cathedral-wash", "Cathedral wash", {
    rings: slot => ({ depth: spread(0.4)[slot], filterTone: 0.6, volume: 0.85, pan: spread(0.3)[slot], radialOffsets: lobes(1, 0.12, 12, slot) }),
    delay: { enabled: true, radialOffsets: delayLobes(2, 0.22), rotationPlaying: true, rotationSpeed: 0.05, spread: 0.8 },
    depth: { view3d: true, reverbEnabled: true, reverbDirection: 1 },
  }),
  scene("fuzz-furnace", "Fuzz furnace", {
    rings: slot => ({ depth: spread(0.45)[slot], filterTone: 0.9, filterResonance: 6, radialOffsets: saw(0.2), shapePitchDepth: 0.75, volume: 0.9 }),
    depth: { view3d: true, fuzzEnabled: true, fuzzDirection: -1, fuzzLevel: 0.9 },
  }),
  scene("tape-canon", "Tape canon", {
    rings: slot => ({
      timingMode: slot > 0 ? "sync" : "free", lengthRatio: [1, 0.5, 2, 0.25, 1][slot], headCount: 2,
      headOffsets: [0, 0.5], pan: spread(0.4)[slot], volume: 0.9, filterTone: 0.8,
    }),
    delay: { enabled: true, radialOffsets: delayLobes(1, 0.18), spread: 0.9 },
  }),
  scene("four-heads", "Four heads", {
    rings: slot => ({ headCount: 4, headOffsets: [0, 0.25 + slot * 0.01, 0.5, 0.75], volume: 0.75, filterTone: 0.75, radialOffsets: lobes(2, 0.1) }),
  }),
  scene("reverse-tide", "Reverse tide", {
    rings: slot => ({ direction: -1, filterTone: 0.35, filterResonance: 3, radialOffsets: lobes(2, 0.25, 12, slot * 0.5), lengthRatio: slot % 2 ? 0.5 : 1, depth: 0 }),
    delay: { enabled: true, radialOffsets: delayLobes(1, -0.25), rotationSpeed: -0.12, spread: 0.5 },
  }),
  scene("split-stereo", "Split stereo", {
    rings: slot => ({ pan: [-0.9, 0.9, -0.45, 0.45, 0][slot], lengthRatio: [1, 2, 0.5, 1, 2][slot], radialOffsets: spikes(0.3, 3 + (slot % 2)), volume: 0.95 }),
  }),
  scene("glass-pinch", "Glass pinch", {
    rings: slot => ({ shapePitchDepth: 1, radialOffsets: spikes(0.5, 4), filterTone: 1, filterResonance: 9, headCount: 3, headOffsets: [0, 0.33, 0.66], volume: 0.7, direction: slot % 2 ? -1 : 1 }),
  }),
  scene("dub-room", "Dub room", {
    rings: slot => ({ depth: spread(0.35)[slot], filterTone: 0.45, filterResonance: 2, volume: 0.9, radialOffsets: lobes(1, 0.15) }),
    delay: { enabled: true, radialOffsets: delayLobes(3, 0.34), rotationPlaying: true, rotationSpeed: -0.3, spread: 1 },
    depth: { view3d: true, reverbEnabled: true, reverbDirection: -1 },
  }),
  scene("slow-orbit", "Slow orbit", {
    rings: slot => ({ lengthRatio: slot === 0 ? 2 : 1, timingMode: slot > 0 ? "sync" : "free", direction: slot % 2 ? -1 : 1, radialOffsets: lobes(1, 0.2, 12, slot * 1.2), pan: spread(0.2)[slot] }),
    delay: { enabled: true, radialOffsets: delayLobes(2, 0.2, 1), rotationPlaying: true, rotationSpeed: 0.5, spread: 0.7 },
  }),
  scene("bright-flutter", "Bright flutter", {
    rings: slot => ({ radialOffsets: lobes(8, 0.15, 24, slot), shapePitchDepth: 0.8, filterTone: 0.95, pan: spread(0.15)[slot], headCount: 2, headOffsets: [0, 0.5] }),
  }),
  scene("nocturne", "Nocturne", {
    rings: slot => ({ depth: -Math.abs(spread(0.3)[slot]), filterTone: 0.3, volume: 0.8, direction: slot % 2 ? -1 : 1, radialOffsets: lobes(1, 0.4, 12, slot * 0.7), shapePitchDepth: 0.5 }),
    delay: { enabled: true, radialOffsets: delayLobes(1, -0.3), spread: 0.4 },
    depth: { view3d: true, reverbEnabled: true, reverbDirection: 1 },
  }),
]);

function randomContour(rng) {
  const points = rng.pick([6, 8, 12, 16, 24]);
  const amplitude = rng.between(0.05, 0.45);
  const lobeCount = rng.integer(1, 5), phase = rng.between(0, Math.PI * 2), jitter = rng.between(0, 0.15);
  return Array.from({ length: points }, (_, index) => round(clamp(
    amplitude * Math.sin(Math.PI * 2 * lobeCount * index / points + phase) + rng.between(-jitter, jitter),
    -0.38, 0.55,
  )));
}

export function randomizeLumberPreset(current, random = Math.random) {
  validateLumberPreset(current);
  const rng = presetRandom(random);
  const rings = Array.from({ length: LUMBER_RING_SLOTS }, (_, slot) => {
    const headCount = rng.integer(1, 4);
    return {
      direction: rng.unit() < 0.5 ? -1 : 1,
      volume: round(rng.between(0.4, 1.15), 2),
      pan: round(rng.between(-1, 1), 2),
      filterTone: round(rng.between(0.2, 1), 2),
      filterResonance: round(rng.between(0, 8), 1),
      depth: round(rng.between(-1, 1), 2),
      shapePitchDepth: round(rng.between(0.2, 1), 2),
      radialOffsets: randomContour(rng),
      timingMode: slot > 0 && rng.unit() < 0.5 ? "sync" : "free",
      lengthRatio: rng.pick(LENGTH_RATIOS),
      headCount,
      headOffsets: [0, ...Array.from({ length: headCount - 1 }, () => round(rng.between(0.05, 0.95), 2))],
    };
  });
  const enabled = rng.unit() < 0.6;
  const delay = {
    enabled,
    radialOffsets: Array.from({ length: LUMBER_DELAY_POINTS }, () => round(rng.between(...DELAY_OFFSET_RANGE), 2)),
    rotationPlaying: enabled && rng.unit() < 0.5,
    rotationSpeed: round(rng.between(-0.5, 0.5), 2),
    spread: round(rng.between(0, 1), 2),
  };
  const view3d = rng.unit() < 0.6;
  const depth = {
    view3d,
    reverbEnabled: view3d && rng.unit() < 0.6,
    reverbDirection: rng.unit() < 0.5 ? -1 : 1,
    fuzzEnabled: view3d && rng.unit() < 0.5,
    fuzzDirection: rng.unit() < 0.5 ? -1 : 1,
    fuzzLevel: round(rng.between(0.05, 0.9), 2),
  };
  return validateLumberPreset(captureLumberPreset({ rings, delay, depth }));
}
