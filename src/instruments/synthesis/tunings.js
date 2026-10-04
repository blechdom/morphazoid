export const DEFAULT_TUNING_ID = 'edo-12-chromatic';

export const DEFAULT_TUNING_MIN_HZ = 20;
export const DEFAULT_TUNING_MAX_HZ = 8000;
export const TUNING_PITCH_MODES = Object.freeze(['nearest', 'contour', 'original']);

const SOURCES = Object.freeze({
  stanford: Object.freeze({
    label: 'Stanford University · Musical tuning',
    url: 'https://theory.stanford.edu/~blynn/sound/tuning.html',
  }),
  scala: Object.freeze({
    label: 'Huygens-Fokker Foundation · Scala scale format',
    url: 'https://www.huygens-fokker.org/scala/scl_format.html',
  }),
  chinese: Object.freeze({
    label: 'Harvard University · Sounding China',
    url: 'https://soundingchina.fas.harvard.edu/Service.html',
  }),
  japanese: Object.freeze({
    label: 'Grove Music Online · Japan, §I.4 (David W. Hughes)',
    url: 'https://doi.org/10.1093/gmo/9781561592630.article.43335',
  }),
  gamelan: Object.freeze({
    label: 'Dartmouth College · Indonesian tuning chart',
    url: 'https://eamusic.dartmouth.edu/~larry/published_articles/emi_tuning_chart.pdf',
  }),
  chopi: Object.freeze({
    label: 'UCLA Ethnomusicology Review · Chopi timbila',
    url: 'https://ethnomusicologyreview.ucla.edu/journal/volume/11/piece/513',
  }),
  amhara: Object.freeze({
    label: 'Dawit Tegbaru · Ethiopian Music Modes (Kiñit)',
    url: 'https://music-of-ethiopia.pubpub.org/pub/v1v1u0fy/release/2',
  }),
  bohlenPierce: Object.freeze({
    label: 'Huygens-Fokker Foundation · Bohlen–Pierce scale',
    url: 'https://www.huygens-fokker.org/bpsite/',
  }),
});

const centsForRatio = ratio => 1200 * Math.log2(ratio);
const centsForRatios = ratios => ratios.map(centsForRatio);
const edoCents = (divisions, steps = Array.from({ length: divisions }, (_, index) => index)) => (
  steps.map(step => step * 1200 / divisions)
);

function defineTuning({
  id,
  label,
  group,
  kind,
  evidence,
  periodRatio,
  degreeCents,
  description,
  source,
  caveat = '',
  chordDegrees,
}) {
  return Object.freeze({
    id,
    label,
    group,
    kind,
    evidence,
    periodRatio,
    degreeCents: Object.freeze([...degreeCents]),
    description,
    source,
    caveat,
    chordDegrees: Object.freeze([...chordDegrees]),
  });
}

function defineEdo({ divisions, steps, ...record }) {
  return defineTuning({
    ...record,
    kind: 'equal-division',
    evidence: 'mathematical',
    periodRatio: 2,
    degreeCents: edoCents(divisions, steps),
  });
}

const PYTHAGOREAN_RATIOS = Object.freeze([
  1,
  2187 / 2048,
  9 / 8,
  32 / 27,
  81 / 64,
  4 / 3,
  729 / 512,
  3 / 2,
  128 / 81,
  27 / 16,
  16 / 9,
  243 / 128,
]);

const QUARTER_COMMA_MEANTONE_CENTS = Object.freeze([
  0,
  76.049,
  193.15686,
  310.26471,
  386.31371,
  503.42157,
  579.47057,
  696.57843,
  813.68629,
  889.73529,
  1006.84314,
  1082.89214,
]);

export const TUNINGS = Object.freeze([
  defineEdo({
    id: DEFAULT_TUNING_ID,
    label: '12-EDO chromatic',
    group: 'Essentials',
    divisions: 12,
    description: 'Twelve equal divisions of the octave.',
    source: SOURCES.stanford,
    caveat: 'A neutral equal-tempered grid, not a claim about every performance practice.',
    chordDegrees: [0, 4, 7],
  }),
  defineEdo({
    id: 'edo-6-whole-tone',
    label: '6-EDO whole-tone',
    group: 'Essentials',
    divisions: 6,
    description: 'Six equal whole-tone divisions of the octave.',
    source: SOURCES.stanford,
    caveat: 'Whole-tone is both the complete 6-EDO grid and a familiar six-note pitch collection.',
    chordDegrees: [0, 2, 4],
  }),
  defineEdo({
    id: 'edo-12-major',
    label: '12-EDO major',
    group: 'Essentials',
    divisions: 12,
    steps: [0, 2, 4, 5, 7, 9, 11],
    description: 'A major note map selected from twelve-tone equal temperament.',
    source: SOURCES.stanford,
    caveat: 'This combines a 12-EDO tuning with a seven-note pitch collection.',
    chordDegrees: [0, 2, 4],
  }),
  defineEdo({
    id: 'edo-12-natural-minor',
    label: '12-EDO natural minor',
    group: 'Essentials',
    divisions: 12,
    steps: [0, 2, 3, 5, 7, 8, 10],
    description: 'A natural-minor note map selected from twelve-tone equal temperament.',
    source: SOURCES.stanford,
    caveat: 'This combines a 12-EDO tuning with a seven-note pitch collection.',
    chordDegrees: [0, 2, 4],
  }),
  defineEdo({
    id: 'edo-12-major-pentatonic',
    label: '12-EDO major pentatonic',
    group: 'Essentials',
    divisions: 12,
    steps: [0, 2, 4, 7, 9],
    description: 'A major-pentatonic note map selected from twelve-tone equal temperament.',
    source: SOURCES.stanford,
    caveat: 'This is a generic 12-EDO pitch collection, not a label for a particular tradition.',
    chordDegrees: [0, 2, 3],
  }),
  defineEdo({
    id: 'edo-12-minor-pentatonic',
    label: '12-EDO minor pentatonic',
    group: 'Essentials',
    divisions: 12,
    steps: [0, 3, 5, 7, 10],
    description: 'A minor-pentatonic note map selected from twelve-tone equal temperament.',
    source: SOURCES.stanford,
    caveat: 'This is a generic 12-EDO pitch collection, not a label for a particular tradition.',
    chordDegrees: [0, 1, 3],
  }),

  ...[
    [5, [0, 2, 3]],
    [7, [0, 2, 4]],
    [8, [0, 3, 5]],
    [10, [0, 3, 6]],
    [13, [0, 4, 8]],
    [19, [0, 6, 11]],
    [22, [0, 7, 13]],
    [24, [0, 8, 14]],
    [31, [0, 10, 18]],
    [53, [0, 18, 31]],
    [72, [0, 24, 42]],
  ].map(([divisions, chordDegrees]) => defineEdo({
    id: `edo-${divisions}`,
    label: `${divisions}-EDO`,
    group: 'Equal divisions',
    divisions,
    description: `${divisions} equal divisions of the octave.`,
    source: SOURCES.stanford,
    caveat: 'A mathematical pitch grid; it does not stand in for a named cultural tuning practice.',
    chordDegrees,
  })),

  defineTuning({
    id: 'pythagorean-12',
    label: 'Pythagorean · 12 notes',
    group: 'Just & historical',
    kind: 'ratios',
    evidence: 'historical-theory',
    periodRatio: 2,
    degreeCents: centsForRatios(PYTHAGOREAN_RATIOS),
    description: 'A twelve-note pitch set generated from pure 3:2 fifths.',
    source: SOURCES.stanford,
    caveat: 'Enharmonic spelling and the wolf interval depend on where the fifth chain is cut.',
    chordDegrees: [0, 4, 7],
  }),
  defineTuning({
    id: 'just-5-limit-major',
    label: '5-limit just · major',
    group: 'Just & historical',
    kind: 'ratios',
    evidence: 'historical-theory',
    periodRatio: 2,
    degreeCents: centsForRatios([1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8]),
    description: 'A root-centered diatonic major scale built from small whole-number ratios.',
    source: SOURCES.stanford,
    caveat: 'One root-centered five-limit lattice, not a universal just intonation.',
    chordDegrees: [0, 2, 4],
  }),
  defineTuning({
    id: 'just-5-limit-chromatic',
    label: '5-limit just · chromatic',
    group: 'Just & historical',
    kind: 'ratios',
    evidence: 'historical-theory',
    periodRatio: 2,
    degreeCents: centsForRatios([
      1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3,
      45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8,
    ]),
    description: 'A root-centered twelve-note chromatic set of common five-limit ratios.',
    source: SOURCES.stanford,
    caveat: 'Enharmonic choices and interval purity change when the tonal center changes.',
    chordDegrees: [0, 4, 7],
  }),
  defineTuning({
    id: 'quarter-comma-meantone',
    label: 'Quarter-comma meantone',
    group: 'Just & historical',
    kind: 'cents',
    evidence: 'historical-theory',
    periodRatio: 2,
    degreeCents: QUARTER_COMMA_MEANTONE_CENTS,
    description: 'Fifths narrowed by one quarter of the syntonic comma, producing pure 5:4 major thirds.',
    source: SOURCES.scala,
    caveat: 'This twelve-note chain has a wolf interval and an explicit enharmonic spelling choice.',
    chordDegrees: [0, 4, 7],
  }),
  defineTuning({
    id: 'harmonic-8-16',
    label: 'Harmonics 8–15 · octave at 16',
    group: 'Just & historical',
    kind: 'ratios',
    evidence: 'mathematical',
    periodRatio: 2,
    degreeCents: centsForRatios(Array.from({ length: 8 }, (_, index) => (index + 8) / 8)),
    description: 'Harmonics eight through fifteen folded into one octave; harmonic sixteen is the next period.',
    source: SOURCES.stanford,
    caveat: 'A harmonic-series pitch collection rather than an equal-step keyboard tuning.',
    chordDegrees: [0, 2, 4],
  }),

  defineTuning({
    id: 'chinese-twelve-lu',
    label: 'Chinese twelve lü · sanfen sunyi reconstruction',
    group: 'Chinese historical',
    kind: 'ratios',
    evidence: 'historical-theory',
    periodRatio: 2,
    degreeCents: centsForRatios([
      1, 2187 / 2048, 9 / 8, 19683 / 16384, 81 / 64, 177147 / 131072,
      729 / 512, 3 / 2, 6561 / 4096, 27 / 16, 59049 / 32768, 243 / 128,
    ]),
    description: 'A pitch-sorted reconstruction of twelve pitch-pipe ratios generated by alternating fifth-up and fourth-down steps.',
    source: SOURCES.chinese,
    caveat: 'Pitch-sorted mathematical reconstruction; historical generation order and pitch-pipe names are not represented.',
    chordDegrees: [0, 4, 7],
  }),
  defineTuning({
    id: 'chinese-gong-pentatonic',
    label: 'Chinese sanfen sunyi · gōng pentatonic',
    group: 'Chinese historical',
    kind: 'ratios',
    evidence: 'historical-theory',
    periodRatio: 2,
    degreeCents: centsForRatios([1, 9 / 8, 81 / 64, 3 / 2, 27 / 16]),
    description: 'A playable gōng pentatonic set derived from the historical pitch-pipe method.',
    source: SOURCES.chinese,
    caveat: 'A historical theoretical model, not a universal Chinese performance tuning.',
    chordDegrees: [0, 2, 3],
  }),

  defineTuning({
    id: 'japanese-yo-12edo',
    label: 'Japanese yō (Uehara) · 12-EDO map',
    group: 'Japanese 12-EDO maps',
    kind: 'cents',
    evidence: 'modern-keyboard-map',
    periodRatio: 2,
    degreeCents: edoCents(12, [0, 2, 5, 7, 9]),
    description: 'A 12-EDO keyboard rendering of Uehara\'s 1895 C–D–F–G–A yō collection.',
    source: SOURCES.japanese,
    caveat: 'One historical octave-based model. Later Japanese theory often uses tetrachords and multiple nuclear tones; performed intonation is not encoded.',
    chordDegrees: [0, 2, 4],
  }),
  defineTuning({
    id: 'japanese-in-12edo',
    label: 'Japanese in (Uehara, descending) · 12-EDO map',
    group: 'Japanese 12-EDO maps',
    kind: 'cents',
    evidence: 'modern-keyboard-map',
    periodRatio: 2,
    degreeCents: edoCents(12, [0, 1, 5, 7, 8]),
    description: 'A 12-EDO keyboard rendering of Uehara\'s descending C–D♭–F–G–A♭ in collection.',
    source: SOURCES.japanese,
    caveat: 'Ascending practice may replace A♭ with B♭ and sometimes D♭ with E♭. Later tetrachordal theory and performed intonation are not encoded.',
    chordDegrees: [0, 2, 4],
  }),

  defineTuning({
    id: 'javanese-slendro-5edo-model',
    label: 'Javanese sléndro · 5-EDO teaching model',
    group: 'Central Java · teaching models',
    kind: 'cents',
    evidence: 'teaching-model',
    periodRatio: 2,
    degreeCents: [0, 240, 480, 720, 960],
    description: 'An idealized five-equal-step model for exploring sléndro-like spacing.',
    source: SOURCES.gamelan,
    caveat: 'Teaching model only; individual gamelan have their own tunings and no real ensemble is claimed to match it exactly.',
    chordDegrees: [0, 2, 4],
  }),
  defineTuning({
    id: 'javanese-pelog-9edo-model',
    label: 'Javanese pélog · 9-EDO teaching model',
    group: 'Central Java · teaching models',
    kind: 'cents',
    evidence: 'teaching-model',
    periodRatio: 2,
    degreeCents: [0, 133.33333333333334, 400, 533.3333333333334, 666.6666666666666, 800, 933.3333333333334],
    description: 'An idealized seven-pitch subset of 9-EDO for exploring unequal pélog-like spacing.',
    source: SOURCES.gamelan,
    caveat: 'Teaching model only; individual gamelan have their own tunings and no real ensemble is claimed to match it exactly.',
    chordDegrees: [0, 2, 4],
  }),

  defineTuning({
    id: 'chopi-timbila-7edo-model',
    label: 'Chopi timbila · 7-EDO teaching model',
    group: 'Chopi · southern Mozambique',
    kind: 'cents',
    evidence: 'teaching-model',
    periodRatio: 2,
    degreeCents: edoCents(7),
    description: 'A mathematical approximation of documented equiheptatonic Chopi timbila pitch organization.',
    source: SOURCES.chopi,
    caveat: 'A Chopi-specific teaching model, not a generic African tuning or a measurement of an individual orchestra.',
    chordDegrees: [0, 2, 4],
  }),
  defineTuning({
    id: 'amhara-tizita-major-12edo-map',
    label: 'Amhara Tizita major · 12-EDO map',
    group: 'Amhara · Ethiopia',
    kind: 'cents',
    evidence: 'modern-keyboard-map',
    periodRatio: 2,
    degreeCents: edoCents(12, [0, 2, 4, 7, 9]),
    description: 'A contemporary keyboard mapping of Tizita major.',
    source: SOURCES.amhara,
    caveat: 'The qəñət canon, names and exact interval transcriptions are historically debated; this is a modern 12-EDO map.',
    chordDegrees: [0, 2, 3],
  }),
  defineTuning({
    id: 'amhara-ambassel-12edo-map',
    label: 'Amhara Ambassel · 12-EDO map',
    group: 'Amhara · Ethiopia',
    kind: 'cents',
    evidence: 'modern-keyboard-map',
    periodRatio: 2,
    degreeCents: edoCents(12, [0, 1, 5, 7, 8]),
    description: 'A contemporary keyboard mapping of one commonly published Ambassel form.',
    source: SOURCES.amhara,
    caveat: 'Ambassel has documented variants, and qəñət history and intervals remain debated; this is a modern 12-EDO map.',
    chordDegrees: [0, 2, 3],
  }),

  defineTuning({
    id: 'bohlen-pierce-13edt',
    label: 'Bohlen–Pierce · 13-EDT',
    group: 'Experimental',
    kind: 'equal-division',
    evidence: 'mathematical',
    periodRatio: 3,
    degreeCents: Array.from({ length: 13 }, (_, index) => index * centsForRatio(3) / 13),
    description: 'Thirteen equal divisions of a 3:1 tritave.',
    source: SOURCES.bohlenPierce,
    caveat: 'The repeating period is a tritave, not an octave; the audition voicing is only a spread of degrees.',
    chordDegrees: [0, 4, 7],
  }),
]);

const TUNING_BY_ID = new Map(TUNINGS.map(tuning => [tuning.id, tuning]));

export function sanitizeTuningId(id) {
  return typeof id === 'string' && TUNING_BY_ID.has(id) ? id : DEFAULT_TUNING_ID;
}

export function getTuning(id) {
  return TUNING_BY_ID.get(sanitizeTuningId(id));
}

export function tuningRatioForDegree(degree, id = DEFAULT_TUNING_ID) {
  if (!Number.isSafeInteger(degree)) return null;
  const tuning = getTuning(id);
  const degreeCount = tuning.degreeCents.length;
  const periodIndex = Math.floor(degree / degreeCount);
  const wrappedDegree = degree - periodIndex * degreeCount;
  const ratio = tuning.periodRatio ** periodIndex * 2 ** (tuning.degreeCents[wrappedDegree] / 1200);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/**
 * Translate an authored twelve-semitone pitch coordinate into the selected
 * tuning's repeating period. `nearest` snaps to playable scale degrees,
 * `contour` interpolates logarithmically for drawn/continuous gestures, and
 * `original` preserves the authored equal-tempered or ratio-derived interval.
 */
export function tuningRatioForSemitoneCoordinate(coordinate, id = DEFAULT_TUNING_ID, mode = 'nearest') {
  if (!Number.isFinite(coordinate)) return null;
  const pitchMode = TUNING_PITCH_MODES.includes(mode) ? mode : 'nearest';
  if (pitchMode === 'original') {
    const ratio = 2 ** (coordinate / 12);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
  }
  const tuning = getTuning(id);
  const degreePosition = coordinate * tuning.degreeCents.length / 12;
  if (pitchMode === 'nearest') return tuningRatioForDegree(Math.round(degreePosition), tuning.id);
  const lowerDegree = Math.floor(degreePosition);
  const fraction = degreePosition - lowerDegree;
  const lower = tuningRatioForDegree(lowerDegree, tuning.id);
  const upper = tuningRatioForDegree(lowerDegree + 1, tuning.id);
  if (!(lower > 0) || !(upper > 0)) return null;
  const ratio = lower * (upper / lower) ** fraction;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

function frequencyBounds(options) {
  if (options === undefined) {
    return { minHz: DEFAULT_TUNING_MIN_HZ, maxHz: DEFAULT_TUNING_MAX_HZ };
  }
  if (options === null || typeof options !== 'object') return null;
  const minHz = options.minHz === undefined ? DEFAULT_TUNING_MIN_HZ : options.minHz;
  const maxHz = options.maxHz === undefined ? DEFAULT_TUNING_MAX_HZ : options.maxHz;
  if (!Number.isFinite(minHz) || !Number.isFinite(maxHz) || minHz <= 0 || maxHz < minHz) return null;
  return { minHz, maxHz };
}

export function frequencyForTuningDegree(baseHz, degree, id = DEFAULT_TUNING_ID, options) {
  if (!Number.isFinite(baseHz) || baseHz <= 0) return null;
  const bounds = frequencyBounds(options);
  const ratio = tuningRatioForDegree(degree, id);
  if (!bounds || ratio === null) return null;
  const frequency = baseHz * ratio;
  if (!Number.isFinite(frequency) || frequency < bounds.minHz || frequency > bounds.maxHz) return null;
  return frequency;
}

export function frequencyForMidiNote(note, id = DEFAULT_TUNING_ID, options) {
  if (!Number.isSafeInteger(note) || note < 0 || note > 127) return null;
  if (options !== undefined && (options === null || typeof options !== 'object')) return null;
  const settings = options ?? {};
  const anchorNote = settings.anchorNote === undefined ? 69 : settings.anchorNote;
  const anchorHz = settings.anchorHz === undefined ? 440 : settings.anchorHz;
  if (!Number.isSafeInteger(anchorNote) || anchorNote < 0 || anchorNote > 127) return null;
  if (!Number.isFinite(anchorHz) || anchorHz <= 0) return null;
  return frequencyForTuningDegree(anchorHz, note - anchorNote, id, settings);
}

export function arpeggioDegrees(id = DEFAULT_TUNING_ID, mode = 'root') {
  const chord = [...getTuning(id).chordDegrees];
  if (mode === 'up') return chord;
  if (mode === 'down') return chord.reverse();
  if (mode === 'up-down') {
    return chord.length < 3 ? chord : [...chord, ...chord.slice(1, -1).reverse()];
  }
  return [0];
}

export function arpeggioFrequencies(baseHz, id = DEFAULT_TUNING_ID, mode = 'root', options) {
  const frequencies = arpeggioDegrees(id, mode).map(degree => (
    frequencyForTuningDegree(baseHz, degree, id, options)
  ));
  return frequencies.every(Number.isFinite) ? frequencies : null;
}
