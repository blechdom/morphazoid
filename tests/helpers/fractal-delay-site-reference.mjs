import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readVectorFractalsSiteReference as readFileAsync } from './vector-fractals-site-reference.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreAudioInput } from './audio-input-reference.mjs';
import { restoreBorrowedAudioContext } from './borrowed-audio-context-reference.mjs';
import { restoreSharedInstrumentContext } from './shared-instrument-context-reference.mjs';
import { restoreNativeDelaySite } from './native-delay-site-reference.mjs';
import { restoreMainOutputRouting } from './main-output-routing-reference.mjs';
import { restoreLSystemLabSite } from './l-system-labs-site-reference.mjs';
import { restoreOutputRecording } from './output-recording-reference.mjs';
import { restoreGraphDelayRustSite } from './graph-delay-rust-site-reference.mjs';
import { restoreFractalDelayFaves } from './fractal-delay-faves-reference.mjs';

export const fractalDelaySiteChanges = JSON.parse(readFileSync(
  new URL('./fractal-delay-site-amendments.json', import.meta.url), 'utf8',
));

/** Peel the later Graph Delay Rust merge, then the exact Fractal registration. Historical hashes
 * and their original negative guards remain authoritative for all other bytes.
 */
export function restoreFractalDelaySite(source, file) {
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreFractalDelayFaves(source, file, { allowRestored: true });
  source = restoreGraphDelayRustSite(source, file, { allowRestored: true });
  for (const change of fractalDelaySiteChanges.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1,
        `${file}: exact Fractal Delay site amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}

/** Peel the newest site addition before the frozen historical input chain. */
export async function readFractalDelaySiteReference(file, encoding) {
  let source = await readFileAsync(file, encoding);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const relative = path.relative(root, file instanceof URL ? fileURLToPath(file) : file);
  if (typeof source !== 'string') return source;
  source = restoreFractalDelaySite(source, relative);
  source = restoreBorrowedAudioContext(restoreSharedInstrumentContext(source, relative), relative);
  if (relative !== 'nav.js') source = restoreOutputRecording(source, relative);
  source = restoreMainOutputRouting(source, relative);
  source = restoreLSystemLabSite(source, relative);
  source = restoreNativeDelaySite(source, relative);
  return restoreAudioInput(source, relative);
}
