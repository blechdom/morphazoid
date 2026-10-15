import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const blechDropRuntimeChange = JSON.parse(readFileSync(
  new URL('../fixtures/blech-drop-runtime-addition.json', import.meta.url), 'utf8',
));

/** Peel only the complete drop block, preserving the preceding timing amendment. */
export function restoreBlechDropRuntime(source, file, { allowRestored = false } = {}) {
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
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { relative } = await import('node:path');
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreBlechDropRuntime(source, relative(root, file instanceof URL ? fileURLToPath(file) : file));
}
