import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SpiderSynthDsp, SPIDER_SOUND_PRESETS, SPIDER_MOTION_SOUND_PRESETS, SPIDER_BODY_SOURCES, createDefaultSpiderBodyMix, normalizeSpiderBodyMix, normalizeSpiderSound, getSpiderMotionSound } from '../src/spider-synth-dsp.js';
import { SpiderStrings } from '../src/spider-synth-string.js';
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

test('catalogues own eight groups, sixteen actual sources and distinct companions for all24 motions',()=>{
 assert.equal(SPIDER_BODY_SOURCES.length,16);assert.equal(SPIDER_SOUND_PRESETS.length,16);assert.equal(SPIDER_MOTION_SOUND_PRESETS.length,24);
 assert.deepEqual(SPIDER_MOTION_SOUND_PRESETS.map(p=>p.id),SPIDER_MOTION_PRESETS.map(p=>p.id));
 assert.equal(new Set(SPIDER_MOTION_SOUND_PRESETS.map(p=>JSON.stringify([p.sound,p.bodyMix]))).size,24);
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
 const sound=normalizeSpiderSound({damping:.15,decay:2,brightness:.8,tune:1});const levels=new Float64Array(8).fill(1);
 const signals=[];
 for(const f of [220,440]){const strings=new SpiderStrings(24000);assert.ok(strings.pluck(f,.8,0,sound,6,0,0,.5));const out=new Float32Array(24000);for(let i=0;i<out.length;i++){strings.sample(levels,.8);out[i]=strings.left;}const measured=toneFrequency(out,24000,f);assert.ok(Math.abs(measured/f-1)<.03,`${f}->${measured}`);signals.push(out);}
 assert.ok(energy(signals[0])>.01);assert.ok(energy(signals[1])>.01);
 assert.equal(spiderStringFrequency(.1,4,.5)/spiderStringFrequency(.1,1,.5),2);
 assert.equal(spiderStringFrequency(.1,1,.25)/spiderStringFrequency(.1,1,.5),2);
 const outputs=[];for(const angleOffset of [0,Math.PI/2]){const d=synth({bodyMix:mix(['radials','spirals']),sound:{coupling:0}});const segment=d.web.segments.find(s=>s.kind==='radial');d.pluck({segmentId:segment.id,u:.5,velocity:.7,angle:segment.angle+angleOffset});outputs.push(render(d,.3).rms);}
 assert.ok(outputs[1]>outputs[0]*2,outputs.join(','));
});

test('coupling only excites an adjacent strand and has a fixed one-generation budget',()=>{
 const d=synth({bodyMix:mix(['radials','spirals']),sound:{coupling:.3}});d.pluck({segmentId:10,u:.4,velocity:.7});assert.equal(d.pluckEvents,2);
 const events=d.recentEvents.filter(e=>e.id>0);const a=d.web.segments[events[0].segmentId],b=d.web.segments[events[1].segmentId];assert.ok([a.a,a.b].some(node=>node===b.a||node===b.b));assert.equal(events[1].source,'coupling');
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
 const d=synth({bodyMix:mix(['legs','radials','spirals'])});render(d,.1);d.update({motion:{offsets:{leg_left_1_hip:{x:.25,y:.2,z:0}}}});assert.ok(render(d,.15).pluckEvents>0);const events=d.pluckEvents;render(d,4);assert.equal(d.pluckEvents,events);assert.ok(render(d,.2).peak<1e-5);
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
 d.update({motion:{offsets:{leg_left_1_hip:{x:99,y:0,z:0}}}});render(d,.1);const events=d.pluckEvents;assert.ok(events>0);
 d.update({motion:{offsets:{leg_left_1_hip:{x:100,y:0,z:0}}}});d.interact({jointId:'leg_left_1_hip',active:true,velocity:1});render(d,.15);assert.equal(d.pluckEvents,events);
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
