import { defaultParameters, normalizeParams, RANGES } from './parameters.js';
export { normalizeParams, RANGES };
// Drawn, closed contours. Coordinates and arc length share a square 0–1 stage.
export const MAX_BLOBS = 6;
export const MAX_POINTS = 256;
export const PATH_SAMPLES = 256;
export const SCENE_VERSION = 4;
export const COLORS = ['#64e6c4', '#b59aff', '#ffb76b', '#79baff', '#ff86ad', '#d5e879'];
export const DEFAULTS = Object.freeze(defaultParameters());
export const clamp = (n, low, high) => Math.max(low, Math.min(high, Number.isFinite(n) ? n : low));
export const wrap = n => ((n % 1) + 1) % 1;
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function cleanPoints(points) {
  const result = [];
  for (const p of (Array.isArray(points) ? points : []).slice(0, 4096)) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const next = { x: clamp(p.x, .02, .98), y: clamp(p.y, .02, .98), hx: clamp(Number(p.hx ?? 0), -1, 1), hy: clamp(Number(p.hy ?? 0), -1, 1) };
    if (Number.isFinite(p.inHx)) next.inHx = clamp(p.inHx, -1, 1);
    if (Number.isFinite(p.inHy)) next.inHy = clamp(p.inHy, -1, 1);
    if (!result.length || distance(next, result.at(-1)) > .001) result.push(next);
  }
  if (result.length > 1 && distance(result[0], result.at(-1)) < .001) result.pop();
  if (result.length > MAX_POINTS) return Array.from({ length: MAX_POINTS }, (_, i) => result[Math.floor(i * result.length / MAX_POINTS)]);
  return result;
}

export function contourVertices(blob) {
  const points = cleanPoints(blob.points);
  if (blob.tool !== 'pen') return points;
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = 0; j < 16; j++) {
      const t = j / 16, u = 1 - t;
      result.push({
        x: clamp(u ** 3 * a.x + 3 * u * u * t * (a.x + a.hx) + 3 * u * t * t * (b.x + (b.inHx ?? -b.hx)) + t ** 3 * b.x, .02, .98),
        y: clamp(u ** 3 * a.y + 3 * u * u * t * (a.y + a.hy) + 3 * u * t * t * (b.y + (b.inHy ?? -b.hy)) + t ** 3 * b.y, .02, .98),
      });
    }
  }
  return result;
}

export function buildPath(blob) {
  if (cleanPoints(blob.points).length < 3) return null;
  const points = contourVertices(blob);
  if (points.length < 3) return null;
  const lengths = [0];
  for (let i = 0; i < points.length; i++) lengths.push(lengths.at(-1) + distance(points[i], points[(i + 1) % points.length]));
  const length = lengths.at(-1);
  if (length < .06) return null;
  const samples = new Float32Array(PATH_SAMPLES * 2);
  const locations = [];
  let segment = 0;
  for (let i = 0; i < PATH_SAMPLES; i++) {
    const target = length * i / PATH_SAMPLES;
    while (segment < points.length - 1 && lengths[segment + 1] <= target) segment++;
    const a = points[segment], b = points[(segment + 1) % points.length];
    const t = (target - lengths[segment]) / Math.max(1e-9, lengths[segment + 1] - lengths[segment]);
    samples[i * 2] = a.x + (b.x - a.x) * t;
    samples[i * 2 + 1] = a.y + (b.y - a.y) * t;
    const subdivisions = blob.tool === 'pen' ? 16 : 1;
    locations.push({ segment: Math.floor(segment / subdivisions), t: (segment % subdivisions + t) / subdivisions });
  }
  return { samples, length, locations };
}

export function pointAt(samples, phase, result = {}) {
  const count = samples.length / 2, at = wrap(phase) * count;
  const a = Math.floor(at), b = (a + 1) % count, mix = at - a;
  result.x = samples[a * 2] + (samples[b * 2] - samples[a * 2]) * mix;
  result.y = samples[a * 2 + 1] + (samples[b * 2 + 1] - samples[a * 2 + 1]) * mix;
  return result;
}

export function phaseAt(clock, time, params) {
  return wrap(clock.phase + (clock.playing ? Math.max(0, time - clock.time) * params.speed * params.traversalDirection : 0));
}

export function frequencyAt(y, params) {
  return clamp(params.baseFrequency * 2 ** ((.5 - y) * params.pitchRange), 20, 6000);
}

export function demoBlobs() {
  return [{ tool: 'pen', points: [
    { x: .27, y: .28, hx: .13, hy: -.08 },
    { x: .76, y: .29, hx: .09, hy: .1 },
    { x: .67, y: .66, hx: -.12, hy: .02 },
    { x: .34, y: .79, hx: -.13, hy: -.05 },
    { x: .18, y: .53, hx: .04, hy: -.12 },
  ] }];
}

export function normalizeScene(value) {
  if (![1, 2, 3, SCENE_VERSION].includes(value?.version) || !Array.isArray(value.blobs)) return null;
  const blobs = value.blobs.slice(0, MAX_BLOBS).map(blob => {
    const normalized = { tool: ['pen', 'pencil', 'line'].includes(blob?.tool) ? blob.tool : 'line', points: cleanPoints(blob?.points) };
    if (blob?.offset && typeof blob.offset === 'object') normalized.offset = {
      x: Number.isFinite(blob.offset.x) ? clamp(blob.offset.x, -1, 1) : 0,
      y: Number.isFinite(blob.offset.y) ? clamp(blob.offset.y, -1, 1) : 0,
    };
    return normalized;
  }).filter(blob => buildPath(blob));
  const parameters = value.version === 1
    ? { ...value.params, stereoWidth: value.params?.spread ?? 1, traversalDirection: value.params?.reverse ? -1 : 1, amplitudeEnvelopeEnabled: false }
    : value.params;
  return { version: SCENE_VERSION, blobs, params: normalizeParams(parameters) };
}
