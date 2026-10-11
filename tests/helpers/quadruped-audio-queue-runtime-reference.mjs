import assert from 'node:assert/strict';

const file = 'scripts/site/runtime-files.tsv';
export const quadrupedAudioQueueRuntimeRow = 'copy+require\tsrc/instruments/quadruped/quadruped-audio-queue.js\n';

/** Preserve historical manifest guards by peeling only this reviewed row. */
export function restoreQuadrupedAudioQueueRuntime(source, relative, { allowRestored = false } = {}) {
  if (typeof source !== 'string' || relative !== file) return source;
  const count = source.split(quadrupedAudioQueueRuntimeRow).length - 1;
  if (allowRestored && count === 0) return source;
  assert.equal(count, 1, `${file}: exact Quadruped audio queue runtime addition`);
  return source.replace(quadrupedAudioQueueRuntimeRow, '');
}
