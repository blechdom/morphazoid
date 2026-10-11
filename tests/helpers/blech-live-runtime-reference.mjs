import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const blechLiveRuntimeChange = JSON.parse(readFileSync(
  new URL('../fixtures/blech-live-runtime-addition.json', import.meta.url), 'utf8',
));

/** Peel only the exact live automata addition; leave every unknown byte visible. */
export function restoreBlechLiveRuntime(source, file, { allowRestored = false } = {}) {
  const change = blechLiveRuntimeChange;
  if (typeof source !== 'string' || file !== change.file) return source;
  const counts = change.rows.map(row => source.split(row).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact Blech live automata runtime addition`;
  for (const count of counts) assert.equal(count, 1, error);
  assert.equal(source.split(change.addition).length - 1, 1, error);
  return source.replace(change.addition, '');
}
