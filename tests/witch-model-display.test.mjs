import test from 'node:test';
import assert from 'node:assert/strict';
import { witchHandQuality, witchSpiderQuality, witchHandSurfaceSize, createWitchHandPaintCache, sizeWitchModelTextures } from '../src/instruments/witch/witch-model-display.js';
import { evaluateWitchHandPose } from '../src/instruments/witch/witch-model.js';
import { createHandPose } from '../src/instruments/gesticulating-hand/hand-model.js';
import { handTransform } from '../src/instruments/witch/witch-renderer.js';

test('native hand surfaces follow visible scale with bounded allocations in ground, reach and flight',()=>{
  const mobile=witchHandQuality({maxWidth:560,textureSize:512});
  for(const handReach of [0,.4,1])for(const flightLift of [0,.5,1])for(const index of [0,1]) {
    const state={handReach,flightLift,renderScale:.5};
    const transform=handTransform(state,index),size=witchHandSurfaceSize(transform.scale,state.renderScale,mobile.maxWidth);
    assert.ok(size.width>=128&&size.width<=560);
    assert.equal(size.height,Math.round(size.width*.72));
    assert.ok(size.width>=Math.min(560,transform.scale*500),'visible hand is not scaled down twice');
    assert.deepEqual(handTransform(state,index),transform,'resolution never changes placement/picking');
  }
  assert.equal(witchHandSurfaceSize(1,.5,560).width,560);
  assert.equal(witchHandSurfaceSize(1,1,800).width,800);
  assert.deepEqual(witchHandSurfaceSize(.36,.5,560),witchHandSurfaceSize(.361,.5,560),'small scale changes reuse one allocation');
  assert.deepEqual(witchHandQuality({maxWidth:Infinity,frameInterval:-1,textureSize:1}),{maxWidth:800,frameInterval:0,textureSize:256});
  assert.deepEqual(witchSpiderQuality({size:10,frameInterval:300}),{size:96,frameInterval:100});
});

test('cached native poses invalidate for held thumb, source-grasp phase/offsets, glow and texture size',()=>{
  const cache=createWitchHandPaintCache(),pose=evaluateWitchHandPose({handMotion:0},1.2,0,createHandPose()),levels=[.3,.4,.5,.6,.7];
  assert.equal(cache.update(pose,levels,560),true);
  assert.equal(cache.update(pose,levels,560),false,'same stopped frame does no rendering');
  pose.fingers[0].spread+=1;
  assert.equal(cache.update(pose,levels,560),true,'manual thumb extension is not stale');
  assert.equal(cache.update(pose,levels,560,1),true,'held source thumb base rotation changes even with the same finger angles');
  pose.source={phase:.2,amount:.8,offsets:pose.fingers.map(finger=>({...finger}))};
  assert.equal(cache.update(pose,levels,560,1),true);
  assert.equal(cache.update(pose,levels,560,1),false);
  pose.source.phase+=.01;
  assert.equal(cache.update(pose,levels,560,1),true);
  pose.source.offsets[2].pip+=1;
  assert.equal(cache.update(pose,levels,560,1),true);
  levels[4]=.1;assert.equal(cache.update(pose,levels,560,1),true);
  assert.equal(cache.update(pose,levels,400,1),true,'resolution changes redraw');
  assert.equal(cache.update(pose,levels,400,1),false);
  cache.invalidate();assert.equal(cache.update(pose,levels,400,1),true,'restored contexts redraw unchanged poses');
});

test('model texture budgets retain shared native maps and close oversized bitmap sources once',()=>{
  let closes=0,draws=0;
  const image={width:2048,height:1024,close(){closes++;}},a={data:image},b={data:image};
  const map={isTexture:true,source:a},roughnessMap={isTexture:true,source:b},metalnessMap={isTexture:true,source:b};
  const root={traverse(fn){fn({material:[{map,roughnessMap,metalnessMap}]});}};
  const doc={createElement(){return {width:0,height:0,getContext(){return {drawImage(original){assert.equal(original,image);draws++;}};}};}};
  const budget=sizeWitchModelTextures(root,512,doc);
  assert.equal(budget.texturePixels,512*256*2);assert.equal(budget.sourcePixels,2048*1024*2);
  assert.equal(draws,1);assert.equal(closes,1);assert.equal(a.data,b.data);
  assert.equal(map.needsUpdate,true);assert.equal(roughnessMap.needsUpdate,true);assert.equal(metalnessMap.needsUpdate,true);
  const unchanged=sizeWitchModelTextures(root,1024,doc);
  assert.equal(unchanged.texturePixels,budget.texturePixels,'resize never magnifies already loaded maps');
  assert.equal(draws,1);assert.equal(closes,1);
});
