import { readFileSync } from 'node:fs';
const originalPlan = JSON.parse(readFileSync(new URL('../../docs/catalogue-update-decisions.json', import.meta.url), 'utf8'));
// September 30 owner promotion: Spelling leaves WIP/Cooking for Voice.
// October 1 owner removal; keep the historical catalogue evidence intact.
export const removedInstrumentIds = new Set(['morphazoidical']);
// October 16 owner request: a Math category, placed before Work in Progress, for the Graphonic Calculator.
export const cataloguePlan = { ...originalPlan, categoryOrder: originalPlan.categoryOrder.flatMap(id => (id === 'wip' ? ['math', 'wip'] : [id])), rows: originalPlan.rows.filter(row => !removedInstrumentIds.has(row.id)).map(row =>
  row.id === 'spelling-synthesizer' ? { ...row, categoryId: 'voice', categoryLabel: 'Voice' }
  : row.id === 'throat-singing' ? { ...row, label: 'Throat Singer' } : row) };
const prior = JSON.parse(readFileSync(new URL('../fixtures/catalogue-before-20260918.json', import.meta.url), 'utf8'));
const byId = new Map(cataloguePlan.rows.flatMap(row => [[row.oldId, row], [row.id, row]]));
export const mainAdditions = [
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-globule-damacy.json', import.meta.url), 'utf8')).additions,
  { id: "time-loom", label: "Time Loom", href: "time-loom.html", imageHref: "assets/instruments/time-loom.webp",
    categoryId: "wip", categoryLabel: "Work in Progress", tags: [] },
  // October 18: a cauldron voice, five instrumental fingers and musical broom flight.
  { id: 'witch', label: 'Witch', href: 'witch.html', imageHref: 'assets/instruments/witch.webp',
    categoryId: 'wip', categoryLabel: 'Work in Progress',
    tags: [{ id: 'voice', label: 'Voice' }, { id: 'graphic-ui', label: 'Graphic-UI' }, { id: 'synthesizer', label: 'Synthesizer' }] },
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-esi-32.json', import.meta.url), 'utf8')).additions,
  // October 15: eight-deck Wobblini; October 16 owner request removes looping.
  { id: 'wobblini', label: 'Wobblini', href: 'wobblini.html', imageHref: 'assets/instruments/wobblini.webp',
    categoryId: 'wip', categoryLabel: 'Work in Progress',
    tags: [{ id: 'app', label: 'App' }, { id: 'audio-effect', label: 'Audio Effect' }] },
  // October 14 owner request: Desmos-style graphing calculator with a sonified trace playhead; October 16: moved into the new Math category.
  { id: 'graphonic-calculator', label: 'Graphonic Calculator', href: 'graphonic-calculator.html', imageHref: 'assets/instruments/graphonic-calculator.webp',
    categoryId: 'math', categoryLabel: 'Math',
    tags: [{ id: '2d', label: '2D' }, { id: 'sonification', label: 'Sonification' }, { id: 'graphic-ui', label: 'Graphic-UI' }] },
  // October 14 owner request: compare Rust readings of Striped Staircase.
  { id: 'striped-staircase-rust', label: 'Staircase Studies', href: 'striped-staircase-rust.html', imageHref: 'assets/instruments/striped-staircase.webp',
    categoryId: 'wip', categoryLabel: 'Work in Progress',
    tags: [{ id: 'fractal', label: 'Fractal' }, { id: 'sonification', label: 'Sonification' }] },
  // October 14 owner rename preserves the frozen October 13 addition and its route.
  ...JSON.parse(readFileSync(new URL("../fixtures/catalogue-simd-resonator-rust.json", import.meta.url), "utf8")).additions
    .map(item => item.id === "simd-resonator-rust" ? { ...item, label: "Rezoidinator" } : item),
  // October 11 owner request: a browser DJ workspace inside Morphazoid.
  { id: 'trackazoid', label: 'Trackazoid', href: 'trackazoid.html', imageHref: 'assets/instruments/trackazoid.webp',
    categoryId: 'app', categoryLabel: 'App',
    tags: [{ id: 'looper', label: 'Looper' }, { id: 'audio-effect', label: 'Audio Effect' }] },
  // October 10 owner request: three complex-vector/audio research demos.
  { id: 'vector-fractals', label: 'Vector Fractals', href: 'vector-fractals.html', imageHref: 'assets/instruments/vector-fractals.webp',
    categoryId: 'wip', categoryLabel: 'Work in Progress',
    tags: [{ id: 'fractal', label: 'Fractal' }, { id: 'geometric', label: 'Geometric' }, { id: 'synthesizer', label: 'Synthesizer' }] },
  ...JSON.parse(readFileSync(new URL("../fixtures/catalogue-graph-delay-rust.json", import.meta.url), "utf8")).additions,
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-spartial.json', import.meta.url), 'utf8')).additions,
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-am.json', import.meta.url), 'utf8')).additions,
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-l-system-labs.json', import.meta.url), 'utf8')).additions,
  // October 9 owner request: five fractal delay mappings share one WIP instrument.
  { id: 'fractal-delay', label: 'Fractal Delay', href: 'fractal-delay.html', imageHref: 'assets/instrument-icons/fractal-delay.webp',
    categoryId: 'wip', categoryLabel: 'Work in Progress',
    tags: [{ id: 'audio-effect', label: 'Audio Effect' }, { id: 'fractal', label: 'Fractal' },
      { id: 'recursive', label: 'Recursive' }, { id: 'delay', label: 'Delay' }, { id: 'graph', label: 'Graph' }] },
  { id: "blobs", label: "Blobs", href: "blobs.html", imageHref: "assets/instruments/blobs.webp", categoryId: "geometric", categoryLabel: "Geometric", tags: [{ id: "graphic-ui", label: "Graphic-UI" }, { id: "2d", label: "2D" }, { id: "synthesizer", label: "Synthesizer" }] },
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-bifurcator.json', import.meta.url), 'utf8')).additions,
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-native-delay.json', import.meta.url), 'utf8')).additions,
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-voicesaurus.json', import.meta.url), 'utf8')).additions,
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-domino-run.json', import.meta.url), 'utf8')).additions,
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-fractal-signals.json', import.meta.url), 'utf8')).additions,
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-rubixoids.json', import.meta.url), 'utf8')).additions,
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-main-d96793a.json', import.meta.url), 'utf8')).additions,
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-loopini.json', import.meta.url), 'utf8')).additions,
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-gesticulating-hand.json', import.meta.url), 'utf8')).additions,
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-simd-chiptune.json', import.meta.url), 'utf8')).additions,
];
// Browseable demonstrations retain their own catalogue and MIDI declarations.
export const labAdditions = [
  { id: 'blech-midi', label: 'BLECH MIDI', href: 'blech-midi.html', categoryId: 'graphic-ui', categoryLabel: 'Graphic-UI', midiInput: false, generatedMidi: true,
    tags: [{ id: '2d', label: '2D' }, { id: 'sequencer', label: 'Sequencer' }, { id: 'algorithmic', label: 'Algorithmic' }] },
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-midiphoria.json', import.meta.url), 'utf8')).additions,
  { id: 'wasm-garden', categoryId: 'wip', categoryLabel: 'Work in Progress', tags: [{ id: 'resonator', label: 'Resonator' }] },
  ...JSON.parse(readFileSync(new URL('../fixtures/catalogue-synthesis.json', import.meta.url), 'utf8')).additions,
];
for (const item of [...mainAdditions, ...labAdditions]) byId.set(item.id, { id: item.id, oldId: item.id, categoryId: item.categoryId, categoryLabel: item.categoryLabel ?? "Work in Progress", tags: item.tags ?? [] });
const previousFaves = prior.registry.FAVE_TOOL_IDS.map(id => byId.get(id)?.id ?? id);
// Explicit owner follow-up on September 20; keep the pre-sheet fixture intact.
previousFaves.splice(previousFaves.indexOf("hiccup-head") + 1, 0, "creaturazoid");
previousFaves.splice(previousFaves.indexOf("spiral"), 1);
// Second owner follow-up: keep Creaturazoid after Hiccup, move the requested
// three before Hyper Rubix, and exchange Automatapoeia/Lattice.
const moved = ["hiccup-head", "creaturazoid", "hybrinx", "jaw-harp"];
const reordered = previousFaves.filter(id => !moved.includes(id));
reordered.splice(reordered.indexOf("hyper-rubix"), 0, ...moved);
// Owner follow-up September 29: Fractal Synthesis follows Jaw Harp.
reordered.splice(reordered.indexOf("jaw-harp") + 1, 0, "fractal-signals");
const latticeIndex = reordered.indexOf("lattice");
const automataIndex = reordered.indexOf("cellular-automata");
[reordered[latticeIndex], reordered[automataIndex]] = [reordered[automataIndex], reordered[latticeIndex]];
// Owner follow-up on September 29: put Puggler in the middle, after Hyper Rubix.
reordered.splice(reordered.indexOf("hyper-rubix") + 1, 0, "puggler");
// Owner follow-up October 4: Synthesaurus immediately follows Hiccup Head.
reordered.splice(reordered.indexOf("hiccup-head") + 1, 0, "synthesis");
// Native Delay stays beside its original in the owner-requested webapp.
reordered.splice(reordered.indexOf("micmic") + 1, 0, "micmic-rust");
// Owner follow-up October 11: Fractal Delay joins the related delay in Faves.
reordered.splice(reordered.indexOf("micmic-rust") + 1, 0, "fractal-delay");
// Owner follow-up October 12: Quadruped joins the creature instruments in Faves.
reordered.splice(reordered.indexOf("hybrinx") + 1, 0, "quadruped");
// Shapes replaces the three individual geometry instruments in the first
// Faves section. Their ordinary Geometric catalogue records remain intact.
export const expectedFaveToolIds = Object.freeze([
  "shapes", ...reordered.filter(id => !["shape-synth", "solid-synth", "hyper-synth"].includes(id)),
  // Owner follow-up on September 26: add Gesticules without moving existing Faves.
  "gesticulating-hand",
  // Owner follow-up on September 27: promote SIMD Chiptune into Faves.
  "simd-chiptune",
  // Owner follow-up October 12: BLECH MIDI and Midiophilia join Faves.
  "blech-midi", "midiphoria",
  // Owner follow-up October 15: Graphonic Calculator joins Faves while still filed under WIP.
  "graphonic-calculator",
]);
const faves = new Set(expectedFaveToolIds);
export function expectedTagIdsFor(id) {
  const row = byId.get(id);
  if (!row) throw new Error(`No approved catalogue plan row for ${id}`);
  return [...new Set([row.categoryId, ...row.tags.map(tag => tag.id), ...(faves.has(row.id) ? ['faves'] : [])])];
}
export function expectedCategoryFor(id) { return byId.get(id)?.categoryId; }
export function expectedStatusFor(id) { return expectedCategoryFor(id) === 'wip' ? 'Work in Progress' : null; }
export function expectedIdFor(id) { return byId.get(id)?.id ?? id; }
export function previousInstrumentFor(id) {
  const row = byId.get(id);
  return prior.INSTRUMENTS.find(item => item.id === (row?.oldId ?? id)) ?? mainAdditions.find(item => item.id === id);
}
export function expectedTagsFor(id) {
  const row = byId.get(id);
  const labels = new Map([[row.categoryId, row.categoryLabel], ...row.tags.map(tag => [tag.id, tag.label]), ['faves', 'Faves']]);
  return expectedTagIdsFor(id).map(id => ({ id, label: labels.get(id) }));
}
