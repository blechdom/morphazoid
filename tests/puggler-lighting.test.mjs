import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHTING_SCENES, lightingState, renderStageLighting } from '../src/puggler-lighting.js';
const model={time:10,activePlayers:[{lastCatch:9.5},{lastCatch:9.8},{lastCatch:9.9}]};

test('the four selectable lighting scenarios have distinct finite bounded geometry',()=>{
  const signatures=[];
  for(const [w,h] of [[1030,612],[370,480],[510,400]])for(const skin of ['punk','history','future'])for(const scene of LIGHTING_SCENES){
    const state=lightingState(w,h,model,{oy:h-56},scene.id,skin);
    assert.ok(state.beams.length>=3&&state.beams.length<=4);
    for(const beam of state.beams){
      for(const key of ['x','y','tx','ty','spread','alpha'])assert.ok(Number.isFinite(beam[key]));
      assert.ok(beam.x>=0&&beam.x<=w&&beam.tx>=0&&beam.tx<=w);
      assert.ok(beam.y>=0&&beam.y<=h&&beam.ty>=0&&beam.ty<=h);
      assert.ok(beam.alpha>0&&beam.alpha<=.15);
    }
    if(w===1030&&skin==='punk')signatures.push(JSON.stringify(state));
  }
  assert.equal(new Set(signatures).size,4);
  assert.equal(lightingState(1000,600,model,{oy:550},'missing').id,'house');
});

test('contact envelopes and sweeps vary gently without a rapid global flash',()=>{
  const rest=lightingState(1000,600,{time:10,activePlayers:[]},{oy:550},'sweep');
  const hit=lightingState(1000,600,model,{oy:550},'sweep');
  assert.ok(hit.energy>rest.energy);
  const next=lightingState(1000,600,{...model,time:10.016},{oy:550},'sweep');
  for(let i=0;i<hit.beams.length;i++){
    assert.ok(Math.abs(hit.beams[i].alpha-next.beams[i].alpha)<.003);
    assert.ok(Math.abs(hit.beams[i].tx-next.beams[i].tx)<4);
  }
  const highRate=lightingState(1000,600,{time:10,activePlayers:Array.from({length:50},()=>({lastCatch:9.995}))},{oy:550},'blacklight');
  assert.ok(highRate.beams.every(beam=>beam.alpha<=.15));
});

test('lighting uses a fixed small drawing budget and restores the canvas state',()=>{
  let depth=0,shadows=0;const calls=[];
  const methods={save(){depth++;},restore(){depth--;},createLinearGradient(){return {addColorStop(){}};},createRadialGradient(){return {addColorStop(){}};}};
  const c=new Proxy({}, {get:(target,key)=>methods[key]??target[key]??((...args)=>calls.push([key,...args])),set:(target,key,value)=>{if(key==='shadowBlur'&&value!==0)shadows++;target[key]=value;return true;}});
  for(const scene of LIGHTING_SCENES){calls.length=0;assert.equal(renderStageLighting(c,1000,600,model,{oy:550},scene.id,'future'),scene.id);assert.equal(depth,0);assert.ok(calls.length<60);}
  assert.equal(shadows,0);assert.ok(!calls.some(call=>call[0]==='drawImage'));
});
