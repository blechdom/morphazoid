import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHandTremor } from '../src/instruments/gesticulating-hand/hand-tremor.js';
import { clampHand, handDigitLimits, handWristLimits, FINGERS, TREMOR_FINGERS, TREMOR_JOINTS,
  normalizeHandConfig, evaluateHandVoices } from '../src/instruments/gesticulating-hand/hand-model.js';

const JOINTS=['tip','middle','knuckle','whole','wrist'];
const apply=createHandTremor({clampHand,handDigitLimits,handWristLimits,FINGERS,TREMOR_FINGERS,TREMOR_JOINTS:[...new Set([...TREMOR_JOINTS,'spread'])]});
const base=form=>({fingers:Array.from({length:5},(_,i)=>Object.fromEntries(Object.entries(handDigitLimits(form,i))
  .map(([key,[lo,hi]])=>[key,lo+(hi-lo)*(.08+i*.19)]))),
  wrist:Object.fromEntries(Object.entries(handWristLimits(form)).map(([key,[lo,hi]])=>[key,lo+(hi-lo)*.4]))});
const center=form=>({fingers:Array.from({length:5},(_,i)=>Object.fromEntries(Object.entries(handDigitLimits(form,i)).map(([key,[lo,hi]])=>[key,(lo+hi)/2]))),
  wrist:Object.fromEntries(Object.entries(handWristLimits(form)).map(([key,[lo,hi]])=>[key,(lo+hi)/2]))});
function sample(settings,time,form='foot',pose=center(form)){
  const offsets=new Float64Array(5);apply(settings,time,pose,offsets,form);return {pose,offsets};
}
function bounded(pose,offsets,form){
  for(let i=0;i<5;i++)for(const [key,[lo,hi]] of Object.entries(handDigitLimits(form,i)))
    assert.ok(Number.isFinite(pose.fingers[i][key])&&pose.fingers[i][key]>=lo&&pose.fingers[i][key]<=hi);
  for(const [key,[lo,hi]] of Object.entries(handWristLimits(form)))assert.ok(Number.isFinite(pose.wrist[key])&&pose.wrist[key]>=lo&&pose.wrist[key]<=hi);
  assert.ok(offsets.every(Number.isFinite));
}

test('zero spreads preserve all legacy targets numerically across both anatomies and joint clipping',()=>{
  // Golden hashes were captured from the unmodified applyHandTremor in d4b9a54:
  // 2,205 poses + pitch-offset arrays per form. This covers every legacy target,
  // signed times, all/alternating phases, whole digits, wrist and clipped joints.
  const expected={hand:'74aa73f4f3257e575dbee33620d81884c2fd11aa1306ceb82dd9ab63af4f01ef',foot:'ee82b141c92adcf490add4e5572108b61382b2539c8268d9ade717f31d9439a4'};
  for(const form of ['hand','foot'])for(const spreads of [{},{rateSpread:0,phaseSpread:0}]){
    const hash=createHash('sha256');
    for(const finger of TREMOR_FINGERS)for(const joint of JOINTS)for(const time of [0,1/32,-.173,.00137,.537,12.375,99.731])for(const rate of [.5,8,40])for(const amount of [0,4,15]){
      const {pose,offsets}=sample({finger,joint,amount,rate,...spreads},time,form,base(form));hash.update(JSON.stringify([pose,Array.from(offsets)]));
    }
    assert.equal(hash.digest('hex'),expected[form]);
  }
});

test('all toes can separate their phases and oscillate at independently spread rates',()=>{
  const settings={finger:'all',joint:'knuckle',amount:5,rate:8};
  const plain=center('foot'),phased=sample({...settings,phaseSpread:1},0).pose;
  const deflections=phased.fingers.map((digit,i)=>digit.mcp-plain.fingers[i].mcp);
  assert.equal(new Set(deflections.map(value=>value.toFixed(9))).size,5);
  assert.ok(deflections.some(value=>value>4)&&deflections.some(value=>value<-4));
  const synchronous=sample(settings,.017).pose;
  assert.equal(new Set(synchronous.fingers.map((digit,i)=>(digit.mcp-plain.fingers[i].mcp).toFixed(9))).size,1);
  const spread={...settings,rateSpread:1},peakTimes=[];
  for(let i=0;i<5;i++){
    // A quarter period is the positive peak; each digit has its own period.
    const time=1/(4*settings.rate*2**((i-2)*.45));peakTimes.push(time);
    assert.ok(Math.abs(sample(spread,time).pose.fingers[i].mcp-plain.fingers[i].mcp-5)<1e-10);
    assert.ok(Math.abs(sample(spread,time*5).pose.fingers[i].mcp-plain.fingers[i].mcp-5)<1e-10);
  }
  assert.equal(new Set(peakTimes).size,5);assert.ok(peakTimes[0]/peakTimes[4]>3.4);
});

test('45-degree depth and 0.1–120 Hz rates are real control ranges and silence restores the base pose',()=>{
  for(const form of ['hand','foot'])for(const rate of [.1,120]){
    const pose=center(form),old=pose.fingers[2].pip;
    const {offsets}=sample({finger:'middle',joint:'middle',amount:45,rate},1/(rate*4),form,pose);
    assert.ok(Math.abs(pose.fingers[2].pip-old-45)<1e-10);assert.ok(Math.abs(offsets[2]-45*.0035)<1e-12);
    bounded(pose,offsets,form);
    const before=center(form),off=sample({finger:'all',joint:'whole',amount:0,rate,rateSpread:1,phaseSpread:1},.23,form);
    assert.deepEqual(off.pose,before);assert.deepEqual(Array.from(off.offsets),[0,0,0,0,0]);
  }
});

test('sideways tremor changes stereo without pitch vibrato or bend, including every toe',()=>{
  for(const form of ['hand','foot']){
    const pose=center(form),before=structuredClone(pose),settings={finger:'all',joint:'spread',amount:8,rate:7,phaseSpread:1,rateSpread:.6};
    const {offsets}=sample(settings,.037,form,pose);assert.deepEqual(Array.from(offsets),[0,0,0,0,0]);
    for(let i=0;i<5;i++){
      for(const key of ['mcp','pip','dip'])assert.equal(pose.fingers[i][key],before.fingers[i][key]);
      assert.notEqual(pose.fingers[i].spread,before.fingers[i].spread);
    }
    const config=normalizeHandConfig({form,pose:before,motion:{id:'still'},tremor:{amount:0}}),plain=evaluateHandVoices(config,.037);
    config.pose=pose;const moved=evaluateHandVoices(config,.037);
    for(let i=0;i<5;i++){assert.equal(moved[i].frequency,plain[i].frequency);assert.ok(Math.abs(moved[i].pan-plain[i].pan)>.001);}
    bounded(pose,offsets,form);
  }
});

test('spread keeps single/alternating selection and the two-joint big toe keeps its middle-joint rules',()=>{
  const before=center('foot'),settings={finger:'index',joint:'spread',amount:8,rate:8};
  const single=sample(settings,1/32).pose;
  assert.equal(single.fingers[1].spread,before.fingers[1].spread+8);
  for(const i of [0,2,3,4])assert.deepEqual(single.fingers[i],before.fingers[i]);
  const alternating=sample({...settings,finger:'alternating'},1/32).pose;
  for(let i=0;i<5;i++)assert.ok(Math.abs(alternating.fingers[i].spread-before.fingers[i].spread-(i%2?-8:8))<1e-10);
  const allMiddle=sample({...settings,finger:'all',joint:'middle'},1/32),bigMiddle=sample({...settings,finger:'thumb',joint:'middle'},1/32);
  assert.deepEqual(allMiddle.pose.fingers[0],before.fingers[0]);assert.equal(allMiddle.offsets[0],0);
  assert.equal(bigMiddle.pose.fingers[0].pip,0);assert.equal(bigMiddle.pose.fingers[0].dip,before.fingers[0].dip+8);assert.ok(bigMiddle.offsets[0]>0);
});

test('wrist spreads separate its side and turning axes while keeping the flex oscillator and digits intact',()=>{
  for(const form of ['hand','foot']){
    const settings={finger:'all',joint:'wrist',amount:3,rate:9},plain=sample(settings,.017,form);
    for(const extra of [{phaseSpread:.7},{rateSpread:.8},{phaseSpread:.7,rateSpread:.8}]){
      const changed=sample({...settings,...extra},.017,form);
      assert.equal(changed.pose.wrist.flex,plain.pose.wrist.flex);assert.notEqual(changed.pose.wrist.side,plain.pose.wrist.side);assert.notEqual(changed.pose.wrist.twist,plain.pose.wrist.twist);
      assert.deepEqual(changed.pose.fingers,plain.pose.fingers);assert.deepEqual(Array.from(changed.offsets),[0,0,0,0,0]);bounded(changed.pose,changed.offsets,form);
    }
  }
});

test('extreme and malformed tremor remains finite, deterministic and uses caller-owned storage',()=>{
  const invalid=[undefined,null,Symbol(),{},'bad',Infinity,NaN,1e300,-1e300];
  for(const form of ['hand','foot']){
    for(const value of invalid){
      const result=sample({finger:value,joint:value,amount:45,rate:value,phaseSpread:value,rateSpread:value},value,form);bounded(result.pose,result.offsets,form);
    }
    for(const joint of [...JOINTS,'spread'])for(const time of [-1e9,-.137,0,.00031,1e9]){
      const settings=Object.freeze({finger:'alternating',joint,amount:45,rate:120,phaseSpread:1,rateSpread:1}),pose=center(form),fingers=pose.fingers,wrist=pose.wrist,digits=[...fingers],offsets=new Float64Array(5);
      apply(settings,time,pose,offsets,form);bounded(pose,offsets,form);
      assert.equal(pose.fingers,fingers);assert.equal(pose.wrist,wrist);digits.forEach((digit,i)=>assert.equal(pose.fingers[i],digit));
      const again=sample(settings,time,form);assert.deepEqual(pose,again.pose);assert.deepEqual(offsets,again.offsets);
    }
  }
});
