import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const processorSamplesSiteChanges = JSON.parse(readFileSync(new URL('../fixtures/processor-samples-site-amendments.json', import.meta.url), 'utf8'));

/** Reverse only the reviewed catalogue, runtime paths and processor adapters.
 * Existing historical hashes and their unknown-drift guards remain intact. */
export function restoreProcessorSamplesSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  for (const change of processorSamplesSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after, marker, markers } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      const counts = (markers ?? (marker ? [marker] : [])).map(value => source.split(value).length - 1);
      if (allowRestored && count === 0 && (markers ? counts.every(n => n === 0) : source.split(before).length - 1 === 1)) continue;
      const error = `${file}: exact processor samples amendment`;
      for (const n of counts) assert.equal(n, 1, error);
      assert.equal(count, 1, error);
      source = source.replace(after, before);
    }
  }
  return source;
}

export async function readProcessorSamplesSiteReference(file, encoding) {
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreProcessorSamplesSite(source, relative(root, file instanceof URL ? fileURLToPath(file) : file), { allowRestored: true });
}
