import { restoreGraphonicCalculatorDrumsSite } from './graphonic-calculator-drums-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const wobbliniControlsSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/wobblini-controls-site-amendments.json', import.meta.url), 'utf8',
));

/** Peel only the reviewed Wobblini control-copy changes before older site proofs. */
export function restoreWobbliniControlsSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  for (const change of wobbliniControlsSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact Wobblini controls site amendment`);
      source = source.replace(after, () => before);
    }
  }
  return source;
}

const relativePath = file => path.relative(fileURLToPath(new URL('../../', import.meta.url)), file instanceof URL ? fileURLToPath(file) : file);

export async function readWobbliniControlsSiteReference(file, encoding) {
  const source = await readFile(file, encoding);
  return typeof source === 'string' ? restoreWobbliniControlsSite(source, relativePath(file), { allowRestored: true }) : source;
}
