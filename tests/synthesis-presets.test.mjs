import test from 'node:test';
import assert from 'node:assert/strict';
import { METHODS, createDefaultState, sanitizeState } from '../src/instruments/synthesis/catalog.js';
import { METHOD_MENU_ORDER, SYNTHESAURUS_FULL_PRESETS, SECTION_METHODS, SECTION_PRESETS, methodSection, captureSoundState, randomizeAllState, randomizeMethodState } from '../src/instruments/synthesis/presets.js';
import { validateFullPresetBank } from '../src/site/header-presets.js';

test('the shared Synthesaurus bank contains every full factory sound in grouped menu order',()=>{
  validateFullPresetBank(SYNTHESAURUS_FULL_PRESETS);
  const groups=[...new Set(METHODS.map(m=>m.group))];
  const order=groups.flatMap(group=>METHODS.filter(m=>m.group===group));
  assert.deepEqual(METHOD_MENU_ORDER,order);
  assert.deepEqual(SYNTHESAURUS_FULL_PRESETS.map(p=>p.id),order.flatMap(m=>m.presets.map(p=>`${m.id}:${p.id}`)));
  for(const preset of SYNTHESAURUS_FULL_PRESETS){
    const captured=captureSoundState({...preset.snapshot,outputLevel:.18,voiceMode:'poly',tuningId:'edo-6-whole-tone',arpMode:'up-down'});
    assert.deepEqual(captured,preset.snapshot);
    assert.ok(!Object.hasOwn(captured,'arpMode'));
    assert.ok(!Object.hasOwn(preset.snapshot,'outputLevel'));
    assert.ok(!Object.hasOwn(preset.snapshot,'voiceMode'));
    assert.ok(!Object.hasOwn(preset.snapshot,'tuningId'));
    assert.ok(!Object.hasOwn(preset.snapshot,'arpMode'));
  }
});

test('section banks partition every preset and keep grouped method order',()=>{
  for (const section of ['synthesis','processing']) {
    validateFullPresetBank(SECTION_PRESETS[section]);
    assert.deepEqual(SECTION_METHODS[section],METHOD_MENU_ORDER.filter(m=>methodSection(m.id)===section));
    assert.deepEqual(SECTION_PRESETS[section].map(p=>p.id), SECTION_METHODS[section].flatMap(m=>m.presets.map(p=>m.id+':'+p.id)));
  }
  assert.equal(SECTION_PRESETS.synthesis.length,424);
  assert.equal(SECTION_PRESETS.processing.length,128);
  assert.equal(new Set(Object.values(SECTION_PRESETS).flat().map(p=>p.id)).size,SYNTHESAURUS_FULL_PRESETS.length);
});

for (const section of ['synthesis','processing']) test(section+' dice reaches every method in its section and preserves performer choices',()=>{
  const methods=SECTION_METHODS[section];
  const current={...createDefaultState(methods[0].id),outputLevel:.18,voiceMode:'poly',tuningId:'edo-6-whole-tone',arpMode:'up-down'};
  const original=structuredClone(current);
  for(let index=0;index<methods.length;index++){
    let draws=0;
    const random=()=>draws++===0?(index+.5)/methods.length:((draws*37)%101)/100;
    const sound=randomizeAllState(current,random),method=methods[index];
    assert.equal(sound.methodId,method.id);
    assert.equal(sound.presetId,'custom');
    assert.equal(sound.outputLevel,.18);
    assert.equal(sound.voiceMode,'poly');
    assert.equal(sound.tuningId,'edo-6-whole-tone');
    assert.ok(!Object.hasOwn(sound,'arpMode'));
    assert.deepEqual(sound,sanitizeState(sound));
    assert.ok(!method.presets.some(p=>JSON.stringify(p.params)===JSON.stringify(sound.params)));
    assert.notDeepEqual(sound.envelope,method.presets[0].envelope);
  }
  assert.deepEqual(current,original,'input state is never mutated');
  assert.equal(randomizeAllState(current,()=>1).methodId,methods.at(-1).id);
  assert.equal(randomizeAllState(current,()=>NaN).methodId,methods[0].id);
});

test('processing dice retains explicitly chosen external input across all processors',()=>{
  const source={...createDefaultState('fx-delay'),source:0};
  for(let index=0;index<SECTION_METHODS.processing.length;index++){
    let draws=0;
    const result=randomizeAllState(source,()=>draws++===0?(index+.5)/SECTION_METHODS.processing.length:.5);
    assert.equal(result.methodId,SECTION_METHODS.processing[index].id);
    assert.equal(result.source,0);
  }
});

test('current-method randomization includes processing mix and gains while retaining an external input',()=>{
  const source={...createDefaultState('fx-delay'),outputLevel:.22,voiceMode:'poly',tuningId:'edo-6-whole-tone',arpMode:'down'};
  const samples=[.1,.3,.5,.7,.9].map(value=>randomizeMethodState(source,()=>value));
  for(const key of ['source','wet','inputDb','outputDb']) assert.ok(new Set(samples.map(s=>s[key])).size>1,key);
  for(const sample of samples){
    assert.equal(sample.methodId,source.methodId);
    assert.equal(sample.outputLevel,.22);assert.equal(sample.voiceMode,'poly');
    assert.equal(sample.tuningId,'edo-6-whole-tone');assert.ok(!Object.hasOwn(sample,'arpMode'));
    assert.deepEqual(sample,sanitizeState(sample));
  }
  assert.equal(randomizeMethodState({...source,source:0},()=>.9).source,0);
  assert.notEqual(randomizeMethodState(source,()=>0).bypass,randomizeMethodState(source,()=>1).bypass);
});
