import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreBlechChannelTiming } from './blech-channel-timing-reference.mjs';

export const blechTextRuntimeChange = JSON.parse(readFileSync(
  new URL('../fixtures/blech-text-runtime-addition.json', import.meta.url), 'utf8',
));

/** Peel only the complete, uniquely anchored text preparation registration. */
export function restoreBlechTextRuntime(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  const change = blechTextRuntimeChange;
  if (typeof source !== 'string' || file !== change.file) return source;
  source = restoreBlechChannelTiming(source, file, { allowRestored: true });
  const counts = change.markers.map(marker => source.split(marker).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact BLECH MIDI text preparation runtime addition`;
  for (const count of counts) assert.equal(count, 1, error);
  assert.equal(source.split(change.after).length - 1, 1, error);
  return source.replace(change.after, change.before);
}

export async function readBlechTextRuntimeReference(file, encoding) {
  const { readProcessorSamplesSiteReference: readFile } = await import('./processor-samples-site-reference.mjs');
  const { fileURLToPath } = await import('node:url');
  const { relative } = await import('node:path');
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreBlechTextRuntime(source, relative(root, file instanceof URL ? fileURLToPath(file) : file));
}
