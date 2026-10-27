import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const fractalSignalsMidiAmendment = JSON.parse(readFileSync(
  new URL('../fixtures/fractal-signals-midi-amendment.json', import.meta.url), 'utf8',
));

/** Remove only the exact MIDI fix before checking older microphone history. */
export function restoreFractalSignalsMidi(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string' || file !== fractalSignalsMidiAmendment.file) return source;
  const { addition } = fractalSignalsMidiAmendment;
  const count = source.split(addition).length - 1;
  if (allowRestored && count === 0) return source;
  assert.equal(count, 1, `${file}: exact Fractal Synthesis MIDI amendment`);
  return source.replace(addition, '');
}
