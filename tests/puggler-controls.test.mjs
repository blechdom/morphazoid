import test from 'node:test';
import assert from 'node:assert/strict';
import {drivingControls} from '../src/puggler-controls.js';
const controls=(keys,active=[0,1,2],targets=[null,null,null])=>drivingControls(new Set(keys),targets,active);
test('gaming clusters distinguish slow and fast riding without arrow-key steering',()=>{
  assert.equal(controls(['KeyD'])[0].steer,.34);assert.equal(controls(['KeyE'])[0].steer,1);
  assert.equal(controls(['KeyA','KeyD'])[0].steer,0);assert.equal(controls(['KeyQ'])[0].steer,-1);
  assert.equal(controls(['ArrowRight'])[0].steer,0);
});
test('all three riders have fixed independent simultaneous steering and height controls',()=>{
  const result=controls(['KeyD','KeyW','KeyJ','KeyK','Numpad9','Numpad8']);
  assert.deepEqual(result.map(c=>c.steer),[.34,-.34,1]);assert.deepEqual(result.map(c=>c.height),[1,-1,1]);
});
test('solo Moss and Roxy retain their physical clusters and inactive keys cannot move them',()=>{
  assert.deepEqual(controls(['KeyE','KeyL','Numpad9'],[2]).map(c=>c.steer),[0,0,1]);
  assert.deepEqual(controls(['KeyA','KeyK','Numpad4'],[1]).map(c=>c.height),[0,-1,0]);
});
test('direct steering replaces only that rider’s pointer target',()=>{
  const result=controls(['KeyD'],[0,1,2],[300,500,800]);assert.equal(result[0].target,null);assert.equal(result[1].target,500);assert.equal(result[2].target,800);
});
