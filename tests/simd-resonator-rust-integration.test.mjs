import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readRezoidinatorSiteReference } from './helpers/rezoidinator-site-reference.mjs';
import { restoreProcessorSamplesSite } from './helpers/processor-samples-site-reference.mjs';
import { restoreBlechChannelTiming } from './helpers/blech-channel-timing-reference.mjs';
import test from 'node:test';
import { CANONICAL_PAGE_ROUTES } from '../src/pages/manifest.js';
import { TOOL_GROUPS, FAVE_TOOL_IDS } from '../src/site/instrument-registry.js';
import { instrumentById } from '../src/site/instrument-catalog.js';
import { instrumentMidiCapabilityForId } from '../src/site/instrument-midi-capabilities.js';
import { parseRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { rustResonatorSiteChanges, restoreRustResonatorSite, readRustResonatorSiteReference } from './helpers/simd-resonator-rust-site-reference.mjs';
import { restoreRoachPerformance } from './helpers/roach-synth-performance-reference.mjs';

const id = 'simd-resonator-rust';
const digest = source => createHash('sha256').update(source).digest('hex');
const urlFor = file => new URL(`../${file}`, import.meta.url);
// Independent October 14 BLECH additions compose with the frozen Rust proof.
const priorRustSource = async file => restoreRoachPerformance(restoreProcessorSamplesSite(restoreBlechChannelTiming(
  await readRezoidinatorSiteReference(urlFor(file), 'utf8'), file, { allowRestored: true },
), file, { allowRestored: true }), file);

test('Rezoidinator is a separate instrument immediately beside SIMD Resonator', () => {
  const group = TOOL_GROUPS.find(group => group.id === 'simd-audio');
  const original = group.tools.findIndex(tool => tool.id === 'simd-resonator');
  assert.equal(group.tools[original + 1].id, id);
  assert.equal(TOOL_GROUPS.flatMap(group => group.tools).filter(tool => tool.id === id).length, 1);
  assert.equal(FAVE_TOOL_IDS.includes(id), false);
  const item = instrumentById(id);
  assert.equal(item.label, 'Rezoidinator');
  assert.equal(item.href, `${id}.html`);
  assert.equal(item.status, null);
  assert.equal(item.imageHref, instrumentById('simd-resonator').imageHref);
  assert.deepEqual(item.tags.map(tag => tag.id), ['simd-audio', 'resonator']);
  assert.match(item.description, /4,096 parallel modes.*spectral span/);
  assert.equal(CANONICAL_PAGE_ROUTES.filter(route => route === item.href).length, 1);
  assert.deepEqual(instrumentMidiCapabilityForId(id), {
    ...instrumentMidiCapabilityForId('simd-resonator'), id,
  });
});

test('Rezoidinator packaging explicitly requires its own runtime and keeps the original', async () => {
  const inventory = parseRuntimeManifest(await readFile(urlFor('scripts/site/runtime-files.tsv'), 'utf8'));
  const paths = [`${id}.html`,
    ...['app.js', 'model.js', 'presets.js', 'processor.js', 'fft-resynth.js', 'spatial-model.js', 'surround-output.js', 'recording.js', 'style.css'].map(name => `src/instruments/${id}/${name}`),
    'assets/wasm/rust-resonator-scalar.wasm', 'assets/wasm/rust-resonator-simd.wasm', 'docs/simd-resonator-rust.md', 'docs/rezoidinator-surround-measurements.json'];
  for (const file of paths) {
    const entries = inventory.entries.filter(entry => entry.path === file);
    assert.equal(entries.length, 1, file);
    assert.equal(entries[0].policy, 'copy+require', file);
  }
  for (const file of ['simd-resonator.html', 'simd-lab.html', 'src/simd-resonator.js', 'src/simd-resonator-processor.js']) {
    assert.ok(inventory.requiredFiles.includes(file), file);
  }
  assert.equal(inventory.entries.some(entry => entry.path === `src/instruments/${id}/rust/build-manifest.json`), false);
});

test('new site additions reverse to exact fresh-main bytes without rewriting old evidence', async () => {
  assert.equal(rustResonatorSiteChanges.baseCommit, 'a88b25955b508ae6b729f2a35646b41c77177560');
  for (const change of rustResonatorSiteChanges.changes) {
    const url = urlFor(change.file), source = await priorRustSource(change.file);
    const restored = restoreRustResonatorSite(source, change.file);
    assert.equal(digest(source), change.approvedSha256, change.file);
    assert.equal(digest(restored), change.sha256, change.file);
    assert.equal(restoreRoachPerformance(restoreProcessorSamplesSite(restoreBlechChannelTiming(await readRustResonatorSiteReference(url, 'utf8'), change.file, { allowRestored: true }), change.file, { allowRestored: true }), change.file), restored);
    assert.equal(restoreRustResonatorSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreRustResonatorSite(restored, change.file), /exact Rust Resonator/);
    let reapplied = restored;
    for (const { before, after } of change.replacements) reapplied = reapplied.replace(before, after);
    assert.equal(reapplied, source);
    for (const { before, after } of change.replacements) {
      for (const options of [{}, { allowRestored: true }]) {
        assert.throws(() => restoreRustResonatorSite(source + after, change.file, options), /exact Rust Resonator/);
        assert.throws(() => restoreRustResonatorSite(after + source.replace(after, before), change.file, options), /exact Rust Resonator/);
      }
    }
  }
});

test('addition guards keep partial, altered and unknown changes visible', async () => {
  for (const change of rustResonatorSiteChanges.changes) {
    const source = await priorRustSource(change.file), suffix = '\n// unrelated drift\n';
    const expected = restoreRustResonatorSite(source, change.file);
    const drift = restoreRustResonatorSite(source + suffix, change.file);
    assert.equal(drift, expected + suffix);
    assert.notEqual(digest(drift), change.sha256);
    for (const { text } of change.markers) {
      const partial = source.replace(text, 'unreviewed-rust-resonator');
      assert.throws(() => restoreRustResonatorSite(partial, change.file), /exact Rust Resonator/);
      const optional = () => restoreRustResonatorSite(partial, change.file, { allowRestored: true });
      if (change.markers.every(marker => !partial.includes(marker.text))) assert.equal(optional(), partial);
      else assert.throws(optional, /exact Rust Resonator/);
    }
    const bytes = await readFile(urlFor(change.file));
    assert.equal(restoreRustResonatorSite(bytes, change.file), bytes);
    assert.deepEqual(await readRustResonatorSiteReference(urlFor(change.file)), bytes);
    assert.equal(restoreRustResonatorSite(source, 'unrelated.js'), source);
  }
  const file = 'scripts/site/runtime-files.tsv', source = await priorRustSource(file);
  const row = `copy+require\tsrc/instruments/${id}/app.js\n`;
  for (const policy of ['copy', 'require']) for (const options of [{}, { allowRestored: true }]) {
    assert.throws(() => restoreRustResonatorSite(source.replace(row, row.replace('copy+require', policy)), file, options), /exact Rust Resonator/);
  }
});

test('the new preset bank is tracked without granting listening or device acceptance', async () => {
  const status = JSON.parse(await readFile(urlFor('docs/preset-rollout-status.json'), 'utf8'));
  const entry = status.entries.find(entry => entry.id === id);
  assert.equal(entry.scope, 'regular');
  assert.equal(entry.presets, 20);
  assert.equal(entry.status, 'implemented-verification-pending');
  assert.match(entry.evidence, /Human listening and physical-device acceptance remain pending/);
});
