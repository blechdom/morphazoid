import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const soundFontsSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/sound-fonts-site-amendments.json', import.meta.url), 'utf8',
));

/** Remove only the exact Sound Fonts additions before older captured evidence. */
export function restoreSoundFontsSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  for (const { addition } of soundFontsSiteChanges.changes.filter(change => change.file === file)) {
    const count = source.split(addition).length - 1;
    // Optional historical passes may see already restored bytes. A partial or
    // changed block remains untouched, so the older hash guard still catches it.
    if (allowRestored && count === 0) continue;
    assert.equal(count, 1, `${file}: exact Sound Fonts site amendment`);
    source = source.replace(addition, '');
  }
  return source;
}
