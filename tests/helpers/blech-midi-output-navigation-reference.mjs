import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const amendments = JSON.parse(readFileSync(new URL('../fixtures/blech-midi-output-navigation-amendments.json', import.meta.url), 'utf8'));

/** Keep older frozen navigation checks meaningful after the native output seam. */
export function restoreBlechMidiOutputNavigation(source, file, { allowRestored = false } = {}) {
  if (file !== 'nav.js' || typeof source !== 'string') return source;
  for (const { before, after } of [...amendments.replacements].reverse()) {
    const count = source.split(after).length - 1;
    // Older reversals can also remove the surrounding pre-change context. The
    // strict raw-source proof and each historical hash still expose drift.
    if (allowRestored && count === 0) continue;
    assert.equal(count, 1, `${file}: exact BLECH MIDI output navigation amendment`);
    source = source.replace(after, () => before);
  }
  return source;
}
