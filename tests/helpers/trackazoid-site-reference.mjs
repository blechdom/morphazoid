import { restoreTrackazoidBeatmatchingSite } from './trackazoid-beatmatching-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreSoundFontsSite } from './sound-fonts-site-reference.mjs';
import { restoreMidiNoteEffectsRuntime } from './midi-note-effects-runtime-reference.mjs';

export const trackazoidSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/trackazoid-site-amendments.json', import.meta.url), 'utf8',
));

/** Reverse only the Trackazoid registration before comparing historical bytes. */
export function restoreTrackazoidSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreTrackazoidBeatmatchingSite(source, file, { allowRestored: true });
  source = restoreMidiNoteEffectsRuntime(source, file, { allowRestored: true });
  // This shared historical entry point peels the later additive Sound Fonts
  // utility before older snapshots, preserving their original hashes and guards.
  source = restoreSoundFontsSite(source, file, { allowRestored: true });
  for (const change of trackazoidSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      // The checked-in amendment also describes the current catalogue wording.
      // Compare both sides at the same original-MVP revision.
      const originalAfter = restoreTrackazoidBeatmatchingSite(after, file, { allowRestored: true });
      const count = source.split(originalAfter).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact Trackazoid site amendment`);
      source = source.replace(originalAfter, before);
    }
  }
  return source;
}

/** Keep historical tests operating on their original evidence and mutations. */
export async function readTrackazoidSiteReference(file, encoding) {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { relative } = await import('node:path');
  const source = await readFile(file, encoding);
  if (typeof source !== 'string') return source;
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreTrackazoidSite(source, relative(root, file instanceof URL ? fileURLToPath(file) : file), { allowRestored: true });
}
