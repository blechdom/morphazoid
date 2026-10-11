import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const midiMixerRuntimeChanges = JSON.parse(readFileSync(
  new URL('../fixtures/midi-mixer-runtime-addition.json', import.meta.url), 'utf8',
));

/** Remove only the embedded mixer's reviewed runtime rows and tempo target. */
export function restoreMidiMixerRuntime(source, file, { allowRestored = false } = {}) {
  for (const { addition } of midiMixerRuntimeChanges.changes.filter(change => change.file === file)) {
    if (allowRestored && !source.includes(addition)) continue;
    assert.equal(source.split(addition).length - 1, 1, `${file}: exact MIDI Mixer runtime addition`);
    source = source.replace(addition, '');
  }
  return source;
}
