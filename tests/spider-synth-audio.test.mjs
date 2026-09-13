import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SpiderSynthDsp, SPIDER_SOUND_PRESETS, SPIDER_MOTION_SOUND_PRESETS, SPIDER_BODY_SOURCES, createDefaultSpiderBodyMix, normalizeSpiderBodyMix, normalizeSpiderSound, getSpiderMotionSound } from '../src/spider-synth-dsp.js';
import { SpiderStrings, spiderPluckFrequency } from '../src/spider-synth-string.js';
import { SpiderSynthAudio, createSpiderSpeechPlan } from '../src/spider-synth-audio.js';
import { SPELLING_DIPHONE_ATLAS_URL } from '../src/spelling-diphone-atlas.js';
import { loadSpellingPronunciations } from '../src/spelling-pronunciation.js';
import { SPIDER_JOINTS, SPIDER_MOTION_PRESETS, createSpiderFrame, writeSpiderFrame, spiderStringFrequency } from '../src/spider-synth-model.js';
const mix=(group,source='silk')=>createDefaultSpiderBodyMix().map(row=>({...row,source,level:group==='*'||row.groupId===group?.[0]||row.groupId===group?.[1]||row.groupId===group?.[2]? .7:0}));
const note=(n=68,v=100,extra={})=>({type:'noteOn',note:n,velocity:v,sourceId:'keys',channel:0,...extra});
const off=(n=68,extra={})=>({...note(n,0,extra),type:'noteOff'});
function synth(settings={}){const d=new SpiderSynthDsp(24000);d.update({enabled:true,motion:{preset:'listen',explore:false,intensity:1},...settings});return d;}
function render(d,seconds,time){const l=new Float32Array(Math.round(seconds*d.sampleRate)),r=new Float32Array(l.length);const t=structuredClone(d.render(l,r,time));for(let i=0;i<l.length;i++)assert.ok(Number.isFinite(l[i])&&Number.isFinite(r[i]));return {l,r,...t};}
function energy(a){let sum=0;for(const x of a)sum+=x*x;return Math.sqrt(sum/a.length);}
function toneFrequency(a,rate,expected){let best=-1,freq=0;const start=Math.min(a.length/2,Math.round(rate*.04));const count=Math.min(Math.round(rate*.25),a.length-start);for(let f=expected*.8;f<=expected*1.2;f+=expected*.004){let re=0,im=0;for(let i=0;i<count;i++){const phase=2*Math.PI*f*i/rate;re+=a[start+i]*Math.cos(phase);im+=a[start+i]*Math.sin(phase);}const power=re*re+im*im;if(power>best){best=power;freq=f;}}return freq;}

test('catalogues own eight groups, 24 actual sources and distinct companions for every shared motion',()=>{
 assert.equal(SPIDER_BODY_SOURCES.length,24);assert.equal(SPIDER_SOUND_PRESETS.length,24);assert.equal(SPIDER_MOTION_SOUND_PRESETS.length,SPIDER_MOTION_PRESETS.length);
 assert.deepEqual(SPIDER_MOTION_SOUND_PRESETS.map(p=>p.id),SPIDER_MOTION_PRESETS.map(p=>p.id));
 assert.equal(new Set(SPIDER_MOTION_SOUND_PRESETS.map(p=>JSON.stringify([p.sound,p.bodyMix]))).size,SPIDER_MOTION_PRESETS.length);
 const value=createDefaultSpiderBodyMix();const normalized=normalizeSpiderBodyMix(value);value[0].level=0;assert.notEqual(normalized[0].level,0);
 assert.equal(normalizeSpiderSound({coupling:99}).coupling,.4);assert.equal(normalizeSpiderSound({tension:NaN}).tension,.25);
});

test('Audio arm is silent, Sound Play holds resonance without contact events and stopping releases it',()=>{
 const d=synth();assert.equal(render(d,.3).peak,0);d.update({soundPlaying:true});const held=render(d,.7);
 assert.ok(held.rms>.01);assert.equal(held.contactEvents,0);assert.equal(held.pluckEvents,0);assert.equal(d.time,0);
 d.update({soundPlaying:false});render(d,1);assert.ok(render(d,.1).peak<1e-6);
});

test('all motion-only sources remain silent for unchanged held geometry',()=>{
 for(const source of SPIDER_BODY_SOURCES.filter(s=>s.motionOnly)){const d=synth({bodyMix:mix('*',source.id),soundPlaying:true});const result=render(d,.2);assert.equal(result.peak,0,source.id);assert.equal(result.pluckEvents,0,source.id);}
});

test('real pooled string pitch follows substring length and tension and angle changes excitation',()=>{
 const sound=normalizeSpiderSound({damping:.15,decay:2,brightness:.8,tune:1,pluckRegister:0,pluckSpread:1,slide:0});const levels=new Float64Array(8).fill(1);
 const signals=[];
 for(const f of [220,440]){const strings=new SpiderStrings(24000);assert.ok(strings.pluck(f,.8,0,sound,6,0,0,.5));const out=new Float32Array(24000);for(let i=0;i<out.length;i++){strings.sample(levels,.8);out[i]=strings.left;}const measured=toneFrequency(out,24000,f);assert.ok(Math.abs(measured/f-1)<.03,`${f}->${measured}`);signals.push(out);}
 assert.ok(energy(signals[0])>.01);assert.ok(energy(signals[1])>.01);
 assert.equal(spiderStringFrequency(.1,4,.5)/spiderStringFrequency(.1,1,.5),2);
 assert.equal(spiderStringFrequency(.1,1,.25)/spiderStringFrequency(.1,1,.5),2);
 const outputs=[];for(const angleOffset of [0,Math.PI/2]){const d=synth({bodyMix:mix(['radials','spirals']),sound:{coupling:0}});const segment=d.web.segments.find(s=>s.kind==='radial');d.pluck({segmentId:segment.id,u:.5,velocity:.7,angle:segment.angle+angleOffset});outputs.push(render(d,.3).rms);}
 assert.ok(outputs[1]>outputs[0]*2,outputs.join(','));
});

test('coupling transfers existing loop energy to one adjacent string without a second attack',()=>{
 const d=synth({bodyMix:mix(['radials','spirals']),sound:{coupling:.3}});d.pluck({segmentId:10,u:.4,velocity:.7});assert.equal(d.pluckEvents,1);assert.equal(d.strings.propagationEvents,1);
 const voices=d.strings.voices.filter(v=>v.remaining>0);assert.equal(voices.length,2);const a=d.web.segments[voices[0].segmentId],b=d.web.segments[voices[1].segmentId];assert.ok([a.a,a.b].some(node=>node===b.a||node===b.b));assert.equal(voices[1].burst,0);assert.equal(voices[1].amplitude,0);
 const levels=new Float64Array(8).fill(1);let receiverPeak=0;for(let i=0;i<2400;i++){d.strings.sample(levels,.7);receiverPeak=Math.max(receiverPeak,Math.abs(voices[1].lastL));}
 assert.ok(receiverPeak>.001);assert.equal(d.pluckEvents,1);assert.equal(d.strings.propagationEvents,1);
 const silent=new SpiderStrings(24000),sound=normalizeSpiderSound({coupling:.4});silent.pluck(220,.8,0,sound,6,1);silent.voices[0].burst=0;silent.coupleLast(330,0,sound,7,2,0);for(let n=0;n<1000;n++){silent.sample(levels,.7);assert.equal(silent.left,0);}
});

test('worklet contacts consume exactly the shared foot step ledger without visual updates',()=>{
 const d=synth({playing:true,motion:{preset:'orb-walk',tempo:120,intensity:.7,explore:false}});const expected=createSpiderFrame();const previous=new Float64Array(8);let count=0;
 for(let n=0;n<600;n++){const time=n*.005;writeSpiderFrame(time,d.motion,d.web,expected);if(n)for(let i=0;i<8;i++)if(expected.feet[i].stance&&expected.feet[i].step>previous[i])count++;for(let i=0;i<8;i++)previous[i]=expected.feet[i].step;}
 const result=render(d,3);assert.equal(result.contactEvents,count);assert.ok(count>=16);assert.ok(result.rms>.015);
 d.update({playing:false});const contacts=d.contactEvents;render(d,4);assert.equal(d.contactEvents,contacts);assert.ok(render(d,.2).peak<1e-5);
});

test('equivalent webSettings publications preserve active tails and the graph identity',()=>{
 const a=synth(),b=synth();for(const d of [a,b])d.pluck({segmentId:22,velocity:.8});render(a,.1);render(b,.1);
 const web=b.web;b.update({webSettings:{...b.webSettings},playing:false});assert.equal(b.web,web);
 const left=render(a,.2),right=render(b,.2);assert.deepEqual(left.l,right.l);assert.deepEqual(left.r,right.r);
 b.update({sound:{tension:2},webSettings:{...b.webSettings}});assert.equal(b.sound.tension,2);assert.equal(b.web,web);
 b.update({webSettings:{spokes:20}});assert.notEqual(b.web,web);
});

test('live tune, damping and tension retune real existing delay loops',()=>{
 const d=synth({sound:{coupling:0},bodyMix:mix(['radials'])});const segment=d.web.segments.find(s=>s.kind==='radial');d.pluck({segmentId:segment.id,u:.5,velocity:.7});render(d,.1);
 const voice=d.strings.voices.find(v=>v.remaining>0);const period=voice.period;d.update({sound:{tension:4}});render(d,.4);assert.ok(voice.period<period*.6);
 const previous=voice.loss;d.update({sound:{damping:1}});render(d,.2);assert.ok(voice.loss>previous);
});

test('manual offsets and body translation excite strings while stopped, then become quiet',()=>{
 const d=synth({bodyMix:mix(['legs','radials','spirals'])});render(d,.1);d.update({motion:{offsets:{leg_left_1_hip:{x:.25,y:.2,z:0}}}});assert.ok(render(d,.15).peak>.002);assert.ok(d.strings.voices.some(v=>v.group===0&&v.segmentId===-2));const events=d.pluckEvents;render(d,4);assert.equal(d.pluckEvents,events);assert.ok(render(d,.2).peak<1e-5);
 d.update({motion:{center:{x:.2,z:.1}}});const moved=render(d,.1);assert.ok(moved.pluckEvents>events);assert.equal(d.time,0);
});

test('spinneret sound ownership responds to abdomen movement without invented spinneret joints',()=>{
 const d=synth({bodyMix:mix(['spinnerets'],'fm-bell')});render(d,.05);d.update({motion:{offsets:{abdomen:{x:.4,y:.2,z:.1}}}});assert.ok(render(d,.2).rms>.003);assert.equal(SPIDER_JOINTS.some(j=>j.id==='spinnerets'),false);
});

test('held MIDI notes have stable poses and pitch while both players remain off',()=>{
 const d=synth({bodyMix:mix(['cephalothorax'],'hollow')});d.midi(note(68));render(d,.3);const pose=d.pose.slice();const first=render(d,.3);assert.ok(first.rms>.015);assert.deepEqual(d.pose,pose);assert.equal(d.time,0);assert.equal(d.soundTime,0);
 d.midi({type:'pitchBend',normalized:1,sourceId:'keys',channel:0});render(d,.2);assert.ok(d.midiPerformance.output.frequencies[1]>415*1.1);
 d.midi(off(68));render(d,1);assert.ok(render(d,.1).peak<1e-6);
});

test('eight simultaneous leg notes each pluck their own frame foot without starting animation',()=>{
 const d=synth({sound:{coupling:0}});for(let i=0;i<8;i++)d.midi(note(60+i));render(d,.02);assert.equal(d.midiEvents,8);assert.equal(d.playing,false);assert.equal(d.time,0);
 const events=d.recentEvents.filter(e=>e.id&&e.source==='midi');assert.ok(events.length>=8);assert.ok(new Set(events.map(e=>e.segmentId)).size>=4);
 const count=d.pluckEvents;render(d,5);assert.equal(d.pluckEvents,count);assert.ok(render(d,.2).peak<1e-5);
});

test('MIDI panic releases only its owned strings and preserves unrelated manual resonances',()=>{
 const d=synth({sound:{coupling:0},bodyMix:mix(['legs','radials','spirals'])});d.midi(note(60));render(d,.08);d.pluck({segmentId:30,velocity:.7});
 const manual=d.strings.voices.find(v=>v.remaining>0&&v.midiSourceId===null);assert.ok(manual);d.resetMidi({sourceId:'keys'});assert.equal(manual.release,false);
 assert.ok(d.strings.voices.filter(v=>v.midiSourceId==='keys').every(v=>v.release));
});

test('the caught bug creates a finite audio-clock burst and Audio off cancels remaining attacks',()=>{
 const d=synth();d.pluck({segmentId:30,velocity:.7,source:'prey'});render(d,2);const events=d.pluckEvents;assert.ok(events>5);render(d,4);assert.equal(d.pluckEvents,events);assert.ok(render(d,.2).peak<1e-5);
 d.pluck({segmentId:30,source:'prey'});d.update({enabled:false});const before=d.pluckEvents;render(d,2);assert.equal(d.pluckEvents,before);assert.ok(render(d,.1).peak<1e-6);
});

test('maximum note, string and gain settings remain finite with fixed pools and stereo headroom',()=>{
 const d=synth({playing:true,soundPlaying:true,bodyMix:mix('*','wire'),sound:{level:.8,decay:6,tension:4,coupling:.4,body:1,brightness:1,damping:0}});
 for(let i=0;i<60;i++)d.midi(note(40+i,127));for(let i=0;i<100;i++)d.pluck({segmentId:i,velocity:1});
 const result=render(d,1);assert.equal(d.strings.voices.length,24);assert.equal(d.voices.length,8);assert.equal(d.midiPerformance.voices.length,24);assert.ok(result.peak<=.95);assert.ok(result.peak>.01);assert.equal(d.recentEvents.length,16);
});

function adapter(pending=false){let resolve;const contexts=[],messages=[];const module=pending?new Promise(r=>{resolve=r;}):Promise.resolve();
 class Node{constructor(){this.gain={value:0,cancelScheduledValues(){},setTargetAtTime(v){this.value=v;}};}connect(){}disconnect(){}}
 class Context{constructor(){this.currentTime=0;this.state='suspended';this.destination=new Node();this.audioWorklet={addModule:()=>module};contexts.push(this);}async resume(){this.state='running';}async close(){this.state='closed';}createGain(){return new Node();}}
 class Worklet extends Node{constructor(){super();this.dsp=new SpiderSynthDsp(24000);this.port={close(){},postMessage:m=>{messages.push(m);if(m.type==='state')this.dsp.update(m.state);if(m.type==='midi')this.dsp.midi(m.message,m.audioTime);if(m.type==='midi-state')this.dsp.restoreMidi(m.snapshot);if(m.type==='midi-reset')this.dsp.resetMidi(m.scope,m.audioTime);if(m.type==='pluck')this.dsp.pluck(m.pluck);}};}}
 return{contexts,messages,finish:()=>resolve?.(),runtime:{AudioContext:Context,AudioWorkletNode:Worklet,performance:{now:()=>0}}};}

test('adapter never autoarms, preserves pending held notes, skips released attacks and disposes',async()=>{
 const f=adapter(true),audio=new SpiderSynthAudio({runtime:f.runtime});audio.midi(note());audio.pluck({segmentId:1});assert.equal(f.contexts.length,0);
 const pending=audio.enable({bodyMix:mix(['cephalothorax'],'hollow'),motion:{preset:'listen',explore:false}});f.contexts[0].currentTime=.1;audio.midi(note(60));audio.midi(off(60));f.contexts[0].currentTime=.4;f.finish();await pending;
 const d=audio.node.dsp;assert.ok(render(d,.3,.4).rms>.01);assert.equal(d.midiEvents,0);assert.equal(audio.getState().playing,false);
 audio.disable();assert.equal(audio.getMidiState().heldCount,1);render(d,1);assert.ok(render(d,.1).peak<1e-6);audio.dispose();assert.equal(audio.getMidiState().heldCount,0);
});


test('pointer speed alone is silent and a saturated offset cannot invent a second attack',()=>{
 const d=synth({bodyMix:mix(['legs','radials','spirals'])});render(d,.1);
 d.interact({jointId:'leg_left_1_hip',active:true,velocity:1});assert.equal(render(d,.1).pluckEvents,0);
 d.update({motion:{offsets:{leg_left_1_hip:{x:99,y:0,z:0}}}});const attack=render(d,.1);assert.ok(attack.peak>.002);const events=d.pluckEvents,pose=d.pose.slice();render(d,2);
 d.update({motion:{offsets:{leg_left_1_hip:{x:100,y:0,z:0}}}});d.interact({jointId:'leg_left_1_hip',active:true,velocity:1});const blocked=render(d,.15);assert.equal(d.pluckEvents,events);assert.deepEqual(d.pose,pose);assert.ok(blocked.peak<1e-6);
});


test('every body source audibly responds to a measured manual edit with both players stopped',()=>{
 for(const source of SPIDER_BODY_SOURCES){const d=synth({bodyMix:mix(['cephalothorax'],source.id)});render(d,.05);d.update({motion:{offsets:{cephalothorax:{x:.35,y:.2,z:.15}}}});const result=render(d,.15);assert.ok(result.peak>.002,`${source.id}: ${result.peak}`);assert.equal(d.playing,false);assert.equal(d.soundPlaying,false);}
});

test('real KAL words keep consonants and preset color, independent of body solos and either player',async()=>{
 const bytes=readFileSync(SPELLING_DIPHONE_ATLAS_URL);let atlas;
 for(let cursor=12;cursor+8<bytes.length;){const size=bytes.readUInt32LE(cursor+4);if(bytes.toString('ascii',cursor,cursor+4)==='data'){atlas=Float32Array.from({length:size/2},(_,i)=>bytes.readInt16LE(cursor+8+i*2)/32768);break;}cursor+=8+size+(size%2);}
 assert.ok(atlas.length>100000);const text='hello, I am a spider';
 const pronunciation=await loadSpellingPronunciations(text,{fetcher:async url=>({ok:true,text:()=>readFileSync(url,'utf8')})});
 const phones=createSpiderSpeechPlan(text,pronunciation);assert.ok(phones.length>8&&phones.length<=96);assert.ok(phones.some(p=>p.duration<.1&&!p.silence));
 const signals=[];for(const id of ['orb-silk','thread-bass']){const patch=SPIDER_SOUND_PRESETS.find(p=>p.id===id),d=synth({sound:patch.sound,bodyMix:mix([])});d.setAtlas(atlas,16000);assert.equal(d.speak(phones),true);const result=render(d,3);assert.ok(result.rms>.02);assert.ok(result.peak<.95);assert.equal(d.contactEvents,0);assert.equal(d.time,0);assert.equal(d.soundTime,0);signals.push(result.l);d.update({sound:{voice:0}});d.speak(phones);render(d,.5);assert.ok(render(d,.2).peak<1e-5);d.stopSpeech();render(d,.1);d.update({sound:{voice:.65}});assert.ok(render(d,.2).peak<1e-5);}
 assert.notDeepEqual(signals[0],signals[1]);assert.ok(createSpiderSpeechPlan('spider '.repeat(200)).length<=96);
});

test('MIDI velocity, sustain, expression and row zero retain ownership and deterministic releases',()=>{
 const values=[];for(const velocity of [32,112]){const d=synth({bodyMix:mix(['cephalothorax'],'hollow')});d.midi(note(68,velocity));render(d,.2);values.push(render(d,.2).rms);}
 assert.ok(values[1]>values[0]*1.8,values.join(','));
 const d=synth({bodyMix:mix(['cephalothorax'],'hollow')});d.midi(note());d.midi({type:'controlChange',controller:64,value:127,sourceId:'keys',channel:0});d.midi(off());assert.ok(render(d,.3).rms>.01);
 d.midi({type:'controlChange',controller:11,value:0,sourceId:'keys',channel:0});render(d,1);assert.ok(render(d,.1).peak<1e-5);assert.equal(d.midiPerformance.output.notes[1],68);
 d.midi({type:'controlChange',controller:11,value:127,sourceId:'keys',channel:0});d.update({bodyMix:mix([],'hollow')});render(d,.5);assert.ok(render(d,.1).peak<1e-5);
 d.midi({type:'controlChange',controller:64,value:0,sourceId:'keys',channel:0});render(d,.8);assert.equal(d.midiPerformance.output.notes[1],-1);
});

test('cancelled lazy Audio build cannot arm later or replay a note released during loading',async()=>{
 const f=adapter(true),audio=new SpiderSynthAudio({runtime:f.runtime});const pending=audio.enable();audio.midi(note(60));audio.midi(off(60));audio.disable();f.finish();await assert.rejects(pending,{name:'AbortError'});assert.equal(audio.enabled,false);assert.equal(audio.getMidiState().heldCount,0);assert.equal(render(audio.node.dsp,.2).peak,0);audio.dispose();
});

test('held notes plus maximum CC keep the worklet stance anchors fixed through angle saturation',()=>{
 const d=synth({playing:true,motion:{preset:'cross-pluck',intensity:1,explore:false}});
 for(let n=60;n<84;n++)d.midi(note(n,127));d.midi({type:'channelPressure',pressure:127,sourceId:'keys',channel:0});
 for(const axis of ['x','y','z'])d.midiControl('legs',axis,1);render(d,.3);
 const previous=d.frame.feet.map(f=>({...f}));let compared=0,max=0;const l=new Float32Array(120),r=new Float32Array(120);
 for(let n=0;n<400;n++){d.render(l,r);for(let i=0;i<8;i++){const a=previous[i],b=d.frame.feet[i];if(a.stance&&b.stance&&a.step===b.step){max=Math.max(max,Math.hypot(a.x-b.x,a.z-b.z));compared++;}Object.assign(a,b);}}
 assert.ok(compared>1000);assert.equal(max,0);assert.equal(d.midiPerformance.poseOffsets.length,114);assert.ok(d.contactEvents>0);
});

test('all five string materials have distinct excitation or loop loss, including the thumb tine',()=>{
 const sound=normalizeSpiderSound({damping:.2,decay:2}),levels=new Float64Array(8).fill(1),signals=[];
 for(let material=0;material<5;material++){const strings=new SpiderStrings(24000);strings.pluck(220,.8,0,sound,6,0,material,.5);const wave=new Float32Array(12000);for(let i=0;i<wave.length;i++){strings.sample(levels,.65);wave[i]=strings.left;}signals.push(wave);assert.ok(energy(wave)>.003);}
 for(let a=0;a<5;a++)for(let b=a+1;b<5;b++)assert.notDeepEqual(signals[a],signals[b],`${a} and ${b}`);
 assert.ok(energy(signals[4].subarray(6000))<energy(signals[0].subarray(6000))*.8);
});

test('CC11 controls owned ringing strings without creating a new neutral-return pluck',()=>{
 const d=synth({sound:{coupling:0,decay:4},bodyMix:mix(['radials','spirals'])});d.midi(note(60));render(d,.2);const events=d.pluckEvents;assert.ok(d.strings.voices.some(v=>v.midiSourceId==='keys'&&v.remaining>0));
 d.midi({type:'controlChange',controller:11,value:0,sourceId:'keys',channel:0});render(d,.5);assert.equal(d.pluckEvents,events);assert.ok(d.strings.voices.filter(v=>v.remaining>0&&v.midiSourceId==='keys').every(v=>v.expression<1e-6));assert.ok(render(d,.1).peak<1e-5);
 d.pluck({segmentId:30,velocity:.7});assert.ok(render(d,.2).rms>.01);assert.ok(d.strings.voices.some(v=>v.remaining>0&&v.midiSourceId===null&&v.expression===1));
});

test('metronome telemetry is sample-clock aligned and resume cannot add an off-beat click',()=>{
 const d=synth({playing:true,metronome:true,bodyMix:mix([]),motion:{tempo:120,preset:'listen',explore:false}});const first=render(d,.3);assert.equal(first.metronomeEvents,1);assert.equal(first.lastMetronomeTime,0);d.update({playing:false});render(d,.2);d.update({playing:true});assert.equal(render(d,.1).metronomeEvents,1);const next=render(d,.2);assert.equal(next.metronomeEvents,2);assert.ok(Math.abs(next.lastMetronomeTime-.5)<=1/d.sampleRate);d.update({enabled:false});assert.equal(render(d,1).metronomeEvents,2);
});

test('all six texture/world controls are normalized and every companion has immutable real geometry',()=>{
 const keys=['texture','slide','flutter','space','silkLevel','preyLevel'];for(const key of keys){assert.equal(normalizeSpiderSound({[key]:2})[key],1);assert.equal(normalizeSpiderSound({[key]:-1})[key],0);}
 for(const patch of SPIDER_SOUND_PRESETS){assert.ok(Object.isFrozen(patch.webSettings));assert.ok(patch.webSettings.spokes>=8&&patch.webSettings.rings>=3);}
 assert.ok(new Set(SPIDER_SOUND_PRESETS.map(p=>p.webSettings.preset)).size>=8);
 const preset=getSpiderMotionSound('silk-reel');const before=getSpiderMotionSound('silk-reel').webSettings.spokes;preset.webSettings.spokes=999;assert.equal(getSpiderMotionSound('silk-reel').webSettings.spokes,before);
});

test('living default resonance varies with texture while still, without manufactured impacts',()=>{
 const signals=[];for(const texture of [0,1]){const d=synth({soundPlaying:true,sound:{texture}});render(d,.3);const signal=render(d,2);assert.ok(signal.rms>.015);assert.equal(signal.pluckEvents,0);assert.equal(signal.contactEvents,0);signals.push(signal.l);}
 assert.notDeepEqual(signals[0],signals[1]);
 const d=synth({soundPlaying:true});render(d,.3);const chunks=[];for(let n=0;n<12;n++)chunks.push(render(d,.15).rms);assert.ok(Math.max(...chunks)/Math.min(...chunks)>1.1);
});

test('glide changes real delay-line settling and courtship/space controls change measured bursts',()=>{
 for(const slide of [0,1]){const strings=new SpiderStrings(24000),sound=normalizeSpiderSound({slide});strings.pluck(220,.8,0,sound,6,0,0,.5);const voice=strings.voices.find(v=>v.remaining>0);const initial=Math.abs(voice.period-voice.targetPeriod);const levels=new Float64Array(8).fill(1);for(let i=0;i<2400;i++)strings.sample(levels,.65);assert.ok(slide?Math.abs(voice.period-voice.targetPeriod)>initial*.25:Math.abs(voice.period-voice.targetPeriod)<.001);}
 for(const key of ['flutter','space']){const outputs=[];for(const value of [0,1]){const d=synth({bodyMix:mix(['cephalothorax'],'palp-roll'),sound:{[key]:value}});render(d,.05);d.update({motion:{offsets:{cephalothorax:{x:.4,y:.3,z:0}}}});outputs.push(render(d,.5).l);}assert.notDeepEqual(outputs[0],outputs[1],key);}
});

test('joystick travel and silk extrusion have independent clocks and settle without either Play transport',()=>{
 const d=synth({bodyMix:mix([])});render(d,.05);assert.equal(d.pluckEvents,0);
 d.update({worldSettings:{joystick:{x:.8,z:.2},speed:1,laySilk:true}});const moving=render(d,1.5);assert.ok(moving.rms>.005);assert.ok(d.world.silkSegments.length>5);assert.ok(d.contactEvents>0);assert.equal(d.time,0);assert.equal(d.soundTime,0);assert.equal(d.playing,false);
 d.update({worldSettings:{joystick:{x:0,z:0}}});render(d,2);const contacts=d.contactEvents,plucks=d.pluckEvents;assert.ok(render(d,.2).peak<1e-6);assert.equal(d.contactEvents,contacts);assert.equal(d.pluckEvents,plucks);
 const muted=synth({bodyMix:mix([]),sound:{silkLevel:0},worldSettings:{joystick:{x:1,z:0},speed:1,laySilk:true}});assert.equal(render(muted,1).peak,0);assert.ok(muted.world.silkSegments.length>0);
});

test('world snapshots retain clock ownership and do not replay already consumed prey events',()=>{
 const a=synth({worldSettings:{hunt:true,speed:2}});a.worldCommand({type:'send-prey'});render(a,1.5);const snapshot=a.getWorldSnapshot();
 const b=synth();assert.equal(b.restoreWorld(snapshot,10),true);assert.equal(b.world.clock,snapshot.clock+10);const before=b.pluckEvents;render(b,.01,snapshot.clock+10);assert.equal(b.pluckEvents,before);
 render(b,8);const plucks=b.pluckEvents;assert.ok(b.world.prey.every(p=>p.state==='eaten'));assert.ok(render(b,.2).peak<1e-6);assert.equal(b.pluckEvents,plucks);assert.equal(b.playing,false);
});

test('laid silk plucks use strand length and retain silk identity; topology replacement preserves player state',()=>{
 const d=synth({soundPlaying:true});d.update({worldSettings:{joystick:{x:1,z:0},laySilk:true,speed:1}});render(d,.8);d.update({worldSettings:{joystick:{x:0,z:0}}});render(d,.2);
 const strand=d.world.silkSegments[0];assert.ok(strand);d.worldCommand({type:'pluck-silk',silkId:strand.id,u:.35,velocity:.8,angle:strand.angle+Math.PI/2});render(d,.01);const event=d.recentEvents.find(e=>e.source==='silk');assert.equal(event.silkId,strand.id);assert.equal(event.segmentId,-1);assert.equal(event.u,.35);
 const voice=d.strings.voices.find(v=>v.remaining>0&&v.segmentId===-1);assert.ok(voice);assert.ok(Math.abs(voice.targetPeriod-(d.sampleRate/spiderPluckFrequency(spiderStringFrequency(strand.length,d.smooth.tension,.35)*d.smooth.tune,d.smooth,d.sampleRate)-.5))<2);
 const old=d.web;d.update({webSettings:{preset:'sheet',depth:.1},playing:true});assert.notEqual(d.web,old);assert.equal(d.playing,true);assert.equal(d.soundPlaying,true);render(d,.01);assert.equal(d.world.silkSegments.length,0);assert.ok(d.recentEvents.every(e=>e.id===0||e.graphVersion===d.world.state.graphVersion));
});

test('adapter rebases exposed world snapshots and adopts the latest world after lazy enable',async()=>{
 const f=adapter(true),source=synth();source.update({worldSettings:{joystick:{x:.7,z:0},speed:1}});render(source,.5);let calls=0;
 const audio=new SpiderSynthAudio({runtime:f.runtime,getWorldSnapshot:()=>{calls++;return source.getWorldSnapshot();}});const pending=audio.enable();render(source,.5);f.contexts[0].currentTime=4;f.finish();await pending;
 assert.equal(calls,1);assert.equal(audio.getState().world.clock,4);const message=f.messages.find(m=>m.type==='world-state');assert.equal(message.snapshot.clock,source.world.clock);assert.equal(message.timeOffset,4-source.world.clock);
 const contexts=f.contexts.length;audio.worldCommand({type:'pluck-silk',silkId:9,u:.3,velocity:.8});const command=f.messages.at(-1).command;assert.equal(command.silkId,9);assert.equal(command.u,.3);assert.equal(f.contexts.length,contexts);audio.dispose();
});


test('a trapped prey settles after its finite shared struggle window without an idle audio loop',()=>{
 const d=synth();d.worldCommand({type:'send-prey'});render(d,11);const events=d.pluckEvents,serial=d.world.nextEventId;render(d,3);assert.equal(d.pluckEvents,events);assert.equal(d.world.nextEventId,serial);assert.equal(d.world.state.preyStruggle,0);assert.ok(render(d,.2).peak<1e-6);assert.equal(d.world.prey[0].state,'trapped');
});


test('adapter telemetry preserves deposited-strand identity and graph generation',async()=>{
 const f=adapter(),audio=new SpiderSynthAudio({runtime:f.runtime});await audio.enable();
 audio.node.port.onmessage({data:{type:'telemetry',recentEvents:[{id:1,segmentId:5,silkId:null,graphVersion:3,source:'contact'},{id:2,segmentId:-1,silkId:19,graphVersion:3,source:'silk'}]}});
 const events=audio.getState().recentEvents;assert.equal(events[0].silkId,null);assert.equal(events[0].segmentId,5);assert.equal(events[1].silkId,19);assert.equal(events[1].graphVersion,3);audio.dispose();
});


test('world gain zero silences its already ringing string without silencing unrelated manual strings',()=>{
 const d=synth({sound:{decay:6,coupling:0,space:0},bodyMix:mix(['radials','spirals'])});d.pluck({segmentId:20,velocity:.8,source:'prey'});render(d,.1);assert.ok(d.strings.voices.some(v=>v.remaining>0&&v.worldKind===2));d.update({sound:{preyLevel:0}});render(d,.8);assert.ok(render(d,.1).peak<1e-6);d.pluck({segmentId:23,velocity:.8});assert.ok(render(d,.15).rms>.005);
});


test('procedural root-body turns excite their body owners and release when animation stops',()=>{
 const d=synth({playing:true,motion:{preset:'rollover',intensity:1},bodyMix:mix(['cephalothorax'],'membrane')});const moving=render(d,2);assert.ok(moving.rms>.015);d.update({playing:false});render(d,1);assert.ok(render(d,.2).peak<1e-6);assert.equal(d.soundPlaying,false);
});


test('root-turn timbre is periodic and crossing an angle wrap cannot invent a large movement',()=>{
 const d=synth({bodyMix:mix(['cephalothorax'],'palp-roll')});let yaw=0;const sample=d.world.sample.bind(d.world);d.world.sample=(...args)=>{const state=sample(...args);args[3].body.yaw+=yaw;return state;};d.control();const pose=d.groupPose.slice();yaw=Math.PI*2;d.control();for(let i=0;i<pose.length;i++)assert.ok(Math.abs(d.groupPose[i]-pose[i])<1e-6);assert.ok(d.groupDistance[1]<1e-6);assert.equal(d.pluckEvents,0);yaw=Math.PI-.01;d.control();yaw=Math.PI+.01;d.control();assert.ok(d.groupDistance[1]<.02);
});


test('authored string registers retain physical length ordering and separate actual pitch and onset',()=>{
 assert.equal(new Set(SPIDER_SOUND_PRESETS.map(p=>JSON.stringify([p.sound.pluckRegister,p.sound.pluckSpread,p.sound.pluckAttack,p.sound.pluckHold,p.sound.pluckRelease]))).size,24);
 const levels=new Float64Array(8).fill(1);const results=[];
 for(const id of ['thread-bass','tiny-bells','velvet-listener']){
  const sound={...SPIDER_SOUND_PRESETS.find(p=>p.id===id).sound,slide:0};
  assert.ok(spiderPluckFrequency(300,sound)>spiderPluckFrequency(150,sound));
  const strings=new SpiderStrings(24000);strings.pluck(220,.8,0,sound,6,0);const wave=new Float32Array(24000),bins=new Float64Array(100);
  for(let i=0;i<wave.length;i++){strings.sample(levels,sound.brightness);wave[i]=strings.left;bins[Math.floor(i/240)]+=wave[i]*wave[i];}
  const peak=Math.max(...bins);results.push({frequency:strings.voices[0].frequency,half:bins.findIndex(v=>v>=peak*.25)*.01,rms:energy(wave)});assert.ok(energy(wave)>.003,id);
 }
 assert.ok(results[1].frequency>results[0].frequency*8);assert.ok(results[2].half>results[1].half+.12);
 for(const key of ['pluckRegister','pluckSpread','pluckAttack','pluckHold','pluckRelease'])assert.ok(Number.isFinite(normalizeSpiderSound({[key]:NaN})[key]));
});

test('a slow bloom survives maximum damping and minimum physical decay, then fully releases',()=>{
 const strings=new SpiderStrings(24000),sound=normalizeSpiderSound({pluckAttack:.35,pluckHold:.2,pluckRelease:.4,decay:.08,damping:1,slide:0}),levels=new Float64Array(8).fill(1),wave=new Float32Array(30000);
 strings.pluck(220,.8,0,sound,6,0);for(let n=0;n<wave.length;n++){strings.sample(levels,.6);wave[n]=strings.left;}
 assert.ok(energy(wave.subarray(7200,12000))>.003);assert.ok(energy(wave.subarray(0,240))<energy(wave.subarray(7200,12000))*.05);assert.equal(energy(wave.subarray(24000)),0);
});

test('physical foot replacements preserve the fixed pool and accept new owned pitches under long tails',()=>{
 const strings=new SpiderStrings(24000),sound=normalizeSpiderSound({pluckAttack:.2,pluckHold:.6,pluckRelease:4,decay:6}),levels=new Float64Array(8).fill(1);
 for(let n=0;n<100;n++){assert.equal(strings.pluck(110+n*10,.8,0,sound,6,n,0,.5,null,1,false,0,n%8),true);for(let k=0;k<120;k++)strings.sample(levels,.7);}
 assert.equal(strings.voices.length,24);assert.ok(strings.voiceReplacements>=80);assert.equal(strings.voices[strings.lastVoiceIndex].frequency,spiderPluckFrequency(1100,sound));assert.ok(strings.active<=24);
});

test('the realtime DSP accepts prepared graphs and rejects unprepared or mismatched replacement atomically',async()=>{
 const {createSpiderWeb,serializeSpiderWeb}=await import('../src/spider-synth-web.js');
 const d=new SpiderSynthDsp(24000,{requirePreparedWeb:true});const previous=d.web;
 assert.throws(()=>d.update({webSettings:{preset:'sheet'}}),/prepared web/i);assert.equal(d.web,previous);
 const prepared=serializeSpiderWeb(createSpiderWeb({preset:'sheet',anchors:9,spacing:.7}));
 d.update({webSettings:prepared,preparedWeb:prepared});assert.equal(d.web.preset,'sheet');const web=d.web;
 d.update({sound:{tension:2},webSettings:{...prepared,tension:2},preparedWeb:{invalid:true}});assert.equal(d.web,web);assert.equal(d.sound.tension,2);assert.equal(d.web.tension,2);
 assert.throws(()=>d.update({webSettings:{preset:'triangle'},preparedWeb:prepared}),/does not match/);assert.equal(d.web,web);
 const broken=structuredClone(prepared);broken.anchors=8;broken.segments[0].a=999999;
 assert.throws(()=>d.update({webSettings:broken,preparedWeb:broken}),/Invalid prepared/);assert.equal(d.web,web);
});

test('adapter prepares graph changes on the main thread once and retains them across sound changes',()=>{
 const f=adapter(),audio=new SpiderSynthAudio({runtime:f.runtime});audio.update({webSettings:{preset:'sheet',anchors:9,spacing:.7}});
 const graph=audio.state.preparedWeb;assert.ok(graph.nodes.length>20);assert.equal(graph.constructionVersion,3);
 audio.update({sound:{pluckRegister:24,pluckAttack:.2}});assert.equal(audio.state.preparedWeb,graph);
 audio.update({webSettings:{...audio.state.webSettings,tension:2}});assert.equal(audio.state.preparedWeb,graph);
 audio.update({webSettings:{spacing:.2}});assert.notEqual(audio.state.preparedWeb,graph);assert.equal(f.contexts.length,0);audio.dispose();
});

test('forecast contact/pull/release onsets use their exact sample clock, without beat quantization',()=>{
 const d=synth({playing:true,sound:{coupling:0}}),sample=d.world.sample.bind(d.world);
 const events=[.00371,.00791,.00813].map((time,i)=>({serial:i+1,epoch:7,time,legIndex:2,kind:['contact','pull','release'][i],segmentId:10,u:.37,impulse:.4,force:.4,speed:.2,angle:1.3}));
 d.world.sample=(...args)=>{const state=sample(...args);d.frame.contactEpoch=7;state.footEvents=events;state.nextFootEventTime=Infinity;return state;};
 render(d,.02);assert.equal(d.contactEvents,1);assert.equal(d.pullEvents,1);assert.equal(d.footReleaseEvents,1);assert.equal(d.pluckEvents,3);
 for(const expected of events){const actual=d.recentEvents.find(e=>e.footSerial===expected.serial);assert.ok(actual);assert.equal(actual.segmentId,expected.segmentId);assert.equal(actual.u,expected.u);assert.equal(actual.sourceTime,expected.time);assert.equal(actual.kind,expected.kind);assert.equal(actual.legIndex,2);assert.ok(Math.abs(actual.audioTime-expected.time)<=.51/d.sampleRate);assert.ok(actual.frequency>0);}
 assert.equal(d.droppedFootEvents,0);assert.equal(d.lateFootEvents,0);render(d,.2);assert.equal(d.pluckEvents,3);
});

test('pause, epoch invalidation and late clock adoption cannot replay queued physical attacks',()=>{
 const d=synth({playing:true,sound:{coupling:0}}),sample=d.world.sample.bind(d.world);let epoch=2;
 const events=[{serial:1,epoch:2,time:.04,legIndex:0,kind:'contact',segmentId:10,u:.4,impulse:.8,force:.8,speed:.3,angle:1}];
 d.world.sample=(...args)=>{const state=sample(...args);d.frame.contactEpoch=epoch;state.footEvents=events;state.nextFootEventTime=Infinity;return state;};
 render(d,.01);d.update({playing:false});render(d,.1);assert.equal(d.contactEvents,0);
 epoch=3;events.push({...events[0],serial:2,epoch:3,time:.2});d.update({playing:true});render(d,.01);render(d,.1,10);assert.equal(d.contactEvents,0);assert.ok(d.droppedFootEvents>=1);
 const count=d.pluckEvents;render(d,1);assert.equal(d.pluckEvents,count);
});

test('a live string keeps its attack/hold/release contour when another preset is selected',()=>{
 const strings=new SpiderStrings(24000),sound=normalizeSpiderSound({pluckAttack:.2,pluckHold:.3,pluckRelease:2}),levels=new Float64Array(8).fill(1);
 strings.pluck(220,.8,0,sound,6,0);const v=strings.voices[0],contour=[v.attackFrames,v.holdFrames,v.releaseFrames];
 for(let i=0;i<1200;i++)strings.sample(levels,.7);strings.retune(normalizeSpiderSound({pluckAttack:.001,pluckHold:0,pluckRelease:.04,pluckRegister:24}));
 assert.deepEqual([v.attackFrames,v.holdFrames,v.releaseFrames],contour);assert.ok(v.targetPeriod<v.period);assert.equal(v.release,false);
});

test('string register and envelope controls do not retune an independent held body oscillator',()=>{
 const a=synth({soundPlaying:true,bodyMix:mix(['cephalothorax'],'hollow')}),b=synth({soundPlaying:true,bodyMix:mix(['cephalothorax'],'hollow')});render(a,.1);render(b,.1);
 b.update({sound:{pluckRegister:36,pluckSpread:1.8,pluckAttack:.35,pluckHold:.6,pluckRelease:4}});
 assert.deepEqual(render(a,.2).l,render(b,.2).l);assert.equal(a.pluckEvents,0);assert.equal(b.pluckEvents,0);
});

test('fast dense-web contacts remain audible with soft contours, no dropped attacks and fixed resources',()=>{
 const d=synth({playing:true,motion:{preset:'low-sprint',tempo:300,intensity:1},worldSettings:{path:'orbit',speed:2,range:.58},webSettings:{preset:'sheet',spokes:24,rings:16,anchors:12,spacing:1},bodyMix:mix(['radials','spirals'],'glass'),sound:{pluckAttack:.35,pluckHold:.6,pluckRelease:4,decay:6,coupling:.4}});
 const result=render(d,1.2);assert.ok(result.contactEvents>80);assert.ok(result.pullEvents>80);assert.equal(result.lateFootEvents,0);assert.equal(result.droppedFootEvents,0);assert.equal(result.droppedStringEvents,0);assert.ok(result.voiceReplacements>0);assert.ok(result.shortenedAttacks>0);assert.ok(result.rms>.015);assert.ok(result.peak<.95);assert.equal(d.strings.voices.length,24);
 const ids=new Set();for(const event of d.recentEvents){if(!event.id)continue;assert.ok(event.footSerial>0);assert.ok(!ids.has(event.footSerial));ids.add(event.footSerial);assert.ok(Math.abs(event.audioTime-event.sourceTime)<=.51/d.sampleRate);assert.ok(['contact','pull','release'].includes(event.kind));}
 d.update({playing:false,worldSettings:{path:'hold',joystick:{x:0,z:0}}});const contacts=d.contactEvents,plucks=d.pluckEvents;render(d,6);assert.equal(d.contactEvents,contacts);assert.equal(d.pluckEvents,plucks);assert.ok(render(d,.1).peak<1e-6);
});

test('MIDI panic cannot turn its neutral-pose restoration into a new world pull attack',()=>{
 for(const mode of ['reset','cc120']){
  const d=synth({sound:{coupling:0}});d.midi(note(60,120));render(d,.5);const count=d.pluckEvents;
  if(mode==='reset')d.resetMidi({sourceId:'keys'});else d.midi({type:'controlChange',controller:120,value:0,sourceId:'keys',channel:0});
  render(d,.5);assert.equal(d.pluckEvents,count,mode);assert.ok(render(d,.2).peak<1e-6,mode);
 }
});

test('continuous held-note CC ramps cannot cancel the gait contacts at their forecast boundary',()=>{
 const d=new SpiderSynthDsp(48000);d.update({enabled:true,playing:true,motion:{preset:'low-sprint',tempo:300,intensity:1},worldSettings:{path:'orbit',speed:2,range:.58}});
 for(let n=60;n<84;n++)d.midi(note(n,127,{channel:n%2}));const l=new Float32Array(128),r=new Float32Array(128),steps=new Float64Array(8);let observed=0;
 for(let i=0;i<400;i++){
  if(i%8===0)for(const group of ['legs','cephalothorax','abdomen','pedipalps','chelicerae','spinnerets','radials','spirals'])for(const axis of ['x','y','z'])d.midiControl(group,axis,Math.sin(i*.006),d.audioTime);
  d.render(l,r);for(let j=0;j<8;j++){const f=d.frame.feet[j];if(f.step>steps[j])observed+=f.step-steps[j];steps[j]=f.step;}
 }
 assert.ok(observed>=100);assert.equal(d.contactEvents,observed);assert.ok(d.pullEvents>=observed*.95,'Planned stance pulls survive MIDI envelope deduplication');assert.ok(d.footReleaseEvents>=observed*.95);assert.ok(d.footReleaseEvents<=observed+8);assert.equal(d.lateFootEvents,0);assert.equal(d.droppedFootEvents,0);assert.ok(d.maxFootLateness<=.51/d.sampleRate);
});

test('direct pointer and CC-only pulls retain ownership while held-key envelope pulls are deduplicated',()=>{
 const d=synth({sound:{coupling:0}});render(d,.05);d.midi(note(60,120));render(d,.1);assert.equal(d.midiEvents,1);assert.equal(d.pluckEvents,1);assert.equal(d.recentEvents.find(e=>e.id).source,'midi');
 const before=d.pluckEvents;d.update({motion:{center:{x:.15,z:.1}}});render(d,.02);assert.ok(d.pluckEvents>before);assert.ok(d.recentEvents.some(e=>e.id>before&&e.kind==='pull'&&e.manual));
 d.resetMidi();render(d,3);const events=d.pluckEvents;d.midiControl('legs','y',.5);render(d,.15);assert.ok(d.pluckEvents>events);assert.ok(d.recentEvents.some(e=>e.id>events&&e.manual));
 const settled=d.pluckEvents;render(d,3);assert.equal(d.pluckEvents,settled);assert.ok(render(d,.1).peak<1e-6);
});

test('tempo changes preserve future force kinds and pause cancels them without catch-up attacks',()=>{
 const d=new SpiderSynthDsp(48000);d.update({enabled:true,playing:true,motion:{preset:'low-sprint',tempo:300,intensity:1},worldSettings:{path:'orbit',speed:2,range:.58}});render(d,.73);
 const old=[d.contactEvents,d.pullEvents,d.footReleaseEvents];d.update({motion:{tempo:113},time:d.time*300/113});render(d,1);
 for(const [n,value] of [d.contactEvents,d.pullEvents,d.footReleaseEvents].entries()){assert.ok(value-old[n]>=25);assert.ok(value-old[n]<=48);}
 assert.equal(d.lateFootEvents,0);assert.equal(d.droppedFootEvents,0);assert.ok(d.maxFootLateness<=.51/d.sampleRate);
 const stopped=[d.contactEvents,d.pullEvents,d.footReleaseEvents];d.update({playing:false});render(d,.23);assert.deepEqual([d.contactEvents,d.pullEvents,d.footReleaseEvents],stopped);
 d.update({playing:true});render(d,.3);assert.ok(d.contactEvents-stopped[0]<=16);assert.equal(d.lateFootEvents,0);assert.equal(d.droppedFootEvents,0);
});
