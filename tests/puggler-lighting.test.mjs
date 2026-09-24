import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHTING_SCENES, lightingState, renderStageLighting, MAX_LIGHT_BEAMS, MAX_DISCO_SPOTS, FLASH_RATE_HZ } from '../src/instruments/puggler/puggler-lighting.js';
const model={time:10,activePlayers:[{lastCatch:9.5},{lastCatch:9.8},{lastCatch:9.9}]};
test('eleven lighting scenes have distinct, stronger but bounded geometry',()=>{
  const signatures=[];
  for(const [w,h] of [[1100,619],[390,219],[320,210]])for(const skin of ['punk','history','future'])for(const scene of LIGHTING_SCENES){
    const state=lightingState(w,h,model,{oy:h-40},scene.id,skin);
    assert.ok(state.beams.length>=3&&state.beams.length<=MAX_LIGHT_BEAMS);assert.ok(state.spots.length<=MAX_DISCO_SPOTS);
    for(const beam of state.beams){
      for(const key of ['x','y','tx','ty','spread','alpha'])assert.ok(Number.isFinite(beam[key]));
      assert.ok(beam.x>=0&&beam.x<=w&&beam.tx>=0&&beam.tx<=w);
      assert.ok(beam.y>=0&&beam.y<=h&&beam.ty>=0&&beam.ty<=h);
      assert.ok(beam.alpha>0&&beam.alpha<=.75);
    }
    assert.equal(state.flash,0);assert.equal(state.flashing,false);
    if(w===1100&&skin==='punk')signatures.push(JSON.stringify({...state,id:''}));
  }
  assert.equal(new Set(signatures).size,11);
  const house=lightingState(1000,600,model,{oy:550},'house'),party=lightingState(1000,600,model,{oy:550},'party');
  assert.ok(party.beams[0].alpha>house.beams[0].alpha*3);assert.equal(party.spots.length,24);
  assert.equal(lightingState(1000,600,model,{oy:550},'missing').id,'house');
});
test('contacts, motion speed and intensity have observable effects; reduced motion fixes the geometry',()=>{
  const get=(time,options={})=>lightingState(1000,600,{...model,time},{oy:550},'disco','future',options);
  const a=get(10),b=get(10.5),fast=get(10.5,{lightSpeed:2});
  assert.notDeepEqual(a.beams,b.beams);assert.notDeepEqual(fast.beams,b.beams);
  const calm=get(10,{reducedMotion:true}),later=get(11,{reducedMotion:true});
  assert.equal(calm.motion,0);assert.deepEqual(calm.beams.map(b=>b.tx),later.beams.map(b=>b.tx));
  assert.ok(a.energy>get(11).energy);
  assert.ok(get(10,{lightIntensity:0}).beams.every(b=>b.alpha===0));
  assert.ok(get(10,{lightIntensity:1}).beams[0].alpha>a.beams[0].alpha);
});
test('flashes require explicit consent, never exceed two shared pulses per second and obey reduced motion',()=>{
  assert.equal(FLASH_RATE_HZ,2);
  for(const id of ['strobe','chaos']){
    let pulses=0,last=false;
    for(let i=0;i<2000;i++){
      const m={time:i/1000,activePlayers:[]},get=options=>lightingState(1000,600,m,{oy:550},id,'punk',options);
      assert.equal(get({}).flash,0);assert.equal(get({allowFlashes:true,reducedMotion:true}).flash,0);
      const s=get({allowFlashes:true,lightSpeed:2.5}),active=s.flash>0;
      assert.ok(s.beams.every(b=>b.alpha<=.75));if(active&&!last)pulses++;last=active;
    }
    assert.equal(pulses,4);
  }
});
test('fixed beam/spot/facet budgets avoid blur and restore canvas state',()=>{
  let depth=0,shadows=0;const calls=[];
  const methods={save(){depth++;},restore(){depth--;},createLinearGradient(){return {addColorStop(){}};}};
  const c=new Proxy({}, {get:(target,key)=>methods[key]??target[key]??((...args)=>calls.push([key,...args])),set:(target,key,value)=>{if(key==='shadowBlur'&&value!==0)shadows++;target[key]=value;return true;}});
  for(const scene of LIGHTING_SCENES){calls.length=0;assert.equal(renderStageLighting(c,1000,600,model,{oy:550},scene.id,'future'),scene.id);assert.equal(depth,0);assert.ok(calls.length<220,`${scene.id}: ${calls.length}`);}
  assert.equal(shadows,0);assert.ok(!calls.some(call=>call[0]==='drawImage'));
});
