import test from 'node:test';
import assert from 'node:assert/strict';
import { createImpulseSource, ImpulseClock, IMPULSE_DEFAULTS, IMPULSE_LIMITS, IMPULSE_MODES,
  sanitizeImpulse, impulseEnvelope } from '../src/instruments/fractal-delay/impulse-source.js';
import { percussionEnvelopeTimeMs } from '../src/audio.js';
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} ≈ ${b}`);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({held=false,allowed=true}={}) {
  const gate=deferred(),pools=[],timers=new Map(),errors=[];
  let context={currentTime:0,state:'running'},target={},playable=allowed,serial=0;
  const source=createImpulseSource({getContext:()=>context,getTarget:()=>target,canPlay:()=>playable,
    onError:error=>errors.push(error),timers:{setInterval(fn){timers.set(++serial,fn);return serial;},clearInterval(id){timers.delete(id);}},
    poolFactory:destination=>{
      const pool={target:destination,enabled:false,notes:[],disabled:0,closed:0,cancelled:0,
        setLevel(){},setTone(){},async enable({context}){pool.context=context;if(held)await gate.promise;pool.enabled=true;},
        disable(){pool.enabled=false;pool.disabled++;},close(){pool.enabled=false;pool.closed++;},
        cancelScheduledNotes(){pool.cancelled++;},scheduleNotes(voices,options){pool.notes.push({voices,...options});}};
      pools.push(pool);return pool;
    }});
  return {source,pools,timers,gate,errors,setAllowed:value=>{playable=value;},
    time:value=>{context.currentTime=value;},tick:()=>[...timers.values()].forEach(fn=>fn()),
    replace:()=>{context.state='closed';context={currentTime:0,state:'running'};target={};}};
}

test('impulse envelopes preserve every displayed stage within the shared four-second domain',()=>{
  const extremes=Object.fromEntries(Object.entries(IMPULSE_LIMITS).map(([key,[,max]])=>[key,max]));
  for(const candidate of [IMPULSE_DEFAULTS,extremes,{...extremes,holdMs:0},{attackMs:NaN,releaseMs:Infinity}]) {
    const p=sanitizeImpulse(candidate),envelope=impulseEnvelope(p),times=envelope.points.map(point=>percussionEnvelopeTimeMs(point.x));
    const expected=[0,p.attackMs,p.attackMs+p.decayMs,p.attackMs+p.decayMs+p.holdMs,
      p.attackMs+p.decayMs+p.holdMs+p.releaseMs];
    times.forEach((time,i)=>near(time,expected[i]));
    near(envelope.duration*1000,expected[4]);assert(expected[4]<=4000);
    assert(times[4]-times[3]>=19.999999);assert.equal(envelope.points.at(-1).y,0);
    assert.deepEqual(sanitizeImpulse(p),p,'state is stable after fitting');
  }
});

test('repeat uses audio-clock beat spacing, preserves phase on tempo changes and skips missed beats',()=>{
  const clock=new ImpulseClock(120,0);assert.deepEqual(clock.read(0),[.012]);
  assert.deepEqual(clock.read(.1),[]);near(clock.read(.45)[0],.512);
  clock.setTempo(240,.762);near(clock.phaseAt(.762),1.5);near(clock.read(.81)[0],.887);
  const afterStall=clock.read(5);assert(afterStall.length<=1);assert(afterStall.every(at=>at>=5.004&&at<=5.085));
  assert.deepEqual(clock.read(5),[],'never schedule the same beat twice');
});

test('Play/settings/Send never create a synth or AudioContext while Audio is off',async()=>{
  const f=fixture({allowed:false});f.source.setParameters({tempo:140,mode:'pm'});
  await f.source.setPlaying(true);assert.equal(await f.source.send(),false);
  assert.equal(f.pools.length,0);assert.equal(f.timers.size,0);
  f.setAllowed(true);await f.source.enable();assert.equal(f.pools.length,1);assert.equal(f.timers.size,1);
  await f.source.enable();assert.equal(f.timers.size,1);assert.equal(f.pools[0].notes.length,1);
  await f.source.dispose();assert.equal(f.timers.size,0);assert.equal(f.pools[0].closed,1);
});

test('Send uses all shared sound modes and overlapping tails retain their actual end time',async()=>{
  const f=fixture();
  for(const mode of IMPULSE_MODES) {f.source.setParameters({mode});assert(await f.source.send());assert.equal(f.pools[0].notes.at(-1).mode,mode);}
  f.source.setParameters({holdMs:2000});await f.source.send();
  f.time(.2);f.source.setParameters({holdMs:0});await f.source.send();f.time(1);
  assert.equal(f.source.snapshot().sounding,true,'shorter new notes do not hide an existing tail');
  f.source.disable();await f.source.enable();assert.equal(f.source.snapshot().sounding,false,'Audio restart has no phantom old note');
  await f.source.dispose();
});

test('obsolete startup and queued Send cannot resurrect after Audio/source off and back',async()=>{
  const f=fixture({held:true});const first=f.source.send();await flush();const waiting=f.source.send();
  f.source.disable();f.setAllowed(false);f.setAllowed(true);const fresh=f.source.enable();
  f.gate.resolve();assert.equal(await first,false);assert.equal(await waiting,false);assert.equal(await fresh,true);
  assert.equal(f.pools[0].notes.length,0);assert.equal(f.source.snapshot().playing,false);
  assert(await f.source.send());assert.equal(f.pools[0].notes.length,1);await f.source.dispose();
});

test('startup failure clears repeat intent and allows a later retry',async()=>{
  const f=fixture({held:true});const pending=f.source.setPlaying(true);await flush();
  f.gate.reject(new Error('worklet unavailable'));await pending;
  assert.equal(f.source.snapshot().playing,false);assert.equal(f.source.snapshot().pending,false);
  assert.equal(f.timers.size,0);assert.equal(f.errors.length,1);await f.source.dispose();
});

test('dispose cancels held startup without closing the borrowed AudioContext or starting a timer',async()=>{
  const f=fixture({held:true});const pending=f.source.setPlaying(true);await flush();
  await f.source.dispose();f.gate.resolve();await pending;
  assert.equal(f.timers.size,0);assert.equal(f.pools[0].closed,1);assert.equal(f.pools[0].enabled,false);
  assert.equal(f.pools[0].context.state,'running');assert.equal(f.pools[0].notes.length,0);
});

test('context recovery replaces the pool and routes only to the new network node',async()=>{
  const f=fixture();await f.source.enable();f.replace();await f.source.enable();
  assert.equal(f.pools.length,2);assert.equal(f.pools[0].closed,1);assert.notEqual(f.pools[0].target,f.pools[1].target);
  await f.source.send();assert.equal(f.pools[0].notes.length,0);assert.equal(f.pools[1].notes.length,1);await f.source.dispose();
});

test('tempo edits retain one timer; Pause cancels future starts and permits current tails',async()=>{
  const f=fixture();await f.source.setPlaying(true);f.time(.5);f.source.setParameters({tempo:240});
  f.time(.57);f.tick();const notes=f.pools[0].notes;
  near(notes[1].startAt,.628);assert.equal(f.timers.size,1);
  await f.source.setPlaying(false);const count=notes.length;f.time(2);f.tick();assert.equal(notes.length,count);
  assert.equal(f.timers.size,0);assert.equal(f.pools[0].enabled,true);assert(f.pools[0].cancelled>0);await f.source.dispose();
});
