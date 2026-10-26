import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';
import { WITCH_DROP_EFFECTS } from '../src/instruments/witch/witch-model.js';
import { RoachPercussion } from '../src/instruments/roach-synth/roach-synth-percussion.js';
import { RoachZing } from '../src/instruments/roach-synth/roach-synth-textures.js';
import { SpiderStrings } from '../src/instruments/spider-synth/spider-synth-string.js';

const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
function render(dsp, seconds, block = 128) {
  const data = new Float32Array(Math.round(seconds * dsp.rate));
  for (let offset = 0; offset < data.length; offset += block) dsp.process(data.subarray(offset, Math.min(data.length, offset + block)));
  return data;
}

test('every potion ingredient speaks alone without transport and finishes at low and normal sample rates', () => {
  assert.deepEqual(WITCH_DROP_EFFECTS.map(kind => kind.slice(5)).sort(),
    ['gesticules', 'marimba', 'choir', 'glass', 'tail', 'earwax', 'eyeball', 'newt', 'hair', 'roach', 'spider', 'oculoid', 'rubix', 'hiccup'].sort());
  for (const rate of [8000, 48000]) for (const kind of WITCH_DROP_EFFECTS) {
    const dsp = new WitchDSP(rate); dsp.setEnabled(true);
    assert.equal(dsp.controls.gate, false); assert.equal(dsp.trigger(kind), true);
    const sound = render(dsp, .8);
    assert.ok(rms(sound) > .006, `${kind} speaks at ${rate}`);
    assert.ok(sound.every(value => Number.isFinite(value) && Math.abs(value) <= .54));
    render(dsp, 5.5);
    assert.ok(rms(render(dsp, .1)) < 1e-6, `${kind} releases at ${rate}`);
    assert.equal(dsp.visual.dropKind, '');
  }
});

test('the complete miniature palette shares exact sample-clock timing and bounded reusable engines', () => {
  const a = new WitchDSP(24000), b = new WitchDSP(24000);
  for (const dsp of [a, b]) {
    dsp.setControls({ gate: true, mode: 'flight', speed: .6 }); dsp.setEnabled(true);
    for (const kind of WITCH_DROP_EFFECTS) assert.equal(dsp.trigger(kind), true);
  }
  assert.deepEqual(render(a, 1), render(b, 1, 24000));
  assert.ok(a.drops.tastes.roach instanceof RoachPercussion);
  assert.ok(a.drops.tastes.zing instanceof RoachZing);
  assert.ok(a.drops.tastes.spider instanceof SpiderStrings);
  const slots = a.drops.slots.slice(), strings = a.drops.tastes.spider.voices.slice();
  for (let i = 0; i < 250; i++) a.trigger(WITCH_DROP_EFFECTS[i % WITCH_DROP_EFFECTS.length]);
  assert.ok(a.drops.slots.every((slot, index) => slot === slots[index]));
  assert.ok(a.drops.tastes.spider.voices.every((voice, index) => voice === strings[index]));
  a.setEnabled(false); render(a, 2);
  assert.ok(rms(render(a, .1)) < 1e-6);
});

test('retriggering each new miniature crossfades from its previous sample', () => {
  for (const kind of WITCH_DROP_EFFECTS.slice(3)) {
    const dsp = new WitchDSP(24000); dsp.setEnabled(true); dsp.trigger(kind);
    const left = new Float32Array(128), right = new Float32Array(128);
    for (let i = 0; i < 40; i++) dsp.drops.process(left, right);
    const lastLeft = left.at(-1), lastRight = right.at(-1);
    dsp.trigger(kind);
    dsp.drops.process(left.subarray(0, 1), right.subarray(0, 1));
    assert.ok(Math.abs(left[0] - lastLeft) < .001, `${kind} left retrigger edge`);
    assert.ok(Math.abs(right[0] - lastRight) < .001, `${kind} right retrigger edge`);
  }
});
