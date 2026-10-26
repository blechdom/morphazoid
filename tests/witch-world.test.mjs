import test from 'node:test';
import assert from 'node:assert/strict';
import {hitTestWitch, getFingerTips, getWitchLadle, getWitchObjectPosition, getWitchTargets, handTransform, transformHandPoint, warpWitchPoint, WITCH_LAYOUT} from '../src/instruments/witch/witch-renderer.js';

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
    else {
      assert.equal(t.mirror,-1);
      assert.ok(Math.abs(t.rotation-(-.38+Math.PI/2))<1e-12);
      assert.ok(Math.abs(t.scale-.23*1.25)<1e-12);
    }
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

test('every floating ingredient stays pickable through mist, flight and mushroom warping',()=>{
  assert.deepEqual(WITCH_LAYOUT.objects.map(object=>object.id),[
    'glass','tail','earwax','eyeball','newt','hair','roach','spider','oculoid','rubix','hiccup','gesticules','marimba','choir',
  ]);
  for(const scene of ['brew','flight'])for(const hitRadius of [46,67,80])for(let trip=0;trip<4;trip++)for(const time of [0,1,4,17,39]) {
    const state={scene,handReach:1,flightLift:scene==='flight'?1:0,hitRadius,trip,time,warpTime:time};
    for(const [index,object] of WITCH_LAYOUT.objects.entries()) {
      const visible=getWitchObjectPosition(object,state),point=warpWitchPoint(visible,state);
      assert.ok(point.x>15&&point.x<985&&point.y>75&&point.y<705,`${object.id} remains inside the scene`);
      assert.deepEqual(hitTestWitch(point.x,point.y,state),{type:'object',id:object.id,kind:object.kind,index});
    }
  }
});

test('ingredient touch halos preserve scenery targets and choose the nearest object',()=>{
  for(const time of [0,1,4,17,39]) {
    const state={time,handReach:1,hitRadius:80};
    for(const [point,type] of [[WITCH_LAYOUT.moon,'moon'],...WITCH_LAYOUT.mushrooms.map(point=>[point,'mushrooms']),
      ...WITCH_LAYOUT.ghosts.map(point=>[point,'ghost']),...WITCH_LAYOUT.bats.map(point=>[point,'bat'])]) {
      assert.equal(hitTestWitch(point.x,point.y,state)?.type,type,`${type} at ${point.x},${point.y}`);
    }
  }
  const objects=WITCH_LAYOUT.objects.map(object=>({...object,dropped:true}));
  objects[0]={...objects[0],x:140,y:100,dragging:true,dropped:false};
  objects[1]={...objects[1],x:200,y:100,dragging:true,dropped:false};
  const state={objects,hitRadius:80};
  assert.equal(hitTestWitch(193,100,state)?.id,'tail');
  assert.equal(hitTestWitch(148,100,state)?.id,'glass');
  assert.equal(hitTestWitch(200,156,state)?.id,'tail');
  objects[1].dropped=true;
  assert.equal(hitTestWitch(193,100,state)?.id,'glass');
});

test('the tone firefly follows brightness and remains separate from the bat and spark',()=>{
  for(const tone of [0,.25,.5,.75,1])for(const hitRadius of [46,67,80])for(let trip=0;trip<4;trip++) {
    const state={tone,trip,warpTime:1.4,hitRadius},target=getWitchTargets(state).tone;
    assert.equal(target.y,235-tone*130);
    const point=warpWitchPoint(target,state);
    assert.deepEqual(hitTestWitch(point.x,point.y,state),{type:'tone'});
    for(const [point,type] of [[WITCH_LAYOUT.bats[0],'bat'],[WITCH_LAYOUT.spirits[0],'spark']]) {
      const visible=warpWitchPoint(point,state);
      assert.equal(hitTestWitch(visible.x,visible.y,state)?.type,type);
    }
  }
});
