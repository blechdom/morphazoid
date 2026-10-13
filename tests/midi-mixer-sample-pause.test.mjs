import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { MidiSampleClock } from '../src/instruments/midi-mixer/midi-mixer-clock.js';
import { parseMidi, defaultDeckConfig } from '../src/instruments/midi-mixer/midi-mixer-model.js';

function score(pitch = 60, beats = 4) {
  const vlq = value => { const bytes = [value & 127]; while ((value >>= 7)) bytes.unshift((value & 127) | 128); return bytes; };
  const track = [0,255,81,3,15,66,64,0,192,16,0,176,7,72,0,176,64,127,0,144,pitch,100,
    ...vlq(beats * 96),128,pitch,0,0,176,64,0,0,255,47,0];
  const bytes = new Uint8Array(22 + track.length), view = new DataView(bytes.buffer);
  bytes.set([77,84,104,100]); view.setUint32(4,6); view.setUint16(10,1); view.setUint16(12,96);
  bytes.set([77,84,114,107],14); view.setUint32(18,track.length); bytes.set(track,22); return bytes.buffer;
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const channels = analysis => analysis.channels.map(({channel}) => ({channel,mute:false,solo:false,program:null}));

test('pausing one silent layer freezes its phase and pending delay without stopping other transports or arming Audio', async () => {
  let now = 0, contexts = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now }, AudioContext: class { constructor() { contexts++; } } } });
  await engine.loadDeck(0, score(48,32)); engine.play(); engine.setAutomataPlaying(true);
  const first = engine.triggerSample(score(), {loop:true}), second = engine.triggerSample(score(67), {loop:true,sync:false});
  assert.equal(first.paused,false); now = 375;
  const paused = engine.setSamplePaused(first.id,true), sibling = engine.state.samples.find(sample => sample.id === second.id);
  near(paused.positionBeats,.75); assert.equal(paused.paused,true);
  const revision = paused.revision;
  assert.equal(engine.setSamplePaused(first.id,true).revision,revision,'same-state pause does not invalidate telemetry');
  now = 1375; engine.setTempo(240); now = 1625;
  near(engine.state.samples.find(sample => sample.id === first.id).positionBeats,.75);
  assert.ok(engine.state.samples.find(sample => sample.id === second.id).positionBeats > sibling.positionBeats);
  assert.ok(engine.state.beat > 3); assert.ok(engine.state.automata.beat > 3);
  const resumed = engine.setSamplePaused(first.id,false);
  assert.equal(resumed.id,first.id); assert.equal(resumed.slot,first.slot); assert.equal(resumed.playbackEpoch,1);
  near(resumed.resumedPositionBeats,.75); now = 1875;
  near(engine.state.samples.find(sample => sample.id === first.id).positionBeats,1.75);
  const pending = engine.triggerSample(score(),{loop:true}); assert.equal(pending.pending,true);
  engine.setSamplePaused(pending.id,true); now = 9875;
  assert.equal(engine.state.samples.find(sample => sample.id === pending.id).pending,true);
  near(engine.state.samples.find(sample => sample.id === pending.id).positionBeats,0);
  engine.setSamplePaused(pending.id,false); now = 10000;
  assert.equal(engine.state.samples.find(sample => sample.id === pending.id).pending,false);
  near(engine.state.samples.find(sample => sample.id === pending.id).positionBeats,.25);
  for (const id of [null,undefined,String(first.id),-1,Infinity]) assert.equal(engine.setSamplePaused(id,true),false);
  assert.equal(contexts,0); await engine.dispose(); assert.equal(engine.setSamplePaused(first.id,false),false);
});

test('paused slots survive new drops, all-paused capacity fails without mutation, and Stop frees a paused slot', async () => {
  const engine = new MidiMixerEngine();
  const first = engine.triggerSample(score(),{loop:true}); engine.setSamplePaused(first.id,true);
  const second = engine.triggerSample(score(62),{loop:true});
  engine.triggerSample(score(64),{loop:true}); engine.triggerSample(score(65),{loop:true});
  const replacement = engine.triggerSample(score(67),{loop:true});
  assert.equal(replacement.slot,second.slot); assert.ok(engine.state.samples.some(sample => sample.id === first.id));
  for (const sample of engine.state.samples) engine.setSamplePaused(sample.id,true);
  const before = engine.state.samples;
  assert.throws(() => engine.triggerSample(score(69)),/All four layers are paused/);
  assert.deepEqual(engine.state.samples,before);
  engine.stopSample(first.id); assert.equal(engine.triggerSample(score(70)).slot,first.slot);
  await engine.dispose();
});

test('sample pause uploads before Audio and ignores stale live or ended telemetry after a revision', async () => {
  let now = 0; const messages = [];
  const engine = new MidiMixerEngine({runtime:{performance:{now:()=>now}}});
  const first = engine.triggerSample(score(),{loop:true}); now = 250;
  const paused = engine.setSamplePaused(first.id,true);
  engine.node = {port:{postMessage:message=>messages.push(message)}}; engine._ready = true; engine._audioEnabled = true;
  engine._sendSamples();
  const upload = messages.at(-1); assert.equal(upload.paused,true); near(upload.timing.positionBeats,.5);
  assert.equal(upload.id,first.id); assert.equal(upload.revision,paused.revision);
  engine._receiveSampleTimings([{id:first.id,revision:first.revision,positionBeats:3,pendingBeats:0,cycle:5,ended:false}],2,1);
  near(engine.state.samples[0].positionBeats,.5);
  engine._receiveSampleTimings([{id:first.id,revision:first.revision,positionBeats:4,pendingBeats:0,cycle:5,ended:true,finishedAt:1}],2,1);
  assert.equal(engine.state.samples[0].paused,true); assert.deepEqual(engine.state.finishedSamples,[]);
  const resumed = engine.setSamplePaused(first.id,false);
  assert.deepEqual(messages.at(-1),{type:'samplePaused',slot:first.slot,id:first.id,paused:false,revision:resumed.revision});
  engine._receiveSampleTimings([{id:first.id,revision:paused.revision,positionBeats:4,pendingBeats:0,cycle:0,ended:true,finishedAt:1}],2,1);
  assert.equal(engine.state.samples.length,1);
  engine._receiveSampleTimings([{id:first.id,revision:resumed.revision,positionBeats:.55,pendingBeats:0,cycle:0,ended:false,
    playbackEpoch:1,resumedPositionBeats:.51,resumedCycle:0}],engine.state.sampleBeat,engine.state.sampleTime);
  near(engine.state.samples[0].resumedPositionBeats,.51);
  engine._receiveSampleTimings([{id:first.id,revision:resumed.revision,ended:true,unavailable:true}],engine.state.sampleBeat,engine.state.sampleTime);
  assert.equal(engine.state.samples.length,0); assert.deepEqual(engine.state.finishedSamples,[]);
  engine.node = null; await engine.dispose();
});

test('sample clock freezes queued launches and resumes a loop boundary once without replaying old attacks', () => {
  const events = [], releases = [], data = compileDeck(parseMidi(score(60,2)));
  const clock = new MidiSampleClock({emit:(_source,event)=>events.push(event),release:source=>releases.push(source)});
  clock.load(0,{id:1,data,loop:true,sync:true,paused:true,timing:{positionBeats:0,pendingBeats:1,cycle:0,ended:false}});
  clock.process(48000,48000,120); assert.equal(events.length,0); assert.equal(clock.samples[0].timing.pendingBeats,1);
  clock.setPaused(0,false,1); clock.process(24000,48000,120);
  assert.equal(events.length,0); clock.process(48000,48000,120);
  assert.equal(events.filter(event=>event.kind===9).length,1); assert.equal(clock.samples[0].wrapPending,true);
  clock.setPaused(0,true,2); const timing = {...clock.samples[0].timing};
  clock.process(48000,48000,300); assert.deepEqual(clock.samples[0].timing,timing);
  clock.setPaused(0,false,3); clock.process(128,48000,120);
  assert.equal(events.filter(event=>event.kind===9).length,2); assert.equal(clock.samples[0].playbackEpoch,2);
  assert.equal(clock.snapshot()[0].resumedCycle,1); assert.equal(releases.at(-1),2);
});

test('native pause releases only its held notes and echoes, freezes phase, and restores source controllers on resume', async () => {
  let Processor; const telemetry = [];
  globalThis.sampleRate=48000; globalThis.currentTime=0;
  globalThis.AudioWorkletProcessor=class {constructor(){this.port={postMessage:message=>telemetry.push(message)};}};
  globalThis.registerProcessor=(_name,implementation)=>{Processor=implementation;};
  await import('../src/instruments/midi-mixer/midi-mixer-processor.js'); const processor=new Processor();
  try {
    const font=await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2',import.meta.url));
    await processor.command({type:'initialize',soundfont:font.buffer.slice(font.byteOffset,font.byteOffset+font.byteLength)});
    for(let index=0;index<2;index++) {
      const analysis=parseMidi(score(36+index*7,32));
      await processor.command({type:'load',index,data:compileDeck(analysis),config:defaultDeckConfig(),channels:channels(analysis)});
    }
    await processor.command({type:'transport',playing:true,beat:0});
    await processor.command({type:'automataPlaying',playing:true,revision:1});
    await processor.command({type:'noteEffects',config:{enabled:true,delayBeats:.25,echoCount:2,echoBeats:1}});
    const load=async(slot,id,pitch,paused=false)=>processor.command({type:'sample',slot,id,revision:0,
      data:compileDeck(parseMidi(score(pitch))),startBeat:processor.sampleClock.beat,loop:true,sync:true,paused,gain:.7,program:16,midi:{}});
    await load(0,11,60); await load(1,12,67);
    const render = seconds => {
      let energy=0;
      for(let block=0;block<Math.ceil(seconds*48000/128);block++) {
        const left=new Float32Array(128),right=new Float32Array(128); processor.process([],[[left,right]]);
        for(const value of left){assert.ok(Number.isFinite(value));energy+=value*value;}
        globalThis.currentTime+=128/48000;
      }
      processor.publish(); return energy;
    };
    assert.ok(render(.4)>.01);
    const first=processor.sampleClock.samples[0], other=processor.sampleClock.samples[1], phase={...first.timing};
    const deckBeat=processor.clock.beat, automataBeat=processor.automata.beat, siblingPhase=other.timing.positionBeats;
    await processor.command({type:'samplePaused',slot:0,id:11,paused:true,revision:1});
    assert.equal(first.paused,true); assert.equal(processor.sampleClock.samples[1],other);
    assert.deepEqual(processor.noteFx.activePitches(128,60),[]); assert.ok(processor.noteFx.activePitches(144,67).length>0);
    assert.ok(!processor.synth.synthCore.voices.some(voice=>voice.channel===128&&voice.isActive&&!Number.isFinite(voice.releaseStartTime)));
    const marker=telemetry.length; assert.ok(render(.8)>.01); assert.deepEqual(first.timing,phase);
    const attacks=telemetry.slice(marker).flatMap(message=>message.type==='notes'?message.notes:[]).filter(note=>note.type==='noteOn');
    assert.ok(!attacks.some(note=>note.sampleId===11),'paused source emits neither attacks nor queued echoes');
    assert.ok(processor.clock.beat>deckBeat); assert.ok(processor.automata.beat>automataBeat); assert.notEqual(other.timing.positionBeats,siblingPhase);
    // A SoundFont reload or MIDI reconfiguration must not revive paused gates.
    await processor.command({type:'sampleParameters',slot:0,id:11,loop:true,sync:false,midi:{transpose:12},gain:.7,revision:2});
    assert.equal(processor.sampleClock.samples[0].paused,true); assert.deepEqual(processor.noteFx.activePitches(128,60),[]);
    const beforeResume=processor.sampleClock.samples[0];
    await processor.command({type:'samplePaused',slot:0,id:11,paused:false,revision:3});
    assert.equal(beforeResume.paused,false); assert.equal(beforeResume.id,11); assert.deepEqual(beforeResume.timing,phase);
    assert.equal(processor.sourceChannels.get(128).midiControllers[64] >> 7,127,'sustain state chased after isolated pause release');
    assert.ok(render(.3)>.01); assert.ok(processor.noteFx.activePitches(128,60).includes(60));
    assert.equal(processor.synth.midiChannels[128].systemParameters.keyShift,12);
    near(beforeResume.timing.positionBeats,phase.positionBeats+Math.ceil(.3*48000/128)*128/48000);
    await processor.command({type:'samplePaused',slot:0,id:11,paused:true,revision:2});
    assert.equal(beforeResume.paused,false,'stale transition cannot override a newer resume');
    await processor.command({type:'sampleParameters',slot:0,id:11,loop:false,sync:true,midi:{},gain:.1,revision:2});
    assert.equal(beforeResume.revision,3); assert.equal(beforeResume.loop,true); assert.equal(beforeResume.sync,false);
    await processor.command({type:'stopSample',slot:0,id:11}); await load(0,13,72,true);
    const replacement=processor.sampleClock.samples[0];
    await processor.command({type:'samplePaused',slot:0,id:11,paused:false,revision:4});
    assert.equal(replacement.paused,true); render(.2); near(replacement.timing.positionBeats,0);
    await processor.command({type:'samplePaused',slot:0,id:13,paused:false,revision:1}); render(.2);
    assert.ok(replacement.timing.positionBeats>0); assert.equal(processor.clock.playing,true); assert.equal(processor.automata.playing,true);
    await processor.command({type:'sample',slot:2,id:14,revision:0,data:compileDeck(parseMidi(score(75,.25))),
      startBeat:processor.sampleClock.beat,loop:false,sync:true,gain:.7,program:16,midi:{}});
    render(.2); assert.equal(processor.sampleClock.samples[2],null);
    await processor.command({type:'samplePaused',slot:2,id:14,paused:true,revision:1});
    assert.deepEqual(telemetry.at(-1).samples.find(sample=>sample.id===14),{id:14,revision:1,ended:true,unavailable:true});
  } finally {
    await processor.command({type:'dispose'});
    for(const key of ['AudioWorkletProcessor','registerProcessor','sampleRate','currentTime']) delete globalThis[key];
  }
});
