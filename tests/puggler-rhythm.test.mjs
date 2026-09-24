import test from 'node:test';
import assert from 'node:assert/strict';
import { propNoteAt, propRhythm, objectPitchRate, ensembleGain, propTimbreGain, MAX_PROP_NOTE_RATE } from '../src/instruments/puggler/puggler-rhythm.js';
import { OBJECT_SOUND_PROFILES } from '../src/instruments/puggler/puggler-object-sounds.js';

test('all object scores stay on a power-of-two juggling subdivision at every tempo',()=>{
  for(const bank of Object.values(OBJECT_SOUND_PROFILES))for(const p of Object.values(bank))for(const tempo of [100,180,240,360,600,1200])for(const slot of [0,1,2,9]){
    let last;
    for(let beat=0;beat<32;beat+=.013){
      const n=propNoteAt(p,beat,tempo,slot);
      assert.ok(n.ratePerSecond<=MAX_PROP_NOTE_RATE);assert.ok(n.gateSeconds>0);
      assert.ok(Object.values(n).filter(v=>typeof v==='number').every(Number.isFinite));
      assert.ok(Number.isInteger(Math.log2(n.stepBeats)),`${p.family}: binary beat relationship`);
      if(last&&n.token!==last.token)assert.ok(Math.abs(n.atBeat-last.atBeat-n.stepBeats)<1e-7);
      last=n;
    }
  }
});
test('pitch motion changes pitch but cannot change the rhythm token, step size or onset beat',()=>{
  const p=OBJECT_SOUND_PROFILES.future.guitar,note=propNoteAt(p,19.3,720,3);
  const low=objectPitchRate({y:170,vx:0},{height:1,skin:'future'}),high=objectPitchRate({y:500,vx:100},{height:1,skin:'future'});
  assert.ok(high>low);assert.deepEqual(propNoteAt(p,19.3,720,3),note);
  assert.equal(objectPitchRate({y:200,vx:20},{tempo:100}),objectPitchRate({y:200,vx:20},{tempo:1200}));
});
test('requested classical Alberti bass/scales are local scores; future pitches are unquantized',()=>{
  assert.deepEqual(propRhythm(OBJECT_SOUND_PROFILES.history.skateboard).ratios,[1,1.5,1.25,1.5]);
  assert.equal(propRhythm(OBJECT_SOUND_PROFILES.history.apple).ratios.length,8);
  const future=propRhythm(OBJECT_SOUND_PROFILES.future.club).ratios;
  assert.equal(future.length,7);assert.ok(future.some(r=>Math.abs(12*Math.log2(r)-Math.round(12*Math.log2(r)))>.1));
});
test('ensemble compensation depends on configuration, not momentary silence or airborne count',()=>{
  assert.ok(ensembleGain(1,360)>ensembleGain(10,360));assert.ok(ensembleGain(10,1200)>ensembleGain(10,180));
  for(const count of [0,1,3,10,99])for(const tempo of [0,100,360,1200,9999])assert.ok(ensembleGain(count,tempo)>=.62&&ensembleGain(count,tempo)<=2.2);
});

// Fixed family trims are calibration, never a signal-level detector.
test('soft-family trims remain finite, bounded and independent of instantaneous level',()=>{
  for(const bank of Object.values(OBJECT_SOUND_PROFILES))for(const profile of Object.values(bank)){
    const gain=propTimbreGain(profile);
    assert.ok(Number.isFinite(gain)&&gain>=1&&gain<=1.8);
    assert.equal(propTimbreGain({...profile,rms:0}),gain);
    assert.equal(propTimbreGain({...profile,rms:1}),gain);
  }
  assert.ok(propTimbreGain(OBJECT_SOUND_PROFILES.future.fish)>propTimbreGain(OBJECT_SOUND_PROFILES.future.guitar));
});
