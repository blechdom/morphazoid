import { restoreGraphonicCalculatorDrumsSite } from './graphonic-calculator-drums-site-reference.mjs';
import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreBlechBlackMidiRuntime } from './blech-black-midi-runtime-reference.mjs';

export const blackMidiArtRuntimeChange = JSON.parse(readFileSync(
  new URL('../fixtures/black-midi-art-runtime-addition.json', import.meta.url), 'utf8',
));

/** Remove this exact reviewed block, never unknown paths or broad asset globs. */
export function restoreBlackMidiArtRuntime(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  const change = blackMidiArtRuntimeChange;
  if (typeof source !== 'string' || file !== change.file) return source;
  source = restoreBlechBlackMidiRuntime(source, file, { allowRestored: true });
  const counts = change.rows.map(row => source.split(row).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const message = `${file}: exact Black MIDI artwork runtime addition`;
  for (const count of counts) assert.equal(count, 1, message);
  assert.equal(source.split(change.addition).length - 1, 1, message);
  return source.replace(change.addition, '');
}
