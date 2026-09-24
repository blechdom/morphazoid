import test from 'node:test';
import assert from 'node:assert/strict';
import { PugglerModel, PATTERNS } from '../src/instruments/puggler/puggler.js';
import { PAGE_DEFAULTS } from '../src/instruments/puggler/puggler-presets.js';
import { SOUND_DEFAULTS, MODEL_KEYS, SOUND_KEYS, PUGGLER_FULL_PRESETS, capturePugglerPreset, validatePugglerPreset, applyPugglerPreset, randomizePugglerPreset } from '../src/instruments/puggler/puggler-full-presets.js';
import { validateFullPresetBank, presetStateKey } from '../src/site/header-presets.js';

test('48 full scenes cover three eras, eleven lights, sparse/dense, slow/fast and articulation at comparable nominal levels',()=>{
  validateFullPresetBank(PUGGLER_FULL_PRESETS);
  const snapshots=PUGGLER_FULL_PRESETS.map(p=>validatePugglerPreset(p.snapshot));
  for(const skin of ['punk','history','future'])assert.equal(snapshots.filter(s=>s.sound.skin===skin).length,16);
  assert.equal(new Set(snapshots.map(s=>s.sound.lighting)).size,11);
  for(const [key,min,max] of [['tempo',100,1200],['count',1,10]]){
    assert.equal(Math.min(...snapshots.map(s=>s.model[key])),min);assert.equal(Math.max(...snapshots.map(s=>s.model[key])),max);
  }
  assert.ok(Math.max(...snapshots.map(s=>s.sound.sceneGain))-Math.min(...snapshots.map(s=>s.sound.sceneGain))<=.12);
  for(const s of snapshots){assert.ok(s.sound.flight>=.68);assert.ok(s.sound.impacts>=.78&&s.sound.impacts<=1.12);}
});
test('complete roundtrip preserves live clock, Audio/Play, Output, flash consent and resources',()=>{
  const model=new PugglerModel(PAGE_DEFAULTS), params={...SOUND_DEFAULTS,level:.13,allowFlashes:true,reducedMotion:true};
  model.step(.025);const time=model.time, seed=model.seed;
  for(const {snapshot} of PUGGLER_FULL_PRESETS){
    applyPugglerPreset(model,params,snapshot);
    assert.deepEqual(capturePugglerPreset(model,params),snapshot);
    assert.equal(model.time,time);assert.equal(model.seed,seed);
    assert.equal(params.level,.13);assert.equal(params.allowFlashes,true);assert.equal(params.reducedMotion,true);
    assert.equal(params.tempo,model.config.tempo);
  }
});
test('dice is deterministic, pure, complete and varies every scene-owned field',()=>{
  const current=PUGGLER_FULL_PRESETS[0].snapshot,before=presetStateKey(current);
  const rng=()=>{let seed=901;return ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);};
  assert.deepEqual(randomizePugglerPreset(current,rng()),randomizePugglerPreset(current,rng()));
  const random=rng(),scenes=Array.from({length:250},()=>randomizePugglerPreset(current,random));
  assert.equal(presetStateKey(current),before);
  for(const group of ['model','sound'])for(const key of group==='model'?MODEL_KEYS:SOUND_KEYS)assert.ok(new Set(scenes.map(s=>presetStateKey(s[group][key]))).size>1,`${group}.${key} must vary`);
  for(const scene of scenes){
    assert.ok(PATTERNS.some(p=>p.id===scene.model.pattern&&p.count===scene.model.count));
    assert.ok(scene.sound.boo>=.12&&scene.sound.boo<=.3,'Audience dice levels retain the original balanced range');
    assert.ok(!PUGGLER_FULL_PRESETS.some(p=>presetStateKey(p.snapshot)===presetStateKey(scene)));
    const serialized=JSON.stringify(scene);for(const key of ['level','running','allowFlashes','reducedMotion','seed'])assert.ok(!serialized.includes(`"${key}":`));
  }
});
test('invalid/incomplete/non-finite scenes are rejected before mutating live state',()=>{
  const model=new PugglerModel(PAGE_DEFAULTS),params={...SOUND_DEFAULTS};
  for(const mutate of [s=>delete s.sound.grit,s=>s.sound.grit=NaN,s=>s.sound.boo=3.01,s=>s.sound.boo=-.01,s=>s.sound.level=.8,s=>s.model.propIds[0]='missing',s=>s.model.drums[0]='missing',s=>s.model.count=0,s=>s.sound.allowFlashes=true,s=>s.model.pattern='missing',s=>s.version=99]){
    const snapshot=structuredClone(PUGGLER_FULL_PRESETS[0].snapshot);mutate(snapshot);
    const before=capturePugglerPreset(model,params);
    assert.throws(()=>applyPugglerPreset(model,params,snapshot));assert.deepEqual(capturePugglerPreset(model,params),before);
  }
});

test('the main bank alternates skins and demonstrates independent motion, height and sound ranges',()=>{
  assert.equal(PUGGLER_FULL_PRESETS.length,48);
  const scenes=PUGGLER_FULL_PRESETS.map(p=>p.snapshot);
  for(let i=1;i<scenes.length;i++)assert.notEqual(scenes[i].sound.skin,scenes[i-1].sound.skin);
  for(const key of ['rideSpeed','loft','gravity'])assert.ok(new Set(scenes.map(s=>s.model[key])).size>=6,key);
  assert.ok(scenes.some(s=>s.model.rideSpeed===0&&s.model.tempo>=900));
  assert.ok(scenes.some(s=>s.model.rideSpeed>=2&&s.model.tempo<200));
  assert.ok(scenes.some(s=>s.sound.stereo===0));assert.ok(scenes.some(s=>s.sound.decay===.2));
});
test('v1 snapshots migrate the new drop level without mutating the saved scene',()=>{
  const old=structuredClone(PUGGLER_FULL_PRESETS[0].snapshot);old.version=1;delete old.sound.drops;
  const saved=JSON.stringify(old),model=new PugglerModel(PAGE_DEFAULTS),params={...SOUND_DEFAULTS};
  applyPugglerPreset(model,params,old);
  assert.equal(params.drops,SOUND_DEFAULTS.drops);assert.equal(JSON.stringify(old),saved);
  assert.equal(capturePugglerPreset(model,params).version,2);
});


test('boosted Audience custom scenes roundtrip while defaults and factory levels stay unchanged',()=>{
  const model=new PugglerModel(PAGE_DEFAULTS),params={...SOUND_DEFAULTS,level:.42};
  assert.equal(params.boo,.28);
  assert.ok(PUGGLER_FULL_PRESETS.every(p=>p.snapshot.sound.boo<=.28));
  const snapshot=capturePugglerPreset(model,{...params,boo:3});
  applyPugglerPreset(model,params,snapshot);
  assert.equal(params.boo,3);assert.equal(params.level,.42);assert.equal(params.drops,.7);
  assert.deepEqual(capturePugglerPreset(model,params),snapshot);
});
