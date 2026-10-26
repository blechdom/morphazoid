import test from 'node:test';
import assert from 'node:assert/strict';
import {hitTestWitch, getFingerTips, getWitchLadle, getWitchTargets, handTransform, transformHandPoint, warpWitchPoint, WITCH_LAYOUT} from '../src/instruments/witch/witch-renderer.js';

test('the same world exposes moon, mushrooms and cauldron in every activity',()=>{
  for(const scene of ['brew','fingers','flight']) {
    const state={scene,handReach:0};
    assert.equal(hitTestWitch(800,164,state)?.type,'moon');
    assert.equal(hitTestWitch(162,639,state)?.type,'mushrooms');
    assert.equal(hitTestWitch(846,655,state)?.type,'mushrooms');
    assert.equal(hitTestWitch(600,520,state)?.type,'stir');
  }
  assert.equal(hitTestWitch(388,450,{scene:'brew'})?.type,'hand');
  assert.equal(hitTestWitch(NaN,450),null);
  assert.equal(hitTestWitch(-5,450),null);
});

test('mushroom deformation has an exact inverse and preserves direct targets',()=>{
  for(let trip=0;trip<4;trip++) for(const warpTime of [0,.2,1.7,129.8]) {
    const state={scene:'brew',trip,warpTime};
    for(const point of [WITCH_LAYOUT.moon,WITCH_LAYOUT.hand,...WITCH_LAYOUT.mushrooms,{x:600,y:520}]) {
      const visible=warpWitchPoint(point,state), restored=warpWitchPoint(visible,state,true);
      assert.ok(Math.abs(restored.x-point.x)<1e-10); assert.equal(restored.y,point.y);
      assert.deepEqual(hitTestWitch(visible.x,visible.y,state),hitTestWitch(point.x,point.y,{scene:'brew'}));
    }
  }
});

test('the extended hand shares the actual projected tips with touch picking',()=>{
  const state={scene:'fingers',handReach:1,handWrist:{x:590,y:590},handTips:[{index:0,x:424,y:320},{index:1,x:500,y:220},{index:2,x:590,y:185},{index:3,x:680,y:245},{index:4,x:730,y:350}]};
  for(let trip=0;trip<4;trip++) {
    state.trip=trip;state.warpTime=2.4;
    for(const tip of getFingerTips(state)) {
      const p=warpWitchPoint(tip,state);
      assert.deepEqual(hitTestWitch(p.x,p.y,state),{type:'finger',index:tip.index});
    }
  }
  const tucked=handTransform({...state,handReach:0});
  assert.equal(tucked.scale,.19);
  assert.ok(Math.abs(state.handWrist.x*tucked.scale+tucked.x-388)<1e-10);
  assert.ok(Math.abs(state.handWrist.y*tucked.scale+tucked.y-450)<1e-10);
});


test('both wrists, angled fingertips and inverse drags share their model transforms',()=>{
  for(const reach of [0,.3,.7,1]) for(const index of [0,1]) {
    const state={handReach:reach,handWrists:[{x:590,y:590},{x:588,y:593}],radius:.6,ladleAngle:1.7};
    const t=handTransform(state,index);
    assert.deepEqual(transformHandPoint(state.handWrists[index],state,index),t.wrist);
    for(const point of [{x:530,y:300},{x:700,y:200},{x:580,y:410}]) {
      const view=transformHandPoint(point,state,index);
      const local=transformHandPoint(view,state,index,true);
      assert.ok(Math.abs(local.x-point.x)<1e-10);
      assert.ok(Math.abs(local.y-point.y)<1e-10);
    }
    if(index===0) assert.ok(Math.abs(t.rotation-reach*55*Math.PI/180)<1e-12);
    else assert.equal(t.mirror,-1);
  }
  const state={handReach:1};
  assert.ok(Math.hypot(handTransform(state,0).wrist.x-handTransform(state,1).wrist.x,handTransform(state,0).wrist.y-handTransform(state,1).wrist.y)>150);
});


test('spoon and nose remain separate drag targets throughout automatic stirring',()=>{
  for(const spoonHeight of [0,.25,.5,.75,1]) for(let i=0;i<24;i++) {
    const state={scene:'brew',radius:1,phase:i*Math.PI/12,spoonHeight,nose:1,hitRadius:67};
    const ladle=getWitchLadle(state),nose=getWitchTargets(state).nose;
    assert.equal(hitTestWitch(ladle.hx-8,ladle.hy-24,state)?.type,'spoon');
    assert.equal(hitTestWitch(nose.x,nose.y,state)?.type,'nose');
  }
});
