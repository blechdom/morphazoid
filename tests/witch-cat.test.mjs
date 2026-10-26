import test from 'node:test';
import assert from 'node:assert/strict';
import { drawWitchCat, getWitchCatFrame } from '../src/instruments/witch/witch-cat.js';

test('the Quadruped cat visits for seven seconds every thirty seconds of the owner clock',()=>{
  for(const time of [0,29.999,37,59.999,67,89.999]) assert.equal(getWitchCatFrame({performanceTime:time}).active,false,`${time}`);
  for(const time of [30,33.5,36.999,60,63.5,66.999,90]) assert.equal(getWitchCatFrame({performanceTime:time}).active,true,`${time}`);
  const first=getWitchCatFrame({performanceTime:33.5}),second=getWitchCatFrame({performanceTime:63.5});
  assert.equal(first.x,500);assert.equal(second.x,500);
  assert.equal(first.direction,1);assert.equal(second.direction,-1);
  assert.equal(first.animalId,'cat');assert.equal(first.behaviorId,'cat-prowl');
  assert.equal(first.y,700);
  assert.deepEqual(getWitchCatFrame({performanceTime:33.5,handTime:1000,audioOn:true}),first);
  assert.deepEqual(getWitchCatFrame({performanceTime:33.5,handTime:0,audioOn:false}),first);
  for(const time of [-1,NaN,Infinity,undefined]) assert.equal(getWitchCatFrame({performanceTime:time}).active,false);
});

function drawingProbe() {
  const calls=[];
  const context=new Proxy({globalAlpha:1},{get(target,key){
    if(key in target)return target[key];
    if(key==='createLinearGradient')return (...values)=>{calls.push(values);return {addColorStop(){}};};
    return (...values)=>{calls.push(values);};
  }});
  return {context,calls};
}

test('cat rendering remains finite and bounded, and inactive visits do no drawing work',()=>{
  for(const time of [0,29,37,59,67]) {
    const {context,calls}=drawingProbe();
    assert.equal(drawWitchCat(context,{performanceTime:time}).active,false);
    assert.equal(calls.length,0);
  }
  for(const time of [30.1,31,33.5,35.2,36.9,60.1,63.5,66.9]) {
    const {context,calls}=drawingProbe();
    assert.equal(drawWitchCat(context,{performanceTime:time}).active,true);
    assert.ok(calls.length>100&&calls.length<1000,`bounded drawing at ${time}: ${calls.length}`);
    assert.ok(calls.flat().filter(value=>typeof value==='number').every(Number.isFinite));
  }
});
