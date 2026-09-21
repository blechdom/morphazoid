// Pure building blocks; each instrument owns which parameters may vary and
// which bounds/correlations must survive. Never recursively scramble a snapshot.
export const clonePresetData = value => JSON.parse(JSON.stringify(value));

export function presetRandom(random = Math.random) {
  const unit = () => {
    const value = random();
    if (!Number.isFinite(value)) throw new TypeError("Random source must return a finite number");
    return Math.max(0, Math.min(1 - Number.EPSILON, value));
  };
  const between = (a, b) => a + (b - a) * unit();
  const integer = (min, max) => Math.min(max, Math.floor(between(min, max + 1)));
  const pick = values => {
    if (!values.length) throw new TypeError("Cannot randomize an empty set");
    return values[integer(0, values.length - 1)];
  };
  return { unit, between, integer, pick };
}

/** Explicit model-owned ranges only, never inferred from a preset snapshot. */
export function randomParameterValues(ranges, random) {
  return Object.fromEntries(Object.entries(ranges).map(([key, [min, max]]) => [key, random.between(min, max)]));
}

/** New notes/rests/accents, not a rotation of an existing factory rhythm. */
export function randomMonophonicRows(soundIds, capacity, length, random) {
  const rows = Object.fromEntries(soundIds.map(id => [id, Array(capacity).fill(0)]));
  const density = random.between(0.25, 0.65);
  for (let step = 0; step < length; step++) {
    if (step !== 0 && random.unit() > density) continue;
    rows[random.pick(soundIds)][step] = random.between(0.3, 0.9);
  }
  return rows;
}
