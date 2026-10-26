import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { restoreOculoidSite } from './helpers/oculoid-site-reference.mjs';
import { rezoidinatorRustDspSiteChanges as fixture, restoreRezoidinatorRustDspSite as restore } from './helpers/rezoidinator-rust-dsp-site-reference.mjs';
import { restorePreviousGlobuleCopy } from './helpers/globule-damacy-site-reference.mjs';
import { restoreWitchesBrewRefresh } from './helpers/witches-brew-refresh-reference.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');

test('Rust DSP capacity and runtime amendments restore exact prior source', async () => {
  for (const change of fixture.changes) {
    const current = restoreWitchesBrewRefresh(restoreOculoidSite(
      await readFile(new URL('../' + change.file, import.meta.url), 'utf8'),
      change.file,
    ), change.file);
    const source = restorePreviousGlobuleCopy(current, change.file);
    assert.equal(hash(source), change.approvedSha256, change.file);
    const prior = restore(source, change.file);
    assert.equal(hash(prior), change.sha256, change.file);
    assert.equal(restore(prior, change.file, { allowRestored: true }), prior);
    const suffix = '\nunknown independent change\n';
    assert.equal(restore(source + suffix, change.file), prior + suffix);
    assert.throws(() => restore(prior, change.file), /exact Rezoidinator Rust DSP/);
    for (const marker of change.markers) {
      assert.throws(() => restore(source + marker, change.file), /exact Rezoidinator Rust DSP/);
      assert.throws(() => restore(source.replace(marker, 'partial'), change.file, { allowRestored: true }), /exact Rezoidinator Rust DSP/);
    }
    if (change.file.endsWith('.tsv')) {
      assert.throws(() => restore(source.replace('copy+require\tsrc/instruments/simd-resonator-rust/fft-rust.js', 'copy\tsrc/instruments/simd-resonator-rust/fft-rust.js'), change.file), /exact Rezoidinator Rust DSP/);
    }
  }
});
