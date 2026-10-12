import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { parseMidi, defaultDeckConfig } from '../src/instruments/midi-mixer/midi-mixer-model.js';

function score(note = 60, beats = 4) {
  const vlq = value => { const bytes = [value & 127]; while ((value >>= 7)) bytes.unshift((value & 127) | 128); return bytes; };
  // 60 BPM source lets Sync switch between source seconds and 120 BPM master.
  const track = [0,255,81,3,15,66,64,0,192,16,0,144,note,100,...vlq(beats * 96),128,note,0,0,255,47,0];
  const bytes = new Uint8Array(22 + track.length), view = new DataView(bytes.buffer);
  bytes.set([77,84,104,100]); view.setUint32(4,6); view.setUint16(10,1); view.setUint16(12,96);
  bytes.set([77,84,114,107],14); view.setUint32(18,track.length); bytes.set(track,22);
  return bytes.buffer;
}
const channelsFor = analysis => analysis.channels.map(({ channel }) => ({ channel, mute: false, solo: false, program: null }));

test('one clip can change Loop/Sync and stop without arming Audio or changing other clips/decks', async () => {
  let now = 0, contexts = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now }, AudioContext: class { constructor() { contexts++; } } } });
  await engine.loadDeck(0, score(48,32)); engine.play();
  const first = engine.triggerSample(score(60,2), { loop: true, midi: { transpose: 7 }, gain: .3 });
  const second = engine.triggerSample(score(67,4), { loop: true });
  now = 750;
  const before = engine.state, sibling = before.samples.find(item => item.id === second.id);
  const changed = engine.configureSample(first.id, { loop: false, sync: false });
  assert.equal(changed.positionBeats, 1.5); assert.equal(changed.loop, false); assert.equal(changed.sync, false);
  assert.deepEqual(changed.midi, { transpose: 7 }); assert.equal(changed.gain,.3);
  assert.deepEqual(engine.state.samples.find(item => item.id === second.id), sibling);
  assert.equal(engine.state.beat,before.beat); assert.equal(engine.state.playing,true);
  now = 1000; assert.equal(engine.state.samples.find(item => item.id === first.id).positionBeats,1.75);
  now = 1250; assert.equal(engine.state.samples.some(item => item.id === first.id),false);
  assert.equal(engine.configureSample(first.id,{loop:true}),false,'an ended one-shot cannot be resurrected by its old id');
  assert.equal(engine.state.samples.length,1); assert.equal(engine.stopSample(second.id),true);
  assert.equal(engine.stopSample(second.id),false); assert.equal(engine.state.samples.length,0);
  assert.equal(engine.state.playing,true); assert.equal(engine.state.beat,2.5); assert.equal(contexts,0);
  await engine.dispose();
  assert.equal(engine.stopSample(first.id),false); assert.equal(engine.configureSample(first.id,{loop:true}),false);
});

test('sample commands carry only their owned slot/id and retain MIDI overrides, pending phase and four-clip limit', async () => {
  const messages = []; let now = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now } } });
  await engine.loadDeck(0,score(48,32)); engine.play(); now = 100;
  const first = engine.triggerSample(score(),{loop:true,midi:{program:80,transpose:12},gain:.45});
  const other = engine.triggerSample(score(67),{loop:true});
  assert.equal(first.pending,true);
  engine.node = { port: { postMessage: message => messages.push(message) } }; engine._ready = true; engine._audioEnabled = true; engine._sendSamples();
  const before = engine.state;
  const configured = engine.configureSample(first.id,{sync:false});
  assert.equal(configured.pending,false); assert.equal(configured.positionBeats,0);
  assert.deepEqual(messages.at(-1),{type:'sampleParameters',slot:first.slot,id:first.id,midi:{program:80,transpose:12},gain:.45,loop:true,sync:false,revision:1});
  assert.deepEqual(engine.state.samples.find(item => item.id === other.id),before.samples.find(item => item.id === other.id));
  engine.stopSample(first.id);
  assert.deepEqual(messages.at(-1),{type:'stopSample',slot:first.slot,id:first.id});
  const replacement = engine.triggerSample(score(72),{loop:true}); assert.equal(replacement.slot,first.slot);
  const count = messages.length; assert.equal(engine.stopSample(first.id),false); assert.equal(engine.configureSample(first.id,{loop:false}),false);
  for(const id of [null,undefined,String(replacement.id),-1,Infinity]) assert.equal(engine.stopSample(id),false);
  assert.equal(messages.length,count);
  for(let index=0;index<3;index++) engine.triggerSample(score(75+index),{loop:true});
  assert.equal(engine.state.samples.length,4); assert.equal(new Set(engine.state.samples.map(item=>item.slot)).size,4);
  assert.equal(engine.stopSample(other.id),false,'evicted ownership cannot stop the replacement');
  engine.node = null; await engine.dispose();
});

test('native per-clip stop cancels only its held notes and pending echoes; loop edits preserve phase and stale stop cannot hit a reused slot', async () => {
  let Processor; const telemetry = [];
  globalThis.sampleRate=48000; globalThis.currentTime=0;
  globalThis.AudioWorkletProcessor=class { constructor() { this.port={postMessage:message=>telemetry.push(message)}; } };
  globalThis.registerProcessor=(_name,implementation)=>{Processor=implementation;};
  await import('../src/instruments/midi-mixer/midi-mixer-processor.js'); const processor=new Processor();
  try {
    const font=await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2',import.meta.url));
    await processor.command({type:'initialize',soundfont:font.buffer.slice(font.byteOffset,font.byteOffset+font.byteLength)});
    const deck=parseMidi(score(48,32));
    await processor.command({type:'load',index:0,data:compileDeck(deck),config:defaultDeckConfig(),channels:channelsFor(deck)});
    await processor.command({type:'transport',playing:true,beat:0});
    await processor.command({type:'noteEffects',config:{enabled:true,delayBeats:.25,echoCount:2,echoBeats:1}});
    const load = (slot,id,note,beats=4,timing) => processor.command({type:'sample',slot,id,data:compileDeck(parseMidi(score(note,beats))),
      startBeat:processor.sampleClock.beat,loop:true,sync:true,gain:.7,program:16,midi:{},timing});
    await load(0,11,60,2); await load(1,12,67,4);
    const render = seconds => {
      let energy=0;
      for(let block=0;block<Math.ceil(seconds*48000/128);block++) {
        const left=new Float32Array(128),right=new Float32Array(128); processor.process([],[[left,right]]);
        for(const value of left) { assert.ok(Number.isFinite(value)); energy+=value*value; }
        globalThis.currentTime+=128/48000;
      }
      processor.publish(); assert.equal(processor.ready,true); return energy;
    };
    assert.ok(render(.3)>.01);
    const other=processor.sampleClock.samples[1], timing={...other.timing}, beat=processor.clock.beat;
    assert.ok(processor.noteFx.activePitches(128,60).length>0); assert.ok(processor.noteFx.activePitches(144,67).length>0);
    await processor.command({type:'stopSample',slot:0,id:11});
    assert.equal(processor.sampleClock.samples[0],null); assert.equal(processor.sampleClock.samples[1],other);
    assert.deepEqual(other.timing,timing); assert.equal(processor.clock.beat,beat); assert.equal(processor.clock.playing,true);
    assert.deepEqual(processor.noteFx.activePitches(128,60),[]); assert.ok(processor.noteFx.activePitches(144,67).length>0);
    assert.ok(!processor.synth.synthCore.voices.some(voice=>voice.channel===128&&voice.isActive&&!Number.isFinite(voice.releaseStartTime)));
    const marker=telemetry.length; assert.ok(render(1)>.01);
    const attacks=telemetry.slice(marker).flatMap(message=>message.type==='notes'?message.notes:[]).filter(note=>note.type==='noteOn');
    assert.ok(!attacks.some(note=>note.sampleId===11),'stopped clip cannot emit queued echoes');
    assert.ok(attacks.some(note=>note.sampleId===12)); assert.ok(processor.clock.beat>beat);

    const position=other.timing.positionBeats, cycle=other.timing.cycle;
    const ids=processor.synth.midiChannels[144].noteOnID.slice();
    await processor.command({type:'sampleParameters',slot:1,id:12,loop:false,sync:false,midi:{},gain:.7,revision:1});
    assert.equal(other.timing.positionBeats,position); assert.equal(other.timing.cycle,cycle);
    assert.deepEqual(processor.synth.midiChannels[144].noteOnID,ids,'loop/sync edit does not retrigger held notes');
    render(.3); assert.ok(Math.abs(other.timing.positionBeats-position-.3)<.004);
    render(2); assert.equal(processor.sampleClock.samples[1],null,'loop-off finishes only the current pass');
    assert.equal(processor.clock.playing,true);

    await load(0,13,72,4,{positionBeats:0,pendingBeats:1,cycle:0,ended:false});
    await processor.command({type:'stopSample',slot:0,id:13});
    await load(0,14,74);
    const fresh=processor.sampleClock.samples[0];
    await processor.command({type:'stopSample',slot:0,id:13});
    for(const slot of [-1,4,.5,'__proto__']) await processor.command({type:'stopSample',slot,id:14});
    assert.equal(processor.sampleClock.samples[0],fresh);
    const reusedMarker=telemetry.length; render(.7);
    const reused=telemetry.slice(reusedMarker).flatMap(message=>message.type==='notes'?message.notes:[]).filter(note=>note.type==='noteOn');
    assert.ok(!reused.some(note=>note.sampleId===13)); assert.ok(reused.some(note=>note.sampleId===14));
    await processor.command({type:'stopSample',slot:0,id:14}); render(.5);
    assert.equal(processor.sampleClock.samples.filter(Boolean).length,0); assert.equal(processor.sampleVisualCount,0);
    assert.ok(processor.synth.voiceCount<=192);
  } finally {
    await processor.command({type:'dispose'});
    for(const key of ['AudioWorkletProcessor','registerProcessor','sampleRate','currentTime']) delete globalThis[key];
  }
});
