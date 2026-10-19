import { cloneDefaultFmDrumVoices } from '../fm-drums/fm-drums.js';
import { GRAPH_RHYTHM_STUDIES, graphRhythmParameters, graphStudyModel } from '../../families/graph-presets/rhythm-studies.js';

// frequency, decay, modRatio, modIndex, pitchBend, noise, tone, level.
// Per-family recipes give complete kits, not sixteen copies of one oscillator.
const KITS = {
  punch: {
    kick: [48, .48, 1, 2.2, 2.8, .02, .48, .96], tom: [105, .36, 1.37, 2.8, 1.1, .02, .62, .88],
    snare: [190, .24, 1.82, 4, .45, .72, .7, .9], hat: [3900, .095, 1.414, 8, 0, .68, .83, .65],
    metal: [490, .18, 2.91, 5.2, .08, .08, .75, .76], bell: [360, .65, 2.76, 3, 0, .01, .65, .8], effect: [180, .26, 3.4, 6, 2.4, .03, .66, .85],
  },
  wood: {
    kick: [66, .26, 1.12, 1.1, .9, .03, .38, .96], tom: [170, .14, 1.41, 1.8, .25, .05, .48, .94],
    snare: [290, .095, 2.31, 2.5, .1, .18, .58, .88], hat: [1850, .06, 1.7, 3.3, 0, .35, .62, .8],
    metal: [720, .08, 2.23, 2.6, 0, .04, .57, .86], bell: [420, .24, 1.71, 1.5, 0, 0, .52, .86], effect: [240, .12, 1.3, 3.1, .5, .02, .62, .9],
  },
  rubber: {
    kick: [43, .64, .75, 2.4, 4.8, .01, .5, .96], tom: [90, .42, .67, 3.8, 3.4, .02, .66, .94],
    snare: [145, .21, 1.12, 5.8, 2.1, .24, .73, .9], hat: [1850, .11, .8, 4.8, 1.2, .3, .76, .72],
    metal: [330, .31, .55, 7.4, 2.7, .02, .8, .86], bell: [210, .55, .71, 5.5, -.7, .01, .62, .86], effect: [130, .38, .37, 9, 5.8, .02, .74, .92],
  },
  bronze: {
    kick: [74, .65, 1.71, 5, .7, .01, .54, .9], tom: [155, .5, 2.17, 5.8, .15, .02, .7, .9],
    snare: [320, .35, 3.13, 7.2, 0, .12, .76, .88], hat: [2300, .21, 2.71, 6, 0, .18, .76, .72],
    metal: [520, .8, 3.71, 8.4, 0, .04, .68, .86], bell: [260, 1.4, 2.413, 6.2, 0, .005, .72, .9], effect: [810, .7, 1.731, 7.5, -.1, .03, .8, .84],
  },
  dust: {
    kick: [59, .27, 1, 1.8, 1.5, .2, .5, .94], tom: [140, .18, 1.31, 3, .3, .38, .6, .9],
    snare: [240, .29, 2.1, 2.5, 0, .92, .76, .94], hat: [2900, .14, 1.61, 4.4, 0, .95, .8, .78],
    metal: [640, .21, 2.7, 5.5, 0, .6, .67, .88], bell: [330, .55, 1.91, 2.7, -.12, .25, .57, .88], effect: [430, .3, 3.31, 5.2, .8, .7, .7, .86],
  },
  wire: {
    kick: [82, .65, 1, 2.2, 0, .14, .78, .98], tom: [160, .7, 1.37, 3.5, 0, .18, .83, .96],
    snare: [230, .45, 2.17, 4.2, 0, .2, .8, .96], hat: [570, .32, 2.8, 5.5, 0, .15, .9, .94],
    metal: [360, .8, 2.43, 6.4, 0, .18, .86, .98], bell: [270, 1.2, 1.73, 4.4, 0, .12, .84, .98], effect: [440, .65, 3.7, 7.4, 0, .22, .9, .96],
  },
};
const fields = ['frequency', 'decay', 'modRatio', 'modIndex', 'pitchBend', 'noise', 'tone', 'level'];
function studyKit(name) {
  const occurrences = new Map();
  return cloneDefaultFmDrumVoices().map(voice => {
    const ordinal = occurrences.get(voice.family) ?? 0;
    occurrences.set(voice.family, ordinal + 1);
    const parameters = Object.fromEntries(fields.map((key, i) => [key, KITS[name][voice.family][i]]));
    // Continuous register spacing, not scale quantization. Preserve pad identity.
    parameters.frequency *= [1, 1.29, 1.73, 2.11][ordinal];
    parameters.decay *= [1, .82, .68, .56][ordinal];
    return { ...voice, ...parameters, attack: voice.family === 'bell' ? .004 : .002 };
  });
}
const STUDIES = [
  ['Basement pocket', 'punch', 'drum-bank', [0, 7, 2, 7, 4, 7, 3, 8], 'Kick, snare and hats in an even eight-node pocket.', { pitchDepth: 0, turnPitchDepth: 0 }],
  ['Circuit sewing machine', 'wood', 'circuit', [0, 9, 4, 10, 2], 'Five sharp contacts overlap half-beat launches at 210 BPM.', { pitchDepth: 2 }],
  ['Rubber ankle', 'rubber', 'drum-bank', [0, 4, 14, 5, 2], 'Elastic pitch dives in an uneven, length-sensitive five-hop walk.', { pitchDepth: 3, turnPitchDepth: 5 }],
  ['Bronze heptagon', 'bronze', 'resonant-metal', null, 'Seven metal arrivals circle with a fading return.', { mappingMode: 'path-phase', pitchDepth: 5, turnPitchDepth: 3 }],
  ['Woodpecker replies', 'wood', 'drum-bank', null, 'Dry wooden branches answer one clearly audible root.', { mappingMode: 'path-phase', pitchDepth: 4 }],
  ['Sandpaper zipper', 'dust', 'drum-bank', [7, 2, 8, 3, 15, 9], 'Short noise attacks zip across six evenly timed nodes.', { characterDepth: .2 }],
  ['Three bowl tide', 'bronze', 'drum-bank', [11, 13, 12], 'Three low resonances with a long breath between launches.', { pitchDepth: 0, turnPitchDepth: 0 }],
  ['Plucked wire conversation', 'wire', 'karplus-strong', [0, 4, 8, 12], 'Four distinct string materials, spaced to keep each pluck audible.', { pitchDepth: 2, turnPitchDepth: 2 }],
  ['Rubber pendulum', 'rubber', 'drum-bank', null, 'A slow four-node bass loop bends and decays on every return.', { mappingMode: 'path-phase', pitchDepth: 2 }],
  ['Rivets and ricochets', 'punch', 'circuit', null, 'Crossing forward paths split a compact kick-and-rim call.', { mappingMode: 'path-phase', pitchDepth: 8, attackLaneCount: 4 }],
  ['Dry seed shaker', 'dust', 'rattlesnake', [0, 5, 10, 15, 4], 'Uneven noise bursts sweep through a low continuous pitch range.', { baseFrequency: 130, pitchDepth: 10 }],
  ['Thumb piano relay', 'wire', 'karplus-tines', [4, 8, 12, 4], 'Kalimba, banjo and rubber tines take turns without a dense mesh.', { pitchDepth: 3, turnPitchDepth: 0 }],
  ['Prepared tabletop', 'wire', 'karplus-objects', [0, 4, 8], 'Three prepared-object attacks, with room around each transient.', { pitchDepth: 2, turnPitchDepth: 1 }],
  ['Crooked tom canopy', 'punch', 'drum-bank', null, 'Long and short branches make an asymmetrical tom response.', { mappingMode: 'degree-turn', pitchDepth: 12, turnPitchDepth: 8 }],
  ['Five-spoke scrapyard', 'bronze', 'resonant-metal', null, 'A small metal hub throws separated replies across four lanes.', { mappingMode: 'path-phase', attackLaneCount: 4, pitchDepth: 8 }],
  ['Falling floorboards', 'wood', 'drum-bank', [6, 5, 4, 9, 2, 1, 0, 13], 'An eight-step wooden descent with a low final knock.', { pitchDepth: 0, turnPitchDepth: 0 }],
  ['Oil drum afterimage', 'punch', 'drum-bank', null, 'A long uneven ring leaves diminishing tom-and-kick afterimages.', { mappingMode: 'path-phase', feedbackTone: .63, pitchDepth: 5 }],
  ['Rattle vertebrae', 'wire', 'rattlesnake-physical', [0, 4, 8, 12], 'Four physical rattles rather than a high-density shower.', { baseFrequency: 180, pitchDepth: 9, turnPitchDepth: 4 }],
  ['Nine-tooth sprint', 'punch', 'circuit', [0, 9, 7, 2, 10, 7, 4, 3, 8], 'A nine-contact ratchet outruns a two-beat launch cycle.', { pitchDepth: 1, turnPitchDepth: 0 }],
  ['Breathing foundry', 'bronze', 'drum-bank', null, 'A slowly moving ring stretches its spaces and darkens its returns.', { mappingMode: 'path-phase', nodeMoving: true, nodeMotionMode: 'orbit', nodeMotionSpeed: .035, nodeMotionAmount: .08, pitchDepth: 7, turnPitchDepth: 4 }],
];
export function graphDrumExpressiveStudies(defaults) {
  return STUDIES.map(([label, kit, percussionStyle, padPath, description, overrides], i) => {
    const rhythm = GRAPH_RHYTHM_STUDIES[i];
    const parameters = { ...defaults, ...graphRhythmParameters(rhythm),
      seedNote: 60, baseFrequency: 261.6255653005986, triggerScope: 'all', feedbackTone: .84,
      mappingMode: 'position-grid', percussionStyle, pitchDepth: 4, turnPitchDepth: 2, characterDepth: .35,
      attackLaneCount: 2, nodeMoving: false, nodeMotionMode: 'wiggle', nodeMotionSpeed: .09, nodeMotionAmount: .04,
      ...overrides,
    };
    parameters.seedNote = Math.round(69 + 12 * Math.log2(parameters.baseFrequency / 440));
    parameters.baseFrequency = 440 * 2 ** ((parameters.seedNote - 69) / 12);
    // The seed also offsets drum selection. Keep the authored pad sequence
    // sounding the intended kit slots after choosing a low rattle reference.
    const positions = padPath?.map(pad => ((pad - (parameters.seedNote - 60)) % 16 + 16) % 16);
    return { id: `graph-drums-study-${rhythm.id}`, label, description, parameters,
      graph: graphStudyModel(parameters, positions), voices: studyKit(kit) };
  });
}
