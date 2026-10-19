import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readGlobuleDamacySiteReference as readFile } from './helpers/globule-damacy-site-reference.mjs';
import test from 'node:test';
import { instrumentById } from '../src/site/instrument-catalog.js';
import { TOOL_GROUPS } from '../src/site/instrument-registry.js';
import { instrumentMidiCapabilityForId } from '../src/site/instrument-midi-capabilities.js';
import { TAP_TEMPO_TARGETS } from '../src/site/tap-tempo-targets.js';
import { CANONICAL_PAGE_ROUTES } from '../src/pages/manifest.js';
import { FAVE_TOOL_IDS } from '../src/site/instrument-registry.js';
import { readRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { restoreEsi32Site } from './helpers/esi-32-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './helpers/header-presets-batch-site-reference.mjs';
import { restoreMicInputBatchSite } from './helpers/mic-input-batch-site-reference.mjs';
import { readWipRolloutSiteReference, restoreWipRolloutSite } from './helpers/wip-rollout-site-reference.mjs';
import { graphonicCalculatorSiteChanges, readGraphonicCalculatorSiteReference, restoreGraphonicCalculatorSite } from './helpers/graphonic-calculator-site-reference.mjs';
import { restoreStaircaseSpiralRuntime } from './helpers/staircase-spiral-runtime-reference.mjs';
import { restoreRoachPerformance } from './helpers/roach-synth-performance-reference.mjs';

const digest = (source, file) => createHash('sha256').update(restoreStaircaseSpiralRuntime(source, file)).digest('hex');
const root = new URL('../', import.meta.url);

test('Graphonic Calculator is the Math instrument with conservative MIDI and explicit Audio arm', async () => {
  const item = instrumentById('graphonic-calculator');
  assert.equal(item.href, 'graphonic-calculator.html');
  assert.equal(item.imageHref, 'assets/instruments/graphonic-calculator.webp');
  assert.deepEqual(TOOL_GROUPS.filter(group => group.tools.some(tool => tool.id === item.id)).map(group => group.id), ['math']);
  assert.deepEqual(item.tags.map(tag => tag.id), ['math', '2d', 'sonification', 'graphic-ui', 'faves']);
  assert.equal(FAVE_TOOL_IDS.at(-1), 'graphonic-calculator');
  assert.equal(FAVE_TOOL_IDS.filter(id => id === 'graphonic-calculator').length, 1);
  assert.match(item.description, /implicit relations.*polar and parametric.*playhead/i);
  assert.match(item.start, /enable Audio and press Play/);
  assert.equal(CANONICAL_PAGE_ROUTES.filter(route => route === item.href).length, 1);
  assert.deepEqual(instrumentMidiCapabilityForId('graphonic-calculator'), {
    id: 'graphonic-calculator', midiInput: true, midiInputMode: 'universal-control',
    noteMode: 'sequence', audioInput: false, midiOutput: false, startsAudio: true, computerKeyboardMode: 'none',
  });
  assert.deepEqual(TAP_TEMPO_TARGETS.filter(target => target.route === item.href).map(({ selector, mapping }) => ({ selector, mapping })), [
    { selector: '#sweepTempo', mapping: { unit: 'bpm' } },
  ]);
  const icon = await readFile(new URL(item.imageHref, root));
  assert.equal(icon.toString('ascii', 0, 4), 'RIFF');
  assert.equal(icon.toString('ascii', 8, 12), 'WEBP');
  assert.ok(icon.length > 8000);
  const manifest = await readRuntimeManifest();
  const required = new Set(manifest.entries.filter(entry => entry.policy.includes('require')).map(entry => entry.path));
  for (const file of [
    'graphonic-calculator.html', 'docs/graphonic-calculator.md', 'assets/instruments/graphonic-calculator.webp',
    ...['app', 'audio', 'camera', 'expressions', 'formulas', 'geometry', 'model', 'parser', 'readers', 'renderer', 'sampler', 'triggers'].map(name => `src/instruments/graphonic-calculator/${name}.js`),
    'src/instruments/graphonic-calculator/style.css',
  ]) assert.ok(required.has(file), `${file} is a required release file`);
});

test('Graphonic Calculator amendments restore the exact preceding main source and reject missing or duplicate additions', async () => {
  assert.equal(graphonicCalculatorSiteChanges.baseCommit.length, 40);
  assert.deepEqual(graphonicCalculatorSiteChanges.changes.map(change => change.file), [
    'src/pages/manifest.js', 'src/site/instrument-registry.js', 'src/site/instrument-catalog.js',
    'src/site/catalogue-taxonomy.js', 'src/site/instrument-midi-capabilities.js',
    'src/site/tap-tempo-targets.js', 'scripts/site/runtime-files.tsv', 'README.md',
  ]);
  for (const change of graphonicCalculatorSiteChanges.changes) {
    const url = new URL(change.file, root);
    const source = restoreRoachPerformance(restoreHeaderPresetsBatchSite(restoreMicInputBatchSite(restoreWipRolloutSite(await readFile(url, 'utf8'), change.file), change.file), change.file), change.file);
    const restored = restoreGraphonicCalculatorSite(source, change.file);
    assert.equal(restoreGraphonicCalculatorSite(source, 'unrelated.js'), source);
    assert.equal(digest(restored, change.file), change.sha256, `${change.file}: pre-Graphonic Calculator source preserved`);
    assert.equal(restoreRoachPerformance(await readWipRolloutSiteReference(url, 'utf8'), change.file), restored);
    assert.deepEqual(await readWipRolloutSiteReference(url), await readFile(url), 'binary reads remain byte-for-byte');
    assert.equal(restoreGraphonicCalculatorSite(restored, change.file, { allowRestored: true }), restored);
    assert.notEqual(digest(restoreGraphonicCalculatorSite(source + '\n// unrelated drift\n', change.file), change.file), change.sha256);
    assert.throws(() => restoreGraphonicCalculatorSite(restored, change.file), /exact Graphonic Calculator site amendment/);
    for (const { before, after } of change.replacements) {
      assert.match(after, /graphonic-calculator/);
      assert.throws(() => restoreGraphonicCalculatorSite(source.replace(after, before), change.file), /exact Graphonic Calculator site amendment/);
      assert.throws(() => restoreGraphonicCalculatorSite(source + after, change.file), /exact Graphonic Calculator site amendment/);
      assert.throws(() => restoreGraphonicCalculatorSite(source.replace(after, after.replace('graphonic-calculator', 'unreviewed-calculator')), change.file), /exact Graphonic Calculator site amendment/);
    }
  }
  const binary = Buffer.from('raw bytes');
  assert.equal(restoreGraphonicCalculatorSite(binary, 'src/pages/manifest.js'), binary);
  assert.equal(restoreGraphonicCalculatorSite('untouched', 'unrelated.js'), 'untouched');
});

test('the Math category amendment restores the exact preceding main bytes and peels before every older guard', async () => {
  const { graphonicCalculatorMathSiteChanges: math, restoreGraphonicCalculatorMathSite: restoreMath, readGraphonicCalculatorMathSiteReference } = await import('./helpers/graphonic-calculator-math-site-reference.mjs');
  assert.match(math.baseCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(math.changes.map(change => change.file), ['src/site/instrument-registry.js', 'src/site/catalogue-taxonomy.js', 'style.css', 'README.md', 'src/pages/graphonic-calculator.html']);
  for (const change of math.changes) {
    const url = new URL(change.file, root);
    // The parallel ESI-32 addition is proved against the same independent baseline.
    const source = restoreRoachPerformance(restoreEsi32Site(await readFile(url, 'utf8'), change.file, { allowRestored: true }), change.file);
    const restored = restoreMath(source, change.file);
    assert.equal(digest(restored), change.sha256, `${change.file}: pre-Math source preserved`);
    const mathOnly = restoreRoachPerformance(await readGraphonicCalculatorMathSiteReference(url, 'utf8'), change.file);
    assert.equal(mathOnly, restoreMath(restoreRoachPerformance(await readFile(url, 'utf8'), change.file), change.file), 'the Math reader preserves parallel feature additions');
    assert.equal(restoreEsi32Site(mathOnly, change.file, { allowRestored: true }), restored);
    assert.equal(restoreMath(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreMath(restored, change.file), /exact Graphonic Calculator Math site amendment/);
    for (const { after } of change.replacements) assert.match(after, /math|Math|region/);
  }
  const registry = await readFile(new URL('src/site/instrument-registry.js', root), 'utf8');
  assert.match(restoreMath(registry, 'src/site/instrument-registry.js'), /freezeGroup\("wip", "Work in Progress", \[\n    \{ id: "wobblini"[^\n]*\n    \{ id: "graphonic-calculator"/, 'the WIP row returns so the older Graphonic Calculator and Wobblini guards still match');
  assert.equal(TOOL_GROUPS.findIndex(group => group.id === 'math'), TOOL_GROUPS.findIndex(group => group.id === 'wip') - 1, 'Math sits directly before Work in Progress');
});

test('the drum-trigger runtime row restores the exact preceding main manifest and peels before every older guard', async () => {
  const { graphonicCalculatorDrumsSiteChanges: drums, restoreGraphonicCalculatorDrumsSite: restoreDrums, readGraphonicCalculatorDrumsSiteReference } = await import('./helpers/graphonic-calculator-drums-site-reference.mjs');
  assert.match(drums.baseCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(drums.changes.map(change => change.file), ['scripts/site/runtime-files.tsv']);
  for (const change of drums.changes) {
    const url = new URL(change.file, root);
    const source = await readFile(url, 'utf8');
    const restored = restoreDrums(source, change.file);
    assert.equal(digest(restored), change.sha256, `${change.file}: pre-drums source preserved`);
    assert.equal(await readGraphonicCalculatorDrumsSiteReference(url, 'utf8'), restored);
    assert.equal(restoreDrums(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreDrums(restored, change.file), /exact Graphonic Calculator drums site amendment/);
    for (const { after } of change.replacements) assert.match(after, /graphonic-calculator\/triggers\.js/);
  }
  const manifest = await readRuntimeManifest();
  assert.deepEqual(manifest.entries.filter(entry => entry.path === 'src/instruments/graphonic-calculator/triggers.js').map(entry => entry.policy), ['copy+require']);
});
