import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreBlechWorkspaceRuntime } from './blech-workspace-runtime-reference.mjs';

export const soundFontsSharedChanges = JSON.parse(readFileSync(
  new URL('../fixtures/sound-fonts-shared-amendments.json', import.meta.url), 'utf8',
));

/** Peel the exact shared-bank registration and notices before older evidence. */
export function restoreSoundFontsShared(source, file, { allowRestored = false } = {}) {
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  if (typeof source !== 'string') return source;
  source = restoreBlechWorkspaceRuntime(source, file, { allowRestored: true });
  for (const change of soundFontsSharedChanges.changes.filter(change => change.file === file)) {
    const count = source.split(change.addition).length - 1;
    const markerCounts = change.markers.map(marker => source.split(marker).length - 1);
    // Historical chains may reach already-restored text. Any recognized
    // fragment still requires the complete and uniquely placed reviewed block.
    if (allowRestored && count === 0 && markerCounts.every(value => value === 0)) continue;
    const error = `${file}: exact shared Sound Fonts amendment`;
    assert.equal(count, 1, error);
    for (const markerCount of markerCounts) assert.equal(markerCount, 1, error);
    source = source.replace(change.addition, '');
  }
  return source;
}
