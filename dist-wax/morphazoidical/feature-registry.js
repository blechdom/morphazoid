/**
 * Mapping-safe metadata for Morphazoidical's real-time geometry features.
 *
 * A descriptor is intentionally independent of the UI and audio engine.  The
 * `id` is the public contract; labels, units, availability, and normalization
 * tell consumers how to display or map a value without guessing its meaning.
 * Null is the only representation of an unavailable feature.  In particular,
 * an unavailable inside/outside value must never be coerced to zero.
 */

const TAU = Math.PI * 2;

function descriptor(id, label, group, scope, type, extra = {}) {
  return Object.freeze({
    id,
    label,
    group,
    scope,
    type,
    status: "live-prototype",
    cadence: scope === "event" ? "event edge" : "analysis frame",
    ...extra,
  });
}

const LINEAR_01 = Object.freeze({ kind: "linear", minimum: 0, maximum: 1, clamp: true });
const SIGNED_01 = Object.freeze({ kind: "linear", minimum: -1, maximum: 1, clamp: true });
const SIGNED_UNIT = Object.freeze({ kind: "linear", minimum: -1, maximum: 1, clamp: true });
const ANGLE = Object.freeze({ kind: "cyclic", minimum: -Math.PI, period: TAU });
const AXIS_ANGLE = Object.freeze({ kind: "cyclic", minimum: -Math.PI / 2, period: Math.PI });
const POSITIVE_ONE = Object.freeze({ kind: "positive", scale: 1 });
const POSITIVE_FOUR = Object.freeze({ kind: "positive", scale: 4 });
const COUNT = Object.freeze({ kind: "positive", scale: 4 });

/**
 * Stable public feature descriptors.  New descriptors may be appended; IDs
 * already shipped should not be renamed because saved mappings refer to them.
 */
export const FEATURE_REGISTRY = Object.freeze([
  descriptor("geometry.closed", "Closed contour", "Form", "geometry", "boolean", {
    description: "Whether the contour encloses a fillable region.",
  }),
  descriptor("geometry.perimeter", "Perimeter", "Form", "geometry", "scalar", {
    unit: "model-unit", normalization: POSITIVE_FOUR,
  }),
  descriptor("geometry.samples", "Sample points", "Form", "geometry", "scalar", {
    unit: "count", normalization: Object.freeze({ kind: "positive", scale: 128 }),
    description: "Number of points in the polyline used by this analysis snapshot.",
  }),
  descriptor("geometry.segments", "Sampled segments", "Form", "geometry", "scalar", {
    unit: "count", normalization: Object.freeze({ kind: "positive", scale: 128 }),
  }),
  descriptor("geometry.logicalEdges", "Logical edges", "Form", "geometry", "scalar", {
    unit: "count", normalization: Object.freeze({ kind: "positive", scale: 8 }),
    description: "Semantic edges before each edge is subdivided for rendering and analysis.",
  }),
  descriptor("geometry.area", "Area", "Form", "geometry", "scalar", {
    unit: "model-unit²", normalization: Object.freeze({ kind: "linear", minimum: 0, maximum: Math.PI, clamp: true }),
    availability: "closed contour",
  }),
  descriptor("geometry.signedArea", "Signed area", "Form", "geometry", "scalar", {
    unit: "model-unit²", normalization: Object.freeze({ kind: "linear", minimum: -Math.PI, maximum: Math.PI, clamp: true }),
    availability: "closed contour",
  }),
  descriptor("geometry.orientation", "Orientation", "Form", "geometry", "category", {
    categories: Object.freeze(["open", "degenerate", "clockwise", "counterclockwise"]),
  }),
  descriptor("geometry.centroid.x", "Centroid X", "Form", "geometry", "scalar", {
    unit: "model-unit", normalization: SIGNED_UNIT,
  }),
  descriptor("geometry.centroid.y", "Centroid Y", "Form", "geometry", "scalar", {
    unit: "model-unit", normalization: SIGNED_UNIT,
  }),
  descriptor("geometry.bounds.width", "Bounds width", "Form", "geometry", "scalar", {
    unit: "model-unit", normalization: Object.freeze({ kind: "linear", minimum: 0, maximum: 2, clamp: true }),
  }),
  descriptor("geometry.bounds.height", "Bounds height", "Form", "geometry", "scalar", {
    unit: "model-unit", normalization: Object.freeze({ kind: "linear", minimum: 0, maximum: 2, clamp: true }),
  }),
  descriptor("geometry.compactness", "Compactness", "Form", "geometry", "scalar", {
    normalization: LINEAR_01, availability: "closed, non-degenerate contour",
    description: "4πA/P²; one for an ideal circle and lower for less compact forms.",
  }),
  descriptor("geometry.solidity", "Solidity", "Form", "geometry", "scalar", {
    normalization: LINEAR_01, availability: "simple closed contour",
    description: "Contour area divided by convex-hull area.",
  }),
  descriptor("geometry.convexity", "Convexity", "Form", "geometry", "scalar", {
    normalization: LINEAR_01, availability: "closed contour",
    description: "Convex-hull perimeter divided by contour perimeter.",
  }),
  descriptor("geometry.hull.area", "Convex-hull area", "Form", "geometry", "scalar", {
    unit: "model-unit²", normalization: Object.freeze({ kind: "linear", minimum: 0, maximum: Math.PI, clamp: true }),
    availability: "closed contour",
  }),
  descriptor("geometry.hull.perimeter", "Convex-hull perimeter", "Form", "geometry", "scalar", {
    unit: "model-unit", normalization: POSITIVE_FOUR,
  }),
  descriptor("geometry.principalAxis", "Principal axis", "Form", "geometry", "circular", {
    unit: "radian", normalization: AXIS_ANGLE,
  }),
  descriptor("geometry.eccentricity", "Eccentricity", "Form", "geometry", "scalar", {
    normalization: LINEAR_01,
  }),
  descriptor("geometry.radius.minimum", "Minimum radius", "Center", "geometry", "scalar", {
    unit: "model-unit", normalization: POSITIVE_ONE,
  }),
  descriptor("geometry.radius.maximum", "Maximum radius", "Center", "geometry", "scalar", {
    unit: "model-unit", normalization: POSITIVE_ONE,
  }),
  descriptor("geometry.radius.mean", "Mean radius", "Center", "geometry", "scalar", {
    unit: "model-unit", normalization: POSITIVE_ONE,
  }),
  descriptor("geometry.radius.deviation", "Radius deviation", "Center", "geometry", "scalar", {
    unit: "model-unit", normalization: POSITIVE_ONE,
  }),
  descriptor("geometry.center.inside", "Center contained", "Inside / outside", "geometry", "boolean", {
    availability: "closed contour",
  }),
  descriptor("geometry.center.winding", "Center winding", "Inside / outside", "geometry", "scalar", {
    normalization: Object.freeze({ kind: "signed-positive", scale: 2 }), availability: "closed contour",
  }),
  descriptor("geometry.selfIntersections", "Self-intersections", "Topology", "geometry", "scalar", {
    normalization: COUNT,
  }),
  descriptor("geometry.crossings", "Proper crossings", "Topology", "geometry", "scalar", {
    normalization: COUNT,
  }),
  descriptor("geometry.touches", "Self-touches", "Topology", "geometry", "scalar", {
    normalization: COUNT,
  }),
  descriptor("geometry.overlaps", "Overlaps", "Topology", "geometry", "scalar", {
    normalization: COUNT,
  }),

  descriptor("contact.position.x", "Contact X", "Contact", "contact", "scalar", {
    unit: "model-unit", normalization: SIGNED_UNIT,
  }),
  descriptor("contact.position.y", "Contact Y", "Contact", "contact", "scalar", {
    unit: "model-unit", normalization: SIGNED_UNIT,
  }),
  descriptor("contact.bounds.x", "Contact X in bounds", "Contact", "contact", "scalar", {
    normalization: LINEAR_01,
  }),
  descriptor("contact.bounds.y", "Contact Y in bounds", "Contact", "contact", "scalar", {
    normalization: LINEAR_01,
  }),
  descriptor("contact.contourPhase", "Contour phase", "Contact", "contact", "cyclic", {
    normalization: Object.freeze({ kind: "cyclic", minimum: 0, period: 1 }),
  }),
  descriptor("contact.contourDistance", "Contour distance", "Contact", "contact", "scalar", {
    unit: "model-unit", normalization: POSITIVE_FOUR,
  }),
  descriptor("contact.segment.index", "Sampled segment index", "Contact", "contact", "scalar", {
    unit: "index", normalization: Object.freeze({ kind: "positive", scale: 32 }),
  }),
  descriptor("contact.segment.phase", "Position on sampled segment", "Contact", "contact", "scalar", {
    normalization: LINEAR_01,
  }),
  descriptor("contact.logicalEdge.index", "Logical edge index", "Edge / corner", "contact", "scalar", {
    unit: "index", normalization: Object.freeze({ kind: "positive", scale: 8 }),
    availability: "form with logical edges",
  }),
  descriptor("contact.logicalEdge.phase", "Position on logical edge", "Edge / corner", "contact", "scalar", {
    normalization: LINEAR_01, availability: "form with logical edges",
  }),
  descriptor("contact.radius", "Center radius", "Contact", "contact", "scalar", {
    unit: "model-unit", normalization: POSITIVE_ONE,
  }),
  descriptor("contact.polarAngle", "Center angle", "Center", "contact", "circular", {
    unit: "radian", normalization: ANGLE,
  }),
  descriptor("contact.tangentAngle", "Tangent angle", "Direction", "contact", "circular", {
    unit: "radian", normalization: ANGLE,
  }),
  descriptor("contact.incomingAngle", "Incoming angle", "Direction", "contact", "circular", {
    unit: "radian", normalization: ANGLE,
  }),
  descriptor("contact.outgoingAngle", "Outgoing angle", "Direction", "contact", "circular", {
    unit: "radian", normalization: ANGLE,
  }),
  descriptor("contact.normalAngle", "Outward-normal angle", "Direction", "contact", "circular", {
    unit: "radian", normalization: ANGLE, availability: "closed, oriented contour",
  }),
  descriptor("contact.turn", "Signed local turn", "Edge / corner", "contact", "scalar", {
    unit: "radian", normalization: Object.freeze({ kind: "linear", minimum: -Math.PI, maximum: Math.PI, clamp: true }),
  }),
  descriptor("contact.curvature", "Sampled curvature", "Edge / corner", "contact", "scalar", {
    unit: "radian/model-unit", normalization: Object.freeze({ kind: "signed-positive", scale: 4 }),
  }),
  descriptor("contact.radialAlignment", "Radial tangent alignment", "Center", "contact", "scalar", {
    normalization: SIGNED_01,
    description: "Tangent dot radial direction: negative inward, zero circumferential, positive outward.",
  }),
  descriptor("contact.centerFacing", "Outward normal vs center", "Inside / outside", "contact", "scalar", {
    normalization: SIGNED_01, availability: "closed, oriented contour",
    description: "Outward normal dot radial direction: negative center-facing, positive away from center.",
  }),
  descriptor("contact.tangentRadiusAngle", "Tangent / radius angle", "Center", "contact", "circular", {
    unit: "radian", normalization: ANGLE,
  }),
  descriptor("contact.corner.distance", "Nearest-corner distance", "Edge / corner", "contact", "scalar", {
    unit: "model-unit", normalization: POSITIVE_ONE,
  }),
  descriptor("contact.corner.strength", "Nearest-corner strength", "Edge / corner", "contact", "scalar", {
    normalization: LINEAR_01,
  }),
  descriptor("contact.corner.class", "Corner class", "Inside / outside", "contact", "category", {
    categories: Object.freeze(["unavailable", "smooth", "convex", "reflex"]),
  }),
  descriptor("contact.hull.class", "Hull class", "Inside / outside", "contact", "category", {
    categories: Object.freeze(["unavailable", "hull-boundary", "reentrant"]),
  }),
  descriptor("contact.reader.boundaryRole", "Reader boundary role", "Inside / outside", "contact", "category", {
    categories: Object.freeze(["unavailable", "enter", "exit", "touch", "overlap"]),
  }),
  descriptor("contact.reader.rank", "Reader contact rank", "Reader", "contact", "scalar", {
    unit: "index", normalization: COUNT,
    description: "Zero-based order along the active reader, independent of stable contact identity.",
  }),
  descriptor("contact.reader.incidence", "Reader incidence angle", "Direction", "contact", "scalar", {
    unit: "radian", normalization: Object.freeze({ kind: "linear", minimum: 0, maximum: Math.PI / 2, clamp: true }),
    availability: "line or ray reader",
    description: "Acute angle between reader and contour tangent: zero is grazing; π/2 is transverse.",
  }),
  descriptor("contact.reader.transversality", "Reader transversality", "Direction", "contact", "scalar", {
    normalization: LINEAR_01, availability: "line or ray reader",
    description: "Absolute reader/tangent cross product: zero near tangency and one at a right-angle crossing.",
  }),
  descriptor("contact.motion.speed", "Contact speed", "Motion", "contact", "scalar", {
    unit: "model-unit/second", normalization: POSITIVE_ONE,
  }),
  descriptor("contact.motion.contourVelocity", "Contour velocity", "Motion", "contact", "scalar", {
    unit: "cycle/second", normalization: Object.freeze({ kind: "signed-positive", scale: 1 }),
  }),
  descriptor("contact.motion.age", "Contact age", "Motion", "contact", "scalar", {
    unit: "second", normalization: Object.freeze({ kind: "positive", scale: 2 }),
  }),

  descriptor("reader.contactCount", "Contact count", "Reader", "reader", "scalar", {
    normalization: COUNT,
  }),
  descriptor("reader.insideIntervalCount", "Inside intervals", "Reader", "reader", "scalar", {
    normalization: COUNT, availability: "closed contour",
  }),
  descriptor("reader.insideSpan", "Inside span", "Reader", "reader", "scalar", {
    unit: "model-unit", normalization: POSITIVE_FOUR, availability: "closed contour",
  }),
  descriptor("reader.insideFraction", "Inside fraction", "Reader", "reader", "scalar", {
    normalization: LINEAR_01, availability: "closed contour with finite reader extent",
  }),
  descriptor("reader.spacing.minimum", "Minimum contact spacing", "Reader", "reader", "scalar", {
    unit: "model-unit", normalization: POSITIVE_ONE,
  }),
  descriptor("reader.spacing.mean", "Mean contact spacing", "Reader", "reader", "scalar", {
    unit: "model-unit", normalization: POSITIVE_ONE,
  }),
  descriptor("reader.contactDelta", "Contact-count change", "Motion", "reader", "scalar", {
    normalization: Object.freeze({ kind: "signed-positive", scale: 2 }),
  }),
  descriptor("reader.transversality.minimum", "Minimum transversality", "Reader", "reader", "scalar", {
    normalization: LINEAR_01, availability: "line or ray reader with contacts",
    description: "Smallest contact transversality; values near zero flag a sampled tangency candidate.",
  }),
  descriptor("reader.transversality.mean", "Mean transversality", "Reader", "reader", "scalar", {
    normalization: LINEAR_01, availability: "line or ray reader with contacts",
  }),

  descriptor("events.births", "Contact births", "Events", "event", "event", { normalization: COUNT }),
  descriptor("events.deaths", "Contact deaths", "Events", "event", "event", { normalization: COUNT }),
  descriptor("events.splits", "Contact splits", "Events", "event", "event", {
    normalization: COUNT,
    status: "planned",
    availability: "structural or swept tracker",
    description: "A one-to-many identity event; intentionally unavailable until split semantics are implemented.",
  }),
  descriptor("events.merges", "Contact merges", "Events", "event", "event", {
    normalization: COUNT,
    status: "planned",
    availability: "structural or swept tracker",
    description: "A many-to-one identity event; intentionally unavailable until merge semantics are implemented.",
  }),
  descriptor("events.entries", "Reader entries", "Events", "event", "event", { normalization: COUNT }),
  descriptor("events.exits", "Reader exits", "Events", "event", "event", { normalization: COUNT }),
]);

const REGISTRY_BY_ID = new Map(FEATURE_REGISTRY.map((entry) => [entry.id, entry]));

/** Return one descriptor, or null for an unknown ID. */
export function getFeatureDescriptor(id) {
  return REGISTRY_BY_ID.get(id) ?? null;
}

/**
 * Query descriptors without exposing the mutable lookup map.
 * @param {{scope?:string, group?:string, type?:string}} [query]
 */
export function listFeatureDescriptors(query = {}) {
  return FEATURE_REGISTRY.filter((entry) => (
    (!query.scope || entry.scope === query.scope)
    && (!query.group || entry.group === query.group)
    && (!query.type || entry.type === query.type)
  ));
}

function wrap(value, minimum, period) {
  const wrapped = (value - minimum) % period;
  return minimum + (wrapped < 0 ? wrapped + period : wrapped);
}

/**
 * Convert a raw feature value into a mapping-ready 0..1 value.
 * Returns null for unknown, unavailable, or non-finite values.
 */
export function normalizeFeatureValue(featureOrId, value) {
  const entry = typeof featureOrId === "string"
    ? getFeatureDescriptor(featureOrId)
    : featureOrId;
  if (!entry || value === null || value === undefined) return null;

  if (entry.type === "boolean") return value === true ? 1 : value === false ? 0 : null;
  if (entry.type === "category") {
    const categories = entry.categories ?? [];
    const index = categories.indexOf(value);
    if (index < 0) return null;
    return categories.length <= 1 ? 0 : index / (categories.length - 1);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  const rule = entry.normalization;
  if (!rule || rule.kind === "identity") return value;
  if (rule.kind === "cyclic") {
    return (wrap(value, rule.minimum, rule.period) - rule.minimum) / rule.period;
  }
  if (rule.kind === "positive") {
    if (value <= 0) return 0;
    return value / (value + rule.scale);
  }
  if (rule.kind === "signed-positive") {
    const signed = value / (Math.abs(value) + rule.scale);
    return signed * 0.5 + 0.5;
  }
  if (rule.kind === "linear") {
    const span = rule.maximum - rule.minimum;
    if (!(span > 0)) return null;
    const normalized = (value - rule.minimum) / span;
    return rule.clamp ? Math.max(0, Math.min(1, normalized)) : normalized;
  }
  return null;
}
