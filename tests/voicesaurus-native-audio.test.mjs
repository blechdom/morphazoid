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
class Node{connections=[];disconnected=0;connect(node){this.connections.push(node);return node;}disconnect(){this.disconnected++;this.connections=[];}}
class Gain extends Node{gain=new Param();}
class Buffer{constructor(channels,frames,sampleRate){this.length=frames;this.sampleRate=sampleRate;this.duration=frames/sampleRate;this.samples=new Float32Array(frames);}copyToChannel(samples){this.samples.set(samples);}getChannelData(){return this.samples;}}
class Source extends Node{loop=false;onended=null;starts=[];stops=[];playbackRate={value:1};start(...args){this.starts.push(args);}stop(...args){this.stops.push(args);}end(){this.onended?.();}}
class Context{state='running';sampleRate=48000;currentTime=10;sources=[];gains=[];createGain(){const gain=new Gain();this.gains.push(gain);return gain;}createAnalyser(){return new Node();}createBuffer(...args){return new Buffer(...args);}createBufferSource(){const s=new Source();this.sources.push(s);return s;}async suspend(){this.state='suspended';}async close(){this.state='closed';}}
class WorkerMock{static all=[];terminated=false;constructor(url){this.url=url;WorkerMock.all.push(this);}postMessage(request){this.request=request;}terminate(){this.terminated=true;}ready(samples=new Float32Array(4800).fill(.1),sampleRate=48000){this.onmessage?.({data:{type:'ready',samples,sampleRate}});}}
let unlocked=0,resumed=0;
globalThis.AudioContext=Context;globalThis.Worker=WorkerMock;
globalThis[dependencyKey]={resumeAudioContext:async c=>{resumed++;c.state='running';},unlockAudioContext:()=>unlocked++,connectSpellingOutput:()=>({release(){}}),NATIVE_OUTPUT_TRIMS:{sinsy:.37,flite:.81}};
let NativeVoiceAudio;
try { ({NativeVoiceAudio} = await import(fixtureUrl.href)); }
catch (error) { await fs.rm(temporaryDirectory, {recursive:true,force:true}); throw error; }
async function audio(){const a=new NativeVoiceAudio();await a.enable();return a;}
async function ready(a,{store=false,engine='sinsy'}={}){const promise=a.render({engine},{store});const worker=WorkerMock.all.at(-1);worker.ready();return promise;}
function phrase(a){a.buffer=new Buffer(1,192000,48000);a.position=1;a.engine='flite';a.loop=true;return a.buffer;}

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
