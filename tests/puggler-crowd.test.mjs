import test from 'node:test';
import assert from 'node:assert/strict';
import { CROWD_MEMBERS, MAX_CROWD_IMPULSES, PugglerCrowd } from '../src/puggler-crowd.js';

const catchAt=(time,drum='kick',id=0)=>({kind:'catch',time,drum,id});

test('five distinct rear-view listeners have different hand props and quiet independent fidgets',()=>{
  const crowd=new PugglerCrowd(),state=crowd.snapshot(1);
  assert.deepEqual(state.members.map(member=>member.head),['dread','kid','hat','curls','punk']);
  assert.deepEqual(state.members.map(member=>member.hand),['lighter','phone','palm','peace','horns']);
  assert.ok(state.members.every(member=>member.energy===0&&member.jump<=1.7));
  assert.equal(new Set(state.members.map(member=>member.sway)).size,5);
  assert.equal(new Set(CROWD_MEMBERS.map(member=>member.duration)).size,5);
});

test('a contact causes delayed movement with individual drum preference and bounce envelopes',()=>{
  const crowd=new PugglerCrowd();
  crowd.react([{kind:'throw',time:1,drum:'kick'}],1);
  assert.equal(crowd.snapshot(1).events,0);
  crowd.react([catchAt(1)],1);
  assert.equal(crowd.snapshot(1).members[0].energy,0);
  const beginning=crowd.snapshot(1.038).members;
  assert.ok(beginning[0].energy>0);
  assert.ok(beginning.slice(1).every(member=>member.energy===0));
  const middle=crowd.snapshot(1.2).members;
  assert.ok(middle[0].jump>10);
  assert.ok(new Set(middle.map(member=>member.energy)).size>2);
  const snare=new PugglerCrowd();snare.react([catchAt(1,'snare')],1);
  assert.ok(snare.snapshot(1.2).members[4].energy>0);
  assert.notDeepEqual(middle.map(member=>member.energy),snare.snapshot(1.2).members.map(member=>member.energy));
  assert.ok(crowd.snapshot(2).members.every(member=>member.energy===0));
});

test('catch and crowd responses remain bounded at rates beyond 1200 BPM',()=>{
  const crowd=new PugglerCrowd(),drums=['kick','snare','crash','tom','hat'];
  for(let frame=0;frame<1200;frame++) {
    const now=frame/120;
    const events=Array.from({length:10},(_,id)=>catchAt(now,drums[(id+frame)%5],id));
    if(frame%90===0)events.push({kind:frame%180?'crowd-boo':'crowd-woo',time:now,id:-1});
    crowd.react(events,now);
    const snapshot=crowd.snapshot(now);
    assert.ok(crowd.members.every(member=>member.pulses.length<=MAX_CROWD_IMPULSES));
    for(const member of snapshot.members) {
      for(const key of ['energy','jump','sway','tilt','arm','handAngle'])assert.ok(Number.isFinite(member[key]));
      assert.ok(member.energy>=0&&member.energy<=1.25);
      assert.ok(member.jump>=0&&member.jump<=40);
      assert.ok(Math.abs(member.sway)<=7&&Math.abs(member.tilt)<=.23);
      assert.ok(member.arm>=0&&member.arm<=30&&Math.abs(member.handAngle)<=.28);
    }
  }
  assert.ok(crowd.snapshot(12).members.every(member=>member.energy===0));
  assert.ok(crowd.members.every(member=>member.pulses.length===0));
});

test('interpolated and out-of-order contact timestamps do not reset the show',()=>{
  const crowd=new PugglerCrowd();
  crowd.react([catchAt(10)],10.01);crowd.snapshot(10.05);
  const events=crowd.events;
  crowd.react([{kind:'drop',time:10.048,id:1},catchAt(10.043,'snare',2)],10.06);
  assert.equal(crowd.events,events+2);
  assert.ok(crowd.members.some(member=>member.pulses.some(pulse=>pulse.time<10.04)));
  assert.ok(crowd.snapshot(10.2).members.some(member=>member.energy>0));
});

test('authoritative model-time rewinds clear old impulses on react and sampling',()=>{
  const crowd=new PugglerCrowd();
  crowd.react([catchAt(10)],10);crowd.snapshot(10.2);
  crowd.react([catchAt(0,'snare')],0);
  assert.equal(crowd.events,1);
  assert.ok(crowd.members.every(member=>member.pulses.every(pulse=>pulse.time<.2)));
  assert.ok(crowd.snapshot(.2).members[4].energy>0);
  crowd.snapshot(0);
  assert.equal(crowd.events,0);
  assert.ok(crowd.members.every(member=>member.pulses.length===0));
});

test('sampling rate cannot change event-driven movement, and disposal stops new responses',()=>{
  const dense=new PugglerCrowd(),sparse=new PugglerCrowd();
  for(const crowd of [dense,sparse])crowd.react([catchAt(1),catchAt(1.1,'snare')],1.1);
  for(let i=0;i<12;i++)dense.snapshot(1.1+i/120);
  assert.deepEqual(dense.snapshot(1.2),sparse.snapshot(1.2));
  dense.dispose();dense.react([catchAt(1.2)],1.2);
  const disposed=dense.snapshot(1.3);
  assert.equal(disposed.disposed,true);assert.equal(disposed.events,0);
  assert.ok(disposed.members.every(member=>member.energy===0));
});
