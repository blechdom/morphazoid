import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_METHODS, presets } from '../src/instruments/voicesaurus/native-model.js';
import { instrumentMidiCapabilityForId } from '../src/site/instrument-midi-capabilities.js';
import { TOOL_GROUPS } from '../src/site/instrument-registry.js';

test('Voicesaurus covers every playable voice with mechanism, milestone and source',()=>{
  for(const method of Object.values(NATIVE_METHODS)){
    assert(method.family.length>5);assert(method.detail.length>35);assert.match(method.date,/\d{4}/);
    assert(method.history.length>35);assert.equal(new URL(method.source).protocol,'https:');
  }
  assert.deepEqual(TOOL_GROUPS.filter(g=>g.tools.some(t=>t.id==='voicesaurus')).map(g=>g.id),['voice']);
  const capability=instrumentMidiCapabilityForId('voicesaurus');
  assert.equal(capability.computerKeyboardMode,'page');assert.equal(capability.audioInput,false);
});

test('method menu and preset tour follow the displayed historical milestone',()=>{
  const years=Object.values(NATIVE_METHODS).map(method=>method.year);
  assert.deepEqual(years,[...years].sort((a,b)=>a-b));
  for(const method of Object.values(NATIVE_METHODS))assert.equal(method.year,Number(method.date.match(/\d{4}/)[0]));
  const tour=presets.map(p=>NATIVE_METHODS[p.snapshot.engine].year);
  assert.deepEqual(tour,[...tour].sort((a,b)=>a-b));
});
