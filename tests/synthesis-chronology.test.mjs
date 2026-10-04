import test from 'node:test';
import assert from 'node:assert/strict';
import { METHODS } from '../src/instruments/synthesis/catalog.js';
import { SYNTHESIS_DATES } from '../src/instruments/synthesis/chronology.js';

test('every synthesis method and processor has a qualified, sourced historical milestone', () => {
  assert.deepEqual(Object.keys(SYNTHESIS_DATES).sort(), METHODS.map(method => method.id).sort());
  for (const method of METHODS) {
    const date = SYNTHESIS_DATES[method.id];
    assert.match(date.dateLabel, /\d{4}/);
    assert.match(date.dateLabel, /^\d{4}(?:\s*(?:\/|–)\s*\d{2,4})?$/);
    assert.doesNotMatch(date.dateLabel, /^by 1996$/i);
    assert(date.dateNote.length > 50);
    assert.doesNotMatch(date.dateNote, /belongs to an established synthesis or processing family documented in Roads/i);
    assert(date.dateKind.length > 0);
    assert.doesNotMatch(date.dateKind, /^documented by$/i);
    assert(date.dateSource.label.length > 5);
    assert.match(new URL(date.dateSource.url).protocol, /^https?:$/);
    assert.doesNotMatch(date.dateSource.url, /wikipedia\.org|9780262680820/i);
  }
});
