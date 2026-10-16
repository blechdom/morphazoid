import { restoreBlechSpigotRuntime } from './blech-spigot-runtime-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const graphonicCalculatorSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/graphonic-calculator-site-amendments.json', import.meta.url), 'utf8',
));

/** Reverse only the exact reviewed Graphonic Calculator registration and runtime rows. */
export function restoreGraphonicCalculatorSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreBlechSpigotRuntime(source, file, { allowRestored: true });
  for (const change of graphonicCalculatorSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact Graphonic Calculator site amendment`);
      source = source.replace(after, () => before);
    }
  }
  return source;
}

const relativePath = file => path.relative(fileURLToPath(new URL('../../', import.meta.url)), file instanceof URL ? fileURLToPath(file) : file);

/** Normalize raw shared source before entering the older frozen reference chain. */
export async function readGraphonicCalculatorSiteReference(file, encoding) {
  const source = await readFile(file, encoding);
  return typeof source === 'string' ? restoreGraphonicCalculatorSite(source, relativePath(file)) : source;
}
