import { buildNetwork, sanitizeParameters } from './model.js';
import { createWasmNetwork, estimateSceneBytes } from './wasm-runtime.js';
const cachedCosts=new Map();
let latest=0, pending=null, busy=false;
self.onmessage=({data})=>{latest=data.revision;pending=data;if(!busy)void run();};
async function run(){busy=true;while(pending){const job=pending;pending=null;
 try{
  const parameters=sanitizeParameters(job.parameters),rate=job.sampleRate||48000,memoryBudgetBytes=job.memoryBytes;
  const maximumLength=Math.max(.001,(memoryBudgetBytes-1048576)/(8*rate*2*1.25));
  let budget=job.budget||65536,network,measurement,requiredDelayBytes;
  for(let trial=0;trial<12;trial++){
   network=buildNetwork(parameters,budget,{maxTotalLength:maximumLength});
   if(!network.edges.length||network.metadata.admissionUnsupported)throw new Error('This shape cannot fit the selected memory budget. Reduce detail or select another parameter.');
   network.reserveTimeMs=2000;network.memoryBudgetBytes=memoryBudgetBytes;
   requiredDelayBytes=estimateSceneBytes(network,rate,2000);
   if(requiredDelayBytes>memoryBudgetBytes){budget=Math.max(1,Math.floor(network.edges.length*.75));continue;}
   const key=`${rate}:${network.mode}:${network.edges.length}`;
   measurement=cachedCosts.get(key);
   if(!measurement){
    const engine=createWasmNetwork(job.module,rate);const zero=new Float32Array(128);
    try{
     engine.prepareScene(network,1);engine.controls(parameters,job.performance,'media');
     for(let block=0;block<24;block++)engine.process(zero,zero);
     const samples=[];
     for(let batch=0;batch<7;batch++){const start=performance.now();for(let block=0;block<16;block++)engine.process(zero,zero);samples.push((performance.now()-start)/1000/(16*128/rate));}
     samples.sort((a,b)=>a-b);measurement={cpuLoad:samples[3],sampleRate:rate,edges:network.edges.length};cachedCosts.set(key,measurement);
    }finally{engine.dispose();}
   }
   if(job.manual||measurement.cpuLoad<=.42||network.edges.length<=4)break;
   budget=Math.max(1,Math.floor(network.edges.length*Math.max(.25,.35/measurement.cpuLoad)));
  }
  if(requiredDelayBytes>memoryBudgetBytes||!measurement)throw new Error('Complete network could not fit the memory budget.');
  const sceneBytes=new TextEncoder().encode(JSON.stringify({nodes:network.nodes.map(({id,x,y})=>({id,x,y})),
   edges:network.edges.map(({id,a,b,length})=>({id,a,b,length})),inputNode:network.inputNode,pickupNode:network.pickupNode,
   reserveTimeMs:2000,memoryBudgetBytes}));
  if(job.revision===latest)self.postMessage({type:'prepared',revision:job.revision,network,sceneBytes,requiredDelayBytes,measurement,memoryBudgetBytes},[sceneBytes.buffer]);
  else self.postMessage({type:'superseded',revision:job.revision});
 }catch(error){self.postMessage({revision:job.revision,error:String(error.message||error)});}
 await new Promise(resolve=>setTimeout(resolve,0));
 }busy=false;}
