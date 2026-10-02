import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_METHODS, defaultScene, presets, randomize, voiceModeForEngine, methodsForVoiceMode, presetsForVoiceMode, validateScene } from '../src/instruments/voicesaurus/native-model.js';

test('speaking and singing keep distinct native routes in historical order',()=>{
 const speaking=methodsForVoiceMode('speaking'),singing=methodsForVoiceMode('singing');
 assert.deepEqual(Object.keys(singing).sort(),['csound-fof','csound-vosim','sample-bank','singer','sinsy','stk-voicform']);
 assert.equal(Object.keys(speaking).length+Object.keys(singing).length,Object.keys(NATIVE_METHODS).length);
 for(const [mode,methods]of Object.entries({speaking,singing})){
  const years=Object.values(methods).map(spec=>spec.year);
  assert.deepEqual(years,[...years].sort((a,b)=>a-b));
  for(const engine of Object.keys(methods))assert.equal(voiceModeForEngine(engine),mode);
 }
 assert.equal(speaking.vizsn.mode,'native-letters');
 assert.equal(speaking.mea8000.mode,'note');
 assert.equal(singing.sinsy.mode,'score');
 assert.throws(()=>methodsForVoiceMode('anywhere'));
 assert.throws(()=>voiceModeForEngine('made-up'));
});

test('mode banks partition the complete presets without rewriting native state',()=>{
 const speaking=presetsForVoiceMode('speaking'),singing=presetsForVoiceMode('singing');
 assert.equal(speaking.length+singing.length,presets.length);
 assert.equal(new Set([...speaking,...singing].map(p=>p.id)).size,presets.length);
 for(const mode of ['speaking','singing']){
  const bank=presetsForVoiceMode(mode);assert.ok(bank.length>=12);
  for(const preset of bank){assert.equal(voiceModeForEngine(preset.snapshot.engine),mode);assert.ok(presets.includes(preset));}
 }
});

test('scoped dice explores every available method while preserving its input scene',()=>{
 let seed=84203;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
 for(const mode of ['speaking','singing']){
  const previous=defaultScene(mode==='singing'?'singer':'espeak'),snapshot=structuredClone(previous),engines=new Set();
  for(let i=0;i<400;i++){
   const scene=randomize(previous,random,{mode});
   assert.equal(voiceModeForEngine(scene.engine),mode);validateScene(scene);engines.add(scene.engine);
   assert.equal(Object.hasOwn(scene,'level'),false);assert.equal(Object.hasOwn(scene,'loop'),false);
  }
  assert.deepEqual([...engines].sort(),Object.keys(methodsForVoiceMode(mode)).sort());
  assert.deepEqual(previous,snapshot);
 }
});
