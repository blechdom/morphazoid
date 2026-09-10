import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PYRO_PARTICLES, PugglerPyro } from '../src/puggler-pyro.js';

const hit=(time,drum='kick',id=0)=>({kind:'catch',time,drum,id});
function firstBurst(){
  const pyro=new PugglerPyro();
  for(let i=0;i<8;i++)pyro.react([hit(.3+i*.5)],.3+i*.5);
  pyro.react([hit(5.3)],5.3);
  return pyro;
}

test('pyro waits for a contact phrase and a real drum accent after the initial cooldown',()=>{
  const empty=new PugglerPyro();
  empty.react([{kind:'crowd-woo',time:6},{kind:'throw',time:6}],6);
  assert.equal(empty.snapshot(6).bursts,0);
  for(let time=0;time<30;time+=.1)assert.equal(empty.snapshot(time).active,false);
  const pyro=new PugglerPyro();
  for(let i=0;i<7;i++)pyro.react([hit(.3+i*.5)],.3+i*.5);
  assert.equal(pyro.snapshot(5).bursts,0);
  pyro.react([hit(5.3)],5.3);
  const burst=pyro.snapshot(5.4);
  assert.equal(burst.bursts,1);assert.equal(burst.active,true);
  assert.ok(burst.nextBurstAt-5.3>=5.6&&burst.nextBurstAt-5.3<=10.8);
  assert.deepEqual(burst.jets.map(jet=>jet.side),[0,1]);
});

test('analytic spark fountains have bounded geometry, count and lifetime',()=>{
  const pyro=firstBurst();
  for(let time=5.3;time<6.7;time+=1/120){
    const state=pyro.snapshot(time);
    assert.ok(state.particleCount<=MAX_PYRO_PARTICLES);
    assert.ok(state.jets.length<=2);
    for(const spark of state.particles){
      for(const key of ['x','y','dx','dy','alpha','size'])assert.ok(Number.isFinite(spark[key]));
      assert.ok(spark.x>=.09&&spark.x<=.91);
      assert.ok(spark.y>=0&&spark.y<.26);
      assert.ok(spark.alpha>=0&&spark.alpha<=1);
      assert.ok(spark.size>=.85&&spark.size<=2.5);
    }
  }
  assert.equal(pyro.snapshot(6.7).active,false);
  assert.equal(pyro.sparks.length,0);
});

test('high event rates cannot overlap bursts or accumulate particles',()=>{
  const pyro=new PugglerPyro(),times=[];
  let prior=0;
  for(let i=0;i<7200;i++){
    const time=i/120;
    pyro.react(Array.from({length:10},(_,id)=>hit(time,id%2?'snare':'crash',id)),time);
    const state=pyro.snapshot(time);
    if(state.bursts!==prior){times.push(time);prior=state.bursts;}
    assert.ok(pyro.sparks.length<=MAX_PYRO_PARTICLES);
    assert.ok(state.particleCount<=MAX_PYRO_PARTICLES);
  }
  assert.ok(times.length>3&&times.length<12);
  for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]>=5.6);
});

test('pause rejects new accents while the current tail finishes',()=>{
  const pyro=firstBurst();
  assert.equal(pyro.snapshot(5.4).active,true);
  pyro.react([hit(5.5)],5.5,false);
  assert.equal(pyro.snapshot(5.5).active,true);
  for(let time=6;time<=20;time++)pyro.react([hit(time),{kind:'crowd-woo',time}],time,false);
  assert.equal(pyro.snapshot(20).bursts,1);
  assert.equal(pyro.snapshot(20).active,false);
  assert.equal(pyro.contacts,0);
});

test('sampling cadence and backdated catch times do not change or reset an active burst',()=>{
  const dense=firstBurst(),sparse=firstBurst();
  for(let i=0;i<12;i++)dense.snapshot(5.3+i/120);
  assert.deepEqual(dense.snapshot(5.5),sparse.snapshot(5.5));
  dense.react([hit(5.48)],5.51);
  assert.equal(dense.snapshot(5.52).bursts,1);
  dense.react([hit(0)],0);
  assert.equal(dense.snapshot(0).bursts,0);
  assert.equal(dense.sparks.length,0);
  assert.ok(dense.nextBurstAt>=5);
});

test('a hi-hat-only show still accents a completed phrase, and dispose releases all tails',()=>{
  const pyro=new PugglerPyro();
  for(let i=0;i<32;i++)pyro.react([hit(i*.2,'hat')],i*.2);
  assert.equal(pyro.snapshot(6.2).bursts,1);
  pyro.dispose();pyro.react(Array.from({length:30},()=>hit(20)),20);
  const state=pyro.snapshot(20);
  assert.equal(state.disposed,true);assert.equal(state.active,false);assert.equal(state.particleCount,0);
});
