import { restoreGraphonicCalculatorDrumsSite } from './graphonic-calculator-drums-site-reference.mjs';
import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
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
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
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
