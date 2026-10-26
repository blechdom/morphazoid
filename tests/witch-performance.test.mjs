import test from 'node:test';
import assert from 'node:assert/strict';
import { createWitchRenderBudget, resizeWitchRenderBudget, sampleWitchRenderBudget } from '../src/instruments/witch/witch-performance.js';

test('raster detail fits the visible stage and stays bounded across orientation changes',()=>{
  const phone=createWitchRenderBudget({width:390,height:304,pixelRatio:3});
  assert.equal(phone.ceiling,.625);
  assert.equal(createWitchRenderBudget({width:1440,height:834,pixelRatio:2}).ceiling,1);
  assert.equal(createWitchRenderBudget({width:320,height:220,pixelRatio:1}).ceiling,.5);
  for(const width of [0,NaN,Infinity,1,4000]) {
    resizeWitchRenderBudget(phone,{width,height:390,pixelRatio:3});
    assert.ok(phone.scale>=.5&&phone.scale<=phone.ceiling&&phone.ceiling<=1);
  }
});

test('sustained paint pressure reduces raster work while transient stalls do not',()=>{
  const budget=createWitchRenderBudget();
  for(let i=0;i<10;i++)sampleWitchRenderBudget(budget,8,i*34);
  sampleWitchRenderBudget(budget,100,340);
  for(let i=11;i<30;i++)sampleWitchRenderBudget(budget,8,i*34);
  assert.equal(budget.scale,1,'one delayed frame does not degrade the scene');
  for(let i=30;i<160;i++)sampleWitchRenderBudget(budget,50,i*50);
  assert.equal(budget.scale,.5);
  assert.equal(budget.frameInterval,1000/24);
  const saved={...budget};
  assert.equal(sampleWitchRenderBudget(budget,NaN,9000),false);
  assert.deepEqual(budget,saved);
  for(let i=160;i<550;i++)sampleWitchRenderBudget(budget,5,i*50);
  assert.equal(budget.scale,1,'detail recovers gradually after load subsides');
  assert.equal(budget.frameInterval,1000/30);
});

test('resizing retains the established rendering pressure without changing musical settings',()=>{
  const budget=createWitchRenderBudget();
  for(let i=0;i<20;i++)sampleWitchRenderBudget(budget,30,i*50);
  assert.equal(budget.scale,.875);
  resizeWitchRenderBudget(budget,{width:390,height:304,pixelRatio:3});
  assert.ok(budget.scale<budget.ceiling);
  resizeWitchRenderBudget(budget,{width:1440,height:834,pixelRatio:2});
  assert.equal(budget.scale,.875);
  assert.ok(!('scene' in budget)&&!('speed' in budget)&&!('handMotion' in budget));
});
