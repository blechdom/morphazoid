import { restoreWobbliniDjaySite } from "./wobblini-djay-site-reference.mjs";
import { restoreTapezoidSite } from "./tapezoid-site-reference.mjs";
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readGlobuleDamacySiteReference as readFile } from './globule-damacy-site-reference.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const graphonicCalculatorDrumsSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/graphonic-calculator-drums-site-amendments.json', import.meta.url), 'utf8',
));

/** Reverse only the reviewed drum-trigger runtime row of the Graphonic Calculator. */
export function restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreTapezoidSite(source, file, { allowRestored: true });
  source = restoreWobbliniDjaySite(source, file, { allowRestored: true });
  for (const change of graphonicCalculatorDrumsSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact Graphonic Calculator drums site amendment`);
      source = source.replace(after, () => before);
    }
  }
  return source;
}

const relativePath = file => path.relative(fileURLToPath(new URL('../../', import.meta.url)), file instanceof URL ? fileURLToPath(file) : file);

/** Normalize raw shared source before entering the older frozen reference chain. */
export async function readGraphonicCalculatorDrumsSiteReference(file, encoding) {
  const source = await readFile(file, encoding);
  return typeof source === 'string' ? restoreGraphonicCalculatorDrumsSite(source, relativePath(file)) : source;
}
