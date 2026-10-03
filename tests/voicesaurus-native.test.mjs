import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_METHODS,defaultScene,validateScene,presets,randomize} from '../src/instruments/voicesaurus/native-model.js';
import {presetStateKey} from '../src/site/header-presets.js';

test('native voice presets use each engine’s complete controls and original input mode',()=>{
 const ids=new Set(),states=new Set();
 for(const preset of presets){assert(!ids.has(preset.id));ids.add(preset.id);states.add(presetStateKey(preset.snapshot));assert.deepEqual(validateScene(preset.snapshot),preset.snapshot);}
 assert.equal(states.size,presets.length);
 for(const [engine,spec] of Object.entries(NATIVE_METHODS)){
   const scene=defaultScene(engine);assert.deepEqual(validateScene(scene),scene);
   assert.equal(Object.keys(scene.values).length,Object.keys(spec.controls).length);
   assert.match(spec.date,/\d{4}/);assert.equal(new URL(spec.source).protocol,'https:');
   assert(presets.filter(p=>p.snapshot.engine===engine).length>=8);
   assert(!['rhythmAmount','diphthongDelay','pairGlides','personality'].some(key=>key in scene.values));
 }
 assert.equal(NATIVE_METHODS.singer.phones.length,71);assert.equal(NATIVE_METHODS['stk-voicform'].phones.length,32);
 assert.equal(NATIVE_METHODS.vizsn.mode,'native-letters');assert.equal(NATIVE_METHODS.mea8000.mode,'note');
 assert.equal(NATIVE_METHODS.espeak.mode,'text');
});

test('HAL is represented by an editable inspired voice rather than a new engine',()=>{
 const hal=presets.find(preset=>preset.id==='espeak-klatt-native-9');
 assert.equal(hal?.label,'eSpeak NG Klatt · HAL-inspired calm computer');
 assert.equal(hal.snapshot.engine,'espeak-klatt');
 assert.deepEqual(Object.fromEntries(['variant','rate','pitch','range','volume'].map(key=>[key,hal.snapshot.values[key]])),
  {variant:'robosoft3',rate:135,pitch:35,range:12,volume:25});
 assert.equal(Object.keys(hal.snapshot.values).length,Object.keys(NATIVE_METHODS['espeak-klatt'].controls).length);
 assert.deepEqual(validateScene(hal.snapshot),hal.snapshot);
});

test('native randomization preserves complete bounded scenes without modifying a factory preset',()=>{
 let seed=3246;const rng=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
 const before=presetStateKey(presets[0].snapshot),engines=new Set();
 for(let n=0;n<400;n++){const scene=randomize(presets[0].snapshot,rng);validateScene(scene);engines.add(scene.engine);assert(!('level' in scene));assert(!('text' in scene));}
 assert.equal(engines.size,Object.keys(NATIVE_METHODS).length);assert.equal(presetStateKey(presets[0].snapshot),before);
});

test('native scene validation rejects missing, extra and nonfinite parameters',()=>{
 const scene=defaultScene('singer');const key=Object.keys(scene.values)[0];
 for(const value of [NaN,Infinity,-Infinity])assert.throws(()=>validateScene({...scene,values:{...scene.values,[key]:value}}));
 const missing=structuredClone(scene);delete missing.values[key];assert.throws(()=>validateScene(missing));
 assert.throws(()=>validateScene({...scene,values:{...scene.values,unknown:1}}));
});

test('dial display spans do not cap finite values sent to native engines',()=>{
 for(const engine of ['singer','stk-voicform','csound-fof','csound-vosim','espeak','hts']){
  const scene=defaultScene(engine);
  for(const [key,rule]of Object.entries(NATIVE_METHODS[engine].controls))if(!rule.choices){
   for(const value of [rule.min-100,rule.max+100]){
    const edited={...scene,values:{...scene.values,[key]:value}};
    assert.equal(validateScene(edited).values[key],value,`${engine}/${key}`);
   }
  }
 }
});
