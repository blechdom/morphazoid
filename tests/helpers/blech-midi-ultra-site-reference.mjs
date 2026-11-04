import assert from 'node:assert/strict';

const ultraRuntimePaths = [
  'src/instruments/blech-midi-ultra/blech-midi-app.js',
  'src/instruments/blech-midi-ultra/blech-midi-art-controls.js',
  'src/instruments/blech-midi-ultra/blech-midi-art.js',
  'src/instruments/blech-midi-ultra/blech-midi-black-loader.js',
  'src/instruments/blech-midi-ultra/blech-midi-black-renderer.js',
  'src/instruments/blech-midi-ultra/blech-midi-black-score.js',
  'src/instruments/blech-midi-ultra/blech-midi-black-worker.js',
  'src/instruments/blech-midi-ultra/blech-midi-drop-stage.js',
  'src/instruments/blech-midi-ultra/blech-midi-file-player.js',
  'src/instruments/blech-midi-ultra/blech-midi-frames-controls.js',
  'src/instruments/blech-midi-ultra/blech-midi-frames.js',
  'src/instruments/blech-midi-ultra/blech-midi-generator-preview.js',
  'src/instruments/blech-midi-ultra/blech-midi-generators.css',
  'src/instruments/blech-midi-ultra/blech-midi-live-score.js',
  'src/instruments/blech-midi-ultra/blech-midi-math-controls.js',
  'src/instruments/blech-midi-ultra/blech-midi-math.js',
  'src/instruments/blech-midi-ultra/blech-midi-note-history.js',
  'src/instruments/blech-midi-ultra/blech-midi-rail-clock.js',
  'src/instruments/blech-midi-ultra/blech-midi-score-view.js',
  'src/instruments/blech-midi-ultra/blech-midi-spigot-engine.js',
  'src/instruments/blech-midi-ultra/blech-midi-spigots.css',
  'src/instruments/blech-midi-ultra/blech-midi-spigots.js',
  'src/instruments/blech-midi-ultra/blech-midi-stamp-picker.js',
  'src/instruments/blech-midi-ultra/blech-midi-text-controls.js',
  'src/instruments/blech-midi-ultra/blech-midi-text-fonts.js',
  'src/instruments/blech-midi-ultra/blech-midi-timing.js',
  'src/instruments/blech-midi-ultra/blech-midi.css',
  'assets/blech-midi-ultra/blech-mark.svg',
  'assets/blech-midi-ultra/DSEG14ClassicMini-Bold.woff2',
  'assets/blech-midi-ultra/DSEG-LICENSE.txt',
  'assets/instruments/blech-midi-ultra.webp',
  'docs/blech-midi-ultra.md',
];
const runtimeLines = [
  '# BLECH-MIDI-ULTRA: independent copy of BLECH-owned source and artwork.',
  ...ultraRuntimePaths.map(path => `copy+require\t${path}`),
].join('\n');

/** Reverse only the reviewed Ultra registration, leaving unrelated history visible. */
export const blechMidiUltraSiteChanges = Object.freeze([
  {
    file: 'README.md',
    before: '**[L-system Delay Rust](l-mic-rust.html)**',
    after: `**[BLECH MIDI ULTRA](blech-midi-ultra.html)** preserves the November 3, 2026
BLECH MIDI playground as a separate instrument. Its Free Draw, rails, Math
workboxes, stamps, text, layers and falling notes can evolve independently of
BLECH MIDI; both use the shared MIDI and SoundFont engine. Audio starts off.
[Saved controls and limits](docs/blech-midi-ultra.md).

**[L-system Delay Rust](l-mic-rust.html)**`,
    markers: ['**[BLECH MIDI ULTRA](blech-midi-ultra.html)**'],
  },
  {
    file: 'src/pages/manifest.js',
    before: '  "blech-midi.html",\n  "blobs.html",',
    after: '  "blech-midi.html",\n  "blech-midi-ultra.html",\n  "blobs.html",',
    markers: ['"blech-midi-ultra.html"'],
  },
  {
    file: 'src/site/instrument-registry.js',
    before: '  "blech-midi",\n  "midiphoria",',
    after: '  "blech-midi",\n  "blech-midi-ultra",\n  "midiphoria",',
    markers: ['  "blech-midi-ultra",'],
  },
  {
    file: 'src/site/instrument-registry.js',
    before: '    { id: "blech-midi", label: "BLECH MIDI", href: "blech-midi.html", catalogue: false, browse: true, entryType: "lab", imageHref: "assets/instruments/blech-midi.webp" },\n  ]),',
    after: '    { id: "blech-midi", label: "BLECH MIDI", href: "blech-midi.html", catalogue: false, browse: true, entryType: "lab", imageHref: "assets/instruments/blech-midi.webp" },\n    { id: "blech-midi-ultra", label: "BLECH MIDI ULTRA", href: "blech-midi-ultra.html", catalogue: false, browse: true, entryType: "lab", imageHref: "assets/instruments/blech-midi-ultra.webp" },\n  ]),',
    markers: ['    { id: "blech-midi-ultra",'],
  },
  {
    file: 'src/site/catalogue-taxonomy.js',
    before: '  "blech-midi": ["2d", "sequencer", "algorithmic"],\n  blobs:',
    after: '  "blech-midi": ["2d", "sequencer", "algorithmic"],\n  "blech-midi-ultra": ["2d", "sequencer", "algorithmic"],\n  blobs:',
    markers: ['  "blech-midi-ultra": ["2d",'],
  },
  {
    file: 'src/site/catalogue-taxonomy.js',
    before: '  "midiphoria": {\n    "kind": "Live MIDI visualizer",',
    after: `  "blech-midi-ultra": {
    "kind": "Saved MIDI playground",
    "description": "A separate copy of the November 2026 BLECH MIDI playground: perform with Free Draw and rails, prepare a Math workbox or stamp, and drop layers over a full-width falling-note keyboard.",
    "start": "Choose Free Draw or a rail to play live, or Drop the prepared Math workbox to create a layer. Enable Audio separately to hear the notes.",
    "features": ["SoundFont playback", "Falling-note keyboard", "Free Draw", "Note rails", "Math workboxes", "Live layers", "Stamps", "Text", "Cellular automata", "MIDI file export"],
    "pluginHref": null
  },
  "midiphoria": {
    "kind": "Live MIDI visualizer",`,
    markers: ['  "blech-midi-ultra": {'],
  },
  {
    file: 'src/site/instrument-midi-capabilities.js',
    before: '  }),\n]);\n\nconst capabilityById',
    after: `  }),
  Object.freeze({
    id: "blech-midi-ultra",
    midiInput: false,
    midiInputMode: "none",
    noteMode: "sequence",
    audioInput: false,
    midiOutput: false,
    startsAudio: true,
    computerKeyboardMode: "none",
  }),
]);

const capabilityById`,
    markers: ['    id: "blech-midi-ultra",'],
  },
  {
    file: 'src/site/tap-tempo-targets.js',
    before: '  {"route": "minimax.html", "selector": "#tempo", "mapping": {"unit": "bpm"}},',
    after: `  {"route": "blech-midi-ultra.html", "selector": "#creativeTempo", "mapping": {"unit": "bpm"}},
  {"route": "blech-midi-ultra.html", "selector": "#blackFileTempo", "mapping": {"unit": "bpm"}, "title": "Tap independent MIDI file tempo"},
  {"route": "blech-midi-ultra.html", "selector": "#blackPlaybackRate", "mapping": {"unit": "multiplier", "referenceSelector": "#blackTempoReference"}, "title": "Tap MIDI file speed relative to its current base tempo"},
  {"route": "minimax.html", "selector": "#tempo", "mapping": {"unit": "bpm"}},`,
    markers: ['{"route": "blech-midi-ultra.html"'],
  },
  {
    file: 'scripts/site/runtime-files.tsv',
    before: 'copy+require\tdocs/blech-midi.md\n\n# Sound Fonts collection, workshop and redistributable banks.',
    after: `copy+require\tdocs/blech-midi.md\n\n${runtimeLines}\n\n# Sound Fonts collection, workshop and redistributable banks.`,
    markers: ['# BLECH-MIDI-ULTRA:', ...ultraRuntimePaths.map(path => `copy+require\t${path}\n`)],
  },
]);

const changesByFile = new Map(
  [...new Set(blechMidiUltraSiteChanges.map(change => change.file))]
    .map(file => [file, blechMidiUltraSiteChanges.filter(change => change.file === file).toReversed()]),
);

export function restoreBlechMidiUltraSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  const changes = changesByFile.get(file);
  if (!changes || allowRestored && !source.includes('blech-midi-ultra')) return source;
  for (const change of changes) {
    const count = source.split(change.after).length - 1;
    if (allowRestored && count === 0 && change.markers.every(marker => !source.includes(marker))) continue;
    assert.equal(count, 1, `${file}: exact BLECH-MIDI-ULTRA site addition`);
    source = source.replace(change.after, change.before);
  }
  return source;
}

// The font credit postdates several frozen site-reference hashes. Reverse
// only this complete, positioned notice before comparing those old bytes.
const fontNoticeFile = 'docs/THIRD_PARTY_NOTICES.md';
const fontNoticeAnchor = `The mixer, inspector, rectangular renderer and scheduling code are original
Morphazoid implementations.

`;
export const blechUltraFontNotice = `## BLECH MIDI ULTRA font

BLECH MIDI ULTRA's title uses the unmodified DSEG14 Classic Mini Bold font
by keshikan (copyright © 2017), licensed under the SIL Open Font License 1.1.
The bundled WOFF2 and [complete license](../assets/blech-midi-ultra/DSEG-LICENSE.txt)
are distributed together; “DSEG” is a reserved font name.

`;
const fontNoticeBefore = `${fontNoticeAnchor}## I/O setup synthesized voice`;
const fontNoticeAfter = `${fontNoticeAnchor}${blechUltraFontNotice}## I/O setup synthesized voice`;

export function restoreBlechUltraFontNotice(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string' || file !== fontNoticeFile) return source;
  const marker = '## BLECH MIDI ULTRA font';
  if (allowRestored && !source.includes(marker)) return source;
  const error = `${file}: exact BLECH MIDI ULTRA font notice`;
  assert.equal(source.split(marker).length - 1, 1, error);
  assert.equal(source.split(fontNoticeAfter).length - 1, 1, error);
  return source.replace(fontNoticeAfter, fontNoticeBefore);
}
