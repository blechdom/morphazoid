import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CSOUND_NATIVE,buildNativeCsoundVoice,renderNativeCsound} from '../src/instruments/voicesaurus/csound-native.js';
import {renderCsound} from '../src/families/speech/csound-runtime.js';
const module=await WebAssembly.compile(fs.readFileSync(new URL('../vendor/csound/csound.wasm',import.meta.url))),load=async()=>module;
const defaults=engine=>Object.fromEntries(Object.entries(CSOUND_NATIVE[engine].controls).map(([key,rule])=>[key,rule.default]));
const rms=samples=>Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/Math.max(1,samples.length));

test('zero, negative and completed attack cases retain their native envelope requests',()=>{
 for(const engine of Object.keys(CSOUND_NATIVE))for(const patch of [{},{duration:.4,attack:.4},{duration:.5,attack:.4},{duration:0,attack:.4},{duration:-.1,attack:.4},{duration:.1,attack:0},{duration:.1,attack:-.4}]){
  const p={...defaults(engine),...patch};assert(buildNativeCsoundVoice(engine,p).orchestra.includes(`aEnv linseg 0,${p.attack},1,${p.duration-p.attack},1,${p.release},0`));
 }
});

for(const engine of Object.keys(CSOUND_NATIVE))test(`${engine}: native short-gate release reaches zero within the slot and preserves the attack`,async()=>{
 const p={...defaults(engine),duration:.08,attack:.4,release:.05,vibrato:0},before=structuredClone(p);
 const voice=buildNativeCsoundVoice(engine,p);
 // Differential reference: the original envelope with a negative hold segment.
 const legacyOrchestra=voice.orchestra.replace(/^aEnv .+$/m,`aEnv linseg 0,${p.attack},1,${p.duration-p.attack},1,${p.release},0`);
 const legacy=renderCsound(module,legacyOrchestra,voice.score,{maxSeconds:voice.maxSeconds});
 const next=await renderNativeCsound(engine,{},p,{},load);
 assert.deepEqual(p,before);assert.equal(next.samples.length,legacy.samples.length);assert(next.samples.every(Number.isFinite));
 const attackFrames=Math.floor(p.duration*24000)-32;
 for(let i=0;i<attackFrames;i++)assert.equal(next.samples[i],legacy.samples[i]);
 assert(next.samples.at(-1)===0);assert(rms(next.samples)>.0001);
 assert(rms(legacy.samples.subarray(-120))>10*rms(next.samples.subarray(-120)));
 const slotEnd=Math.round((p.duration+p.release)*24000);assert(next.samples.subarray(slotEnd).every(value=>value===0));
});
