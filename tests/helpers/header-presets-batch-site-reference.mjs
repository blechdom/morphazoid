import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import { restoreWobbliniSite } from './wobblini-site-reference.mjs';

export const headerPresetsBatchSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/header-presets-batch-site-amendments.json', import.meta.url), 'utf8',
));

/** Reverse only the reviewed preset-row wiring, page hosts and runtime manifest rows. */
export function restoreHeaderPresetsBatchSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreWobbliniSite(source, file, { allowRestored: true });
  for (const change of headerPresetsBatchSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact header presets batch amendment`);
      source = source.replace(after, () => before);
    }
  }
  return source;
}

const relativePath = file => path.relative(fileURLToPath(new URL('../../', import.meta.url)), file instanceof URL ? fileURLToPath(file) : file);

/** Normalize raw shared source before entering the older frozen reference chain. */
export async function readHeaderPresetsBatchSiteReference(file, encoding) {
  const source = await readFile(file, encoding);
  if (typeof source !== 'string') return source;
  return restoreGraphonicCalculatorSite(restoreHeaderPresetsBatchSite(source, relativePath(file)), relativePath(file));
}
