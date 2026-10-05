import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createSinsy, synthesizeSinsy, validateSinsyOutput } from '../src/families/speech/sinsy-runtime.js';
import { sinsyScoreToMusicXml } from '../src/families/speech/sinsy-score.js';
import { SINSY_PRESETS } from '../src/families/speech/sinsy-presets.js';

test('Sinsy safety detects both asymmetric native clipping endpoints without rejecting ordinary peaks', () => {
  for (const endpoint of [-1, 32767 / 32768]) {
    const samples = new Float32Array(4800);
    samples.fill(endpoint, 0, 960);
    assert.throws(() => validateSinsyOutput(samples, 48000), /sustained clipping/);
    samples.fill(0); samples[123] = endpoint;
    assert.doesNotThrow(() => validateSinsyOutput(samples, 48000));
    for (let i = 0; i < samples.length; i += 2) samples[i] = endpoint;
    assert.throws(() => validateSinsyOutput(samples, 48000), /sustained clipping/);
  }
  for (const value of [NaN, Infinity, 1.01, -1.01]) {
    assert.throws(() => validateSinsyOutput(new Float32Array([value]), 48000), /invalid PCM/);
  }
});

test('real Sinsy rejects unstable in-range knobs and renders the next good phrase without reload', { timeout: 30000 }, async () => {
  const module = await createSinsy({
    locateFile: name => fileURLToPath(new URL('../vendor/sinsy/' + name, import.meta.url)),
    wasmBinary: await fs.readFile(new URL('../vendor/sinsy/sinsy.wasm', import.meta.url)),
  });
  const xml = sinsyScoreToMusicXml({ tempo: 180, notes: [
    { midi: 60, beats: 1, lyric: 'あ' }, { midi: 64, beats: 1, lyric: 'い' }, { midi: 67, beats: 1, lyric: 'う' },
  ] });
  try {
    const good = synthesizeSinsy(module, xml);
    assert.ok(good.samples.some(value => Math.abs(value) > .01));
    for (const values of [{ alpha: .9 }, { gvWeight: 5 }, { alpha: .9, volumeDb: -80 }, { gvWeight: 5, volumeDb: -80 }]) {
      assert.throws(() => synthesizeSinsy(module, xml, values), /sustained clipping/, JSON.stringify(values));
      assert.deepEqual(synthesizeSinsy(module, xml).samples, good.samples);
    }
    const coarse = synthesizeSinsy(module, xml, { speed: .1 });
    assert.equal(coarse.timingUnavailable, true);
    assert.deepEqual(coarse.noteTimings, []);
    assert.match(coarse.timingWarning, /Increase frame density/);
    assert.equal(synthesizeSinsy(module, xml).timingUnavailable, undefined, 'native warnings do not leak into the next render');
    for (const preset of SINSY_PRESETS) {
      assert.doesNotThrow(() => synthesizeSinsy(module, sinsyScoreToMusicXml(preset.score), preset.values), preset.label);
    }
  } finally { module._sinsy_close(); }
});
