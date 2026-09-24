import test from 'node:test';
import assert from 'node:assert/strict';
import {drivingControls,GAME_KEYS} from '../src/instruments/puggler/puggler-controls.js';
test('shared arrows affect exactly the active cast and cancel when both are held',()=>{
  assert.deepEqual(drivingControls(new Set(['ArrowRight']),[200,500,800],[0,2]),[{steer:.7,height:0,target:null},{steer:0,height:0,target:null},{steer:.7,height:0,target:null}]);
  assert.deepEqual(drivingControls(new Set(['ArrowLeft','ArrowRight']),[200,500,800],[0,1,2]).map(c=>c.target),[200,500,800]);
  assert.equal(drivingControls(new Set(['KeyW','KeyD']),[],[0])[0].steer,0);
  assert.deepEqual([...GAME_KEYS],['ArrowLeft','ArrowRight','KeyG']);
});
