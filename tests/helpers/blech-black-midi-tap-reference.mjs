import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreBlechChannelTiming } from './blech-channel-timing-reference.mjs';

export const blechBlackMidiTapChange = JSON.parse(readFileSync(
  new URL('../fixtures/blech-black-midi-tap-addition.json', import.meta.url), 'utf8',
));

/** Remove this complete, uniquely placed owner registration before old proofs. */
export function restoreBlechBlackMidiTap(source, file, { allowRestored = false } = {}) {
  const change = blechBlackMidiTapChange;
  if (typeof source !== 'string' || file !== change.file) return source;
  source = restoreBlechChannelTiming(source, file, { allowRestored: true });
  const counts = change.markers.map(marker => source.split(marker).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact Blech Black MIDI Tap addition`;
  for (const count of counts) assert.equal(count, 1, error);
  assert.equal(source.split(change.after).length - 1, 1, error);
  return source.replace(change.after, change.before);
}
