import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const midiNoteEffectsRuntimeChange = JSON.parse(readFileSync(
  new URL('../fixtures/midi-note-effects-runtime-addition.json', import.meta.url), 'utf8',
));

/** Remove only the three reviewed note-effects runtime rows before older guards. */
export function restoreMidiNoteEffectsRuntime(source, file, { allowRestored = false } = {}) {
  const change = midiNoteEffectsRuntimeChange;
  if (typeof source !== 'string' || file !== change.file) return source;
  const counts = change.rows.map(row => source.split(row).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact MIDI note effects runtime addition`;
  for (const count of counts) assert.equal(count, 1, error);
  assert.equal(source.split(change.addition).length - 1, 1, error);
  return source.replace(change.addition, '');
}

export async function readMidiNoteEffectsRuntimeReference(file, encoding) {
  const source = await readFile(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreMidiNoteEffectsRuntime(source,
    relative(root, file instanceof URL ? fileURLToPath(file) : file), { allowRestored: true });
}
