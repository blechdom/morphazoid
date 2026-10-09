import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreAmInstrumentAdditions } from './am-instruments-reference.mjs';

export const midiphoriaSiteAdditions = JSON.parse(readFileSync(new URL('../fixtures/midiphoria-site-additions.json', import.meta.url), 'utf8'));

// Peel only the exact new lab records; retain every earlier catalogue byte.
export function restoreMidiphoriaSite(source, file, { allowRestored = false } = {}) {
  source = restoreAmInstrumentAdditions(source, file, { allowRestored: true });
  for (const change of midiphoriaSiteAdditions.filter(change => change.file === file)) {
    // Historical reader layers may call this twice. Partial or duplicated
    // additions still fail; direct new-page checks always require every record.
    if (allowRestored && change.additions.every(addition => !source.includes(addition))) continue;
    for (const addition of change.additions) {
      assert.equal(source.split(addition).length - 1, 1, `${file}: exact Midiphoria addition`);
      source = source.replace(addition, '');
    }
  }
  return source;
}
