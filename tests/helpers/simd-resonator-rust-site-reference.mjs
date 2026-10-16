import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { restoreRezoidinatorSite } from './rezoidinator-site-reference.mjs';
import { readFileSync } from 'node:fs';
import { readStaircaseSiteReference as readFile } from './staircase-site-reference.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rustResonatorSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/simd-resonator-rust-site-amendments.json', import.meta.url), 'utf8',
));

/** Peel only this copy's exact registration; retain older bytes and guards. */
export function restoreRustResonatorSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreRezoidinatorSite(source, file, { allowRestored: true });
  const change = rustResonatorSiteChanges.changes.find(change => change.file === file);
  if (!change) return source;
  const counts = change.markers.map(({ text }) => source.split(text).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact Rust Resonator site addition`;
  for (let index = 0; index < counts.length; index++) {
    assert.equal(counts[index], change.markers[index].count, error);
  }
  for (const { before, beforeCount } of change.replacements) {
    assert.equal(source.split(before).length - 1, beforeCount, error);
  }
  for (const { before, after } of [...change.replacements].reverse()) {
    assert.equal(source.split(after).length - 1, 1, error);
    source = source.replace(after, before);
  }
  return source;
}

/** Historical tests read their own revision, preserving raw binary identity. */
export async function readRustResonatorSiteReference(file, encoding) {
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const relative = path.relative(root, file instanceof URL ? fileURLToPath(file) : file);
  return restoreRustResonatorSite(source, relative, { allowRestored: true });
}
