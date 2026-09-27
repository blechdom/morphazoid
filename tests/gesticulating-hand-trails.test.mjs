import test from 'node:test';
import assert from 'node:assert/strict';
import {handTrailTiming,handTrailSize} from '../src/instruments/gesticulating-hand/hand-trails.js';

test('trails have a monotonic, bounded wall-time tail and a true zero',()=>{
  let prior=0;
  for(let step=0;step<=100;step++){
    const value=handTrailTiming(step/100);
    assert.ok(value.maxTailMs>=prior&&value.maxTailMs<=4000);prior=value.maxTailMs;
    assert.ok(value.strength>=0&&value.strength<=.72);
    if(step)assert.ok(Math.pow(.5,value.maxTailMs/value.halfLifeMs)<=1/256);
  }
  for(const input of [-1,0,NaN,undefined])assert.equal(handTrailTiming(input).maxTailMs,0);
  assert.deepEqual(handTrailTiming(Infinity),handTrailTiming(1));
});

test('history buffers fit desktop, phone and orientation budgets without upscaling',()=>{
  for(const [width,height] of [[1,1],[390,844],[844,390],[1440,900],[3840,2160],[128,8192]]){
    for(const compact of [false,true]){
      const [w,h]=handTrailSize(width,height,compact);
      assert.ok(w>=1&&h>=1&&w<=width&&h<=height);
      assert.ok(w*h<=(compact?180000:300000));assert.ok(Math.max(w,h)<=960);
      assert.ok(Math.abs(w/width-h/height)<1/Math.min(width,height)+.001);
    }
  }
});
