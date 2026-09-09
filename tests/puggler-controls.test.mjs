import test from 'node:test';
import assert from 'node:assert/strict';
import {drivingControls} from '../src/puggler-controls.js';
const controls=(keys,selected=0,targets=[null,null,null],held=[])=>drivingControls(new Set(keys),selected,targets,new Set(held),3);
test('gaming clusters distinguish slow and fast riding without arrow-key steering',()=>{
  assert.equal(controls(['KeyD'])[0].steer,.34);assert.equal(controls(['KeyE'])[0].steer,1);
  assert.equal(controls(['KeyA','KeyD'])[0].steer,0);assert.equal(controls(['KeyQ'])[0].steer,-1);
  assert.equal(controls(['ArrowRight'])[0].steer,0);
});
test('all three riders have independent simultaneous steering and throw-height controls',()=>{
  const result=controls(['KeyD','KeyW','KeyJ','KeyK','Numpad9','Numpad8']);
  assert.deepEqual(result.map(c=>c.steer),[.34,-.34,1]);assert.deepEqual(result.map(c=>c.height),[1,-1,1]);
});
test('rider selection makes Moss controllable without a numpad and buttons target that rider',()=>{
  const result=controls(['KeyA','KeyS'],2);
  assert.deepEqual(result.map(c=>c.steer),[0,0,-.34]);assert.deepEqual(result.map(c=>c.height),[0,0,-1]);
  assert.equal(controls([],2,[],['fastRight','up'])[2].steer,1);assert.equal(controls([],2,[],['fastRight','up'])[2].height,1);
});
test('direct steering replaces only that rider’s pointer target',()=>{
  const result=controls(['KeyD'],0,[300,500,800]);assert.equal(result[0].target,null);assert.equal(result[1].target,500);assert.equal(result[2].target,800);
});
