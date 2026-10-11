import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sanitizeMidiParameters, mergeMidiParameters, sanitizeMidiSynthEffects, MIDI_PARAMETER_FIELDS, MIDI_CC_PARAMETERS, MIDI_GENERATOR_PARAMETERS, MIDI_SYNTH_EFFECT_PARAMETERS, transformMidiNote } from '../src/instruments/midi-mixer/midi-mixer-parameters.js';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { parseMidi, defaultDeckConfig } from '../src/instruments/midi-mixer/midi-mixer-model.js';

const midi = (events, end = 8) => {
  const vlq = n => { const result=[n&127];while((n>>=7))result.unshift((n&127)|128);return result; };
  let tick=0; const track=[];
  for(const [beat,...bytes] of [...events,[end,255,47,0]]) { const next=Math.round(beat*96);track.push(...vlq(next-tick),...bytes);tick=next; }
  const bytes=new Uint8Array(22+track.length),view=new DataView(bytes.buffer);bytes.set([77,84,104,100]);view.setUint32(4,6);view.setUint16(10,1);view.setUint16(12,96);bytes.set([77,84,114,107],14);view.setUint32(18,track.length);bytes.set(track,22);return bytes.buffer;
};
const organ=()=>midi([[0,192,16],[0,176,91,0],[0,144,60,100],[7.9,128,60,0]]);
const settings=analysis=>analysis.channels.map(({channel})=>({channel,program:null,mute:false,solo:false,midi:{}}));

test('sparse overrides inherit, clear individually, clamp bad inputs and retain independent nested objects',()=>{
  const a=sanitizeMidiParameters({gain:99,pan:-99,velocityScale:NaN,controllers:{7:71,1:32,6:90,120:1},generators:{8:10000,53:88},bogus:5});
  assert.deepEqual(a,{gain:2,pan:-1,controllers:{1:32,7:71},generators:{8:10000}});
  const b=mergeMidiParameters(a,{gain:.5,controllers:{7:90},generators:{9:120}});b.controllers[1]=99;
  assert.equal(a.controllers[1],32);assert.equal(b.controllers[7],90);
  assert.deepEqual(sanitizeMidiParameters({gain:null,controllers:{7:null,1:null},generators:null},a),{pan:-1});
  assert.deepEqual(sanitizeMidiParameters(null,a),{});
  assert.deepEqual(sanitizeMidiSynthEffects({'reverb.level':999,'delay.feedback':-999,bogus:1}),{'reverb.level':127,'delay.feedback':4});
  assert.equal(MIDI_CC_PARAMETERS.length,120);assert.equal(MIDI_CC_PARAMETERS.filter(p=>p.procedural).length,8);
  for(const list of [MIDI_PARAMETER_FIELDS,MIDI_CC_PARAMETERS,MIDI_GENERATOR_PARAMETERS,MIDI_SYNTH_EFFECT_PARAMETERS]) for(const field of list) assert.ok(Number.isFinite(field.min)&&field.min<=field.default&&field.default<=field.max);
  assert.deepEqual(transformMidiNote({note:60,velocity:80},{transpose:12,velocityScale:.5,velocityOffset:5}),{note:72,velocity:45});
});

test('engine keeps per-deck, voice and shot edits independent; live stamp edits retain each program and Audio stays off',async()=>{
  const engine=new MidiMixerEngine();await engine.loadDeck(0,organ());await engine.loadDeck(1,organ());
  engine.configureDeck(0,{midi:{pan:-.7,controllers:{1:80}}});engine.configureChannel(0,0,{midi:{controllers:{7:50}}});
  engine.configureSamples({midi:{pan:.5}});
  engine.triggerSample(organ(),{midi:{program:80}});engine.triggerSample(organ(),{midi:{program:81}});
  engine.configureSamples({midi:{controllers:{7:100}},gain:.2});
  assert.deepEqual(engine.state.samples.map(s=>s.midi.program),[80,81]);assert.ok(engine.state.samples.every(s=>s.gain===.2&&s.midi.pan===.5));
  const state=engine.state;state.decks[0].config.midi.controllers[1]=0;state.decks[0].channels[0].midi.controllers[7]=0;state.samples[0].midi.program=2;state.effects.synth['reverb.level']=7;
  assert.equal(engine.state.decks[0].config.midi.controllers[1],80);assert.equal(engine.state.decks[0].channels[0].midi.controllers[7],50);assert.equal(engine.state.samples[0].midi.program,80);assert.deepEqual(engine.state.decks[1].config.midi,{});assert.deepEqual(engine.state.effects.synth,{});
  assert.equal(transformMidiNote({note:127,velocity:100},{transpose:1}).velocity,0);
  engine._audioEnabled=true;engine._ready=true;const sent=[];engine.node={port:{postMessage:value=>sent.push(value)}};
  assert.equal(engine.sendChannelController(0,999,120),false);assert.equal(engine.sendChannelController(0,0,120),true);assert.equal(engine.sendSampleController(120),true);
  engine.stopSamples();assert.equal(engine.sendSampleController(120),false);engine._decks[1].analysis=null;assert.equal(engine.sendChannelController(1,null,120),false);engine._audioEnabled=false;engine._ready=false;engine.node=null;
  engine.configureSamples({midi:null});assert.ok(engine.state.samples.every(s=>Object.keys(s.midi).length===0));assert.equal(engine.context,null);assert.equal(engine.state.audioEnabled,false);await engine.dispose();
});

async function processorFixture() {
  let Implementation;const messages=[];globalThis.sampleRate=48000;globalThis.currentTime=0;
  globalThis.AudioWorkletProcessor=class {constructor(){this.port={postMessage:message=>messages.push(message)};}};
  globalThis.registerProcessor=(_name,value)=>{Implementation=value;};
  await import(`../src/instruments/midi-mixer/midi-mixer-processor.js?parameters=${Math.random()}`);
  const p=new Implementation(),font=await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2',import.meta.url));
  await p.command({type:'initialize',soundfont:font.buffer.slice(font.byteOffset,font.byteOffset+font.byteLength)});
  const analysis=parseMidi(organ()),channels=settings(analysis),config=defaultDeckConfig();
  for(let index=0;index<2;index++)await p.command({type:'load',index,data:compileDeck(analysis),config,channels});
  const render=(blocks=100)=>{let l=0,r=0;for(let b=0;b<blocks;b++){const output=[new Float32Array(128),new Float32Array(128)];p.process([],[output]);for(let i=0;i<128;i++){assert.ok(Number.isFinite(output[0][i])&&Number.isFinite(output[1][i]));l+=output[0][i]**2;r+=output[1][i]**2;}globalThis.currentTime+=128/48000;}p.publish();return {l:Math.sqrt(l/(blocks*128)),r:Math.sqrt(r/(blocks*128))};};
  return {p,analysis,channels,config,messages,render};
}

test('native controller, patch, pressure and pitch overrides survive source automation and follow current source immediately',async()=>{
  const {p,channels,config,render}=await processorFixture();
  try {
    const source=(kind,a,b=0)=>p.emit(0,{kind,a,b,channel:0,beat:p.clock.beat,order:1},0);
    const edit=async midi=>p.command({type:'deck',index:0,config:{...config,midi},channels});
    await edit({controllers:{7:40,1:50},bend:10000,bendRange:12,pressure:80,program:81});
    source(11,7,90);source(11,1,9);source(11,33,88);source(12,16);source(14,0,80);source(13,22);
    const channel=p.synth.midiChannels[0];
    assert.equal(channel.midiControllers[7]>>7,40);assert.equal(channel.midiControllers[1],50<<7);assert.equal(channel.patch.program,81);assert.equal(channel.midiParameters.pitchWheel,10000);assert.equal(channel.midiParameters.pressure,80);
    source(11,101,0);source(11,100,0);source(11,6,5);source(11,38,64);
    assert.equal(channel.midiParameters.pitchWheelRange,12);
    await edit({});
    assert.equal(channel.midiControllers[7]>>7,90);assert.equal(channel.midiControllers[1],(9<<7)|88);assert.equal(channel.patch.program,16);assert.equal(channel.midiParameters.pitchWheel,10240);assert.equal(channel.midiParameters.pitchWheelRange,5.5);assert.equal(channel.midiParameters.pressure,22);
    assert.equal(p.synth.midiChannels[64].midiControllers[7]>>7,100,'other deck remains independent');assert.equal(p.synth.midiChannels.length,192,'shadow state never allocates audio channels');
    await edit({controllers:{1:40,33:77}});assert.equal(channel.midiControllers[1],(40<<7)|77);
    await edit({controllers:{1:40,33:99}});assert.equal(channel.midiControllers[1],(40<<7)|99);
    await p.command({type:'crossfade',value:-1});await p.command({type:'transport',playing:true,beat:1});render();
    await edit({pan:-1,fineTune:100});const signal=render();assert.ok(signal.l>signal.r*10,JSON.stringify(signal));assert.equal(channel.systemParameters.fineTune,100);assert.equal(p.clock.playing,true);
  } finally {await p.command({type:'dispose'});}
});

test('native note transforms, generator follow, stamps, effects and procedural panic have audible bounded consequences',async()=>{
  const {p,analysis,channels,config,messages,render}=await processorFixture();
  try {
    await p.command({type:'crossfade',value:-1});
    await p.command({type:'deck',index:0,config:{...config,midi:{velocityScale:.5,transpose:12,generators:{8:7000}}},channels});
    await p.command({type:'transport',playing:true,beat:0});assert.ok(render().l>.0001);
    const notes=messages.flatMap(m=>m.type==='notes'?m.notes:[]).filter(n=>n.type==='noteOn'&&n.deck===0);assert.equal(notes[0].note,72);assert.equal(notes[0].velocity,50);assert.equal(p.synth.midiChannels[0].generators.overrides[8],7000);
    const beat=p.clock.beat;
    await p.command({type:'deck',index:0,config:{...config,midi:{velocityScale:.5}},channels});assert.equal(p.clock.beat,beat);assert.equal(p.synth.midiChannels[0].generators.overrides[8],32767);assert.ok(render().l>.0001,'held note rejoins when removing sample-generator/pitch overrides');
    await p.command({type:'effects',synth:{'reverb.level':30,'chorus.rate':40,'delay.level':25}});assert.equal(p.synth.reverbProcessor.level,30);assert.equal(p.synth.chorusProcessor.rate,40);await p.command({type:'effects',synth:{}});assert.equal(p.synth.reverbProcessor.level,64);assert.equal(p.synth.chorusProcessor.rate,3);
    await p.command({type:'transport',playing:false,beat});
    await p.command({type:'sample',slot:0,id:1,data:compileDeck(analysis),startBeat:p.sampleClock.beat,gain:.7,program:null,midi:{pan:1,program:16}});render();
    const source=p.synth.midiChannels[128];await p.command({type:'sampleParameters',slot:0,id:1,gain:.3,midi:{pan:-1,program:16,pressure:100}});assert.equal(source.systemParameters.pan,-1);assert.equal(source.systemParameters.gain,.3);assert.equal(source.midiParameters.pressure,100);assert.equal(p.clock.playing,false);assert.ok(render().l>.0001);
    await p.command({type:'midiAction',samples:true,action:{kind:'parameter',registered:true,parameter:0,value:1280}});assert.equal(source.midiParameters.pitchWheelRange,10);
    await p.command({type:'midiAction',samples:true,action:{kind:'cc',controller:120,value:0}});render(1200);assert.ok(render(50).l<1e-6,'panic kills active sample sound');
    await p.command({type:'stopSamples'});assert.equal(p.sampleClock.samples.filter(Boolean).length,0);
    await p.command({type:'deck',index:0,config:{...config,midi:{velocityScale:0}},channels});await p.command({type:'transport',playing:true,beat:0});messages.length=0;render(200);assert.equal(messages.flatMap(m=>m.type==='notes'?m.notes:[]).some(n=>n.type==='noteOn'&&n.deck===0),false);
  } finally {await p.command({type:'dispose'});}
});

test('scheduled NRPN automation cannot replace held generators, original drum kits survive global melodic programs, and explicit kit edits work',async()=>{
  const {p,channels,config,render}=await processorFixture();
  try {
    await p.command({type:'deck',index:0,config:{...config,midi:{generators:{8:9000}}},channels});
    const cc=(a,b,frame=0)=>p.emit(0,{kind:11,channel:0,a,b,beat:0},frame);
    cc(99,120);cc(98,8);cc(6,70,40);cc(38,20,40);render(2);
    assert.equal(p.synth.midiChannels[0].generators.overrides[8],9000);assert.equal(p.synth.midiChannels[0].generators.offsets[8],0);
    await p.command({type:'deck',index:0,config,channels});
    assert.equal(p.synth.midiChannels[0].generators.overrides[8],32767);
    const data=parseMidi(midi([[0,192,16],[0,201,0],[0,144,60,100],[0,153,36,100],[2,128,60,0],[2,137,36,0]],4));
    const voices=settings(data);
    await p.command({type:'load',index:0,data:compileDeck(data),config:{...config,midi:{program:81}},channels:voices});
    const melodic=p.synth.midiChannels[p.deckChannels[0].get(0)],drums=p.synth.midiChannels[p.deckChannels[0].get(9)];
    assert.equal(melodic.patch.program,81);assert.equal(drums.patch.program,0);assert.equal(drums.drumChannel,true);
    await p.command({type:'deck',index:0,config:{...config,midi:{program:81}},channels:voices.map(v=>({...v,program:v.channel===9?8:null}))});
    assert.equal(drums.patch.program,8);assert.equal(drums.drumChannel,true,'explicit channel program remains a drum-bank selection');
    await p.command({type:'midiAction',index:0,channel:9,action:{kind:'parameter',registered:false,parameter:(26<<7)|36,value:60<<7}});
    assert.equal(drums.drumParams[36].gain,.5,'drum-level NRPN survives the complete procedural action');
    await p.command({type:'transport',playing:true,beat:0});assert.ok(render(20).l>0);
    for(const descriptor of MIDI_GENERATOR_PARAMETERS) {
      const current=p.clock.beat;
      for(const value of [descriptor.min,descriptor.max]) {
        await p.command({type:'deck',index:0,config:{...config,midi:{generators:{[descriptor.id]:value}}},channels:voices});
        render(3);assert.equal(p.ready,true,`${descriptor.label} remains finite`);
      }
      assert.ok(p.clock.beat>=current);
    }
    await p.command({type:'release'});assert.equal(p.synth.voiceCount<=192,true);
  } finally {await p.command({type:'dispose'});}
});
