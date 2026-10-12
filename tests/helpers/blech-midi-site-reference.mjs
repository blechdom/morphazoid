import { restoreTrackazoidSite } from './trackazoid-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFractalImpulseRuntimeReference as readFile } from './fractal-delay-impulse-runtime-reference.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreSpartialOrganRuntime } from './spartial-organ-runtime-reference.mjs';
import { restoreBlechBlackMidiTap } from './blech-black-midi-tap-reference.mjs';

export const blechMidiSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/blech-midi-site-amendments.json', import.meta.url), 'utf8',
));

/** Reverse only the reviewed standalone-page registration, packaging and moved tempo. */
export function restoreBlechMidiSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreBlechBlackMidiTap(source, file, { allowRestored: true });
  source = restoreSpartialOrganRuntime(source, file, { allowRestored: true });
  for (const change of blechMidiSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact Blech MIDI site amendment`);
      source = source.replace(after, before);
    }
  }
  return source;
}

export async function readBlechMidiSiteReference(file, encoding) {
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const relative = path.relative(root, file instanceof URL ? fileURLToPath(file) : file);
  return restoreBlechMidiSite(restoreTrackazoidSite(source, relative, { allowRestored: true }), relative, { allowRestored: true });
}
