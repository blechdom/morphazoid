import { DEFAULT_PARAMETERS, sanitizeParameters } from './model.js';

// Complete musical states: no input gain, output level, file, mic permission,
// playback flags or measured device policy is recalled with a geometry preset.
const preset = (id, label, parameters) => Object.freeze({ id, label, name: label,
  parameters: Object.freeze(sanitizeParameters({ ...DEFAULT_PARAMETERS, ...parameters })) });
export const PRESETS = Object.freeze([
  preset('root-cloud', 'Root Cloud', { mode: 'inverse', cReal: -.745, cImag: .113, detail: 6, timeMs: 140, coupling: .82, decay: .84, pickup: .7 }),
  preset('rabbit-echoes', 'Rabbit Echoes', { mode: 'inverse', cReal: -.123, cImag: .745, detail: 7, timeMs: 310, coupling: .94, decay: .9, pitchOffset: 3.7, pickup: .85 }),
  preset('glass-dendrite', 'Glass Dendrite', { mode: 'inverse', cReal: -1.79, cImag: .012, detail: 8, timeMs: 3.2, coupling: .87, decay: .92, pitchOffset: -5.1, pickup: .46 }),
  preset('dust-forks', 'Dust Forks', { mode: 'inverse', cReal: .36, cImag: .64, detail: 6, timeMs: 72, coupling: .67, decay: .72, pitchOffset: 8.3, pickup: .97 }),
  preset('round-trip', 'Round Trip', { mode: 'contours', cReal: 0, cImag: 0, detail: 5, timeMs: 520, coupling: .99, decay: .88, pickup: .24 }),
  preset('ivy-circulation', 'Ivy Circulation', { mode: 'contours', cReal: -.8, cImag: .156, detail: 8, timeMs: 94, coupling: .96, decay: .93, pitchOffset: -.8, pickup: .62 }),
  preset('metal-orbits', 'Metal Orbits', { mode: 'contours', cReal: -.52, cImag: .56, detail: 7, timeMs: .7, coupling: .91, decay: .96, pitchOffset: 1.3, pickup: .79 }),
  preset('mandelbrot-moat', 'Mandelbrot Moat', { mode: 'contours', domain: 'mandelbrot', cReal: -.75, cImag: 0, detail: 9, timeMs: 250, coupling: .88, decay: .91, pitchOffset: -2.4, pickup: .53 }),
  preset('two-step', 'Two Step', { mode: 'orbits', cReal: -1, cImag: 0, detail: 4, timeMs: 430, coupling: 1, decay: .9, pickup: 1 }),
  preset('rabbit-cycle', 'Rabbit Cycle', { mode: 'orbits', cReal: -.122561, cImag: .744862, detail: 8, timeMs: 280, coupling: .97, decay: .92, pitchOffset: 4.2, pickup: .6 }),
  preset('four-way-return', 'Four-Way Return', { mode: 'orbits', cReal: -1.310702, cImag: 0, detail: 8, timeMs: 170, coupling: .96, decay: .88, pitchOffset: -3.6, pickup: .75 }),
  preset('chaotic-walk', 'Chaotic Walk', { mode: 'orbits', cReal: -.745, cImag: .113, detail: 10, timeMs: 58, coupling: .91, decay: .79, pitchOffset: 6.1, pickup: .9 }),
  preset('ray-garden', 'Ray Garden', { mode: 'rays', cReal: -.4, cImag: .6, detail: 6, timeMs: 175, coupling: .96, decay: .88, pickup: .68 }),
  preset('polar-glass', 'Polar Glass', { mode: 'rays', cReal: 0, cImag: 0, detail: 9, timeMs: 1.8, coupling: .94, decay: .95, pitchOffset: 2.2, pickup: .82 }),
  preset('rabbit-tunnels', 'Rabbit Tunnels', { mode: 'rays', cReal: -.123, cImag: .745, detail: 8, timeMs: 360, coupling: .99, decay: .9, pitchOffset: -1.7, pickup: .33 }),
  preset('parameter-lattice', 'Parameter Lattice', { mode: 'rays', domain: 'mandelbrot', cReal: -1.2, cImag: .2, detail: 7, timeMs: 105, coupling: .87, decay: .83, pickup: .76 }),
  preset('round-chamber', 'Round Chamber', { mode: 'membrane', cReal: 0, cImag: 0, detail: 8, timeMs: 4.8, coupling: .97, decay: .93, pickup: .87 }),
  preset('basilica-drum', 'Basilica Drum', { mode: 'membrane', cReal: -1, cImag: 0, detail: 10, timeMs: 2.4, coupling: .92, decay: .89, pitchOffset: -2.6, pickup: .65 }),
  preset('parameter-cavern', 'Parameter Cavern', { mode: 'membrane', domain: 'mandelbrot', cReal: -.5, cImag: .3, detail: 11, timeMs: 37, coupling: .98, decay: .96, pickup: .92 }),
  preset('dust-resonator', 'Dust Resonator', { mode: 'membrane', cReal: .38, cImag: .61, detail: 9, timeMs: .24, coupling: .83, decay: .82, pitchOffset: 7.4, pickup: .56 }),
]);
export const DEFAULT_PRESET = PRESETS[0];
