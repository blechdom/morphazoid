import test from 'node:test';
import assert from 'node:assert/strict';
import { drawWitchCat, getWitchCatFrame } from '../src/instruments/witch/witch-cat.js';
import { createWitchCatClock, advanceWitchCatClock, snapshotWitchCatClock, WITCH_CAT_GAITS } from '../src/instruments/witch/witch-cat-model.js';

test('the Quadruped cat visits for seven seconds every thirty seconds of the owner clock',()=>{
  for(const time of [0,29.999,37,59.999,67,89.999]) assert.equal(getWitchCatFrame({performanceTime:time}).active,false,`${time}`);
  for(const time of [30,33.5,36.999,60,63.5,66.999,90]) assert.equal(getWitchCatFrame({performanceTime:time}).active,true,`${time}`);
  const first=getWitchCatFrame({performanceTime:33.5}),second=getWitchCatFrame({performanceTime:63.5});
  assert.equal(first.x,500);assert.equal(second.x,500);
  assert.equal(first.direction,1);assert.equal(second.direction,-1);
  assert.equal(first.animalId,'cat');assert.equal(first.behaviorId,'cat-prowl');
  assert.equal(first.y,700);
  assert.deepEqual(getWitchCatFrame({performanceTime:33.5,handTime:1000,audioOn:true}),first);
  assert.deepEqual(getWitchCatFrame({performanceTime:33.5,handTime:0,audioOn:false}),first);
  for(const time of [-1,NaN,Infinity,undefined]) assert.equal(getWitchCatFrame({performanceTime:time}).active,false);
});

function drawingProbe() {
  const calls=[];
  const scales=[];
  const context=new Proxy({globalAlpha:1},{get(target,key){
    if(key in target)return target[key];
    if(key==='scale')return (...values)=>{scales.push(values);calls.push(values);};
    if(key==='createLinearGradient')return (...values)=>{calls.push(values);return {addColorStop(){}};};
    return (...values)=>{calls.push(values);};
  }});
  return {context,calls,scales};
}

test('cat rendering remains finite and bounded, and inactive visits do no drawing work',()=>{
  for(const time of [0,29,37,59,67]) {
    const {context,calls}=drawingProbe();
    assert.equal(drawWitchCat(context,{performanceTime:time}).active,false);
    assert.equal(calls.length,0);
  }
  for(const time of [30.1,31,33.5,35.2,36.9,60.1,63.5,66.9]) {
    const {context,calls}=drawingProbe();
    assert.equal(drawWitchCat(context,{performanceTime:time}).active,true);
    assert.ok(calls.length>100&&calls.length<1000,`bounded drawing at ${time}: ${calls.length}`);
    assert.ok(calls.flat().filter(value=>typeof value==='number').every(Number.isFinite));
  }
});

test('speed changes crossing duration while each visit still starts every thirty Play seconds',()=>{
  for(const speed of [.5,1,2]) {
    const duration=7/speed;
    const state={catSpeed:speed};
    assert.equal(getWitchCatFrame({...state,performanceTime:29.999}).active,false);
    assert.equal(getWitchCatFrame({...state,performanceTime:30+duration/2}).x,500);
    assert.equal(getWitchCatFrame({...state,performanceTime:30+duration-.001}).active,true);
    assert.equal(getWitchCatFrame({...state,performanceTime:30+duration}).active,false);
    assert.equal(getWitchCatFrame({...state,performanceTime:60}).active,true);
  }
});

test('live speed and actual gait edits preserve integrated travel and paws, including audio handoff',()=>{
  const clock=createWitchCatClock();
  advanceWitchCatClock(clock,32,{catSpeed:1,catGait:'cat-prowl'});
  const before=snapshotWitchCatClock(clock);
  advanceWitchCatClock(clock,32,{catSpeed:2,catGait:'cat-gallop'});
  assert.equal(clock.progress,before.progress);
  assert.equal(clock.position,before.position);
  advanceWitchCatClock(clock,33,{catSpeed:2,catGait:'cat-gallop'});
  assert.ok(Math.abs(clock.progress-4/7)<1e-10);
  assert.equal(clock.position,192);
  assert.equal(clock.gait,'cat-gallop');
  const handoff=snapshotWitchCatClock(clock);
  assert.deepEqual(createWitchCatClock(handoff.time,{},handoff),clock);
  // Audio telemetry wins over a stale RAF time or newly selected speed.
  const frame=getWitchCatFrame({performanceTime:0,catSpeed:.5,catGait:'walk',catFrame:handoff});
  assert.equal(frame.progress,clock.progress);
  assert.equal(frame.position,clock.position);
  assert.equal(frame.behaviorId,'cat-gallop');
  advanceWitchCatClock(clock,33,{catSpeed:2,catGait:'cat-gallop'});
  assert.deepEqual(snapshotWitchCatClock(clock),handoff,'a frozen Play clock freezes paws and travel');
  advanceWitchCatClock(clock,60,{catSpeed:.5,catGait:'tiptoe'});
  assert.equal(clock.visit,2);assert.equal(clock.progress,0);assert.equal(clock.position,0);
});

test('each authored Quadruped gait draws the larger cat about its fixed ground line',()=>{
  for(const catGait of WITCH_CAT_GAITS) {
    const {context,calls,scales}=drawingProbe();
    const frame=drawWitchCat(context,{performanceTime:33.5,catGait});
    assert.equal(frame.behaviorId,catGait);assert.equal(frame.y,700);
    assert.deepEqual(scales[0],[1.25,1.25]);
    assert.ok(calls.length>100&&calls.length<1000);
    assert.ok(calls.flat().filter(value=>typeof value==='number').every(Number.isFinite));
  }
  const {context,scales}=drawingProbe();
  drawWitchCat(context,{performanceTime:63.5});
  assert.deepEqual(scales[0],[-1.25,1.25]);
});
