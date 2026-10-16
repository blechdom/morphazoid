import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreBlechDropRuntime } from './blech-drop-runtime-reference.mjs';

export const blechChannelTimingChanges = JSON.parse(readFileSync(
  new URL('../fixtures/blech-channel-timing-amendments.json', import.meta.url), 'utf8',
));

/** Restore only the complete, uniquely anchored timing module and Tap owners. */
export function restoreBlechChannelTiming(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreBlechDropRuntime(source, file, { allowRestored: true });
  const change = blechChannelTimingChanges.changes.find(change => change.file === file);
  if (!change) return source;
  const counts = change.markers.map(marker => source.split(marker).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact BLECH MIDI channel timing amendment`;
  for (const count of counts) assert.equal(count, 1, error);
  assert.equal(source.split(change.after).length - 1, 1, error);
  return source.replace(change.after, change.before);
}

export async function readBlechChannelTimingReference(file, encoding) {
  const { readProcessorSamplesSiteReference: readFile } = await import('./processor-samples-site-reference.mjs');
  const { fileURLToPath } = await import('node:url');
  const { relative } = await import('node:path');
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreBlechChannelTiming(source, relative(root, file instanceof URL ? fileURLToPath(file) : file));
}
