import { amplitudeEnvelopePreset, percussionEnvelopePreset, sanitizeAmplitudeEnvelope, sanitizePercussionEnvelope } from '../../audio.js';
import { mappingCurvePreset, sanitizeMappingCurve } from '../../mapping.js';
import { sanitizeHeadOffsets } from '../../playheads.js';
import { pingPong01, wrap01 } from '../../geometry.js';
import { sanitizeReflectionAxes } from './symmetry.js';

// The musical names, units, defaults and limits are shared with Shape.
export const RANGES = Object.freeze({
  speed: [0, 4], heads: [1, 12], rotationSpeed: [0, 4], corners: [1, 32],
  curvature: [-1, 1], aspect: [-2, 2], skew: [-2, 2],
  baseFrequency: [20, 440], pitchRange: [0, 6], stereoWidth: [0, 1],
  percussionStrikeLevel: [0, 1], percussionAttackNoise: [0, 1],
  fmIndex: [0, 12], fmRatio: [.25, 8], pmIndex: [0, 8], pmRatio: [.25, 8],
  shepardCycles: [.25, 4], shepardTurnGlide: [.05, 1], shepardWidth: [2, 8],
});
const sources = ['fixed', 'horizontal', 'height', 'center', 'corner', 'incidence', 'phase'];
export const CHOICES = Object.freeze({
  cornerMode: ['anchors', 'even'], playMethod: ['trace', 'scan', 'radial'],
  motionMode: ['loop', 'pingpong'], rotationMotionMode: ['loop', 'pingpong'],
  traversalDirection: [1, -1], rotationDirection: [1, -1], shepardDirection: [1, -1],
  soundMode: ['sine', 'percussion', 'shepard', 'fm', 'pm'],
  amplitudePreset: ['segment', 'pluck', 'note', 'sustain', 'pad', 'custom'],
  percussionPreset: ['pluck', 'note', 'sustain', 'pad', 'custom'],
  cornerAmplitudeSource: sources, fmIndexSource: sources, pmDepthSource: sources,
  shepardMapping: ['travel', 'turn'], stereoSource: ['horizontal', 'vertical', 'center'],
  pitchSource: ['vertical', 'horizontal', 'center'],
  pitchCurvePreset: ['linear', 'exponential', 'logarithmic', 'smooth', 'inverted', 'custom'],
  percussionLevelSource: [...sources, 'signed'],
  percussionLevelCurve: ['linear', 'exponential', 'logarithmic', 'smooth', 'inverted'],
});
export function defaultParameters() {
  return {
    speed: .25, heads: 1, headOffsets: [0], traversalDirection: 1,
    playMethod: 'trace', motionMode: 'loop',
    scanLineAxes: Array(12).fill('vertical'), traceHeadDirections: Array(12).fill(1), radialHeadDirections: Array(12).fill(1),
    traceHeadDirectionAdjustments: Array(12).fill(0), radialHeadDirectionAdjustments: Array(12).fill(0),
    rotationSpeed: .12, rotationDirection: 1, rotationMotionMode: 'loop', autoRotate: false,
    corners: 8, cornerMode: 'anchors', curvature: 0, aspect: 0, skew: 0, reflectionAxes: [],
    baseFrequency: 130, pitchRange: 2.5, soundMode: 'sine',
    amplitudeEnvelopeEnabled: true, cornerSwell: false, amplitudePreset: 'segment',
    amplitudeEnvelopePoints: amplitudeEnvelopePreset('segment'),
    percussionStrikeLevel: .9, percussionAttackNoise: 0, percussionPreset: 'pluck',
    percussionEnvelopePoints: percussionEnvelopePreset('pluck'),
    cornerAmplitudeSource: 'fixed', fmIndexSource: 'fixed', pmDepthSource: 'fixed',
    shepardCycles: 1, shepardDirection: 1, shepardMapping: 'travel', shepardTurnGlide: .35, shepardWidth: 4,
    fmIndex: 3, fmRatio: 2, pmIndex: 2, pmRatio: 1,
    stereoWidth: 1, stereoSource: 'horizontal', stereoInverted: false,
    pitchSource: 'vertical', pitchCurvePreset: 'linear', pitchCurveNodes: mappingCurvePreset('linear'),
    percussionLevelSource: 'corner', percussionLevelCurve: 'linear',
  };
}
export function normalizeParams(input = {}) {
  const result = defaultParameters();
  result.reflectionAxes = sanitizeReflectionAxes(input.reflectionAxes);
  for (const [key, [low, high]] of Object.entries(RANGES)) {
    if (Number.isFinite(input[key])) result[key] = Math.min(high, Math.max(low, input[key]));
  }
  result.heads = Math.round(result.heads); result.corners = Math.round(result.corners);
  for (const [key, choices] of Object.entries(CHOICES)) if (choices.includes(input[key])) result[key] = input[key];
  for (const key of ['amplitudeEnvelopeEnabled', 'cornerSwell', 'stereoInverted', 'autoRotate']) if (typeof input[key] === 'boolean') result[key] = input[key];
  for (const key of ['traceHeadDirections', 'radialHeadDirections']) result[key] = Array.from({ length: 12 }, (_, i) => input[key]?.[i] === -1 ? -1 : 1);
  for (const key of ['traceHeadDirectionAdjustments', 'radialHeadDirectionAdjustments']) result[key] = Array.from({ length: 12 }, (_, i) => Number.isFinite(input[key]?.[i]) ? input[key][i] : 0);
  result.scanLineAxes = Array.from({ length: 12 }, (_, i) => input.scanLineAxes?.[i] === 'horizontal' ? 'horizontal' : 'vertical');
  result.headOffsets = sanitizeHeadOffsets(input.headOffsets, result.heads);
  for (const key of ['amplitudeEnvelopePoints', 'percussionEnvelopePoints']) {
    if (Array.isArray(input[key]) && input[key].length === 5) result[key] = key === 'percussionEnvelopePoints' ? sanitizePercussionEnvelope(input[key]) : sanitizeAmplitudeEnvelope(input[key]);
  }
  result.percussionEnvelopePoints[0].y = 0; result.percussionEnvelopePoints[4].y = 0;
  if (Array.isArray(input.pitchCurveNodes) && input.pitchCurveNodes.length === 5) result.pitchCurveNodes = sanitizeMappingCurve(input.pitchCurveNodes);
  if (result.playMethod !== 'trace') result.shepardMapping = 'travel';
  if (result.amplitudePreset === 'segment') result.cornerSwell = false;
  return result;
}
export function performanceState(params, clock, time) {
  const dt = Math.max(0, time - clock.time);
  const continuousPosition = clock.phase + (clock.playing ? dt * params.speed * params.traversalDirection : 0);
  const continuousRotation = (clock.rotationPhase ?? 0) + (clock.rotating ? dt * params.rotationSpeed * params.rotationDirection : 0);
  return {
    ...params, sides: Math.max(3, params.corners), shapeType: 'polygon', closedShapeType: 'polygon', starDepth: 0,
    playing: Boolean(clock.playing), autoRotate: Boolean(clock.rotating), continuousPosition, continuousRotation,
    position: params.motionMode === 'pingpong' ? pingPong01(continuousPosition) : wrap01(continuousPosition),
    rotation: params.rotationMotionMode === 'pingpong' ? pingPong01(continuousRotation) * 360 - 180 : ((continuousRotation * 360 + 180) % 360 + 360) % 360 - 180,
  };
}
