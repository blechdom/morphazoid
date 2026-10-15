import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';

const path = 'src/families/simd-resonator/simd-resonator-presets.js';
const row = `copy+require\t${path}\n`;
const before = 'copy+require\tsrc/families/simd-resonator/simd-resonator-app.js\ncopy+require\tsrc/simd-resonator.js\n';
export const simdResonatorRuntimeChange = Object.freeze({
  baseCommit: '85d6ab3b75ec725b79e43f8a8468fd90e51fac14',
  file: 'scripts/site/runtime-files.tsv',
  sha256: 'b94f6811c1632e20b9c5379f49ac4cbf1e72c3fe1da44398e4137921195d76e7',
  path, row, before, after: before.replace('copy+require\tsrc/simd-resonator.js\n', `${row}copy+require\tsrc/simd-resonator.js\n`),
});

/** Peel only this uniquely placed preset module, preserving older fixture hashes. */
export function restoreSimdResonatorRuntime(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  const change = simdResonatorRuntimeChange;
  if (typeof source !== 'string' || file !== change.file) return source;
  // Recognize the path independently of its policy so altered policies fail.
  const count = source.split(change.path).length - 1;
  if (allowRestored && count === 0) return source;
  const error = `${file}: exact SIMD Resonator preset runtime addition`;
  assert.equal(count, 1, error);
  assert.equal(source.split(change.after).length - 1, 1, error);
  return source.replace(change.after, change.before);
}

export async function readSimdResonatorRuntimeReference(file, encoding) {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { relative } = await import('node:path');
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreSimdResonatorRuntime(source, relative(root, file instanceof URL ? fileURLToPath(file) : file));
}
