import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreVectorMotifRuntime } from './vector-motif-runtime-reference.mjs';

export const blechNoteHistoryRuntimeChange = JSON.parse(readFileSync(
  new URL('../fixtures/blech-note-history-runtime-addition.json', import.meta.url), 'utf8',
));

/** Peel only the complete, uniquely anchored note-history registration. */
export function restoreBlechNoteHistoryRuntime(source, file, { allowRestored = false } = {}) {
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  const change = blechNoteHistoryRuntimeChange;
  if (typeof source !== 'string' || file !== change.file) return source;
  source = restoreVectorMotifRuntime(source, file, { allowRestored: true });
  const counts = change.markers.map(marker => source.split(marker).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact BLECH MIDI note-history runtime addition`;
  for (const count of counts) assert.equal(count, 1, error);
  assert.equal(source.split(change.after).length - 1, 1, error);
  return source.replace(change.after, change.before);
}

export async function readBlechNoteHistoryRuntimeReference(file, encoding) {
  const { readProcessorSamplesSiteReference: readFile } = await import('./processor-samples-site-reference.mjs');
  const { fileURLToPath } = await import('node:url');
  const { relative } = await import('node:path');
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreBlechNoteHistoryRuntime(source, relative(root, file instanceof URL ? fileURLToPath(file) : file));
}
