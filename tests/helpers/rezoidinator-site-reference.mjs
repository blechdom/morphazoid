import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readStaircaseSiteReference as readFile } from './staircase-site-reference.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rezoidinatorSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/rezoidinator-site-amendments.json', import.meta.url), 'utf8',
));

/** Restore the display rename and spatial registration, retaining all prior evidence. */
export function restoreRezoidinatorSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  const change = rezoidinatorSiteChanges.changes.find(change => change.file === file);
  if (!change) return source;
  const counts = change.markers.map(({ text }) => source.split(text).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact Rezoidinator site amendment`;
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

/** Read the merged fresh-main state before this rename; binary reads stay raw. */
export async function readRezoidinatorSiteReference(file, encoding) {
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const relative = path.relative(root, file instanceof URL ? fileURLToPath(file) : file);
  return restoreRezoidinatorSite(source, relative, { allowRestored: true });
}
