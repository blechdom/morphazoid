import { SEQUENCE_CHRONOLOGY, SEQUENCE_SOURCES, sequenceShortDateLabel } from './sequence-chronology.js';

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const DEFAULT_LIMITATION = 'An original, reduced study of the documented mechanism; it does not reproduce factory data, a commercial interface or a recognizable composition.';
const DEFAULTS = Object.freeze({ tempoBpm: 112, stepBeats: 0.25, steps: 16, seed: 1, density: 1, transpose: 0 });

// Review is opt-in by stable ID: a future catalog entry cannot silently inherit
// an originality claim merely by going through the `d` helper.
const REVIEWED_STUDY_IDS = new Set(`
  perforated-ratio-canon accelerating-roll-lanes drawn-pitch-ribbon drawn-density-bands
  punched-parameter-roll punched-duration-grid stored-function-pulses independent-function-lines
  looped-cell-recombination parallel-control-strips three-row-voltage-walk addressed-stage-skip
  voltage-row-pendulum row-switching-voltage pulse-divider-chain captured-control-gesture
  edited-gesture-loop short-phrase-memory phrase-bank-switching numeric-pitch-duration
  clocked-uncertain-voltage rising-latched-chord falling-latched-chord pendulum-latched-chord
  captured-order-latch octave-spread-cycle chord-memory-strum accented-step-line compact-keyboard-step-line keyboard-range-arpeggio
  polyphonic-step-stack rotating-rhythm-fill transposable-phrase-memory held-chord-random-pick
  syncopated-key-cycle velocity-window-traverse clocked-phrase-chain tracker-row-steps
  tracker-effect-memory workstation-pattern-chain vector-control-lane layered-wave-lanes
  markov-note-continuation pointer-density-field rule-driven-phrase-morph groove-template-shift
  modular-logic-gates event-stream-weave euclidean-pulse-rotation co-prime-lane-cycle
  nested-event-phrases live-transform-mirror rotating-euclidean-chords locked-parameter-line
  recurring-conditional-steps chance-weighted-steps mutable-cell-loop operator-recurrence-grid
  multiplexed-phrase-arp bounded-random-walk density-breathing-stream interlocking-live-streams
  offset-euclidean-lanes
`.trim().split(/\s+/));
const AUTHORSHIP_REVIEW = Object.freeze({
  status: 'original educational study',
  reviewedBy: 'Morphazoid sequence-compendium editorial review',
  reviewedOn: '2026-10-02',
  basis: 'Note data and mechanisms were reviewed as newly authored abstractions; no factory phrase, proprietary sequence or recognizable composition is included.',
});

const dateMetadata = (placementYear, sources) => {
  const milestoneYears = [...new Set(sources.flatMap(source => source.milestoneYears))].sort((a, b) => a - b);
  const sourceKinds = [...new Set(sources.filter(source => source.milestoneYears.length).map(source => source.dateKind))];
  const exactSingleMilestone = milestoneYears.length === 1 && placementYear === milestoneYears[0];
  const multipleSources = milestoneYears.length > 1;
  const years = milestoneYears.join(' / ');
  return {
    milestoneYears,
    // Cite documented milestones in menus; placementYear only orders studies.
    shortDateLabel: sequenceShortDateLabel(sources, placementYear),
    // `year` remains the menu-sort/display compatibility field, but now it is
    // always a cited milestone rather than an invented study date.
    year: milestoneYears.at(-1),
    placementYear,
    dateLabel: exactSingleMilestone
      ? `${years} documented milestone`
      : multipleSources
        ? `based on ${years} documented sources`
        : `after ${years} documented milestone`,
    dateKind: exactSingleMilestone && sourceKinds.length === 1 ? sourceKinds[0] : 'authored study based on documented sources',
    dateNote: `This is a contemporary original study placed near ${placementYear} for chronology. Its displayed date is limited to the cited ${years} milestone${milestoneYears.length === 1 ? '' : 's'} and is not an invention claim.`,
  };
};

const d = (id, label, kind, eraId, placementYear, archetype, sourceIds, config, options = {}) => {
  if (!REVIEWED_STUDY_IDS.has(id)) throw new Error(`Sequence study ${id} has no explicit authorship review`);
  const era = SEQUENCE_CHRONOLOGY[eraId];
  const sources = sourceIds.map(sourceId => {
    const source = SEQUENCE_SOURCES[sourceId];
    if (!source) throw new Error(`Sequence study ${id} cites unknown source ${sourceId}`);
    return source;
  });
  return {
    id,
    label,
    kind,
    eraId,
    eraLabel: era.label,
    group: era.label,
    era: { id: eraId, label: era.label, range: era.range },
    ...dateMetadata(placementYear, sources),
    description: options.description || `A playable study of ${label.toLowerCase()} for comparing synthesis response.`,
    cue: options.cue || `Listen for ${String((options.testFocus || ['envelope retrigger', 'pitch tracking', 'release overlap'])[0]).toLowerCase()} while changing synthesis methods.`,
    archetype,
    defaults: { ...DEFAULTS, ...options.defaults },
    config,
    lineage: options.lineage,
    provenance: {
      originalStudy: true,
      authorship: AUTHORSHIP_REVIEW,
      sourceIds: [...sourceIds],
      sources,
    },
    limitations: options.limitations || DEFAULT_LIMITATION,
    testFocus: options.testFocus || ['envelope retrigger', 'pitch tracking', 'release overlap'],
  };
};

const studies = [
  // 1947–1964: mechanical rolls, drawings and early computer scores.
  d('perforated-ratio-canon', 'Perforated ratio canon', 'sequencer', 'postwar-score', 1947, 'ratio-canon', ['nancarrow'], {
    voices: [{ period: 2, pitchRatio: 1 }, { period: 3, phase: 1, pitchRatio: 9 / 8 }, { period: 5, phase: 2, pitchRatio: 4 / 3 }],
  }, { lineage: 'Conlon Nancarrow’s independently punched player-piano rolls.', defaults: { steps: 30, tempoBpm: 156, stepBeats: 0.125 }, testFocus: ['dense retrigger', 'microtonal pitch', 'voice stealing'] }),
  d('accelerating-roll-lanes', 'Accelerating roll lanes', 'sequencer', 'postwar-score', 1948, 'ratio-canon', ['nancarrow'], {
    voices: [{ period: 4, pitchRatio: 1 }, { period: 3, phase: 1, pitchRatio: 5 / 4 }, { period: 2, phase: 1, pitchRatio: 3 / 2 }], ramp: 0.45,
  }, { lineage: 'Nancarrow’s tempo-canon and player-piano practice.', defaults: { steps: 32, tempoBpm: 138 }, testFocus: ['accelerating attacks', 'polyphony', 'release overlap'] }),
  d('drawn-pitch-ribbon', 'Drawn pitch ribbon', 'graphical', 'postwar-score', 1951, 'drawn-rows', ['grainger'], {
    rows: [[-9.2, -6.8, -2.1, 1.7, 4.3, 7.9, 5.1, 0.4, -3.7, -7.6]],
  }, { lineage: 'Percy Grainger’s Free Music machines and drawn control rolls.', defaults: { steps: 24, tempoBpm: 84 }, testFocus: ['continuous pitch offsets', 'glide', 'register sweep'] }),
  d('drawn-density-bands', 'Drawn density bands', 'graphical', 'postwar-score', 1952, 'drawn-rows', ['grainger'], {
    rows: [[-12, -7.5, -3, 1, 6.5, 10], [7, 4.5, 1.5, -1, -5.5, -9]], masks: [[1, 1, 0, 1, 1, 0], [0, 1, 1, 0, 1, 1]],
  }, { lineage: 'Grainger’s multi-line graphical control proposals.', defaults: { steps: 24, density: 0.82 }, testFocus: ['two-note overlap', 'microtonal pitch', 'dynamic density'] }),
  d('punched-parameter-roll', 'Punched parameter roll', 'sequencer', 'postwar-score', 1957, 'parameter-rows', ['rca'], {
    pitch: [-7, 0, 5, 1.5, 9, 3, -2, 6.5], velocity: [.52, .78, .62, .9, .58, .74, .66, .86], gate: [.45, .7, .32, .82], duration: [1, 1, 2, .5, .5, 1, 1, 2],
  }, { lineage: 'RCA Mark II punched-paper control is the historical anchor; the separate pitch, velocity, gate and duration rows are a modern educational abstraction, not asserted machine fields.', defaults: { steps: 16, tempoBpm: 96 }, testFocus: ['velocity response', 'unequal durations', 'gate response'] }),
  d('punched-duration-grid', 'Punched duration grid', 'rhythm', 'postwar-score', 1958, 'parameter-rows', ['rca'], {
    pitch: [0, 2.4, -3.2, 7.1, 4.8], duration: [3, 1, 1, 2, 1, .5, .5], velocity: [.8, .48, .68, .92], gate: [.3, .85, .55],
  }, { lineage: 'RCA Mark II punched-paper control is documented; this study’s pitch, duration and articulation rows are newly authored and are not claimed as its exact encoding.', defaults: { steps: 20, tempoBpm: 104 }, testFocus: ['rhythmic contrast', 'short transients', 'long release'] }),
  d('stored-function-pulses', 'Stored function pulses', 'algorithmic', 'postwar-score', 1961, 'parameter-rows', ['music3'], {
    pitch: [0, 12 * Math.log2(7 / 6), 12 * Math.log2(4 / 3), 12 * Math.log2(3 / 2), 12 * Math.log2(7 / 4)], velocity: [.45, .6, .8, .7, .95], gate: [.2, .4, .8], duration: [1, 1, 1, 2, 3],
  }, { lineage: 'Max Mathews’s MUSIC III unit-generator scores and stored functions.', defaults: { steps: 18, tempoBpm: 126 }, testFocus: ['non-equal pitch offsets', 'event scheduling', 'amplitude tracking'] }),
  d('independent-function-lines', 'Independent function lines', 'algorithmic', 'postwar-score', 1962, 'polymeter', ['music3'], {
    lanes: [{ notes: [0, 3.4, 7.2, 10.8], period: 4 }, { notes: [12, 8.1, 5.3], period: 3, phase: 1 }, { notes: [-12, -4.9, 2.2, null, 6.7], period: 5 }],
  }, { lineage: 'Independent score parameters and reusable functions in the MUSIC language family.', defaults: { steps: 30, tempoBpm: 108 }, testFocus: ['polymeter', 'polyphony', 'microtonal beating'] }),
  d('looped-cell-recombination', 'Looped cell recombination', 'algorithmic', 'postwar-score', 1963, 'phrase-bank', ['music3'], {
    phrases: [[0, 2.3, 7.1, null], [4.9, -2.2, 9.6], [[0, 6.8], 3.1, -4.7, 8.2]], chain: [0, 1, 0, 2],
  }, { lineage: 'Stored subroutines and score-section reuse in early computer-music languages.', defaults: { steps: 28, seed: 63 }, testFocus: ['phrase boundary', 'rests', 'polyphonic event'] }),
  d('parallel-control-strips', 'Parallel control strips', 'graphical', 'postwar-score', 1964, 'drawn-rows', ['grainger', 'music3'], {
    rows: [[-5, -1, 2.5, 6, 9.5, 4, 0], [7.2, 5.8, 4, 1.2, -2.6, -6.3, -8.1]], velocities: [[.3, .42, .56, .7, .88, .64, .45], [.72, .65, .58, .5, .44, .36, .28]],
  }, { lineage: 'Grainger’s graphical control ideal interpreted through early stored computer functions.', defaults: { steps: 21, tempoBpm: 72 }, testFocus: ['slow modulation', 'two-voice balance', 'release tails'] }),

  // 1965–1977: analog voltage stages, gesture capture and digital memory.
  d('three-row-voltage-walk', 'Three-row voltage walk', 'sequencer', 'voltage-memory', 1965, 'cv-rows', ['buchla'], {
    pitch: [0, 4.2, 1.1, 8.7, -2.5, 6.3, 11, 3.6], second: [0, 7, null, 2.8, null, 9.4, 5, null], gates: [1, 1, 0, 1, 1, 1, 0, 1],
  }, { lineage: 'Buchla’s early sequential-voltage sources and modular pulse routing.', defaults: { steps: 16, tempoBpm: 118 }, testFocus: ['CV-like pitch offsets', 'rests', 'duophony'] }),
  d('addressed-stage-skip', 'Addressed stage skip', 'sequencer', 'voltage-memory', 1966, 'cv-rows', ['buchla'], {
    pitch: [-5, 0, 2.7, 7.5, 4, 11.2, 6, 9], address: [0, 1, 3, 4, 7, 6, 2, 5], gates: [1, 1, 1, 0, 1, 1, 0, 1],
  }, { lineage: 'Buchla stage addressing, pulse selection and non-linear traversal.', defaults: { steps: 24, tempoBpm: 132 }, testFocus: ['nonlinear order', 'envelope reset', 'rest handling'] }),
  d('voltage-row-pendulum', 'Voltage row pendulum', 'sequencer', 'voltage-memory', 1968, 'ordered-chord', ['moog960History', 'moog960'], {
    intervals: [-7.2, -1.1, 3.8, 8.5, 12.2, 15.7], order: 'pendulum', octaves: 1,
  }, { lineage: 'The Moog 960 anchors three-row staged voltage sequencing. Pendulum traversal is an original stress-test abstraction, not a documented 960 direction mode.', defaults: { steps: 20, tempoBpm: 110 }, testFocus: ['bidirectional traversal', 'pitch tracking', 'retrigger'] }),
  d('row-switching-voltage', 'Row-switching voltage', 'sequencer', 'voltage-memory', 1969, 'cv-rows', ['moog960History', 'moog960'], {
    pitch: [0, 5, 2, 9, 3, 7, -2, 11], transpose: [0, 0, 4.8, 4.8, -3.4, -3.4, 7.1, 7.1], gates: [1, 0, 1, 1, 1, 0, 1, 1],
  }, { lineage: 'Multiple voltage rows and switchable stage outputs of large-format analog sequencers.', defaults: { steps: 24, tempoBpm: 92 }, testFocus: ['row interaction', 'register jumps', 'rests'] }),
  d('pulse-divider-chain', 'Pulse-divider chain', 'rhythm', 'voltage-memory', 1970, 'polymeter', ['moog960History', 'moog960', 'buchla'], {
    lanes: [{ notes: [0], period: 2 }, { notes: [7.1], period: 3 }, { notes: [12.4], period: 5 }, { notes: [-4.9], period: 7 }],
  }, { lineage: 'Moog and Buchla sources ground clocked voltage-stage sequencing. The co-prime divider patch is an original abstraction, not a documented factory patch.', defaults: { steps: 42, tempoBpm: 144, stepBeats: .125 }, testFocus: ['dense coincidence', 'voice limit', 'transient separation'] }),
  d('captured-control-gesture', 'Captured control gesture', 'graphical', 'voltage-memory', 1970, 'gesture', ['groove'], {
    points: [{ time: 0, note: -8, pressure: .25 }, { time: .18, note: -1.3, pressure: .7 }, { time: .43, note: 5.8, pressure: .5 }, { time: .68, note: 2.1, pressure: .9 }, { time: 1, note: 10.4, pressure: .38 }],
  }, { lineage: 'The GROOVE system’s captured, stored and edited functions of time.', defaults: { steps: 28, tempoBpm: 78 }, testFocus: ['continuous gesture', 'velocity curve', 'glide'] }),
  d('edited-gesture-loop', 'Edited gesture loop', 'graphical', 'voltage-memory', 1971, 'gesture', ['groove'], {
    points: [{ time: 0, note: 0, pressure: .8 }, { time: .12, note: 6.6, pressure: .45 }, { time: .35, note: -3.1, pressure: .65 }, { time: .7, note: 11.7, pressure: .92 }, { time: 1, note: 1.8, pressure: .55 }],
  }, { lineage: 'GROOVE’s editable time functions and performer-computer feedback.', defaults: { steps: 32, tempoBpm: 88 }, testFocus: ['loop seam', 'gesture interpolation', 'dynamic response'] }),
  d('short-phrase-memory', 'Short phrase memory', 'sequencer', 'voltage-memory', 1974, 'phrase-bank', ['oberheim'], {
    phrases: [[0, 3.2, 7, 10.5, null, 5.1], [-4.8, 2.4, 8.3, 6]], chain: [0, 0, 1],
  }, { lineage: 'Oberheim DS-2A digital phrase storage and playback.', defaults: { steps: 24, tempoBpm: 116 }, testFocus: ['phrase repeat', 'memory boundary', 'live transpose'] }),
  d('phrase-bank-switching', 'Phrase bank switching', 'sequencer', 'voltage-memory', 1975, 'phrase-bank', ['sequential'], {
    phrases: [[0, 5.4, 8.8, 2.1], [7.2, 4.1, -2.6, null, 9.5], [[0, 6.9], 3.5, 11.1]], chain: [0, 1, 2, 1],
  }, { lineage: 'Sequential Circuits Model 800 stored sequences and bank selection.', defaults: { steps: 32, tempoBpm: 128 }, testFocus: ['bank transition', 'polyphonic step', 'rest handling'] }),
  d('numeric-pitch-duration', 'Numeric pitch and duration', 'sequencer', 'voltage-memory', 1977, 'parameter-rows', ['rolandHistory'], {
    pitch: [-12, -4.9, 0, 3.2, 7.1, 12.3, 5.8, -1.7], duration: [1, 2, .5, .5, 3, 1, 1, 2], velocity: [.65, .8, .46, .72, .92, .56], gate: [.7, .4, .9, .25],
  }, { lineage: 'Roland MC-8 MicroComposer numeric pitch, duration and dynamics entry.', defaults: { steps: 20, tempoBpm: 100 }, testFocus: ['numeric duration', 'wide register', 'velocity response'] }),
  d('clocked-uncertain-voltage', 'Clocked unequal voltage', 'sequencer', 'voltage-memory', 1977, 'cv-rows', ['buchla'], {
    pitch: [-8.2, -2.7, 0, 4.6, 7.4, 11.1], address: [0, 2, 1, 4, 3, 5, 2, 4], gates: [1, 1, 0, 1, 1, 1, 0, 1],
  }, { lineage: 'Buchla supplies the clocked-voltage lineage. The irregular address order is an original deterministic study and is not attributed as Markov behavior or a documented patch.', defaults: { steps: 32, density: .9 }, testFocus: ['irregular address order', 'rest pattern', 'microtonal pitch'] }),

  // 1978–1985: widely available arpeggiators, microsequencers and sync.
  d('rising-latched-chord', 'Rising latched chord', 'arpeggiator', 'classic-arp', 1978, 'ordered-chord', ['jupiter4'], {
    intervals: [0, 3.8, 7.1, 10.6], order: 'up', octaves: 2,
  }, { lineage: 'Roland Jupiter-4 latched polyphonic arpeggiator.', defaults: { steps: 24, tempoBpm: 124 }, testFocus: ['octave crossing', 'steady retrigger', 'filter envelope'] }),
  d('falling-latched-chord', 'Falling latched chord', 'arpeggiator', 'classic-arp', 1979, 'ordered-chord', ['jupiter4'], {
    intervals: [0, 4, 7.2, 11], order: 'down', octaves: 2,
  }, { lineage: 'Downward traversal modes common to late-1970s keyboard arpeggiators.', defaults: { steps: 24, tempoBpm: 132 }, testFocus: ['descending transients', 'octave boundary', 'voice release'] }),
  d('pendulum-latched-chord', 'Pendulum latched chord', 'arpeggiator', 'classic-arp', 1979, 'ordered-chord', ['jupiter4'], {
    intervals: [-5, 0, 3.5, 7.2, 12.1], order: 'pendulum', octaves: 1,
  }, { lineage: 'Up/down arpeggiator traversal in early microprocessor polysynths.', defaults: { steps: 28, tempoBpm: 118 }, testFocus: ['turnaround duplicate avoidance', 'legato', 'pitch tracking'] }),
  d('captured-order-latch', 'Latched chord groups', 'arpeggiator', 'classic-arp', 1980, 'phrase-arp', ['jupiter4'], {
    chords: [[0, 7.1, 3.4, 10.2], [-2, 5, 8.7]], order: 'up', repeats: 2,
  }, { lineage: 'The Jupiter-4 anchors early polyphonic arpeggiation. Group changes and note material are original; the source is not used to claim a played-order mode.', defaults: { steps: 24, tempoBpm: 136 }, testFocus: ['grouped traversal', 'latch continuity', 'chord change'] }),
  d('octave-spread-cycle', 'Octave-spread cycle', 'arpeggiator', 'classic-arp', 1980, 'ordered-chord', ['jupiter4'], {
    intervals: [0, 2.2, 6.8, 9.7], order: 'up', octaves: 3,
  }, { lineage: 'The Jupiter-4 anchors early polyphonic arpeggiation. This wide rising traversal is an original stress-test abstraction, not a claim for an inside-out product mode.', defaults: { steps: 32, tempoBpm: 148 }, testFocus: ['wide pitch range', 'alias exposure', 'envelope consistency'] }),
  d('chord-memory-strum', 'Polyphonic chord fan', 'arpeggiator', 'classic-arp', 1981, 'phrase-arp', ['sequential'], {
    chords: [[0, 3.7, 7.1, 11.4], [2.1, 6.8, 9.6, 14.2]], order: 'outside-in', strum: true,
  }, { lineage: 'The Sequential Model 800 source supplies early stored-sequence chronology only. Polyphonic chord fan-out is an original modern stress test and is not attributed to that product.', defaults: { steps: 24, tempoBpm: 104 }, testFocus: ['four-note voicing', 'voice allocation', 'release overlap'] }),
  d('accented-step-line', 'Accented step line', 'sequencer', 'classic-arp', 1980, 'accent-pattern', ['tr808'], {
    notes: [-12, -4.8, -1.7, 0, 7.2, 3.1, 10.4, null, -2.3, 5.5, 8.8, 1.2, 12.1, 6.2, null, -5], accents: [0, 3, 6, 10, 12],
  }, { lineage: 'The TR-808 owner’s manual grounds programmable steps and accents. Pitches and accent locations are original, and no slide behavior is claimed.', defaults: { steps: 16, tempoBpm: 126 }, testFocus: ['accent response', 'short gate response', 'rests'] }),
  d('compact-keyboard-step-line', 'Compact keyboard step line', 'sequencer', 'classic-arp', 1982, 'accent-pattern', ['sh101'], {
    notes: [0, 2.4, 5.1, 9.7, 7.3, 12, 8.4, 3.6, -1.8, null, 4.5, 10.8], accents: [0, 4, 8],
  }, { lineage: 'The SH-101 owner’s manual grounds compact monophonic sequence entry and playback. The note line and accents are original; tie, glide and portamento behavior are not claimed.', defaults: { steps: 24, tempoBpm: 114 }, testFocus: ['monophonic retrigger', 'accent response', 'register motion'] }),
  d('keyboard-range-arpeggio', 'Octave-range keyboard arp', 'arpeggiator', 'classic-arp', 1982, 'ordered-chord', ['juno60', 'juno60Manual'], {
    intervals: [0, 3.8, 7.1], order: 'pendulum', octaves: 3, fullTraversal: true,
  }, {
    description: 'A JUNO-60-inspired range arpeggiator with complete upward, downward and returning sweeps.',
    lineage: 'The 1982 JUNO-60 offered Up, Down and Up/Down across one to three octaves. This study extends the range to eight octaves and adds inside-out and outside-in traversals.',
    limitations: 'Original note material, not a hardware emulation. Wider ranges are modern extensions. Complete traversals derive their cycle length from the notes and direction; the whole pattern is moved into the 20–8,000 Hz output range when needed, rather than reproducing the original keyboard ceiling behavior.',
    defaults: { steps: 16, stepBeats: .25, tempoBpm: 112, transpose: -12 },
    testFocus: ['complete up/down sweeps', 'octave range', 'register-wide envelope response'],
  }),
  d('polyphonic-step-stack', 'Polyphonic step stack', 'sequencer', 'classic-arp', 1983, 'tracker', ['midi'], {
    rows: [{ notes: [0, 7.1], velocity: .68 }, { notes: [3.4, 10.2], velocity: .82 }, { notes: null }, { notes: [-4.8, 2.1, 8.9], velocity: .76 }, { notes: [5.2], gate: .9 }],
  }, { lineage: 'MIDI supplies interoperable note, velocity and synchronization lineage. The chord rows and phrase structure are an original abstraction, not a feature established by the standards history.', defaults: { steps: 20, tempoBpm: 108 }, testFocus: ['polyphonic chords', 'MIDI-like velocity', 'rest row'] }),
  d('rotating-rhythm-fill', 'Rotating rhythm fill', 'rhythm', 'classic-arp', 1983, 'groove', ['tr808'], {
    notes: [0, null, -5, null, 7, null, -2.5, 10], accents: [0, 6], timing: [1, 1, 1, 1, .75, 1.25, .5, 1.5], rotateEvery: 2,
  }, { lineage: 'Pattern variation, fill and accent workflows of programmable rhythm composers.', defaults: { steps: 32, tempoBpm: 122, stepBeats: .125 }, testFocus: ['short gate', 'accent dynamics', 'timing contrast'] }),
  d('transposable-phrase-memory', 'Transposable phrase memory', 'sequencer', 'classic-arp', 1984, 'phrase-bank', ['sh101', 'midi'], {
    phrases: [[0, 4.1, 7.2, 11, null, 6.3], [-5, 1.8, 8.6, 3.3]], chain: [0, 1, 0, 1], phraseTranspose: [0, 5.2, -2.7, 7.1],
  }, { lineage: 'Live keyboard transposition of compact sequencers synchronized through MIDI-era systems.', defaults: { steps: 28, tempoBpm: 116 }, testFocus: ['live transpose model', 'phrase continuity', 'register change'] }),
  d('held-chord-random-pick', 'Held-chord rising repeat', 'arpeggiator', 'classic-arp', 1984, 'ordered-chord', ['jupiter4'], {
    intervals: [0, 3.7, 7.1, 10.8, 14.2], order: 'up', octaves: 1,
  }, { lineage: 'The Jupiter-4 anchors early polyphonic arpeggiation. This deterministic repeat does not attribute random selection or Markov behavior to that source.', defaults: { steps: 32, tempoBpm: 140 }, testFocus: ['held-note traversal', 'repeated cycle', 'fast release'] }),
  d('syncopated-key-cycle', 'Syncopated key cycle', 'arpeggiator', 'classic-arp', 1985, 'phrase-arp', ['midi'], {
    chords: [[0, 5.1, 9.2], [2.3, 7.4, 12.2], [-3.1, 3.6, 10.1]], order: 'pendulum', rests: [3, 7],
  }, { lineage: 'MIDI supplies event and synchronization lineage. The pendulum ordering, chords and rests are an original test pattern rather than mechanisms claimed by the standards source.', defaults: { steps: 24, tempoBpm: 125 }, testFocus: ['syncopated gate', 'external-clock model', 'chord changes'] }),

  // 1986–1999: MIDI software, trackers, workstations and interactive systems.
  d('velocity-window-traverse', 'Velocity-window traverse', 'arpeggiator', 'midi-workstation', 1986, 'phrase-arp', ['midi'], {
    chords: [[0, 4, 7, 11], [-2, 3, 8, 12]], order: 'inside-out', velocityCycle: [.3, .5, .72, .94],
  }, { lineage: 'MIDI supplies velocity-bearing note-event lineage. The velocity cycle and traversal are a modern original abstraction, not functionality attributed to the standards history.', defaults: { steps: 24, tempoBpm: 128 }, testFocus: ['velocity layers', 'filter tracking', 'poly release'] }),
  d('clocked-phrase-chain', 'Clocked phrase chain', 'sequencer', 'midi-workstation', 1987, 'phrase-bank', ['midi'], {
    phrases: [[0, 7, 2.1, 9.4], [4.3, 1.1, -3.5, null, 6.8], [[0, 7.2], 10.5, 5.2]], chain: [0, 1, 0, 2],
  }, { lineage: 'MIDI supplies shared clock and note-event lineage. The phrase bank and chain are original study material, not a sequencing feature established by the standards source.', defaults: { steps: 32, tempoBpm: 120 }, testFocus: ['clock boundary', 'phrase chain', 'polyphonic event'] }),
  d('tracker-row-steps', 'Tracker row steps', 'sequencer', 'midi-workstation', 1987, 'tracker', ['trackerHistory', 'tracker'], {
    rows: [{ notes: [0], velocity: .72 }, { notes: [3.2], gate: .4 }, { notes: null }, { notes: [7.1], velocity: .9 }, { notes: [10.4], gate: .9 }, { notes: [5.3], velocity: .62 }, { notes: null }, { notes: [-2.6], velocity: .55 }],
  }, { lineage: 'Ultimate Soundtracker and descendant row/pattern formats.', defaults: { steps: 32, tempoBpm: 132, stepBeats: .125 }, testFocus: ['row precision', 'gate contrast', 'rest rows'] }),
  d('tracker-effect-memory', 'Tracker carry fields', 'sequencer', 'midi-workstation', 1988, 'tracker', ['trackerHistory', 'tracker'], {
    rows: [{ notes: [0], gate: .32 }, { notes: [2.2] }, { notes: [4.9], gate: .48 }, { notes: [7.3] }, { notes: [9.8], velocity: .95 }, { notes: [6.1], gate: .82 }, { notes: [1.5] }, { notes: [-3.7] }], remember: ['gate', 'velocity'],
  }, { lineage: 'Tracker row and effect fields inspire this original carried-gate and velocity abstraction; it does not claim exact ProTracker effect-memory semantics.', defaults: { steps: 32, tempoBpm: 144, stepBeats: .125 }, testFocus: ['carried gate', 'velocity contrast', 'rapid articulation'] }),
  d('workstation-pattern-chain', 'Workstation pattern chain', 'sequencer', 'midi-workstation', 1988, 'phrase-bank', ['korgM1'], {
    phrases: [[0, 4.1, 7.2, 2.2], [9.3, 6.4, 1.3, -3.1], [[0, 7], [2.1, 9.2], 5.4, null]], chain: [0, 1, 0, 2, 1],
  }, { lineage: 'The Korg M1 anchors the 1988 integrated-workstation and sequencer milestone; these phrase banks and chains are an original abstraction.', defaults: { steps: 36, tempoBpm: 112 }, testFocus: ['arrangement boundary', 'polyphony', 'long sequence'] }),
  d('vector-control-lane', 'Wave-sequence parameter lane', 'graphical', 'midi-workstation', 1990, 'parameter-rows', ['wavestation'], {
    pitch: [0, 2.4, 6.8, 10.1, 5.3, -1.9], velocity: [.2, .38, .62, .9, .7, .45], gate: [.9, .7, .5, .3, .5, .7], duration: [1, 1, 2, 1, .5, .5],
  }, { lineage: 'The WAVESTATION source grounds the 1990 wave-sequencing and vector-synthesis milestone. This pitch/velocity/gate/duration row is a modern testing analogy and does not implement vector control or factory wave data.', defaults: { steps: 24, tempoBpm: 92 }, testFocus: ['parameter lane', 'amplitude contour', 'unequal duration'] }),
  d('layered-wave-lanes', 'Layered wave lanes', 'sequencer', 'midi-workstation', 1990, 'polymeter', ['wavestation'], {
    lanes: [{ notes: [0, 7.1, 3.4, 10.2], period: 4 }, { notes: [12, 8.8, 5.1], period: 3, phase: 1 }, { notes: [-12, null, -4.7, 2.2, 6.5], period: 5 }],
  }, { lineage: 'WAVESTATION wave sequencing abstracted as independent event lanes.', defaults: { steps: 30, tempoBpm: 105 }, testFocus: ['lane phase', 'polymeter', 'voice stealing'] }),
  d('markov-note-continuation', 'Interactive note field', 'graphical', 'midi-workstation', 1991, 'gesture', ['musicMouse'], {
    points: [{ time: 0, note: -7.1, pressure: .45 }, { time: .2, note: 0, pressure: .8 }, { time: .46, note: 7.2, pressure: .58 }, { time: .7, note: 3.8, pressure: .92 }, { time: 1, note: 14.1, pressure: .4 }], densityFromPressure: true,
  }, { lineage: 'Music Mouse grounds two-dimensional interactive musical gesture. This pitch-and-density mapping is original and makes no Markov-chain attribution to that source.', defaults: { steps: 36, seed: 91, tempoBpm: 118 }, testFocus: ['interactive density', 'gesture contour', 'register bounds'] }),
  d('pointer-density-field', 'Pointer density field', 'graphical', 'midi-workstation', 1992, 'gesture', ['musicMouse'], {
    points: [{ time: 0, note: -12, pressure: .2 }, { time: .22, note: -2.5, pressure: .85 }, { time: .5, note: 8.8, pressure: .55 }, { time: .76, note: 3.1, pressure: .95 }, { time: 1, note: 14.2, pressure: .35 }], densityFromPressure: true,
  }, { lineage: 'Music Mouse grounds two-dimensional interactive musical gesture; this pitch-and-density mapping is an original testing abstraction.', defaults: { steps: 32, tempoBpm: 126, density: .88 }, testFocus: ['gesture density', 'wide range', 'velocity sweep'] }),
  d('rule-driven-phrase-morph', 'Rule-driven phrase morph', 'algorithmic', 'midi-workstation', 1994, 'mutating-loop', ['koan'], {
    base: [0, 3.4, 7.2, 10.1, 5, -2.6, 8.8, null], mutationSet: [-5.3, -1.7, 2.8, 6.5, 11.4], probability: .24,
  }, { lineage: 'SSEYO Koan bounded generative rules and evolving musical objects.', defaults: { steps: 32, seed: 1994, tempoBpm: 96 }, testFocus: ['bounded mutation', 'seed reproducibility', 'loop continuity'] }),
  d('groove-template-shift', 'Groove template shift', 'rhythm', 'pattern-probability', 2009, 'groove', ['midi', 'ableton'], {
    notes: [0, -5, 7.1, -2.4, 10.2, 3.3, 8.4, null], timing: [1.18, .82, 1.08, .92, 1.22, .78, 1.05, .95], accents: [0, 4, 6],
  }, { lineage: 'MIDI supplies transferable note events; Ableton Live documentation grounds editable groove timing and velocity. This timing template is original and uses no bundled groove.', defaults: { steps: 32, tempoBpm: 108, stepBeats: .125 }, testFocus: ['microtiming', 'accent response', 'timing loop seam'] }),
  d('modular-logic-gates', 'Modular logic gates', 'algorithmic', 'midi-workstation', 1997, 'conditional-steps', ['nordModular'], {
    cells: [{ note: 0, every: 2 }, { note: 7.1, every: 3, offset: 1 }, { note: 12.2, every: 5 }, { note: -4.8, probability: .42 }, { note: 3.3, every: 7, offset: 3 }],
  }, { lineage: 'Clavia Nord Modular clock, logic and step modules.', defaults: { steps: 42, seed: 98, tempoBpm: 138, stepBeats: .125 }, testFocus: ['logic coincidence', 'conditional gate', 'polyphony ceiling'] }),

  // 2000–present: streams, Euclidean distribution, conditions and live mutation.
  d('event-stream-weave', 'Event stream weave', 'algorithmic', 'pattern-probability', 2002, 'polymeter', ['supercolliderHistory', 'supercollider'], {
    lanes: [{ notes: [0, 2.2, 7.1, 4.8], period: 4 }, { notes: [12.3, 8.4, null], period: 3 }, { notes: [-7, -1.8, 5.5, 10.1, null], period: 5, phase: 2 }],
  }, { lineage: 'SuperCollider Patterns, Streams and Events.', defaults: { steps: 60, tempoBpm: 116 }, testFocus: ['independent streams', 'long-cycle repeat', 'voice allocation'] }),
  d('euclidean-pulse-rotation', 'Euclidean pulse rotation', 'rhythm', 'pattern-probability', 2005, 'euclidean', ['euclidean'], {
    pulses: 7, steps: 16, rotation: 3, pitches: [0, 3.5, 7.1, 10.6, 14.2],
  }, { lineage: 'Godfried Toussaint’s description of Euclidean pulse distribution.', defaults: { steps: 32, tempoBpm: 128, stepBeats: .125 }, testFocus: ['distributed attacks', 'rotation', 'rest precision'] }),
  d('co-prime-lane-cycle', 'Co-prime lane cycle', 'sequencer', 'pattern-probability', 2006, 'polymeter', ['supercolliderHistory', 'supercollider'], {
    lanes: [{ notes: [0, 4.2, 7.1, 9.8, 2.4], period: 5 }, { notes: [12.1, 6.3, -1.8, 10.5, null, 3.1, 8.7], period: 7 }],
  }, { lineage: 'Pattern-language composition with independent finite streams.', defaults: { steps: 35, tempoBpm: 122 }, testFocus: ['co-prime cycle', 'lane collision', 'release overlap'] }),
  d('nested-event-phrases', 'Nested event phrases', 'algorithmic', 'pattern-probability', 2007, 'phrase-bank', ['supercolliderHistory', 'supercollider'], {
    phrases: [[0, 2.6, 7.3], [[4.1, 10.8], 6.2, null, -1.9], [12.2, 8.5, 3.4, -3.1, 5.7]], chain: [0, 1, 0, 2, 1, 2],
  }, { lineage: 'SuperCollider’s nested Pattern and phrase-network practices.', defaults: { steps: 36, tempoBpm: 110 }, testFocus: ['nested phrase', 'chord event', 'variable boundary'] }),
  d('live-transform-mirror', 'Live transform mirror', 'algorithmic', 'pattern-probability', 2009, 'mutating-loop', ['tidal'], {
    base: [-5.2, 0, 3.7, 8.1, 11.4, 6.2, 1.5, null], mutationSet: [-8.8, -2.4, 2.9, 7.3, 12.1], probability: .18, generations: 4, mirrorEvery: 2,
  }, { lineage: 'TidalCycles live pattern transformations and cyclic structure.', defaults: { steps: 32, seed: 2009, tempoBpm: 132 }, testFocus: ['cycle transform', 'mirror order', 'seed stability'] }),
  d('rotating-euclidean-chords', 'Rotating Euclidean chords', 'algorithmic', 'pattern-probability', 2010, 'euclidean', ['euclidean', 'supercolliderHistory', 'supercollider'], {
    pulses: 5, steps: 13, rotation: 4, pitches: [[0, 7.1], [3.4, 10.5], [-2.2, 5.1], [6.3, 13.2]],
  }, { lineage: 'Euclidean distribution combined with event-pattern chord streams.', defaults: { steps: 39, tempoBpm: 124, stepBeats: .125 }, testFocus: ['irregular cycle', 'dyads', 'rotation'] }),
  d('locked-parameter-line', 'Locked parameter line', 'sequencer', 'pattern-probability', 2017, 'tracker', ['elektron'], {
    rows: [{ notes: [0], velocity: .42, gate: .2 }, { notes: [7.1], velocity: .9, gate: .8 }, { notes: [-2.8], velocity: .58, gate: .55 }, { notes: null }, { notes: [10.4], velocity: .65, gate: .35 }, { notes: [3.3], velocity: .76, gate: .9 }], remember: [],
  }, { lineage: 'Elektron parameter locks abstracted to velocity, gate and articulation.', defaults: { steps: 24, tempoBpm: 126 }, testFocus: ['per-step state', 'velocity jump', 'gate jump'] }),
  d('recurring-conditional-steps', 'Recurring conditional steps', 'algorithmic', 'pattern-probability', 2017, 'conditional-steps', ['elektron'], {
    cells: [{ note: 0, every: 1 }, { note: 7.2, every: 2, offset: 1 }, { note: 3.5, every: 3, offset: 2 }, { note: 10.8, every: 4 }, { note: -4.7, every: 7, offset: 5 }],
  }, { lineage: 'Elektron conditional locks and recurrence conditions.', defaults: { steps: 56, tempoBpm: 120, stepBeats: .125 }, testFocus: ['recurrence condition', 'long cycle', 'coincident notes'] }),
  d('chance-weighted-steps', 'Chance-weighted steps', 'algorithmic', 'pattern-probability', 2017, 'conditional-steps', ['elektron'], {
    cells: [{ note: -5, probability: .95 }, { note: 0, probability: .72 }, { note: 4.2, probability: .5 }, { note: 7.1, probability: .33 }, { note: 11.6, probability: .18 }],
  }, { lineage: 'Per-step probability in modern hardware sequencers including Elektron instruments.', defaults: { steps: 40, seed: 1717, tempoBpm: 134 }, testFocus: ['probability seed', 'sparse density', 'rest handling'] }),
  d('mutable-cell-loop', 'Mutable cell loop', 'algorithmic', 'pattern-probability', 2018, 'mutating-loop', ['tidal'], {
    base: [0, 4.1, 7.3, 9.8, 2.4, -3.2, 6.6, 12.1], mutationSet: [-7.4, -1.5, 3.3, 5.8, 10.6, 14.2], probability: .27,
  }, { lineage: 'Live-coded cyclic mutation in TidalCycles and related environments.', defaults: { steps: 48, seed: 1818, tempoBpm: 142 }, testFocus: ['deterministic mutation', 'cell evolution', 'pitch bounds'] }),
  d('operator-recurrence-grid', 'Operator recurrence grid', 'algorithmic', 'pattern-probability', 2021, 'conditional-steps', ['bitwig'], {
    cells: [{ note: 0, every: 2 }, { note: 2.7, every: 3 }, { note: 7.4, every: 4, offset: 1 }, { note: 11.1, every: 5, offset: 2 }, { note: -3.5, probability: .4 }],
  }, { lineage: 'Bitwig Studio Operators for recurrence, occurrence and chance.', defaults: { steps: 60, seed: 2021, tempoBpm: 126, stepBeats: .125 }, testFocus: ['recurrence operator', 'probability', 'long cycle'] }),
  d('multiplexed-phrase-arp', 'Multiplexed phrase arpeggio', 'arpeggiator', 'pattern-probability', 2021, 'phrase-arp', ['supercolliderHistory', 'supercollider', 'bitwig'], {
    chords: [[0, 3.8, 7.1, 10.9], [2.2, 6.4, 9.5, 14.1], [-3.1, 1.7, 8.3]], order: 'pendulum', velocityCycle: [.45, .72, .92, .6], rests: [11],
  }, { lineage: 'Phrase arpeggiators and independently patterned event parameters in modern software.', defaults: { steps: 36, tempoBpm: 138 }, testFocus: ['chord multiplex', 'parameter cycle', 'phrase transition'] }),
  d('bounded-random-walk', 'Bounded random walk', 'algorithmic', 'pattern-probability', 2022, 'markov', ['supercolliderHistory', 'supercolliderMarkov', 'strudel'], {
    states: [-12, -7.1, -3.2, 0, 2.7, 6.4, 9.8, 14.1], transitions: [[.05, .55, .3, .1], [.2, .15, .45, .2], [.1, .25, .3, .25, .1]], maxLeap: 2,
  }, { lineage: 'SuperCollider Pmarkov explicitly grounds Markov-chain patterns; Strudel supplies contemporary browser pattern context. Transition weights and pitches are original.', defaults: { steps: 48, seed: 2222, tempoBpm: 130 }, testFocus: ['seed reproducibility', 'bounded leap', 'register bounds'] }),
  d('density-breathing-stream', 'Density-breathing stream', 'algorithmic', 'pattern-probability', 2022, 'conditional-steps', ['strudel'], {
    cells: [{ note: -7.2, probability: .35 }, { note: -1.8, probability: .55 }, { note: 3.4, probability: .8 }, { note: 7.1, probability: .55 }, { note: 12.3, probability: .35 }], breathe: .4,
  }, { lineage: 'Continuously transformed density in live-coded browser patterns.', defaults: { steps: 48, seed: 2323, tempoBpm: 112 }, testFocus: ['changing density', 'probability seed', 'dynamic rests'] }),
  d('interlocking-live-streams', 'Interlocking live streams', 'algorithmic', 'pattern-probability', 2022, 'polymeter', ['tidal', 'strudel'], {
    lanes: [{ notes: [0, 3.1, 7.2, 10.6], period: 4 }, { notes: [12.2, 8.5, 5.4], period: 3, phase: 1 }, { notes: [-9.3, -2.1, 4.7, null, 9.8], period: 5, phase: 2 }, { notes: [14.1, null, 6.6, 1.8, -4.5, 11.3, null], period: 7 }],
  }, { lineage: 'TidalCycles and Strudel independently transformed, interlocking pattern streams.', defaults: { steps: 60, tempoBpm: 128 }, testFocus: ['four-lane collision', 'voice ceiling', 'long-cycle timing'] }),
  d('offset-euclidean-lanes', 'Offset Euclidean lanes', 'rhythm', 'pattern-probability', 2022, 'polymeter', ['euclidean', 'strudel'], {
    lanes: [{ notes: [0, null, 7.2, null, 3.3], period: 5 }, { notes: [12.1, null, null, 5.4, null, 9.8, null], period: 7, phase: 2 }, { notes: [-5.1, null, 2.6], period: 3, phase: 1 }],
  }, { lineage: 'Euclidean and polymetric pattern operations in contemporary live-coding tools.', defaults: { steps: 60, tempoBpm: 136, stepBeats: .125 }, testFocus: ['offset lanes', 'sparse collision', 'cycle boundary'] }),
];

export const SEQUENCE_STUDIES = deepFreeze(studies);
export const SEQUENCE_STUDY_COUNT = SEQUENCE_STUDIES.length;
export const SEQUENCE_KINDS = deepFreeze(['sequencer', 'arpeggiator', 'rhythm', 'graphical', 'algorithmic']);

const STUDIES_BY_ID = new Map(SEQUENCE_STUDIES.map(study => [study.id, study]));

export const getSequenceStudy = id => STUDIES_BY_ID.get(id) || null;
export const studiesForEra = eraId => SEQUENCE_STUDIES
  .filter(study => study.eraId === eraId)
  .sort((a, b) => a.placementYear - b.placementYear || a.label.localeCompare(b.label));
export const studiesForKind = kind => SEQUENCE_STUDIES.filter(study => study.kind === kind);
