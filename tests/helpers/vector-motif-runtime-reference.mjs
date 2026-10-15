import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreSimdResonatorRuntime } from './simd-resonator-runtime-reference.mjs';
import { restoreBlechTextRuntime } from './blech-text-runtime-reference.mjs';

export const vectorMotifRuntimeChange = JSON.parse(readFileSync(
  new URL('../fixtures/vector-motif-runtime-addition.json', import.meta.url), 'utf8',
));

/** Peel only the complete, uniquely anchored motif module addition. */
export function restoreVectorMotifRuntime(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  const change = vectorMotifRuntimeChange;
  if (typeof source !== 'string' || file !== change.file) return source;
  source = restoreSimdResonatorRuntime(source, file, { allowRestored: true });
  source = restoreBlechTextRuntime(source, file, { allowRestored: true });
  const counts = change.paths.map(path => source.split(path).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact Vector Traveler motif runtime addition`;
  for (const count of counts) assert.equal(count, 1, error);
  assert.equal(source.split(change.after).length - 1, 1, error);
  return source.replace(change.after, change.before);
}

export async function readVectorMotifRuntimeReference(file, encoding) {
  const { readProcessorSamplesSiteReference: readFile } = await import('./processor-samples-site-reference.mjs');
  const { fileURLToPath } = await import('node:url');
  const { relative } = await import('node:path');
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreVectorMotifRuntime(source, relative(root, file instanceof URL ? fileURLToPath(file) : file));
}
