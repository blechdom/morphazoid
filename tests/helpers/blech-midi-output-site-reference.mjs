import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreBlechMidiOutputNavigation } from './blech-midi-output-navigation-reference.mjs';

export const blechMidiOutputSiteAmendments = JSON.parse(readFileSync(new URL('../fixtures/blech-midi-output-site-amendments.json', import.meta.url), 'utf8'));

/** Reverse only the native MIDI-output amendments before older frozen guards. */
export function restoreBlechMidiOutputSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreBlechMidiOutputNavigation(source, file, { allowRestored });
  for (const change of blechMidiOutputSiteAmendments.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact BLECH MIDI output site amendment`);
      source = source.replace(after, () => before);
    }
  }
  return source;
}
