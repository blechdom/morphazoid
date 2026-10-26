import test from 'node:test';
import assert from 'node:assert/strict';
import {createWitchFabricGesture,beginWitchFabricGesture,moveWitchFabricGesture,
  releaseWitchFabricGesture,advanceWitchFabricGesture} from '../src/instruments/witch/witch-fabric-gesture.js';
import {fabricGesturePull} from '../src/instruments/moire-drone/moire-drone.js';

function bounded(state) {
  for(const value of Object.values(state.visual))assert.ok(Number.isFinite(value));
  for(const value of Object.values(state.audio))assert.ok(Number.isFinite(value)&&value>=0&&value<=1);
  assert.ok(state.visual.fabricGrabX>=0&&state.visual.fabricGrabX<=1);
  assert.ok(state.visual.fabricGrabY>=0&&state.visual.fabricGrabY<=1);
  assert.ok(Math.abs(state.visual.fabricPullX)<=340);assert.ok(Math.abs(state.visual.fabricPullY)<=240);
  assert.ok(Math.abs(state.visual.fabricVelocityX)<=2400);assert.ok(Math.abs(state.visual.fabricVelocityY)<=1800);
}

test('native anchored strain holds the grabbed point while stationary velocity fades',()=>{
  const state=createWitchFabricGesture();beginWitchFabricGesture(state,{x:250,y:180},1000);
  assert.equal(state.visual.fabricGrabX,.25);assert.equal(state.visual.fabricGrabY,.25);
  assert.equal(state.audio.fabricPull,.18);
  moveWitchFabricGesture(state,{x:430,y:100},1100);
  assert.equal(state.visual.fabricPullX,180);assert.ok(Math.abs(state.visual.fabricPullY+80)<1e-10);
  const native=fabricGesturePull({anchorX:-.5,anchorY:-.5,currentX:430/500-1,currentY:100/360-1});
  assert.equal(state.audio.fabricPull,Math.abs(native.amount));
  const speed=state.audio.fabricVelocity;
  for(let i=0;i<60;i++)advanceWitchFabricGesture(state,1/60);
  assert.equal(state.visual.fabricPullX,180);assert.ok(Math.abs(state.visual.fabricPullY+80)<1e-10);
  assert.ok(state.audio.fabricVelocity<speed*.001);assert.equal(state.held,true);bounded(state);
});

test('capture beyond every frame edge stays consequential and bounded',()=>{
  for(const [anchor,point,sign] of [
    [{x:0,y:0},{x:-800,y:-600},-1],
    [{x:1000,y:720},{x:1800,y:1320},1],
  ]) {
    const state=createWitchFabricGesture();beginWitchFabricGesture(state,anchor,0);
    moveWitchFabricGesture(state,point,16);
    assert.equal(state.visual.fabricPullX,sign*340);assert.equal(state.visual.fabricPullY,sign*240);
    assert.ok(state.audio.fabricPull>.8);assert.ok(state.audio.fabricVelocity>.5);bounded(state);
    moveWitchFabricGesture(state,{x:NaN,y:Infinity},NaN);bounded(state);
    for(let i=0;i<20;i++){moveWitchFabricGesture(state,{x:i%2?1e12:-1e12,y:i%2?-1e12:1e12},i);bounded(state);}
    releaseWitchFabricGesture(state);
    for(let i=0;i<240;i++){advanceWitchFabricGesture(state,i%2?.005:.07);bounded(state);}
  }
});

test('released cloth oscillates through rest and decays without adding drag momentum',()=>{
  const state=createWitchFabricGesture();beginWitchFabricGesture(state,{x:500,y:360},0);
  moveWitchFabricGesture(state,{x:680,y:430},1000);
  advanceWitchFabricGesture(state,1);const held=structuredClone(state);
  releaseWitchFabricGesture(state);
  assert.equal(state.visual.fabricVelocityX,held.visual.fabricVelocityX);
  assert.equal(state.visual.fabricVelocityY,held.visual.fabricVelocityY);
  const first=structuredClone(state),halves=structuredClone(state);let crossed=false;
  for(let i=0;i<120;i++){
    advanceWitchFabricGesture(first,1/60);advanceWitchFabricGesture(halves,1/120);advanceWitchFabricGesture(halves,1/120);
    if(first.visual.fabricPullX<0)crossed=true;bounded(first);
  }
  assert.ok(crossed,'the released strain rebounds across its rest point');
  assert.ok(Math.abs(first.visual.fabricPullX-halves.visual.fabricPullX)<1e-8,'stable across frame partitions');
  for(let i=0;i<600;i++)advanceWitchFabricGesture(state,1/60);
  assert.deepEqual(state.audio,{fabricPull:0,fabricVelocity:0});
  assert.equal(state.visual.fabricPullX,0);assert.equal(state.visual.fabricPullY,0);
});

test('clicks make one small elastic pluck, quiet freezes it, and cancel clears it',()=>{
  const state=createWitchFabricGesture();beginWitchFabricGesture(state,{x:720,y:240},0);releaseWitchFabricGesture(state);
  assert.ok(state.audio.fabricPull>0);assert.ok(state.audio.fabricVelocity>0);
  const initial=structuredClone(state);releaseWitchFabricGesture(state);assert.deepEqual(state,initial);
  for(const dt of [0,-1,NaN,Infinity])advanceWitchFabricGesture(state,dt);
  assert.deepEqual(state,initial,'quiet and invalid frame times cannot move the fabric');
  advanceWitchFabricGesture(state,.05);assert.ok(state.visual.fabricPullY<0);assert.ok(Math.abs(state.visual.fabricPullY)<15);
  releaseWitchFabricGesture(state,{cancel:true});
  assert.equal(state.held,false);assert.deepEqual(state.audio,{fabricPull:0,fabricVelocity:0});
  for(const key of ['fabricPullX','fabricPullY','fabricVelocityX','fabricVelocityY'])assert.equal(state.visual[key],0);
  assert.equal(state.visual.fabricGrabX,.72);assert.equal(state.visual.fabricGrabY,1/3);
  const cancelled=structuredClone(state);moveWitchFabricGesture(state,{x:0,y:0},100);advanceWitchFabricGesture(state,.1);
  assert.deepEqual(state,cancelled,'late moves cannot resurrect a cancelled capture');
});

test('a fast flick releases more momentum than the same displacement held still',()=>{
  const flick=createWitchFabricGesture(),held=createWitchFabricGesture();
  for(const state of [flick,held]){beginWitchFabricGesture(state,{x:400,y:300},0);moveWitchFabricGesture(state,{x:600,y:370},30);}
  for(let i=0;i<30;i++)advanceWitchFabricGesture(held,1/60);
  releaseWitchFabricGesture(flick);releaseWitchFabricGesture(held);
  assert.equal(flick.visual.fabricPullX,held.visual.fabricPullX);
  assert.ok(flick.audio.fabricVelocity>held.audio.fabricVelocity*10);
  const still=structuredClone(held);advanceWitchFabricGesture(held,0);assert.deepEqual(held,still);
  advanceWitchFabricGesture(flick,.03);advanceWitchFabricGesture(held,.03);
  assert.ok(flick.visual.fabricPullX>held.visual.fabricPullX);bounded(flick);bounded(held);
});
