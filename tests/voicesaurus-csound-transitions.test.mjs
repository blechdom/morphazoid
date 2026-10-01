import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {CSOUND_NATIVE,buildNativeCsoundVoice,renderNativeCsound} from '../src/instruments/voicesaurus/csound-native.js';

const defaults=engine=>Object.fromEntries(Object.entries(CSOUND_NATIVE[engine].controls).map(([key,rule])=>[key,rule.default]));
const previous=engine=>{const values=defaults(engine);Object.assign(values,{pitch:110,formant1:280,formant2:2300,formant3:3000,gain1:.7,gain2:.4,gain3:.1});if(engine==='csound-fof')Object.assign(values,{bandwidth1:90,bandwidth2:120,bandwidth3:160});return{input:{},values};};
const bytes=fs.readFileSync(new URL('../vendor/csound/csound.wasm',import.meta.url));
const module=await WebAssembly.compile(bytes),load=async()=>module;
const sha=samples=>createHash('sha256').update(new Uint8Array(samples.buffer,samples.byteOffset,samples.byteLength)).digest('hex');
const rms=samples=>Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/Math.max(1,samples.length));
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);

test('zero transition times leave the default native orchestra and score unchanged',()=>{
 for(const engine of Object.keys(CSOUND_NATIVE)){
  const p=defaults(engine),plain=buildNativeCsoundVoice(engine,p),disabled=buildNativeCsoundVoice(engine,p,{previous:previous(engine),pitchPortamento:0,vowelPortamento:0});
  assert.deepEqual(disabled,plain);assert.doesNotMatch(plain.orchestra,/kNotePitch|kFormant|kBandwidth|kGain/);
  assert.match(plain.orchestra,/kPitch = 145\*\(1\+kVib\)/);
 }
});

test('FOF ramps only native k/x-rate pitch, formant centers, bandwidths and gains',()=>{
 const p=defaults('csound-fof'),source=buildNativeCsoundVoice('csound-fof',p,{previous:previous('csound-fof'),pitchPortamento:.4,vowelPortamento:.2}).orchestra;
 assert.match(source,/kNotePitch linseg 110, 0.4, 145/);assert.match(source,/kPitch = kNotePitch\*\(1\+kVib\)/);
 assert.match(source,/kFormant1 linseg 280, 0.2, 700/);assert.match(source,/kGain1 linseg 0.7, 0.2, 1/);assert.match(source,/kBandwidth1 linseg 90, 0.2, 70/);
 assert.match(source,/a1 fof 0.2\*kGain1, kPitch, kFormant1, 0, kBandwidth1, 0.003, 0.03, 0.007, 2048, giSine, giEnv, p3, 0/);
 assert.match(source,/aEnv linseg 0,0.02,1,1.98,1,0.12,0/);
});

test('VOSIM uses native k-rate center/gain ramps without invented bandwidth parameters',()=>{
 const source=buildNativeCsoundVoice('csound-vosim',defaults('csound-vosim'),{previous:previous('csound-vosim'),pitchPortamento:.5,vowelPortamento:.25}).orchestra;
 assert.match(source,/a1 vosim 0.2\*kGain1, kPitch, kFormant1, 0.02, 3, 1, giEnv/);assert.doesNotMatch(source,/Bandwidth/);
});

test('zero and signed pitch/formant/gain endpoints are emitted unchanged',()=>{
 const p=defaults('csound-vosim'),from=previous('csound-vosim');Object.assign(from.values,{pitch:0,formant1:-320,gain1:-2});Object.assign(p,{pitch:-220,formant1:0,gain1:0});
 const before=structuredClone({p,from}),source=buildNativeCsoundVoice('csound-vosim',p,{previous:from,pitchPortamento:4,vowelPortamento:5}).orchestra;
 assert.match(source,/kNotePitch linseg 0, 4, -220/);assert.match(source,/kFormant1 linseg -320, 5, 0/);assert.match(source,/kGain1 linseg -2, 5, 0/);assert.deepEqual({p,from},before);
});

test('a missing previous note disables transitions; oversized ramp times stay authored',()=>{
 const engine='csound-fof',p=defaults(engine);
 assert.deepEqual(buildNativeCsoundVoice(engine,p,{pitchPortamento:20,vowelPortamento:30}),buildNativeCsoundVoice(engine,p));
 assert.match(buildNativeCsoundVoice(engine,p,{previous:previous(engine),pitchPortamento:20}).orchestra,/kNotePitch linseg 110, 20, 145/);
});

test('FOF grain memory estimate includes the initial pitch during a downward glide',()=>{
 const p=defaults('csound-fof'),from=previous('csound-fof');from.values.pitch=1e9;
 assert.throws(()=>buildNativeCsoundVoice('csound-fof',p,{previous:from,pitchPortamento:1}),/grain-allocation memory/);
 assert.doesNotThrow(()=>buildNativeCsoundVoice('csound-fof',p,{previous:from,pitchPortamento:0}));
});

test('rendering caps shorten native score duration without changing envelope parameters',()=>{
 const p=defaults('csound-fof');p.release=80;const voice=buildNativeCsoundVoice('csound-fof',p,{maxRenderSeconds:.25});
 assert.equal(voice.score,'i1 0 0.25\ne');assert.equal(voice.renderDuration,.25);assert.equal(voice.maxSeconds,1.25);
 assert.match(voice.orchestra,/aEnv linseg 0,0.02,1,1.98,1,80,0/);assert.equal(p.release,80);
});

test('host transition times/caps reject invalid scheduling data without native value clamping',()=>{
 const p=defaults('csound-vosim');
 for(const options of [{pitchPortamento:-1},{vowelPortamento:Infinity},{maxRenderSeconds:NaN}])assert.throws(()=>buildNativeCsoundVoice('csound-vosim',p,options),/finite/);
});

for(const engine of Object.keys(CSOUND_NATIVE))test(`${engine}: actual WASM has finite distinct glides and unchanged disabled output`,async()=>{
 const p=defaults(engine);Object.assign(p,{pitch:220,duration:.36,release:.04,vibrato:0});const from=previous(engine);
 const original=await renderNativeCsound(engine,{},p,{},load),off=await renderNativeCsound(engine,{},p,{previous:from,pitchPortamento:0,vowelPortamento:0},load);
 assert.equal(sha(original.samples),sha(off.samples));
 const pitch=await renderNativeCsound(engine,{},p,{previous:from,pitchPortamento:.3},load);
 const vowel=await renderNativeCsound(engine,{},p,{previous:from,vowelPortamento:.3},load);
 const both=await renderNativeCsound(engine,{},p,{previous:from,pitchPortamento:.3,vowelPortamento:.3},load);
 for(const result of [original,pitch,vowel,both]){assert.equal(result.sampleRate,24000);assert.ok(result.samples.every(Number.isFinite));assert.ok(rms(result.samples)>.001);assert.equal(result.samples.length,original.samples.length);}
 assert.equal(new Set([original,pitch,vowel,both].map(result=>sha(result.samples))).size,4);
});

for(const engine of Object.keys(CSOUND_NATIVE))test(`${engine}: native partial glides return the actual capped boundary state`,async()=>{
 const p=defaults(engine);Object.assign(p,{pitch:330,duration:.5,release:2});const from=previous(engine),before=structuredClone({p,from});
 const result=await renderNativeCsound(engine,{},p,{previous:from,pitchPortamento:.4,vowelPortamento:.8,maxRenderSeconds:.1},load);
 assert.ok(result.samples.length/24000<=.1+32/24000);assert.ok(result.samples.every(Number.isFinite));
 near(result.transitionEnd.values.pitch,165);near(result.transitionEnd.values.formant1,332.5);near(result.transitionEnd.values.gain1,.7375);
 if(engine==='csound-fof')near(result.transitionEnd.values.bandwidth1,87.5);
 assert.equal(result.transitionEnd.values.release,2);assert.deepEqual({p,from},before);
});
