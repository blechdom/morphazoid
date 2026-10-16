import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const hybrinxVolumeMeterChanges = JSON.parse(readFileSync(new URL('../../docs/hybrinx-volume-meter-runtime-changes.json', import.meta.url), 'utf8')).changes;
export function restoreHybrinxVolumeMeter(source, file) {
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  for (const change of hybrinxVolumeMeterChanges.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact Hybrinx volume/meter amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
