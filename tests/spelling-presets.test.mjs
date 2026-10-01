import {SPELLING_NATIVE_ENGINES as EXTENDED_ENGINES, NATIVE_DEFAULTS} from '../src/families/speech/extended-engines.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {schema,presets,randomize} from '../src/instruments/spelling-synthesizer/full-presets.js';
import {TOOL_GROUPS} from '../src/site/instrument-registry.js';
import {instrumentById} from '../src/site/instrument-catalog.js';
import {presetStateKey} from '../src/site/header-presets.js';

test('Spelling is uniquely in Voice, with the original route and a native mouth icon',()=>{
  assert.deepEqual(TOOL_GROUPS.filter(g=>g.tools.some(t=>t.id==='spelling-synthesizer')).map(g=>g.id),['voice']);
  const tool=instrumentById('spelling-synthesizer');
  assert.equal(tool.href,'spelling-synthesizer.html');assert.equal(tool.status,null);
  assert.equal(tool.imageHref,'assets/instruments/spelling-synthesizer.webp');
  assert.match(readFileSync(new URL('../artwork/spelling-synthesizer.svg',import.meta.url),'utf8'),/wireframe mouth speaking A/);
  const icon=readFileSync(new URL('../assets/instruments/spelling-synthesizer.webp',import.meta.url));
  assert.equal(icon.toString('ascii',8,12),'WEBP');
});
test('all Spelling scenes and seeded random states are complete, bounded and independent of live transport',()=>{
  assert.equal(presets.length,37+Object.values(EXTENDED_ENGINES).reduce((n,voice)=>n+voice.examples.length,0));assert.ok(Object.isFrozen(presets));
  const keys=new Set(presets.map(p=>presetStateKey(schema.validate(p.snapshot))));assert.equal(keys.size,presets.length);
  let seed=4415;const rng=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
  const original=presetStateKey(presets[0].snapshot),seen=new Map(schema.keys.map(k=>[k,new Set()]));
  for(let i=0;i<120;i++){
    const state=randomize(presets[0].snapshot,rng);schema.validate(state);assert.ok(!keys.has(presetStateKey(state)));
    for(const key of schema.keys)seen.get(key).add(state[key]);
  }
  assert.equal(presetStateKey(presets[0].snapshot),original);
  for(const values of seen.values())assert.ok(values.size>1);
  for(const live of ['volume','level','playing','loop','audioOn','text'])assert.ok(!schema.keys.includes(live));
});

test('legacy five-field scenes migrate without losing their voice or timing',()=>{
 const legacy={engine:'diphone',personality:'warm',rhythmAmount:.3,diphthongDelay:123,pairGlides:false};
 assert.deepEqual(schema.validate(legacy),{...NATIVE_DEFAULTS,...legacy});
 assert.throws(()=>schema.validate({...legacy,unknown:1}));
 assert.throws(()=>schema.validate({...legacy,voicePitch:2}));
});
