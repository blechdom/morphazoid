import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STEP, TAU, DEFAULTS, TRICKS, createYoyo, throwYoyo, bindYoyo, tugYoyo, setTrick, stepYoyo, soundingState, snapshot, settings } from "../src/yoyodyne.js";
import { KineticStringDSP, sanitizeSound } from "../src/yoyodyne-dsp.js";
const advance = (w, seconds, automatic = false) => { for (let i=0;i<Math.round(seconds/STEP);i++) stepYoyo(w,{automatic}); return w; };
const rms = a => Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length);
const peak = a => a.reduce((s,v)=>Math.max(s,Math.abs(v)),0);
const source = p => readFile(new URL("../"+p,import.meta.url),"utf8");
const frame = {frequency:147,spin:80,energy:.7,speed:.4,friction:.24,tone:.28,pan:0,angle:1.57,held:0};
function render(state=frame,seconds=1,rate=48000) {
 const dsp=new KineticStringDSP(rate),left=new Float32Array(seconds*rate),right=new Float32Array(left.length);
 dsp.setState(state);dsp.process(left,right);return {dsp,left,right};
}
test("deterministic reset starts held, unexcited and independently mutable",()=>{
 const a=createYoyo(),b=createYoyo();assert.deepEqual(a,b);assert.equal(soundingState(a).energy,0);
 a.settings.length=.4;assert.equal(b.settings.length,DEFAULTS.length);
 assert.equal(settings({tempo:Infinity,length:-2}).length,.35);
 assert.equal(settings({tempo:Infinity}).tempo,90);
});
test("throw, decoupled sleeper spin, lossy bind and catch are distinct states",()=>{
 const w=createYoyo();assert.equal(throwYoyo(w),true);assert.equal(throwYoyo(w),false);
 advance(w,1);assert.equal(w.mode,"sleeping");assert.ok(w.omega>100);
 const spin=w.omega;advance(w,.5);assert.ok(w.omega<spin);assert.ok(Math.abs(w.length-.86)<.001);
 bindYoyo(w);assert.equal(w.mode,"rewinding");advance(w,2);
 assert.equal(w.mode,"held");assert.equal(w.catches,1);assert.equal(soundingState(w).energy,0);
});
test("around the world actually circles the hand with a full paid-out string",()=>{
 const w=createYoyo();setTrick(w,"around-world");throwYoyo(w);
 let angle=0,travel=0,min=0,max=0,started=false,overhead=false;
 for(let i=0;i<720;i++){
  stepYoyo(w);if(w.mode!=="sleeping")continue;
  const a=Math.atan2(w.y-w.hand.y,w.x-w.hand.x);
  if(started)travel+=Math.atan2(Math.sin(a-angle),Math.cos(a-angle));
  started=true;angle=a;min=Math.min(min,travel);max=Math.max(max,travel);
  if(w.y-w.hand.y<-.65)overhead=true;
 }
 assert.ok(max-min>TAU,"one complete orbit after payout");assert.ok(overhead);
});
test("cradle accounts for every visible string segment, including short rigs",()=>{
 for(const length of [.35,.6,.86,1.2]){
  const w=createYoyo({length});setTrick(w,"cradle");throwYoyo(w);advance(w,1.8);
  assert.ok(w.mount>0);assert.equal(w.stringPoints.length,6);
  const total=w.stringPoints.slice(1).reduce((s,p,i)=>s+Math.hypot(p.x-w.stringPoints[i].x,p.y-w.stringPoints[i].y),0);
  assert.ok(total<=w.length+.004, "mount does not invent string: "+total+" / "+w.length);
 }
});
test("four automated routines repeat and all physics remains bounded",()=>{
 for(const trick of TRICKS){
  const w=createYoyo();setTrick(w,trick.id);
  for(let i=0;i<4800;i++){
   stepYoyo(w,{automatic:true});
   assert.ok([w.x,w.y,w.vx,w.vy,w.omega,w.tension,w.length].every(Number.isFinite));
   assert.ok(w.tension>=0 && w.tension<=80);assert.ok(w.omega>=0&&w.omega<=1200);
   assert.ok(Math.abs(w.x)<=1.5&&w.y<=1.45&&w.y>=-1.25);
  }
  assert.ok(w.launches>=2,trick.id);assert.ok(w.catches>=1,trick.id);
 }
});
test("gravity, spin loss, throw energy, hand movement and tug have real destinations",()=>{
 const launch=s=>{const w=createYoyo(s);throwYoyo(w);return w;};
 const low=launch({energy:.1}),high=launch({energy:1});assert.ok(high.omega>low.omega*1.5);
 const noG=launch({gravity:0}),g=launch({gravity:1});advance(noG,.25);advance(g,.25);assert.ok(g.y>noG.y+.05);
 const loose=launch({friction:0}),lossy=launch({friction:1});advance(loose,2);advance(lossy,2);assert.ok(lossy.omega<loose.omega*.8);
 const a=launch(),b=launch();advance(a,1);advance(b,1);b.targetHand={x:.6,y:-.2};advance(a,.3);advance(b,.3);
 assert.ok(Math.abs(a.x-b.x)>.02);assert.ok(Math.abs(a.tension-b.tension)>.01);
 tugYoyo(a);assert.ok(a.pluck>.2);advance(a,.1);assert.ok(a.hand.y<-.1);
});
test("trick and parameter edits preserve state instead of teleporting or restarting",()=>{
 const w=createYoyo();throwYoyo(w);advance(w,1);
 const before=snapshot(w);setTrick(w,"cradle");w.settings.tempo=150;
 assert.deepEqual(snapshot(w),before);assert.equal(w.launches,1);
 advance(w,.1);assert.ok(w.time>before.time);assert.equal(w.launches,1);
});
test("string length and tension map monotonically to pitch; body side maps to stereo",()=>{
 const w=createYoyo();throwYoyo(w);advance(w,1);w.mount=0;w.tension=1;w.length=.8;
 const f=soundingState(w).frequency;w.length=.4;assert.ok(Math.abs(soundingState(w).frequency/f-2)<1e-8);
 w.length=.8;w.tension=4;assert.ok(Math.abs(soundingState(w).frequency/f-2)<1e-8);
 w.x=-.8;assert.ok(soundingState(w).pan<-.5);w.x=.8;assert.ok(soundingState(w).pan>.5);
});
test("hostile control corners remain finite and snapshots cannot mutate the model",()=>{
 for(const s of [{length:.35,tempo:180,gravity:1.8,elasticity:1,energy:1,friction:0},
 {length:1.2,tempo:45,gravity:0,elasticity:0,energy:.1,friction:1}]){
  for(const trick of TRICKS){
   const w=createYoyo(s);setTrick(w,trick.id);advance(w,12,true);
   assert.ok(Object.values(soundingState(w)).every(Number.isFinite));
   const copy=snapshot(w);copy.hand.x=100;copy.stringPoints[0].x=100;assert.notEqual(w.hand.x,100);
  }
 }
});
test("DSP starts silent, sustains finite stereo and stays below its ceiling at every supported rate",()=>{
 for(const rate of [8000,44100,48000,96000,192000]){
  const silent=render({held:1},.1,rate);assert.equal(peak(silent.left),0);
  const {left,right}=render(frame,.5,rate);
  assert.ok(left.every(Number.isFinite)&&right.every(Number.isFinite));
  assert.ok(rms(left)>.01&&rms(right)>.01);assert.ok(peak(left)<.8&&peak(right)<.8);
 }
});
test("DSP catch damps to silence, hostile states sanitize and transitions stay bounded",()=>{
 const {dsp,left}=render();const release=new Float32Array(48000);
 dsp.setState({held:1,energy:0});dsp.process(release);
 assert.ok(rms(release.subarray(24000))<1e-6);
 assert.ok(peak(left)>.05);
 const sanitized=sanitizeSound({frequency:NaN,spin:Infinity,energy:100,pan:-100,held:true});
 assert.equal(sanitized.energy,1);assert.equal(sanitized.pan,-.95);assert.ok(Object.values(sanitized).every(Number.isFinite));
 dsp.setState({...frame,frequency:1600,tone:1,energy:1,pan:.95});
 const transition=new Float32Array(4800);dsp.process(transition);
 assert.ok(peak(transition)<.8);
 let delta=0;for(let i=1;i<transition.length;i++)delta=Math.max(delta,Math.abs(transition[i]-transition[i-1]));
 assert.ok(delta<.2);
});
test("every sonic driver changes the rendered signal and panning affects channel energy",()=>{
 const base=render(frame).left;
 for(const [key,value] of Object.entries({frequency:220,spin:15,energy:.3,speed:9,friction:.95,tone:.95,angle:0,pluck:.7})){
  const a=render({...frame,[key]:value}).left;
  const difference=Math.sqrt(a.reduce((sum,v,i)=>sum+(v-base[i])**2,0)/a.length);
  assert.ok(difference>0.0001,key+" has no measured leverage");
 }
 const left=render({...frame,pan:-.9});assert.ok(rms(left.left)>rms(left.right)*8);
});
test("all tricks excite distinct bounded continuous phrases",()=>{
 const results=[];
 for(const trick of TRICKS){
  const w=createYoyo();setTrick(w,trick.id);const dsp=new KineticStringDSP(48000);
  const samples=new Float32Array(200),features={energy:0,pitch:0,side:0};
  for(let i=0;i<1440;i++){stepYoyo(w,{automatic:true});const f=soundingState(w);dsp.setState(f);dsp.process(samples);
   assert.ok(samples.every(Number.isFinite));assert.ok(peak(samples)<.8);
   features.energy+=rms(samples);features.pitch+=f.frequency;features.side+=Math.abs(f.pan);
  }
  assert.ok(features.energy>1);results.push(features);
 }
 for(let i=0;i<results.length;i++)for(let j=i+1;j<results.length;j++)
  assert.ok(Math.abs(results[i].pitch-results[j].pitch)>100 || Math.abs(results[i].side-results[j].side)>1);
});
test("source and build inventory expose kinetic modules without timeline or browser WAX bootstrap",async()=>{
 const html=await source("yoyodyne.html"),app=await source("yoyodyne-app.js"),build=await source("scripts/build-site.sh");
 assert.match(html,/data-primary-transport/);assert.match(html,/aria-pressed="false"/);
 assert.match(html,/aria-label="[^"]+"/);assert.match(html,/tabindex="0"/);
 assert.doesNotMatch(html,/data-morphazoid-wax-bootstrap|data-note-id|selectedPitch/);
 assert.doesNotMatch(app,/requestAnimationFrame\(pump|createYoyodynePhrase/);
 for(const path of ["src/yoyodyne.js","src/yoyodyne-audio.js","src/yoyodyne-dsp.js","src/yoyodyne-processor.js","docs/yoyodyne-kinetic.md"])
  assert.equal(build.split(path).length-1,2,path+" included in both builder manifests");
});
test("worklet drops stale and distant frames, bounds its queue, fades on starvation and disposes",async()=>{
 const keys=["AudioWorkletProcessor","registerProcessor","sampleRate","currentTime"];
 const previous=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 let Processor;
 try {
  globalThis.AudioWorkletProcessor=class{constructor(){this.port={};}};
  globalThis.registerProcessor=(_name,type)=>{Processor=type;};
  globalThis.sampleRate=48000;globalThis.currentTime=0;
  await import("../src/yoyodyne-processor.js");
  const p=new Processor(),send=data=>p.port.onmessage({data});
  send({type:"frames",frames:[{time:-10,state:frame},{time:100,state:frame}]});assert.equal(p.queue.length,0);
  for(let i=0;i<8;i++)send({type:"frames",frames:Array.from({length:64},(_,n)=>({time:n/1000,state:frame}))});
  assert.equal(p.queue.length,128);
  const left=new Float32Array(128),right=new Float32Array(128);let loudest=0;
  for(let i=0;i<300;i++){globalThis.currentTime=i*128/48000;p.process([],[[left,right]]);loudest=Math.max(loudest,peak(left));}
  assert.ok(loudest>.01);assert.ok(peak(left)<1e-6);assert.equal(p.queue.length,0);
  send({type:"frames",frames:[{time:currentTime,state:frame}]});send({type:"mute"});assert.equal(p.queue.length,0);
  send({type:"dispose"});assert.equal(p.process([],[[left,right]]),false);
 }finally{for(const key of keys){if(previous[key])Object.defineProperty(globalThis,key,previous[key]);else delete globalThis[key];}}
});
