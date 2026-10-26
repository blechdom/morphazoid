import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const witchesBrewFavesAmendment = JSON.parse(readFileSync(
  new URL('../fixtures/witches-brew-faves-amendment.json', import.meta.url), 'utf8',
));

/** Reverse the complete promotion before peeling the original Witch addition. */
export function restoreWitchesBrewFaves(source, file, { allowRestored = false } = {}) {
  const change = witchesBrewFavesAmendment;
  if (typeof source !== 'string' || file !== change.file) return source;
  if (allowRestored && !source.includes(change.replacements[0].after)) return source;
  for (const { before, after } of [...change.replacements].reverse()) {
    assert.equal(source.split(after).length - 1, 1, `${file}: exact Witches Brew Faves amendment`);
    source = source.replace(after, () => before);
  }
  return source;
}
