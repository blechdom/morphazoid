import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createNativePhraseRenderer,planNativePhrase,sinsyScoreTimings} from '../src/instruments/voicesaurus/native-phrase.js';
import {createNativeMusicalRenderer} from '../src/families/speech/native-musical-notes.js';
import {nativeMusicalDefaults} from '../src/families/speech/native-musical-controls.js';
import {CSOUND_NATIVE,renderNativeCsound} from '../src/instruments/voicesaurus/csound-native.js';
const sr=22050;
const note=(values={},rest=false,phone='ahh')=>({rest,input:{phone},values:{...nativeMusicalDefaults('singer',{phone}),...values}});
const phrase=(notes,options={})=>({tempo:120,notes,...options});
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const sha=samples=>createHash('sha256').update(new Uint8Array(samples.buffer,samples.byteOffset,samples.byteLength)).digest('hex');
const rms=samples=>Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length);

function stubRenderer(calls){return createNativePhraseRenderer({musicalFactory:async()=> (_engine,input,values,transition)=>{
 calls.push({input,values,transition});
 const seconds=Math.min(values.duration+values.release,transition.maxRenderSeconds??Infinity);
 return {samples:new Float32Array(Math.round(seconds*sr)).fill(values.amplitude),sampleRate:sr,noteOffTime:values.duration};
}});}

test('fixed slots fit interior release, silence rests, preserve stored parameters and the last tail',async()=>{
 const calls=[],render=stubRenderer(calls),source=phrase([note({duration:.2,release:.08,amplitude:.2,pitch:-200,vibratoRate:1e6}),note({duration:.1},true),note({duration:.2,release:.1,amplitude:.3})]);
 const before=structuredClone(source),result=await render('singer',source);
 assert.deepEqual(source,before);assert.equal(calls.length,2);near(calls[0].values.duration,.12);assert.equal(calls[0].values.release,.08);assert.equal(calls[0].values.pitch,-200);assert.equal(calls[0].values.vibratoRate,1e6);
 assert(result.samples.subarray(4410,6615).every(x=>x===0));near(result.duration,.6);
 near(result.noteTimings[0].end,.2);near(result.noteTimings[0].gateEnd,.12);near(result.noteTimings[0].releaseEnd,.2);near(result.noteTimings[2].start,.3);near(result.noteTimings[2].end,.5);near(result.noteTimings[2].releaseEnd,.6);
 assert.equal(calls[1].transition.previous,undefined);assert.equal(result.timingBasis,'native-note-slots');
});

test('release >= slot remains accepted, bounded and audible with a 5 ms boundary fade',async()=>{
 for(const release of [.2,80,1e20]){
  const calls=[],source=phrase([note({duration:.2,release,amplitude:.5}),note({duration:.1,release:0,amplitude:.25})]);
  const result=await stubRenderer(calls)('singer',source);
  assert.equal(calls[0].values.release,release);assert.equal(calls[0].values.duration,.2);assert.equal(calls[0].transition.maxRenderSeconds,.2);
  assert.equal(result.samples[0],.5);assert.equal(result.samples[4410-111],.5);assert.equal(result.samples[4409],0);assert.equal(result.samples[4410],.25);
  near(result.noteTimings[0].releaseEnd,.2);assert(result.noteTimings[0].boundaryFade>0);near(result.duration,.3);
 }
});

test('ports are independently optional and reached boundary state chains until a rest',async()=>{
 const calls=[];let pitch=10;
 const render=createNativePhraseRenderer({musicalFactory:async()=> (_engine,input,values,options)=>{calls.push(options);return {samples:new Float32Array(441),sampleRate:sr,transitionEnd:{input,values:{...values,pitch:pitch++}}};}});
 await render('singer',phrase([note({duration:.02}),note({duration:.02}),note({duration:.02},true),note({duration:.02})],{pitchPortamento:20,vowelPortamento:.2}));
 assert.equal(calls[0].previous,undefined);assert.equal(calls[1].previous.values.pitch,10);assert.equal(calls[2].previous,undefined);
 assert.equal(calls[1].pitchPortamento,20);assert.equal(calls[1].vowelPortamento,.2);
 const plan=planNativePhrase('singer',phrase([note()]));assert.equal(plan.pitchPortamento,0);assert.equal(plan.vowelPortamento,0);
});

test('rest-only phrase has timeline silence without a native module',async()=>{
 const render=createNativePhraseRenderer({musicalFactory:()=>{throw Error('Should not instantiate.');}});
 const result=await render('singer',phrase([note({duration:.2},true)]));assert.equal(result.samples.length,4410);assert(result.samples.every(x=>x===0));
});

test('host timing/budgets reject invalid schedules without imposing native knob bounds',()=>{
 const plan=planNativePhrase('singer',phrase([note({duration:.2,pitch:-1e6,amplitude:1e9,release:1e100}),note({duration:.2})],{pitchPortamento:1e20}));assert.equal(plan.notes[0].values.release,1e100);
 for(const options of [{pitchPortamento:-1},{vowelPortamento:Infinity}])assert.throws(()=>planNativePhrase('singer',phrase([note()],options)),/finite and nonnegative/);
 assert.throws(()=>planNativePhrase('singer',phrase(Array.from({length:63},()=>note()))),/62/);
 assert.throws(()=>planNativePhrase('singer',phrase([note({duration:119,release:2})])),/120-second/);
 assert.throws(()=>planNativePhrase('singer',phrase([note({duration:-1})])),/sequential phrase/);
 assert.throws(()=>planNativePhrase('singer',phrase([note({pitch:Infinity})])),/native phrase value/);
 const missing=note();delete missing.values.pitch;assert.throws(()=>planNativePhrase('singer',phrase([missing])),/incomplete/);
});

test('native PCM failures remain errors and failed module initialization can retry',async()=>{
 for(const result of [{samples:new Float32Array([1]),sampleRate:48000},{samples:new Float32Array([NaN]),sampleRate:sr}]){
  const render=createNativePhraseRenderer({musicalFactory:async()=>()=>result});await assert.rejects(render('singer',phrase([note()])),/PCM/);
 }
 let count=0;const render=createNativePhraseRenderer({musicalFactory:async()=>{if(!count++)throw Error('init failed');return()=>({samples:new Float32Array([.1]),sampleRate:sr});}});
 await assert.rejects(render('singer',phrase([note()])),/init failed/);await render('singer',phrase([note()]));assert.equal(count,2);
});

test('Sinsy score timing and native boundary rests remain unchanged',()=>{
 const result=sinsyScoreTimings({tempo:120,notes:[{midi:60,beats:1},{rest:true,beats:.5},{midi:64,beats:1.5}]});
 assert.equal(result.timingBasis,'score-derived');assert.equal(result.leadingRest,.125);assert.equal(result.trailingRest,.125);assert.equal(result.scoreDuration,1.75);
 assert.deepEqual(result.noteTimings.map(n=>[n.start,n.end,n.releaseEnd]),[[.125,.625,null],[.625,.875,null],[.875,1.625,null]]);
});

// Autocorrelation selects the shortest strong period, avoiding octave errors.
function measuredPitch(samples,sampleRate,time) {
 const width=Math.round(.04*sampleRate),offset=Math.round(time*sampleRate-width/2),scores=[];
 let mean=0;for(let i=0;i<width;i++)mean+=samples[offset+i];mean/=width;
 for(let lag=Math.round(sampleRate/480);lag<=Math.round(sampleRate/60);lag++){
  let cross=0,aa=0,bb=0;for(let i=0;i<width;i++){const a=samples[offset+i]-mean,b=samples[offset+i+lag]-mean;cross+=a*b;aa+=a*a;bb+=b*b;}
  scores.push({hz:sampleRate/lag,score:cross/Math.sqrt(aa*bb)});
 }
 const peaks=scores.filter((point,i)=>i>0&&i<scores.length-1&&point.score>=scores[i-1].score&&point.score>scores[i+1].score);
 const best=Math.max(...peaks.map(point=>point.score));
 return peaks.filter(point=>point.score>=best*.97).sort((a,b)=>b.hz-a.hz)[0];
}

const musical=await createNativeMusicalRenderer();
for(const engine of ['singer','stk-voicform']){
 const phone=engine==='singer'?'ahh':'aaa';
 const make=(phone,extra={})=>({input:{phone},values:{...nativeMusicalDefaults(engine,{phone}),duration:.6,release:.04,pitch:330,vibrato:0,jitter:0,attack:.005,...extra}});
 test(`${engine}: disabled ports are bit-identical; pitch and vowel controls independently change native PCM`,()=>{
  const current=make(phone),previous=make('eee',{pitch:110}),baseline=musical(engine,current.input,current.values),off=musical(engine,current.input,current.values,{previous,pitchPortamento:0,vowelPortamento:0});
  assert.equal(sha(baseline.samples),sha(off.samples));
  const pitch=musical(engine,current.input,current.values,{previous,pitchPortamento:.3}),vowel=musical(engine,current.input,current.values,{previous,vowelPortamento:.3}),both=musical(engine,current.input,current.values,{previous,pitchPortamento:.3,vowelPortamento:.3});
  for(const result of [baseline,pitch,vowel,both]){assert(result.samples.every(Number.isFinite));assert(rms(result.samples)>.001);assert.equal(result.samples.length,baseline.samples.length);assert.equal(result.samples[0],0);assert.equal(result.samples.at(-1),0);}
  assert.equal(new Set([baseline,pitch,vowel,both].map(r=>sha(r.samples))).size,4);
 });
 test(`${engine}: measured native pitch follows the requested linear portamento`,()=>{
  const current=make(phone,{pitch:300,duration:1,release:0,attack:.001,decay:0,sustain:1,amplitude:.4,noise:0}),previous=make(phone,{pitch:120});
  const result=musical(engine,current.input,current.values,{previous,pitchPortamento:.6});
  const times=[.03,.12,.27,.45,.68],measured=times.map(time=>measuredPitch(result.samples,result.sampleRate,time));
  for(let i=0;i<times.length;i++){const expected=120+180*Math.min(1,times[i]/.6);assert(Math.abs(measured[i].hz-expected)<4,`${engine}: expected ${expected}, measured ${measured[i].hz}`);assert(measured[i].score>.4);}
  assert.equal(result.transitionEnd.values.pitch,300);
 });
 if(engine==='stk-voicform')test('STK interrupted native destinations carry the reached pitch for zero, slow and negative rates',()=>{
  for(const [glide,expected]of [[0,180],[.00001,191.025],[-1,240]]){
   const current=make(phone,{pitch:300,duration:.8,release:0,attack:.001,decay:0,sustain:1,amplitude:.4,noise:0,pitchSweep:true,destinationPitch:550,changeTime:.2,glide}),previous=make(phone,{pitch:120});
   const result=musical(engine,current.input,current.values,{previous,pitchPortamento:.6,maxRenderSeconds:.4});
   near(result.transitionEnd.values.pitch,expected);
   const measured=measuredPitch(result.samples,result.sampleRate,.36);
   const expectedAtPoint=glide===0?180:glide<0?228:188.82;
   assert(Math.abs(measured.hz-expectedAtPoint)<4,`${glide}: native ${measured.hz} vs ${expectedAtPoint}`);
  }
  const current=make(phone,{pitch:330,glide:0,duration:.6,release:0,noise:0,amplitude:.4});
  const result=musical(engine,current.input,current.values);
  near(result.transitionEnd.values.pitch,75);assert(Math.abs(measuredPitch(result.samples,result.sampleRate,.3).hz-75)<2);
 });
 test(`${engine}: partial transitions carry reached native targets, including edited formants`,()=>{
  const current=make(phone,{duration:.5,release:80}),previous=make('eee',{pitch:110});
  const result=musical(engine,current.input,current.values,{previous,pitchPortamento:.4,vowelPortamento:.8,maxRenderSeconds:.1});
  near(result.transitionEnd.values.pitch,165);assert.equal(result.samples.length,2205);assert(result.samples.every(Number.isFinite));assert.equal(result.transitionEnd.values.release,80);
  if(engine==='singer'){assert.equal(result.transitionEnd.values.customShape,true);near(result.transitionEnd.values.radius1,previous.values.radius1*.875+current.values.radius1*.125);}
  else{assert.equal(result.transitionEnd.values.customFormants,true);near(result.transitionEnd.values.formant1,previous.values.formant1*.875+current.values.formant1*.125);}
 });
 test(`${engine}: within-note pitch and shape destinations win only after their event`,()=>{
  const current=make(phone,{duration:.4,release:.1,changeTime:.15,pitchSweep:true,destinationPitch:550,destination:'eee'}),previous=make(phone,{pitch:110});
  const before=musical(engine,current.input,current.values,{previous,pitchPortamento:.3,vowelPortamento:.3,maxRenderSeconds:.1});near(before.transitionEnd.values.pitch,110+220/3);assert.equal(before.transitionEnd.input.phone,phone);
  const after=musical(engine,current.input,current.values,{previous,pitchPortamento:.3,vowelPortamento:.3,maxRenderSeconds:.3});assert.equal(after.transitionEnd.values.pitch,550);assert.equal(after.transitionEnd.input.phone,'eee');assert(after.samples.every(Number.isFinite));
 });
}

const csoundModule=await WebAssembly.compile(await fs.readFile(new URL('../vendor/csound/csound.wasm',import.meta.url)));
for(const engine of ['singer','stk-voicform','csound-fof','csound-vosim'])test(`${engine}: real native phrase has strict slots, silent rests, and a preserved final tail`,async()=>{
 const isCs=engine.startsWith('csound-'),phone=engine==='singer'?'ahh':'aaa';
 const defaults=isCs?Object.fromEntries(Object.entries(CSOUND_NATIVE[engine].controls).map(([key,rule])=>[key,rule.default])):nativeMusicalDefaults(engine,{phone});
 const make=(pitch,rest=false,release=.08)=>({input:isCs?{}:{phone},values:{...defaults,pitch,duration:.2,release,attack:.005},rest});
 const render=createNativePhraseRenderer({musicalFactory:async()=>musical,csoundRenderer:(e,i,p,o)=>renderNativeCsound(e,i,p,o,async()=>csoundModule)});
 const source=phrase([make(110,false,80),make(220),make(220,true),make(330)],{pitchPortamento:.3,vowelPortamento:.25}),before=structuredClone(source);
 const result=await render(engine,source),rate=result.sampleRate;
 assert.deepEqual(source,before);assert(result.samples.every(Number.isFinite));assert(rms(result.samples)>.001);
 assert(result.samples.subarray(Math.round(.4*rate),Math.round(.6*rate)).every(x=>x===0));
 for(let i=0;i<3;i++)assert(result.noteTimings[i].releaseEnd<=result.noteTimings[i+1].start);
 near(result.noteTimings[0].releaseEnd,.2);assert(result.samples[Math.round(.2*rate)-1]===0);near(result.noteTimings[3].end,.8);assert(result.noteTimings[3].releaseEnd>.8);assert(result.duration>=.88&&result.duration<.882);
});
