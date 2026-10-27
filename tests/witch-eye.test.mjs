import test from 'node:test';
import assert from 'node:assert/strict';
import { witchEyePose, witchEyeQuality } from '../src/instruments/witch/witch-eye.js';
import { getWitchMoon, hitTestWitch, warpWitchPoint } from '../src/instruments/witch/witch-renderer.js';

test('the real eye turns left/right and up/down with the same ladle cycle', () => {
  const state={speed:.65,radius:.8};
  const down=witchEyePose({...state,ladleAngle:0}),right=witchEyePose({...state,ladleAngle:Math.PI/2});
  const up=witchEyePose({...state,ladleAngle:Math.PI}),left=witchEyePose({...state,ladleAngle:Math.PI*1.5});
  assert.ok(down.pitch>.25&&up.pitch<-.25);
  assert.ok(right.yaw>.45&&left.yaw<-.45);
  assert.deepEqual(witchEyePose({...state,phase:1.3}),witchEyePose({...state,ladleAngle:1.3}));
  assert.deepEqual(witchEyePose({...state,phase:100,ladleAngle:1.3}),witchEyePose({...state,ladleAngle:1.3}),'a manual ladle overrides automatic phase');
  assert.ok(witchEyePose({speed:1,ladleAngle:Math.PI/2}).yaw>witchEyePose({speed:0,ladleAngle:Math.PI/2}).yaw);
});

test('eye pose and display budgets stay finite and bounded independently of audio state', () => {
  for(const angle of [0,1,100,NaN,Infinity])for(const speed of [0,.5,1,-1,NaN,Infinity]) {
    const pose=witchEyePose({phase:angle,speed,radius:1});
    assert.ok(Object.values(pose).every(Number.isFinite));
    assert.ok(Math.abs(pose.yaw)<=.63&&Math.abs(pose.pitch)<=.35&&Math.abs(pose.roll)<=.055);
  }
  assert.deepEqual(witchEyeQuality(),{size:160,textureSize:512,frameInterval:50});
  assert.deepEqual(witchEyeQuality({size:1,textureSize:8000,frameInterval:0}),{size:96,textureSize:1024,frameInterval:33});
});

test('the right-shifted eyeball and its stirring sway keep the moon flight gesture', () => {
  assert.deepEqual(getWitchMoon({}),{x:695,y:110,r:78});
  for(const phase of [0,Math.PI/2,Math.PI,Math.PI*1.5])for(const visualMode of [0,3,5]) {
    const state={phase,speed:1,radius:1,visualMode,warpTime:1.3};
    const moon=getWitchMoon(state),point=warpWitchPoint(moon,state);
    assert.ok(Math.abs(moon.x-695)<=10&&Math.abs(moon.y-110)<=6.5);
    assert.equal(hitTestWitch(point.x,point.y,state)?.type,'moon');
  }
});
