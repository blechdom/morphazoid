/**
 * Milestones used by the Synthesaurus sequence compendium.
 *
 * Dates describe documented systems or publications, not exclusive invention
 * claims.  Commercial names live in this provenance module so the playable
 * study labels can remain neutral and mechanism-led.
 */

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export const SEQUENCE_ERAS = deepFreeze([
  {
    id: 'postwar-score',
    label: 'Postwar rolls, drawings and computer scores',
    range: '1947–1964',
    startYear: 1947,
    endYear: 1964,
    summary: 'Mechanical rolls, drawn control traces, punched parameter cards and early stored computer-music scores separated musical events from the act of playing them.',
  },
  {
    id: 'voltage-memory',
    label: 'Voltage stages and digital memory',
    range: '1965–1977',
    startYear: 1965,
    endYear: 1977,
    summary: 'Clocked voltage rows, stage addressing, performance capture and increasingly affordable digital memory turned the sequence into a live instrument.',
  },
  {
    id: 'classic-arp',
    label: 'Classic arpeggiators and step sequencers',
    range: '1978–1985',
    startYear: 1978,
    endYear: 1985,
    summary: 'Microprocessors brought latch, chord traversal, octave range, phrase memory, accents and synchronized patterns into widely used instruments.',
  },
  {
    id: 'midi-workstation',
    label: 'MIDI, workstations and generative software',
    range: '1986–1999',
    startYear: 1986,
    endYear: 1999,
    summary: 'Interoperable MIDI systems, trackers, workstations and interactive software expanded sequencing from fixed note rows to arranged, transformed and probabilistic event streams.',
  },
  {
    id: 'pattern-probability',
    label: 'Pattern languages and probability',
    range: '2000–present',
    startYear: 2000,
    endYear: null,
    summary: 'Pattern languages, grooveboxes and modular software made nested time, Euclidean distribution, per-step state, conditions and live mutation routine compositional materials.',
  },
]);

const sources = {
  nancarrow: {
    label: 'IRCAM composer biography and works overview: Conlon Nancarrow',
    year: 1947,
    dateKind: 'documented instrument acquisition',
    url: 'https://brahms.ircam.fr/en/conlon-nancarrow',
    limitation: 'IRCAM dates Nancarrow’s purchase of a player piano and encounter with a roll-punching machine to 1947. This anchors his later roll studies; it does not date every tempo-canon technique or provide transferable roll data.',
  },
  grainger: {
    label: 'Grainger Museum exhibition catalogue: dated 1951 Free Music graphs and machines',
    year: 1951,
    dateKind: 'documented instrument development',
    url: 'https://grainger.unimelb.edu.au/__data/assets/pdf_file/0011/2036666/Free_Music_exhibition.pdf',
    limitation: 'The museum transcribes dated 1951 graphs, reed tools and oscillator-player drawings (pp. 18–25); the better-known Kangaroo-pouch machine followed in 1952. The studies use new curves, not Grainger score material.',
  },
  rca: {
    label: 'Columbia University history: RCA Mark II Sound Synthesizer',
    year: 1957,
    dateKind: 'institutional system milestone',
    url: 'https://magazine.columbia.edu/article/how-robert-moog-launched-music-electronic-age',
    limitation: 'Columbia dates the RCA Mark II’s introduction to 1957 and its installation at Columbia to 1959. This anchors punched-paper control, not a technical reconstruction of the machine or a claim about every control row.',
  },
  music3: {
    label: 'Mathews, An Acoustic Compiler for Music and Psychological Stimuli',
    year: 1961,
    dateKind: 'publication',
    url: 'https://archive.org/download/bstj40-3-677/bstj40-3-677.pdf',
    limitation: 'Grounds stored parameter functions and computer scores; modern event objects are an educational abstraction.',
  },
  buchla: {
    label: 'Buchla historical overview and instrument archive',
    year: 1965,
    dateKind: 'documented product lineage',
    url: 'https://buchla.com/history/',
    limitation: 'Grounds the voltage-stage and addressable-sequence lineage without reproducing a panel or factory patch.',
  },
  moog960History: {
    label: 'Cornell Robert Moog papers: 1968 Moog 960 records',
    year: 1968,
    dateKind: 'archival finding-aid milestone',
    url: 'https://archives.library.cornell.edu/repositories/2/resources/2099',
    limitation: 'The collection finding aid dates a 960 repair manual and Sequencer Complement Manual to 1968, plus a 960 operation summary to June 1968; it is not itself the operating specification.',
  },
  moog960: {
    label: 'Moog 1972 system catalog: 960 Sequential Controller',
    milestoneYears: [],
    supportingOnly: true,
    dateKind: 'manufacturer mechanism documentation',
    url: 'https://moogfoundation.org/wp-content/uploads/1972-Moog-Music-Catalog-1.pdf',
    limitation: 'Documents rows, stages and control behavior but does not establish the separate 1968 archival-record milestone; the playable rows are newly authored.',
  },
  groove: {
    label: 'Mathews and Moore, GROOVE—A Program to Compose, Store, and Edit Functions of Time',
    year: 1970,
    dateKind: 'publication',
    url: 'https://doi.org/10.1145/362814.362817',
    limitation: 'Grounds captured and edited control functions, not any archived performance data.',
  },
  oberheim: {
    label: 'Oberheim historical products: DS-2A digital sequencer',
    year: 1973,
    dateKind: 'manufacturer history',
    url: 'https://www.tomoberheim.com/historical-products',
    limitation: 'Provides the 1973 product chronology and basic entry/duration description; phrase behavior in the study is represented generically.',
  },
  sequential: {
    label: 'Sequential company history and Dave Smith chronology',
    year: 1975,
    dateKind: 'manufacturer history',
    url: 'https://sequential.com/about-dave-smith/',
    limitation: 'Provides phrase-memory and microprocessor lineage, not proprietary stored sequences.',
  },
  rolandHistory: {
    label: 'Roland company history: MC-8 MicroComposer and early instruments',
    year: 1977,
    dateKind: 'manufacturer history',
    url: 'https://www.roland.com/global/company/history/',
    limitation: 'Establishes chronology; numeric-event studies are original simplifications.',
  },
  jupiter4: {
    label: 'Roland historical product account: Jupiter-4',
    year: 1978,
    dateKind: 'manufacturer product account',
    url: 'https://www.roland.com/us/products/rc_jupiter-4/',
    limitation: 'Grounds the early polyphonic arpeggiator lineage without duplicating a factory phrase or interface.',
  },
  juno60: {
    label: 'Roland JUNO-60 product history',
    year: 1982,
    dateKind: 'manufacturer product account',
    url: 'https://www.roland.com/global/products/rc_juno-60/',
    limitation: 'Roland dates the original instrument to 1982. The study uses original note material; ranges beyond three octaves and inside/outside traversal are modern extensions.',
  },
  juno60Manual: {
    label: 'Roland JUNO-60 operation manual: arpeggio, pp. 19–23',
    milestoneYears: [],
    supportingOnly: true,
    dateKind: 'manufacturer mechanism documentation',
    url: 'https://cdn.roland.com/assets/media/pdf/JUNO-60_OM.pdf',
    limitation: 'Documents Up, Down, Up/Down, range 1–3, hold and external clock. The notation shows non-repeated turnaround notes. The original top-key range-repetition behavior is not reproduced.',
  },
  sh101: {
    label: 'Roland SH-101 owner’s manual',
    year: 1982,
    dateKind: 'manufacturer owner’s manual',
    url: 'https://cdn.roland.com/assets/media/pdf/SH-101_OM.pdf',
    limitation: 'Grounds compact step entry and transpose behavior; study notes are newly composed.',
  },
  tr808: {
    label: 'Roland TR-808 owner’s manual',
    year: 1980,
    dateKind: 'manufacturer owner’s manual',
    url: 'https://cdn.roland.com/assets/media/pdf/TR-808_OM.pdf',
    limitation: 'Grounds step accents, fills and pattern chaining, not any recognizable rhythm or sound.',
  },
  midi: {
    label: 'MIDI Association: MIDI history, 1981–1983',
    year: 1983,
    dateKind: 'standards history',
    url: 'https://midi.org/midi-history-chapter-6-midi-begins-1981-1983',
    limitation: 'Documents synchronization and interoperable event messages, not a sequencing algorithm.',
  },
  musicMouse: {
    label: 'Eventide and Laurie Spiegel: Music Mouse',
    year: 1986,
    dateKind: 'developer product history',
    url: 'https://www.eventideaudio.com/software/music-mouse/',
    limitation: 'Grounds the original 1986 interactive intelligent-instrument milestone; gestures and note material are original.',
  },
  korgM1: {
    label: 'Korg official product account: M1 workstation',
    year: 1988,
    dateKind: 'manufacturer product account',
    url: 'https://www.korg.com/us/products/software/kc_m1/',
    limitation: 'Grounds the 1988 integrated workstation and eight-track sequencer milestone, not a factory pattern or proprietary arrangement.',
  },
  wavestation: {
    label: 'Korg official product account: WAVESTATION',
    year: 1990,
    dateKind: 'manufacturer product milestone',
    url: 'https://www.korg.com/us/products/software/kc_wavestation/index.php',
    limitation: 'Grounds the 1990 wave-sequencing product milestone, not factory wave sequences, samples or note patterns.',
  },
  trackerHistory: {
    label: 'Reunanen, Trackers: The Rise, Bloom and Later Developments of a Paradigm',
    year: 1987,
    dateKind: 'historical study milestone',
    url: 'https://widerscreen.fi/assets/Reunanen2024.pdf',
    limitation: 'Grounds the 1987 Ultimate Soundtracker chronology; it does not make later ProTracker behavior contemporaneous with that date.',
  },
  tracker: {
    label: 'MOD format documentation: row, effect and pattern structure',
    milestoneYears: [],
    supportingOnly: true,
    dateKind: 'format documentation',
    url: 'https://wiki.multimedia.cx/index.php/Protracker_Module',
    limitation: 'Documents tracker representation without supplying the chronology date; all rows and carry rules here are original abstractions.',
  },
  koan: {
    label: 'Intermorphic developer history: SSEYO Koan Plus (1994)',
    year: 1994,
    dateKind: 'developer history',
    url: 'https://intermorphic.com/archive/sseyo/koan/',
    limitation: '1994 dates the Koan Plus release; development began in 1990, beta testing in 1992 and Koan Pro followed in 1995. No Koan content, presets or proprietary rule set is used.',
  },
  nordModular: {
    label: 'Nord official legacy account: Nord Modular',
    year: 1997,
    dateKind: 'manufacturer product account',
    url: 'https://www.nordkeyboards.com/legacy-products/nord-modular/',
    limitation: 'Grounds the 1997 milestone and clocked note-sequencer lineage; the playable logic patch is an original abstraction.',
  },
  supercolliderHistory: {
    label: 'SuperCollider official project history',
    year: 2002,
    dateKind: 'open-source software milestone',
    url: 'https://supercollider.github.io/',
    limitation: 'Grounds the 2002 open-source milestone; SuperCollider itself was originally released in 1996.',
  },
  supercollider: {
    label: 'SuperCollider Pattern Guide: patterns, streams and events',
    milestoneYears: [],
    supportingOnly: true,
    dateKind: 'software documentation',
    url: 'https://docs.supercollider.online/Tutorials/A-Practical-Guide/PG_01_Introduction.html',
    limitation: 'Documents Pattern mechanisms but supplies no chronology date; studies express the concepts without copying examples.',
  },
  supercolliderMarkov: {
    label: 'SuperCollider Pmarkov class documentation',
    milestoneYears: [],
    supportingOnly: true,
    dateKind: 'software documentation',
    url: 'https://docs.supercollider.online/Classes/Pmarkov.html',
    limitation: 'Documents an explicit Markov-chain pattern class but supplies no chronology date; the transition weights and pitches here are original.',
  },
  euclidean: {
    label: 'Toussaint, The Euclidean Algorithm Generates Traditional Musical Rhythms',
    year: 2005,
    dateKind: 'publication',
    url: 'https://archive.bridgesmathart.org/2005/bridges2005-47.html',
    limitation: 'Grounds pulse distribution as a mathematical family; patterns avoid named traditional rhythms.',
  },
  ableton: {
    label: 'Ableton Live 8 release history: new groove engine',
    year: 2009,
    dateKind: 'official software release milestone',
    url: 'https://www.ableton.com/en/press/press-archive/press-archive-release-8/',
    limitation: 'Grounds the 2009 editable groove-engine milestone; no bundled groove, clip or factory timing data is used.',
  },
  elektron: {
    label: 'Elektron Digitakt user manual: parameter locks and conditional locks',
    year: 2017,
    dateKind: 'documented product release',
    url: 'https://www.elektron.se/wp-content/uploads/2025/07/Digitakt-User-Manual_ENG_OS1.52A_250708.pdf',
    limitation: 'The manual’s introductory history dates shipping to May 2017; this is a Digitakt milestone, not the invention of parameter locks or conditional sequencing. The linked manual was revised in 2025; study notes and conditions are original.',
  },
  tidal: {
    label: 'TidalCycles documentation: history and pattern transformations',
    year: 2009,
    dateKind: 'first public presentation',
    url: 'https://tidalcycles.org/docs/around_tidal/tidal_history/',
    limitation: 'McLean dates the first talk to 2009 and the initial pattern-rotation experiments to around 2006. 2009 is the presentation milestone, not an invention or initial-release date. No tutorial or performance pattern is copied.',
  },
  bitwig: {
    label: 'Bitwig Studio 4.0 release notes: Operators',
    year: 2021,
    dateKind: 'official software release milestone',
    url: 'https://downloads.bitwig.com/stable/4.0/Release-Notes-4.0.html',
    limitation: 'Grounds chance, recurrence and occurrence conditions; the event set is newly authored.',
  },
  strudel: {
    label: 'Strudel developer release history: first commit, 22 January 2022',
    year: 2022,
    dateKind: 'first development commit',
    url: 'https://strudel.cc/blog/#release-notes-v100',
    limitation: 'The January 2024 version 1.0 release notes date the first commit to 22 January 2022. This dates the browser project, not pattern algebra or live coding as a whole; no examples are copied.',
  },
};

export const SEQUENCE_SOURCES = deepFreeze(Object.fromEntries(
  Object.entries(sources).map(([id, source]) => {
    const { year, ...metadata } = source;
    const milestoneYears = Array.isArray(source.milestoneYears)
      ? source.milestoneYears
      : Number.isInteger(year) ? [year] : [];
    return [id, { id, ...metadata, milestoneYears }];
  }),
));

export const SEQUENCE_CHRONOLOGY = deepFreeze(Object.fromEntries(
  SEQUENCE_ERAS.map(era => [era.id, era]),
));

export const getSequenceEra = id => SEQUENCE_CHRONOLOGY[id] || null;
export const getSequenceSource = id => SEQUENCE_SOURCES[id] || null;

/** A compact citation date, never a fabricated year for an authored study. */
export function sequenceShortDateLabel(sources, approximateYear) {
  const years = [...new Set(sources.flatMap(source => source.milestoneYears || []))]
    .filter(Number.isInteger).sort((a, b) => a - b);
  if (years.length) return years.join(' / ');
  return Number.isFinite(approximateYear) ? `~${Math.floor(approximateYear / 10) * 10}s` : '';
}
