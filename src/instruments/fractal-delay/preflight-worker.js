import { buildNetwork, networkPorts, sanitizeParameters } from './model.js';
import { createWasmNetwork, estimateSceneBytes } from './wasm-runtime.js';
const cachedCosts=new Map();
let cachedGeometry;
let latest=0, pending=null, busy=false;
self.onmessage=({data})=>{latest=data.revision;pending=data;if(!busy)void run();};
async function run(){busy=true;while(pending){const job=pending;pending=null;
 try{
  const parameters=sanitizeParameters(job.parameters),rate=job.sampleRate||48000,memoryBudgetBytes=job.memoryBytes;
  const maximumLength=Math.max(.001,(memoryBudgetBytes-1048576)/(8*rate*2*1.25));
  const geometryKey=JSON.stringify([rate,memoryBudgetBytes,job.budget,job.manual,
   ...['mode','domain','cReal','cImag','detail','routing','linkDensity'].map(key=>parameters[key])]);
  let budget=job.budget||65536,network,measurement,requiredDelayBytes;
  if(cachedGeometry?.key===geometryKey){
   const ports=networkPorts(cachedGeometry.network,parameters);
   network={...cachedGeometry.network,parameters,...ports,metadata:{...cachedGeometry.network.metadata,
    inputMode:parameters.inputMode,pickupMode:parameters.pickupMode,
    inputPortCount:ports.inputPorts.length,pickupPortCount:ports.pickupPorts.length}};
   measurement=cachedGeometry.measurement;requiredDelayBytes=cachedGeometry.requiredDelayBytes;
  }else{
  for(let trial=0;trial<12;trial++){
   network=buildNetwork(parameters,budget,{maxTotalLength:maximumLength});
   if(!network.edges.length||network.metadata.admissionUnsupported)throw new Error('This shape cannot fit the selected memory budget. Reduce detail or select another parameter.');
   network.reserveTimeMs=2000;network.memoryBudgetBytes=memoryBudgetBytes;
   requiredDelayBytes=estimateSceneBytes(network,rate,2000);
   if(requiredDelayBytes>memoryBudgetBytes){budget=Math.max(1,Math.floor(network.edges.length*.75));continue;}
   // Reserve the cost of live path-pitch/tone edits before activating the graph.
   // Scalar edits then keep the complete admitted shape and its histories.
   const key=`paths-v1:${geometryKey}:${network.nodes.length}:${network.edges.length}`;
   measurement=cachedCosts.get(key);
   if(!measurement){
    const engine=createWasmNetwork(job.module,rate);const zero=new Float32Array(128);
    try{
     engine.prepareScene(network,1);engine.controls({...parameters,
      propagation:'paths',geometryPitch:24,tapCoverage:1,turnTone:1},job.performance,'media');
     for(let block=0;block<24;block++)engine.process(zero,zero);
     const samples=[];
     for(let batch=0;batch<7;batch++){const start=performance.now();for(let block=0;block<16;block++)engine.process(zero,zero);samples.push((performance.now()-start)/1000/(16*128/rate));}
     samples.sort((a,b)=>a-b);measurement={cpuLoad:samples[3],sampleRate:rate,edges:network.edges.length};cachedCosts.set(key,measurement);
    }finally{engine.dispose();}
   }
   if(job.manual||measurement.cpuLoad<=.42||network.edges.length<=4)break;
   budget=Math.max(1,Math.floor(network.edges.length*Math.max(.25,.35/measurement.cpuLoad)));
  }
  }
  if(requiredDelayBytes>memoryBudgetBytes||!measurement)throw new Error('Complete network could not fit the memory budget.');
  cachedGeometry={key:geometryKey,network,measurement,requiredDelayBytes};
  const sceneBytes=new TextEncoder().encode(JSON.stringify({nodes:network.nodes.map(({id,x,y})=>({id,x,y})),
   edges:network.edges.map(({id,a,b,length})=>({id,a,b,length})),inputNode:network.inputNode,pickupNode:network.pickupNode,
   inputPorts:network.inputPorts,pickupPorts:network.pickupPorts,
   reserveTimeMs:2000,memoryBudgetBytes}));
  if(job.revision===latest)self.postMessage({type:'prepared',revision:job.revision,network,sceneBytes,requiredDelayBytes,measurement,memoryBudgetBytes},[sceneBytes.buffer]);
  else self.postMessage({type:'superseded',revision:job.revision});
 }catch(error){self.postMessage({revision:job.revision,error:String(error.message||error)});}
 await new Promise(resolve=>setTimeout(resolve,0));
 }busy=false;}
