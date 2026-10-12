import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const fractalImpulseRuntimeChanges = JSON.parse(readFileSync(
  new URL('../fixtures/fractal-delay-impulse-runtime-addition.json', import.meta.url), 'utf8',
));

/** Peel only exact reviewed additions; unknown or altered bytes remain visible. */
export function restoreFractalImpulseRuntime(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  for (const { addition } of fractalImpulseRuntimeChanges.changes.filter(change => change.file === file)) {
    const count = source.split(addition).length - 1;
    if (allowRestored && count === 0) continue;
    assert.equal(count, 1, `${file}: exact Fractal Delay impulse runtime addition`);
    source = source.replace(addition, '');
  }
  return source;
}
