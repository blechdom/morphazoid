import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const recordedInputSiteChanges = JSON.parse(readFileSync(
  new URL('../../docs/l-system-delay-recorded-input-site-changes.json', import.meta.url), 'utf8',
));

/** Reverse only the later recorded-input copy for older frozen hash assertions. */
export function restoreLSystemRecordedInputSite(source, file) {
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  for (const change of recordedInputSiteChanges.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact L-system recorded input amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
