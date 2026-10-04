import { restoreAudioInput } from "./helpers/audio-input-reference.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { voicesaurusAmendments, restoreVoicesaurus } from './helpers/voicesaurus-reference.mjs';
import { restoreFabricFilter } from './helpers/fabric-filter-reference.mjs';
import { restoreMorphazoidicalRemoval } from './helpers/morphazoidical-removal-reference.mjs';
import { restoreSynthesaurusFavesOrder } from './helpers/synthesaurus-faves-order-reference.mjs';

const read = file => restoreMorphazoidicalRemoval(restoreAudioInput(
  restoreSynthesaurusFavesOrder(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), file), file), file);

test('Voicesaurus reversal stays scoped and preserves the independent pre-feature reference', () => {
  assert.equal(voicesaurusAmendments.schemaVersion, 1);
  assert.equal(voicesaurusAmendments.baseCommit, 'eb6d751897ed35600337aac569de24dedf0c4229');
  assert.deepEqual(voicesaurusAmendments.changes.map(change => change.file), [
    "src/instruments/spelling-synthesizer/spelling-synthesizer-app.js",
    "src/instruments/spelling-synthesizer/spelling-synthesizer-audio.js",
    "src/instruments/spelling-synthesizer/spelling-synthesizer.js",
    "src/site/instrument-catalog.js",
    "src/site/instrument-midi-capabilities.js",
    "src/site/instrument-registry.js",
    "src/site/catalogue-taxonomy.js",
    "src/instruments/vocalzoid/vocalzoid-app.js"
]);
  for (const change of voicesaurusAmendments.changes) {
    assert.ok(change.replacements.length > 0);
    assert.match(change.sha256, /^[a-f0-9]{64}$/);
    const source = restoreFabricFilter(read(change.file), change.file);
    const restored = restoreVoicesaurus(source, change.file);
    assert.notEqual(restored, source);
    const body = change.implementation ? read(change.implementation) : source;
    const restoreBody = mutated => change.implementation
      ? restoreVoicesaurus(source, change.file, () => mutated)
      : restoreVoicesaurus(mutated, change.file);
    for (const replacement of change.replacements) {
      assert.throws(() => restoreBody(body.replace(replacement.after, '')), /exact Voicesaurus amendment/);
      assert.throws(() => restoreBody(body + replacement.after), /exact Voicesaurus amendment/);
    }
    assert.throws(() => restoreBody(body + '\n// unrelated drift\n'), /pre-Voicesaurus source preserved/);
    if (change.implementation) {
      assert.throws(() => restoreVoicesaurus(source + '// changed entry', change.file), /exact shared speech entry/);
    }
  }
  assert.equal(restoreVoicesaurus('untouched', 'unrelated.js'), 'untouched');
});
