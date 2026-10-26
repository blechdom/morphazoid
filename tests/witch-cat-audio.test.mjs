import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchCatDSP } from '../src/instruments/witch/witch-cat-audio.js';
import { createWitchCatClock, advanceWitchCatClock, snapshotWitchCatClock, WITCH_CAT_GAITS } from '../src/instruments/witch/witch-cat-model.js';
import { createQuadrupedState, quadrupedSequenceEvent } from '../src/instruments/quadruped/quadruped.js';

const RATE=8000;
function render(dsp,seconds,controls={},audible=true,playing=audible) {
  let energy=0,peak=0;
  for(let sample=0;sample<Math.round(seconds*dsp.sampleRate);sample++) {
    dsp.next(controls,audible,playing);
    assert.ok(Number.isFinite(dsp.left)&&Number.isFinite(dsp.right));
    assert.ok(Number.isFinite(dsp.meowLeft)&&Number.isFinite(dsp.meowRight));
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

test('clicked cat has a finite bounded meow without changing its feet or travel clock',()=>{
  for(const rate of [8000,48000]) {
    const meow=new WitchCatDSP(rate),feet=new WitchCatDSP(rate);
    meow.syncTime(31);feet.syncTime(31);
    assert.equal(meow.triggerMeow(),true);
    let meowEnergy=0,feetEnergy=0,peak=0,attackPeak=0,bodyPeak=0;
    for(let sample=0;sample<rate;sample++) {
      meow.next({},true,true);feet.next({},true,true);
      assert.equal(meow.left,feet.left);assert.equal(meow.right,feet.right);
      const amplitude=Math.max(Math.abs(meow.meowLeft),Math.abs(meow.meowRight));
      assert.ok(Number.isFinite(amplitude));
      assert.ok(meow.meowEnvelope>=0&&meow.meowEnvelope<=1);
      if(sample===0)assert.equal(amplitude,0,'attack begins at zero');
      if(sample>=rate*.851)assert.equal(amplitude,0,'meow ends within its bounded duration');
      if(sample<rate*.01)attackPeak=Math.max(attackPeak,amplitude);
      if(sample>rate*.04&&sample<rate*.4)bodyPeak=Math.max(bodyPeak,amplitude);
      meowEnergy+=meow.meowLeft**2+meow.meowRight**2;
      feetEnergy+=feet.left**2+feet.right**2;peak=Math.max(peak,amplitude);
    }
    assert.ok(meowEnergy/rate>.0005&&peak<.34);
    assert.ok(attackPeak<bodyPeak*.3,'short soft onset precedes the vowel');
    assert.ok(meowEnergy*.9**2>feetEnergy*.3**2*4,'head voice is featured above feet in the mix');
    assert.deepEqual(meow.clock,feet.clock);assert.equal(meow.triggerCount,feet.triggerCount);
    assert.equal(meow.meow.active,false);assert.equal(meow.meowEnvelope,0);
  }
});

test('rapid clicks coalesce through a smooth fade using one fixed meow voice',()=>{
  const dsp=new WitchCatDSP(RATE),reference=new WitchCatDSP(RATE);
  dsp.syncTime(31);reference.syncTime(31);dsp.triggerMeow();reference.triggerMeow();
  render(dsp,.2);render(reference,.2);
  const voice=dsp.meow,formants=voice.formants,feet=dsp.voices;
  for(let click=0;click<1000;click++)assert.equal(dsp.triggerMeow(),true);
  assert.equal(voice.pending,true);
  dsp.next({},true,true);reference.next({},true,true);
  assert.ok(Math.abs(dsp.meowLeft-reference.meowLeft)<.0002,'retrigger does not reset a nonzero sample');
  for(let click=0;click<300;click++) {
    dsp.triggerMeow();render(dsp,.001);
    assert.ok(Math.abs(dsp.meowLeft)<.34&&Math.abs(dsp.meowRight)<.34);
    assert.equal(dsp.meow,voice);assert.equal(dsp.meow.formants,formants);assert.equal(dsp.voices,feet);
  }
  render(dsp,.9);
  assert.equal(voice.active,false);assert.equal(voice.pending,false);
  assert.equal(dsp.meowEnvelope,0);assert.equal(dsp.meowLeft,0);assert.equal(dsp.meowRight,0);
});

test('mute, Stop, reset, and visit exit release meow and cancel pending clicks',()=>{
  for(const action of ['mute','stop','reset','exit']) {
    const dsp=new WitchCatDSP(RATE);dsp.syncTime(action==='exit'?36.8:31);
    dsp.triggerMeow();render(dsp,.15);assert.ok(dsp.meowEnvelope>.9);
    dsp.triggerMeow();assert.equal(dsp.meow.pending,true);
    const before=dsp.time;
    if(action==='reset')dsp.syncTime(0);
    render(dsp,.08,{},action!=='mute'&&action!=='stop',action!=='stop');
    assert.equal(dsp.meow.active,false,action);assert.equal(dsp.meow.pending,false,action);
    assert.equal(dsp.meowEnvelope,0,action);assert.equal(dsp.meowLeft,0,action);assert.equal(dsp.meowRight,0,action);
    if(action==='stop')assert.equal(dsp.time,before);
    if(action==='mute')assert.ok(dsp.time>before);
    render(dsp,.1,{},true,true);assert.equal(dsp.meowEnvelope,0,'resume never replays a cancelled click');
  }
  const absent=new WitchCatDSP(RATE);
  assert.equal(absent.triggerMeow(),false);absent.syncTime(38);assert.equal(absent.triggerMeow(),false);
});

test('reset releases the meow without jumping its stereo position',()=>{
  const reset=new WitchCatDSP(48000),release=new WitchCatDSP(48000);
  for(const dsp of [reset,release]) { dsp.syncTime(31);dsp.triggerMeow();render(dsp,.15); }
  reset.syncTime(0);release.release();
  for(let sample=0;sample<1500;sample++) {
    reset.next({},false,false);release.next({},false,false);
    assert.equal(reset.meowLeft,release.meowLeft);assert.equal(reset.meowRight,release.meowRight);
  }
  assert.equal(reset.meow.active,false);
});
