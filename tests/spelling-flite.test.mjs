import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderFliteAtlas } from '../src/families/speech/flite-atlas.js';
import { synthesizeFlite } from '../src/families/speech/flite-runtime.js';
import { SPELLING_DIPHONE_CLIPS } from '../src/instruments/spelling-synthesizer/spelling-diphone-atlas.js';

const bytes = await readFile(new URL('../vendor/flite/flite.wasm', import.meta.url));
assert.equal(bytes.subarray(0,4).toString('hex'), '0061736d');
const module = await WebAssembly.compile(bytes);
for (const voice of ['slt', 'awb', 'rms']) {
  test(`Flite ${voice}: real WASM produces every phone and playable vowel loops`, () => {
    const atlas = renderFliteAtlas(module, { voice, metadata:SPELLING_DIPHONE_CLIPS });
    assert.deepEqual(Object.keys(atlas.clips), Object.keys(SPELLING_DIPHONE_CLIPS));
    assert.equal(atlas.sampleRate,16000);
    assert(atlas.samples.every(value => Number.isFinite(value) && Math.abs(value)<=1));
    for (const [key,clip] of Object.entries(atlas.clips)) {
      const start=Math.round(clip.offset*atlas.sampleRate), end=Math.round((clip.offset+clip.duration)*atlas.sampleRate);
      const pcm=atlas.samples.subarray(start,end);
      assert(clip.duration>.02 && clip.duration<1, `${key}: bounded duration`);
      assert(pcm.some(value=>Math.abs(value)>.005), `${key}: audible samples`);
      if(clip.kind==='vowel') {
        const a=Math.round(clip.sustainStart*atlas.sampleRate),b=Math.round(clip.sustainEnd*atlas.sampleRate);
        assert(a>0 && b>a && b<pcm.length, `${key}: interior loop`);
        // Compare with the voice's own steep sample transition; high vowels can
        // have large ordinary slopes without a discontinuity at the loop.
        const join = pcm[a]-pcm[b-1], natural = pcm[b]-pcm[b-1];
        assert(Math.abs(join-natural)<.035, `${key}: loop adds little to the natural transition`);
      }
    }
  });
}
test('Flite full-text API keeps timed phonemes and bounds input controls',()=>{
  const voice=synthesizeFlite(module,{voice:'slt',text:'Hello voice.',rate:1});
  assert(voice.samples.length>voice.sampleRate*.2);
  assert(voice.events.length>3);
  assert(voice.events.every(event=>event.end>=event.start && Number.isFinite(event.end)));
  assert.throws(()=>synthesizeFlite(module,{text:'x'.repeat(1001)}));
  assert.throws(()=>synthesizeFlite(module,{voice:'missing'}));
});
