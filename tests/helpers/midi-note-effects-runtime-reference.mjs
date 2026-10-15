import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { restoreBlechLiveRuntime } from './blech-live-runtime-reference.mjs';
import { readFileSync } from 'node:fs';
import { readFractalImpulseRuntimeReference as readFile } from './fractal-delay-impulse-runtime-reference.mjs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const midiNoteEffectsRuntimeChange = JSON.parse(readFileSync(
  new URL('../fixtures/midi-note-effects-runtime-addition.json', import.meta.url), 'utf8',
));

/** Remove only the three reviewed note-effects runtime rows before older guards. */
export function restoreMidiNoteEffectsRuntime(source, file, { allowRestored = false } = {}) {
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
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
  const relativeFile = relative(root, file instanceof URL ? fileURLToPath(file) : file);
  return restoreMidiNoteEffectsRuntime(
    restoreBlechLiveRuntime(source, relativeFile, { allowRestored: true }), relativeFile, { allowRestored: true });
}
