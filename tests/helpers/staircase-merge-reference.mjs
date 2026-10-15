import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreStaircaseSite } from './staircase-site-reference.mjs';
import { restoreRustResonatorSite } from './simd-resonator-rust-site-reference.mjs';
import { restoreProcessorSamplesSite } from './processor-samples-site-reference.mjs';

/** The independent main merge preserves each branch's original byte evidence.
 * Keep these exact Rust build additions separate from the frozen Staircase
 * fixture; unknown package edits still reach its original hash assertion.
 */
export function restoreStaircaseConcurrentMain(source, file) {
  if (typeof source !== 'string') return source;
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreProcessorSamplesSite(restoreRustResonatorSite(source, file, { allowRestored: true }), file, { allowRestored: true });
  if (file === 'package.json') {
    const rows = '    "build:rust-resonator-wasm": "node scripts/build-rust-resonator-wasm.mjs",\n'
      + '    "check:rust-resonator-wasm": "node scripts/build-rust-resonator-wasm.mjs --check",\n';
    const check = ' && npm run check:rust-resonator-wasm';
    assert.equal(source.split(rows).length - 1, 1, 'exact independent Rust Resonator build scripts');
    assert.equal(source.split(check).length - 1, 1, 'exact independent Rust Resonator check');
    source = source.replace(rows, '').replace(check, '');
  }
  return source;
}

export async function readStaircaseConcurrentReference(file, encoding) {
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreStaircaseConcurrentMain(source, relative(root, file instanceof URL ? fileURLToPath(file) : file));
}

export async function readMergedStaircaseSiteReference(file, encoding) {
  const source = await readStaircaseConcurrentReference(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreStaircaseSite(source, relative(root, file instanceof URL ? fileURLToPath(file) : file), { allowRestored: true });
}
