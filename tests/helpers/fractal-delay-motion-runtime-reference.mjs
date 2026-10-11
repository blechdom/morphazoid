import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreQuadrupedAudioQueueRuntime } from './quadruped-audio-queue-runtime-reference.mjs';
import { restoreSpartialGranularSite } from './spartial-granular-site-reference.mjs';

export const fractalMotionRuntimeChanges = JSON.parse(readFileSync(
  new URL('../fixtures/fractal-delay-motion-runtime-addition.json', import.meta.url), 'utf8',
));

/** Peel only the reviewed motion helper row and the two exact tempo targets. */
export function restoreFractalMotionRuntime(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreSpartialGranularSite(source, file, { allowRestored: true });
  source = restoreQuadrupedAudioQueueRuntime(source, file, { allowRestored: true });
  for (const { addition } of fractalMotionRuntimeChanges.changes.filter(change => change.file === file)) {
    if (allowRestored && !source.includes(addition)) continue;
    assert.equal(source.split(addition).length - 1, 1, `${file}: exact Fractal Delay motion runtime addition`);
    source = source.replace(addition, '');
  }
  return source;
}
