import test from 'node:test';
import assert from 'node:assert/strict';
import { METHODS } from '../src/instruments/synthesis/catalog.js';
import { SYNTHESIS_DATES } from '../src/instruments/synthesis/chronology.js';

test('every synthesis method and processor has a qualified, sourced historical milestone', () => {
  assert.deepEqual(Object.keys(SYNTHESIS_DATES).sort(), METHODS.map(method => method.id).sort());
  for (const method of METHODS) {
    const date = SYNTHESIS_DATES[method.id];
    assert.match(date.dateLabel, /\d{4}/);
    assert(date.dateNote.length > 50);
    assert(date.dateKind.length > 0);
    assert(date.dateSource.label.length > 5);
    assert.match(new URL(date.dateSource.url).protocol, /^https?:$/);
  }
});
