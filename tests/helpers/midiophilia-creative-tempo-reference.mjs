import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import { restoreTrackazoidSite } from './trackazoid-site-reference.mjs';
import { restoreBlechMidiSite } from './blech-midi-site-reference.mjs';
import assert from 'node:assert/strict';
import { restoreFractalImpulseRuntime } from './fractal-delay-impulse-runtime-reference.mjs';
import { readFileSync } from 'node:fs';

export const creativeTempoRuntimeChanges = JSON.parse(readFileSync(
  new URL('../fixtures/midiophilia-creative-tempo-addition.json', import.meta.url), 'utf8',
));

/** Peel only the reviewed creative-tab target before historical runtime guards. */
export function restoreMidiophiliaCreativeTempo(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreTrackazoidSite(source, file, { allowRestored: true });
  source = restoreBlechMidiSite(source, file, { allowRestored: true });
  if (typeof source !== 'string') return source;
  source = restoreFractalImpulseRuntime(source, file, { allowRestored: true });
  for (const { addition } of creativeTempoRuntimeChanges.changes.filter(change => change.file === file)) {
    const count = source.split(addition).length - 1;
    if (allowRestored && count === 0) continue;
    assert.equal(count, 1, `${file}: exact Midiophilia creative tempo addition`);
    source = source.replace(addition, '');
  }
  return source;
}
