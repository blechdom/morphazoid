import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const nativeDelaySiteChanges = JSON.parse(readFileSync(new URL('../../docs/l-system-delay-site-runtime-changes.json', import.meta.url), 'utf8'));
export function restoreNativeDelaySite(source, file) {
  for (const change of nativeDelaySiteChanges.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact native delay site amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
