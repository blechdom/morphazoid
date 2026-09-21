const TAU = Math.PI * 2;

const finite = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clamp = (value, minimum, maximum) => (
  Math.min(maximum, Math.max(minimum, finite(value, minimum)))
);

export function normalizeSharedProfile(profile = {}) {
  const sides = Math.round(clamp(profile.sides, 1, 32));
  const requestedKind = profile.kind ?? profile.shapeType;
  const kind = sides === 1
    ? "circle"
    : sides === 2
      ? "line"
      : requestedKind === "star" ? "star" : "polygon";
  return Object.freeze({
    sides,
    kind,
    starDepth: clamp(profile.starDepth, 0.05, 0.82),
  });
}

/**
 * A shared 2D profile used verbatim by Polygon, extruded by Polyhedra, and
 * extruded across two additional axes by Hyperpolyhedra.
 */
export function sharedProfilePoints(profile = {}, radius = 0.78) {
  const normalized = normalizeSharedProfile(profile);
  const outerRadius = clamp(radius, 0.1, 1.2);
  if (normalized.kind === "line") {
    return Object.freeze({
      ...normalized,
      closed: false,
      points: Object.freeze([
        Object.freeze({ x: -outerRadius, y: 0 }),
        Object.freeze({ x: outerRadius, y: 0 }),
      ]),
    });
  }

  const pointCount = normalized.kind === "circle"
    ? 24
    : normalized.kind === "star" ? normalized.sides * 2 : normalized.sides;
  const points = Array.from({ length: pointCount }, (_, index) => {
    const angle = -Math.PI / 2 + index / pointCount * TAU;
    const pointRadius = normalized.kind === "star" && index % 2 === 1
      ? outerRadius * (1 - normalized.starDepth)
      : outerRadius;
    return Object.freeze({
      x: Math.cos(angle) * pointRadius,
      y: Math.sin(angle) * pointRadius,
    });
  });
  return Object.freeze({ ...normalized, closed: true, points: Object.freeze(points) });
}
