const bounded = (value, min, max, fallback) => Math.min(max,
  Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));
const OUTBOUND_END = 0.44;
const RETURN_START = 0.5;
const INBOUND_END = 0.94;
const GAITS_PER_PASS = 8;
const CONTACTS_PER_GAIT = 2;
const smooth = (value) => value * value * (3 - 2 * value);

export const ANT_DEFAULTS = Object.freeze({
  foodX: 0.8, foodY: 0.25, trail: 0.34, chamberSize: 0.46,
  gateOpen: true, travelRate: 0.31, selected: 0,
  guide: Object.freeze([[0, 0], [0, 0], [0, 0]].map((offset) => Object.freeze(offset))),
});

export function antSettings(values = {}) {
  return {
    foodX: bounded(values.foodX, 0.38, 1.15, ANT_DEFAULTS.foodX),
    foodY: bounded(values.foodY, -0.38, 0.6, ANT_DEFAULTS.foodY),
    trail: bounded(values.trail, 0, 1, ANT_DEFAULTS.trail),
    chamberSize: bounded(values.chamberSize, 0.27, 0.72, ANT_DEFAULTS.chamberSize),
    gateOpen: values.gateOpen === undefined ? ANT_DEFAULTS.gateOpen : Boolean(values.gateOpen),
    travelRate: bounded(values.travelRate, 0.09, 1.2, ANT_DEFAULTS.travelRate),
    selected: Math.round(bounded(values.selected, 0, 2, ANT_DEFAULTS.selected)),
    guide: ANT_DEFAULTS.guide.map((fallback, i) =>
      fallback.map((original, axis) => bounded(values.guide?.[i]?.[axis], -0.36, 0.36, original))),
  };
}

/**
 * Travel is constant during each pass; the short stationary intervals turn
 * the body while the feet are planted. One gait cycle always covers the same
 * distance instead of replaying an entire walk clip once per shuttle.
 */
function route(cycles) {
  const phase = ((cycles % 1) + 1) % 1;
  const lap = Math.floor(cycles);
  if (phase < OUTBOUND_END) {
    const progress = phase / OUTBOUND_END;
    return { progress, heading: 0, gaitCycles: lap * 16 + progress * GAITS_PER_PASS,
      moving: true };
  }
  if (phase < RETURN_START) {
    return { progress: 1, heading: Math.PI * smooth((phase - OUTBOUND_END) /
      (RETURN_START - OUTBOUND_END)), gaitCycles: lap * 16 + GAITS_PER_PASS,
    moving: false };
  }
  if (phase < INBOUND_END) {
    const progress = 1 - (phase - RETURN_START) / (INBOUND_END - RETURN_START);
    return { progress, heading: Math.PI, gaitCycles: lap * 16 +
      GAITS_PER_PASS * (2 - progress), moving: true };
  }
  return { progress: 0, heading: Math.PI * (1 + smooth((phase - INBOUND_END) /
    (1 - INBOUND_END))), gaitCycles: (lap + 1) * 16, moving: false };
}

/** Three stable actors move on the same timeline as their imported leg rigs. */
export function antPose(values, cycles = 0, playing = false, motion = 'walk') {
  const state = antSettings(values);
  const colony = state.guide.map((offset, id) => {
    const time = (Number.isFinite(cycles) ? cycles : 0) + id / 3;
    const path = route(time);
    const progress = motion === 'dig' ? 1 : path.progress;
    const bend = Math.sin(Math.PI * progress);
    const layer = (id - 1) * 0.37;
    const x = -0.88 + progress * (0.88 + state.foodX) + offset[0] * (1 - progress * 0.35)
      - (motion === 'dig' ? 0.24 + id * 0.09 : 0);
    const y = -0.12 + progress * state.foodY * 0.63 + bend * (0.12 + state.trail * 0.14)
      + offset[1] * (1 - progress * 0.35);
    const z = layer + bend * (state.gateOpen ? (id - 1) * 0.13 : (1 - id) * 0.15);
    return {
      id, position: [x, y, z], heading: motion === 'dig' ? 0 : path.heading,
      gaitCycles: path.gaitCycles, moving: playing && motion === 'walk' && path.moving,
      actionPhase: ((time % 1) + 1) % 1, progress,
    };
  });
  return {
    colony, food: [state.foodX, state.foodY, 0.25],
    selected: state.selected, chamberSize: state.chamberSize,
    gateOpen: state.gateOpen, trail: state.trail, motion,
  };
}

/** Two alternating tripod contacts per gait; none during a planted turn. */
export function antFootContacts(fromCycle, toCycle, id, motion = 'walk') {
  if (motion !== 'walk' || !Number.isFinite(fromCycle) || !Number.isFinite(toCycle)
    || toCycle < fromCycle || toCycle - fromCycle > 2 || !Number.isInteger(id)
    || id < 0 || id > 2) return [];
  const events = [];
  const start = Math.floor(fromCycle + id / 3) - 1;
  const end = Math.ceil(toCycle + id / 3) + 1;
  for (let lap = start; lap <= end; lap += 1) {
    for (const offset of [0, RETURN_START]) {
      for (let step = 0; step < GAITS_PER_PASS * CONTACTS_PER_GAIT; step += 1) {
        const phase = offset + step * OUTBOUND_END /
          (GAITS_PER_PASS * CONTACTS_PER_GAIT);
        const cycle = lap + phase - id / 3;
        if (cycle > fromCycle + 1e-9 && cycle <= toCycle + 1e-9) {
          events.push({ cycle, id, tripod: step % 2 });
        }
      }
    }
  }
  return events.sort((a, b) => a.cycle - b.cycle);
}

export function chamberTone(size, id = 0) {
  return bounded(360 / Math.sqrt(bounded(size, 0.27, 0.72, 0.46) / 0.46)
    * (id ? 1.16 : 0.84), 120, 800, 310);
}
