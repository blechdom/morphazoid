/** Pure helpers for normalized, editable mapping curves. */

export const MAPPING_CURVE_MIN_GAP = 0.01;

const PRESET_X = [0, 0.25, 0.5, 0.75, 1];

function freezePreset(yValues) {
  return Object.freeze(PRESET_X.map((x, index) => Object.freeze({ x, y: yValues[index] })));
}

/**
 * Five-node curve presets. Definitions are immutable; use mappingCurvePreset
 * to obtain editable copies.
 */
export const MAPPING_CURVE_PRESETS = Object.freeze({
  linear: freezePreset([0, 0.25, 0.5, 0.75, 1]),
  exponential: freezePreset([0, 1 / 15, 1 / 5, 7 / 15, 1]),
  logarithmic: freezePreset([
    0,
    Math.log2(4.75) / 4,
    Math.log2(8.5) / 4,
    Math.log2(12.25) / 4,
    1,
  ]),
  smooth: freezePreset([0, 5 / 32, 0.5, 27 / 32, 1]),
  inverted: freezePreset([1, 0.75, 0.5, 0.25, 0]),
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function effectiveGap(nodeCount) {
  if (nodeCount <= 1) return 0;
  return Math.min(MAPPING_CURVE_MIN_GAP, 1 / (nodeCount - 1));
}

/** Return a fresh editable copy of a named preset (linear when unknown). */
export function mappingCurvePreset(name = "linear") {
  const key = typeof name === "string" ? name.toLowerCase() : "linear";
  const preset = MAPPING_CURVE_PRESETS[key] ?? MAPPING_CURVE_PRESETS.linear;
  return preset.map(({ x, y }) => ({ x, y }));
}

/**
 * Clone a curve while normalizing its coordinates and ordering its nodes.
 * Curves need at least two nodes; malformed or shorter values become linear.
 */
export function sanitizeMappingCurve(nodes) {
  if (!Array.isArray(nodes) || nodes.length < 2) return mappingCurvePreset("linear");

  const count = nodes.length;
  const lastIndex = count - 1;
  const gap = effectiveGap(count);
  const sanitized = Array.from({ length: count }, (_, index) => {
    const fallback = index / lastIndex;
    const node = nodes[index];
    return {
      x: clamp(finiteOr(node?.x, fallback)),
      y: clamp(finiteOr(node?.y, fallback)),
    };
  });

  sanitized[0].x = 0;
  sanitized[lastIndex].x = 1;

  for (let index = 1; index < lastIndex; index += 1) {
    const minimum = sanitized[index - 1].x + gap;
    const maximum = 1 - (lastIndex - index) * gap;
    sanitized[index].x = clamp(sanitized[index].x, minimum, maximum);
  }

  return sanitized;
}

/**
 * Return a sanitized curve with one node updated. Endpoint X positions remain
 * fixed; interior X positions cannot cross their immediate neighbours.
 */
export function updateMappingCurveNode(nodes, index, coordinates = {}) {
  const updated = sanitizeMappingCurve(nodes);
  if (!Number.isInteger(index) || index < 0 || index >= updated.length) return updated;

  const node = updated[index];
  if (Number.isFinite(coordinates?.y)) node.y = clamp(coordinates.y);

  const lastIndex = updated.length - 1;
  if (index === 0) {
    node.x = 0;
  } else if (index === lastIndex) {
    node.x = 1;
  } else if (Number.isFinite(coordinates?.x)) {
    const gap = effectiveGap(updated.length);
    node.x = clamp(
      coordinates.x,
      updated[index - 1].x + gap,
      updated[index + 1].x - gap,
    );
  }

  return updated;
}

/** Evaluate a normalized curve using piecewise-linear interpolation. */
export function evaluateMappingCurve(value, nodes) {
  const curve = sanitizeMappingCurve(nodes);
  const input = clamp(finiteOr(value, 0));

  if (input <= curve[0].x) return curve[0].y;

  for (let index = 1; index < curve.length; index += 1) {
    const right = curve[index];
    if (input > right.x) continue;

    const left = curve[index - 1];
    const span = right.x - left.x;
    const amount = span > 0 ? (input - left.x) / span : 0;
    return left.y + (right.y - left.y) * amount;
  }

  return curve[curve.length - 1].y;
}
