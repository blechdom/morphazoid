import test from 'node:test';
import assert from 'node:assert/strict';
import { drawWitchCat, getWitchCatFrame, getWitchCatTargets, hitTestWitchCat, WITCH_CAT_SCALE } from '../src/instruments/witch/witch-cat.js';
import { createWitchCatClock, advanceWitchCatClock, snapshotWitchCatClock, WITCH_CAT_GAITS, witchCatMeowEnvelope } from '../src/instruments/witch/witch-cat-model.js';
import { hitTestWitch, warpWitchPoint } from '../src/instruments/witch/witch-renderer.js';

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
  assert.equal(WITCH_CAT_SCALE/1.25,1.2,'twenty percent larger than the previous cat');
  for(const catGait of WITCH_CAT_GAITS) {
    const {context,calls,scales}=drawingProbe();
    const frame=drawWitchCat(context,{performanceTime:33.5,catGait});
    assert.equal(frame.behaviorId,catGait);assert.equal(frame.y,700);
    assert.deepEqual(scales[0],[1.5,1.5]);
    assert.ok(calls.length>100&&calls.length<1000);
    assert.ok(calls.flat().filter(value=>typeof value==='number').every(Number.isFinite));
  }
  const {context,scales}=drawingProbe();
  drawWitchCat(context,{performanceTime:63.5});
  assert.deepEqual(scales[0],[-1.5,1.5]);
});

test('click targets follow both directions and every gait through mushroom distortion',()=>{
  for(const catGait of WITCH_CAT_GAITS)for(const performanceTime of [32.5,33.5,63.5,64.5])for(const trip of [0,3]) {
    const state={performanceTime,catGait,trip,warpTime:.7,playing:true};
    const targets=getWitchCatTargets(state);
    for(const target of Object.values(targets)) {
      assert.equal(hitTestWitchCat(target.x,target.y,state),true);
      const visible=warpWitchPoint(target,state);
      assert.deepEqual(hitTestWitch(visible.x,visible.y,state),{type:'cat'});
      assert.deepEqual(hitTestWitch(visible.x,visible.y,{...state,playing:false}),{type:'cat'},'paused cat still shields objects behind it');
    }
    assert.equal(hitTestWitchCat(targets.body.x,targets.body.y-120,state),false);
  }
  for(const performanceTime of [0,29,37,59]) {
    assert.equal(getWitchCatTargets({performanceTime}),null);
    assert.equal(hitTestWitchCat(500,650,{performanceTime}),false);
  }
});

test('meow opens the actual head rig while preserving body travel and a bounded silent reaction',()=>{
  const state={performanceTime:33.5},quiet=getWitchCatTargets(state),meow=getWitchCatTargets({...state,catMeow:1});
  assert.deepEqual(quiet.body,meow.body);
  assert.notDeepEqual(quiet.head,meow.head);
  assert.deepEqual(getWitchCatFrame(state),getWitchCatFrame({...state,catMeow:1}));
  const a=drawingProbe(),b=drawingProbe();drawWitchCat(a.context,state);drawWitchCat(b.context,{...state,catMeow:1});
  assert.notDeepEqual(a.calls,b.calls);
  assert.ok(b.calls.flat().filter(value=>typeof value==='number').every(Number.isFinite));
  for(const age of [-1,0,.85,3,Infinity,NaN])assert.equal(witchCatMeowEnvelope(age),0);
  assert.equal(witchCatMeowEnvelope(.1),1);
  assert.ok(witchCatMeowEnvelope(.7)<witchCatMeowEnvelope(.5));
});

test('a captured cat dives from its visible anchor, keeps meowing, and returns on its next visit',()=>{
  const before=getWitchCatFrame({performanceTime:33.5});
  const capture=Object.freeze({startedAt:33.5,from:Object.freeze({x:before.x,y:before.y})});
  const state={performanceTime:33.5,capturedAnimals:Object.freeze({cat:capture})};
  const start=getWitchCatFrame(state);
  assert.equal(start.x,before.x);assert.equal(start.y,before.y);
  assert.equal(start.captured,true);assert.equal(start.diving,true);assert.equal(start.visible,true);
  assert.equal(getWitchCatTargets(state),null);assert.equal(hitTestWitchCat(before.x,before.y,state),false);
  const mid=getWitchCatFrame({...state,performanceTime:33.95});
  assert.ok(mid.x>start.x&&mid.x<600);assert.ok(mid.y<544);assert.ok(mid.scale<1);
  assert.deepEqual(getWitchCatFrame({...state,performanceTime:33.95,time:9999}),mid,'wall time does not move a stopped dive');
  const silent=drawingProbe(),meow=drawingProbe();
  drawWitchCat(silent.context,{...state,performanceTime:33.95});
  drawWitchCat(meow.context,{...state,performanceTime:33.95,catMeow:1});
  assert.notDeepEqual(silent.calls,meow.calls,'the meowing head still articulates during its dive');
  for(const performanceTime of [34.5,36,50,59.9]) {
    const frame=getWitchCatFrame({...state,performanceTime});
    assert.equal(frame.captured,true);assert.equal(frame.visible,false);assert.equal(frame.diving,false);
  }
  const next=getWitchCatFrame({...state,performanceTime:63.5});
  assert.equal(next.captured,false);assert.equal(next.visible,true);assert.equal(next.direction,-1);
});

test('full flight hides the cat and its click targets without changing its visit clock',()=>{
  const state={performanceTime:33.5},ground=getWitchCatFrame(state),flight=getWitchCatFrame({...state,flightLift:1});
  assert.equal(ground.visible,true);assert.equal(flight.visible,false);
  for(const key of ['visit','progress','position','x','y'])assert.equal(flight[key],ground[key]);
  assert.equal(getWitchCatTargets({...state,flightLift:1}),null);
  assert.equal(hitTestWitchCat(ground.x,ground.y,{...state,flightLift:1}),false);
  const probe=drawingProbe();drawWitchCat(probe.context,{...state,flightLift:1});assert.equal(probe.calls.length,0);
});
