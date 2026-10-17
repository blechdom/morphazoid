import { restoreRoachPerformance } from './roach-synth-performance-reference.mjs';
import { restoreGraphonicCalculatorDrumsSite } from './graphonic-calculator-drums-site-reference.mjs';
import assert from 'node:assert/strict';

const prefix = 'src/instruments/striped-staircase-rust/';
const paths = Object.freeze(['spiral-studies.js', 'contour-paths.js', 'renderer.js'].map(name => prefix + name));
const worker = `copy+require\t${prefix}worker.js\n`;
const styles = `copy+require\t${prefix}studies.css\n`;
const addition = paths.map(path => `copy+require\t${path}\n`).join('');

export const staircaseSpiralRuntimeChange = Object.freeze({
  file: 'scripts/site/runtime-files.tsv', paths, addition,
  before: worker + styles,
  after: worker + addition + styles,
});

/** Peel this exact later addition only for a historical manifest digest.
 * Do not add this to the shared restoration chain: Staircase's own packaging
 * guard deliberately requires all three modules in its current stanza.
 */
export function restoreStaircaseSpiralRuntime(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  const change = staircaseSpiralRuntimeChange;
  if (typeof source !== 'string' || file !== change.file) return source;
  const counts = change.paths.map(path => source.split(path).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact Staircase spiral runtime addition`;
  for (const count of counts) assert.equal(count, 1, error);
  assert.equal(source.split(change.after).length - 1, 1, error);
  return source.replace(change.after, change.before);
}
