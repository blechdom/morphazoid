import test from 'node:test';
import assert from 'node:assert/strict';
import {HandOutput,HAND_OUTPUT_GAIN,HAND_OUTPUT_CEILING} from '../src/instruments/gesticulating-hand/hand-output.js';
const RATES=[8000,11025,16000,24000,44100,48000,96000,192000];
const tau=2*Math.PI;
function run(stage,left,right,chunk=128){
 const l=Float32Array.from(left),r=Float32Array.from(right);
 for(let i=0;i<l.length;i+=chunk)stage.process(l.subarray(i,i+chunk),r.subarray(i,i+chunk));
 return {left:l,right:r};
}
function bounded(channels){for(const channel of Object.values(channels))for(const value of channel)assert.ok(Number.isFinite(value)&&Math.abs(value)<=HAND_OUTPUT_CEILING+3e-8);}

test('sub-threshold stereo retains exactly 4x gain, waveform and dynamics after the stated delay at every rate',()=>{
 assert.equal(HAND_OUTPUT_GAIN,4);
 for(const rate of RATES){
  const stage=new HandOutput(rate),left=Float32Array.from({length:Math.ceil(rate*.08)},(_,i)=>.1*Math.sin(tau*217*i/rate)+.015*Math.sin(tau*1901*i/rate)),right=Float32Array.from(left,(x,i)=>x*.43+.03*Math.cos(tau*113*i/rate));
  const result=run(stage,left,right);
  assert.ok(Math.abs(stage.latencyFrames/rate-.0015)<=.5/rate);
  for(let i=0;i<left.length;i++){
   const delayed=i-stage.latencyFrames;
   assert.equal(result.left[i],delayed<0?0:Math.fround(left[delayed]*4));
   assert.equal(result.right[i],delayed<0?0:Math.fround(right[delayed]*4));
  }
  assert.equal(stage.gainReductionDb,0);
 }
});

test('lookahead ramps the attack before an isolated peak and release recovers gradually without channel clipping',()=>{
 for(const rate of RATES){
  const stage=new HandOutput(rate),delay=stage.latencyFrames,hit=delay*5,length=hit+delay+Math.ceil(rate*.65);
  const left=new Float32Array(length).fill(.05),right=new Float32Array(length).fill(-.0185);left[hit]=1;right[hit]=-.37;
  const result=run(stage,left,right);bounded(result);
  for(let i=hit+1;i<hit+delay;i++){
   assert.ok(result.left[i]<=result.left[i-1]+1e-7);
   assert.ok(Math.abs(result.left[i]-result.left[i-1])<.02);
  }
  assert.ok(Math.abs(result.left[hit+delay]-HAND_OUTPUT_CEILING)<1e-6);
  const at80=result.left[hit+delay+Math.round(rate*.08)]/.2;
  assert.ok(at80>.65&&at80<.8,`${rate}: 80 ms gain ${at80}`);
  assert.ok(result.left.at(-1)/.2>.999);
  for(let i=0;i<length;i++)assert.ok(Math.abs(result.right[i]+result.left[i]*.37)<5e-8);
 }
});

test('sustained limiting preserves sine crests instead of creating flat clipped peaks',()=>{
 const rate=48000,stage=new HandOutput(rate),left=Float32Array.from({length:rate},(_,i)=>.8*Math.sin(tau*500*i/rate)),right=Float32Array.from(left,x=>x*.2);
 const result=run(stage,left,right);bounded(result);
 let energy=0,peak=0,nearPeak=0;const start=Math.round(rate*.5);
 for(let i=start;i<rate;i++){const x=result.left[i];energy+=x*x;peak=Math.max(peak,Math.abs(x));if(Math.abs(x)>.88)nearPeak++;}
 const crest=peak/Math.sqrt(energy/(rate-start));
 assert.ok(crest>1.38&&crest<1.46);assert.ok(nearPeak/(rate-start)<.12);
 assert.ok(stage.gainReductionDb>10);
});

test('arbitrary peaks and simultaneous opposite-channel demands stay finite and stereo-linked across sample rates',()=>{
 for(const rate of RATES){
  const stage=new HandOutput(rate),length=Math.ceil(rate*.1),left=Float64Array.from({length},(_,i)=>i%73===0?120:.73*Math.sin(i*.71)),right=Float64Array.from({length},(_,i)=>i%101===0?-90:.67*Math.cos(i*.37));
  left[11]=NaN;left[22]=Infinity;right[23]=-Infinity;
  const result=run(stage,left,right,31);bounded(result);
  for(let i=stage.latencyFrames;i<length;i++){
   const a=left[i-stage.latencyFrames],b=right[i-stage.latencyFrames];
   if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)<1e-4||Math.abs(b)<1e-4)continue;
   const gL=result.left[i]/Math.fround(a*4),gR=result.right[i]/Math.fround(b*4);
   assert.ok(Math.abs(gL-gR)<2e-7);
  }
 }
});

test('block segmentation never changes limiting and reset clears every delayed sample and gain envelope',()=>{
 const rate=48000,left=Float32Array.from({length:12007},(_,i)=>.4*Math.sin(i*.071)+.3*Math.cos(i*.219)),right=Float32Array.from(left,(x,i)=>x*.73+.2*Math.sin(i*.031));
 const reference=run(new HandOutput(rate),left,right,128);
 for(const chunk of [1,7,31,257,12007])assert.deepEqual(run(new HandOutput(rate),left,right,chunk),reference);
 const stage=new HandOutput(rate);run(stage,left,right);stage.reset();assert.equal(stage.rms,0);assert.equal(stage.peak,0);assert.equal(stage.gainReductionDb,0);
 assert.deepEqual(run(stage,left,right),reference);
 stage.reset();const silent=new Float32Array(512);stage.process(silent,silent);assert.ok(silent.every(value=>value===0));
 const mono=new Float32Array(256).fill(.1);stage.reset();stage.process(mono);for(let i=0;i<mono.length;i++)assert.equal(mono[i],i<stage.latencyFrames?0:Math.fround(.4));
});

test('telemetry measures the actual post-stage stereo block and startup needs no external state',()=>{
 const stage=new HandOutput(48000),left=new Float32Array(1024).fill(.3),right=new Float32Array(1024).fill(.1);
 stage.process(left,right);let power=0,peak=0;
 for(let i=0;i<left.length;i++){power+=(left[i]*left[i]+right[i]*right[i])*.5;peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));}
 assert.ok(Math.abs(stage.rms-Math.sqrt(power/left.length))<3e-8);assert.ok(Math.abs(stage.peak-peak)<3e-8);assert.ok(stage.peak<=.89);
});
