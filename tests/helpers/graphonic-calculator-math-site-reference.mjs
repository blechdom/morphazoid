import { restoreGraphonicCalculatorDrumsSite } from './graphonic-calculator-drums-site-reference.mjs';
import { restoreWobbliniControlsSite } from './wobblini-controls-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readGlobuleDamacySiteReference as readFile } from './globule-damacy-site-reference.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const graphonicCalculatorMathSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/graphonic-calculator-math-site-amendments.json', import.meta.url), 'utf8',
));

/** Reverse only the reviewed Math category addition that moved the Graphonic Calculator out of Work in Progress. */
export function restoreGraphonicCalculatorMathSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreWobbliniControlsSite(source, file, { allowRestored: true });
  for (const change of graphonicCalculatorMathSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact Graphonic Calculator Math site amendment`);
      source = source.replace(after, () => before);
    }
  }
  return source;
}

const relativePath = file => path.relative(fileURLToPath(new URL('../../', import.meta.url)), file instanceof URL ? fileURLToPath(file) : file);

/** Normalize raw shared source before entering the older frozen reference chain. */
export async function readGraphonicCalculatorMathSiteReference(file, encoding) {
  const source = await readFile(file, encoding);
  return typeof source === 'string' ? restoreGraphonicCalculatorMathSite(source, relativePath(file)) : source;
}
