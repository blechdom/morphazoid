import { restoreMobileMenubar } from './mobile-menubar-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const rezoidinatorModesSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/rezoidinator-modes-site-amendments.json', import.meta.url), 'utf8',
));

/** Peel the exact excitation/processing runtime addition before older proofs. */
export function restoreRezoidinatorModesSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreMobileMenubar(source, file, { allowRestored: true });
  const change = rezoidinatorModesSiteChanges.changes.find(item => item.file === file);
  if (!change) return source;
  const count = source.split(change.marker).length - 1;
  if (allowRestored && count === 0) return source;
  const error = `${file}: exact Rezoidinator modes site amendment`;
  assert.equal(count, 1, error);
  for (const { before, after } of [...change.replacements].reverse()) {
    assert.equal(source.split(before).length - 1, 0, error);
    assert.equal(source.split(after).length - 1, 1, error);
    source = source.replace(after, () => before);
  }
  return source;
}
