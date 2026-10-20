import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const rezoidinatorRustDspSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/rezoidinator-rust-dsp-site-amendments.json', import.meta.url), 'utf8'));

// Reverse only this reviewed capacity/runtime amendment. Unknown changes survive;
// partial additions, duplicated adapters and altered copy policy remain failures.
export function restoreRezoidinatorRustDspSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  const change = rezoidinatorRustDspSiteChanges.changes.find(item => item.file === file);
  if (!change) return source;
  const count = text => source.split(text).length - 1;
  const error = `${file}: exact Rezoidinator Rust DSP amendment`;
  if (allowRestored && change.markers.every(marker => count(marker) === 0)) return source;
  for (const marker of change.markers) assert.equal(count(marker), 1, error);
  for (const { before, after } of [...change.replacements].reverse()) {
    assert.equal(count(before), 0, error); assert.equal(count(after), 1, error);
    source = source.replace(after, () => before);
  }
  return source;
}
