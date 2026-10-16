import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreMidiFavesSite } from './midi-faves-site-reference.mjs';

export const blechBrandSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/blech-brand-site-amendment.json', import.meta.url), 'utf8',
));

/** Restore only the reviewed label and catalogue copy; preserve unknown bytes. */
export function restoreBlechBrandSite(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  if (typeof source !== 'string') return source;
  source = restoreMidiFavesSite(source, file, { allowRestored: true });
  const change = blechBrandSiteChanges.changes.find(change => change.file === file);
  if (!change) return source;
  const markerCount = source.split(change.marker).length - 1;
  const afterCount = source.split(change.after).length - 1;
  const beforeCount = source.split(change.before).length - 1;
  if (allowRestored && afterCount === 0 && (markerCount === 0 || (beforeCount > 0 && markerCount === beforeCount))) return source;
  const error = `${file}: exact BLECH MIDI brand amendment`;
  assert.equal(markerCount, 1, error);
  assert.equal(afterCount, 1, error);
  assert.equal(beforeCount, 0, error);
  return source.replace(change.after, change.before);
}

export async function readBlechBrandSiteReference(file, encoding) {
  const { readProcessorSamplesSiteReference: readFile } = await import('./processor-samples-site-reference.mjs');
  const { fileURLToPath } = await import('node:url');
  const { relative } = await import('node:path');
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreBlechBrandSite(source, relative(root, file instanceof URL ? fileURLToPath(file) : file));
}
