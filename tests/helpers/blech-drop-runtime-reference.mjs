import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreStaircaseSite } from './staircase-site-reference.mjs';

export const blechDropRuntimeChange = JSON.parse(readFileSync(
  new URL('../fixtures/blech-drop-runtime-addition.json', import.meta.url), 'utf8',
));

/** Peel only the complete drop block, preserving the preceding timing amendment. */
export function restoreBlechDropRuntime(source, file, { allowRestored = false } = {}) {
  source = restoreStaircaseSite(source, file, { allowRestored: true });
  const change = blechDropRuntimeChange;
  if (typeof source !== 'string' || file !== change.file) return source;
  const counts = change.markers.map(marker => source.split(marker).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact BLECH MIDI prepared-drop runtime addition`;
  for (const count of counts) assert.equal(count, 1, error);
  assert.equal(source.split(change.after).length - 1, 1, error);
  return source.replace(change.after, change.before);
}

export async function readBlechDropRuntimeReference(file, encoding) {
  const { readProcessorSamplesSiteReference: readFile } = await import('./processor-samples-site-reference.mjs');
  const { fileURLToPath } = await import('node:url');
  const { relative } = await import('node:path');
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreBlechDropRuntime(source, relative(root, file instanceof URL ? fileURLToPath(file) : file));
}
