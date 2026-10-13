// Musical settings are preset-owned; captured input curves are bounded snapshots.
export const MOTIF_DEFAULTS = Object.freeze({
  travelerMode: 'path', travelerDetrend: false,
  motifCenter: .5, motifSpan: .18, motifDetail: .015, motifTiming: 'normalized',
  motifMirror: false, motifReverse: false, motifElastic: 0, motifSameVoice: true,
  motifScaleCue: 'off', motifScaleAmount: .5, motifOrientation: 0,
  motifDetailGain: 2, motifCaptures: Object.freeze([]),
  drumPlacement: 'distance', drumTurnStep: 30, drumTurnColor: true,
});
const bound = (value, low, high, fallback) => Number.isFinite(Number(value)) ? Math.max(low, Math.min(high, Number(value))) : fallback;
const choice = (value, values, fallback) => values.includes(value) ? value : fallback;

export function sanitizeCapture(input) {
  if (!input || !input.points || !Number.isInteger(input.points.length) || input.points.length < 8 || input.points.length > 4096 || input.points.length % 2) return null;
  const points = Array.from(input.points);
  if (points.some(value => !Number.isFinite(value) || Math.abs(value) > 16)) return null;
  const source = input.source ?? {}, view = source.view ?? {};
  return { points, closed: Boolean(input.closed),
    ...(input.sourcePositions?.length === points.length / 2
      ? { sourcePositions: Array.from(input.sourcePositions, value => bound(value, -2, 2, 0)) } : {}),
    source: { view: { x: bound(view.x, -4, 4, 0), y: bound(view.y, -4, 4, 0), width: bound(view.width, 1e-12, 8, 3.4), aspect: bound(view.aspect, .1, 10, 1) },
      domain: source.domain === 'julia' ? 'julia' : 'mandelbrot', cReal: bound(source.cReal, -2, 2, 0), cImag: bound(source.cImag, -2, 2, 0),
      pathIndex: Math.round(bound(source.pathIndex, -1, 100000, -1)), start: bound(source.start, -1, 1, 0), span: bound(source.span, .001, 1, 1),
      depth: bound(source.depth, 0, 1024, 0), center: bound(source.center, 0, 1, ((Number(source.start) || 0) + (Number(source.span) || 1) / 2 + 1) % 1),
      pathClosed: Boolean(source.pathClosed), pathLength: bound(source.pathLength, 1e-16, 128, 1),
      example: typeof source.example === 'string' ? source.example.slice(0, 60) : '',
    } };
}

export function sanitizeMotifState(input = {}) {
  const s = { ...MOTIF_DEFAULTS, ...input };
  return {
    travelerMode: choice(s.travelerMode, ['path', 'compare', 'choir', 'detail'], 'path'), travelerDetrend: s.travelerDetrend === true,
    motifCenter: bound(s.motifCenter, 0, 1, .5), motifSpan: bound(s.motifSpan, .02, 1, .18), motifDetail: bound(s.motifDetail, .002, .12, .015),
    motifTiming: s.motifTiming === 'original' ? 'original' : 'normalized',
    motifMirror: s.motifMirror === true, motifReverse: s.motifReverse === true, motifElastic: bound(s.motifElastic, 0, .12, 0),
    motifSameVoice: s.motifSameVoice !== false,
    motifScaleCue: choice(s.motifScaleCue, ['off', 'register', 'timbre'], 'off'), motifScaleAmount: bound(s.motifScaleAmount, 0, 1, .5),
    motifOrientation: bound(s.motifOrientation, 0, 1, 0), motifDetailGain: bound(s.motifDetailGain, 0, 6, 2),
    motifCaptures: Array.from({ length: Math.min(3, s.motifCaptures?.length ?? 0) }, (_, i) => sanitizeCapture(s.motifCaptures[i])),
    drumPlacement: s.drumPlacement === 'turn' ? 'turn' : 'distance', drumTurnStep: bound(s.drumTurnStep, 5, 180, 30), drumTurnColor: s.drumTurnColor === true,
  };
}

export function randomMotifState(random = Math.random) {
  const pick = values => values[Math.min(values.length - 1, Math.floor(random() * values.length))];
  return { travelerMode: pick(['path', 'compare', 'choir', 'detail']), travelerDetrend: random() > .5,
    motifCenter: random(), motifSpan: .06 + random() * .8, motifDetail: .003 * 30 ** random(), motifTiming: pick(['normalized', 'original']),
    motifMirror: random() > .5, motifReverse: random() > .5, motifElastic: random() < .5 ? 0 : random() * .12,
    motifSameVoice: random() > .35,
    motifScaleCue: pick(['off', 'register', 'timbre']), motifScaleAmount: random(), motifOrientation: random() < .5 ? 0 : random(),
    motifDetailGain: random() * 5, motifCaptures: [], drumPlacement: pick(['distance', 'turn']), drumTurnStep: 10 + random() * 100, drumTurnColor: random() > .5 };
}
