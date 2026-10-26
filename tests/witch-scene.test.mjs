import test from 'node:test';
import assert from 'node:assert/strict';
import {blendWitchSpell,witchAccentEnvelope} from '../src/instruments/witch/witch-scene-model.js';
import {WITCH_PRESETS,normalizeWitchPreset} from '../src/instruments/witch/witch-presets.js';

test('ingredient flights interpolate whole spells while leaving clocks and output outside their state',()=>{
  const from=WITCH_PRESETS.find(p=>p.id==='beautiful').snapshot,to=WITCH_PRESETS.find(p=>p.id==='shelf-synthesis').snapshot;
  const original=structuredClone(from);
  assert.deepEqual(blendWitchSpell(from,to,-1),from);
  assert.deepEqual(blendWitchSpell(from,to,2),{...to,scene:from.scene});
  let previous=from;
  for(let i=1;i<=100;i++) {
    const current=blendWitchSpell(from,to,i/100);
    assert.equal(current.scene,from.scene);
    for(const key of ['speed','nose','hat','hair','handRate','spellBalance','fabricX','trailPull']) {
      assert.ok(Number.isFinite(current[key]));
      assert.ok(current[key]>=Math.min(from[key],to[key])&&current[key]<=Math.max(from[key],to[key]));
      assert.ok(Math.abs(current[key]-previous[key])<=Math.abs(to[key]-from[key])*.016+1e-10);
    }
    for(const key of ['volume','gate','audioOn','handTime','performanceTime','catCaptured'])assert.equal(key in current,false,key);
    assert.equal(current.fingers.length,5);previous=current;
  }
  assert.deepEqual(from,original);
  const interrupted=blendWitchSpell(from,to,.37),next=WITCH_PRESETS[3].snapshot;
  assert.deepEqual(blendWitchSpell(interrupted,next,0),normalizeWitchPreset(interrupted));
});

test('ingredient transitions never launch, land or change the player-selected hand focus',()=>{
  for(const scene of ['brew','fingers','flight'])for(const targetScene of ['brew','fingers','flight']) {
    const from={...WITCH_PRESETS[0].snapshot,scene},to={...WITCH_PRESETS[1].snapshot,scene:targetScene};
    for(const progress of [0,.25,.5,.75,1,2])assert.equal(blendWitchSpell(from,to,progress).scene,scene);
    assert.deepEqual(blendWitchSpell(from,to,1),{...to,scene});
  }
});

test('eye and spider accents start gently and end at their fixed duration',()=>{
  for(const duration of [1.3,1.5]) {
    assert.equal(witchAccentEnvelope(-1,duration),0);assert.equal(witchAccentEnvelope(0,duration),0);
    assert.ok(witchAccentEnvelope(.1,duration)>.8);
    assert.equal(witchAccentEnvelope(duration,duration),0);assert.equal(witchAccentEnvelope(Infinity,duration),0);
    for(let i=0;i<200;i++)assert.ok(witchAccentEnvelope(i/100,duration)<=1);
  }
});
