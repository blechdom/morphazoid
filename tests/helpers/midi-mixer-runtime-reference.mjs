import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreFractalMotionRuntime } from './fractal-delay-motion-runtime-reference.mjs';
import { restoreSpartialGranularSite } from './spartial-granular-site-reference.mjs';

export const midiMixerRuntimeChanges = JSON.parse(readFileSync(
  new URL('../fixtures/midi-mixer-runtime-addition.json', import.meta.url), 'utf8',
));

/** Remove only the embedded mixer's reviewed runtime rows and tempo target. */
export function restoreMidiMixerRuntime(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreFractalMotionRuntime(source, file, { allowRestored: true });
  source = restoreSpartialGranularSite(source, file, { allowRestored: true });
  for (const { addition } of midiMixerRuntimeChanges.changes.filter(change => change.file === file)) {
    if (allowRestored && !source.includes(addition)) continue;
    assert.equal(source.split(addition).length - 1, 1, `${file}: exact MIDI Mixer runtime addition`);
    source = source.replace(addition, '');
  }
  return source;
}
