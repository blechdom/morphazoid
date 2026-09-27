import test from 'node:test';
import assert from 'node:assert/strict';
import {HandDSP} from '../src/instruments/gesticulating-hand/hand-dsp.js';
import {HandOutput,HAND_OUTPUT_CEILING} from '../src/instruments/gesticulating-hand/hand-output.js';
import {HAND_RHYTHMS,VOICE_SOURCES,normalizeHandConfig,evaluateHandPose,evaluateHandVoices,handEffectiveTempo,setHandEffectiveTempo,handMotionPeriod} from '../src/instruments/gesticulating-hand/hand-model.js';
import {handRhythmPhase} from '../src/instruments/gesticulating-hand/hand-rhythm.js';

const rms=values=>Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);
const peak=values=>values.reduce((maximum,value)=>Math.max(maximum,Math.abs(value)),0);
const difference=(a,b)=>a.reduce((maximum,value,i)=>Math.max(maximum,Math.abs(value-b[i])),0);
const poseVector=pose=>[...pose.fingers.flatMap(finger=>Object.values(finger)),...Object.values(pose.wrist),...Object.values(pose.foot??{})];
function scene(rhythm='walk',form='hand',extra={}){
 return normalizeHandConfig({form,motion:{id:'still',tempo:120,speed:1,amount:0},tremor:{amount:0},
  sound:{rhythm,noteLength:.4,rootHz:137,space:0,rotationFx:0,attack:.004,release:.04},
  voices:Array.from({length:5},(_,index)=>({source:'wire',level:.7,mute:index!==0})),...extra});
}
function engine(config,rate=12000){const dsp=new HandDSP(rate);dsp.setConfig(config);dsp.setEnabled(true);dsp.setSoundPlaying(true);dsp.setTransport({time:0,playing:true});return dsp;}
function render(dsp,seconds,chunk=128,output=null){
 const left=new Float32Array(Math.round(seconds*dsp.sampleRate)),right=new Float32Array(left.length),start=dsp.clock;
 for(let offset=0;offset<left.length;offset+=chunk){
  const l=left.subarray(offset,offset+chunk),r=right.subarray(offset,offset+chunk);dsp.process(l,r,start+offset/dsp.sampleRate);output?.process(l,r);
 }
 return {left,right};
}

for(const form of ['hand','foot'])test(`${form} walking notes make audible attacks and written rests, with visible taps on the same beat`,()=>{
 const config=scene('walk',form),dsp=engine(config),{left}=render(dsp,2.5),rate=dsp.sampleRate;
 const window=(start,end)=>rms(left.subarray(Math.round(start*rate),Math.round(end*rate)));
 assert.ok(window(.025,.075)>.005);assert.ok(window(.19,.235)<1e-6);
 assert.ok(window(2.025,2.075)>.005);assert.ok(window(2.39,2.45)<1e-6);
 const resting=evaluateHandPose(config,.2),tap=evaluateHandPose(config,.05);
 assert.ok(tap.fingers[0].mcp-resting.fingers[0].mcp>10);
 assert.ok(tap.fingers[0].dip-resting.fingers[0].dip>8);
 for(let i=1;i<5;i++)assert.deepEqual(tap.fingers[i],resting.fingers[i]);
 if(form==='foot')assert.equal(tap.fingers[0].pip,0);
 const longer=scene('walk',form,{sound:{...config.sound,noteLength:.8}}),extended=engine(longer);
 render(dsp,.01);render(extended,.16);assert.equal(extended.voices[0].gated,true);
 const shorter=engine(config);render(shorter,.16);assert.equal(shorter.voices[0].gated,false);
});

test('manual held notes and auditions override a written rest without arming a disabled engine',()=>{
 const config=scene('walk','foot',{voices:Array.from({length:5},()=>({source:'wire',level:.7}))}),dsp=engine(config);
 dsp.setTransport({time:2.375,playing:false});assert.ok(dsp.voices.every((_,i)=>handRhythmPhase('walk',4.75,i)===-1));
 assert.equal(peak(render(dsp,.1).left),0);
 dsp.setHeldFingers(2);assert.ok(rms(render(dsp,.12).left)>.005);assert.equal(dsp.voices[1].gated,true);
 for(const i of [0,2,3,4])assert.equal(dsp.voices[i].gated,false);
 dsp.setHeldFingers(0);render(dsp,.25);assert.ok(peak(render(dsp,.04).left)<1e-7);
 assert.equal(dsp.auditionFinger(3,.12),true);assert.ok(rms(render(dsp,.06).left)>.005);assert.equal(dsp.voices[3].gated,true);
 render(dsp,.3);assert.ok(peak(render(dsp,.04).left)<1e-7);
 dsp.setEnabled(false);dsp.setHeldFingers(31);assert.equal(dsp.auditionFinger(1),false);
 assert.equal(peak(render(dsp,.1).left),0);assert.ok(dsp.voices.every(voice=>!voice.gated));
});

test('three-against-four gives the index three attacks and middle four attacks in four beats',()=>{
 const rate=8000,config=scene('three-four','hand',{motion:{id:'still',tempo:60,speed:1,amount:0},voices:Array.from({length:5},()=>({source:'wire',level:.1}))}),dsp=engine(config,rate);
 const left=new Float32Array(1),right=new Float32Array(1),prior=[false,false],attacks=[[],[]];
 for(let frame=0;frame<rate*4;frame++){
  dsp.process(left,right,frame/rate);
  for(let slot=0;slot<2;slot++){const gated=dsp.voices[slot+1].gated;if(gated&&!prior[slot])attacks[slot].push(frame/rate);prior[slot]=gated;}
 }
 assert.equal(attacks[0].length,3);assert.equal(attacks[1].length,4);
 for(let i=0;i<3;i++)assert.ok(Math.abs(attacks[0][i]-i*4/3)<=1/rate+1e-12);
 for(let i=0;i<4;i++)assert.ok(Math.abs(attacks[1][i]-i)<=1/rate+1e-12);
});

test('pause freezes both note phase and visible tap, while Sound retains the current held note',()=>{
 for(const form of ['hand','foot']){
  const config=scene('walk',form),dsp=engine(config);render(dsp,.047);
  dsp.setTransport({playing:false});const frozen=dsp.getMotionTime(),pose=evaluateHandPose(config,frozen),gates=dsp.voices.map(voice=>voice.gated);
  const sustained=render(dsp,.3);assert.equal(dsp.getMotionTime(),frozen);assert.deepEqual(dsp.voices.map(voice=>voice.gated),gates);
  assert.ok(difference(poseVector(dsp.pose),poseVector(pose))<1e-12);assert.ok(rms(sustained.left)>.005);
  dsp.setTransport({playing:true});render(dsp,.16);assert.ok(dsp.getMotionTime()>frozen+.15);assert.equal(dsp.voices[0].gated,false);
  dsp.setTransport({time:.2,playing:false});render(dsp,.3);assert.equal(dsp.getMotionTime(),.2);assert.ok(dsp.voices.every(voice=>!voice.gated));
  assert.ok(peak(render(dsp,.04).left)<1e-7);
 }
});

test('one effective tempo preserves rhythm and gesture phase when seconds are rebased',()=>{
 for(const {id:rhythm} of HAND_RHYTHMS)for(const form of ['hand','foot']){
  const config=scene(rhythm,form,{motion:{id:'wave',tempo:73,speed:1.7,amount:.6}}),next=structuredClone(config),time=.731;
  assert.equal(setHandEffectiveTempo(next.motion,630),next.motion);assert.equal(handEffectiveTempo(next.motion),630);
  const rebased=time*handMotionPeriod(next.motion)/handMotionPeriod(config.motion);
  assert.ok(Math.abs(time*handEffectiveTempo(config.motion)-rebased*handEffectiveTempo(next.motion))<1e-10);
  assert.ok(difference(poseVector(evaluateHandPose(config,time)),poseVector(evaluateHandPose(next,rebased)))<1e-9);
  for(let finger=0;finger<5;finger++)assert.ok(Math.abs(handRhythmPhase(rhythm,time*handEffectiveTempo(config.motion)/60,finger)-handRhythmPhase(rhythm,rebased*630/60,finger))<1e-12);
 }
 const motion={tempo:72,speed:1};setHandEffectiveTempo(motion,4400);assert.equal(handEffectiveTempo(motion),4400);
 setHandEffectiveTempo(motion,2);assert.equal(handEffectiveTempo(motion),2);
});

test('rhythmic rendering is invariant to arbitrary audio block partitions',()=>{
 for(const {id:rhythm} of HAND_RHYTHMS){
  const config=scene(rhythm,'hand',{motion:{id:'wave',tempo:120,speed:1,amount:.7},sound:{rhythm,noteLength:.4,rootHz:700,attack:.004,release:.04,space:0,rotationFx:.6},voices:Array.from({length:5},()=>({source:'wire',level:.7}))});
  const reference=render(engine(config,8000),7207/8000,128);
  for(const chunk of [1,7,31,257,7207]){
   const actual=render(engine(config,8000),7207/8000,chunk);
   // Global audio sample positions own both control updates and note edges.
   assert.deepEqual(actual,reference,`${rhythm}/${chunk}`);
  }
 }
});

test('the 1600 Hz root is reachable, bounded and finite across engines, rhythms and sample rates',()=>{
 const high=scene('continuous','hand',{sound:{rootHz:1600}}),lower=scene('continuous','hand',{sound:{rootHz:1000}});
 assert.equal(high.sound.rootHz,1600);assert.equal(normalizeHandConfig({sound:{rootHz:9000}}).sound.rootHz,1600);
 const hi=evaluateHandVoices(high,0),lo=evaluateHandVoices(lower,0);for(let i=0;i<5;i++)assert.ok(Math.abs(hi[i].frequency/lo[i].frequency-1.6)<1e-12);
 for(const rate of [8000,24000,48000])for(const source of VOICE_SOURCES){
  const config=scene('three-four','foot',{motion:{id:'frantic-orbit',tempo:1100,speed:4,amount:1},sound:{rootHz:1600,rhythm:'three-four',noteLength:.08,attack:.004,release:.04,space:1},voices:Array.from({length:5},()=>({source,level:1}))});
  const dsp=engine(config,rate),output=new HandOutput(rate),audio=render(dsp,.12,127,output);
  assert.ok(audio.left.every(Number.isFinite)&&audio.right.every(Number.isFinite));assert.ok(peak(audio.left)<=HAND_OUTPUT_CEILING+3e-8&&peak(audio.right)<=HAND_OUTPUT_CEILING+3e-8);
  assert.ok(dsp.targets.every(voice=>Number.isFinite(voice.frequency)&&voice.frequency<=rate*.17));
 }
});
