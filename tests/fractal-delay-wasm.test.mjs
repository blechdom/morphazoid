import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createWasmNetwork, estimateSceneBytes } from '../src/instruments/fractal-delay/wasm-runtime.js';
import { buildNetwork, DEFAULT_PARAMETERS, MODES } from '../src/instruments/fractal-delay/model.js';
const bytes = await readFile(new URL('../assets/wasm/fractal-delay.wasm', import.meta.url));
const module = await WebAssembly.compile(bytes);
const RATE = 48000, BLOCK = 128, zero = new Float32Array(BLOCK);
const transparent = { dry: 0, wet: 1, hpfHz: 0, lpfHz: 22000, compressorRatio: 1, outputBoostDb: 0, outputLevel: 1 };
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
function initialize(scene, parameters = {}) {
  const e=createWasmNetwork(module,RATE);e.controls({timeMs:10,coupling:1,decay:1,...parameters},transparent,'media');
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
    e.controls({timeMs:.05,coupling:.65,decay:.9,pitchOffset:12});
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
