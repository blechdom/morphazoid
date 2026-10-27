import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fractalSignalsMidiAmendment as amendment, restoreFractalSignalsMidi } from './helpers/fractal-signals-midi-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');

test('the MIDI fix restores exact pre-fix Fractal source without weakening microphone history', async () => {
  assert.equal(amendment.baseCommit, 'c3e963753675fa5a23e9555001b24211ab7d2f02');
  assert.equal(amendment.file, 'src/instruments/fractal-signals/app.js');
  const { file, addition, sha256 } = amendment;
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const restored = restoreFractalSignalsMidi(source, file);
  assert.equal(digest(restored), sha256);
  assert.equal(restoreFractalSignalsMidi(restored, file, { allowRestored: true }), restored);
  assert.throws(() => restoreFractalSignalsMidi(restored, file), /exact Fractal Synthesis MIDI/);
  for (const options of [{}, { allowRestored: true }]) {
    assert.throws(() => restoreFractalSignalsMidi(source + addition, file, options), /exact Fractal Synthesis MIDI/);
  }
  const altered = source.replace(addition, addition.replace('channelPressure', 'pitchBend'));
  assert.throws(() => restoreFractalSignalsMidi(altered, file), /exact Fractal Synthesis MIDI/);
  assert.notEqual(digest(restoreFractalSignalsMidi(altered, file, { allowRestored: true })), sha256);
  const drift = '\n// unrelated drift\n';
  assert.equal(restoreFractalSignalsMidi(source + drift, file), restored + drift);
  assert.notEqual(digest(restored + drift), sha256);
  assert.equal(restoreFractalSignalsMidi(source, 'unrelated.js'), source);
  const binary = Buffer.from(source);
  assert.equal(restoreFractalSignalsMidi(binary, file), binary);
});
