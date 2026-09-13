import { SPIDER_BODY_GROUPS, getSpiderJointBodyGroup, getSpiderBodyGroupId } from './spider-synth-body.js';
import { SPIDER_JOINTS, SPIDER_MOTION_PRESETS, normalizeSpiderMotion, createSpiderWeb, createSpiderFrame, writeSpiderPose, writeSpiderFrame, spiderStringFrequency } from './spider-synth-model.js';
import { normalizeSpiderWeb, SPIDER_WEB_PRESETS } from './spider-synth-web.js';
import { SpiderSynthWorld, normalizeSpiderWorld } from './spider-synth-world.js';
import { SpiderMidiPerformance } from './spider-synth-midi.js';
import { SpiderStrings, SpiderOutputGuard } from './spider-synth-string.js';
import { SpiderSurfaceVoice, SpiderSpace, SpiderWorldSound } from './spider-synth-textures.js';
export { SPIDER_BODY_GROUPS, getSpiderBodyGroupId } from './spider-synth-body.js';
const TAU = Math.PI * 2, MAX_PHONES = 96, EMPTY_PHONES = Object.freeze([]);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, finite(value, low)));
export const SPIDER_SOUND_DEFAULTS = Object.freeze({ level: .5, tension: 1, damping: .35, coupling: .12, brightness: .65, decay: 1.8, tune: 1, body: .6, voice: .65, pan: 0, texture:.45, slide:.25, flutter:.3, space:.25, silkLevel:.55, preyLevel:.5 });
const RANGES = { level: [0,.8], tension: [.25,4], damping: [0,1], coupling: [0,.4], brightness: [0,1], decay: [.08,6], tune: [.5,2], body: [0,1], voice: [0,1], pan: [-1,1], texture:[0,1], slide:[0,1], flutter:[0,1], space:[0,1], silkLevel:[0,1], preyLevel:[0,1] };
const SOUND_KEYS = Object.keys(RANGES);
const WEB_KEYS=['preset','spokes','rings','seed','asymmetry','twist','irregularity','depth','stabilimentum'];
export function normalizeSpiderSound(value = {}) { const out = {}; for (const key of SOUND_KEYS) out[key] = clamp(value[key] ?? SPIDER_SOUND_DEFAULTS[key], ...RANGES[key]); return out; }
export const SPIDER_BODY_SOURCES = Object.freeze([
 ['silk','Silk string',true],['gut','Gut string',true],['glass','Glass thread',true],['wire','Wire string',true],['thumb','Thumb tine',true],
 ['click','Click',true],['clack','Clack',true],['fm-bell','FM bell',true],['rattle','Seed rattle',true],['buzz','Buzz',true],['growl','Growl',true],
 ['hollow','Hollow resonance',false],['breath','Breath',true],['drone','Dark drone',false],['sub','Sub resonance',false],['shimmer','Shimmer',false],
 ['membrane','Living membrane',false],['bowed-silk','Bowed silk',false],['stridulate','Palp stridulation',true],['tremulate','Abdomen tremulation',true],
 ['palp-roll','Courtship roll',true],['silk-slip','Silk slip',true],['glass-slide','Glass slide',true],['choral-web','Choral web',false],
].map(([id,label,motionOnly]) => Object.freeze({id,label,motionOnly})));
const SOURCE_INDEX = new Map(SPIDER_BODY_SOURCES.map((s,i)=>[s.id,i]));
const DEFAULT_SOURCES = ['click','bowed-silk','membrane','palp-roll','clack','choral-web','silk','glass'];
const DEFAULT_LEVELS = [.42,.26,.2,.4,.3,.15,.65,.55];
export function createDefaultSpiderBodyMix() { return SPIDER_BODY_GROUPS.map((g,i)=>({groupId:g.id,source:DEFAULT_SOURCES[i],level:DEFAULT_LEVELS[i]})); }
export function normalizeSpiderBodyMix(value) {
 const out=createDefaultSpiderBodyMix(); if(!Array.isArray(value))return out;
 for(const row of value.slice(0,32)) { const i=SPIDER_BODY_GROUPS.findIndex(g=>g.id===row?.groupId); if(i<0)continue; out[i]={groupId:out[i].groupId,source:SOURCE_INDEX.has(row.source)?row.source:out[i].source,level:clamp(row.level??out[i].level,0,1)}; } return out;
}
function patch(id,label,sources,sound={},webSettings={}) { const bodyMix=createDefaultSpiderBodyMix().map((row,i)=>({...row,source:sources[i]??row.source}));return Object.freeze({id,label,sound:Object.freeze(normalizeSpiderSound(sound)),bodyMix:Object.freeze(bodyMix.map(Object.freeze)),webSettings:Object.freeze(normalizeSpiderWeb({spokes:16,rings:10,seed:1,...webSettings}))}); }
export const SPIDER_SOUND_PRESETS=Object.freeze([
 patch('orb-silk','Living Argiope silk',DEFAULT_SOURCES,{}, {preset:'argiope'}),
 patch('cathedral','Silken cathedral',['thumb','drone','hollow','glass','fm-bell','shimmer','glass','silk'],{decay:3.6,damping:.16,tune:.8,body:.7}),
 patch('clockwork','Clockwork hunter',['clack','hollow','sub','click','clack','breath','wire','thumb'],{decay:.45,damping:.5,brightness:.8}),
 patch('glass-orbit','Glass orbit',['fm-bell','shimmer','hollow','glass','click','drone','glass','glass'],{decay:2.9,brightness:.9,coupling:.24,tune:1.2}),
 patch('gut-shadow','Gut and shadow',['thumb','drone','sub','gut','clack','hollow','gut','silk'],{tension:.55,damping:.66,decay:1.5,brightness:.33,tune:.7}),
 patch('electric-silk','Electric silk',['buzz','hollow','growl','wire','rattle','shimmer','wire','wire'],{decay:1.1,brightness:.9,body:.75}),
 patch('seed-web','Seed-web rattle',['rattle','hollow','sub','thumb','click','breath','gut','thumb'],{decay:.7,damping:.7,brightness:.6}),
 patch('tiny-bells','Tiny bells',['fm-bell','shimmer','hollow','fm-bell','glass','shimmer','thumb','glass'],{decay:1.3,tune:1.5,body:.4}),
 patch('velvet-listener','Velvet listener',['thumb','drone','sub','hollow','breath','shimmer','silk','gut'],{decay:3,damping:.6,brightness:.3,tension:.7}),
 patch('dry-frame','Dry frame',['click','hollow','sub','clack','click','breath','thumb','wire'],{decay:.2,body:.8,damping:.8}),
 patch('silver-spokes','Silver spokes',['clack','shimmer','hollow','glass','fm-bell','drone','wire','glass'],{decay:2.4,coupling:.3,tension:1.8}),
 patch('cellar-spider','Cellar spider',['rattle','hollow','growl','gut','clack','sub','gut','wire'],{tune:.6,brightness:.3,body:.9,tension:.4}),
 patch('harpist','Web harpist',['silk','hollow','sub','thumb','glass','shimmer','silk','silk'],{decay:2.7,damping:.22,coupling:.18}),
 patch('porcelain','Porcelain feet',['clack','shimmer','hollow','fm-bell','click','drone','glass','thumb'],{decay:.65,brightness:.8,tune:1.35}),
 patch('night-radio','Night radio',['buzz','drone','growl','breath','rattle','shimmer','wire','gut'],{decay:1.4,brightness:.48,body:.8}),
 patch('thread-bass','Thread bass',['thumb','sub','hollow','gut','clack','drone','gut','silk'],{tune:.5,tension:.3,decay:3,damping:.5}),
 patch('silk-river','Silk river',['silk-slip','bowed-silk','membrane','thumb','click','bowed-silk','silk','glass'],{texture:.72,slide:.85,space:.55,decay:3.4,tension:.6},{preset:'spiral',spokes:12,rings:6,seed:27,twist:.55}),
 patch('palp-serenade','Palp serenade',['clack','hollow','tremulate','stridulate','palp-roll','shimmer','gut','thumb'],{flutter:.8,texture:.55,slide:.12,decay:1.2,body:.8},{preset:'argiope',spokes:18,rings:7,seed:16,stabilimentum:.85}),
 patch('tremor-drum','Tremor drum',['fm-bell','membrane','tremulate','palp-roll','clack','sub','thumb','gut'],{tune:.7,tension:.45,flutter:.6,texture:.35,decay:.8},{preset:'bowl',spokes:10,rings:5,seed:23,depth:.2}),
 patch('sliding-crystal','Sliding crystal',['glass-slide','choral-web','shimmer','glass','click','glass-slide','glass','wire'],{slide:1,texture:.6,space:.7,brightness:.86,tension:2.2,decay:4.5},{preset:'constellation',spokes:22,rings:13,seed:42,irregularity:.55}),
 patch('velvet-friction','Velvet friction',['thumb','bowed-silk','sub','silk-slip','breath','membrane','gut','silk'],{texture:.86,slide:.6,brightness:.35,damping:.68,decay:2.8},{preset:'funnel',spokes:13,rings:9,seed:9,depth:.22}),
 patch('rain-on-silk','Rain on silk',['click','choral-web','membrane','palp-roll','fm-bell','shimmer','glass','thumb'],{texture:.55,flutter:.9,space:.8,slide:.3,decay:1.6},{preset:'sheet',spokes:24,rings:16,seed:31}),
 patch('low-courtship','Low courtship',['clack','membrane','tremulate','stridulate','rattle','sub','gut','wire'],{tune:.55,tension:.3,texture:.75,flutter:1,brightness:.5,decay:.65},{preset:'triangle',spokes:9,rings:4,seed:7}),
 patch('singing-architecture','Singing architecture',['silk','choral-web','membrane','glass-slide','fm-bell','bowed-silk','wire','glass'],{texture:.8,space:.9,slide:.7,decay:5.2,brightness:.73,tension:1.6},{preset:'dome',spokes:20,rings:12,seed:56,depth:.24}),
]);
export const SPIDER_MOTION_SOUND_PRESETS=Object.freeze(SPIDER_MOTION_PRESETS.map((motion,i)=>{
 const source=SPIDER_SOUND_PRESETS[(i*7)%SPIDER_SOUND_PRESETS.length]; const bodyMix=source.bodyMix.map(row=>({...row}));
 bodyMix[3].source=SPIDER_BODY_SOURCES[(i*3)%SPIDER_BODY_SOURCES.length].id;
 // Body-led routines need an audible owner even when no foot leaves the web.
 if(motion.id==='anchor-rock'){bodyMix[1]={...bodyMix[1],source:'hollow',level:.6};bodyMix[2]={...bodyMix[2],source:'growl',level:.45};}
 if(motion.id==='threat-pose'){bodyMix[0]={...bodyMix[0],source:'growl',level:.55};bodyMix[1]={...bodyMix[1],source:'hollow',level:.5};bodyMix[2]={...bodyMix[2],source:'sub',level:.45};}
 if(motion.id==='spinneret-sway'){bodyMix[5]={...bodyMix[5],source:'hollow',level:.65};bodyMix[2]={...bodyMix[2],source:'sub',level:.45};}
 return Object.freeze({id:motion.id,label:motion.label,sound:Object.freeze(normalizeSpiderSound({...source.sound,tension:source.sound.tension*(.9+(i%4)*.09),tune:source.sound.tune*(.91+i*.0037),flutter:.12+(i%13)*.061,texture:.22+(i%17)*.038})),bodyMix:Object.freeze(bodyMix.map(Object.freeze)),webSettings:source.webSettings});
}));
export function getSpiderMotionSound(id) { const found=SPIDER_MOTION_SOUND_PRESETS.find(p=>p.id===id)??SPIDER_MOTION_SOUND_PRESETS[0];return {id:found.id,label:found.label,sound:{...found.sound},bodyMix:found.bodyMix.map(r=>({...r})),webSettings:{...found.webSettings}}; }
export function createRandomSpiderSound(seed=1) { let n=(finite(seed,1)|0)||1;const random=()=>{n^=n<<13;n^=n>>>17;n^=n<<5;return(n>>>0)/4294967296;};return {sound:normalizeSpiderSound({tension:.4+random()*2,decay:.3+random()*3,damping:.15+random()*.65,coupling:random()*.3,brightness:.25+random()*.7,tune:.6+random()*.9,body:.25+random()*.65,voice:.5+random()*.25,pan:(random()-.5)*.5,texture:random(),slide:random(),flutter:random(),space:random()*.85,silkLevel:.3+random()*.5,preyLevel:.3+random()*.45}),bodyMix:createDefaultSpiderBodyMix().map(r=>({...r,source:SPIDER_BODY_SOURCES[Math.floor(random()*SPIDER_BODY_SOURCES.length)].id,level:.2+random()*.5})),webSettings:normalizeSpiderWeb({preset:SPIDER_WEB_PRESETS[Math.floor(random()*SPIDER_WEB_PRESETS.length)].id,spokes:8+Math.floor(random()*17),rings:3+Math.floor(random()*14),seed:Math.floor(random()*65535),twist:(random()-.5)*1.4,asymmetry:random()*.65,irregularity:random()*.5})}; }

// Eight fixed body voices: finite impact/FM/noise envelopes and four smooth
// held sources. The web strings remain the actual delay-line voices above.
class BodyVoice {
 constructor(rate,index) { this.rate=rate;this.index=index;this.source=0;this.oldSource=0;this.fade=1;this.level=0;this.targetLevel=0;this.phase=0;this.modPhase=.13;this.subPhase=.7;this.env=0;this.age=0;this.manual=0;this.frequency=140;this.targetFrequency=140;this.gate=0;this.targetGate=0;this.x=0;this.y=0;this.z=0;this.low=0;this.filtered=0;this.eventFrequency=0;this.decayCoefficient=.99;this.filterCoefficient=.25;this.panL=.7;this.panR=.7;this.seed=(0x4714153^index*7393)|0;this.output=new Float64Array(24);this.surface=new SpiderSurfaceVoice(rate,index);this.frequencySmoothing=1-Math.exp(-1/(rate*.022));this.smooth=1-Math.exp(-1/(rate*.022)); }
 assign(row,initial=false){const source=SOURCE_INDEX.get(row.source)??0;if(source!==this.source){this.oldSource=this.source;this.source=source;this.fade=initial?1:0;}this.targetLevel=row.level;if(initial)this.level=row.level;}
 excite(strength){this.env=Math.min(1.25,this.env+clamp(strength,0,1));this.age=0;}
 sample(still,sound){
  this.level+=(this.targetLevel-this.level)*this.smooth;this.gate+=(this.targetGate-this.gate)*this.smooth;this.frequency+=(this.targetFrequency-this.frequency)*this.frequencySmoothing;
  this.phase=(this.phase+this.frequency/this.rate)%1;this.modPhase=(this.modPhase+this.frequency*(1.41+sound.body*1.3)/this.rate)%1;this.subPhase=(this.subPhase+this.frequency*.501/this.rate)%1;
  let n=this.seed;n^=n<<13;n^=n>>>17;n^=n<<5;this.seed=n|0;const white=(n>>>0)/2147483648-1;this.low+=(white-this.low)*.12;
  this.age++;const sine=Math.sin(TAU*this.phase),sub=Math.sin(TAU*this.subPhase),mod=Math.sin(TAU*this.modPhase),attack=Math.min(1,this.age/(this.rate*.0015));
  const e=this.env*attack,g=Math.max(still,this.gate,Math.min(1,this.env)),o=this.output;
  // String-material rows have only a very quiet body tap; their main sound is a pooled web loop.
  for(let i=0;i<5;i++)o[i]=sine*e*.012;
  o[5]=(white-this.low)*e*Math.exp(-this.age/(this.rate*.0035))*.2;
  o[6]=(sine*.17+Math.sin(TAU*this.phase*1.63)*.11+white*.009)*e*Math.exp(-this.age/(this.rate*.02));
  o[7]=Math.sin(TAU*this.phase+mod*e*(1+sound.brightness*6))*e*.19;
  o[8]=(Math.sin(TAU*this.phase+mod*e)*.13+(white-this.low)*(.08+sound.brightness*.05)*(.3+.7*Math.max(0,Math.sin(this.age/this.rate*TAU*37))))*e;
  o[9]=Math.tanh((sine+mod*.5)*2)*e*.11;
  o[10]=(Math.tanh(sub*3+sine*.8)*.14+this.low*.07)*e;
  o[11]=(sine*.09+sub*.085+mod*.04)*g;
  o[12]=(white-this.low)*e*.09;
  o[13]=(sine*.085+sub*.09+Math.sin(TAU*this.modPhase*.71)*.05)*g;
  o[14]=Math.tanh(sub*1.7)*g*.17;
  o[15]=(sine*.07+Math.sin(TAU*this.modPhase*2)*.05)*g;
  const extra=this.surface.sample(g,this.env,white,this.age,this.source,this.oldSource,this.fade);for(let i=0;i<8;i++)o[16+i]=extra[i];
  this.env*=this.decayCoefficient;if(this.env<1e-10)this.env=0;
  this.fade=Math.min(1,this.fade+1/(this.rate*.035));const raw=o[this.source]*this.fade+o[this.oldSource]*(1-this.fade);
  this.filtered+=(raw-this.filtered)*this.filterCoefficient;
  return this.filtered*this.level*(.55+sound.body*.75);
 }
}

export class SpiderSynthDsp {
 constructor(sampleRate=48000){
  this.sampleRate=clamp(sampleRate,8000,192000);this.time=0;this.audioTime=0;this.soundTime=0;this.enabled=false;this.playing=false;this.soundPlaying=false;this.master=0;this.still=0;this.hasEnabled=false;
  this.sound=normalizeSpiderSound();this.smooth=normalizeSpiderSound();this.motion=normalizeSpiderMotion();this.webSettings=normalizeSpiderWeb();this.web=createSpiderWeb(this.webSettings);this.setNeighbors();
  this.bodyMix=createDefaultSpiderBodyMix();this.voices=Array.from({length:8},(_,i)=>new BodyVoice(this.sampleRate,i));for(let i=0;i<8;i++)this.voices[i].assign(this.bodyMix[i],true);
  this.levels=new Float64Array(8);this.strings=new SpiderStrings(this.sampleRate);this.guard=new SpiderOutputGuard();this.space=new SpiderSpace(this.sampleRate);this.worldSound=new SpiderWorldSound(this.sampleRate);
  this.worldSettings=normalizeSpiderWorld({playing:false});this.world=new SpiderSynthWorld(this.worldSettings);this.worldOptions={motionTime:0,playing:false};this.worldEventSerial=0;this.contactEpoch=-1;
  this.frame=createSpiderFrame();this.pose=new Float32Array(SPIDER_JOINTS.length*3);this.previousPose=new Float32Array(this.pose.length);this.basePose=new Float32Array(this.pose.length);this.previousOverlay=new Float32Array(this.pose.length);
  this.previousRoot=new Float64Array(4);this.groupPose=new Float64Array(24);this.groupDistance=new Float64Array(8);this.distances=new Float64Array(8);this.groupCounts=new Uint8Array(8);this.jointGroups=new Uint8Array(SPIDER_JOINTS.length);for(let i=0;i<SPIDER_JOINTS.length;i++){const group=getSpiderJointBodyGroup(SPIDER_JOINTS[i]);this.jointGroups[i]=group;this.groupCounts[group]++;}
  this.steps=new Float64Array(8);this.previousFeet=new Float64Array(24);this.footDistances=new Float64Array(8);this.primed=false;this.overlayPrimed=false;this.controlStride=Math.max(1,Math.round(this.sampleRate/200));this.countdown=0;
  this.midiPerformance=new SpiderMidiPerformance();this.midiPerformance.setJoints(SPIDER_JOINTS);this.orders=new Float64Array(24);this.midiEvents=0;
  this.interactionJoint=-1;this.interactionActive=false;this.midiGates=new Float64Array(8);this.contactEvents=0;this.pluckEvents=0;this.lastContactTime=-1;this.eventCursor=0;this.recentEvents=Array.from({length:16},()=>({id:0,segmentId:0,u:.5,velocity:0,audioTime:-1,source:'contact',silkId:null,graphVersion:0}));
  this.prey=Array.from({length:8},()=>({active:false,time:0,segmentId:0,u:.5,velocity:0,angle:0}));
  this.metronome=false;this.lastBeat=-1;this.click=0;this.clickPhase=0;this.metronomeEvents=0;this.lastMetronomeTime=-1;
  this.atlas=null;this.atlasRate=16000;this.phoneQueue=EMPTY_PHONES;this.phoneIndex=0;this.phonePosition=0;this.phone=null;this.speechGain=0;this.speechTarget=0;this.pendingSpeech=null;this.speechEnvelope=0;this.speechRate=1;this.speechFilter=0;this.speechSmoothing=1-Math.exp(-1/(this.sampleRate*.0015));
  this.dcL=0;this.dcR=0;this.previousL=0;this.previousR=0;this.smoothing=1-Math.exp(-1/(this.sampleRate*.025));
  this.telemetry={rms:0,peak:0,audioTime:0,time:0,motionTime:0,speechEnvelope:0,contactEvents:0,pluckEvents:0,activeStrings:0,lastContactTime:-1,recentEvents:this.recentEvents,renderedFrames:0};
 }
 update(value={}){
  if('enabled'in value){const was=this.enabled;this.enabled=value.enabled===true;if(!this.enabled){this.strings.release();for(const voice of this.voices)voice.env=0;for(const p of this.prey)p.active=false;this.stopSpeech();}if(!was||!this.enabled)this.primeMidi();}
  if('playing'in value){if(this.playing!==(value.playing===true))this.primed=false;this.playing=value.playing===true;}
  if(value.worldSettings||'playing'in value){const next=normalizeSpiderWorld({...this.worldSettings,...value.worldSettings,playing:this.playing});let changed=false;for(const key of ['path','speed','range','laySilk','hunt','playing','seed'])if(next[key]!==this.worldSettings[key])changed=true;if(next.joystick.x!==this.worldSettings.joystick.x||next.joystick.z!==this.worldSettings.joystick.z)changed=true;this.worldSettings=next;if(changed)this.world.update(next,this.audioTime);}
  if('soundPlaying'in value)this.soundPlaying=value.soundPlaying===true;
  if('metronome'in value)this.metronome=value.metronome===true;
  if('time'in value){this.time=clamp(value.time,0,1e9);this.primed=false;}
  if(value.motion){const next=normalizeSpiderMotion({...this.motion,...value.motion});if(next.preset!==this.motion.preset||next.tempo!==this.motion.tempo)this.primed=false;this.motion=next;}
  if(value.sound)this.sound=normalizeSpiderSound({...this.sound,...value.sound});
  if(value.webSettings){
   const settings=normalizeSpiderWeb({...this.webSettings,...value.webSettings});
   if(value.sound?.tension==null&&value.webSettings.tension!=null&&value.webSettings.tension!==this.webSettings.tension)this.sound.tension=clamp(value.webSettings.tension,.25,4);
   let changed=false;for(const key of WEB_KEYS)if(settings[key]!==this.webSettings[key])changed=true;
   this.webSettings=settings;if(changed){this.web=createSpiderWeb({...settings,tension:this.sound.tension});this.setNeighbors();this.strings.release();this.primed=false;for(const event of this.recentEvents)event.id=0;}
  }
  if(value.bodyMix){this.bodyMix=normalizeSpiderBodyMix(value.bodyMix);for(let i=0;i<8;i++)this.voices[i].assign(this.bodyMix[i],!this.hasEnabled);}
  if(value.resetActivity){this.primed=false;this.overlayPrimed=false;this.distances.fill(0);this.strings.release();for(const v of this.voices)v.env=0;for(const p of this.prey)p.active=false;}
  if(!this.hasEnabled)Object.assign(this.smooth,this.sound);if(this.enabled)this.hasEnabled=true;this.countdown=0;
 }
 setNeighbors(){
  const incident=Array.from({length:this.web.nodes.length},()=>[]);this.webLengths=new Float64Array(2);const counts=new Uint32Array(2);this.neighbors=new Int32Array(this.web.segments.length);
  for(const segment of this.web.segments){incident[segment.a].push(segment.id);incident[segment.b].push(segment.id);const kind=segment.kind==='spiral'?1:0;this.webLengths[kind]+=segment.length;counts[kind]++;}
  for(let i=0;i<2;i++)this.webLengths[i]/=Math.max(1,counts[i]);
  for(const segment of this.web.segments){let neighbor=-1;for(const id of incident[segment.a])if(id!==segment.id){neighbor=id;break;}if(neighbor<0)for(const id of incident[segment.b])if(id!==segment.id){neighbor=id;break;}this.neighbors[segment.id]=neighbor<0?segment.id:neighbor;}
 }
 primeMidi(){for(let i=0;i<this.orders.length;i++)this.orders[i]=this.midiPerformance.voices[i]?.order??0;this.overlayPrimed=false;}
 midi(message,audioTime=this.audioTime){const accepted=this.midiPerformance.handle(message,audioTime);if(accepted){this.countdown=0;if(message.type==='controlChange'&&message.controller===11)this.overlayPrimed=false;if(message.type==='controlChange'&&message.controller===120){this.overlayPrimed=false;this.strings.releaseMidi(message.synthetic&&message.sourceId==='web-midi:manager'?undefined:{sourceId:message.sourceId,...(!message.synthetic?{channel:message.channel}:{})});}if(message.type==='noteOn'&&this.audioTime-audioTime>=.1)this.overlayPrimed=false;}return accepted;}
 midiControl(groupId,axis,value,audioTime=this.audioTime,scope){const accepted=this.midiPerformance.setControl(groupId,axis,value,audioTime,scope);if(accepted)this.countdown=0;return accepted;}
 resetMidi(scope,audioTime=this.audioTime){this.midiPerformance.reset(audioTime,scope);this.strings.releaseMidi(scope);this.overlayPrimed=false;this.countdown=0;}
 restoreMidi(snapshot){if(!this.midiPerformance.restore(snapshot))return false;this.primeMidi();this.countdown=0;return true;}
 interact({jointId,active=false}={}){
  this.interactionActive=active===true;
  if(active)this.interactionJoint=SPIDER_JOINTS.findIndex(j=>j.id===jointId);
  // Offset and world-foot deltas own sound. Pointer speed at a physical limit
  // cannot create friction, and an accepted drag must never strike twice.
 }
 worldCommand(command={},audioTime=this.audioTime){
  if(!['send-prey','hunt','clear-silk','reset','home','move','pluck-silk'].includes(command.type))return false;
  this.world.command(command,clamp(audioTime,0,this.audioTime+.05));this.countdown=0;return true;
 }
 restoreWorld(snapshot,timeOffset=0){
  if(snapshot?.version!==1)return false;this.world.restore(snapshot,finite(timeOffset));this.worldSettings=this.world.settings;
  this.worldEventSerial=this.world.nextEventId-1;this.contactEpoch=-1;this.primed=false;this.countdown=0;return true;
 }
 getWorldSnapshot(){return this.world.snapshot();}
 processWorldEvents(state){
  for(let i=0;i<state.events.length;i++){
   const event=state.events[i];if(event.serial<=this.worldEventSerial)continue;this.worldEventSerial=event.serial;
   if(!this.enabled||this.audioTime-event.time>.12||event.time>this.audioTime+.005)continue;
   if(event.type==='silk-pluck'){
    let strand=null;for(let j=0;j<state.silkSegments.length;j++)if(state.silkSegments[j].id===event.id){strand=state.silkSegments[j];break;}
    if(!strand||this.smooth.silkLevel<=0)continue;
    const frequency=spiderStringFrequency(strand.length,this.smooth.tension,event.u)*this.smooth.tune;
    const strength=event.strength*this.smooth.silkLevel;
    if(this.strings.pluck(frequency,Math.sqrt(strength)*(.35+.65*Math.abs(Math.sin(event.angle-strand.angle))),clamp((strand.ax+strand.bx)*.4+this.smooth.pan,-1,1),this.smooth,6,-1,0,event.u,null,1,true,1))this.emit(-1,event.u,strength,'silk',event.id);
   }else if((event.type==='prey-trapped'||event.type==='prey-struggle')&&this.smooth.preyLevel>0){
    this.pluckString(event.segmentId,event.u,event.strength*this.smooth.preyLevel,event.angle+Math.PI/2,-1,'prey',1,false);
   }
  }
 }
 emit(segmentId,u,velocity,source,silkId=null){const event=this.recentEvents[this.eventCursor];event.id=++this.pluckEvents;event.segmentId=segmentId;event.u=u;event.velocity=velocity;event.audioTime=this.audioTime;event.source=source;event.silkId=silkId;event.graphVersion=this.world.state.graphVersion;this.eventCursor=(this.eventCursor+1)%this.recentEvents.length;}
 pluck({segmentId,u=.5,velocity=.65,angle=Math.PI/2,source='gesture'}={}){
  if(!this.enabled)return false;
  const id=Math.round(finite(segmentId,-1));if(id<0||id>=this.web.segments.length)return false;
  const strength=clamp(velocity,0,1);if(!strength)return false;
  const accepted=this.pluckString(id,clamp(u,0,1),strength*(source==='prey'?this.smooth.preyLevel:1),finite(angle),-1,source);
  if(source==='prey')for(let i=0;i<8;i++){const event=this.prey[i];event.active=true;event.time=this.audioTime+.085+i*.17;event.segmentId=id;event.u=clamp(u+(i%2?1:-1)*.07,0,1);event.velocity=strength*(.65-i*.055);event.angle=angle+i*.7;}
  return accepted;
 }
 pluckString(id,u,strength,angle,owner=-1,source='contact',midiRatio=1,couple=true,midiOwner=null,worldKind=source==='prey'?2:0){
  const segment=this.web.segments[id];if(!segment)return false;const group=owner>=0?owner:segment.kind==='spiral'?7:6;const voice=this.voices[group];
  const a=this.web.nodes[segment.a],b=this.web.nodes[segment.b];const x=a.x+(b.x-a.x)*u;
  const frequency=spiderStringFrequency(segment.length,this.smooth.tension,u)*this.smooth.tune*midiRatio*(owner>=0?2**(voice.x*.35+voice.y*.15):1);
  const expression=midiOwner?this.midiPerformance.scopes[midiOwner.scope]?.expression??1:1;
  const amount=Math.sqrt(midiOwner&&expression>0?strength/expression:strength)*(.35+.65*Math.abs(Math.sin(angle-segment.angle)));
  let accepted=false;
  if(voice.source<5)accepted=this.strings.pluck(frequency,amount,clamp(x*.8+this.smooth.pan+(owner>=0?voice.z*.3:0),-1,1),this.smooth,group,id,voice.source,u,midiOwner,expression,source==='gesture'||source==='midi'||source==='prey',worldKind);
  else{voice.eventFrequency=frequency/this.smooth.tune;voice.targetFrequency=frequency;voice.excite(amount);accepted=true;}
  if(accepted){this.emit(id,u,strength,source);if(couple&&this.smooth.coupling>0){const neighbor=this.neighbors[id];this.pluckString(neighbor,.5,strength*this.smooth.coupling,angle,owner,'coupling',midiRatio,false,midiOwner,worldKind);}}
  return accepted;
 }
 exciteGroup(group,strength,source='gesture',footIndex=-1,midiRatio=1,midiOwner=null){
  this.voices[group].excite(strength);
  if(this.voices[group].source<5){const foot=this.frame.feet[footIndex>=0?footIndex:group%8];if(foot)this.pluckString(foot.segmentId,foot.u,strength,foot.angle,group,source,midiRatio,false,midiOwner);}
 }
 control(){
  writeSpiderPose(this.time,this.motion,this.pose);this.basePose.set(this.pose);
  this.midiPerformance.applyPose(this.pose,SPIDER_JOINTS,this.audioTime,this.motion.tempo,this.motion.intensity);const midi=this.midiPerformance.output;
  this.worldOptions.motionTime=this.time;this.worldOptions.playing=this.playing;
  const worldState=this.world.sample(this.audioTime,this.motion,this.web,this.frame,this.pose,this.midiPerformance.poseOffsets,this.worldOptions);
  if(this.contactEpoch!==this.frame.contactEpoch){this.primed=false;this.footDistances.fill(0);this.contactEpoch=this.frame.contactEpoch;}
  this.processWorldEvents(worldState);this.worldSound.control(worldState,this.smooth,this.enabled);
  this.groupPose.fill(0);this.groupDistance.fill(0);
  for(let i=0;i<SPIDER_JOINTS.length;i++){const group=this.jointGroups[i];for(let axis=0;axis<3;axis++){const k=i*3+axis;this.groupPose[group*3+axis]+=this.pose[k];const overlay=this.pose[k]-this.basePose[k];if(this.primed&&(this.playing||this.overlayPrimed)){const delta=this.overlayPrimed?this.pose[k]-this.previousPose[k]:this.basePose[k]-(this.previousPose[k]-this.previousOverlay[k]);this.groupDistance[group]+=Math.abs(delta);}this.previousOverlay[k]=overlay;}}
  // Procedural root turns (rollover, bows, leaps) are real body movement.
  // Remove the already counted cephalothorax joint contribution before routing.
  for(let axis=0;axis<4;axis++){
   const value=axis===0?this.frame.body.pitch-this.pose[0]*.28:axis===1?this.frame.body.yaw-this.pose[1]*.2:axis===2?this.frame.body.roll-this.pose[2]*.28:this.frame.body.y*5;
   if(axis<3){const turn=Math.sin(value),cross=1-Math.cos(value);this.groupPose[3+axis]+=turn*.6;this.groupPose[6+axis]+=turn*.35;this.groupPose[3+(axis+1)%3]+=cross*.18;this.groupPose[6+(axis+1)%3]+=cross*.1;}
   if(this.primed){const difference=value-this.previousRoot[axis],delta=axis<3?Math.abs(Math.atan2(Math.sin(difference),Math.cos(difference))):Math.abs(difference);this.groupDistance[1]+=delta*.6;this.groupDistance[2]+=delta*.35;}
   this.previousRoot[axis]=value;
  }
  for(let axis=0;axis<3;axis++)this.groupPose[15+axis]=this.groupPose[6+axis]*.65;this.groupDistance[5]=this.groupDistance[2]*.65;
  for(let i=0;i<8;i++){
   const voice=this.voices[i],div=Math.sqrt(Math.max(1,this.groupCounts[i]));voice.x=this.groupPose[i*3]/div;voice.y=this.groupPose[i*3+1]/div;voice.z=this.groupPose[i*3+2]/div;
   voice.targetFrequency=clamp((midi.notes[i]>=0?midi.frequencies[i]:i>=6?(voice.eventFrequency||spiderStringFrequency(this.webLengths[i-6],this.smooth.tension,.5)):95+i*29)*this.smooth.tune*2**(voice.x*.15+voice.y*.08),30,this.sampleRate*.12);
   voice.decayCoefficient=Math.exp(-1/(this.sampleRate*(voice.source>=9?.022+this.smooth.decay*.018:.035+this.smooth.decay*.055)));voice.filterCoefficient=1-Math.exp(-TAU*Math.min(this.sampleRate*.4,650*15**clamp(this.smooth.brightness+voice.y*.2,0,1))/this.sampleRate);
   voice.frequencySmoothing=1-Math.exp(-1/(this.sampleRate*(.008+this.smooth.slide*this.smooth.slide*.48)));voice.surface.configure(voice.frequency,this.smooth,voice.x,voice.y,voice.z);
   voice.targetGate=midi.gates[i]*midi.velocities[i]*midi.expressions[i]*(1+.35*midi.pressures[i]);
   const pan=clamp(this.smooth.pan+voice.z*.4+midi.pans[i]*.5,-.95,.95);voice.panL=Math.cos((pan+1)*Math.PI/4);voice.panR=Math.sin((pan+1)*Math.PI/4);
   // Friction and resonances follow measured angular speed, including very
   // slow abdomen/head gestures. A stationary pose never refreshes this tail.
   if(this.enabled&&voice.source>=9&&this.groupDistance[i]>1e-7)voice.env=Math.max(voice.env,Math.min(.9,Math.sqrt(this.groupDistance[i]*this.sampleRate/this.controlStride)*.7));
   this.distances[i]+=this.groupDistance[i];
   if(this.enabled&&this.distances[i]>.12&&!(this.frame.motionActive&&i===0)){this.distances[i]%=.12;this.exciteGroup(i,Math.min(.85,.25+this.groupDistance[i]*2),'gesture');}
   const foot=this.frame.feet[i];if(this.primed&&this.frame.motionActive&&this.enabled&&foot.stance&&foot.step>this.steps[i]){this.contactEvents++;this.lastContactTime=this.time;this.exciteGroup(0,foot.impact,'contact',i);this.pluckString(foot.segmentId,foot.u,foot.impact,foot.angle,-1,'contact');}
   const k=i*3,dx=foot.x-this.previousFeet[k],dy=foot.y-this.previousFeet[k+1],dz=foot.z-this.previousFeet[k+2];
   if(this.primed&&this.overlayPrimed&&!this.frame.motionActive&&this.enabled){this.footDistances[i]+=Math.hypot(dx,dy,dz);if(this.footDistances[i]>.012){this.footDistances[i]%=.012;this.pluckString(foot.segmentId,foot.u,Math.min(.7,.25+Math.hypot(dx,dz)*15),Math.atan2(dz,dx),-1,'gesture');}}
   this.previousFeet[k]=foot.x;this.previousFeet[k+1]=foot.y;this.previousFeet[k+2]=foot.z;
   this.steps[i]=foot.step;
  }
  for(let i=0;i<this.orders.length;i++){
   const v=this.midiPerformance.voices[i];if(!v||v.order===this.orders[i])continue;
   const age=this.audioTime-v.started;
   if(this.enabled&&v.active&&(v.held||v.sustained)&&age>=0&&age<.1){const strength=v.velocity*this.midiPerformance.scopes[v.scope].expression;const target=v.note%12;const foot=this.frame.feet[target<8?target:0];this.exciteGroup(v.group,strength,'midi',target<8?target:-1,2**((v.note-60)/12),v);if(target<8)this.pluckString(foot.segmentId,foot.u,strength,Math.PI/2,-1,'midi',2**((v.note-60)/12),true,v);this.midiEvents++;}
   if(age>=0||!v.active)this.orders[i]=v.order;
  }
  this.previousPose.set(this.pose);this.primed=true;this.overlayPrimed=true;this.strings.retune(this.smooth,this.midiPerformance);this.speechRate=clamp(this.smooth.tune**.25,.72,1.4);
 }
  setAtlas(samples, sampleRate) {
    if (!(samples instanceof Float32Array) || samples.length > 192000 * 16) throw new Error('Speech atlas exceeds its fixed budget.');
    this.atlas = samples; this.atlasRate = clamp(sampleRate, 8000, 192000);
  }
  speak(phones) {
    if (!this.atlas || !this.enabled) return false;
    const queue = (Array.isArray(phones) ? phones : []).slice(0, MAX_PHONES).map((phone) => ({
      offset: clamp(phone?.offset, 0, this.atlas.length / this.atlasRate),
      duration: clamp(phone?.duration, .015, .65), gain: clamp(phone?.gain ?? 1, 0, 1.5), silence: phone?.silence === true,
    }));
    if (this.phone || this.phoneIndex < this.phoneQueue.length) {
      this.pendingSpeech = queue; this.speechTarget = 0;
    } else {
      this.phoneQueue = queue; this.phoneIndex = 0; this.phone = null; this.phonePosition = 0;
      this.speechTarget = 1; this.pendingSpeech = null;
    }
    return queue.length > 0;
  }
  stopSpeech() { this.pendingSpeech = null; this.speechTarget = 0; }
  speechSample() {
    this.speechGain += (this.speechTarget - this.speechGain) * this.speechSmoothing;
    if (this.speechTarget === 0 && this.speechGain < .0001) {
      this.phoneQueue = this.enabled && this.pendingSpeech ? this.pendingSpeech : EMPTY_PHONES;
      this.phoneIndex = 0; this.phone = null; this.phonePosition = 0;
      this.pendingSpeech = null;
      if (this.phoneQueue.length) this.speechTarget = 1;
      else return 0;
    }
    if (!this.phone) {
      this.phone = this.phoneQueue[this.phoneIndex++] ?? null; this.phonePosition = 0;
      if (!this.phone) { this.phoneQueue = EMPTY_PHONES; this.phoneIndex = 0; this.speechTarget = 0; return 0; }
    }
    const phone = this.phone;
    const rate = this.speechRate;
    const age = this.phonePosition / this.atlasRate;
    const envelope = Math.min(1, age / .007, (phone.duration - age) / .009);
    const position = phone.offset * this.atlasRate + this.phonePosition;
    const index = Math.floor(position); const mix = position - index;
    let sample = phone.silence ? 0 : ((this.atlas[index] || 0) * (1 - mix) + (this.atlas[index + 1] || 0) * mix) * Math.max(0, envelope) * phone.gain;
    this.phonePosition += this.atlasRate / this.sampleRate * rate;
    if (this.phonePosition >= phone.duration * this.atlasRate) this.phone = null;
    if (!Number.isFinite(sample)) sample = 0;
    return sample * this.speechGain;
  }
 render(left,right,audioTime){
  if(Number.isFinite(audioTime)){if(Math.abs(audioTime-this.audioTime)>.02)this.overlayPrimed=false;this.audioTime=audioTime;}
  const count=Math.min(left.length,right.length);let energy=0,peak=0;
  for(let i=0;i<count;i++){
   if(this.countdown--<=0){this.control();this.countdown=this.controlStride-1;}
   for(const p of this.prey)if(p.active&&this.audioTime>=p.time){p.active=false;if(this.enabled&&this.sound.preyLevel>0&&this.audioTime-p.time<.1)this.pluckString(p.segmentId,p.u,p.velocity*this.smooth.preyLevel,p.angle,-1,'prey');}
   const beatPosition=this.time*this.motion.tempo/60,beat=Math.floor(beatPosition+1e-9);
   if(this.enabled&&this.playing&&this.metronome&&beat!==this.lastBeat&&Math.abs(beatPosition-beat)<this.motion.tempo/(this.sampleRate*60)+1e-8){this.click=1;this.clickPhase=0;this.metronomeEvents++;this.lastMetronomeTime=this.time;}
   this.lastBeat=beat;this.clickPhase=(this.clickPhase+(beat%4===0?1700:1200)/this.sampleRate)%1;
   const click=Math.sin(TAU*this.clickPhase)*this.click*.075;this.click*=Math.exp(-1/(this.sampleRate*.008));
   for(const key of SOUND_KEYS)this.smooth[key]+=(this.sound[key]-this.smooth[key])*this.smoothing;
   this.master+=((this.enabled?1:0)-this.master)*this.smoothing;this.still+=((this.soundPlaying?1:0)-this.still)*this.smoothing;
   let bodyL=0,bodyR=0;for(let group=0;group<8;group++){const v=this.voices[group],value=v.sample(this.still,this.smooth);bodyL+=value*v.panL;bodyR+=value*v.panR;this.levels[group]=v.level;}
   this.strings.sample(this.levels,this.smooth.brightness,this.smooth);
   const speech=this.atlas?this.speechSample():0;this.speechEnvelope+=(Math.abs(speech)-this.speechEnvelope)*.008;
   this.speechFilter+=(speech-this.speechFilter)*(1-Math.exp(-TAU*Math.min(this.sampleRate*.4,1800+this.smooth.brightness*9500)/this.sampleRate));
   const colored=this.speechFilter*(.9+this.smooth.body*.15)+Math.tanh(this.speechFilter*(1+this.smooth.body))/(1+this.smooth.body)*.1;
   const voice=colored*this.smooth.voice*1.8,pan=clamp(this.smooth.pan,-1,1);
   this.worldSound.sample(this.smooth);this.space.sample(this.strings.left*6+bodyL*2.1+this.worldSound.left,this.strings.right*6+bodyR*2.1+this.worldSound.right,this.smooth.space);
   const rawL=this.space.left+voice*Math.cos((pan+1)*Math.PI/4)+click;
   const rawR=this.space.right+voice*Math.sin((pan+1)*Math.PI/4)+click;
   this.dcL=rawL-this.previousL+this.dcL*.997;this.dcR=rawR-this.previousR+this.dcR*.997;this.previousL=rawL;this.previousR=rawR;
   const gain=this.master*this.smooth.level*1.25;
   this.guard.sample(Math.tanh(this.dcL*gain),Math.tanh(this.dcR*gain));
   const l=Number.isFinite(this.guard.left)?this.guard.left:0,r=Number.isFinite(this.guard.right)?this.guard.right:0;
   left[i]=l;right[i]=r;energy+=(l*l+r*r)/2;peak=Math.max(peak,Math.abs(l),Math.abs(r));
   if(this.playing)this.time+=1/this.sampleRate;if(this.soundPlaying)this.soundTime+=1/this.sampleRate;this.audioTime+=1/this.sampleRate;
  }
  const t=this.telemetry;t.rms=Math.sqrt(energy/Math.max(1,count));t.peak=peak;t.audioTime=this.audioTime;t.time=this.time;t.motionTime=this.time;t.soundTime=this.soundTime;t.speechEnvelope=this.speechEnvelope;
  t.contactEvents=this.contactEvents;t.pluckEvents=this.pluckEvents;t.activeStrings=this.strings.active;t.lastContactTime=this.lastContactTime;t.midiEvents=this.midiEvents;t.midiNotes=this.midiPerformance.output.notes;let activeMidi=0;for(let i=0;i<8;i++){this.midiGates[i]=this.voices[i].gate;if(this.midiPerformance.output.notes[i]>=0)activeMidi++;}t.midiActive=activeMidi;t.midiGates=this.midiGates;t.midiExpressions=this.midiPerformance.output.expressions;t.midiFrequencies=this.midiPerformance.output.frequencies;t.renderedFrames+=count;
  t.metronomeEvents=this.metronomeEvents;t.lastMetronomeTime=this.lastMetronomeTime;return t;
 }
}
