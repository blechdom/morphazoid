import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreTrackazoidPadsSite } from './trackazoid-pads-site-reference.mjs';

export const fractalImpulseRuntimeChanges = JSON.parse(readFileSync(
  new URL('../fixtures/fractal-delay-impulse-runtime-addition.json', import.meta.url), 'utf8',
));

/** Peel only exact reviewed additions; unknown or altered bytes remain visible. */
export function restoreFractalImpulseRuntime(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreTrackazoidPadsSite(source, file, { allowRestored: true });
  for (const { addition } of fractalImpulseRuntimeChanges.changes.filter(change => change.file === file)) {
    const count = source.split(addition).length - 1;
    if (allowRestored && count === 0) continue;
    assert.equal(count, 1, `${file}: exact Fractal Delay impulse runtime addition`);
    source = source.replace(addition, '');
  }
  return source;
}

/** Read current files through only this new amendment before older proofs. */
export async function readFractalImpulseRuntimeReference(file, encoding) {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { relative } = await import('node:path');
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const path = relative(root, file instanceof URL ? fileURLToPath(file) : file);
  return restoreFractalImpulseRuntime(restoreTrackazoidPadsSite(source, path), path);
}
