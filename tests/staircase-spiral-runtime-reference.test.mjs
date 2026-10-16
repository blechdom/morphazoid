import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  staircaseSpiralRuntimeChange as change,
  restoreStaircaseSpiralRuntime as restore,
} from './helpers/staircase-spiral-runtime-reference.mjs';

const prefix = '# preceding historical manifest\ncopy+require\tsrc/earlier.js\n';
const suffix = 'copy+require\tassets/wasm/staircase.wasm\n# following historical manifest\n';
const previous = prefix + change.before + suffix;
const source = prefix + change.after + suffix;
const error = /exact Staircase spiral runtime addition/;
const digest = value => createHash('sha256').update(value).digest('hex');

test('spiral runtime normalization removes only the three reviewed rows in their exact location', () => {
  assert.equal(restore(source, change.file), previous);
  assert.equal(restore(previous, change.file, { allowRestored: true }), previous);
  assert.throws(() => restore(previous, change.file), error);
  assert.equal(restore(source, 'unrelated.js'), source);
  const binary = Buffer.from(source);
  assert.equal(restore(binary, change.file), binary);
});

test('partial, duplicated, weakened, reordered, or relocated spiral runtime additions fail', () => {
  const rows = change.paths.map(path => `copy+require\t${path}\n`);
  const invalid = [
    source + change.addition,
    change.addition + source.replace(change.addition, ''),
    source.replace(change.addition, [...rows].reverse().join('')),
    ...rows.map(row => source.replace(row, '')),
    ...rows.map(row => source + row),
    ...rows.map(row => source.replace(row, row.replace('copy+require', 'copy'))),
    ...rows.map(row => source.replace(row, row.replace('copy+require', 'require'))),
    ...rows.map(row => source.replace(row, '') + row),
    ...change.paths.map(path => source.replace(path, 'unreviewed-runtime-module.js')),
  ];
  for (const modified of invalid) {
    for (const allowRestored of [false, true]) {
      assert.throws(() => restore(modified, change.file, { allowRestored }), error);
    }
  }
});

test('unrelated manifest edits remain visible to the historical digest', () => {
  const drift = '\ncopy+require\tsrc/unreviewed.js\n';
  assert.equal(restore(source + drift, change.file), previous + drift);
  assert.notEqual(digest(restore(source + drift, change.file)), digest(previous));
  assert.equal(
    restore(source.replace('src/earlier.js', 'src/changed.js'), change.file),
    previous.replace('src/earlier.js', 'src/changed.js'),
  );
});
