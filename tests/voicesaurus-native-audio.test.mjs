import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Exercise the authored controller with deterministic device/worker doubles.
// Only its four imports are replaced; its runtime logic is unchanged.
const sourceUrl = new URL('../src/instruments/voicesaurus/native-audio.js', import.meta.url);
const temporaryDirectory = await fs.mkdtemp(join(tmpdir(), 'voicesaurus-native-audio-test-'));
const fixtureUrl = pathToFileURL(join(temporaryDirectory, 'native-audio-under-test.mjs'));
const dependencyKey = `voicesaurusNativeAudioTest_${basename(temporaryDirectory)}`;
const originalGlobals = new Map(['AudioContext', 'Worker'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
after(async () => {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  delete globalThis[dependencyKey];
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});
try {
  const authored = await fs.readFile(sourceUrl, 'utf8');
  const source = authored.replace(/^import .*;\n/gm, '');
  await fs.writeFile(fixtureUrl, `const {resumeAudioContext,connectSpellingOutput,unlockAudioContext,NATIVE_OUTPUT_TRIMS}=globalThis[${JSON.stringify(dependencyKey)}];\n${source}`);
} catch (error) {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
  throw error;
}

class Param{value=1;calls=[];setTargetAtTime(...args){this.calls.push(['target',...args]);}setValueAtTime(...args){this.calls.push(['set',...args]);}linearRampToValueAtTime(...args){this.calls.push(['ramp',...args]);}cancelScheduledValues(...args){this.calls.push(['cancel',...args]);}}
class Node{connections=[];disconnected=0;numberOfInputs=1;constructor(context){this.context=context;}connect(node){this.connections.push(node);return node;}disconnect(){this.disconnected++;this.connections=[];}}
class Gain extends Node{gain=new Param();}
class Buffer{constructor(channels,frames,sampleRate){this.length=frames;this.sampleRate=sampleRate;this.duration=frames/sampleRate;this.samples=new Float32Array(frames);}copyToChannel(samples){this.samples.set(samples);}getChannelData(){return this.samples;}}
class Source extends Node{loop=false;onended=null;starts=[];stops=[];playbackRate={value:1};start(...args){this.starts.push(args);}stop(...args){this.stops.push(args);}end(){this.onended?.();}}
class Context{static created=0;state='running';sampleRate=48000;currentTime=10;sources=[];gains=[];analysers=[];suspended=0;closed=0;destination=new Node(this);constructor(){Context.created++;}createGain(){const gain=new Gain(this);this.gains.push(gain);return gain;}createAnalyser(){const analyser=new Node(this);this.analysers.push(analyser);return analyser;}createBuffer(...args){return new Buffer(...args);}createBufferSource(){const s=new Source(this);this.sources.push(s);return s;}async suspend(){this.suspended++;this.state='suspended';}async close(){this.closed++;this.state='closed';}}
class WorkerMock{static all=[];terminated=false;constructor(url){this.url=url;WorkerMock.all.push(this);}postMessage(request){this.request=request;}terminate(){this.terminated=true;}ready(samples=new Float32Array(4800).fill(.1),sampleRate=48000){this.onmessage?.({data:{type:'ready',samples,sampleRate}});}}
let unlocked=0,resumed=0,outputs=0,releasedOutputs=0;
globalThis.AudioContext=Context;globalThis.Worker=WorkerMock;
globalThis[dependencyKey]={resumeAudioContext:async c=>{resumed++;c.state='running';},unlockAudioContext:()=>unlocked++,connectSpellingOutput:()=>{outputs++;return {release(){releasedOutputs++;}};},NATIVE_OUTPUT_TRIMS:{sinsy:.37,flite:.81}};
let NativeVoiceAudio;
try { ({NativeVoiceAudio} = await import(fixtureUrl.href)); }
catch (error) { await fs.rm(temporaryDirectory, {recursive:true,force:true}); throw error; }
async function audio(){const a=new NativeVoiceAudio();await a.enable();return a;}
async function ready(a,{store=false,engine='sinsy'}={}){const promise=a.render({engine},{store});const worker=WorkerMock.all.at(-1);worker.ready();return promise;}
function phrase(a){a.buffer=new Buffer(1,192000,48000);a.position=1;a.engine='flite';a.loop=true;return a.buffer;}

test('borrowed audio renders through the host input without owning or arming device output',async()=>{
 const context=new Context(),destination=context.createAnalyser(),a=new NativeVoiceAudio();
 const before=[Context.created,unlocked,resumed,outputs,releasedOutputs];
 await a.enable({context,destination});
 assert.equal(a.context,context);assert.equal(a.enabled,true);
 assert.deepEqual(a.master.connections,[a.analyser]);assert.deepEqual(a.analyser.connections,[destination]);
 const result=await ready(a,{store:true});assert.equal(a.play(),true);
 assert.equal(a.source.buffer,result.buffer);assert.deepEqual(a.source.connections,[a.sourceGain]);assert.deepEqual(a.sourceGain.connections,[a.master]);
 assert.deepEqual([Context.created,unlocked,resumed,outputs,releasedOutputs],before);
 assert.deepEqual(context.destination.connections,[]);
 const master=a.master,analyser=a.analyser,source=a.source,gain=a.sourceGain;
 await a.close();
 assert.equal(source.disconnected,1);assert.equal(gain.disconnected,1);assert.equal(master.disconnected,1);assert.equal(analyser.disconnected,1);
 assert.equal(destination.disconnected,0);assert.equal(context.state,'running');assert.equal(context.suspended,0);assert.equal(context.closed,0);
 assert.deepEqual([Context.created,unlocked,resumed,outputs,releasedOutputs],before);
 assert.equal(a.context,null);assert.equal(a.master,null);assert.equal(a.analyser,null);
 await a.close();assert.equal(master.disconnected,1);assert.equal(analyser.disconnected,1);
});

test('borrowed disable cancels rendering and active or retiring voices while retaining the host graph',async()=>{
 const context=new Context(),destination=context.createAnalyser(),a=new NativeVoiceAudio();await a.enable({context,destination});
 const main=phrase(a);a.play();const first=a.source;a.play();const second=a.source;
 assert.equal(a.retiring.size,1);
 const pending=a.render({engine:'sinsy'}),rejected=assert.rejects(pending,{name:'AbortError'}),worker=WorkerMock.all.at(-1),master=a.master,analyser=a.analyser;
 await a.disable();await rejected;worker.ready();
 assert.equal(worker.terminated,true);assert.equal(a.pendingRender,null);assert.equal(a.buffer,main);
 assert.equal(a.enabled,false);assert.equal(a.playing,false);assert.equal(a.retiring.size,0);
 assert.equal(first.disconnected,1);assert.equal(second.disconnected,1);
 assert.equal(context.state,'running');assert.equal(context.suspended,0);assert.equal(context.closed,0);
 assert.equal(master.disconnected,0);assert.deepEqual(analyser.connections,[destination]);
 await a.enable({context,destination});await a.enable({context,destination});
 assert.equal(a.master,master);assert.equal(a.analyser,analyser);assert.deepEqual(analyser.connections,[destination]);
 assert.equal(a.play(),true);await a.close();
});

test('borrowed enable rejects missing, foreign, device, source-only and unarmed graphs without side effects',async()=>{
 const context=new Context(),destination=context.createGain(),foreign=new Context(),sourceOnly=context.createBufferSource();sourceOnly.numberOfInputs=0;
 const suspended=new Context();suspended.state='suspended';const closed=new Context();closed.state='closed';
 const invalid=[{context},{destination},{context:foreign,destination},{context,destination:context.destination},{context,destination:sourceOnly},{context:{state:'running'},destination},
  {context:suspended,destination:suspended.createGain()},{context:closed,destination:closed.createGain()}];
 const before=[Context.created,unlocked,resumed,outputs];
 for(const options of invalid){
  const a=new NativeVoiceAudio();await assert.rejects(a.enable(options));
  assert.equal(a.context,null);assert.equal(a.enabled,false);assert.equal(a.master,undefined);await a.close();
 }
 assert.deepEqual([Context.created,unlocked,resumed,outputs],before);
 assert.equal(context.suspended,0);assert.equal(foreign.suspended,0);assert.equal(suspended.suspended,0);assert.equal(closed.closed,0);
});

test('an attached graph cannot silently change ownership or destination during playback',async()=>{
 const context=new Context(),destination=context.createGain(),a=new NativeVoiceAudio();await a.enable({context,destination});phrase(a);a.play();
 const source=a.source,master=a.master,analyser=a.analyser,other=new Context();
 for(const options of [undefined,{context,destination:context.createGain()},{context:other,destination:other.createGain()}])await assert.rejects(a.enable(options),/host context|Close the voice audio graph/);
 assert.equal(a.source,source);assert.equal(a.master,master);assert.equal(a.analyser,analyser);assert.equal(a.enabled,true);assert.equal(a.playing,true);assert.equal(source.stops.length,0);
 await a.disable();context.state='suspended';const before=[unlocked,resumed];
 await assert.rejects(a.enable({context,destination}),{name:'NotAllowedError'});assert.deepEqual([unlocked,resumed],before);assert.equal(a.enabled,false);
 await a.close();assert.equal(context.closed,0);assert.equal(context.suspended,0);
 const standalone=await audio(),owned=standalone.context;
 await assert.rejects(standalone.enable({context:other,destination:other.createGain()}),/Close the voice audio graph/);
 assert.equal(standalone.context,owned);await standalone.close();assert.equal(owned.closed,1);
});

test('failed borrowed connection disconnects partial nodes and permits retry',async()=>{
 const context=new Context(),destination=context.createGain(),a=new NativeVoiceAudio(),createAnalyser=context.createAnalyser.bind(context);
 context.createAnalyser=()=>{const node=createAnalyser();node.connect=()=>{throw Error('connection failed');};return node;};
 await assert.rejects(a.enable({context,destination}),/connection failed/);
 assert.equal(a.context,null);assert.equal(a.enabled,false);assert.equal(context.gains.at(-1).disconnected,1);assert.equal(context.analysers.at(-1).disconnected,1);assert.equal(destination.disconnected,0);
 context.createAnalyser=createAnalyser;await a.enable({context,destination});assert.equal(a.enabled,true);await a.close();assert.equal(context.state,'running');
});

test('closing standalone audio still releases its output and permits a later borrowed session',async()=>{
 const before=[outputs,releasedOutputs],a=await audio(),owned=a.context,master=a.master,analyser=a.analyser;
 await a.close();assert.equal(owned.state,'closed');assert.equal(owned.closed,1);assert.equal(master.disconnected,1);assert.equal(analyser.disconnected,1);
 assert.deepEqual([outputs,releasedOutputs],[before[0]+1,before[1]+1]);
 const context=new Context(),destination=context.createGain();await a.enable({context,destination});await a.close();
 assert.equal(context.state,'running');assert.equal(context.closed,0);assert.deepEqual([outputs,releasedOutputs],[before[0]+1,before[1]+1]);
});

test('offline sample-bank PCM uses the shared buffer and audition output without a worker',async()=>{
 const a=await audio(),main=phrase(a),workers=WorkerMock.all.length;
 a.renderSampleBank=async()=>({samples:new Float32Array(4800).fill(.2),sampleRate:48000,scoreOffsetSeconds:.05});
 const result=await a.render({engine:'sample-bank'},{store:false});
 assert.equal(a.buffer,main);assert.equal(result.scoreOffsetSeconds,.05);assert.equal(WorkerMock.all.length,workers);
 assert.equal(a.audition(result),true);assert.equal(a.context.sources.length,1);assert.equal(a.auditionSource.buffer,result.buffer);await a.close();
});

test('cancelling an offline sample-bank job aborts it and ignores late PCM',async()=>{
 const a=await audio(),main=phrase(a);let complete,signal;
 a.renderSampleBank=(_request,options)=>{signal=options.signal;return new Promise(resolve=>complete=resolve);};
 const pending=a.render({engine:'sample-bank'}),rejected=assert.rejects(pending,{name:'AbortError'});
 a.cancelRender();await rejected;assert.equal(signal.aborted,true);
 complete({samples:new Float32Array(4800).fill(.2),sampleRate:48000});await Promise.resolve();
 assert.equal(a.buffer,main);assert.equal(a.context.sources.length,0);await a.close();
});

test('default render stores AudioBuffer, keeps original PCM metadata and scales phrase position',async()=>{const a=await audio();phrase(a);const p=a.render({engine:'sinsy'});const samples=new Float32Array(48000).fill(.2);WorkerMock.all.at(-1).ready(samples);const result=await p;assert.equal(result.samples,samples);assert.equal(result.buffer,a.buffer);assert.equal(a.engine,'sinsy');assert.equal(a.position,.25);assert.equal(a.buffer.duration,1);assert.equal(a.pendingRender,null);await a.close();});

test('store:false and audition preserve main phrase, position, engine and persistent Loop',async()=>{let ended=0;const a=await audio();a.onEnded=()=>ended++;const main=phrase(a);const result=await ready(a);assert.equal(a.buffer,main);assert.equal(a.position,1);assert.equal(a.engine,'flite');assert.equal(a.loop,true);assert.equal(a.audition(result),true);const s=a.auditionSource,g=a.auditionGain;assert.equal(s.buffer,result.buffer);assert.equal(s.loop,false);assert.equal(s.playbackRate.value,1);assert.deepEqual(s.starts,[[]]);assert.deepEqual(g.gain.calls.at(-1),['ramp',.37,10.008]);a.setLoop(false);a.setLoop(true);assert.equal(s.loop,false);s.end();assert.equal(ended,0);assert.equal(a.buffer,main);assert.equal(a.position,1);assert.equal(a.playing,false);assert.equal(a.auditionSource,null);assert.equal(s.disconnected,1);assert.equal(g.disconnected,1);await a.close();});

test('store:false does not stop a playing phrase or replace its source',async()=>{const a=await audio();const main=phrase(a);a.play();const s=a.source;await ready(a);assert.equal(a.source,s);assert.equal(a.buffer,main);assert.equal(a.playing,true);assert.equal(a.position,1);await a.close();});

for(const action of ['pause','play','stopAudition','disable','close'])test(`${action} cancels pending audition render and ignores late worker delivery`,async()=>{const a=await audio();phrase(a);const old=a.buffer;const p=a.render({engine:'sinsy'},{store:false});const rejected=assert.rejects(p,{name:'AbortError'}),worker=WorkerMock.all.at(-1);await a[action]();await rejected;assert.equal(worker.terminated,true);worker.ready();assert.equal(a.buffer,old);assert.equal(a.auditionSource??null,null);assert.equal(a.pendingRender,null);await a.close();});

for(const action of ['pause','play','stopAudition','cancelRender','disable','close'])test(`${action} invalidates completed results before an awaited audition continuation`,async()=>{const a=await audio();phrase(a);const result=await ready(a);await a[action]();const count=a.context?.sources.length;assert.equal(a.audition(result),false);assert.equal(a.context?.sources.length,count);await a.close();});

test('new render cancels the previous render and invalidates earlier completed results',async()=>{const a=await audio();const first=await ready(a);const p=a.render({engine:'sinsy'},{store:false});const rejected=assert.rejects(p,{name:'AbortError'}),oldWorker=WorkerMock.all.at(-1);const latestPromise=a.render({engine:'flite'},{store:false});const latestWorker=WorkerMock.all.at(-1);await rejected;assert.equal(oldWorker.terminated,true);oldWorker.ready();assert.equal(a.audition(first),false);latestWorker.ready();const latest=await latestPromise;assert.equal(a.audition({...latest}),false);assert.equal(a.audition(latest),true);assert.deepEqual(a.auditionGain.gain.calls.at(-1),['ramp',.81,10.008]);assert.equal(a.audition(latest),false);await a.close();});

test('audition never resumes a suspended context or creates a queued source',async()=>{const a=await audio();const result=await ready(a);await a.context.suspend();const before=[unlocked,resumed,a.context.sources.length];assert.equal(a.audition(result),false);assert.deepEqual([unlocked,resumed,a.context.sources.length],before);await a.close();});

test('stopping audition in a suspended context immediately disconnects source and gain',async()=>{const a=await audio();a.audition(await ready(a));const s=a.auditionSource,g=a.auditionGain;await a.context.suspend();a.stopAudition();assert.equal(s.disconnected,1);assert.equal(g.disconnected,1);assert.equal(s.onended,null);assert.equal(a.retiring.size,0);await a.close();});

test('fade cleanup survives suspension before the scheduled source end',async()=>{const a=await audio();a.audition(await ready(a));const s=a.auditionSource,g=a.auditionGain;a.stopAudition();assert.equal(a.retiring.size,1);assert.deepEqual(s.stops[0],[10.012]);assert.deepEqual(g.gain.calls.at(-1),['target',0,10,.002]);await a.context.suspend();await delay(100);assert.equal(a.retiring.size,0);assert.equal(s.disconnected,1);assert.equal(g.disconnected,1);assert.equal(s.onended,null);await a.close();});

test('disable cleans active and retiring auditions without advancing main phrase position',async()=>{const a=await audio();const main=phrase(a);a.audition(await ready(a));const first=a.auditionSource,firstGain=a.auditionGain;a.audition(await ready(a));const second=a.auditionSource,secondGain=a.auditionGain;assert.equal(a.retiring.size,1);await a.disable();assert.equal(a.enabled,false);assert.equal(a.context.state,'suspended');assert.equal(a.retiring.size,0);assert.equal(first.disconnected,1);assert.equal(firstGain.disconnected,1);assert.equal(second.disconnected,1);assert.equal(secondGain.disconnected,1);assert.equal(a.buffer,main);assert.equal(a.position,1);await a.close();});

test('late ended callback from a retired audition cannot clear a new audition',async()=>{const a=await audio();a.audition(await ready(a));const first=a.auditionSource,oldEnded=first.onended;const latest=await ready(a);a.audition(latest);const second=a.auditionSource;oldEnded();assert.equal(a.auditionSource,second);first.end();assert.equal(a.auditionSource,second);await a.close();});

test('a result cannot be auditioned against a replacement AudioContext',async()=>{const a=await audio();const result=await ready(a);a.context=new Context();assert.equal(a.audition(result),false);await a.close();});

test('invalid native output rejects without replacing phrase',async()=>{const a=await audio();const main=phrase(a);const p=a.render({engine:'sinsy'},{store:false});WorkerMock.all.at(-1).ready(new Float32Array([NaN]));await assert.rejects(p,/Invalid native voice output/);assert.equal(a.buffer,main);assert.equal(a.pendingRender,null);await a.close();});

test('unsupported native sample rates are format-converted without transposition',async()=>{const a=await audio();const p=a.render({engine:'sinsy'},{store:false});WorkerMock.all.at(-1).ready(new Float32Array(20).fill(.25),2000);const result=await p;assert.equal(result.sampleRate,2000);assert.equal(result.buffer.sampleRate,48000);assert.equal(result.buffer.duration,.01);a.audition(result);assert.equal(a.auditionSource.playbackRate.value,1);await a.close();});

for(const setup of ['never-enabled','no-context','closed-context'])test(`render checks Audio consent before constructing a Worker: ${setup}`,async()=>{const a=setup==='never-enabled'?new NativeVoiceAudio():await audio();if(setup==='no-context')a.context=null;if(setup==='closed-context')a.context.state='closed';const workers=WorkerMock.all.length;await assert.rejects(a.render({engine:'sinsy'},{store:false}),{name:'NotAllowedError'});assert.equal(WorkerMock.all.length,workers);await a.close();});

test('audition status and natural-end callback stay independent from phrase transport',async()=>{let mainEnded=0,auditionEnded=0;const a=new NativeVoiceAudio({onEnded:()=>mainEnded++,onAuditionEnded:()=>auditionEnded++});await a.enable();phrase(a);assert.equal(a.auditionPlaying,false);a.audition(await ready(a));assert.equal(a.auditionPlaying,true);assert.equal(a.auditioning,true);assert.equal(a.playing,false);a.auditionSource.end();assert.equal(a.auditionPlaying,false);assert.equal(a.auditioning,false);assert.equal(auditionEnded,1);assert.equal(mainEnded,0);a.audition(await ready(a));a.pause();assert.equal(a.auditionPlaying,false);await a.disable();assert.equal(auditionEnded,1);assert.equal(mainEnded,0);await a.close();});


test('explicit offset starts at the selected PCM position and follows the audio clock',async()=>{
 const a=await audio();const main=phrase(a);const before=a.context.sources.length;
 assert.equal(a.play({offset:2.25}),true);
 assert.deepEqual(a.source.starts,[[0,2.25]]);assert.equal(a.context.sources.length,before+1);
 assert.equal(a.source.buffer,main);assert.equal(a.source.loop,true);
 a.context.currentTime+=.5;assert.equal(a.currentPosition(),2.75);await a.close();
});

test('explicit offset takes precedence over restart and preserves final-sample seeks',async()=>{
 const a=await audio();phrase(a);
 a.play({restart:true,offset:3.995});assert.deepEqual(a.source.starts,[[0,3.995]]);
 a.play({offset:100});assert.deepEqual(a.source.starts,[[0,4-1/48000]]);
 assert.equal(a.loop,true);a.play({offset:-10});assert.deepEqual(a.source.starts,[[0,0]]);await a.close();
});

test('rapid seeks replace the old source and its late ended callback cannot stop the latest one',async()=>{
 const a=await audio();phrase(a);a.play({offset:1});const first=a.source,oldEnd=first.onended;
 a.play({offset:2});const second=a.source;a.play({offset:3});const third=a.source;
 assert.deepEqual(third.starts,[[0,3]]);assert.equal(a.playing,true);assert.equal(a.source,third);
 assert.equal(first.stops.length,1);assert.equal(second.stops.length,1);
 oldEnd();first.end();second.end();assert.equal(a.source,third);assert.equal(a.playing,true);await a.close();
});

test('seek cancels a pending phrase render and late PCM cannot replace its playing buffer',async()=>{
 const a=await audio();const main=phrase(a);
 const p=a.render({engine:'sinsy'}),rejected=assert.rejects(p,{name:'AbortError'}),worker=WorkerMock.all.at(-1);
 assert.equal(a.play({offset:2}),true);await rejected;worker.ready();
 assert.equal(worker.terminated,true);assert.equal(a.pendingRender,null);
 assert.equal(a.buffer,main);assert.deepEqual(a.source.starts,[[0,2]]);await a.close();
});

test('seek cancels both pending and sounding note audition without replacing the main phrase',async()=>{
 const a=await audio();const main=phrase(a);a.audition(await ready(a));const audition=a.auditionSource;
 a.play({offset:1.25});assert.equal(a.auditionSource,null);assert.equal(a.buffer,main);assert.equal(audition.stops.length,1);
 const p=a.render({engine:'sinsy'},{store:false}),rejected=assert.rejects(p,{name:'AbortError'}),worker=WorkerMock.all.at(-1);
 a.play({offset:2.5});await rejected;worker.ready();assert.equal(a.auditionSource,null);assert.deepEqual(a.source.starts,[[0,2.5]]);await a.close();
});

test('explicit seek cannot create or arm Audio before consent or resume a suspended context',async()=>{
 const off=new NativeVoiceAudio();const before=[unlocked,resumed,WorkerMock.all.length];
 assert.equal(off.play({offset:1}),false);assert.equal(off.context,null);assert.equal(off.enabled,false);
 assert.deepEqual([unlocked,resumed,WorkerMock.all.length],before);
 const a=await audio();phrase(a);await a.context.suspend();const current=[unlocked,resumed,a.context.sources.length];
 assert.equal(a.play({offset:2}),false);assert.deepEqual([unlocked,resumed,a.context.sources.length],current);assert.equal(a.playing,false);await a.close();
});

test('invalid offsets preserve the current source and natural end still stops only that source',async()=>{
 const a=await audio();phrase(a);a.loop=false;a.play({offset:2});const s=a.source;
 for(const offset of [NaN,Infinity,-Infinity,'1',null])assert.throws(()=>a.play({offset}),/finite/);
 assert.equal(a.source,s);assert.equal(s.stops.length,0);let ended=0;a.onEnded=()=>ended++;
 s.end();assert.equal(a.playing,false);assert.equal(a.position,4);assert.equal(ended,1);await a.close();
});

test('a native start failure clears transport state and retires the failed source',async()=>{
 const a=await audio();phrase(a);const original=a.context.createBufferSource.bind(a.context);
 a.context.createBufferSource=()=>{const source=original();source.start=()=>{throw Error('device suspended during seek');};return source;};
 assert.throws(()=>a.play({offset:1}),/device suspended/);assert.equal(a.playing,false);assert.equal(a.source,null);
 await a.disable();assert.equal(a.retiring.size,0);assert.equal(a.context.sources[0].disconnected,1);await a.close();
});
