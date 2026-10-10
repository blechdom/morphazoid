import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createWasmNetwork, estimateSceneBytes } from '../src/instruments/fractal-delay/wasm-runtime.js';
import { buildNetwork, DEFAULT_PARAMETERS, MODES } from '../src/instruments/fractal-delay/model.js';
const bytes = await readFile(new URL('../assets/wasm/fractal-delay.wasm', import.meta.url));
const module = await WebAssembly.compile(bytes);
const RATE = 48000, BLOCK = 128, zero = new Float32Array(BLOCK);
const transparent = { inputDriveDb: 0, delayGainDb: 0, dry: 0, wet: 1, hpfHz: 0, lpfHz: 22000, compressorRatio: 1, outputBoostDb: 0, outputLevel: 1 };
function graph(edges, nodeCount, pickupNode = nodeCount-1) {
  return { nodes: Array.from({length:nodeCount},(_,id)=>({id,x:0,y:0})), edges: edges.map(([a,b,length],id)=>({id,a,b,length})),inputNode:0,pickupNode };
}
function render(e, blocks, signal = null) {
  const pcm = new Float32Array(blocks * BLOCK);
  for (let block=0;block<blocks;block++) { const input=signal?.(block)||zero; const out=e.process(input);pcm.set(out.left,block*BLOCK); }
  return pcm;
}
function energy(pcm) { return pcm.reduce((sum,value)=>sum+value*value,0); }
function finite(pcm) { assert(pcm.every(value=>Number.isFinite(value)&&Math.abs(value)<=.940001)); }
function initialize(scene, parameters = {}, performance = {}) {
  const e=createWasmNetwork(module,RATE);e.controls({timeMs:10,coupling:1,decay:1,...parameters},{...transparent,...performance},'media');
  render(e,240);e.prepareScene(scene); return e;
}
const impulse = block => { if(block)return zero; const sample=zero.slice();sample[0]=.1;return sample; };

test('Rust artifact has zero imports, ABI1 and current reproducible source provenance',()=>{
  assert.deepEqual(WebAssembly.Module.imports(module),[]);
  const checked=spawnSync(process.execPath,['scripts/build-fractal-delay-wasm.mjs','--check'],{encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);
});
test('private histories reserve exact reported memory including live geometry headroom',()=>{
  const scene=graph([[0,1,.1],[1,2,.2]],3);const e=initialize(scene);
  try { assert.equal(e.status().requiredDelayBytes,estimateSceneBytes(scene,RATE)); }
  finally{e.dispose();}
});
test('negative output Boost accepted by the UI attenuates actual PCM without changing propagation',()=>{
  const scene=graph([[0,1,.1]],2);
  const attenuated=initialize(scene,{}, {outputBoostDb:-12});
  const equivalent=initialize(scene,{}, {outputLevel:10**(-12/20)});
  try{
    assert.throws(()=>attenuated.controls({}, {outputBoostDb:-12.01}), /Invalid mastering parameters/);
    const stimulus=block=>Float32Array.from({length:BLOCK},(_,i)=>.02*Math.sin(2*Math.PI*173*(block*BLOCK+i)/RATE));
    const a=render(attenuated,160,stimulus),b=render(equivalent,160,stimulus);
    finite(a);assert(energy(a)>1e-5,'negative Boost must retain a real delayed signal');
    assert(a.every((value,i)=>Math.abs(value-b[i])<1e-7),'Boost attenuation is equivalent to the same post-master output scaling');
    assert.equal(attenuated.status().sampleClock,equivalent.status().sampleClock);
    assert.equal(attenuated.status().preparedEdges,equivalent.status().preparedEdges);
  }finally{attenuated.dispose();equivalent.dispose();}
});
test('single edge has true geometric transit and repeated two-way round-trip reflections',()=>{
  const e=initialize(graph([[0,1,.1]],2));
  try { const pcm=render(e,6,impulse);finite(pcm);
    const first=pcm.findIndex(value=>Math.abs(value)>1e-4);
    assert(Math.abs(first-48)<=1,`expected48samples travel, actual${first}`);
    assert(pcm.slice(140,148).some(value=>Math.abs(value)>.04),'secondarrival after actual roundtrip');
    assert(pcm.slice(236,244).some(value=>Math.abs(value)>.04),'thirdarrival repeats without external input');
  } finally{e.dispose();}
});
test('connected chain onset follows SUM of traversed edge lengths, not shared raw input taps',()=>{
  const scene=graph([[0,1,.1],[1,2,.2]],3);const e=initialize(scene);
  try {const pcm=render(e,8,impulse);const first=pcm.findIndex(v=>Math.abs(v)>1e-4);
    assert(Math.abs(first-144)<=1,`expected144samples sequentialtravel, actual${first}`);
    assert(pcm.slice(0,140).every(v=>Math.abs(v)<1e-8),'pickupneverhearsinputbeforetravellingbothconnections');finite(pcm);
  }finally{e.dispose();}
});
test('all five actual fractal model graphs have distinct audible pressure responses',()=>{
  const responses=[];
  for(const {id} of MODES){ const p={...DEFAULT_PARAMETERS,mode:id,detail:4,timeMs:6,coupling:1,decay:.98,
    ...(id==='membrane'?{cReal:0,cImag:0,detail:6}:{}),...(id==='orbits'?{cReal:-1,cImag:0}:{})};
    const scene=buildNetwork(p,64);const e=initialize(scene,p);
    try {const pcm=render(e,400,impulse);finite(pcm);assert(energy(pcm)>1e-8,`${id} actualpickupisnonzero`);
      assert.equal(e.status().activeEdges,scene.edges.length);assert.equal(e.status().revision,1);
      responses.push(pcm);
    }finally{e.dispose();}
  }
  for(let i=0;i<responses.length;i++)for(let j=i+1;j<responses.length;j++){
    const difference=responses[i].reduce((sum,value,k)=>sum+(value-responses[j][k])**2,0);
    assert(difference>1e-7,`${MODES[i].id} and ${MODES[j].id} shareidenticalresponse`);
  }
});
test('PCM geometry edits preserve clock, private history and existing phase',()=>{
  const scene=graph([[0,1,.1]],2);const e=initialize(scene);
  try {render(e,1,impulse);const before=e.status();
    e.beginScene({...scene,nodes:[{id:0,x:-.1,y:0},{id:1,x:.1,y:0}],edges:[{id:0,a:0,b:1,length:.105}]},8);
    assert.equal(e.prepareStep(1),2);const after=e.status();
    assert.equal(after.sampleClock,before.sampleClock);assert.equal(after.requiredDelayBytes,before.requiredDelayBytes);assert.equal(after.releasingEdges,0);
    assert.equal(after.revision,8);assert(energy(render(e,8))>1e-6,'previousinputcontinuesintheeditedwaveguide');
  }finally{e.dispose();}
});
test('complete graph installs atomically while old graph keeps rendering',()=>{
  const e=initialize(graph([[0,1,.1]],2));
  try {render(e,1,impulse);const next=graph([[0,1,.1],[1,2,.1],[1,3,.2]],4);
    e.beginScene(next,12);assert.equal(e.prepareStep(1),1);assert.equal(e.status().activeEdges,1);
    const during=render(e,1);assert(energy(during)>1e-7,'oldwavesrenderduringpreparation');
    assert.equal(e.prepareStep(1),1);assert.equal(e.status().activeEdges,1);
    while(e.prepareStep(1)===1){assert.equal(e.status().activeEdges,1); }assert.equal(e.status().activeEdges,3);assert.equal(e.status().revision,12);
    assert.equal(e.status().releasingEdges,1);finite(render(e,40));e.collect(20);assert.equal(e.status().releasingEdges,0);
  }finally{e.dispose();}
});
test('live travel/coupling/decay/pitch controls leave clock and prepared graph intact',()=>{
  const e=initialize(graph([[0,1,.1],[1,2,.15]],3),{decay:.96});
  try {render(e,240,block=>Float32Array.from({length:BLOCK},(_,i)=>.04*Math.sin(2*Math.PI*173*(block*BLOCK+i)/RATE)));
    const before=e.status(), allocation=e.api.memory.buffer.byteLength;
    e.controls({timeMs:.05,coupling:.65,boundary:.3,decay:.9,pitchOffset:12});
    assert.equal(e.status().sampleClock,before.sampleClock);const pcm=render(e,240);finite(pcm);
    assert(energy(pcm)>1e-9,'liveeditpreservesexistingreverberation');
    const after=e.status();assert.equal(after.revision,before.revision);assert.equal(after.activeEdges,before.activeEdges);
    assert.equal(e.api.memory.buffer.byteLength,allocation,'nohistoryallocationwhilelivefoldmoves');
    assert(after.timeMs<.051);assert.equal(after.pitchOffset,12);
  }finally{e.dispose();}
});
test('actual spatial wave telemetry is silent with silence and contains travelling PCM after input',()=>{
  const e=initialize(graph([[0,1,.8]],2),{timeMs:20});
  try {const silent=e.status();assert(silent.edgeWaveforms.every(v=>v===0));render(e,3,block=>block?zero:Float32Array.from({length:BLOCK},(_,i)=>.1*Math.sin(2*Math.PI*i/32)));
    const live=e.status();assert.equal(live.edgeWaveforms.length,32);assert.equal(live.waveformSize,32);
    assert(live.edgeLevels[0]>0);assert(live.edgeWaveforms.some(v=>Math.abs(v)>1e-5),'actualdelayringwaveappearsalongedge');
  }finally{e.dispose();}
});
test('media unity is immediate and independent of mic trim, while microphone trim remains audible',()=>{
  const scene=graph([[0,1,.1]],2),a=initialize(scene),b=initialize(scene);
  try {a.controls({}, {inputGain:0,dry:1,wet:0},'mic');b.controls({}, {inputGain:4,dry:1,wet:0},'mic');render(a,240);render(b,240);
    a.controls({}, {},'media');b.controls({}, {},'media');const wave=Float32Array.from({length:BLOCK},(_,i)=>.03*Math.sin(2*Math.PI*321*i/RATE));
    const pa=a.process(wave).left.slice(),pb=b.process(wave).left.slice();assert.deepEqual(pa,pb,'firstmediablockignoresstoredmicgain');
    a.controls({}, {},'mic');b.controls({}, {},'mic');render(a,240);render(b,240);
    const mute=a.process(wave).left.slice(),loud=b.process(wave).left.slice();assert(energy(loud)>energy(mute)*1e8);
  }finally{a.dispose();b.dispose();}
});

test('network drive raises actual travelling pressure in dB while direct stereo remains independent',()=>{
  const scene=graph([[0,1,.1]],2),gains=[-12,0,12,24];
  const wet=gains.map(inputDriveDb=>initialize(scene,{boundary:0,decay:.7},{inputDriveDb}));
  const direct=[-12,24].map(inputDriveDb=>initialize(scene,{boundary:0,decay:.7},{inputDriveDb,wet:0,dry:1}));
  const source=new Float32Array(BLOCK).fill(.001);
  try {
    const responses=wet.map(engine=>render(engine,8,()=>source)),reference=energy(responses[1]);
    assert(reference>1e-8,'the unamplified network really carries the source');
    const levels=wet.map(engine=>engine.status().edgeLevels[0]);
    assert(levels[1]>0,'pressure telemetry comes from the actual delay history');
    responses.forEach((pcm,i)=>{
      finite(pcm);
      const expected=10**(gains[i]/20),measured=Math.sqrt(energy(pcm)/reference);
      assert(Math.abs(measured/expected-1)<.001,`${gains[i]} dB excitation expected ${expected}, measured ${measured}`);
      assert(Math.abs(levels[i]/levels[1]/expected-1)<.00001,'drive amplifies travelling pressure, not just the final wet mix');
      assert.equal(pcm.findIndex(value=>Math.abs(value)>1e-6),responses[1].findIndex(value=>Math.abs(value)>1e-6),'network drive retains geometric onset');
      assert.equal(wet[i].status().inputPeak,wet[1].status().inputPeak,'source metering remains before network amplification');
    });
    direct.forEach(engine=>render(engine,480));
    for(let block=0;block<24;block++){
      const left=Float32Array.from({length:BLOCK},(_,i)=>.03*Math.sin(2*Math.PI*173*(block*BLOCK+i)/RATE));
      const right=Float32Array.from({length:BLOCK},(_,i)=>.02*Math.sin(2*Math.PI*311*(block*BLOCK+i)/RATE));
      const a=direct[0].process(left,right),b=direct[1].process(left,right);
      assert.deepEqual(a.left,b.left,'network drive does not amplify direct left playback');
      assert.deepEqual(a.right,b.right,'network drive does not amplify direct right playback');
      assert(energy(a.left)>1e-6);finite(a.left);finite(a.right);
    }
    assert(direct[1].status().edgeLevels[0]>direct[0].status().edgeLevels[0]*50,'direct unity is independent even when network pressure is much greater');
  } finally {[...wet,...direct].forEach(engine=>engine.dispose());}
});

test('live network drive preserves old tails and smoothly changes new injection without reallocating or resetting',()=>{
  const scene=graph([[0,1,.1],[1,2,.2]],3),reference=initialize(scene,{decay:.85}),changed=initialize(scene,{decay:.85});
  const source=new Float32Array(BLOCK).fill(.001);
  try {
    for(let n=0;n<240;n++){reference.process(source);changed.process(source);}
    const before=changed.status(),allocation=changed.api.memory.buffer.byteLength;
    changed.controls({}, {inputDriveDb:24});
    assert.equal(changed.status().sampleClock,before.sampleClock);assert.equal(changed.status().revision,before.revision);
    const oldTail=render(reference,120),editedTail=render(changed,120);
    assert(energy(oldTail)>1e-6,'a real feedback tail remains after the external source stops');
    assert.deepEqual(editedTail,oldTail,'network drive does not repeatedly amplify or erase returning waves');
    assert.deepEqual(changed.status().edgeWaveforms,reference.status().edgeWaveforms);
    changed.controls({}, {inputDriveDb:0});render(reference,480);render(changed,480);
    for(let n=0;n<240;n++){reference.process(source);changed.process(source);}
    const rampBefore=changed.status();changed.controls({}, {inputDriveDb:12});
    assert.equal(changed.status().sampleClock,rampBefore.sampleClock);
    const old=reference.process(source).left.slice(),first=changed.process(source).left.slice();finite(first);
    assert(Math.abs(first[0]-old[0])<1e-8,'drive changes cannot jump directly into the existing receiver waveform');
    for(let n=0;n<360;n++){reference.process(source);changed.process(source);}
    const a=reference.process(source).left.slice(),b=changed.process(source).left.slice();
    const measured=Math.sqrt(energy(b)/energy(a));
    assert(Math.abs(measured/(10**(.6))-1)<.01,'smoothed new excitation settles to the requested drive');
    const after=changed.status();
    assert.equal(after.sampleClock,rampBefore.sampleClock+362*BLOCK);
    assert.equal(after.sampleClock,reference.status().sampleClock);assert.equal(after.revision,before.revision);
    assert.equal(after.activeEdges,before.activeEdges);assert.equal(after.requiredDelayBytes,before.requiredDelayBytes);
    assert.equal(after.releasingEdges,0);assert.equal(changed.api.memory.buffer.byteLength,allocation);
    changed.controls({}, {inputDriveDb:24,delayGainDb:48});
    const hot=new Float32Array(BLOCK).fill(.2);let peak=0;
    for(let n=0;n<240;n++){
      const output=changed.process(hot);finite(output.left);finite(output.right);
      peak=Math.max(peak,...output.left.map(Math.abs),...output.right.map(Math.abs));
    }
    assert(peak>.8,'maximum drive and receiver amplification reach the real output limiter');
    for(const inputDriveDb of [-12.1,24.1,NaN,Infinity])
      assert.throws(()=>changed.controls({}, {inputDriveDb}),/Invalid|invalid|controls/);
    assert.equal(changed.status().revision,before.revision);assert.equal(changed.status().activeEdges,before.activeEdges);
  } finally {reference.dispose();changed.dispose();}
});

test('receiver gain scales wet pressure in dB while the dry source remains exactly independent',()=>{
  const scene=graph([[0,1,.1]],2),gains=[-12,0,12];
  const wet=gains.map(delayGainDb=>initialize(scene,{boundary:0,decay:.7},{delayGainDb}));
  const dry=[-12,48].map(delayGainDb=>initialize(scene,{boundary:0,decay:.7},{delayGainDb,wet:0,dry:1}));
  const quietImpulse=block=>{const input=zero.slice();if(!block)input[0]=.001;return input;};
  try {
    const responses=wet.map(engine=>render(engine,8,quietImpulse)),reference=energy(responses[1]);
    assert(reference>1e-10,'reference wet signal is genuinely nonzero');
    responses.forEach((pcm,i)=>{
      finite(pcm);
      const measured=Math.sqrt(energy(pcm)/reference),expected=10**(gains[i]/20);
      assert(Math.abs(measured/expected-1)<.001,`${gains[i]} dB receiver gain expected ${expected}, measured ${measured}`);
      assert.equal(pcm.findIndex(value=>Math.abs(value)>1e-6),responses[1].findIndex(value=>Math.abs(value)>1e-6),'gain preserves geometric onset');
    });
    // Give the wet follower enough silent audio frames to reach exact zero,
    // then compare identical real media input across the full gain range.
    dry.forEach(engine=>render(engine,480));
    const source=block=>Float32Array.from({length:BLOCK},(_,i)=>.03*Math.sin(2*Math.PI*173*(block*BLOCK+i)/RATE));
    const a=render(dry[0],24,source),b=render(dry[1],24,source);
    assert(energy(a)>1e-6);assert.deepEqual(a,b,'Delay gain never amplifies or otherwise changes the dry path');finite(a);finite(b);
  } finally {[...wet,...dry].forEach(engine=>engine.dispose());}
});

test('live receiver gain ramps without rebuilding histories, changing feedback or resetting the sample clock',()=>{
  const scene=graph([[0,1,.1],[1,2,.2]],3),reference=initialize(scene,{decay:.85}),changed=initialize(scene,{decay:.85});
  const source=new Float32Array(BLOCK).fill(.001);
  try {
    for(let n=0;n<240;n++){reference.process(source);changed.process(source);}
    const before=changed.status(),allocation=changed.api.memory.buffer.byteLength;
    changed.controls({}, {delayGainDb:12});
    assert.equal(changed.status().sampleClock,before.sampleClock);assert.equal(changed.status().revision,before.revision);
    const old=reference.process(source).left.slice(),first=changed.process(source).left.slice();finite(first);
    assert(Math.abs(first[0]/old[0]-1)<.01,'the first sample follows the 35 ms gain ramp instead of jumping by 12 dB');
    for(let n=0;n<360;n++){reference.process(source);changed.process(source);}
    const a=reference.process(source).left.slice(),b=changed.process(source).left.slice();
    const measured=Math.sqrt(energy(b)/energy(a));assert(Math.abs(measured/(10**(.6))-1)<.01,'live gain settles to the requested receiver amplification');
    const after=changed.status(),control=reference.status();
    assert.equal(after.sampleClock,before.sampleClock+362*BLOCK);assert.equal(after.sampleClock,control.sampleClock);
    assert.equal(after.revision,before.revision);assert.equal(after.activeEdges,before.activeEdges);
    assert.equal(after.requiredDelayBytes,before.requiredDelayBytes);assert.equal(after.releasingEdges,0);
    assert.equal(changed.api.memory.buffer.byteLength,allocation);
    assert.deepEqual(after.edgeLevels,control.edgeLevels,'receiver amplification does not feed into graph energy');
    assert.deepEqual(after.edgeWaveforms,control.edgeWaveforms,'raw travelling waves remain unchanged');
    changed.controls({}, {delayGainDb:48});
    const hot=new Float32Array(BLOCK).fill(.2);let peak=0;
    for(let n=0;n<240;n++){
      const output=changed.process(hot);finite(output.left);finite(output.right);
      peak=Math.max(peak,...output.left.map(Math.abs),...output.right.map(Math.abs));
    }
    assert(peak>.8,'extreme receiver amplification reaches the real output limiter');
    assert.equal(changed.status().revision,before.revision);assert.equal(changed.status().activeEdges,before.activeEdges);
    for(const delayGainDb of [-12.1,48.1,NaN,Infinity])assert.throws(()=>changed.controls({}, {delayGainDb}),/Invalid|invalid|controls/);
  } finally {reference.dispose();changed.dispose();}
});
test('invalid complete graph or controls reject transaction without damaging current audio',()=>{
  const e=initialize(graph([[0,1,.1]],2));
  try {const before=e.status();assert.throws(()=>e.beginScene(graph([[0,8,.1]],2),3),/Invalid/);
    assert.throws(()=>e.controls({timeMs:120},{outputLevel:3}),/Invalid/);assert.equal(e.status().timeTargetMs,before.timeTargetMs);
    assert.throws(()=>e.beginScene({...graph([[0,1,1]],2),memoryBudgetBytes:100},3),/memorybudget|memory budget/);
    assert.equal(e.status().activeEdges,1);finite(render(e,5,impulse));
  }finally{e.dispose();}
});
test('untrusted nonfinite audio is contained and subsequent audio remains finite',()=>{
  const e=initialize(graph([[0,1,.1]],2));
  try {const invalid=Float32Array.from({length:BLOCK},(_,i)=>i%2?NaN:Infinity);finite(e.process(invalid).left);finite(render(e,10,impulse));}
  finally{e.dispose();}
});

test('wet transposition changes actual PCM frequency without retuning geometric travel',()=>{
  const e=initialize(graph([[0,1,.01]],2),{decay:.6,pitchOffset:12});
  try {let frame=0;const signal=()=>Float32Array.from({length:BLOCK},()=>.025*Math.sin(2*Math.PI*173*frame++/RATE));
    render(e,600,signal);const pcm=render(e,64,signal);finite(pcm);
    const spectralPower=frequency=>{let real=0,imag=0;for(let i=0;i<pcm.length;i++){
      const window=.5-.5*Math.cos(2*Math.PI*i/(pcm.length-1));const angle=2*Math.PI*frequency*i/RATE;
      real+=pcm[i]*window*Math.cos(angle);imag+=pcm[i]*window*Math.sin(angle);}
      return real*real+imag*imag;};
    assert(spectralPower(346)>spectralPower(173)*20,'octaveuppitchhasdominant346HzPCM');
    assert.equal(e.status().timeTargetMs,10);assert.equal(e.status().activeEdges,1);assert.equal(e.status().revision,1);
  }finally{e.dispose();}
});

test('real worklet runs scenes and media input, coalesces superseded preparation and disposes',async()=>{
  const before={AudioWorkletProcessor:globalThis.AudioWorkletProcessor,sampleRate:globalThis.sampleRate,registerProcessor:globalThis.registerProcessor};
  let Processor;
  globalThis.sampleRate=RATE;
  globalThis.AudioWorkletProcessor=class { constructor(){this.messages=[];this.port={postMessage:message=>this.messages.push(message),onmessage:null};} };
  globalThis.registerProcessor=(name,implementation)=>{assert.equal(name,'fractal-delay-network');Processor=implementation;};
  try {
    await import('../src/instruments/fractal-delay/network-worklet.js');
    const processor=new Processor({processorOptions:{module}}),out=[new Float32Array(BLOCK),new Float32Array(BLOCK)];
    assert.equal(processor.messages[0].type,'ready');
    processor.message({type:'scene',id:21,revision:21,scene:graph([[0,1,2],[1,2,2]],3),parameters:{timeMs:10},performance:transparent,inputMode:'media'});
    processor.process([[zero]],[out]);assert.equal(processor.network.status().activeEdges,0);
    processor.message({type:'scene',id:22,revision:22,scene:graph([[0,1,.1]],2),parameters:{timeMs:10}});
    assert(processor.messages.some(message=>message.id===21&&message.superseded));
    for(let block=0;block<40&&!processor.messages.some(message=>message.id===22&&message.installed);block++)processor.process([[zero]],[out]);assert(processor.messages.some(message=>message.id===22&&message.installed));
    for(let i=0;i<240;i++)processor.process([[zero]],[out]);
    processor.process([[impulse(0)]],[out]);finite(out[0]);assert(energy(out[0])>1e-7);
    processor.message({type:'status',id:23});const status=processor.messages.find(message=>message.id===23).status;
    assert.equal(status.revision,22);assert.equal(status.activeEdges,1);assert.equal(status.edgeWaveforms.length,32);
    assert(status.sampleClock>0);assert.equal(status.failure,false);
    processor.message({type:'dispose',id:24});assert.equal(processor.process([[zero]],[out]),false);assert(out[0].every(value=>value===0));
  }finally{for(const [key,value] of Object.entries(before)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('long preparation keeps shared edge histories at the current audio clock, with no stale replay at commit',()=>{
  const scene=graph([[0,1,.1]],2),a=initialize(scene),b=initialize(scene);
  try{let frame=0;const signal=()=>Float32Array.from({length:BLOCK},()=>.04*Math.sin(2*Math.PI*173*frame++/RATE));
    for(let block=0;block<240;block++){const input=signal();a.process(input);b.process(input);}
    const next={nodes:[...scene.nodes],edges:[...scene.edges],inputNode:0,pickupNode:1};
    for(let i=0;i<64;i++){const n=next.nodes.length;next.nodes.push({id:n,x:0,y:0},{id:n+1,x:0,y:0});next.edges.push({id:100+i,a:n,b:n+1,length:.1});}
    b.beginScene(next,9);assert.equal(b.prepareStep(1),1);
    // Longer than the reserved original edge history: an early snapshot would
    // otherwise commit stale waves from more than one complete ring ago.
    for(let block=0;block<640;block++){const input=signal();a.process(input);b.process(input);}
    while(b.prepareStep(128)===1){}assert.equal(b.status().revision,9);
    let largest=0;for(let block=0;block<128;block++){const input=signal(),pa=a.process(input).left,pb=b.process(input).left;
      for(let i=0;i<BLOCK;i++)largest=Math.max(largest,Math.abs(pa[i]-pb[i]));}
    assert(largest<1e-6,`sharedwavehistorymustnotreplayanoldphase, maxPCMdifference${largest}`);
  }finally{a.dispose();b.dispose();}
});

test('prewarmed arena contains private history initialization without live memory growth',()=>{
 const e=createWasmNetwork(module,RATE);try{const before=e.api.memory.buffer.byteLength;e.reserveMemory(64*1024*1024);
   assert(e.api.memory.buffer.byteLength>=64*1024*1024&&e.api.memory.buffer.byteLength>before,'reservedlineararenaexistsbeforeplayback');
   const reserved=e.api.memory.buffer.byteLength;e.prepareScene(graph([[0,1,2]],2));assert.equal(e.api.memory.buffer.byteLength,reserved);
 }finally{e.dispose();}
});
test('moving pickup smooths pressure from both real junctions without resetting their histories',()=>{
 const scene=graph([[0,1,.1],[1,2,.2]],3),a=initialize(scene),b=initialize(scene);
 try{let frame=0;const signal=()=>Float32Array.from({length:BLOCK},()=>.07*Math.sin(2*Math.PI*173*frame++/RATE));
   for(let n=0;n<300;n++){const input=signal();a.process(input);b.process(input);}
   const clock=b.status().sampleClock;b.beginScene({...scene,pickupNode:1},8);assert.equal(b.prepareStep(1),2);
   assert.equal(b.status().sampleClock,clock);assert.equal(b.status().releasingEdges,0);
   const input=signal(),pa=a.process(input).left.slice(),pb=b.process(input).left.slice();
   assert(Math.abs(pa[0]-pb[0])<.001,`firstreceiverchangeisasmallsmoothedstep (${Math.abs(pa[0]-pb[0])})`);
   for(let n=0;n<240;n++){const input=signal();a.process(input);b.process(input);}
   const last=signal(),old=a.process(last).left.slice(),moved=b.process(last).left.slice();
   assert(old.some((value,i)=>Math.abs(value-moved[i])>.01),'newrealpickupissubstantiallyaudibleafteritsfade');finite(moved);
 }finally{a.dispose();b.dispose();}
});

test('rapid preset changes wait for prior graph retirement and retain only the latest queued scene',async()=>{
 const before={AudioWorkletProcessor:globalThis.AudioWorkletProcessor,sampleRate:globalThis.sampleRate,registerProcessor:globalThis.registerProcessor};
 let Processor;globalThis.sampleRate=RATE;
 globalThis.AudioWorkletProcessor=class{constructor(){this.messages=[];this.port={postMessage:value=>this.messages.push(value),onmessage:null};}};
 globalThis.registerProcessor=(_,value)=>{Processor=value;};
 try{await import('../src/instruments/fractal-delay/network-worklet.js?retirement');
   const p=new Processor({processorOptions:{module,memoryReserveBytes:32*1024*1024}}),out=[new Float32Array(BLOCK),new Float32Array(BLOCK)];
   const sceneFor=id=>{const scene=graph([[0,1,.1]],2);scene.edges[0].id=id;return scene;};
   const install=id=>{p.message({type:'scene',id,revision:id,scene:sceneFor(id)});let count=0;
     while(!p.messages.some(message=>message.id===id&&message.installed)&&count++<200)p.process([[zero]],[out]);
     assert(count<200,`scene${id}finished`);};
   install(101);install(102);assert.equal(p.network.retiredCount(),1,'previousgraphisstillcrossfading');
   p.message({type:'scene',id:103,revision:103,scene:sceneFor(103)});p.process([[zero]],[out]);assert.equal(p.network.status().revision,102);
   assert.equal(p.pending,null,'athirdgraphdoesnotallocatewhilepreviousgraphstillownsitsrings');
   p.message({type:'scene',id:104,revision:104,scene:sceneFor(104)});assert(p.messages.some(message=>message.id===103&&message.superseded));
   for(let n=0;n<100&&!p.messages.some(message=>message.id===104&&message.installed);n++){
     p.process([[zero]],[out]);assert(p.network.retiredCount()<=1,'retiredgraphsneverpileup');}
   assert(p.messages.some(message=>message.id===104&&message.installed));assert.equal(p.network.status().revision,104);
   p.message({type:'dispose',id:105});
 }finally{for(const [key,value]of Object.entries(before)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('an overloaded current graph can still switch to a lighter queued scene',async()=>{
 const before={AudioWorkletProcessor:globalThis.AudioWorkletProcessor,sampleRate:globalThis.sampleRate,registerProcessor:globalThis.registerProcessor};
 const clockDescriptor=Object.getOwnPropertyDescriptor(globalThis,'performance');let Processor,tick=0,increment=.01;
 Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>tick+=increment}});
 globalThis.sampleRate=RATE;globalThis.AudioWorkletProcessor=class{constructor(){this.messages=[];this.port={postMessage:value=>this.messages.push(value),onmessage:null};}};
 globalThis.registerProcessor=(_,value)=>{Processor=value;};
 try{await import('../src/instruments/fractal-delay/network-worklet.js?overload-recovery');
   const p=new Processor({processorOptions:{module,memoryReserveBytes:8*1024*1024}}),out=[new Float32Array(BLOCK),new Float32Array(BLOCK)];
   p.message({type:'scene',id:301,revision:301,scene:graph([[0,1,.1]],2)});
   for(let n=0;n<40&&!p.messages.some(value=>value.id===301&&value.installed);n++)p.process([[zero]],[out]);
   assert(p.messages.some(value=>value.id===301&&value.installed));
   increment=2;const next=graph([[0,1,.1]],2);next.edges[0].id=99;
   p.message({type:'scene',id:302,revision:302,scene:next});
   for(let n=0;n<240&&!p.messages.some(value=>value.id===302&&value.installed);n++)p.process([[zero]],[out]);
   assert(p.messages.some(value=>value.id===302&&value.installed),'queuedrecoverydoesnotwaitforeverforidleCPU');
   assert.equal(p.network.status().revision,302);p.message({type:'dispose',id:303});
 }finally{Object.defineProperty(globalThis,'performance',clockDescriptor);for(const [key,value]of Object.entries(before)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('simultaneous source ports produce independent arrivals through their actual routes',()=>{
  const scene=graph([[0,1,.1],[0,2,.2],[0,3,.3]],4,0);
  const sourceA=initialize({...scene,inputNode:1},{boundary:0});
  const sourceB=initialize({...scene,inputNode:2},{boundary:0});
  const together=initialize({...scene,inputPorts:[{node:1,weight:Math.SQRT1_2},{node:2,weight:Math.SQRT1_2}]},{boundary:0});
  const raw=value=>.94*Math.atanh(value/.94);
  try {
    const a=render(sourceA,8,impulse),b=render(sourceB,8,impulse),both=render(together,8,impulse);
    assert(Math.abs(a.findIndex(value=>Math.abs(value)>1e-4)-48)<=1);
    assert(Math.abs(b.findIndex(value=>Math.abs(value)>1e-4)-96)<=1);
    assert(both.slice(47,51).some(value=>Math.abs(value)>.01),'first source arrives along the shorter route');
    assert(both.slice(95,99).some(value=>Math.abs(value)>.01),'second source independently arrives along the longer route');
    let error=0;
    for(let i=0;i<both.length;i++)error=Math.max(error,Math.abs(raw(both[i])-(raw(a[i])+raw(b[i]))*Math.SQRT1_2));
    assert(error<1e-7,`the normalized multiport pressure superposes actual waves, error ${error}`);
    finite(both);
  } finally {sourceA.dispose();sourceB.dispose();together.dispose();}
});

test('multiple pickups are weighted averages of actual node pressure',()=>{
  const scene=graph([[0,1,.1],[0,2,.2]],3);
  const a=initialize({...scene,pickupNode:1},{boundary:0});
  const b=initialize({...scene,pickupNode:2},{boundary:0});
  const average=initialize({...scene,pickupPorts:[{node:1,weight:.25},{node:2,weight:.75}]},{boundary:0});
  const raw=value=>.94*Math.atanh(value/.94);
  try {
    const pa=render(a,8,impulse),pb=render(b,8,impulse),pc=render(average,8,impulse);
    let error=0;
    for(let i=0;i<pc.length;i++)error=Math.max(error,Math.abs(raw(pc[i])-raw(pa[i])*.25-raw(pb[i])*.75));
    assert(error<1e-7,`pickup pressure matches the specified weighted average, error ${error}`);
    assert(energy(pc)>1e-5);finite(pc);
  } finally {a.dispose();b.dispose();average.dispose();}
});

test('port validation rejects unsafe scenes transactionally and accepts safe signed weights',()=>{
  const scene=graph([[0,1,.1],[1,2,.1]],4,2),e=initialize(scene);
  try {
    const before=e.status(),cases=[
      {inputPorts:[]},{pickupPorts:[]},
      {inputPorts:[{node:0,weight:0}]},{pickupPorts:[{node:2,weight:0}]},
      {inputPorts:[{node:0,weight:1},{node:0,weight:.1}]},
      {pickupPorts:[{node:2,weight:.5},{node:2,weight:.5}]},
      {inputPorts:[{node:4,weight:1}]},{pickupPorts:[{node:-1,weight:1}]},
      {inputPorts:[{node:3,weight:1}]},{pickupPorts:[{node:3,weight:1}]},
      {inputPorts:[{node:0,weight:Infinity}]},{pickupPorts:[{node:2,weight:NaN}]},
      {inputPorts:[{node:0,weight:.8},{node:1,weight:.8}]},
      {pickupPorts:[{node:0,weight:.8},{node:1,weight:.3}]},
      {pickupPorts:[{node:0,weight:-.8},{node:1,weight:.3}]}
    ];
    for(const changes of cases){
      assert.throws(()=>e.beginScene({...scene,...changes},8),`reject ${JSON.stringify(changes)}`);
      assert.equal(e.status().sampleClock,before.sampleClock);assert.equal(e.status().revision,before.revision);
      assert.equal(e.status().activeEdges,before.activeEdges);
    }
    e.beginScene({...scene,inputPorts:[{node:0,weight:.6},{node:1,weight:-.8}],pickupPorts:[{node:1,weight:-.4},{node:2,weight:.6}]},9);
    assert.equal(e.prepareStep(),2);assert.equal(e.status().revision,9);
    finite(render(e,100,impulse));
    assert.throws(()=>e.controls({boundary:-.1}),/Invalid/);
    assert.throws(()=>e.controls({boundary:1.1}),/Invalid/);
    assert.throws(()=>e.controls({boundary:Infinity}));
  } finally {e.dispose();}
});

test('boundary absorption removes round trips without changing the initial source transit',()=>{
  const scene=graph([[0,1,.1]],2),open=initialize(scene,{boundary:0}),closed=initialize(scene,{boundary:1});
  try {
    const a=render(open,8,impulse),b=render(closed,8,impulse);
    assert.equal(a.findIndex(value=>Math.abs(value)>1e-4),b.findIndex(value=>Math.abs(value)>1e-4));
    assert(Math.abs(a[48]-b[48])<1e-7,'boundary changes reflected waves, not the external injection');
    assert(energy(b.slice(130))>1e-3,'closed endpoints retain genuine feedback round trips');
    assert(energy(a.slice(130))<1e-10,'absorbing endpoints do not reflect the old impulse');
    finite(a);finite(b);
  } finally {open.dispose();closed.dispose();}
});

test('zero coupling retains excitation and boundary defaults remain compatible with legacy controls',()=>{
  const e=initialize(graph([[0,1,.1]],2),{coupling:0});
  try {
    const pcm=render(e,6,impulse);assert(Math.abs(pcm.findIndex(value=>Math.abs(value)>1e-4)-48)<=1);
    assert(pcm.slice(140,148).some(value=>Math.abs(value)>.04),'omitted boundary still reflects at degree-one endpoints');
    e.controls({boundary:0});render(e,240);
    const encoded=new TextEncoder().encode(JSON.stringify({parameters:{timeMs:10,decay:1,coupling:0,pitchOffset:0,frozen:false}}));
    const pointer=e.api.fd_alloc(encoded.length);
    try {new Uint8Array(e.api.memory.buffer,pointer,encoded.length).set(encoded);assert.equal(e.api.fd_controls(e.engine,pointer,encoded.length),1);}
    finally {e.api.fd_free(pointer,encoded.length);}
    render(e,240);const restored=render(e,6,impulse);
    assert(restored.slice(140,148).some(value=>Math.abs(value)>.04),'legacy control payload restores the default reflecting boundary');finite(pcm);finite(restored);
  } finally {e.dispose();}
});

test('preencoded scene bytes retain multiport definitions and smooth rapid live changes without restarting',()=>{
  const scene=graph([[0,1,.1],[1,2,.2]],3),baseline=initialize(scene),changed=initialize(scene);
  let sample=0;
  const signal=()=>Float32Array.from({length:BLOCK},()=>.02*Math.sin(2*Math.PI*173*sample++/RATE));
  try {
    for(let n=0;n<200;n++){const input=signal();baseline.process(input);changed.process(input);}
    const before=changed.status(),memory=changed.api.memory.buffer.byteLength;
    const next={...scene,inputPorts:[{node:0,weight:Math.SQRT1_2},{node:2,weight:Math.SQRT1_2}],pickupPorts:[{node:0,weight:.5},{node:1,weight:.5}]};
    changed.beginScene(new TextEncoder().encode(JSON.stringify(next)),71);assert.equal(changed.prepareStep(),2);
    assert.equal(changed.status().sampleClock,before.sampleClock);
    assert.equal(changed.status().releasingEdges,0);assert.equal(changed.status().requiredDelayBytes,before.requiredDelayBytes);
    const input=signal(),old=baseline.process(input).left.slice(),moved=changed.process(input).left.slice();
    assert(Math.abs(old[0]-moved[0])<.0001,'the first sample follows a smooth port fade');
    for(let n=0;n<120;n++){
      const source=n%2?[{node:0,weight:.6},{node:1,weight:-.8}]:next.inputPorts;
      changed.beginScene({...next,inputPorts:source},72+n);assert.equal(changed.prepareStep(),2);
      const clock=changed.status().sampleClock;finite(changed.process(signal()).left);
      assert.equal(changed.status().sampleClock,clock+BLOCK);assert.equal(changed.status().releasingEdges,0);
      assert.equal(changed.api.memory.buffer.byteLength,memory,'port changes reuse reserved histories');
    }
    assert.equal(changed.status().activeEdges,scene.edges.length);
    assert(changed.status().edgeLevels.some(value=>value>.0001),'the existing travelling histories remain active');
  } finally {baseline.dispose();changed.dispose();}
});
