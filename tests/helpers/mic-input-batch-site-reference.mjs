import { restoreRoachPerformance } from './roach-synth-performance-reference.mjs';
import { restoreGraphonicCalculatorDrumsSite } from './graphonic-calculator-drums-site-reference.mjs';
import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreWobbliniSite } from './wobblini-site-reference.mjs';

export const micInputBatchSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/mic-input-batch-site-amendments.json', import.meta.url), 'utf8',
));

/** Reverse only the reviewed Mic/File/Samples input wiring, page links and runtime manifest rows. */
export function restoreMicInputBatchSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWobbliniSite(source, file, { allowRestored: true });
  for (const change of micInputBatchSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact mic input batch amendment`);
      source = source.replace(after, () => before);
    }
  }
  source = restoreRoachPerformance(source, file, { allowRestored: true });
  return source;
}

const relativePath = file => path.relative(fileURLToPath(new URL('../../', import.meta.url)), file instanceof URL ? fileURLToPath(file) : file);

/** Normalize raw shared source before entering the older frozen reference chain. */
export async function readMicInputBatchSiteReference(file, encoding) {
  const source = await readFile(file, encoding);
  if (typeof source !== 'string') return source;
  const name = relativePath(file);
  return restoreGraphonicCalculatorSite(restoreHeaderPresetsBatchSite(restoreMicInputBatchSite(source, name), name), name);
}
