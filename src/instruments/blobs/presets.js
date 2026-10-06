import { defaultParameters, normalizeParams, RANGES, CHOICES } from './parameters.js';
import { SCENE_VERSION } from './model.js';
import { createBlobForm, FORM_IDS } from './forms.js';
import { createBlobWord } from './lettering.js';
import { amplitudeEnvelopePreset, percussionEnvelopePreset } from '../../audio.js';
import { mappingCurvePreset } from '../../mapping.js';
import { canonicalHeadOffsets } from '../../playheads.js';
import { presetRandom } from '../../site/preset-random.js';

function scene(soundMode, blobs, patch) {
  const params = { ...defaultParameters(), soundMode, ...patch };
  params.headOffsets = patch.headOffsets ?? canonicalHeadOffsets(params.heads);
  params.amplitudeEnvelopePoints = amplitudeEnvelopePreset(params.amplitudePreset);
  params.percussionEnvelopePoints = percussionEnvelopePreset(params.percussionPreset);
  params.pitchCurveNodes = mappingCurvePreset(params.pitchCurvePreset);
  return { version: SCENE_VERSION, blobs, params: normalizeParams(params) };
}
const form = createBlobForm;
// Each entry authors an outline or composition, not a seed of one radial blob.
// Stable IDs keep existing preset selections meaningful across bank updates.
const definitions = [
  ['Soft oval', 'sine', [form('oval', { width: .8, height: .56 })],
    { speed: .13, amplitudePreset: 'pad', pitchRange: 1.6 }],
  ['Twin eyes', 'sine', [form('eye', { x: .3, width: .34, height: .23 })],
    { reflectionAxes: ['vertical'], heads: 2, speed: .19, amplitudePreset: 'sustain', baseFrequency: 94, pitchRange: 2.2 }],
  ['Diamond pulse', 'sine', [form('diamond', { width: .7, height: .8 })],
    { amplitudePreset: 'pluck', speed: .21, pitchRange: 3.5 }],
  ['Long wave', 'sine', [form('ribbon', { width: .84, height: .29 })],
    { autoRotate: true, rotationSpeed: .06, speed: .09, amplitudeEnvelopeEnabled: false, heads: 3, pitchSource: 'horizontal' }],
  ['Twin drops', 'sine', [form('drop', { x: .33, width: .24, height: .64, rotation: -.18 })],
    { reflectionAxes: ['vertical'], speed: .15, heads: 1, amplitudePreset: 'note', stereoInverted: true, pitchCurvePreset: 'smooth' }],
  ['Hourglass', 'sine', [form('hourglass', { width: .63, height: .8 })],
    { motionMode: 'pingpong', speed: .18, cornerSwell: true, amplitudePreset: 'pad', pitchRange: 4 }],

  ['Copper coil', 'fm', [form('spiral', { width: .8, height: .8 })],
    { fmIndex: 4.2, fmRatio: 1.37, speed: .24, amplitudePreset: 'pluck', cornerMode: 'even', corners: 9 }],
  ['Alley beetle', 'fm', [form('beetle', { width: .72, height: .84, variant: .75 })],
    { baseFrequency: 49, pitchRange: 2.4, fmIndex: 2.1, fmRatio: .5, amplitudePreset: 'note' }],
  ['Reflected reeds', 'fm', [form('leaf', { x: .33, width: .16, height: .79, rotation: -.2 })],
    { reflectionAxes: ['vertical'], autoRotate: true, rotationSpeed: .11, heads: 2, fmRatio: 2.7, fmIndexSource: 'height', amplitudePreset: 'sustain', speed: .08 }],
  ['Gutter crawler', 'fm', [form('crawler', { width: .84, height: .54, variant: .7 })],
    { playMethod: 'scan', heads: 2, fmIndex: 7, fmIndexSource: 'incidence', speed: .17, amplitudeEnvelopeEnabled: false, pitchSource: 'center' }],
  ['Ink moth', 'fm', [form('moth', { width: .84, height: .61, variant: .25 })],
    { fmRatio: 1.1, fmIndex: 5.5, fmIndexSource: 'corner', speed: .32, amplitudePreset: 'note' }],
  ['Brass bloom', 'fm', [form('clover', { width: .8, height: .8 })],
    { playMethod: 'radial', heads: 3, speed: .1, fmIndex: 1.8, fmRatio: 3.1, amplitudePreset: 'sustain', baseFrequency: 86 }],

  ['Marker tick', 'pm', [form('tick', { width: .84, height: .79, variant: .8 })],
    { pmIndex: 3.7, pmRatio: 2.63, amplitudePreset: 'pluck', cornerMode: 'even', corners: 11, speed: .23 }],
  ['blob', 'pm', createBlobWord(),
    { pmIndex: 1.2, pmRatio: .75, pitchRange: 3.2, speed: .12, amplitudePreset: 'pad', cornerMode: 'even', corners: 6 }],
  ['Liquid hook', 'pm', [form('hook', { width: .64, height: .82 })],
    { pmIndex: 6.4, pmDepthSource: 'horizontal', pmRatio: 1.41, autoRotate: true, rotationSpeed: .04, amplitudePreset: 'sustain', heads: 2 }],
  ['Squid tag', 'pm', [form('squid', { width: .65, height: .84, variant: .4 })],
    { pmRatio: 4.35, pmIndex: 2.4, amplitudePreset: 'pluck', speed: .28, cornerMode: 'even', corners: 5 }],
  ['Soft lens', 'pm', [form('eye', { width: .84, height: .34 })],
    { playMethod: 'scan', motionMode: 'pingpong', speed: .16, heads: 2, pmDepthSource: 'center', pmIndex: 4, amplitudePreset: 'note' }],
  ['Ornate wings', 'pm', [form('wing', { x: .3, y: .29, width: .34, height: .36 })],
    { reflectionAxes: ['horizontal', 'vertical'], autoRotate: true, rotationSpeed: .18, rotationMotionMode: 'pingpong', speed: .07, pmRatio: 1.9, pmIndex: 2.7, amplitudePreset: 'pad', stereoSource: 'vertical' }],

  ['Round trip', 'shepard', [form('oval', { width: .72, height: .8 }), form('oval', { width: .4, height: .45 })],
    { shepardCycles: 1, speed: .1, amplitudeEnvelopeEnabled: false, shepardWidth: 4.8 }],
  ['Nested drift', 'shepard', [form('amoeba', { width: .85, height: .8 }), form('bean', { width: .3, height: .29 }), form('drop', { x: .54, y: .53, width: .1, height: .11 })],
    { shepardDirection: -1, shepardCycles: 2.4, speed: .15, heads: 2, amplitudeEnvelopeEnabled: false }],
  ['Jagged current', 'shepard', [form('stairs', { width: .82, height: .73, detail: 5 })],
    { shepardMapping: 'turn', shepardTurnGlide: .65, shepardCycles: 1.6, speed: .13, amplitudePreset: 'sustain' }],
  ['Mirror moth', 'shepard', [form('moth', { width: .72, height: .82, variant: .95 })],
    { motionMode: 'pingpong', speed: .2, shepardCycles: 3.2, amplitudePreset: 'pad', baseFrequency: 77 }],
  ['Countercurrent', 'shepard', [form('ribbon', { y: .32, width: .82, height: .24 }), form('ribbon', { y: .69, width: .7, height: .23, rotation: Math.PI })],
    { heads: 2, traceHeadDirections: [1, -1, ...Array(10).fill(1)], shepardCycles: 1.8, speed: .16, amplitudeEnvelopeEnabled: false }],
  ['Ink scarab', 'shepard', [form('beetle', { width: .46, height: .85, variant: .1 })],
    { autoRotate: true, rotationSpeed: .035, shepardMapping: 'turn', shepardCycles: .6, shepardWidth: 6.5, speed: .11, amplitudePreset: 'sustain' }],

  ['Mechanical teeth', 'percussion', [form('gear', { width: .81, height: .81, detail: 8 })],
    { speed: .25, percussionLevelSource: 'fixed', percussionAttackNoise: .15, baseFrequency: 140, pitchRange: 3 }],
  ['Sticker swarm', 'percussion', [form('tick', { x: .27, y: .3, width: .29, height: .3, variant: .2, rotation: -.3 }), form('beetle', { x: .72, y: .34, width: .27, height: .36, variant: .9, rotation: .3 }), form('moth', { x: .49, y: .74, width: .43, height: .24, variant: .65 })],
    { cornerMode: 'even', corners: 7, heads: 1, speed: .17, percussionLevelSource: 'height', percussionAttackNoise: .35, baseFrequency: 215, pitchRange: 4 }],
  ['Lozenge bell', 'percussion', [form('diamond', { width: .83, height: .52 }), form('oval', { width: .14, height: .14 })],
    { cornerMode: 'even', corners: 5, speed: .12, baseFrequency: 47, pitchRange: 1.8, percussionLevelSource: 'fixed', percussionPreset: 'note', percussionStrikeLevel: .7 }],
  ['Compass rose', 'percussion', [form('fan', { x: .5, y: .28, width: .25, height: .35, detail: 3 })],
    { reflectionAxes: ['horizontal', 'diagonal'], cornerMode: 'even', corners: 5, speed: .23, heads: 1, percussionLevelSource: 'fixed', percussionAttackNoise: .6, pitchSource: 'center' }],
  ['Four hooked arms', 'percussion', [form('hook', { x: .3, y: .28, width: .29, height: .35 })],
    { reflectionAxes: ['horizontal', 'vertical'], playMethod: 'radial', autoRotate: true, rotationSpeed: .035, speed: .21, percussionLevelSource: 'fixed', percussionPreset: 'note', heads: 2 }],
  ['Brushed crossings', 'percussion', [form('ribbon', { width: .84, height: .23 }), form('ribbon', { width: .78, height: .2, rotation: Math.PI / 2 })],
    { playMethod: 'scan', speed: .16, motionMode: 'pingpong', heads: 2, percussionLevelSource: 'incidence', percussionAttackNoise: .8, percussionPreset: 'pad' }],
];
export const BLOB_PRESETS = definitions.map(([label, mode, blobs, params], i) => ({ id: `blobs-${i + 1}`, label, snapshot: scene(mode, blobs, params) }));

function randomComposition(rng) {
  const make = (box, kind = rng.pick(FORM_IDS)) => form(kind, {
    variant: rng.unit(), detail: rng.integer(3, 8), rotation: rng.between(-Math.PI, Math.PI), ...box,
  });
  const layout = rng.pick(['solo', 'ribbon', 'pair', 'nested', 'constellation', 'reflected', 'ornament']);
  if (layout === 'reflected' || layout === 'ornament') {
    const reflectionAxes = layout === 'ornament'
      ? rng.pick([['horizontal', 'vertical'], ['horizontal', 'diagonal'], ['vertical', 'antiDiagonal']])
      : [rng.pick(['horizontal', 'vertical', 'diagonal', 'antiDiagonal'])];
    return { reflectionAxes, blobs: [make({ x: rng.between(.24, .33), y: rng.between(.24, .36), width: rng.between(.21, .34), height: rng.between(.23, .39) })] };
  }
  if (layout === 'nested') {
    const kind = rng.pick(FORM_IDS), count = rng.integer(2, 3);
    return { reflectionAxes: [], blobs: Array.from({ length: count }, (_, i) => make({ x: .5, y: .5, width: .82 * .53 ** i, height: .78 * .53 ** i, rotation: 0 }, kind)) };
  }
  if (layout === 'pair' || layout === 'constellation') {
    const count = layout === 'pair' ? 2 : rng.integer(3, 5), angle = rng.between(-Math.PI, Math.PI);
    return { reflectionAxes: [], blobs: Array.from({ length: count }, (_, i) => {
      const a = angle + i * Math.PI * 2 / count, radius = count === 2 ? .23 : .28;
      return make({ x: .5 + Math.cos(a) * radius, y: .5 + Math.sin(a) * radius, width: rng.between(.19, .34), height: rng.between(.21, .37) });
    }) };
  }
  return { reflectionAxes: [], blobs: [layout === 'ribbon'
    ? make({ width: rng.between(.72, .88), height: rng.between(.17, .3) }, rng.pick(['ribbon', 'meander', 'lightning', 'leaf', 'peanut']))
    : make({ width: rng.between(.51, .86), height: rng.between(.5, .86) })] };
}

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
  // A tracing head never crosses its contour, so incidence has no loudness.
  if (p.playMethod === 'trace') for (const key of ['cornerAmplitudeSource', 'percussionLevelSource']) {
    if (p[key] === 'incidence') p[key] = rng.pick(CHOICES[key].filter(value => value !== 'incidence'));
  }
  // Fixed loudness is 1; inverting it would mute every percussion strike.
  if (p.percussionLevelSource === 'fixed' && p.percussionLevelCurve === 'inverted') {
    p.percussionLevelCurve = rng.pick(CHOICES.percussionLevelCurve.filter(value => value !== 'inverted'));
  }
  p.headOffsets = Array.from({ length: p.heads }, () => rng.unit());
  for (const key of ['traceHeadDirections', 'radialHeadDirections']) p[key] = Array.from({ length: 12 }, () => rng.pick([-1, 1]));
  for (const key of ['traceHeadDirectionAdjustments', 'radialHeadDirectionAdjustments']) p[key] = Array.from({ length: 12 }, () => rng.unit());
  p.scanLineAxes = Array.from({ length: 12 }, () => rng.pick(['horizontal', 'vertical']));
  p.amplitudePreset = 'custom'; p.percussionPreset = 'custom'; p.pitchCurvePreset = 'custom';
  p.amplitudeEnvelopePoints = [0, .12, .36, .65, 1].map((x, i) => ({ x: i === 0 ? 0 : i === 4 ? 1 : x + rng.between(-.05, .05), y: rng.unit() }));
  p.percussionEnvelopePoints = [0, .16, .36, .5, .66].map((x, i) => ({ x: i ? x + rng.between(-.04, .04) : 0, y: i === 0 || i === 4 ? 0 : i === 1 ? 1 : rng.unit() }));
  p.pitchCurveNodes = [0, .25, .5, .75, 1].map((x, i) => ({ x: i === 0 || i === 4 ? x : x + rng.between(-.08, .08), y: rng.unit() }));
  const { blobs, reflectionAxes } = randomComposition(rng);
  p.reflectionAxes = reflectionAxes;
  return { version: SCENE_VERSION, blobs, params: normalizeParams(p) };
}
