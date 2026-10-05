// Optional gated breakpoint envelope. Legacy four-number ADSR stays unchanged.
export const ENVELOPE_POINT_LIMIT = 64;
export const ENVELOPE_POINT_GAP = .001;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function sanitizeEnvelopePoints(points) {
  if (!Array.isArray(points) || points.length !== 5) return null;
  const result = [];
  for (let index = 0; index < 5; index++) {
    const minimum = index ? result[index - 1].time + ENVELOPE_POINT_GAP : 0;
    result.push({ time: clamp(finite(points[index]?.time, minimum), minimum,
      ENVELOPE_POINT_LIMIT - (4 - index) * ENVELOPE_POINT_GAP),
    level: clamp(finite(points[index]?.level, 0), 0, 1) });
  }
  return result;
}

export function pointsFromEnvelope(envelope) {
  const points = sanitizeEnvelopePoints(envelope?.points);
  if (points) return points;
  const attack = finite(envelope?.attack, .018), decay = finite(envelope?.decay, .22);
  const sustain = finite(envelope?.sustain, .8), release = finite(envelope?.release, .35);
  // The flat S span is illustrative for old ADSR: the actual hold ends at gate-off.
  const hold = attack + decay + .35;
  return sanitizeEnvelopePoints([{ time: 0, level: 0 }, { time: attack, level: 1 },
    { time: attack + decay, level: sustain }, { time: hold, level: sustain },
    { time: hold + release, level: 0 }]);
}

export function envelopeFromBreakpoints(value) {
  const points = sanitizeEnvelopePoints(value);
  if (!points) throw new TypeError('An amplitude shape needs five points.');
  return { attack: clamp(points[1].time, .001, 12),
    decay: clamp(points[2].time - points[1].time, .002, 12),
    sustain: points[3].level, release: clamp(points[4].time - points[3].time, .003, 16), points };
}

export function envelopeGateSeconds(envelope) {
  return envelope?.points?.length === 5 ? envelope.points[3].time
    : (envelope?.attack ?? .018) + (envelope?.decay ?? .22);
}
