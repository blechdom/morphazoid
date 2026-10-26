import test from 'node:test';
import assert from 'node:assert/strict';
import { drawWitchCat, getWitchCatFrame, getWitchCatTargets, hitTestWitchCat, WITCH_CAT_SCALE } from '../src/instruments/witch/witch-cat.js';
import { createWitchCatClock, advanceWitchCatClock, snapshotWitchCatClock, WITCH_CAT_GAITS, witchCatMeowEnvelope, witchCatUnicornFrame, WITCH_CAT_UNICORN_DURATION } from '../src/instruments/witch/witch-cat-model.js';
import { hitTestWitch, warpWitchPoint, WITCH_LAYOUT } from '../src/instruments/witch/witch-renderer.js';
import { createQuadrupedState, deriveQuadrupedPose } from '../src/instruments/quadruped/quadruped.js';
import { deriveQuadrupedVisualRig } from '../src/instruments/quadruped/quadruped-visual-skins.js';

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
  const paints=[],filledPaths=[];
  let points=[];
  const context=new Proxy({globalAlpha:1},{get(target,key){
    if(key in target)return target[key];
    if(key==='scale')return (...values)=>{scales.push(values);calls.push(values);};
    if(key==='createLinearGradient')return (...values)=>{calls.push(values);return {addColorStop(){}};};
    return (...values)=>{
      calls.push(values);
      if(key==='beginPath')points=[];
      if(key==='moveTo'||key==='lineTo')points.push({x:values[0],y:values[1]});
      if(key==='fill')filledPaths.push({points:points.slice(),fill:target.fillStyle});
    };
  },set(target,key,value){
    target[key]=value;
    if(key==='fillStyle'||key==='strokeStyle')paints.push(value);
    return true;
  }});
  return {context,calls,scales,paints,filledPaths};
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
      // The die is drawn after the visitors, so its visible face takes input
      // where a passing cat is behind it. Everywhere else the cat wins.
      const die=WITCH_LAYOUT.die,front=Math.hypot(target.x-die.x,target.y-die.y)<die.r+7?'dice':'cat';
      assert.deepEqual(hitTestWitch(visible.x,visible.y,state),{type:front});
      assert.deepEqual(hitTestWitch(visible.x,visible.y,{...state,playing:false}),{type:front},'pause preserves the visible stacking order');
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

test('a flagged capture keeps its cat dive, then escapes as an unclickable native unicorn in either direction',()=>{
  for(const startedAt of [33.5,63.5]) {
    const from=getWitchCatFrame({performanceTime:startedAt});
    const normal={capturedAnimals:{cat:{startedAt,from}}};
    const state={capturedAnimals:{cat:{startedAt,from,unicorn:true}}};
    for(const age of [0,.45,.94]) {
      assert.deepEqual(getWitchCatFrame({...state,performanceTime:startedAt+age}),getWitchCatFrame({...normal,performanceTime:startedAt+age}));
    }
    for(const age of [1.26,1.8,2.6,4.1]) {
      const performanceTime=startedAt+age;
      const frame=getWitchCatFrame({...state,performanceTime});
      const timeline=witchCatUnicornFrame(performanceTime-startedAt,from.direction);
      assert.equal(frame.captured,true);assert.equal(frame.escaping,true);assert.equal(frame.diving,false);
      assert.equal(frame.visible,true);assert.equal(frame.animalId,'unicorn');assert.equal(frame.behaviorId,'gallop');
      for(const key of ['x','y','scale','rotation','position','alpha','direction'])assert.equal(frame[key],timeline[key],key);
      assert.equal(getWitchCatTargets({...state,performanceTime}),null);
      assert.equal(hitTestWitchCat(frame.x,frame.y,{...state,performanceTime}),false);
    }
    const next=getWitchCatFrame({...state,performanceTime:startedAt+30});
    assert.equal(next.animalId,'cat');assert.equal(next.captured,false);assert.equal(next.visible,true);
    for(const age of [WITCH_CAT_UNICORN_DURATION+.01,10]) {
      const probe=drawingProbe();
      assert.equal(drawWitchCat(probe.context,{...state,performanceTime:startedAt+age}).visible,false);
      assert.equal(probe.calls.length,0,'finished escape does no rendering');
    }
  }
});

test('unicorn coat paints the authored Quadruped horn, palette and gallop rig with bounded sparkles',()=>{
  const startedAt=33.5,from=getWitchCatFrame({performanceTime:startedAt});
  const state={capturedAnimals:{cat:{startedAt,from,unicorn:true}}};
  const score=createQuadrupedState('unicorn','gallop');
  for(const age of [1.02,1.26,1.8,2.53,4.1]) {
    const probe=drawingProbe();
    const frame=drawWitchCat(probe.context,{...state,performanceTime:startedAt+age});
    const rig=deriveQuadrupedVisualRig(deriveQuadrupedPose(score,frame.position),500,260,240,score);
    assert.equal(rig.animal.id,'unicorn');assert.equal(rig.morphology.family,'equid');
    assert.ok(probe.filledPaths.some(path=>path.fill===rig.animal.palette[4]&&JSON.stringify(path.points)===JSON.stringify(rig.features.find(feature=>feature.kind==='horn').points)), 'the horn comes from the native rig');
    for(const color of rig.animal.palette)assert.ok(probe.paints.includes(color),`native unicorn color ${color}`);
    assert.ok(probe.calls.length>100&&probe.calls.length<1000,`bounded escape drawing: ${probe.calls.length}`);
    assert.ok(probe.calls.flat().filter(value=>typeof value==='number').every(Number.isFinite));
    assert.deepEqual(probe.scales[0],[1.5*frame.scale,1.5*frame.scale]);
  }
});

test('unicorn travel and sparkles freeze with its audio clock and remain hidden in flight',()=>{
  const startedAt=33.5,from=getWitchCatFrame({performanceTime:startedAt});
  const state={capturedAnimals:{cat:{startedAt,from,unicorn:true}},catFrame:createWitchCatClock(startedAt+1.26)};
  const a=drawingProbe(),b=drawingProbe(),later=drawingProbe();
  const frame=drawWitchCat(a.context,{...state,performanceTime:99,time:0});
  assert.deepEqual(drawWitchCat(b.context,{...state,performanceTime:999,time:1e6,catMeow:1}),frame);
  assert.deepEqual(a.calls,b.calls,'wall time and the old cat meow cannot animate a frozen unicorn');
  drawWitchCat(later.context,{...state,catFrame:createWitchCatClock(startedAt+1.36)});
  assert.notDeepEqual(a.calls,later.calls,'advancing the owner clock animates its escape and sparkles');
  for(const flight of [{flightLift:1},{scene:'flight'}]) {
    const probe=drawingProbe();
    assert.equal(drawWitchCat(probe.context,{...state,...flight}).visible,false);
    assert.equal(probe.calls.length,0);assert.equal(getWitchCatTargets({...state,...flight}),null);
  }
});
