import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { instrumentById } from '../src/site/instrument-catalog.js';
import { TOOL_GROUPS } from '../src/site/instrument-registry.js';
import { instrumentMidiCapabilityForId } from '../src/site/instrument-midi-capabilities.js';
import { TAP_TEMPO_TARGETS } from '../src/site/tap-tempo-targets.js';
import { CANONICAL_PAGE_ROUTES } from '../src/pages/manifest.js';
import { staircaseSiteChanges, restoreStaircaseSite, readStaircaseSiteReference } from './helpers/staircase-site-reference.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const error = /exact Staircase Studies site amendment/;

test('Staircase Studies has a separate WIP route, original icon, and declared controls', () => {
  const item = instrumentById('striped-staircase-rust');
  assert.equal(item.href, 'striped-staircase-rust.html');
  assert.equal(item.imageHref, 'assets/instruments/striped-staircase.webp');
  assert.equal(item.status, 'Work in Progress');
  assert.deepEqual(item.tags.map(tag => tag.id), ['wip', 'fractal', 'sonification']);
  assert.deepEqual(TOOL_GROUPS.filter(group => group.tools.some(tool => tool.id === item.id)).map(group => group.id), ['wip']);
  assert.equal(CANONICAL_PAGE_ROUTES.filter(route => route === item.href).length, 1);
  assert.equal(CANONICAL_PAGE_ROUTES.filter(route => route === 'striped-staircase.html').length, 1);
  const midi = instrumentMidiCapabilityForId(item.id);
  assert.equal(midi.computerKeyboardMode, 'page');
  assert.equal(midi.midiInput, true);
  assert.equal(midi.midiOutput, false);
  assert.equal(midi.startsAudio, false);
  assert.deepEqual(TAP_TEMPO_TARGETS.filter(target => target.route === item.href).map(({ selector, mapping }) => ({ selector, mapping })), [
    { selector: '#speed', mapping: { unit: 'hz', cycleUnit: 'journey' } },
  ]);
});

test('the original staircase page, model, sound, styles and icon remain byte-for-byte unchanged', async () => {
  assert.equal(staircaseSiteChanges.baseCommit, '4bb3575463ff8a6ab34a2a9f3fe9dce544b7e711');
  for (const { file, sha256 } of staircaseSiteChanges.originalFiles) {
    assert.equal(digest(await readFile(new URL(`../${file}`, import.meta.url))), sha256, file);
  }
});

test('exact additive site and build changes restore prior bytes and reject missing, duplicate and changed additions', async () => {
  for (const change of staircaseSiteChanges.changes) {
    const url = new URL(`../${change.file}`, import.meta.url), source = await readFile(url, 'utf8');
    const restored = restoreStaircaseSite(source, change.file);
    assert.equal(digest(restored), change.sha256, change.file);
    assert.equal(await readStaircaseSiteReference(url, 'utf8'), restored);
    assert.deepEqual(await readStaircaseSiteReference(url), await readFile(url));
    assert.equal(restoreStaircaseSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreStaircaseSite(restored, change.file), error);
    for (const { before, after } of change.replacements) {
      assert.throws(() => restoreStaircaseSite(source.replace(after, before), change.file), error);
      assert.throws(() => restoreStaircaseSite(source + after, change.file), error);
      const changed = after.replace(/staircase/, 'unreviewed-staircase');
      assert.notEqual(changed, after);
      assert.throws(() => restoreStaircaseSite(source.replace(after, changed), change.file), error);
    }
    const drift = '\n// unrelated source drift\n';
    assert.ok(restoreStaircaseSite(source + drift, change.file).endsWith(drift));
    assert.notEqual(digest(restoreStaircaseSite(source + drift, change.file)), change.sha256);
  }
  assert.equal(restoreStaircaseSite('untouched', 'unrelated.js'), 'untouched');
});

test('packaging includes the complete worker and Rust runtime with reproducible build checks', async () => {
  const manifest = await readFile(new URL('../scripts/site/runtime-files.tsv', import.meta.url), 'utf8');
  for (const path of [
    ...['app.js', 'engine.js', 'processor.js', 'field.js', 'worker.js', 'studies.css'].map(name => `src/instruments/striped-staircase-rust/${name}`),
    'assets/wasm/staircase.wasm', 'assets/wasm/staircase-build.json', 'docs/staircase-studies.md',
  ]) {
    assert.equal(manifest.split(`copy+require\t${path}\n`).length - 1, 1, path);
    assert.ok((await readFile(new URL(`../${path}`, import.meta.url))).length > 0, path);
  }
  const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(scripts['build:staircase-wasm'], 'node scripts/build-staircase-wasm.mjs');
  assert.equal(scripts['check:staircase-wasm'], 'node scripts/build-staircase-wasm.mjs --check');
  assert.ok(scripts.check.includes('npm run check:staircase-wasm'));
});
