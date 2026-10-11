import { MANDELBROT_COEFFICIENTS } from './mandelbrot-coefficients.js';

export const TAU = Math.PI * 2;
export const TABLE_SIZE = 2048;
export const HARMONICS = Object.freeze([512, 256, 128, 64, 32, 16, 8, 4, 2, 1]);
export const MODES = Object.freeze([
  { id: 'julia', label: 'Julia Vectors', color: '#61e9ce' },
  { id: 'mandelbrot', label: 'Mandelbrot Contours', color: '#ffba76' },
  { id: 'voyager', label: 'Bulb Voyager', color: '#c69bff' },
  { id: 'explorer', label: 'Contour Explorer', color: '#80d9ff' },
]);
export const SHAPES = Object.freeze({ basilica: [-1, 0], rabbit: [-.122561166876653, .744861766619744], circle: [0, 0], ellipse: [-2, 0], cardioid: null });
export const TRACE_VOICES = Object.freeze(['sine', 'reed', 'glass', 'shepard']);
export const DRUM_VOICES = Object.freeze(['thump', 'wood', 'metal']);
// Geometry-only starting points from ../julia/julia.js JULIA_PRESETS. These
// belong to the sampled Explorer; the Fourier modes keep their supported set.
export const EXPLORER_JULIA_PRESETS = Object.freeze([
  { id: 'basilica', label: 'Basilica', cReal: -1, cImag: 0 },
  { id: 'rabbit', label: 'Douady rabbit', cReal: -.12256116687665361, cImag: .7448617666197442 },
  { id: 'corabbit', label: 'Co-rabbit', cReal: -.12256116687665361, cImag: -.7448617666197442 },
  { id: 'airplane', label: 'Airplane', cReal: -1.7548776662466927, cImag: 0 },
  { id: 'san-marco', label: 'San Marco', cReal: -.75, cImag: 0 },
  { id: 'cauliflower', label: 'Cauliflower', cReal: .25, cImag: 0 },
  { id: 'siegel', label: 'Golden-mean Siegel disk', cReal: -.3905408702184, cImag: -.5867879073469687 },
  { id: 'spiral', label: 'Spiral · finite depth', cReal: -.7, cImag: .27015 },
  { id: 'listening', label: 'Listening default', cReal: -.788, cImag: .1191 },
  { id: 'circle', label: 'Unit circle', cReal: 0, cImag: 0 },
].map(Object.freeze));
export const DEFAULT_STATE = Object.freeze({ mode: 'julia', shape: 'basilica', radius: 1.075, detail: 256, depth: .88, angle: .22, component: 1, speed: .06, pitch: 110, rotation: 0, traversal: 'angle', readout: 'xy', vectors: true, reference: true,
  contourDomain: 'mandelbrot', cReal: -1, cImag: 0,
  viewX: -.5, viewY: 0, viewWidth: 3.4, contourBias: 0, contourQuality: 'live', strandX: null, strandY: null,
  contourReader: 'trace', traceRate: .1, featureSize: .015,
  travelerDirection: 'clockwise', travelerOctaves: 1,
  layerVoices: Object.freeze(['sine', 'reed', 'glass']), layerEnabled: Object.freeze([true, true, true]),
  layerSustain: Object.freeze([true, true, true]), layerDrums: Object.freeze([false, false, false]),
  layerDrumVoices: Object.freeze(['thump', 'wood', 'metal']),
  toneLevel: 1, drumLevel: .55, drumSpacing: .04, drumDecay: .18, drumPitch: 120,
  bendTimbre: .5, foldTimbre: 0, pitchDepth: 2, panWidth: 1,
  radarX: 0, radarY: 0, scanAngle: 0,
  shepardDirection: 'rise', shepardCycles: 1, shepardWidth: 1 });
export const CONTOUR_LANDMARKS = Object.freeze([
  { id: 'whole', label: 'Whole outline', x: -.5, y: 0, width: 3.4 },
  { id: 'seahorse', label: 'Seahorse Valley', x: -.743643887037151, y: .13182590420533, width: .015 },
  { id: 'filigree', label: 'Seahorse filigree', x: -.743643887037151, y: .13182590420533, width: .0005 },
]);
export const clamp = (v, low, high, fallback = low) => Math.max(low, Math.min(high, Number.isFinite(Number(v)) ? Number(v) : fallback));
export const wrap = v => ((v % 1) + 1) % 1;

export function sanitizeState(input = {}) {
  const s = { ...DEFAULT_STATE, ...input };
  return {
    mode: MODES.some(m => m.id === s.mode) ? s.mode : 'julia',
    shape: Object.hasOwn(SHAPES, s.shape) ? s.shape : 'basilica',
    radius: clamp(s.radius, 1.025, 1.8, DEFAULT_STATE.radius),
    detail: Math.round(clamp(s.detail, 8, 512, 256)),
    depth: clamp(s.depth, 0, .96, .88), angle: wrap(clamp(s.angle, 0, 1, .22)),
    component: Number(s.component) === 2 ? 2 : 1,
    speed: clamp(s.speed, .005, .4, .06), pitch: clamp(s.pitch, 25, 1200, 110),
    rotation: clamp(s.rotation, -180, 180, 0),
    traversal: s.traversal === 'distance' ? 'distance' : 'angle',
    readout: s.readout === 'mono' ? 'mono' : 'xy',
    vectors: Boolean(s.vectors), reference: Boolean(s.reference),
    contourDomain: s.contourDomain === 'julia' ? 'julia' : 'mandelbrot',
    cReal: clamp(s.cReal, -2, 2, -1), cImag: clamp(s.cImag, -2, 2, 0),
    viewX: clamp(s.viewX, -3, 3, -.5), viewY: clamp(s.viewY, -3, 3, 0),
    viewWidth: clamp(s.viewWidth, 1e-10, 5, 3.4), contourBias: clamp(s.contourBias, -8, 24, 0),
    contourQuality: s.contourQuality === 'fine' ? 'fine' : 'live',
    strandX: s.strandX == null ? null : clamp(s.strandX, -3, 3),
    strandY: s.strandY == null ? null : clamp(s.strandY, -3, 3),
    contourReader: ['trace', 'traveler', 'radar', 'scan', 'xy'].includes(s.contourReader) ? s.contourReader : 'trace',
    travelerDirection: s.travelerDirection === 'counterclockwise' ? 'counterclockwise' : 'clockwise',
    travelerOctaves: clamp(s.travelerOctaves, 0, 4, 1),
    traceRate: clamp(s.traceRate, .01, 1, .1), featureSize: clamp(s.featureSize, .002, .08, .015),
    layerVoices: DEFAULT_STATE.layerVoices.map((voice, i) => TRACE_VOICES.includes(s.layerVoices?.[i]) ? s.layerVoices[i] : voice),
    layerEnabled: DEFAULT_STATE.layerEnabled.map((_, i) => s.layerEnabled?.[i] !== false),
    layerSustain: DEFAULT_STATE.layerSustain.map((_, i) => s.layerSustain?.[i] !== false),
    layerDrums: DEFAULT_STATE.layerDrums.map((_, i) => s.layerDrums?.[i] === true),
    layerDrumVoices: DEFAULT_STATE.layerDrumVoices.map((voice, i) => DRUM_VOICES.includes(s.layerDrumVoices?.[i]) ? s.layerDrumVoices[i] : voice),
    toneLevel: clamp(s.toneLevel, 0, 1, 1), drumLevel: clamp(s.drumLevel, 0, 1, .55),
    drumSpacing: clamp(s.drumSpacing, .006, .2, .04), drumDecay: clamp(s.drumDecay, .02, 1.5, .18),
    drumPitch: clamp(s.drumPitch, 30, 1800, 120),
    bendTimbre: clamp(s.bendTimbre, 0, 1, .5), foldTimbre: clamp(s.foldTimbre, 0, 1, 0),
    pitchDepth: clamp(s.pitchDepth, 0, 4, 2), panWidth: clamp(s.panWidth, 0, 1, 1),
    radarX: clamp(s.radarX, -.5, .5, 0), radarY: clamp(s.radarY, -.5, .5, 0),
    scanAngle: clamp(s.scanAngle, -180, 180, 0),
    shepardDirection: s.shepardDirection === 'fall' ? 'fall' : 'rise',
    shepardCycles: clamp(s.shepardCycles, 0, 4, 1), shepardWidth: clamp(s.shepardWidth, .5, 2, 1),
  };
}

export function componentPoint(depth, phase, component = 1) {
  const x = depth * Math.cos(TAU * phase), y = depth * Math.sin(TAU * phase);
  return component === 2 ? [-1 + x / 4, y / 4] : [x / 2 - (x * x - y * y) / 4, y / 2 - x * y / 2];
}

export function juliaParameter(state, phase = 0) {
  if (state.mode === 'explorer' && state.contourDomain === 'julia') return [state.cReal, state.cImag];
  if (state.mode === 'voyager') return componentPoint(state.depth, phase + state.angle, state.component);
  return SHAPES[state.shape] ?? componentPoint(state.depth, state.angle);
}

/** b[n] multiplies w^(1-2n); comparing psi(w)^2+c = psi(w^2). */
export function juliaCoefficients(cr, ci, count) {
  const re = new Float64Array(count + 1), im = new Float64Array(count + 1);
  re[0] = 1;
  for (let n = 1; n <= count; n++) {
    let x = n % 2 === 0 ? re[n / 2] : 0;
    let y = n % 2 === 0 ? im[n / 2] : 0;
    if (n === 1) { x -= cr; y -= ci; }
    for (let k = 1; k < n; k++) {
      x -= re[k] * re[n - k] - im[k] * im[n - k];
      y -= re[k] * im[n - k] + im[k] * re[n - k];
    }
    re[n] = x / 2; im[n] = y / 2;
  }
  return { re, im };
}

/** Bounded radix-two complex transform; used only by the model worker/tests. */
export function fft(re, im, inverse = false) {
  const n = re.length;
  if (n !== im.length || n < 2 || (n & (n - 1))) throw new Error('FFT needs equal power-of-two arrays.');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let length = 2; length <= n; length *= 2) {
    const a = (inverse ? 1 : -1) * TAU / length, wr = Math.cos(a), wi = Math.sin(a);
    for (let start = 0; start < n; start += length) {
      let xr = 1, xi = 0;
      for (let j = 0; j < length / 2; j++) {
        const p = start + j, q = p + length / 2;
        const tr = xr * re[q] - xi * im[q], ti = xr * im[q] + xi * re[q];
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const next = xr * wr - xi * wi; xi = xr * wi + xi * wr; xr = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function distanceSamples(x, y) {
  const n = x.length, length = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) length[i + 1] = length[i] + Math.hypot(x[(i + 1) % n] - x[i], y[(i + 1) % n] - y[i]);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    const target = length[n] * i / n;
    while (j < n - 1 && length[j + 1] < target) j++;
    const mix = (target - length[j]) / Math.max(1e-20, length[j + 1] - length[j]);
    re[i] = x[j] + mix * (x[(j + 1) % n] - x[j]);
    im[i] = y[j] + mix * (y[(j + 1) % n] - y[j]);
  }
  return { re, im };
}

export function createFrame(input, phase = 0) {
  const s = sanitizeState(input), n = TABLE_SIZE;
  if (s.mode === 'explorer') throw new Error('Explorer sound requires an ordered traced contour.');
  let re = new Float64Array(n), im = new Float64Array(n);
  // IFFT convention: N*a[k] gives the coefficient a[k] in sampled z(theta).
  re[1] = n * s.radius;
  const c = juliaParameter(s, phase);
  if (s.mode === 'mandelbrot') {
    for (let k = 1; k <= s.detail; k++) re[n - k] = n * MANDELBROT_COEFFICIENTS[k] * s.radius ** -k;
    // b0=-1/2 is geometric translation, intentionally removed from BOTH XY axes.
  } else {
    const b = juliaCoefficients(...c, Math.floor((s.detail + 1) / 2));
    for (let j = 1; j < b.re.length; j++) {
      const k = 1 - 2 * j, scale = n * s.radius ** k;
      re[n + k] = b.re[j] * scale; im[n + k] = b.im[j] * scale;
    }
  }
  let x = re.slice(), y = im.slice(); fft(x, y, true);
  if (s.traversal === 'distance') {
    ({ re, im } = distanceSamples(x, y)); fft(re, im);
  }
  return frameFromSpectrum(re, im, c);
}

/** Shared normalization and bandwidth bank for analytic and traced XY paths. */
export function frameFromSpectrum(re, im, c = [0, 0]) {
  const n = TABLE_SIZE;
  if (re.length !== n || im.length !== n) throw new Error('Unexpected contour table size.');
  re[0] = 0; im[0] = 0;
  const x = re.slice(), y = im.slice(); fft(x, y, true);
  let energy = 0, peak = 0;
  for (let i = 0; i < n; i++) { energy += x[i] ** 2 + y[i] ** 2; peak = Math.max(peak, Math.hypot(x[i], y[i])); }
  // Common XY gain preserves aspect ratio. Leave headroom for interpolation.
  const gain = energy < 1e-24 ? 0 : Math.min(.8 / Math.sqrt(energy / n), 1.5 / peak);
  if (!Number.isFinite(gain)) throw new Error('The contour did not converge. Increase clearance.');
  for (let i = 0; i < n; i++) { re[i] *= gain; im[i] *= gain; x[i] *= gain; y[i] *= gain; }
  const tables = HARMONICS.map(limit => {
    const a = re.slice(), b = im.slice();
    for (let i = limit + 1; i < n - limit; i++) { a[i] = 0; b[i] = 0; }
    fft(a, b, true);
    return { x: Float32Array.from(a), y: Float32Array.from(b) };
  });
  return { c, sourceX: Float32Array.from(x), sourceY: Float32Array.from(y),
    spectrumRe: Float32Array.from(re, v => v / n), spectrumIm: Float32Array.from(im, v => v / n), tables };
}

export function createBank(input) {
  const state = sanitizeState(input);
  const frames = Array.from({ length: state.mode === 'voyager' ? 48 : 1 }, (_, i) => createFrame(state, i / 48));
  return { state, frames };
}

// Pitch-independent mip tables leave a generous sideband/transition margin.
export function mipSelection(frequency, sampleRate) {
  const ceiling = sampleRate * .42 / Math.max(1, frequency);
  let index = HARMONICS.findIndex(h => h <= ceiling);
  if (index < 0) index = HARMONICS.length - 1;
  return { index, mix: clamp((ceiling / HARMONICS[index] - 1) / .4, 0, 1) };
}

export function randomizeState(_previous, random = Math.random) {
  const pick = list => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  const landmark = pick(CONTOUR_LANDMARKS);
  const contourDomain = pick(['mandelbrot', 'julia']);
  const julia = pick(EXPLORER_JULIA_PRESETS);
  const layerEnabled = DEFAULT_STATE.layerEnabled.map(() => random() > .25);
  const layerSustain = DEFAULT_STATE.layerSustain.map(() => random() > .35);
  const layerDrums = DEFAULT_STATE.layerDrums.map(() => random() > .4);
  if (!layerEnabled.some((enabled, i) => enabled && (layerSustain[i] || layerDrums[i]))) {
    const i = pick([0, 1, 2]);
    layerEnabled[i] = true;
    pick([layerSustain, layerDrums])[i] = true;
  }
  return sanitizeState({ mode: pick(MODES).id, shape: pick(Object.keys(SHAPES)),
    contourDomain, cReal: julia.cReal, cImag: julia.cImag,
    radius: 1.03 + random() ** 2 * .65, detail: pick([32, 64, 128, 256, 512]),
    depth: random() * .96, angle: random(), component: pick([1, 2]), speed: .005 + random() ** 2 * .395,
    pitch: 30 * (1200 / 30) ** random(), rotation: random() * 360 - 180,
    traversal: pick(['angle', 'distance']), readout: pick(['xy', 'mono']), vectors: random() > .3, reference: random() > .2,
    viewX: contourDomain === 'julia' ? 0 : landmark.x + (random() - .5) * landmark.width * .12,
    viewY: contourDomain === 'julia' ? 0 : landmark.y + (random() - .5) * landmark.width * .12,
    viewWidth: contourDomain === 'julia' ? 4.2 : landmark.width * (.7 + random() * .6), contourBias: -5 + random() * 25,
    contourQuality: pick(['live', 'fine']), strandX: contourDomain === 'julia' ? null : landmark.x, strandY: contourDomain === 'julia' ? null : landmark.y,
    contourReader: pick(['trace', 'traveler', 'radar', 'scan', 'xy']),
    travelerDirection: pick(['clockwise', 'counterclockwise']), travelerOctaves: random() < .1 ? 0 : .25 * 16 ** random(), traceRate: .02 * 30 ** random(), featureSize: .002 * 40 ** random(),
    layerVoices: DEFAULT_STATE.layerVoices.map(() => pick(TRACE_VOICES)),
    layerDrumVoices: DEFAULT_STATE.layerDrumVoices.map(() => pick(DRUM_VOICES)),
    layerEnabled, layerSustain, layerDrums,
    toneLevel: .3 + random() * .7, drumLevel: .25 + random() * .65,
    drumSpacing: .018 * (.1 / .018) ** random(), drumDecay: .03 * 30 ** random(),
    drumPitch: 45 * 20 ** random(), bendTimbre: random(), foldTimbre: random(),
    pitchDepth: random() * 4, panWidth: random(), radarX: random() - .5, radarY: random() - .5,
    scanAngle: random() * 360 - 180, shepardDirection: pick(['rise', 'fall']),
    shepardCycles: random() < .15 ? 0 : .25 * 16 ** random(), shepardWidth: .5 + random() * 1.5 });
}

export const PRESETS = Object.freeze([
  ['basilica', 'Julia · Basilica bass', { pitch: 65, radius: 1.04 }],
  ['outer', 'Mandelbrot · Rounded orbit', { mode: 'mandelbrot', radius: 1.6, pitch: 164 }],
  ['voyage', 'Voyager · Cardioid drift', { mode: 'voyager', depth: .94, pitch: 98, radius: 1.04, speed: .045 }],
  ['rabbit', 'Julia · Rabbit filigree', { shape: 'rabbit', radius: 1.035, pitch: 147, detail: 512 }],
  ['near', 'Mandelbrot · Close encounter', { mode: 'mandelbrot', radius: 1.025, detail: 512, pitch: 52 }],
  ['bulb', 'Voyager · Period-two tide', { mode: 'voyager', component: 2, radius: 1.045, pitch: 82, speed: .11 }],
  ['circle', 'Julia · Pure circle', { shape: 'circle', pitch: 220 }],
  ['distance', 'Mandelbrot · Distance scanner', { mode: 'mandelbrot', traversal: 'distance', pitch: 123, radius: 1.03, detail: 512 }],
  ['ellipse', 'Julia · Ellipse / same harmonic', { shape: 'ellipse', radius: 1.15, pitch: 110, rotation: 35 }],
  ['flurry', 'Voyager · Fast bloom', { mode: 'voyager', depth: .95, speed: .35, pitch: 193, radius: 1.035, traversal: 'distance' }],
  ['safe', 'Julia · Cardioid explorer', { shape: 'cardioid', depth: .95, angle: .37, radius: 1.035, pitch: 76 }],
  ['projection', 'Mandelbrot · Mono silhouette', { mode: 'mandelbrot', readout: 'mono', rotation: 70, radius: 1.04, pitch: 330 }],
  ['explore', 'Explorer · Whole outline', { mode: 'explorer', pitch: 82, detail: 512 }],
  ['seahorse', 'Explorer · Seahorse Valley', { mode: 'explorer', viewX: -.743643887037151, viewY: .13182590420533, viewWidth: .015, pitch: 65, detail: 512 }],
  ['filigree', 'Explorer · Seahorse filigree', { mode: 'explorer', viewX: -.743643887037151, viewY: .13182590420533, viewWidth: .0005, pitch: 41, detail: 512, contourQuality: 'fine' }],
  ['trace-glass', 'Explorer · Glass curls', { mode: 'explorer', viewX: -.743643887037151, viewY: .13182590420533, viewWidth: .015, pitch: 164, traceRate: .16, featureSize: .005, layerVoices: ['reed', 'glass', 'sine'] }],
  ['radar-drums', 'Explorer · Radar percussion', { mode: 'explorer', contourReader: 'radar', traceRate: .12, layerSustain: [false, false, false], layerDrums: [true, true, true], drumSpacing: .055, drumDecay: .14, drumPitch: 95, drumLevel: .65, bendTimbre: .75, foldTimbre: .35, radarX: -.08, radarY: .04 }],
  ['scan-mixed', 'Explorer · Scan and shimmer', { mode: 'explorer', contourReader: 'scan', pitch: 147, traceRate: .08, scanAngle: 35, layerVoices: ['sine', 'reed', 'glass'], layerSustain: [true, false, true], layerDrums: [true, true, true], toneLevel: .65, drumLevel: .4, drumSpacing: .07, drumDecay: .3, drumPitch: 180, pitchDepth: 1.2, bendTimbre: .65, foldTimbre: .6 }],
  ['shepard-rise', 'Explorer · Endless ascent', { mode: 'explorer', contourReader: 'radar', pitch: 110, traceRate: .055, layerVoices: ['shepard', 'shepard', 'shepard'], layerEnabled: [true, true, false], toneLevel: .7, bendTimbre: .3, foldTimbre: .5, pitchDepth: .4, panWidth: .75, shepardDirection: 'rise', shepardCycles: 1.5, shepardWidth: 1.25 }],
  ['traveler', 'Explorer · Border traveler', { mode: 'explorer', contourReader: 'traveler', pitch: 110, traceRate: .075, featureSize: .012, layerVoices: ['shepard', 'shepard', 'shepard'], toneLevel: .7, bendTimbre: .35, foldTimbre: .2, travelerOctaves: 1, shepardWidth: 1.2 }],
  ['explore-xy', 'Explorer · XY waveform', { mode: 'explorer', pitch: 82, contourReader: 'xy' }],
].map(([id, label, patch]) => ({ id, label, snapshot: sanitizeState({ ...DEFAULT_STATE, ...patch }) })));
