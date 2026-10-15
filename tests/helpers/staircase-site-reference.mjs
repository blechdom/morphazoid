import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const staircaseSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/staircase-site-amendments.json', import.meta.url), 'utf8',
));

/** Peel only the reviewed staircase addition before historical byte proofs.
 * Unknown rows and edits remain visible; partially present additions fail.
 */
export function restoreStaircaseSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  const change = staircaseSiteChanges.changes.find(item => item.file === file);
  if (!change) return source;
  const marker = /striped-staircase-rust|staircase-wasm|staircase\.wasm|staircase-build\.json|staircase-studies\.md/;
  if (allowRestored && !marker.test(source)) return source;
  // Both independent instruments extend the same check command. Recognize
  // this exact merged variant, peel Staircase, then retain the Rust check.
  const rustCheck = ' && npm run check:rust-resonator-wasm';
  const mergedCheck = file === 'package.json' && source.includes(rustCheck);
  if (mergedCheck) {
    assert.equal(source.split(rustCheck).length - 1, 1, `${file}: exact independent Rust Resonator check`);
    source = source.replace(rustCheck, '');
  }
  for (const { before, after } of [...change.replacements].reverse()) {
    assert.equal(source.split(after).length - 1, 1, `${file}: exact Staircase Studies site amendment`);
    source = source.replace(after, before);
  }
  if (mergedCheck) source = source.replace(' && npm run check:simd-wasm', ` && npm run check:simd-wasm${rustCheck}`);
  return source;
}

export async function readStaircaseSiteReference(file, encoding) {
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreStaircaseSite(source, relative(root, file instanceof URL ? fileURLToPath(file) : file), { allowRestored: true });
}
