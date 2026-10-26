import test from 'node:test';
import assert from 'node:assert/strict';
import { WITCH_VISITORS, WITCH_ANIMAL_DIVE_DURATION, getWitchVisitors } from '../src/instruments/witch/witch-visitors-model.js';
import { drawWitchVisitors, getWitchVisitorTargets, hitTestWitchVisitors } from '../src/instruments/witch/witch-visitors.js';

function drawingProbe() {
  const calls=[];
  const context=new Proxy({globalAlpha:1},{get(target,key){
    if(key in target)return target[key];
    return (...args)=>calls.push([key,...args]);
  }});
  return {context,calls};
}

test('mouse and lizard use separate staggered visits and their own Quadruped gaits',()=>{
  assert.deepEqual(getWitchVisitors().map(frame=>frame.id),['mouse','lizard']);
  for(const visitor of WITCH_VISITORS) {
    const at=time=>getWitchVisitors({performanceTime:time}).find(frame=>frame.id===visitor.id);
    for(const time of [0,visitor.first-.001,visitor.first+visitor.duration,visitor.first+visitor.period-.001])assert.equal(at(time).visible,false,`${visitor.id} ${time}`);
    const first=at(visitor.first+visitor.duration/2),second=at(visitor.first+visitor.period+visitor.duration/2);
    assert.equal(first.active,true);assert.equal(first.visible,true);
    assert.ok(Math.abs(second.x-first.x)<1e-9);assert.ok(Math.abs(second.y-first.y)<1e-9);assert.equal(second.direction,-first.direction);
    assert.equal(first.source,'quadruped');assert.equal(first.behaviorId,visitor.behaviorId);
    assert.deepEqual(getWitchVisitors({performanceTime:first.clockTime,audioOn:true,handTime:1000}),getWitchVisitors({performanceTime:first.clockTime,audioOn:false,handTime:0}));
  }
});

test('lizard hangs from the ceiling and mouse rounds the left and bottom edges in both directions',()=>{
  for(const visitor of WITCH_VISITORS) {
    const at=(progress,visit=0)=>getWitchVisitors({performanceTime:visitor.first+visit*visitor.period+progress*visitor.duration}).find(frame=>frame.id===visitor.id);
    for(const progress of [.18,.42,.75]) {
      const forward=at(progress),reverse=at(1-progress,1);
      assert.ok(Math.abs(forward.x-reverse.x)<1e-8);assert.ok(Math.abs(forward.y-reverse.y)<1e-8);
      assert.ok(Math.abs(forward.rotation-reverse.rotation)<1e-8);assert.equal(forward.direction,-reverse.direction);
      for(const visit of [0,1]) {
        const frame=at(progress,visit),next=at(progress+.001,visit);
        const facingX=Math.cos(frame.rotation)*frame.direction,facingY=Math.sin(frame.rotation)*frame.direction;
        assert.ok((next.x-frame.x)*facingX+(next.y-frame.y)*facingY>0,`${visitor.id} faces its crawl`);
      }
    }
    if(visitor.id==='lizard') {
      assert.equal(at(.5).rotation,Math.PI);assert.equal(at(.5).y,14);assert.ok(Math.abs(at(.5).x-500)<1e-8);
    } else {
      assert.equal(at(.18).rotation,Math.PI/2);assert.equal(at(.18).x,10);
      assert.ok(at(.42).rotation>0&&at(.42).rotation<Math.PI/2);
      assert.equal(at(.75).rotation,0);assert.equal(at(.75).y,visitor.ground);
      let previous=at(.05);
      for(let progress=.051;progress<.95;progress+=.001) {
        const frame=at(progress);
        assert.ok(Math.hypot(frame.x-previous.x,frame.y-previous.y)<2,'continuous route through the corner');
        assert.ok(Math.abs(frame.rotation-previous.rotation)<.025,'continuous body rotation');
        previous=frame;
      }
    }
  }
});

test('visitor geometry and native pick targets follow their bodies in both directions',()=>{
  for(const visitor of WITCH_VISITORS)for(const visit of [0,1])for(const progress of [.18,.42,.75]) {
    const state={performanceTime:visitor.first+visit*visitor.period+visitor.duration*progress};
    const targets=getWitchVisitorTargets(state)[visitor.id];assert.ok(targets);
    for(const target of Object.values(targets)) {
      assert.ok(target.x>0&&target.x<1000&&target.y>0&&target.y<720,'body and head remain inside the frame');
      assert.deepEqual(hitTestWitchVisitors(target.x,target.y,state),{type:'animal',id:visitor.id});
    }
    assert.equal(hitTestWitchVisitors(500,350,state),null);
    const probe=drawingProbe(),frames=drawWitchVisitors(probe.context,state);
    assert.ok(frames.find(frame=>frame.id===visitor.id).visible);
    assert.ok(probe.calls.length>50&&probe.calls.length<800,`bounded ${visitor.id} drawing: ${probe.calls.length}`);
    assert.ok(probe.calls.flat().filter(value=>typeof value==='number').every(Number.isFinite));
  }
});

test('capture is one continuous Play-clock dive and an old record never consumes the next visit',()=>{
  for(const visitor of WITCH_VISITORS)for(const visit of [0,1]) {
    const time=visitor.first+visit*visitor.period+visitor.duration*.42;
    const before=getWitchVisitors({performanceTime:time}).find(frame=>frame.id===visitor.id);
    const record=Object.freeze({startedAt:time,from:Object.freeze({x:before.x,y:before.y,rotation:before.rotation,direction:before.direction})});
    const state={performanceTime:time,capturedAnimals:Object.freeze({[visitor.id]:record})};
    const start=getWitchVisitors(state).find(frame=>frame.id===visitor.id);
    assert.equal(start.x,before.x);assert.equal(start.y,before.y);assert.equal(start.captured,true);assert.equal(start.diving,true);
    assert.equal(start.rotation,before.rotation);assert.equal(start.direction,before.direction);
    assert.equal(getWitchVisitorTargets(state)[visitor.id],undefined);
    assert.equal(hitTestWitchVisitors(before.x,before.y,state),null);
    const middle=getWitchVisitors({...state,performanceTime:time+WITCH_ANIMAL_DIVE_DURATION/2}).find(frame=>frame.id===visitor.id);
    assert.ok(Math.abs(middle.x-(start.x+600)/2)<1e-8);assert.ok(middle.y<544);assert.ok(middle.scale<1);
    assert.ok(Math.abs(middle.rotation-(before.rotation+before.direction*(-.7+.25*1.35)))<1e-8);
    assert.equal(middle.direction,before.direction);
    if(visitor.id==='lizard')for(const offset of [.05,.15,.3]) {
      assert.ok(getWitchVisitors({...state,performanceTime:time+offset}).find(frame=>frame.id===visitor.id).y>=before.y,'ceiling capture dives into the frame');
    }
    assert.deepEqual(getWitchVisitors({...state,time:99999}),getWitchVisitors(state),'stopped Play freezes the capture');
    for(const offset of [WITCH_ANIMAL_DIVE_DURATION+.01,visitor.duration,visitor.period-.01]) {
      const frame=getWitchVisitors({...state,performanceTime:Math.min(time+offset,before.visitStartedAt+visitor.period-.001)}).find(frame=>frame.id===visitor.id);
      assert.equal(frame.captured,true);assert.equal(frame.visible,false);assert.equal(frame.diving,false);
    }
    const next=getWitchVisitors({...state,performanceTime:time+visitor.period}).find(frame=>frame.id===visitor.id);
    assert.equal(next.captured,false);assert.equal(next.visible,true);
  }
});

test('a late capture completes its arc after the natural crossing has ended',()=>{
  for(const visitor of WITCH_VISITORS) {
    const startedAt=visitor.first+visitor.duration-.1;
    const state={performanceTime:startedAt+.3,capturedAnimals:{[visitor.id]:{startedAt,from:{x:850,y:visitor.ground}}}};
    const frame=getWitchVisitors(state).find(frame=>frame.id===visitor.id);
    assert.equal(frame.diving,true);assert.equal(frame.visible,true);
    assert.equal(getWitchVisitors({...state,performanceTime:startedAt+1}).find(frame=>frame.id===visitor.id).visible,false);
  }
});

test('flight hides visitors and picks while visits continue; invalid captures cannot make phantom animals',()=>{
  for(const visitor of WITCH_VISITORS) {
    const time=visitor.first+visitor.duration/2,state={performanceTime:time},flight={...state,flightLift:1};
    const a=getWitchVisitors(state).find(frame=>frame.id===visitor.id),b=getWitchVisitors(flight).find(frame=>frame.id===visitor.id);
    assert.equal(a.visible,true);assert.equal(b.visible,false);
    for(const key of ['visit','position','progress','x','y'])assert.equal(a[key],b[key]);
    assert.equal(getWitchVisitorTargets(flight)[visitor.id],undefined);assert.equal(hitTestWitchVisitors(a.x,a.y,flight),null);
    const probe=drawingProbe();drawWitchVisitors(probe.context,flight);assert.equal(probe.calls.length,0);
    for(const record of [{startedAt:NaN,from:{x:500,y:700}},{startedAt:time+1,from:{x:500,y:700}},{startedAt:time,from:{x:Infinity,y:700}}]) {
      assert.deepEqual(getWitchVisitors({...state,capturedAnimals:{[visitor.id]:record}}),getWitchVisitors(state));
    }
  }
  for(const performanceTime of [-1,NaN,Infinity,undefined])assert.ok(getWitchVisitors({performanceTime}).every(frame=>!frame.visible));
  for(let performanceTime=0;performanceTime<600;performanceTime+=.17) {
    const frames=getWitchVisitors({performanceTime});assert.equal(frames.length,2);
    for(const frame of frames)for(const value of Object.values(frame).filter(value=>typeof value==='number'))assert.ok(Number.isFinite(value));
  }
});
