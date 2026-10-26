import test from 'node:test';
import assert from 'node:assert/strict';
import { WITCH_DEFAULTS, WITCH_PRESETS, normalizeWitchPreset, randomizeWitchPreset } from '../src/instruments/witch/witch-presets.js';
import { validateFullPresetBank } from '../src/site/header-presets.js';

test('every complete Witch scene survives recall without bringing transport or output state',()=>{
  validateFullPresetBank(WITCH_PRESETS);
  for(const {snapshot} of WITCH_PRESETS) {
    assert.deepEqual(normalizeWitchPreset(snapshot),snapshot);
    assert.equal('volume' in snapshot,false);assert.equal('gate' in snapshot,false);assert.equal('playing' in snapshot,false);
    const recalled=normalizeWitchPreset(snapshot);recalled.fingers[0]=.123;
    assert.notEqual(recalled.fingers[0],snapshot.fingers[0]);
  }
});

test('randomization reaches every scene, character, direction and continuous musical parameter within bounds',()=>{
  let seed=42;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const scenes=Array.from({length:150},()=>randomizeWitchPreset(WITCH_DEFAULTS,random));
  assert.equal(new Set(scenes.map(s=>s.scene)).size,3);
  assert.equal(new Set(scenes.map(s=>s.voice)).size,5);
  assert.equal(new Set(scenes.map(s=>s.direction)).size,2);
  assert.equal(new Set(scenes.map(s=>s.spoonAuto)).size,2);
  for(const key of ['speed','radius','glass','hair','altitude','flightX','tone','nose','hat','spoonHeight']) {
    assert.ok(new Set(scenes.map(s=>s[key])).size>100,key);
    assert.ok(scenes.every(s=>s[key]>=0&&s[key]<=1),key);
  }
  for(let i=0;i<5;i++) assert.ok(new Set(scenes.map(s=>s.fingers[i])).size>100,`finger ${i}`);
});
