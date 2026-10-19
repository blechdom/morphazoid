import { GRAPH_RHYTHM_STUDIES, graphRhythmParameters, graphStudyModel } from '../../families/graph-presets/rhythm-studies.js';

// Deliberate contrasts in register, envelope, modulation and graph-to-pitch
// mapping. All new studies use continuous tuning; existing optional tunings
// and all twelve original scenes are retained by the calling bank.
const STUDIES = [
  ['Subterranean relay', 'sine', 'height', 58, 'trigger', [3, 95, .12, 90, 145], 'Rounded bass contacts with a clean eight-node pulse.', { pitchRange: .75, turnPitchScale: .08 }],
  ['Copper fireflies', 'fm', 'progress', 310, 'trigger', [1, 28, .05, 32, 55], 'Five brilliant FM pinpricks repeat twice per beat.', { modulationIndex: 4.8, modulationRatio: 2.71, pitchRange: 1.1 }],
  ['Elastic staircase', 'pm', 'turn', 96, 'edge', [4, 110, .48, 180, 230], 'Phase-modulated bass bends follow unequal edge durations.', { modulationIndex: 3.8, modulationRatio: .63, turnPitchScale: .26 }],
  ['Bronze afterimage', 'fm', 'height', 220, 'trigger', [2, 440, .08, 720, 510], 'Seven inharmonic bells leave a soft, darkening orbit.', { modulationIndex: 5.2, modulationRatio: 2.413, pitchRange: 1.3, feedbackTone: .61 }],
  ['Airlock choir', 'triangle', 'degree', 165, 'edge', [180, 280, .68, 760, 700], 'A slow root opens into overlapping, differently tuned branches.', { pitchRange: 1.8, stereoSpread: 1 }],
  ['Toothwheel stutter', 'square', 'progress', 82, 'trigger', [1, 26, 0, 24, 50], 'Six clipped low square-wave contacts form a mechanical chatter.', { pitchRange: 1.4, output: .34 }],
  ['Glass breathing room', 'sine', 'height', 440, 'trigger', [420, 900, .45, 1800, 2200], 'Three long pure tones swell into widely separated breaths.', { pitchRange: .9, stereoSpread: 1 }],
  ['Bent wire call', 'fm', 'turn', 150, 'trigger', [2, 280, .06, 420, 290], 'Four plucked FM tones answer with crooked interval relationships.', { modulationIndex: 3.1, modulationRatio: 1.731, turnPitchScale: .22 }],
  ['Pendulum undertow', 'triangle', 'height', 48, 'edge', [12, 170, .72, 280, 350], 'A slow four-node orbit sustains a low, rounded undercurrent.', { pitchRange: .6, feedbackTone: .74 }],
  ['Splinter canon', 'pm', 'progress', 190, 'trigger', [2, 85, .15, 120, 115], 'Crossing routes split a woody PM phrase into staggered replies.', { modulationIndex: 2.6, modulationRatio: 1.37, pitchRange: 1.7, attackLaneCount: 4 }],
  ['Reed zipper', 'sawtooth', 'height', 130, 'trigger', [2, 40, .1, 60, 85], 'Short bright reed-like notes with irregular edge spacing.', { pitchRange: .8, output: .34 }],
  ['Porcelain droplets', 'fm', 'progress', 370, 'trigger', [2, 220, .02, 310, 240], 'Four clear droplets with long enough gaps to hear the tails.', { modulationIndex: 1.3, modulationRatio: 3.03, pitchRange: 1.1 }],
  ['Rust breathing', 'pm', 'height', 110, 'edge', [120, 420, .58, 950, 850], 'Three sustained grainy tones grow along their connecting edges.', { modulationIndex: 6.4, modulationRatio: .71, pitchRange: .7 }],
  ['Forked brass', 'sawtooth', 'turn', 138, 'edge', [18, 95, .62, 240, 280], 'Brassy forks arrive at unequal times and bend at each junction.', { turnPitchScale: .32, output: .32, attackLaneCount: 4 }],
  ['Spinning partials', 'shepard', 'degree', 180, 'trigger', [8, 130, .2, 200, 190], 'A compact hub fans out overlapping octave-coloured contacts.', { pitchRange: 2.2, attackLaneCount: 4, output: .34 }],
  ['Falling mercury', 'sine', 'height', 240, 'trigger', [2, 110, .06, 180, 180], 'An eight-node pitch descent, with a tail between liquid contacts.', { pitchRange: 1.6, descending: true }],
  ['Magnetic return', 'fm', 'turn', 175, 'trigger', [3, 200, .16, 380, 300], 'Uneven repeated turns accumulate pitch and lose brightness.', { modulationIndex: 4.4, modulationRatio: 1.19, turnPitchScale: .18, feedbackTone: .58 }],
  ['Hollow chambers', 'triangle', 'degree', 125, 'edge', [9, 90, .65, 210, 300], 'Four hollow tones connect rather than stutter.', { pitchRange: 1.2, stereoSpread: .95 }],
  ['Nine sparks', 'pm', 'progress', 260, 'trigger', [1, 24, 0, 36, 48], 'Nine quick phase-modulated sparks across a wide continuous register.', { modulationIndex: 7, modulationRatio: 3.71, pitchRange: 2.3, attackLaneCount: 4, output: .34 }],
  ['Orbital foghorns', 'shepard', 'height', 90, 'edge', [260, 520, .7, 1400, 1300], 'A moving low ring swells while its edge timings slowly change.', { pitchRange: 1.5, nodeMoving: true, nodeMotionMode: 'orbit', nodeMotionSpeed: .025, nodeMotionAmount: .08, output: .34 }],
];
export function graphSynthExpressiveStudies(defaults) {
  return STUDIES.map(([label, soundMode, mappingMode, baseFrequency, articulation, envelope, description, options], i) => {
    const { descending, ...overrides } = options;
    const [attack, decay, sustain, release, noteDuration] = envelope;
    const rhythm = GRAPH_RHYTHM_STUDIES[i];
    const parameters = { ...defaults, ...graphRhythmParameters(rhythm), graphPatch: 'custom',
      soundMode, mappingMode, baseFrequency, seedNote: Math.round(69 + 12 * Math.log2(baseFrequency / 440)),
      articulation, attack, decay, sustain, release, noteDuration,
      tuningMode: 'pure', edoDivisions: 19, pitchRange: 1, turnPitchScale: .2,
      modulationIndex: 2, modulationRatio: 1.41, stereoSpread: .85, output: .44,
      triggerScope: 'all', attackLaneCount: 2, feedbackTone: .82,
      nodeMoving: false, nodeMotionMode: 'wiggle', nodeMotionSpeed: .08, nodeMotionAmount: .04,
      ...overrides,
    };
    // The native Seed note control owns the reference frequency. Keep it
    // truthful; Pure tuning still leaves all graph-derived intervals continuous.
    parameters.baseFrequency = 440 * 2 ** ((parameters.seedNote - 69) / 12);
    const graph = graphStudyModel(parameters);
    if (descending) graph.nodes.forEach((node, index) => { node.y = .12 + .76 * index / (graph.nodes.length - 1); });
    return { id: `graph-synth-study-${rhythm.id}`, label, description, parameters, graph };
  });
}
