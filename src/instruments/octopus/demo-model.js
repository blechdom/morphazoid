const TAU = Math.PI * 2;
const bounded = (value, min, max, fallback) => Math.min(max,
  Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));

export const OCTOPUS_SKINS = Object.freeze(['reef', 'abyss', 'pearl', 'kelp']);
export const OCTOPUS_DEFAULTS = Object.freeze({
  grip: 0.16, current: 0, pulseRate: 0.55, selected: 0,
  skin: 'reef', wetness: 0.46,
  lengths: Object.freeze([1.18, 1.05, 1.29, 1.11, 1.25, 1.08, 1.14, 1.22]),
  curls: Object.freeze([0.23, -0.12, 0.11, -0.18, 0.16, -0.09, 0.18, -0.15]),
});

export function octopusSettings(values = {}) {
  return {
    grip: bounded(values.grip, 0, 1, OCTOPUS_DEFAULTS.grip),
    current: bounded(values.current, -1, 1, 0),
    pulseRate: bounded(values.pulseRate, 0.12, 1.8, OCTOPUS_DEFAULTS.pulseRate),
    selected: Math.round(bounded(values.selected, 0, 7, OCTOPUS_DEFAULTS.selected)),
    skin: OCTOPUS_SKINS.includes(values.skin) ? values.skin : OCTOPUS_DEFAULTS.skin,
    wetness: bounded(values.wetness, 0, 1, OCTOPUS_DEFAULTS.wetness),
    lengths: OCTOPUS_DEFAULTS.lengths.map((fallback, i) =>
      bounded(values.lengths?.[i], 0.68, 1.68, fallback)),
    curls: OCTOPUS_DEFAULTS.curls.map((fallback, i) =>
      bounded(values.curls?.[i], -0.9, 0.9, fallback)),
  };
}

/** An expressive rig, not a biomechanical or acoustic octopus simulation. */
export function octopusPose(values, cycles = 0, playing = false) {
  const state = octopusSettings(values);
  const turn = TAU * ((Number(cycles) || 0) % 1);
  const pressure = bounded(state.grip + (playing ? (1 - Math.cos(turn)) * 0.14 : 0),
    0, 1, state.grip);
  const arms = state.lengths.map((armLength, id) => {
    const angle = TAU * id / 8;
    const curl = state.curls[id];
    const joints = Array.from({ length: 6 }, (_, index) => {
      const t = index / 5;
      const radius = 0.4 + armLength * 0.75 * t;
      const bend = curl * t * t * 0.37 + state.current * 0.16 * t
        + (playing ? 0.05 * Math.sin(turn - t * 3 + id) * t : 0);
      return [Math.cos(angle) * radius - Math.sin(angle) * bend,
        -0.2 - 0.14 * t + curl * t * t * 0.21 - pressure * t * 0.055,
        Math.sin(angle) * radius + Math.cos(angle) * bend];
    });
    return {
      id, joints, length: armLength, curl,
      frequency: bounded(208 / (armLength ** 0.73) * (1 + Math.abs(curl) * 0.09),
        90, 450, 208),
      pan: Math.sin(angle) * 0.56,
    };
  });
  return { pressure, current: state.current, selected: state.selected,
    skin: state.skin, wetness: state.wetness, arms };
}
