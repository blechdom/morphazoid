const TAU = Math.PI * 2;
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const bounded = (value, minimum, maximum, fallback) =>
  Math.min(maximum, Math.max(minimum, finite(value, fallback)));

// Musical control ranges, deliberately not species-specific wingbeat measurements.
export const MOSQUITO_DEFAULTS = Object.freeze({
  wingRate: 390, stroke: 0.62, probe: 0, flightRate: 0.42,
  x: 0, y: 0, z: 0,
  legs: Object.freeze([0, 0, 0, 0, 0, 0]), selectedLeg: 0,
});

export function mosquitoSettings(values = {}) {
  const legs = Array.isArray(values.legs) ? values.legs : MOSQUITO_DEFAULTS.legs;
  return {
    wingRate: bounded(values.wingRate, 140, 880, MOSQUITO_DEFAULTS.wingRate),
    stroke: bounded(values.stroke, 0.05, 1, MOSQUITO_DEFAULTS.stroke),
    probe: bounded(values.probe, -45, 45, MOSQUITO_DEFAULTS.probe),
    flightRate: bounded(values.flightRate, 0.08, 2.4, MOSQUITO_DEFAULTS.flightRate),
    x: bounded(values.x, -0.85, 0.85, MOSQUITO_DEFAULTS.x),
    y: bounded(values.y, -0.6, 0.6, MOSQUITO_DEFAULTS.y),
    z: bounded(values.z, -0.6, 0.6, MOSQUITO_DEFAULTS.z),
    legs: Array.from({ length: 6 }, (_, index) => bounded(legs[index], -1, 1, 0)),
    selectedLeg: Math.round(bounded(values.selectedLeg, 0, 5, 0)),
  };
}

export function mosquitoPose(values, cycles = 0, seconds = 0, flutter = false,
  phase = null, flight = flutter) {
  const settings = mosquitoSettings(values);
  const turn = TAU * (finite(cycles, 0) % 1);
  const position = {
    x: settings.x + 0.38 * Math.sin(turn),
    y: settings.y + 0.13 * (1 - Math.cos(turn)),
    z: settings.z + 0.16 * Math.sin(turn * 2),
  };
  const pitchHz = Math.min(1120, Math.max(110,
    settings.wingRate * 2 ** (position.y * 0.25)));
  const wingCycle = ((finite(phase ?? finite(seconds, 0) * pitchHz, 0) % 1) + 1) % 1;
  const flap = flutter ? Math.sin(TAU * wingCycle) * settings.stroke * 0.72 : 0;
  const legTension = Math.max(...settings.legs.map(Math.abs));
  return {
    position,
    pitchHz,
    stroke: settings.stroke,
    pan: Math.max(-0.8, Math.min(0.8, position.x * 0.72)),
    brightness: Math.min(1, 0.22 + settings.stroke * 0.52
      + Math.abs(position.z) * 0.15 + legTension * 0.16),
    leftWing: -0.14 + flap,
    rightWing: 0.14 - flap,
    abdomen: 0.07 * Math.sin(turn),
    bodyYaw: 0.20 * Math.cos(turn),
    probe: settings.probe * Math.PI / 180,
    legCurls: settings.legs,
    legTension,
    wingPhase: wingCycle,
    flutter,
    flight,
  };
}
