import {SPELLING_NATIVE_ENGINES as EXTENDED_ENGINES} from '../src/families/speech/extended-engines.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {RetroSpeechCore,bellTractAreas} from '../src/instruments/spelling-synthesizer/spelling-retro-model.js';
import {retroVoiceConfiguration} from '../src/instruments/spelling-synthesizer/spelling-retro-audio.js';
import {SPELLING_LPC_ATLAS,LPC_SOURCE_SHA256} from '../src/instruments/spelling-synthesizer/spelling-lpc-atlas.js';
import {LPC_BITS,reflectionValue,reflectionIndex,analyseLpcFrame} from '../src/instruments/spelling-synthesizer/spelling-lpc-codec.js';
import {SPELLING_DIPHONE_ATLAS_URL,SPELLING_DIPHONE_CLIPS} from '../src/instruments/spelling-synthesizer/spelling-diphone-atlas.js';
import {presets} from '../src/instruments/spelling-synthesizer/full-presets.js';

const rms=xs=>Math.sqrt(xs.reduce((sum,x)=>sum+x*x,0)/xs.length);
const config=(key='a',changes={})=>({key,phone:key,carrier:'a',frequency:130,voicing:.9,brightness:1,duration:.28,amplitude:.7,...changes});
const render=(mode,options,rate=48000,seconds=.6)=>{const core=new RetroSpeechCore(rate,mode);core.start(options);const audio=new Float32Array(Math.ceil(rate*seconds));core.render(audio);return {core,audio};};

test('LPC atlas is reproducibly derived from the licensed unchanged KAL source, not TI ROM',()=>{
  assert.equal(createHash('sha256').update(readFileSync(SPELLING_DIPHONE_ATLAS_URL)).digest('hex'),LPC_SOURCE_SHA256);
  assert.deepEqual(Object.keys(SPELLING_LPC_ATLAS),Object.keys(SPELLING_DIPHONE_CLIPS));
  execFileSync(process.execPath,['scripts/audio/build-spelling-lpc.mjs','--check'],{cwd:new URL('..',import.meta.url)});
  for(const {frames} of Object.values(SPELLING_LPC_ATLAS)) for(const frame of frames) {
    assert.equal(frame.length,12);assert(frame[0]>=0&&frame[0]<=15);assert(frame[1]>=0&&frame[1]<=31);
    frame.slice(2).forEach((k,i)=>{assert(Number.isInteger(k)&&k>=0&&k<2**LPC_BITS[i]);assert(Math.abs(reflectionValue(k,i))<1);});
  }
});

test('LPC reflection quantization represents silence and zero coefficients exactly',()=>{
  for(let i=0;i<10;i++)assert.equal(reflectionValue(reflectionIndex(0,i),i),0);
  const frame=analyseLpcFrame(new Float64Array(320));assert.equal(frame[0],0);assert.equal(frame[1],0);
  frame.slice(2).forEach((k,i)=>assert.equal(reflectionValue(k,i),0));
});

test('Bell Labs areas have positive physical sections and distinct vowel shapes',()=>{
  for(const phone of ['a','e','i','o','u','iy','uw','p','m']) {
    const areas=bellTractAreas(phone);assert.equal(areas.length,24);assert(areas.every(a=>a>0&&a<8));
  }
  assert.notDeepEqual(bellTractAreas('a'),bellTractAreas('iy'));
});

for(const mode of ['bell','lpc']) {
  test(`${mode}: every phone remains finite and bounded through release at common sample rates`,()=>{
    for(const rate of [44100,48000,96000]) for(const key of Object.keys(SPELLING_LPC_ATLAS)) {
      const {audio,core}=render(mode,config(key,{voicing:['s','f','th','k','p','t','sh'].includes(key)?0:.9}),rate,.36);
      assert(audio.every(x=>Number.isFinite(x)&&Math.abs(x)<=.85));
      assert(rms(audio)>.00001,`${mode}/${key} should sound`);
      assert(core.voices.every(v=>v.faults===0),`${mode}/${key} numerical guard must not be needed`);
      assert.equal(rms(audio.slice(-Math.round(rate*.025))),0,'finite note finishes');
    }
  });
  test(`${mode}: held vowels sustain, release and reset without a rendering clock`,()=>{
    const {core,audio}=render(mode,config('a',{sustain:true}),48000,.7);
    assert(rms(audio.slice(-4800))>.0001);core.release(.035);
    const tail=new Float32Array(4800);core.render(tail);assert.equal(rms(tail.slice(-2400)),0);
    core.start(config('a',{sustain:true}));core.render(tail);core.reset();core.render(tail);assert.equal(rms(tail),0);
    assert.equal(core.start(null),false);
  });
  test(`${mode}: pitch and brightness alter the actual synthesized signal`,()=>{
    const base=render(mode,config('a',{sustain:true})).audio;
    for(const changed of [{frequency:220},{brightness:.82},{breath:.8}]) {
      const varied=render(mode,config('a',{sustain:true,...changed})).audio;
      const delta=base.map((x,i)=>x-varied[i]);assert(rms(delta)>.0001);
    }
  });
  test(`${mode}: repeated phone transitions keep exactly two reusable bounded voices`,()=>{
    const core=new RetroSpeechCore(48000,mode),audio=new Float32Array(2048);
    const voices=[...core.voices];
    for(let i=0;i<80;i++){core.start(config(i%2?'a':'s',{frequency:65+i*4,voicing:i%2?.9:0,brightness:i%2?.8:1.2}));core.render(audio);assert(audio.every(x=>Number.isFinite(x)&&Math.abs(x)<=.85));}
    assert.deepEqual(core.voices,voices);assert(core.voices.every(v=>v.faults===0));
  });
}

test('retro backend maps phoneme, pitch, sustain and duration without changing preset-owned volume',()=>{
  const event={sampleKey:'a',articulation:'a',personality:'warm',sustain:true,dynamics:{durationMs:300,emphasis:.5},performance:{exciterPitch:150,articulationVoicing:1,articulationManner:'vowel'}};
  for(const mode of ['bell','lpc']) {
    const voice=retroVoiceConfiguration(event,mode);assert.equal(voice.frequency,150);assert.equal(voice.sustain,true);assert.equal(voice.brightness,.9);
    assert.equal(voice.duration,.3);assert(!('level' in voice));
  }
  assert.equal(retroVoiceConfiguration(null,'lpc'),null);
});

test('six retro scenes are additive; earlier Speak & Spell-ish remains a vocoder scene',()=>{
  assert.equal(presets.length,37+Object.values(EXTENDED_ENGINES).reduce((n,v)=>n+v.examples.length,0));assert.equal(presets.find(p=>p.id==='speak-spell').snapshot.engine,'vocoder');
  for(const mode of ['bell','lpc'])assert.equal(presets.filter(p=>p.snapshot.engine===mode).length,3);
  for(const {snapshot} of presets)assert(!('level' in snapshot)&&!('loop' in snapshot));
});
