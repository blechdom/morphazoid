import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreMidiMixerRuntime } from './midi-mixer-runtime-reference.mjs';
import { restoreSpartialGranularSite } from './spartial-granular-site-reference.mjs';

export const vectorFractalsSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/vector-fractals-site-amendments.json', import.meta.url), 'utf8',
));

/** Reverse only the exact reviewed Vector Fractals registration and runtime rows. */
export function restoreVectorFractalsSite(source, file) {
  source = restoreSpartialGranularSite(source, file, { allowRestored: true });
  source = restoreMidiMixerRuntime(source, file, { allowRestored: true });
  for (const change of vectorFractalsSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      assert.equal(source.split(after).length - 1, 1, `${file}: exact Vector Fractals site amendment`);
      source = source.replace(after, before);
    }
  }
  return source;
}

/** Normalize raw shared source before entering the older frozen reference chain. */
export async function readVectorFractalsSiteReference(file, encoding) {
  const source = await readFile(file, encoding);
  if (typeof source !== 'string') return source;
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const relative = path.relative(root, file instanceof URL ? fileURLToPath(file) : file);
  return restoreVectorFractalsSite(source, relative);
}
