import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchCatDSP } from '../src/instruments/witch/witch-cat-audio.js';
import { createWitchCatClock, advanceWitchCatClock, snapshotWitchCatClock, WITCH_CAT_GAITS } from '../src/instruments/witch/witch-cat-model.js';
import { createQuadrupedState, quadrupedSequenceEvent } from '../src/instruments/quadruped/quadruped.js';

const RATE=8000;
function render(dsp,seconds,controls={},audible=true,playing=audible) {
  let energy=0,peak=0;
  for(let sample=0;sample<Math.round(seconds*RATE);sample++) {
    dsp.next(controls,audible,playing);
    assert.ok(Number.isFinite(dsp.left)&&Number.isFinite(dsp.right));
    energy+=dsp.left*dsp.left+dsp.right*dsp.right;
    peak=Math.max(peak,Math.abs(dsp.left),Math.abs(dsp.right));
  }
  return {energy,peak};
}

test('cat audio waits for its sample-clock visit and uses actual authored Quadruped contacts',()=>{
  for(const catGait of WITCH_CAT_GAITS) {
    const dsp=new WitchCatDSP(RATE),controls={catSpeed:1,catGait};
    dsp.syncTime(29.9);
    assert.equal(render(dsp,.09,controls).energy,0);
    assert.equal(dsp.triggerCount,0);
    let onsets=[];
    for(let sample=0;sample<Math.round(.35*RATE);sample++) {
      const count=dsp.triggerCount;
      dsp.next(controls,true,true);
      if(dsp.triggerCount!==count)onsets.push({position:dsp.clock.position,count:dsp.triggerCount-count});
    }
    const score=createQuadrupedState('cat',catGait);
    const expected=Array.from({length:17},(_,step)=>({step,count:quadrupedSequenceEvent(score,step).contacts.length}))
      .filter(event=>event.count>0);
    assert.deepEqual(onsets.map(event=>({step:Math.floor(event.position),count:event.count})),expected);
    const sound=render(dsp,.5,controls);
    assert.ok(sound.energy>.01,`${catGait} has contact sound`);
    assert.ok(sound.peak<.5,`${catGait} stays bounded`);
  }
});

test('crossing audio ends with bounded contact tails and does not fill the gap between visits',()=>{
  for(const catSpeed of [.5,1,2]) {
    const dsp=new WitchCatDSP(RATE),controls={catSpeed,catGait:'cat-prowl'};
    dsp.syncTime(createWitchCatClock(30,controls));
    assert.ok(render(dsp,7/catSpeed,controls).energy>1);
    const attacks=dsp.triggerCount;
    render(dsp,.65,controls);
    assert.equal(dsp.activeVoiceCount,0);
    assert.equal(render(dsp,1,controls).energy,0);
    assert.equal(dsp.triggerCount,attacks);
  }
});

test('mute releases voices while Play keeps time, and Stop freezes time and releases',()=>{
  const dsp=new WitchCatDSP(RATE),controls={catSpeed:1,catGait:'cat-prowl'};
  dsp.syncTime(31);
  render(dsp,.1,controls);
  assert.ok(dsp.activeVoiceCount>0);
  const beforeMute=dsp.time,attacks=dsp.triggerCount;
  render(dsp,.03,controls,false,true);
  assert.ok(dsp.time>beforeMute);
  assert.equal(dsp.activeVoiceCount,0);assert.equal(dsp.triggerCount,attacks);
  assert.equal(render(dsp,.1,controls,false,true).energy,0);
  assert.ok(render(dsp,.2,controls,true,true).energy>0);
  const beforeStop=dsp.time;
  render(dsp,.03,controls,false,false);
  assert.equal(dsp.time,beforeStop);assert.equal(dsp.activeVoiceCount,0);
  assert.equal(render(dsp,.1,controls,false,false).energy,0);
});

test('live preset edits and silent-to-audio handoff retain travel and gait clocks',()=>{
  const silent=createWitchCatClock();
  advanceWitchCatClock(silent,32,{catSpeed:1,catGait:'walk'});
  advanceWitchCatClock(silent,33,{catSpeed:2,catGait:'cat-gallop'});
  const snapshot=snapshotWitchCatClock(silent);
  const dsp=new WitchCatDSP(RATE);
  dsp.syncTime(snapshot);
  assert.deepEqual(dsp.clock,snapshot);
  dsp.next({catSpeed:.5,catGait:'tiptoe'},true,true);
  assert.ok(dsp.clock.progress>snapshot.progress);
  assert.ok(dsp.clock.progress-snapshot.progress<1/RATE);
  assert.ok(Math.abs(dsp.clock.position-snapshot.position-24/RATE)<1e-9);
  assert.equal(dsp.clock.gait,'tiptoe');
  assert.equal(dsp.triggerCount,0,'handoff does not replay earlier footfalls');
});

test('many visits reuse a fixed prepared bank and voice pool without runtime synthesis',()=>{
  const dsp=new WitchCatDSP(RATE),voices=dsp.voices,samples=dsp.samples;
  assert.equal(dsp.bank.size,8);assert.equal(voices.length,12);
  dsp.bank.get=()=>{throw new Error('runtime preparation is forbidden');};
  let peak=0;
  for(let visit=1;visit<=40;visit++) {
    const controls={catSpeed:2,catGait:WITCH_CAT_GAITS[visit%4]};
    dsp.syncTime(createWitchCatClock(visit*30,controls));
    peak=Math.max(peak,render(dsp,.4,controls).peak);
    assert.ok(dsp.activeVoiceCount<=12);
  }
  assert.equal(dsp.voices,voices);assert.equal(dsp.samples,samples);
  assert.equal(dsp.bank.size,8);assert.ok(peak>0&&peak<.5);
  render(dsp,.03,{},false,false);
  assert.equal(dsp.activeVoiceCount,0);
});
