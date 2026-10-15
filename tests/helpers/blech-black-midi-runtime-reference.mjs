import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreBlechWorkspaceRuntime } from './blech-workspace-runtime-reference.mjs';

export const blechBlackMidiRuntimeChange = JSON.parse(readFileSync(
  new URL('../fixtures/blech-black-midi-runtime-move.json', import.meta.url), 'utf8',
));

/** Restore only the complete, uniquely located ownership move before old guards. */
export function restoreBlechBlackMidiRuntime(source, file, { allowRestored = false } = {}) {
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  const change = blechBlackMidiRuntimeChange;
  if (typeof source !== 'string' || file !== change.file) return source;
  source = restoreBlechWorkspaceRuntime(source, file, { allowRestored: true });
  // Paths, not policies, are the recognition markers: mutating every policy
  // still requires the exact reviewed block and cannot bypass strict checks.
  const paths = change.markers.map(row => row.split('\t')[1].trim());
  const counts = paths.map(path => source.split(path).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact Blech Black MIDI ownership move`;
  for (const count of counts) assert.equal(count, 1, error);
  assert.equal(source.split(change.after).length - 1, 1, error);
  for (const { before } of change.replacements) assert.ok(!source.includes(before), error);
  return source.replace(change.after, change.before);
}

export async function readBlechBlackMidiRuntimeReference(file, encoding) {
  const { readProcessorSamplesSiteReference: readFile } = await import('./processor-samples-site-reference.mjs');
  const { fileURLToPath } = await import('node:url');
  const { relative } = await import('node:path');
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreBlechBlackMidiRuntime(source, relative(root, file instanceof URL ? fileURLToPath(file) : file));
}
