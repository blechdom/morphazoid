/** Signed joint offsets over one four-beat loop. Enablement and joint scaling
 * belong to the caller; an omitted curve is neutral. Reusable for every joint. */
export const HAND_CONTOUR_POINTS = 16;
export const HAND_CONTOUR_BEATS = 4;
const TAU = Math.PI * 2;
const isCurve = value => Array.isArray(value) || (ArrayBuffer.isView(value) && typeof value.length === 'number');
const signed = value => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.length < 80 ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.max(-1, Math.min(1, number)) : 0;
};

/** Always return a fresh, editable, bounded 16-point array. */
export function normalizeHandContour(value) {
  const out = new Array(HAND_CONTOUR_POINTS).fill(0);
  if (!isCurve(value)) return out;
  for (let i = 0; i < HAND_CONTOUR_POINTS; i++) {
    try { out[i] = signed(value[i]); } catch { out[i] = 0; }
  }
  return out;
}

// Harmonic mean slopes keep each segment inside its two authored endpoints.
const slope = (before, after) => before * after <= 0 ? 0 : 2 * before * after / (before + after);
/** Allocation-free periodic cubic interpolation of a normalized curve. Negative
 * beats wrap backwards; invalid time is neutral. Values and first derivatives
 * agree across the seam, with no overshoot between neighboring control points. */
export function sampleHandContour(curve, beat) {
  if (!isCurve(curve) || !Number.isFinite(beat)) return 0;
  const position = ((beat % HAND_CONTOUR_BEATS + HAND_CONTOUR_BEATS) % HAND_CONTOUR_BEATS) * HAND_CONTOUR_POINTS / HAND_CONTOUR_BEATS;
  const index = Math.floor(position), t = position - index;
  const a = signed(curve[index]), b = signed(curve[(index + 1) % HAND_CONTOUR_POINTS]);
  const before = signed(curve[(index + HAND_CONTOUR_POINTS - 1) % HAND_CONTOUR_POINTS]);
  const after = signed(curve[(index + 2) % HAND_CONTOUR_POINTS]);
  const m0 = slope(a - before, b - a), m1 = slope(b - a, after - b);
  const t2 = t * t, t3 = t2 * t;
  const value = (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * m0
    + (-2 * t3 + 3 * t2) * b + (t3 - t2) * m1;
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), value));
}

/** Supplying the same random sequence reproduces the same smooth loop. */
export function randomizeHandContour(random = Math.random) {
  const unit = () => {
    let value;
    try { value = typeof random === 'function' ? random() : .5; } catch { value = .5; }
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : .5;
  };
  const phase = unit() * TAU, secondPhase = unit() * TAU;
  const amplitude = .3 + .55 * unit(), mix = .15 + .3 * unit(), bias = (unit() - .5) * .3;
  return Array.from({ length: HAND_CONTOUR_POINTS }, (_, i) => {
    const angle = i * TAU / HAND_CONTOUR_POINTS;
    return signed(bias + amplitude * ((1 - mix) * Math.sin(angle + phase) + mix * Math.sin(2 * angle + secondPhase)));
  });
}
