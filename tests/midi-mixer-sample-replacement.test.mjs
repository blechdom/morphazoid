import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { MidiSampleClock, MAX_SAMPLE_EVENTS_PER_BLOCK, MAX_SAMPLE_RESTORES_PER_BLOCK } from '../src/instruments/midi-mixer/midi-mixer-clock.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { createBlechLiveProjector } from '../src/instruments/blech-midi/blech-midi-live-score.js';

function score(pitch = 60, beats = 4, channel = 0) {
  const vlq = value => { const bytes = [value & 127]; while ((value >>= 7)) bytes.unshift((value & 127) | 128); return bytes; };
  const track = [0,255,81,3,15,66,64,0,192|channel,16,0,176|channel,7,72,0,176|channel,64,127,0,144|channel,pitch,100,
    ...vlq(beats * 96),128|channel,pitch,0,0,176|channel,64,0,0,255,47,0];
  const bytes = new Uint8Array(22 + track.length), view = new DataView(bytes.buffer);
  bytes.set([77,84,104,100]); view.setUint32(4,6); view.setUint16(10,1); view.setUint16(12,96);
  bytes.set([77,84,114,107],14); view.setUint32(18,track.length); bytes.set(track,22); return bytes.buffer;
}
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const replacement = (pitch, beats, token, channel = 0) => ({token,data:compileDeck(parseMidi(score(pitch,beats,channel))),channels:[{channel,program:16,mute:false,solo:false}]});

test('a silent loop uses its latest edited score at the next boundary without changing identity, other clocks or Audio', async () => {
  let now = 0, contexts = 0;
  const engine = new MidiMixerEngine({runtime:{performance:{now:()=>now},AudioContext:class {constructor(){contexts++;}}}});
  await engine.loadDeck(0,score(48,32)); engine.play(); engine.setAutomataPlaying(true);
  const first=engine.triggerSample(score(),{loop:true,name:'Text HELLO'}), second=engine.triggerSample(score(67,8),{loop:true});
  now=500;
  const before=engine.state, pending=engine.replaceSample(first.id,score(72,8),{name:'Text WORLD'});
  assert.equal(pending.id,first.id); assert.equal(pending.slot,first.slot); assert.equal(pending.analysis.notes[0].note,60);
  assert.equal(pending.pendingReplacement.analysis.notes[0].note,72);
  const last=engine.replaceSample(first.id,score(84,2),{name:'Text LAST'});
  assert.equal(last.pendingReplacement.analysis.durationBeats,2);
  assert.throws(()=>engine.replaceSample(first.id,new Uint8Array([1,2,3])),/MIDI|header/i);
  now=2125;
  const state=engine.state, updated=state.samples.find(sample=>sample.id===first.id);
  assert.equal(updated.name,'Text LAST'); assert.equal(updated.analysis.notes[0].note,84); assert.equal(updated.pendingReplacement,undefined);
  assert.equal(updated.scoreVersion,last.pendingReplacement.token); assert.equal(updated.cycle,1); near(updated.positionBeats,.25);
  near(updated.replacedAt,2); assert.equal(updated.slot,first.slot); assert.equal(updated.playbackEpoch,1);
  assert.ok(state.beat>before.beat); assert.ok(state.automata.beat>before.automata.beat);
  near(state.samples.find(sample=>sample.id===second.id).positionBeats,4.25);
  assert.equal(state.finishedSamples.at(-1).analysis.notes[0].note,60); assert.equal(contexts,0);
  await engine.dispose();
});

test('paused and queued edits remain silent; active one-shots need explicit restart; stopped edits never return', async () => {
  let now=0; const engine=new MidiMixerEngine({runtime:{performance:{now:()=>now}}});
  await engine.loadDeck(0,score()); engine.play(); now=125;
  const queued=engine.triggerSample(score(),{loop:true}); assert.equal(queued.pending,true);
  const edited=engine.replaceSample(queued.id,score(70,2)); assert.equal(edited.pending,true); assert.equal(edited.analysis.notes[0].note,70);
  engine.setSamplePaused(queued.id,true); now=1000;
  const paused=engine.replaceSample(queued.id,score(72,8)); assert.equal(paused.paused,true); assert.equal(paused.pending,true); near(paused.positionBeats,0);
  now=1500; assert.equal(engine.state.samples[0].paused,true);
  engine.setSamplePaused(queued.id,false); now=2000; assert.equal(engine.state.samples[0].pending,false); near(engine.state.samples[0].positionBeats,.25);
  const one=engine.triggerSample(score(50,8)); now=2500;
  assert.equal(engine.replaceSample(one.id,score(80,2)),false);
  const restarted=engine.replaceSample(one.id,score(80,2),{when:'restart'}); near(restarted.positionBeats,0); assert.equal(restarted.id,one.id);
  const waiting=engine.replaceSample(queued.id,score(90)); assert.ok(waiting.pendingReplacement);
  engine.stopSample(queued.id); const reused=engine.triggerSample(score(33),{loop:true}); assert.equal(reused.slot,queued.slot);
  engine._receiveSampleTimings([{id:queued.id,revision:waiting.revision,scoreVersion:waiting.pendingReplacement.token,positionBeats:0,cycle:1}],4,2);
  assert.ok(!engine.state.samples.some(sample=>sample.id===queued.id)); assert.equal(engine.state.samples.find(sample=>sample.id===reused.id).analysis.notes[0].note,33);
  await engine.dispose();
});

test('turning Loop off cancels an unapplied edit and completes only that original pass', async () => {
  let now=0; const engine=new MidiMixerEngine({runtime:{performance:{now:()=>now}}});
  const layer=engine.triggerSample(score(),{loop:true}); now=500; engine.replaceSample(layer.id,score(80));
  const finishing=engine.configureSample(layer.id,{loop:false}); assert.equal(finishing.pendingReplacement,undefined);
  now=2100; assert.equal(engine.state.samples.length,0); assert.equal(engine.state.finishedSamples.at(-1).analysis.notes[0].note,60);
  await engine.dispose();
});

test('native clock swaps changed lengths inside a block and schedules only the new score after that boundary', () => {
  for (const sync of [true,false]) {
    const events=[],releases=[],changed=[],clock=new MidiSampleClock({emit:(source,event,frame)=>events.push({source,event,frame}),release:(source,frame)=>releases.push({source,frame}),replace:(source,data,frame)=>changed.push({source,data,frame})});
    clock.load(0,{id:1,data:compileDeck(parseMidi(score(60,4))),startBeat:0,loop:true,sync,revision:0});
    clock.load(1,{id:2,data:compileDeck(parseMidi(score(67,16))),startBeat:0,loop:true,sync:true,revision:0});
    // Synchronized notes use master 120 BPM; free notes retain the score's 60 BPM.
    clock.process(sync?84000:180000,48000,120);
    const sibling=clock.samples[1], before=sibling.timing.positionBeats;
    clock.replaceScore(0,replacement(72,2,1),{revision:1});
    clock.replaceScore(0,replacement(84,1,2),{revision:2});
    const mark=events.length; clock.process(24000,48000,120);
    const sample=clock.samples[0]; assert.equal(sample.scoreVersion,2); assert.equal(sample.data.durationBeats,1);
    assert.equal(sample.id,1); near(sample.timing.positionBeats,sync?.5:.25); assert.equal(sample.timing.cycle,1);
    const attack=events.slice(mark).filter(({source,event})=>source===2&&event.kind===9);
    assert.equal(attack.length,1); assert.equal(attack[0].event.a,84); assert.equal(attack[0].frame,12000);
    assert.equal(changed.at(-1).source,2); assert.equal(changed.at(-1).frame,12000);
    assert.ok(clock.samples[1]===sibling); near(sibling.timing.positionBeats,before+1);
    clock.process(24000,48000,120);
    assert.ok(!events.slice(mark).some(({source,event})=>source===2&&event.kind===9&&event.a!==84));
  }
});

test('pending forecast shows the edited next pass while performed history stays in its original shape', async () => {
  let now=0; const engine=new MidiMixerEngine({runtime:{performance:{now:()=>now}}}), project=createBlechLiveProjector();
  const layer=engine.triggerSample(score(),{loop:true}); now=500;
  const initial=project(engine.state,{lookAhead:5,pastSeconds:8});
  engine.replaceSample(layer.id,score(84,2));
  const forecast=project(engine.state,{lookAhead:5,pastSeconds:8});
  assert.ok(forecast.notes.some(note=>note.pitch===84&&note.start>=1.5));
  assert.ok(forecast.notes.filter(note=>note.pitch===60).every(note=>note.start<1.5&&note.end<=1.5));
  assert.ok(initial.pastNotes.some(note=>note.pitch===60));
  now=2250;
  const after=project(engine.state,{lookAhead:5,pastSeconds:8});
  assert.ok(after.pastNotes.some(note=>note.pitch===60&&note.end<=-.25));
  assert.ok(after.pastNotes.some(note=>note.pitch===84&&note.start>=-.25-1e-8));
  assert.ok(after.notes.every(note=>note.pitch===84));
  await engine.dispose();
});

test('a second edit at a render-quantum boundary cannot supersede the just-current score before its acknowledgement', async () => {
  let now=0; const messages=[],engine=new MidiMixerEngine({runtime:{performance:{now:()=>now}}});
  const first=engine.triggerSample(score(),{loop:true});
  engine.node={port:{postMessage:message=>messages.push(message)}}; engine._ready=engine._audioEnabled=true; engine._sendSamples();
  const upload=messages.at(-1),clock=new MidiSampleClock(); clock.load(0,{...upload,config:{},channels:[]});
  now=500; clock.process(24000,48000,120); engine.replaceSample(first.id,score(72,2));
  const initial=messages.at(-1); clock.replaceScore(0,{...initial.replacement,channels:[]},{revision:initial.revision});
  clock.process(71872,48000,120);
  now=2000; const edited=engine.replaceSample(first.id,score(84,8));
  assert.equal(edited.analysis.notes[0].note,72); assert.equal(edited.pendingReplacement.analysis.notes[0].note,84);
  const next=messages.at(-1); assert.equal(next.scoreVersion,initial.replacement.token);
  clock.confirmScore(0,next.scoreVersion);
  clock.replaceScore(0,{...next.replacement,channels:[]},{revision:next.revision});
  assert.equal(clock.samples[0].data.held.info[0]>>>7&127,72,'the current edited pass survives');
  assert.equal(clock.samples[0].pendingReplacement.data.held.info[0]>>>7&127,84,'the newest edit waits for the following pass');
  engine._receiveSampleTimings(clock.snapshot(),clock.beat,clock.seconds);
  assert.equal(engine.state.samples[0].analysis.notes[0].note,72);
  engine.stopSample(first.id); engine._receiveSampleTimings(clock.snapshot(),clock.beat,clock.seconds);
  assert.equal(engine.state.samples.length,0); engine.node=null; await engine.dispose();
});

test('editing a paused score preserves its old release and never invents a performance before Resume', async () => {
  let now=0; const engine=new MidiMixerEngine({runtime:{performance:{now:()=>now}}}),project=createBlechLiveProjector();
  const layer=engine.triggerSample(score(60,8),{loop:true});
  now=500; project(engine.state,{pastSeconds:8});
  now=1000; engine.setSamplePaused(layer.id,true);
  now=1500; engine.replaceSample(layer.id,score(84,8));
  now=2000; const paused=project(engine.state,{pastSeconds:8});
  assert.equal(paused.notes.length,0); assert.equal(paused.pastNotes.length,1);
  assert.equal(paused.pastNotes[0].pitch,60); near(paused.pastNotes[0].end,-1);
  engine.setSamplePaused(layer.id,false); now=2500; project(engine.state,{pastSeconds:8});
  engine.setSamplePaused(layer.id,true); now=3000; project(engine.state,{pastSeconds:8});
  engine.setSamplePaused(layer.id,false); now=3500; const resumed=project(engine.state,{pastSeconds:8});
  const gates=resumed.pastNotes.filter(note=>note.pitch===84).map(note=>[note.start+3.5,note.end+3.5]);
  assert.deepEqual(gates,[[2,2.5],[3,3.5]]); assert.ok(resumed.pastNotes.filter(note=>note.pitch===60).every(note=>note.end+3.5<=1));
  await engine.dispose();
});

test('replacement obeys shared event and controller-restoration budgets even with hostile free-time loop rates', () => {
  let emitted=0,restores=0;
  const clock=new MidiSampleClock({emit:()=>emitted++,restore:()=>restores++});
  const tiny={...compileDeck(parseMidi(score())),durationBeats:1/32767,tempoMap:[{beat:0,bpm:60000000,seconds:0}]};
  for(let slot=0;slot<4;slot++) clock.load(slot,{id:slot,startBeat:0,data:tiny,loop:true,sync:false,timing:{positionBeats:tiny.durationBeats/2,pendingBeats:0,cycle:0,ended:false}});
  for(let slot=0;slot<4;slot++) clock.replaceScore(slot,replacement(80+slot,2,slot+1));
  const before=restores; clock.process(128,48000,300);
  assert.ok(emitted<=MAX_SAMPLE_EVENTS_PER_BLOCK); assert.ok(restores-before<=MAX_SAMPLE_RESTORES_PER_BLOCK);
  for(let slot=0;slot<4;slot++) {assert.equal(clock.samples[slot].scoreVersion,slot+1); assert.ok(Number.isFinite(clock.samples[slot].timing.positionBeats));}
  clock.stopAll(); const count=emitted; clock.process(128,48000,300); assert.equal(emitted,count);
});

test('native replacement releases only its old notes and echoes, remaps channels and preserves sibling sound', async () => {
  let Processor; const telemetry=[];
  globalThis.sampleRate=48000; globalThis.currentTime=0;
  globalThis.AudioWorkletProcessor=class {constructor(){this.port={postMessage:message=>telemetry.push(message)};}};
  globalThis.registerProcessor=(_name,implementation)=>{Processor=implementation;};
  await import('../src/instruments/midi-mixer/midi-mixer-processor.js'); const processor=new Processor();
  try {
    const font=await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2',import.meta.url));
    await processor.command({type:'initialize',soundfont:font.buffer.slice(font.byteOffset,font.byteOffset+font.byteLength)});
    await processor.command({type:'noteEffects',config:{enabled:true,echoCount:2,echoBeats:1}});
    for(const [slot,pitch] of [[0,60],[1,67]]) await processor.command({type:'sample',slot,id:11+slot,revision:0,data:compileDeck(parseMidi(score(pitch,2))),startBeat:0,loop:true,sync:true,gain:.7,program:16,midi:{}});
    const render=seconds=>{let energy=0; for(let block=0;block<Math.ceil(seconds*48000/128);block++){const left=new Float32Array(128),right=new Float32Array(128); processor.process([],[[left,right]]); for(const value of left){assert.ok(Number.isFinite(value));energy+=value*value;} globalThis.currentTime+=128/48000;} processor.publish();return energy;};
    assert.ok(render(.4)>.01); const sibling=processor.sampleClock.samples[1];
    await processor.command({type:'sampleReplacement',slot:0,id:11,revision:1,replacement:replacement(84,4,1,2),program:16});
    assert.equal(processor.sampleClock.samples[0].data.held.info[0]>>>7&127,60);
    assert.ok(render(.7)>.01);
    const changed=processor.sampleClock.samples[0]; assert.equal(changed.scoreVersion,1); assert.equal(changed.id,11); assert.equal(processor.sampleClock.samples[1],sibling);
    assert.deepEqual(processor.noteFx.activePitches(128,60),[]); assert.ok(processor.noteFx.activePitches(128,84).includes(84)); assert.ok(processor.noteFx.activePitches(144,67).includes(67));
    assert.equal(processor.deckChannels[2].get(2),128); assert.equal(processor.sourceChannels.get(128).midiControllers[64]>>7,127);
    await processor.command({type:'sampleReplacement',slot:0,id:11,revision:2,replacement:replacement(90,2,2),program:16});
    await processor.command({type:'stopSample',slot:0,id:11});
    await processor.command({type:'sample',slot:0,id:13,revision:0,data:compileDeck(parseMidi(score(40,8))),startBeat:processor.sampleClock.beat,loop:true,sync:true,gain:.7,program:16,midi:{}});
    await processor.command({type:'sampleReplacement',slot:0,id:11,revision:3,replacement:replacement(100,2,3),program:16});
    assert.ok(render(.2)>.01); assert.equal(processor.sampleClock.samples[0].id,13); assert.equal(processor.sampleClock.samples[0].pendingReplacement,undefined);
  } finally { await processor.command({type:'dispose'}); delete globalThis.AudioWorkletProcessor; delete globalThis.registerProcessor; delete globalThis.currentTime; delete globalThis.sampleRate; }
});
