import { tilingInfo, constrainPrototileEdit } from './lattice.js';
import { EdgeShape } from '../../../vendor/tactile/tactile.js';
import { percussionEnvelopeEditorX } from '../../audio.js';
import { createLatticeInitialState } from './initial-state.js';

// Stronger contours and asymmetries are part of the score: their actual line
// crossings determine phrasing. These are legal Tactile edits, not decorations.
const FORMS = {
  braided: [4, [.08, -.12, .16, .11, -.14, -.09], [.72, -.65, .58, -.76, .62]],
  hooked: [5, [-.08, .13, -.1, .15, -.12], [.82, -.58, .69, -.72]],
  woven: [6, [.07, -.14, .12, -.16, .11], [-.78, .62, -.68, .74]],
  scalloped: [13, [.09, -.12, .14], [.82, -.62, .7]],
  offset: [22, [.12, -.16, .1, .14], [.74, -.68, .84, -.56]],
  claws: [23, [-.11, .15, -.13, .1], [-.82, .65, .72, 0]],
  ribbons: [24, [.09, -.16, .13], [.75, -.72, .64]],
  knot: [26, [-.08, .17, -.13], [.84, -.62, .76]],
  waves: [44, [.12, -.15, .14, -.12], [.78, -.72, .66, -.82]],
  teeth: [50, [-.16, .12, -.1], [.7, -.85, .76]],
  bowed: [8, [.07, -.13, .15, -.1], [.88, -.75, .62]],
  snakes: [9, [-.08, .13, -.14], [.82, -.78]],
};
const ENVELOPES = {
  knock: [[0,0],[3,1],[20,.6],[55,.2],[115,0]],
  plait: [[0,0],[5,1],[50,.13],[100,.72],[180,0]],
  skip: [[0,0],[2,1],[35,0],[94,.78],[160,0]],
  ripple: [[0,0],[5,1],[40,.12],[92,.68],[220,0]],
  breathe: [[0,0],[35,.9],[115,.62],[220,.35],[420,0]],
  bell: [[0,0],[3,1],[65,.55],[170,.28],[360,0]],
};

// label, form, engine, speed, density, pattern bearing, motion, envelope, sound.
// The line stays vertical. Angled pattern motion changes the crossing rhythm
// without tilting that reading line; no parallel (90°) motion dead scenes.
const STUDIES = [
  ['Braided pocket', 'braided', 'percussion', .38, .56, 0, 'loop', 'knock', {baseFrequency:62,pitchRange:2.2,percussionDecay:105}],
  ['Hooked brass shuffle', 'hooked', 'fm', .32, .55, 12, 'loop', 'skip', {baseFrequency:92,pitchRange:2.6,fmIndex:4.8,fmRatio:1.37}],
  ['Woven glass replies', 'woven', 'pm', .26, .58, 0, 'pingpong', 'plait', {baseFrequency:180,pitchRange:2.8,pmIndex:3.8,pmRatio:2.413}],
  ['Scallop ratchet', 'scalloped', 'percussion', .62, .57, 0, 'loop', 'knock', {baseFrequency:115,pitchRange:3.2,percussionDecay:58,voiceCap:6}],
  ['Offset bass loom', 'offset', 'fm', .3, .6, 0, 'loop', 'knock', {baseFrequency:48,pitchRange:1.6,fmIndex:2.4,fmRatio:.73}],
  ['Claw-step answer', 'claws', 'percussion', .44, .55, 18, 'pingpong', 'knock', {baseFrequency:75,pitchRange:2.7,percussionDecay:150}],
  ['Ribbon double pulse', 'ribbons', 'pm', .37, .6, 0, 'loop', 'plait', {baseFrequency:128,pitchRange:2.4,pmIndex:4.2,pmRatio:1.71}],
  ['Knotwork skips', 'knot', 'fm', .46, .54, 24, 'loop', 'skip', {baseFrequency:100,pitchRange:3.2,fmIndex:5.1,fmRatio:2.31}],
  ['Wavecloth pendulum', 'waves', 'sine', .3, .3, 0, 'pingpong', 'ripple', {baseFrequency:96,pitchRange:2.9}],
  ['Toothwheel chatter', 'teeth', 'percussion', .74, .56, 0, 'loop', 'knock', {baseFrequency:135,pitchRange:3.4,percussionDecay:45,voiceCap:6}],
  ['Bowed copper bells', 'bowed', 'fm', .28, .58, 10, 'loop', 'bell', {baseFrequency:150,pitchRange:2.8,fmIndex:4.4,fmRatio:2.73}],
  ['Snakeskin counterflow', 'snakes', 'shepard', .34, .42, 0, 'pingpong', 'breathe', {baseFrequency:95,pitchRange:2.2,shepardCycles:2,shepardWidth:5}],
  ['Braided bass reversals', 'braided', 'pm', .25, .63, 0, 'pingpong', 'plait', {baseFrequency:55,pitchRange:1.8,pmIndex:5.2,pmRatio:.63,traversalDirection:1}],
  ['Hooked woodpeckers', 'hooked', 'percussion', .51, .6, 0, 'loop', 'knock', {baseFrequency:90,pitchRange:2.1,percussionDecay:72,traversalDirection:1}],
  ['Woven mercury', 'woven', 'sine', .42, .56, 20, 'loop', 'skip', {baseFrequency:145,pitchRange:3.1,pitchCurve:'inverted'}],
  ['Scalloped phase chimes', 'scalloped', 'pm', .3, .61, 0, 'pingpong', 'bell', {baseFrequency:210,pitchRange:2.2,pmIndex:3.2,pmRatio:3.13}],
  ['Offset tom procession', 'offset', 'percussion', .4, .56, 14, 'loop', 'knock', {baseFrequency:58,pitchRange:2.6,percussionDecay:190}],
  ['Clawfold syncopation', 'claws', 'fm', .35, .59, 0, 'loop', 'ripple', {baseFrequency:105,pitchRange:3.4,fmIndex:6.1,fmRatio:.87}],
  ['Ribbon rising gears', 'ribbons', 'shepard', .48, .55, 16, 'loop', 'plait', {baseFrequency:135,pitchRange:2.5,shepardCycles:3,shepardDirection:1}],
  ['Knotted rim cascade', 'knot', 'percussion', .57, .61, 0, 'pingpong', 'knock', {baseFrequency:170,pitchRange:2.4,percussionDecay:65}],
  ['Wavecloth reed dance', 'waves', 'fm', .4, .3, 22, 'loop', 'plait', {baseFrequency:85,pitchRange:2.3,fmIndex:3.7,fmRatio:1.19}],
  ['Toothed glass train', 'teeth', 'pm', .58, .58, 0, 'loop', 'skip', {baseFrequency:180,pitchRange:3,pmIndex:4.8,pmRatio:2.17,voiceCap:6}],
  ['Bowed low tides', 'bowed', 'sine', .2, .62, 0, 'pingpong', 'breathe', {baseFrequency:70,pitchRange:3.3,contactLevel:.43}],
  ['Snakeskin descending braid', 'snakes', 'shepard', .39, .42, 12, 'loop', 'ripple', {baseFrequency:110,pitchRange:2.7,shepardCycles:2.5,shepardDirection:-1}],
];
function guardedForm(name) {
  const [type, deltas, bends] = FORMS[name];
  const info = tilingInfo(type), currentEdgeCurves = info.edgeShapes.map(() => 0);
  const guarded = constrainPrototileEdit({type,currentParameters:[...info.defaultParameters],currentEdgeCurves,
    parameters: info.defaultParameters.map((value,i)=>value+deltas[i]),
    edgeCurves: info.edgeShapes.map((shape,i)=>shape===EdgeShape.I?0:bends[i]),
  });
  return {tilingType:type,parameters:guarded.parameters,edgeCurves:guarded.edgeCurves};
}
export function latticeRhythmStudies() {
  return STUDIES.map(([label,form,soundMode,speed,density,patternDirectionAngle,motionMode,envelope,sound],i)=>({
    id:`lattice-rhythm-${i+1}`,label,
    description:`${label}: sculpted ${form} tiles, 90° reader, ${motionMode === 'pingpong' ? 'reversing' : 'flowing'} scan and ${envelope} articulation. Audio/Play and phase stay live.`,
    state:{...createLatticeInitialState(),...guardedForm(form),angle:90,soundMode,speed,density,patternDirectionAngle,motionMode,
      traversalDirection:-1,level:.5,contactLevel:.46,intersectionAccent:.92,voiceCap:8,
      synthSource:i%3===0?'incidence':'orientation',pitchSource:i%4===0?'orientation':i%4===1?'incidence':'height',
      pitchCurve:'smooth',levelSource:'fixed',levelCurve:'linear',stereoWidth:.85,
      percussionAttack:2,percussionDecay:110,...sound},
    envelope:{enabled:true,swell:false,preset:'custom',level:1,points:ENVELOPES[envelope].map(([ms,y])=>({x:percussionEnvelopeEditorX(ms),y}))},
  }));
}
