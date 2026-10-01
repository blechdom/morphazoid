import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePhraseRenderer,planNativePhrase,sinsyScoreTimings} from '../src/instruments/voicesaurus/native-phrase.js';
import {nativeMusicalDefaults} from '../src/families/speech/native-musical-controls.js';
import {CSOUND_NATIVE} from '../src/instruments/voicesaurus/csound-native.js';
const sr=22050;
const note=(values={},rest=false)=>({rest,input:{phone:'ahh'},values:{...nativeMusicalDefaults('singer',{phone:'ahh'}),...values}});
const phrase=notes=>({tempo:120,notes});

test('native phrase fixes slot boundaries, fits release and leaves rests silent without editing values',async()=>{
 let initialized=0;const calls=[];
 const render=createNativePhraseRenderer({musicalFactory:async()=>{initialized++;return(_engine,input,values,options)=>{calls.push({input,values,options});return{sampleRate:sr,noteOffTime:values.duration,samples:new Float32Array(Math.round(Math.min(values.duration+values.release,options.maxRenderSeconds??Infinity)*sr)).fill(values.amplitude)};};}});
 const notes=[note({duration:.2,release:.08,amplitude:.2,pitch:-200,vibratoRate:1e6}),note({duration:.1,release:100},true),note({duration:.2,release:.1,amplitude:.3})],before=structuredClone(notes);
 const result=await render('singer',phrase(notes));assert.deepEqual(notes,before);
 assert.equal(calls.length,2);assert.equal(calls[0].values.pitch,-200);assert.equal(calls[0].values.vibratoRate,1e6);assert(Math.abs(calls[0].values.duration-.12)<1e-9);
 assert(result.samples.subarray(4410,6615).every(value=>value===0));assert.equal(result.noteTimings[0].end,.2);assert.equal(result.noteTimings[0].releaseEnd,.2);assert.equal(result.timingBasis,'native-note-slots');
 await render('singer',phrase([notes[0]]));assert.equal(initialized,1);
});

test('rest-only phrases preserve timeline silence without instantiating a native model',async()=>{
 const render=createNativePhraseRenderer({musicalFactory:()=>{throw Error('A rest should not instantiate a model.');}});
 const result=await render('singer',phrase([note({duration:.2},true)]));
 assert.equal(result.samples.length,4410);assert(result.samples.every(v=>v===0));assert.equal(result.noteTimings[0].releaseEnd,.2);
});

test('phrase validation separates native values from timeline, work and output budgets',()=>{
 assert.equal(planNativePhrase('singer',{tempo:-9,notes:[note({duration:.2,pitch:-1e6,amplitude:1e9})]}).notes[0].values.pitch,-1e6);
 assert.throws(()=>planNativePhrase('singer',phrase(Array.from({length:63},()=>note()))),/62/);
 assert.throws(()=>planNativePhrase('singer',phrase([note({duration:119,release:2})])),/120-second/);
 assert.doesNotThrow(()=>planNativePhrase('singer',phrase(Array.from({length:62},()=>note({duration:.01,release:25})))));
 assert.throws(()=>planNativePhrase('singer',phrase([note({duration:-1})])),/sequential phrase/);
 assert.throws(()=>planNativePhrase('singer',phrase([note({pitch:Infinity})])),/native phrase value/);
 const incomplete=note();delete incomplete.values.pitch;assert.throws(()=>planNativePhrase('singer',phrase([incomplete])),/incomplete/);
 const extra=note({unexpected:1});assert.throws(()=>planNativePhrase('singer',phrase([extra])),/incomplete/);
 assert.throws(()=>planNativePhrase('hts',phrase([note()])),/does not expose/);
});

test('native failures and invalid output format remain errors',async()=>{
 for(const result of [{samples:new Float32Array([1]),sampleRate:48000},{samples:new Float32Array([NaN]),sampleRate:sr}]){
   const render=createNativePhraseRenderer({musicalFactory:async()=>()=>result});await assert.rejects(render('singer',phrase([note()])),/PCM/);
 }
 let attempts=0;const render=createNativePhraseRenderer({musicalFactory:async()=>{if(!attempts++)throw Error('initialization failed');return()=>({sampleRate:sr,samples:new Float32Array([.1])});}});
 await assert.rejects(render('singer',phrase([note()])),/initialization/);assert((await render('singer',phrase([note()]))).samples.length>0);assert.equal(attempts,2);
});

test('Csound release is passed unchanged even when its buffer ends before authored gate',async()=>{
 const values=Object.fromEntries(Object.entries(CSOUND_NATIVE['csound-fof'].controls).map(([k,r])=>[k,r.default]));Object.assign(values,{duration:2/24000,release:-1/24000,pitch:-22});let received;
 const render=createNativePhraseRenderer({csoundRenderer:async(_engine,_input,p)=>{received=p;return{sampleRate:24000,samples:new Float32Array([.25])};}});
 const result=await render('csound-fof',phrase([{input:{},values}]));assert.equal(received,values);assert.equal(received.release,-1/24000);assert.equal(result.noteTimings[0].end,2/24000);assert.equal(result.noteTimings[0].releaseEnd,1/24000);assert.equal(result.samples.length,2);
});

test('Sinsy timing is explicitly score-derived with native boundary rests and unknown acoustic release',()=>{
 const result=sinsyScoreTimings({tempo:120,notes:[{midi:60,beats:1},{rest:true,beats:.5},{midi:64,beats:1.5}]});
 assert.equal(result.timingBasis,'score-derived');assert.equal(result.leadingRest,.125);assert.equal(result.trailingRest,.125);assert.equal(result.scoreDuration,1.75);
 assert.deepEqual(result.noteTimings.map(n=>[n.start,n.end,n.releaseEnd]),[[.125,.625,null],[.625,.875,null],[.875,1.625,null]]);
 assert.equal(sinsyScoreTimings({tempo:0,notes:[{midi:60,beats:1}]}).timingUnavailable,true);
 const explicit=sinsyScoreTimings({tempo:120,notes:[{rest:true,beats:.5},{midi:60,beats:1},{rest:true,beats:.5}]});assert.equal(explicit.leadingRest,0);assert.equal(explicit.trailingRest,0);assert.equal(explicit.scoreDuration,1);
});
