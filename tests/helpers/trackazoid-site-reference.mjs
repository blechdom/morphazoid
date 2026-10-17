import { restoreRoachPerformance } from './roach-synth-performance-reference.mjs';
import { restoreGraphonicCalculatorDrumsSite } from './graphonic-calculator-drums-site-reference.mjs';
import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import { restoreTrackazoidBeatmatchingSite } from './trackazoid-beatmatching-site-reference.mjs';
import { restoreTrackazoidPadsSite } from './trackazoid-pads-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreSoundFontsSite } from './sound-fonts-site-reference.mjs';
import { restoreBlechLiveRuntime } from './blech-live-runtime-reference.mjs';
import { restoreMidiNoteEffectsRuntime } from './midi-note-effects-runtime-reference.mjs';
import { restoreBlackMidiArtRuntime } from './black-midi-art-runtime-reference.mjs';
import { restoreBlechBrandSite } from './blech-brand-site-reference.mjs';

export const trackazoidSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/trackazoid-site-amendments.json', import.meta.url), 'utf8',
));

/** Reverse only the Trackazoid registration before comparing historical bytes. */
export function restoreTrackazoidSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreBlechBrandSite(source, file, { allowRestored: true });
  source = restoreBlackMidiArtRuntime(source, file, { allowRestored: true });
  source = restoreTrackazoidPadsSite(source, file, { allowRestored: true });
  source = restoreTrackazoidBeatmatchingSite(source, file, { allowRestored: true });
  source = restoreBlechLiveRuntime(source, file, { allowRestored: true });
  source = restoreMidiNoteEffectsRuntime(source, file, { allowRestored: true });
  // This shared historical entry point peels the later additive Sound Fonts
  // utility before older snapshots, preserving their original hashes and guards.
  source = restoreSoundFontsSite(source, file, { allowRestored: true });
  for (const change of trackazoidSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      // The checked-in amendment also describes the current catalogue wording.
      // Compare both sides at the same original-MVP revision.
      const originalAfter = restoreTrackazoidBeatmatchingSite(after, file, { allowRestored: true });
      const count = source.split(originalAfter).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact Trackazoid site amendment`);
      source = source.replace(originalAfter, before);
    }
  }
  source = restoreRoachPerformance(source, file, { allowRestored: true });
  return source;
}

/** Keep historical tests operating on their original evidence and mutations. */
export async function readTrackazoidSiteReference(file, encoding) {
  const { readFractalImpulseRuntimeReference: readFile } = await import('./fractal-delay-impulse-runtime-reference.mjs');
  const { fileURLToPath } = await import('node:url');
  const { relative } = await import('node:path');
  const source = await readFile(file, encoding);
  if (typeof source !== 'string') return source;
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreTrackazoidSite(source, relative(root, file instanceof URL ? fileURLToPath(file) : file), { allowRestored: true });
}
