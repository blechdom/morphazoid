import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreStaircaseSite } from './staircase-site-reference.mjs';

export const midiFavesSiteChange = JSON.parse(readFileSync(
  new URL('../fixtures/midi-faves-site-amendment.json', import.meta.url), 'utf8',
));

/** Reverse only the two approved Faves entries before older registry checks. */
export function restoreMidiFavesSite(source, file, { allowRestored = false } = {}) {
  source = restoreStaircaseSite(source, file, { allowRestored: true });
  if (typeof source !== 'string' || file !== midiFavesSiteChange.file) return source;
  const change = midiFavesSiteChange;
  const blocks = [...source.matchAll(/export const FAVE_TOOL_IDS = Object\.freeze\(\[([\s\S]*?)\]\);/g)];
  const afterCount = source.split(change.after).length - 1;
  const error = `${file}: exact MIDI Faves amendment`;
  if (allowRestored && afterCount === 0 && blocks.length <= 1
      && !blocks.some(block => /"(?:blech-midi|midiphoria)"/.test(block[1]))) return source;
  assert.equal(blocks.length, 1, error);
  assert.equal(afterCount, 1, error);
  assert.ok(blocks[0][0].endsWith(change.after), error);
  for (const id of ['blech-midi', 'midiphoria']) {
    assert.equal(blocks[0][1].split(`"${id}"`).length - 1, 1, error);
  }
  return source.replace(change.after, change.before);
}
