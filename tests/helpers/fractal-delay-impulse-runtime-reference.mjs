import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreBlackMidiArtRuntime } from './black-midi-art-runtime-reference.mjs';
import { restoreSoundFontsShared } from './sound-fonts-shared-reference.mjs';
import { restoreTrackazoidPadsSite } from './trackazoid-pads-site-reference.mjs';
import { restoreBlechBlackMidiTap } from './blech-black-midi-tap-reference.mjs';
import { restoreBlechBrandSite } from './blech-brand-site-reference.mjs';

export const fractalImpulseRuntimeChanges = JSON.parse(readFileSync(
  new URL('../fixtures/fractal-delay-impulse-runtime-addition.json', import.meta.url), 'utf8',
));

/** Peel only exact reviewed additions; unknown or altered bytes remain visible. */
export function restoreFractalImpulseRuntime(source, file, { allowRestored = false } = {}) {
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  if (typeof source !== 'string') return source;
  source = restoreBlechBrandSite(source, file, { allowRestored: true });
  source = restoreBlechBlackMidiTap(source, file, { allowRestored: true });
  source = restoreBlackMidiArtRuntime(source, file, { allowRestored: true });
  source = restoreSoundFontsShared(source, file, { allowRestored: true });
  source = restoreTrackazoidPadsSite(source, file, { allowRestored: true });
  for (const { addition } of fractalImpulseRuntimeChanges.changes.filter(change => change.file === file)) {
    const count = source.split(addition).length - 1;
    if (allowRestored && count === 0) continue;
    assert.equal(count, 1, `${file}: exact Fractal Delay impulse runtime addition`);
    source = source.replace(addition, '');
  }
  return source;
}

/** Read current files through only this new amendment before older proofs. */
export async function readFractalImpulseRuntimeReference(file, encoding) {
  const { readProcessorSamplesSiteReference: readFile } = await import('./processor-samples-site-reference.mjs');
  const { fileURLToPath } = await import('node:url');
  const { relative } = await import('node:path');
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const path = relative(root, file instanceof URL ? fileURLToPath(file) : file);
  return restoreFractalImpulseRuntime(restoreTrackazoidPadsSite(source, path), path);
}
