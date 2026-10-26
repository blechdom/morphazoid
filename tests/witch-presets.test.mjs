import test from 'node:test';
import assert from 'node:assert/strict';
import { WITCH_DEFAULTS, WITCH_PRESETS, normalizeWitchPreset, randomizeWitchPreset, WITCH_PALETTES } from '../src/instruments/witch/witch-presets.js';
import { validateFullPresetBank } from '../src/site/header-presets.js';
import { WITCH_SHELF, WITCH_HAND_MOTIONS, WITCH_HAND_SOUNDS, WITCH_CAT_GAITS, witchHandConfig } from '../src/instruments/witch/witch-model.js';
import { instrumentById } from '../src/site/instrument-catalog.js';

test('every complete Witch scene survives recall without bringing transport or output state',()=>{
  validateFullPresetBank(WITCH_PRESETS);
  for(const {snapshot} of WITCH_PRESETS) {
    assert.deepEqual(normalizeWitchPreset(snapshot),snapshot);
    assert.equal('volume' in snapshot,false);assert.equal('gate' in snapshot,false);assert.equal('playing' in snapshot,false);
    assert.equal('ghostPhase' in snapshot,false);assert.equal('performanceTime' in snapshot,false);
    assert.ok(snapshot.ghostTempo>=36&&snapshot.ghostTempo<=180);
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
  assert.equal(new Set(scenes.map(s=>s.palette)).size,8);
  assert.equal(new Set(scenes.map(s=>s.trip)).size,4);
  for(const key of ['speed','radius','glass','hair','altitude','flightX','tone','nose','hat','spoonHeight','handDepth','fabricX','fabricY','trailPull','trailTwist']) {
    assert.ok(new Set(scenes.map(s=>s[key])).size>100,key);
    assert.ok(scenes.every(s=>s[key]>=0&&s[key]<=1),key);
  }
  for(let i=0;i<5;i++) assert.ok(new Set(scenes.map(s=>s.fingers[i])).size>100,`finger ${i}`);
  assert.ok(new Set(scenes.map(s=>s.ghostTempo)).size>40,'the ghost beat participates in full-state randomization');
  assert.ok(scenes.every(s=>s.ghostTempo>=36&&s.ghostTempo<=180));
  assert.equal(new Set(scenes.map(s=>s.handMotion)).size,WITCH_HAND_MOTIONS.length);
  assert.equal(new Set(scenes.map(s=>s.handSound)).size,WITCH_HAND_SOUNDS.length);
  assert.equal(new Set(scenes.map(s=>s.catGait)).size,WITCH_CAT_GAITS.length);
  for(const [key,low,high] of [['handRate',.25,6],['catSpeed',.5,2]]) {
    assert.ok(new Set(scenes.map(s=>s[key])).size>100,key);
    assert.ok(scenes.every(s=>s[key]>=low&&s[key]<=high));
  }
});

test('every shelf miniature is an actual catalogue icon and selects its own complete playable spell',()=>{
  assert.equal(WITCH_SHELF.length,18);
  assert.equal(WITCH_PRESETS.length,50);
  assert.equal(new Set(WITCH_SHELF.map(item=>item.instrumentId)).size,18);
  const sounds=new Set();
  for(const item of WITCH_SHELF) {
    const instrument=instrumentById(item.instrumentId);
    assert.ok(instrument,item.instrumentId);
    assert.equal(item.name,instrument.label);
    assert.equal(item.imageHref,instrument.imageHref);
    const preset=WITCH_PRESETS.find(preset=>preset.id===item.presetId);
    assert.ok(preset,item.id);
    sounds.add(JSON.stringify(witchHandConfig(preset.snapshot)));
    assert.equal('volume' in preset.snapshot,false);
    assert.equal('performanceTime' in preset.snapshot,false);
  }
  assert.equal(sounds.size,18,'each shelf spell changes the authored hand sound or articulation');
  assert.equal(new Set(WITCH_PRESETS.map(({snapshot:s})=>`${s.catGait}:${s.catSpeed}`)).size,50);
  assert.ok(WITCH_PRESETS.some(({snapshot:s})=>s.handRate>=5&&s.handDepth>=.8));
  assert.ok(WITCH_PRESETS.some(({snapshot:s})=>s.handRate<.6));
  for(const bank of WITCH_HAND_SOUNDS)assert.ok(bank.sources.every(source=>!['vowel','choir'].includes(source)),'finger banks keep instrumental identity');
});

test('ghost beat tempo recalls old presets safely and clamps malformed or extreme input',()=>{
  assert.equal(WITCH_DEFAULTS.ghostTempo,72);
  for(const value of [undefined,NaN,Infinity,'broken']) assert.equal(normalizeWitchPreset({ghostTempo:value}).ghostTempo,72);
  assert.equal(normalizeWitchPreset({ghostTempo:-100}).ghostTempo,36);
  assert.equal(normalizeWitchPreset({ghostTempo:1000}).ghostTempo,180);
  assert.equal(normalizeWitchPreset({ghostTempo:108}).ghostTempo,108);
});

test('the scene bank offers distinct complete spells across colors, distortion and performance focus',()=>{
  assert.ok(WITCH_PRESETS.length>=32);
  assert.equal(WITCH_PALETTES.length,8);
  assert.equal(new Set(WITCH_PRESETS.map(({snapshot})=>JSON.stringify(snapshot))).size,WITCH_PRESETS.length);
  assert.equal(new Set(WITCH_PRESETS.map(({snapshot})=>snapshot.palette)).size,8);
  assert.equal(new Set(WITCH_PRESETS.map(({snapshot})=>snapshot.trip)).size,4);
  for(const scene of ['brew','fingers','flight']) assert.ok(WITCH_PRESETS.filter(({snapshot})=>snapshot.scene===scene).length>=6);
  assert.equal(normalizeWitchPreset({}).palette,0);
  assert.equal(normalizeWitchPreset({trip:100,palette:-10}).trip,3);
  assert.equal(normalizeWitchPreset({trip:100,palette:-10}).palette,0);
  assert.equal(normalizeWitchPreset({trip:-1,palette:100}).palette,7);
  assert.deepEqual(normalizeWitchPreset(null),normalizeWitchPreset());
});
