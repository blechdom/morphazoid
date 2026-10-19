const bounded = (value, min, max, fallback) => Math.min(max,
  Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));

export const PANCAKE_MAX_CAKES = 6;
export const PANCAKE_DEFAULTS = Object.freeze({
  tilt: 0, heat: 0.44, butter: 0.38, syrup: 0,
  attachTo: 'none', cookRate: 0.72, selected: 0,
  spatulaX: -0.42, spatulaY: 0,
  cakes: Object.freeze([Object.freeze({ place: 'pan', syrup: 0, order: 0 })]),
});

export function pancakeSettings(values = {}) {
  const raw = Array.isArray(values.cakes) && values.cakes.length ? values.cakes : PANCAKE_DEFAULTS.cakes;
  const occupied = new Set();
  const cakes = raw.slice(0, PANCAKE_MAX_CAKES).map((cake, i) => {
    let place = ['pan', 'plate', 'spatula', 'wall'].includes(cake?.place)
      ? cake.place : i === 0 ? 'pan' : 'plate';
    if (place !== 'plate' && occupied.has(place)) place = 'plate';
    occupied.add(place);
    return { place, syrup: bounded(cake?.syrup, 0, 1, 0),
      order: Math.round(bounded(cake?.order, 0, PANCAKE_MAX_CAKES, i)) };
  });
  if (values.cakes == null && ['plate', 'wall'].includes(values.attachTo)) {
    cakes[0].place = values.attachTo;
  }
  const selected = Math.round(bounded(values.selected, 0, cakes.length - 1, 0));
  cakes[selected].syrup = bounded(values.syrup, 0, 1, cakes[selected].syrup);
  const place = cakes[selected].place;
  return {
    tilt: bounded(values.tilt, -28, 28, 0),
    heat: bounded(values.heat, 0, 1, PANCAKE_DEFAULTS.heat),
    butter: bounded(values.butter, 0, 1, PANCAKE_DEFAULTS.butter),
    syrup: cakes[selected].syrup,
    attachTo: place === 'wall' || place === 'plate' ? place : 'none',
    cookRate: bounded(values.cookRate, 0.18, 2, PANCAKE_DEFAULTS.cookRate),
    selected, cakes,
    spatulaX: bounded(values.spatulaX, -1.75, 0.15, PANCAKE_DEFAULTS.spatulaX),
    spatulaY: bounded(values.spatulaY, -0.04, 0.9, PANCAKE_DEFAULTS.spatulaY),
  };
}

const find = (cakes, place) => cakes.findIndex((cake) => cake.place === place);
const plateTop = (cakes) => cakes.reduce((top, cake, i) =>
  cake.place === 'plate' && (top < 0 || cake.order >= cakes[top].order) ? i : top, -1);

/** Scoop, plate stacking, and peeling all mutate the same bounded cake identities. */
export function pancakeTransition(values, action) {
  const state = pancakeSettings(values);
  const cakes = state.cakes.map((cake) => ({ ...cake }));
  const held = find(cakes, 'spatula'), pan = find(cakes, 'pan');
  let selected = state.selected;
  if (action === 'pour') {
    if (pan >= 0 || cakes.length === PANCAKE_MAX_CAKES) return null;
    selected = cakes.length;
    cakes.push({ place: 'pan', syrup: 0, order: 0 });
  } else if (action === 'scoop') {
    if (held >= 0) return null;
    selected = pan >= 0 ? pan : plateTop(cakes);
    if (selected < 0) return null;
    cakes[selected].place = 'spatula';
  } else if (action === 'stack') {
    if (held < 0) return null;
    selected = held;
    const plates = cakes.filter((cake) => cake.place === 'plate')
      .sort((a, b) => a.order - b.order);
    plates.forEach((cake, index) => { cake.order = index; });
    cakes[held].place = 'plate';
    cakes[held].order = plates.length;
  } else if (action === 'pan') {
    if (held < 0 || pan >= 0) return null;
    selected = held;
    cakes[held].place = 'pan';
  } else if (action === 'wall') {
    const source = held >= 0 ? held : pan;
    if (source < 0 || find(cakes, 'wall') >= 0 || cakes[source].syrup < 0.12) return null;
    selected = source;
    cakes[source].place = 'wall';
  } else if (action === 'peel') {
    if (held >= 0) return null;
    selected = find(cakes, 'wall');
    if (selected < 0) selected = plateTop(cakes);
    if (selected < 0) return null;
    cakes[selected].place = 'spatula';
  } else return null;
  return pancakeSettings({ ...state, selected, syrup: cakes[selected].syrup, cakes,
    spatulaX: PANCAKE_DEFAULTS.spatulaX, spatulaY: PANCAKE_DEFAULTS.spatulaY });
}

/** Flight is silent; the app schedules one physical landing on its audio clock. */
export function pancakePose(values, seconds = 0, flipAt = null, cycles = 0, cooking = false, flightId = 0) {
  const state = pancakeSettings(values);
  const flight = flipAt == null ? 1 : bounded((seconds - flipAt) / 0.68, 0, 1, 1);
  const wave = cooking ? 0.012 * Math.sin((Number(cycles) || 0) * Math.PI * 2) : 0;
  const plateOrder = state.cakes.map((cake, id) => ({ cake, id }))
    .filter(({ cake }) => cake.place === 'plate')
    .sort((a, b) => a.cake.order - b.cake.order);
  const layers = new Map(plateOrder.map(({ id }, index) => [id, index]));
  const cakes = state.cakes.map((cake, id) => {
    const airborne = id === flightId && cake.place === 'pan' && flight < 1;
    const layer = layers.get(id) ?? -1;
    const position = airborne ? [0, -0.19 + Math.sin(flight * Math.PI) * 1.2, 0]
      : cake.place === 'plate' ? [-1.58, -0.4 + layer * 0.11, 0]
        : cake.place === 'wall' ? [0.15, 0.41, -1.04]
          : cake.place === 'spatula' ? [state.spatulaX - 0.1, state.spatulaY - 0.2, 0.72]
            : [0, -0.17 + wave, 0];
    return {
      id, place: cake.place, layer, syrup: cake.syrup, airborne, position,
      rotation: airborne ? [0, 0, Math.PI * 2 * flight]
        : cake.place === 'wall' ? [Math.PI / 2, 0, 0]
          : [0, 0, cake.place === 'pan' ? state.tilt * Math.PI / 180 * 0.42 : 0],
    };
  });
  const selected = cakes[state.selected];
  return {
    tilt: state.tilt * Math.PI / 180,
    heat: state.heat, butter: state.butter, syrup: selected.syrup,
    selected: state.selected, cakes, stackCount: plateOrder.length,
    spatulaPosition: [state.spatulaX, state.spatulaY, 0.72],
    attachTo: state.attachTo, airborne: cakes.some((cake) => cake.airborne),
    pancakePosition: selected.position, pancakeRotation: selected.rotation,
    stickStrength: selected.syrup * (selected.place === 'wall' ? 1 : 0),
    sizzle: cooking ? state.heat * state.butter : 0,
  };
}
