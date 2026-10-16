import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const blechSpigotRuntimeChange = JSON.parse(readFileSync(
  new URL('../fixtures/blech-spigot-runtime-addition.json', import.meta.url), 'utf8',
));

/** Peel only the reviewed spigot paths; leave unrelated runtime drift visible. */
export function restoreBlechSpigotRuntime(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  const change = blechSpigotRuntimeChange;
  if (typeof source !== 'string' || file !== change.file) return source;
  const markers = ['# BLECH MIDI live spigots and direct canvas performance.', ...change.paths];
  const counts = markers.map(marker => source.split(marker).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact BLECH MIDI spigot runtime addition`;
  for (const count of counts) assert.equal(count, 1, error);
  assert.equal(source.split(change.after).length - 1, 1, error);
  return source.replace(change.after, change.before);
}
