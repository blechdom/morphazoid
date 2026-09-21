export const LATTICE_TILE_COLORS = Object.freeze([
  Object.freeze({ id: "amber", label: "Amber", solid: "#ffb86b", fill: "rgba(255, 184, 107, .07)" }),
  Object.freeze({ id: "blue", label: "Blue", solid: "#7db4ff", fill: "rgba(125, 180, 255, .052)" }),
  Object.freeze({ id: "mint", label: "Mint", solid: "#5fe8c4", fill: "rgba(95, 232, 196, .042)" }),
  Object.freeze({ id: "ivory", label: "Ivory", solid: "#ffefc4", fill: "rgba(255, 239, 196, .045)" }),
  Object.freeze({ id: "coral", label: "Coral", solid: "#ff845c", fill: "rgba(255, 132, 92, .04)" }),
]);

export const LATTICE_TILE_COLOR_COUNT = LATTICE_TILE_COLORS.length;
export const LATTICE_COLOR_PAIR_COUNT = (
  LATTICE_TILE_COLOR_COUNT * (LATTICE_TILE_COLOR_COUNT + 1)
) / 2;

export function latticeTileColorIndex(value) {
  return Math.abs(Math.trunc(Number(value) || 0)) % LATTICE_TILE_COLOR_COUNT;
}

export function normalizedLatticeColorPair(values = [], fallback = 0) {
  const requested = Array.isArray(values) ? values : [values];
  const first = latticeTileColorIndex(requested[0] ?? fallback);
  const second = latticeTileColorIndex(requested[1] ?? requested[0] ?? fallback);
  return first <= second ? [first, second] : [second, first];
}

export function latticeColorPairIndex(values = []) {
  const [low, high] = normalizedLatticeColorPair(values);
  return (high * (high + 1)) / 2 + low;
}

export function latticeColorPairForIndex(value) {
  const index = Math.trunc(Number(value));
  if (index < 0 || index >= LATTICE_COLOR_PAIR_COUNT) return null;
  let high = 0;
  while (((high + 1) * (high + 2)) / 2 <= index) high += 1;
  const low = index - (high * (high + 1)) / 2;
  return [low, high];
}

export function latticeColorPairLabel(values = []) {
  const [first, second] = normalizedLatticeColorPair(values);
  return `${LATTICE_TILE_COLORS[first].label} + ${LATTICE_TILE_COLORS[second].label}`;
}
