import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readWobbliniControlsSiteReference as readFile } from './helpers/wobblini-controls-site-reference.mjs';
import test from 'node:test';
import { esi32SiteChanges, restoreEsi32Site } from './helpers/esi-32-site-reference.mjs';
import { graphonicCalculatorMathSiteChanges, restoreGraphonicCalculatorMathSite } from './helpers/graphonic-calculator-math-site-reference.mjs';
import { restoreStaircaseSpiralRuntime } from './helpers/staircase-spiral-runtime-reference.mjs';

const root = new URL('../', import.meta.url);
const digest = (source, file) => createHash('sha256').update(restoreStaircaseSpiralRuntime(source, file)).digest('hex');

// Wobblini's later mixer amendment (9d24c0fe) extends the runtime manifest
// independently of the frozen ESI-32 baseline. Keep its original rows intact.
const wobbliniRows = names => names.map(name => `copy+require\tsrc/instruments/wobblini/wobblini-${name}.js\n`).join('');
const wobbliniBefore = wobbliniRows(['model', 'scratch-model']);
const wobbliniAfter = wobbliniRows(['model', 'geometry-model', 'mixer', 'scratch-model']);
function restoreLaterWobbliniMixer(source, file) {
  if (file !== 'scripts/site/runtime-files.tsv') return source;
  assert.equal(source.split(wobbliniAfter).length - 1, 1, 'exact later Wobblini mixer amendment');
  return source.replace(wobbliniAfter, () => wobbliniBefore);
}

test('later Wobblini mixer rows peel exactly without hiding unrelated manifest drift', async () => {
  const file = 'scripts/site/runtime-files.tsv';
  const source = await readFile(new URL(file, root), 'utf8');
  const restored = restoreLaterWobbliniMixer(source, file);
  assert.equal(restored.split(wobbliniBefore).length - 1, 1);
  assert.equal(restored.replace(wobbliniBefore, () => wobbliniAfter), source);
  for (const changed of [restored, source + wobbliniAfter, source.replace('wobblini-geometry-model.js', 'unreviewed.js')]) {
    assert.throws(() => restoreLaterWobbliniMixer(changed, file), /exact later Wobblini mixer amendment/);
  }
  const drift = '\n# unrelated manifest drift\n';
  assert.equal(restoreLaterWobbliniMixer(source + drift, file), restored + drift);
  assert.notEqual(digest(restoreLaterWobbliniMixer(source + drift, file)), digest(restored));
  assert.equal(restoreLaterWobbliniMixer('unchanged', 'unrelated.js'), 'unchanged');
});

test('ESI-32 additions preserve the independently captured publication baseline', async () => {
  assert.equal(esi32SiteChanges.baseCommit, '958ff9aeda623b8580be0d041476d8e37c943309');
  assert.deepEqual(esi32SiteChanges.changes.map(({ file }) => file).sort(), [
    'README.md', 'scripts/site/runtime-files.tsv', 'scripts/wax/wax-universal-adapter.js',
    'src/pages/manifest.js', 'src/site/catalogue-taxonomy.js',
    'src/site/instrument-catalog.js', 'src/site/instrument-midi-capabilities.js',
    'src/site/instrument-registry.js',
  ]);
  for (const change of esi32SiteChanges.changes) {
    // The parallel Math amendment has its own independent proof and baseline.
    const source = restoreGraphonicCalculatorMathSite(restoreLaterWobbliniMixer(await readFile(new URL(change.file, root), 'utf8'), change.file), change.file, { allowRestored: true });
    const restored = restoreEsi32Site(source, change.file);
    assert.equal(digest(restored, change.file), change.sha256, change.file);
    const reapplied = change.replacements.reduce((current, { before, after }) => {
      assert.equal(current.split(before).length - 1, 1, `${change.file}: unique insertion point`);
      return current.replace(before, () => after);
    }, restored);
    assert.equal(reapplied, source, `${change.file}: exact round trip`);
    assert.equal(restoreEsi32Site(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreEsi32Site(restored, change.file), /exact ESI-32 site amendment/);
    for (const { before, after } of change.replacements) {
      assert.throws(() => restoreEsi32Site(source.replace(after, () => before), change.file), /exact ESI-32 site amendment/);
      assert.throws(() => restoreEsi32Site(source + after, change.file), /exact ESI-32 site amendment/);
      assert.throws(() => restoreEsi32Site(source.replace(after, () => after.replace('esi-32', 'unreviewed')), change.file), /exact ESI-32 site amendment/);
    }
    const drift = '\n// unrelated source drift\n';
    assert.equal(restoreEsi32Site(source + drift, change.file), restored + drift);
    assert.notEqual(digest(restoreEsi32Site(source + drift, change.file), change.file), change.sha256);
    for (const file of change.regressionTests) assert.ok((await readFile(new URL(file, root))).length, file);
  }
  const binary = Buffer.from('raw bytes');
  assert.equal(restoreEsi32Site(binary, 'src/pages/manifest.js'), binary);
  assert.equal(restoreEsi32Site('untouched', 'unrelated.js'), 'untouched');
});

test('parallel ESI-32 and Math amendments commute and reproduce all merged source bytes', async () => {
  assert.equal(graphonicCalculatorMathSiteChanges.baseCommit, esi32SiteChanges.baseCommit);
  const shared = esi32SiteChanges.changes.filter(change => graphonicCalculatorMathSiteChanges.changes.some(other => other.file === change.file));
  assert.deepEqual(shared.map(({ file }) => file).sort(), ['README.md', 'src/site/catalogue-taxonomy.js', 'src/site/instrument-registry.js']);
  const apply = (source, change) => change.replacements.reduce((current, { before, after }) => {
    assert.equal(current.split(before).length - 1, 1, `${change.file}: unique merge insertion point`);
    return current.replace(before, () => after);
  }, source);
  for (const esi of shared) {
    const math = graphonicCalculatorMathSiteChanges.changes.find(change => change.file === esi.file);
    assert.equal(esi.sha256, math.sha256, `${esi.file}: independent journals agree on the common baseline`);
    const merged = await readFile(new URL(esi.file, root), 'utf8');
    const esiFirst = restoreGraphonicCalculatorMathSite(restoreEsi32Site(merged, esi.file), esi.file);
    const mathFirst = restoreEsi32Site(restoreGraphonicCalculatorMathSite(merged, esi.file), esi.file);
    assert.equal(esiFirst, mathFirst, `${esi.file}: restoration order does not lose either feature`);
    assert.equal(digest(esiFirst), esi.sha256);
    assert.equal(apply(apply(esiFirst, esi), math), merged);
    assert.equal(apply(apply(esiFirst, math), esi), merged);
  }
});
