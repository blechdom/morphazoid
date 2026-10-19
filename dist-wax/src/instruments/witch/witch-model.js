/** Pure gesture and fictional vocal controls. Frequencies are synthesis choices,
 * not measurements of a human voice. No pitch scale or note quantizer is used. */
export const WITCH_TAU = Math.PI * 2;
export const WITCH_VOICES = Object.freeze(['mutter', 'whisper', 'creak', 'cackle', 'sing']);
export const WITCH_VOCAL_EFFECTS = Object.freeze(['cackle', 'moan', 'howl', 'ghost', 'bat']);
export const WITCH_FLIGHT_EFFECTS = Object.freeze(['moon', 'bat', 'ghost', 'spark', 'gust', 'launch']);
export const WITCH_LAUNCH_DURATION = 1.86;
export const WITCH_FINGER_SOURCES = Object.freeze(['glass', 'reed', 'wire', 'metal', 'marimba']);
export const WITCH_EFFECTS = Object.freeze([...new Set([...WITCH_VOCAL_EFFECTS, ...WITCH_FLIGHT_EFFECTS])]);
export const WITCH_DEFAULTS = Object.freeze({
  speed: 0, radius: .5, direction: 1, gate: false, mode: 'brew', voice: 'mutter',
  fingers: Object.freeze([.5, .5, .5, .5, .5]), fingerMask: 0, altitude: .5, flightX: .5, tone: .5, glass: 0, hair: 0, volume: .6,
});
export const witchClamp = (value, min = 0, max = 1, fallback = min) => (
  Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback))
);

export function normalizeWitchControls(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const result = {};
  for (const name of ['speed', 'radius', 'altitude', 'flightX', 'tone', 'glass', 'hair', 'volume']) {
    result[name] = witchClamp(input[name], 0, 1, WITCH_DEFAULTS[name]);
  }
  result.direction = Number(input.direction) < 0 ? -1 : 1;
  result.gate = input.gate === true;
  result.mode = ['brew', 'fingers', 'flight'].includes(input.mode) ? input.mode : 'brew';
  result.voice = WITCH_VOICES.includes(input.voice) ? input.voice : 'mutter';
  result.fingers = Array.from({ length: 5 }, (_, i) => witchClamp(input.fingers?.[i], 0, 1, .5));
  result.fingerMask = Math.round(witchClamp(input.fingerMask, 0, 31));
  return result;
}

export function createStirState() {
  return { angle: 0, time: null, radius: .5, speed: 0, velocity: 0, direction: 1, gate: false, phase: 0 };
}

/** Angles are radians, radius is 0..1, and monotonic input time is seconds. */
export function updateStir(state, { angle, radius, time } = {}) {
  const next = { ...state, gate: true };
  const a = witchClamp(angle, -1e9, 1e9, next.angle);
  const t = witchClamp(time, 0, 1e12, next.time ?? 0);
  next.radius = witchClamp(radius, 0, 1, next.radius);
  if (next.time !== null && t > next.time) {
    const dt = Math.max(.004, t - next.time);
    const delta = Math.atan2(Math.sin(a - next.angle), Math.cos(a - next.angle));
    const velocity = witchClamp(delta / dt, -18, 18);
    const blend = 1 - Math.exp(-dt / .045);
    // A real reversal changes direction immediately; smoothing its magnitude
    // avoids an old clockwise velocity hiding a counterclockwise gesture.
    if (Math.abs(velocity) > .03) next.direction = Math.sign(velocity);
    next.velocity += (Math.abs(velocity) - next.velocity) * blend;
    next.speed = witchClamp(next.velocity / 12);
    next.phase = ((next.phase + delta) % WITCH_TAU + WITCH_TAU) % WITCH_TAU;
  }
  next.angle = a; next.time = t;
  return next;
}

export function releaseStir(state) { return { ...state, gate: false, time: null }; }

/** Exact exponential coast gives the same result at different display rates. */
export function advanceStir(state, seconds) {
  const dt = witchClamp(seconds, 0, 60);
  const next = { ...state };
  const decay = next.gate ? 1 : Math.exp(-dt / 1.3);
  const distance = next.gate ? next.velocity * dt : next.velocity * 1.3 * (1 - decay);
  next.phase = ((next.phase + next.direction * distance) % WITCH_TAU + WITCH_TAU) % WITCH_TAU;
  next.velocity *= decay; next.speed = witchClamp(next.velocity / 12);
  return next;
}

// Eight intentionally asymmetric vowel/pitch destinations make reversal
// observable. The source traverses them continuously, never as a tuned scale.
export const WITCH_SYLLABLES = Object.freeze([
  [310, 2230, 2900, .32, .92], [540, 1710, 2600, .67, 1.09],
  [790, 1140, 2460, .94, .97], [430, 850, 2280, .46, .84],
  [290, 690, 2170, .24, 1.16], [650, 1550, 2730, .78, 1.04],
  [810, 1460, 2830, .9, .95], [380, 1950, 3080, .43, 1.12],
].map(Object.freeze));

/** phase is measured in syllables. Negative direction traverses the same
 * continuous vowel path backward. An optional output object avoids DSP garbage. */
export function sampleChant(phase, direction = 1, radius = .5, out = {}) {
  const p = ((witchClamp(phase, -1e12, 1e12) * (direction < 0 ? -1 : 1)) % 8 + 8) % 8;
  const index = Math.floor(p), fraction = p - index;
  const blend = fraction * fraction * (3 - 2 * fraction);
  const a = WITCH_SYLLABLES[index], b = WITCH_SYLLABLES[(index + 1) % 8];
  const opening = witchClamp(radius, 0, 1, .5);
  out.index = index; out.fraction = fraction;
  out.f1 = (a[0] + (b[0] - a[0]) * blend) * (.65 + opening * .75);
  out.f2 = (a[1] + (b[1] - a[1]) * blend) * (1.13 - opening * .2);
  out.f3 = a[2] + (b[2] - a[2]) * blend;
  out.mouth = (a[3] + (b[3] - a[3]) * blend) * (.28 + opening * .72);
  out.pitch = a[4] + (b[4] - a[4]) * blend;
  out.articulation = .22 + .78 * Math.sin(Math.PI * fraction) ** 2;
  return out;
}
