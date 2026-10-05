import { defaultParameters, normalizeParams, RANGES, CHOICES } from './parameters.js';
import { amplitudeEnvelopePreset, percussionEnvelopePreset } from '../../audio.js';
import { mappingCurvePreset } from '../../mapping.js';
import { canonicalHeadOffsets } from '../../playheads.js';
import { presetRandom } from '../../site/preset-random.js';

function inkLoop(seed, { count = 7, x = .5, y = .5, size = .32, tool = 'pen' } = {}) {
  const points = Array.from({ length: count }, (_, i) => {
    const a = i * Math.PI * 2 / count - Math.PI / 2;
    const radius = size * (1 + .2 * Math.sin(a * 3 + seed) + .13 * Math.cos(a * 2 + seed * .7));
    return { x: Math.max(.04, Math.min(.96, x + Math.cos(a) * radius)), y: Math.max(.04, Math.min(.96, y + Math.sin(a) * radius)) };
  });
  return { tool, points: points.map((p, i) => {
    const a = points[(i - 1 + count) % count], b = points[(i + 1) % count];
    return { ...p, hx: tool === 'pen' ? (b.x - a.x) * .17 : 0, hy: tool === 'pen' ? (b.y - a.y) * .17 : 0 };
  }) };
}
function scene(index, soundMode, options) {
  const { layout = 'one', tool = 'pen', count = 7, ...patch } = options;
  const blobs = layout === 'one' ? [inkLoop(index * .7, { tool, count })]
    : layout === 'pair' ? [inkLoop(index, { x: .32, y: .38, size: .21, tool, count }), inkLoop(index + 3, { x: .69, y: .64, size: .2, tool, count: count + 1 })]
      : [inkLoop(index, { x: .28, y: .32, size: .17, tool, count }), inkLoop(index + 2, { x: .72, y: .36, size: .18, tool, count: count + 1 }), inkLoop(index + 4, { x: .5, y: .72, size: .18, tool, count: count + 2 })];
  const params = { ...defaultParameters(), soundMode, ...patch };
  params.headOffsets = patch.headOffsets ?? canonicalHeadOffsets(params.heads);
  params.amplitudeEnvelopePoints = amplitudeEnvelopePreset(params.amplitudePreset);
  params.percussionEnvelopePoints = percussionEnvelopePreset(params.percussionPreset);
  params.pitchCurveNodes = mappingCurvePreset(params.pitchCurvePreset);
  return { version: 3, blobs, params: normalizeParams(params) };
}
const definitions = [
  ['Ink pool', 'sine', { speed: .13, amplitudePreset: 'pad', pitchRange: 1.6 }],
  ['Two soft voices', 'sine', { layout: 'pair', heads: 2, speed: .19, amplitudePreset: 'sustain', baseFrequency: 94, pitchRange: 2.2 }],
  ['Corner droplets', 'sine', { tool: 'line', count: 9, amplitudePreset: 'pluck', speed: .21, pitchRange: 3.5 }],
  ['Turning tide', 'sine', { autoRotate: true, rotationSpeed: .06, speed: .09, amplitudeEnvelopeEnabled: false, heads: 3, pitchSource: 'horizontal' }],
  ['Three puddles', 'sine', { layout: 'trio', speed: .15, heads: 1, amplitudePreset: 'note', stereoInverted: true, pitchCurvePreset: 'smooth' }],
  ['Soft pendulum', 'sine', { motionMode: 'pingpong', speed: .18, cornerSwell: true, amplitudePreset: 'pad', aspect: -.45, pitchRange: 4 }],
  ['Bent copper', 'fm', { fmIndex: 4.2, fmRatio: 1.37, speed: .24, amplitudePreset: 'pluck', cornerMode: 'even', corners: 9 }],
  ['Rubber bass', 'fm', { baseFrequency: 49, pitchRange: 2.4, fmIndex: 2.1, fmRatio: .5, amplitudePreset: 'note', tool: 'line', count: 5 }],
  ['Orbiting reeds', 'fm', { layout: 'pair', autoRotate: true, rotationSpeed: .11, heads: 2, fmRatio: 2.7, fmIndexSource: 'height', amplitudePreset: 'sustain', speed: .08 }],
  ['Ink scanner', 'fm', { playMethod: 'scan', heads: 2, fmIndex: 7, fmIndexSource: 'incidence', speed: .17, amplitudeEnvelopeEnabled: false, pitchSource: 'center' }],
  ['Folded brass', 'fm', { fmRatio: 1.1, fmIndex: 5.5, fmIndexSource: 'corner', tool: 'line', count: 11, speed: .32, skew: .4, amplitudePreset: 'note' }],
  ['Warm radar', 'fm', { playMethod: 'radial', heads: 3, speed: .1, fmIndex: 1.8, fmRatio: 3.1, amplitudePreset: 'sustain', baseFrequency: 86 }],
  ['Glass scribble', 'pm', { pmIndex: 3.7, pmRatio: 2.63, amplitudePreset: 'pluck', cornerMode: 'even', corners: 11, speed: .23 }],
  ['Thread of light', 'pm', { pmIndex: 1.2, pmRatio: .75, pitchRange: 4.2, speed: .08, amplitudePreset: 'pad' }],
  ['Liquid wire', 'pm', { pmIndex: 6.4, pmDepthSource: 'horizontal', pmRatio: 1.41, autoRotate: true, rotationSpeed: .04, amplitudePreset: 'sustain', heads: 2 }],
  ['Three bent bells', 'pm', { layout: 'trio', pmRatio: 4.35, pmIndex: 2.4, amplitudePreset: 'pluck', speed: .28, cornerMode: 'even', corners: 5 }],
  ['Wavering scan', 'pm', { playMethod: 'scan', motionMode: 'pingpong', speed: .16, heads: 2, pmDepthSource: 'center', pmIndex: 4, amplitudePreset: 'note' }],
  ['Spinning filament', 'pm', { autoRotate: true, rotationSpeed: .18, rotationMotionMode: 'pingpong', speed: .07, pmRatio: 1.9, pmIndex: 2.7, amplitudePreset: 'pad', stereoSource: 'vertical' }],
  ['Endless ink', 'shepard', { shepardCycles: 1, speed: .1, amplitudeEnvelopeEnabled: false, shepardWidth: 4.8 }],
  ['Down the drain', 'shepard', { shepardDirection: -1, shepardCycles: 2.4, speed: .15, heads: 2, amplitudeEnvelopeEnabled: false }],
  ['Every bend', 'shepard', { shepardMapping: 'turn', shepardTurnGlide: .65, shepardCycles: 1.6, speed: .13, amplitudePreset: 'sustain', tool: 'line', count: 10 }],
  ['Tidal staircase', 'shepard', { motionMode: 'pingpong', speed: .2, shepardCycles: 3.2, amplitudePreset: 'pad', baseFrequency: 77 }],
  ['Countercurrent', 'shepard', { layout: 'pair', heads: 2, traceHeadDirections: [1, -1, ...Array(10).fill(1)], shepardCycles: 1.8, speed: .16, amplitudeEnvelopeEnabled: false }],
  ['Turning horizon', 'shepard', { autoRotate: true, rotationSpeed: .035, shepardMapping: 'turn', shepardCycles: .6, shepardWidth: 6.5, speed: .11, amplitudePreset: 'sustain' }],
  ['Ink taps', 'percussion', { tool: 'line', count: 8, speed: .25, percussionLevelSource: 'fixed', percussionAttackNoise: .15, baseFrequency: 140, pitchRange: 3 }],
  ['Pebble rain', 'percussion', { layout: 'trio', cornerMode: 'even', corners: 7, heads: 2, speed: .17, percussionLevelSource: 'height', percussionAttackNoise: .35, baseFrequency: 215, pitchRange: 4 }],
  ['Slow hollow knocks', 'percussion', { cornerMode: 'even', corners: 5, speed: .12, baseFrequency: 47, pitchRange: 1.8, percussionLevelSource: 'fixed', percussionPreset: 'note', percussionStrikeLevel: .7 }],
  ['Clockwork puddle', 'percussion', { cornerMode: 'even', corners: 13, speed: .31, heads: 2, percussionLevelSource: 'fixed', percussionAttackNoise: .6, pitchSource: 'center' }],
  ['Corner radar', 'percussion', { playMethod: 'radial', tool: 'line', count: 7, autoRotate: true, rotationSpeed: .035, speed: .21, percussionLevelSource: 'fixed', percussionPreset: 'note', heads: 2 }],
  ['Brushed crossings', 'percussion', { playMethod: 'scan', tool: 'line', layout: 'pair', count: 9, speed: .16, motionMode: 'pingpong', heads: 2, percussionLevelSource: 'incidence', percussionAttackNoise: .8, percussionPreset: 'pad' }],
];
export const BLOB_PRESETS = definitions.map(([label, mode, options], i) => ({ id: `blobs-${i + 1}`, label, snapshot: scene(i + 1, mode, options) }));

/** Whole-scene randomization, with no output level, Audio or primary Play state. */
export function randomizeBlobs(_previous, random = Math.random) {
  const rng = presetRandom(random), p = defaultParameters();
  for (const [key, [low, high]] of Object.entries(RANGES)) p[key] = rng.between(low, high);
  for (const [key, choices] of Object.entries(CHOICES)) p[key] = rng.pick(choices.filter(value => value !== 'custom'));
  p.heads = rng.integer(1, 5); p.corners = rng.integer(3, 20);
  p.speed = rng.between(.035, .55); p.rotationSpeed = rng.between(.01, .3);
  p.baseFrequency = rng.between(45, 230); p.pitchRange = rng.between(.6, 4.8);
  p.aspect = rng.between(-.7, .7); p.skew = rng.between(-.65, .65);
  for (const key of ['autoRotate', 'amplitudeEnvelopeEnabled', 'cornerSwell', 'stereoInverted']) p[key] = rng.unit() > .5;
  p.reflectionAxes = ['horizontal', 'vertical', 'diagonal', 'antiDiagonal'].filter(() => rng.unit() > .7);
  p.headOffsets = Array.from({ length: p.heads }, () => rng.unit());
  for (const key of ['traceHeadDirections', 'radialHeadDirections']) p[key] = Array.from({ length: 12 }, () => rng.pick([-1, 1]));
  for (const key of ['traceHeadDirectionAdjustments', 'radialHeadDirectionAdjustments']) p[key] = Array.from({ length: 12 }, () => rng.unit());
  p.scanLineAxes = Array.from({ length: 12 }, () => rng.pick(['horizontal', 'vertical']));
  p.amplitudePreset = 'custom'; p.percussionPreset = 'custom'; p.pitchCurvePreset = 'custom';
  p.amplitudeEnvelopePoints = [0, .12, .36, .65, 1].map((x, i) => ({ x: i === 0 ? 0 : i === 4 ? 1 : x + rng.between(-.05, .05), y: rng.unit() }));
  p.percussionEnvelopePoints = [0, .16, .36, .5, .66].map((x, i) => ({ x: i ? x + rng.between(-.04, .04) : 0, y: i === 0 || i === 4 ? 0 : i === 1 ? 1 : rng.unit() }));
  p.pitchCurveNodes = [0, .25, .5, .75, 1].map((x, i) => ({ x: i === 0 || i === 4 ? x : x + rng.between(-.08, .08), y: rng.unit() }));
  const blobs = Array.from({ length: rng.integer(1, 3) }, (_, i) => inkLoop(rng.between(0, 20), { count: rng.integer(4, 12), tool: rng.pick(['pen', 'line']), size: rng.between(.14, .24), x: rng.between(.29, .71), y: rng.between(.29, .71) }));
  return { version: 3, blobs, params: normalizeParams(p) };
}
