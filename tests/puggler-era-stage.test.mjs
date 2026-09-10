import test from 'node:test';
import assert from 'node:assert/strict';
import { PugglerModel } from '../src/puggler.js';
import { drawSkinPerformer, futureStageMotion } from '../src/puggler-skin-renderer.js';
import { LIGHTING_SCENES, lightingState } from '../src/puggler-lighting.js';

test('historical skin tones swap on the actual drawn palms while the medieval rider keeps hers',()=>{
  const model=new PugglerModel({cast:'trio'}),expected=[['#e0b69a','#865f55'],['#cfad84','#624c43'],['#bb855d','#63483c']];
  for(const owner of [0,1,2]){
    let palm=false;const fills=[],edges=[];
    const methods={beginPath(){palm=false;},ellipse(_x,_y,rx,ry){palm=rx===14&&ry===9;},fill(){if(palm)fills.push(c.fillStyle);},stroke(){if(palm)edges.push(c.strokeStyle);}};
    const c=new Proxy({}, {get:(target,key)=>methods[key]??target[key]??(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
    drawSkinPerformer(c,model,owner,1,'history');
    assert.deepEqual(fills,[expected[owner][0],expected[owner][0]]);
    assert.deepEqual(edges,[expected[owner][1],expected[owner][1]]);
  }
});

test('future reactor motion is bounded, deterministic, smooth and responds locally to catches',()=>{
  for(const [w,h] of [[1030,612],[370,480],[844,390]]){
    const view={oy:h-56},rest={time:9,activePlayers:[{lastCatch:-10}]};
    const a=futureStageMotion(rest,w,h,view),b=futureStageMotion({...rest,time:9.016},w,h,view);
    assert.deepEqual(futureStageMotion(rest,w,h,view),a);
    assert.equal(a.satellites.length,9);assert.equal(a.pods.length,3);
    for(const [i,dot] of a.satellites.entries()){
      assert.ok(dot.x>0&&dot.x<w&&dot.y>0&&dot.y<h);
      assert.ok(Math.hypot(dot.x-b.satellites[i].x,dot.y-b.satellites[i].y)<2);
    }
    const contact=futureStageMotion({...rest,activePlayers:[{lastCatch:8.55}]},w,h,view);
    assert.ok(contact.satellites.every((dot,i)=>dot.r>a.satellites[i].r&&dot.r<=5));
    // Contact intensity changes emitter size, not the camera or whole stage.
    assert.equal(contact.center,a.center);assert.equal(contact.cy,a.cy);assert.deepEqual(contact.pods,a.pods);
    for(let step=0;step<600;step++){
      const time=step/60,state=futureStageMotion({time,activePlayers:[{lastCatch:Math.floor(time*20)/20}]},w,h,view);
      assert.ok(state.satellites.every(dot=>[dot.x,dot.y,dot.r].every(Number.isFinite)&&dot.r>=3.5&&dot.r<=5));
      assert.ok(state.pods.every(pod=>[pod.x,pod.y,pod.angle].every(Number.isFinite)&&Math.abs(pod.angle)<=.24));
    }
  }
});

test('future lighting is fluorescent across the existing four looks while intensity stays gentle',()=>{
  const model={time:10,activePlayers:[{lastCatch:9.4}]},view={oy:556};
  for(const scene of LIGHTING_SCENES){
    const state=lightingState(1030,612,model,view,scene.id,'future');
    const next=lightingState(1030,612,{...model,time:10.016},view,scene.id,'future');
    for(const [i,beam] of state.beams.entries()){
      const channels=beam.color.slice(1).match(/../g).map(value=>parseInt(value,16));
      assert.ok(Math.max(...channels)-Math.min(...channels)>130);
      assert.ok(beam.alpha<=.15&&Math.abs(beam.alpha-next.beams[i].alpha)<.003);
    }
  }
  assert.ok(lightingState(1030,612,model,view,'house','future').beams[0].alpha>lightingState(1030,612,model,view,'house','history').beams[0].alpha);
});
