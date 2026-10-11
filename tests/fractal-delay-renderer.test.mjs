import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetworkRenderer } from '../src/instruments/fractal-delay/renderer.js';
const network={revision:7,mode:'inverse',nodes:[{id:0,x:-1,y:0},{id:1,x:0,y:.5},{id:2,x:1,y:0}],
  edges:[{id:12,a:0,b:1,length:1},{id:23,a:1,b:2,length:1}],inputNode:0,pickupNode:2,bounds:{minX:-1,maxX:1,minY:0,maxY:.5}};
function surface(){
 const paths=[],markers=[];let current=[],rectReads=0,arc=null,arcCalls=0,images=0;
 const context={lineWidth:1,globalAlpha:1,strokeStyle:'',fillStyle:'',clearRect(){paths.length=0;markers.length=0;},
  beginPath(){current=[];arc=null;},moveTo(x,y){current.push([x,y]);},lineTo(x,y){current.push([x,y]);},
  stroke(){if(arc)markers.push({...arc,color:this.strokeStyle,alpha:this.globalAlpha,ring:true});else paths.push({points:current.map(point=>point.slice()),color:this.strokeStyle});},
  arc(x,y,r){arcCalls++;arc={x,y,r};},fill(){markers.push({...arc,color:this.fillStyle,alpha:this.globalAlpha,ring:false});},drawImage(){images++;}};
 const canvas={width:720,height:500,getContext(type){return type==='2d'?context:null;},getBoundingClientRect(){rectReads++;return{width:720,height:500};}};
 return{canvas,paths,markers,get rectReads(){return rectReads;},get arcCalls(){return arcCalls;},get images(){return images;}};
}
function fallback(run){const previous=globalThis.OffscreenCanvas;globalThis.OffscreenCanvas=class{getContext(){return null;}};
 try{return run();}finally{if(previous===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=previous;}}
function measuredFrame(revision=network.revision){
 return Object.freeze({revision,sampleClock:8192,waveformSize:32,
  edgeWaveforms:Float32Array.from({length:64},(_,i)=>i<32?.07:-.04)});
}
function movedNetwork(revision=8){
 const nodes=network.nodes.map(node=>({...node,y:node.id===1?.75:node.y}));
 const next={...network,revision,nodes,edges:network.edges.map(edge=>({...edge,
  length:Math.hypot(nodes[edge.b].x-nodes[edge.a].x,nodes[edge.b].y-nodes[edge.a].y)}))};
 delete next.bounds;return next;
}
function flatPaths(next){
 const s=surface(),r=createNetworkRenderer(s.canvas);
 try{r.setNetwork(next);r.draw();return structuredClone(s.paths);}finally{r.dispose();}
}

test('all prepared vectors remain colored without an amplitude or availability animation',()=>fallback(()=>{
 const s=surface(),r=createNetworkRenderer(s.canvas);r.setNetwork(network);r.draw();assert.equal(r.renderer,'Canvas2D');
 assert.equal(s.paths.length,4);assert.equal(s.markers.length,2);assert.equal(s.markers[0].color,'#40ff76');assert.equal(s.markers[1].color,'#ff9f33');
 for(const path of s.paths){const [red,green,blue]=path.color.match(/[\d.]+/g).map(Number);assert(red!==green||green!==blue,'preparededgecolorisneverneutralgray');}
 assert.deepEqual(s.paths[0].points[0],[s.markers[0].x,s.markers[0].y]);assert.deepEqual(s.paths[2].points.at(-1),[s.markers[1].x,s.markers[1].y]);r.dispose();
}));
test('only coherent measured pressure moves traces; identical samples have identical frames',()=>fallback(()=>{
 const s=surface(),r=createNetworkRenderer(s.canvas);r.setNetwork(network);r.draw();const baseline=structuredClone(s.paths);
 const status={revision:7,waveformSize:32,edgeWaveforms:Float32Array.from({length:64},(_,i)=>i<32?.07:-.04)};
 r.setStatus(status);r.draw();const live=structuredClone(s.paths);assert.notDeepEqual(live,baseline);
 r.draw();assert.deepEqual(s.paths,live,'noindependentphaseclockorcarrier');
 r.setStatus({...status,revision:8});r.draw();assert.deepEqual(s.paths,baseline,'differenttopologywaveindicesarenotdisplayed');
 r.setStatus(null);r.draw();assert.deepEqual(s.paths,baseline);r.dispose();
}));
test('draw leaves resize/layout work to explicit resize and never replaces the interactive canvas',()=>fallback(()=>{
 const s=surface(),r=createNetworkRenderer(s.canvas);r.setNetwork(network);const reads=s.rectReads;
 r.draw();r.draw();assert.equal(s.rectReads,reads);assert.equal(s.canvas.width,720);assert.equal(s.canvas.height,500);
 r.resize();r.draw();assert.equal(s.rectReads,reads+1);r.dispose();assert.equal(s.paths.length,0);
 r.draw();assert.equal(s.paths.length,0);
}));

test('coordinate installs retain the last measured wave on the new vectors without rewriting its revision or sample clock',()=>fallback(()=>{
 const s=surface(),r=createNetworkRenderer(s.canvas),status=measuredFrame(),originalSamples=status.edgeWaveforms.slice();
 try{
  r.setNetwork(network);r.setStatus(status);r.draw();const originalFrame=structuredClone(s.paths);
  const next=movedNetwork(),baseline=flatPaths(next);
  r.setNetwork(next);r.setStatus({});r.draw();
  assert.notDeepEqual(s.paths,originalFrame,'the prepared coordinates move rather than keeping the old picture');
  for(let edge=0;edge<next.edges.length;edge++){
   assert.deepEqual(s.paths[edge*2],baseline[edge*2],'the actual new vector remains the trace baseline');
   assert.deepEqual(s.paths[edge*2+1].points[0],baseline[edge*2+1].points[0]);
   assert.deepEqual(s.paths[edge*2+1].points.at(-1),baseline[edge*2+1].points.at(-1));
   assert.ok(Math.hypot(...s.paths[edge*2+1].points[16].map((value,i)=>value-baseline[edge*2+1].points[16][i]))>1,
    'both connections retain actual pressure displacement');
  }
  const held=structuredClone(s.paths);r.setStatus({});r.draw();assert.deepEqual(s.paths,held);
  assert.equal(status.revision,7);assert.equal(status.sampleClock,8192);assert.deepEqual(status.edgeWaveforms,originalSamples);
  r.setNetwork({...next,revision:9});r.setStatus({});r.draw();assert.deepEqual(s.paths,held,'multiple compatible installs retain the same dated frame');
  r.setStatus({...status,revision:9,sampleClock:16384,edgeWaveforms:new Float32Array(64).fill(.015)});r.draw();
  assert.notDeepEqual(s.paths,held,'a new matching measurement replaces the retained pressure');
  assert.equal(status.revision,7);assert.equal(status.sampleClock,8192);assert.deepEqual(status.edgeWaveforms,originalSamples);
 }finally{r.dispose();}
}));

test('Audio off clears retained pressure and empty install statuses cannot revive it',()=>fallback(()=>{
 const s=surface(),r=createNetworkRenderer(s.canvas),next=movedNetwork(),baseline=flatPaths(next);
 try{
  r.setNetwork(network);r.setStatus(measuredFrame());r.setNetwork(next);r.setStatus({});r.draw();assert.notDeepEqual(s.paths,baseline);
  r.setStatus(null);r.draw();assert.deepEqual(s.paths,baseline);
  r.setStatus({});r.setNetwork({...next,revision:9});r.draw();assert.deepEqual(s.paths,baseline,'compatible geometry never revives a cleared measurement');
  r.setStatus({...measuredFrame(9),sampleClock:24576});r.draw();assert.notDeepEqual(s.paths,baseline,'only a new matching measurement restores waves');
 }finally{r.dispose();}
}));

for(const [label,change]of [
 ['changed node identities',next=>({...next,nodes:next.nodes.map((node,i)=>i===0?{...node,id:100}:node)} )],
 ['changed node ordering',next=>({...next,nodes:[next.nodes[1],next.nodes[0],next.nodes[2]]})],
 ['changed edge identities',next=>({...next,edges:next.edges.map((edge,i)=>i===0?{...edge,id:101}:edge)})],
 ['changed edge ordering',next=>({...next,edges:[...next.edges].reverse()})],
 ['changed edge direction',next=>({...next,edges:next.edges.map((edge,i)=>i===0?{...edge,a:edge.b,b:edge.a}:edge)})],
 ['changed endpoint index',next=>({...next,edges:next.edges.map((edge,i)=>i===0?{...edge,b:2}:edge)})],
 ['additional connection',next=>({...next,edges:[...next.edges,{id:40,a:0,b:2,length:2}]})],
]){
 test(`retained pressure rejects ${label} even when other geometry is similar`,()=>fallback(()=>{
  const s=surface(),r=createNetworkRenderer(s.canvas),next=change(movedNetwork()),baseline=flatPaths(next);
  try{
   r.setNetwork(network);r.setStatus(measuredFrame());r.draw();
   r.setNetwork(next);r.setStatus({});r.draw();assert.deepEqual(s.paths,baseline,'old pressure indices cannot move unrelated paths');
   const restored=movedNetwork(9);r.setNetwork(restored);r.setStatus({});r.draw();
   assert.deepEqual(s.paths,flatPaths(restored),'returning to the old layout does not resurrect rejected telemetry');
  }finally{r.dispose();}
 }));
}

test('stale or malformed full measurements invalidate a held frame rather than bypassing revision and size checks',()=>fallback(()=>{
 const next=movedNetwork(),baseline=flatPaths(next);
 for(const replacement of [measuredFrame(7),{...measuredFrame(8),waveformSize:16},
  {...measuredFrame(8),edgeWaveforms:new Float32Array(32)}]){
  const s=surface(),r=createNetworkRenderer(s.canvas);
  try{
   r.setNetwork(network);r.setStatus(measuredFrame());r.setNetwork(next);r.setStatus({});r.draw();assert.notDeepEqual(s.paths,baseline);
   r.setStatus(replacement);r.draw();assert.deepEqual(s.paths,baseline);
   r.setStatus({});r.draw();assert.deepEqual(s.paths,baseline,'an empty placeholder cannot restore an invalidated measurement');
  }finally{r.dispose();}
 }
}));

const multiport={...network,inputPorts:[{node:0,weight:.6},{node:2,weight:.8}],
 pickupPorts:[{node:0,weight:.1},{node:1,weight:.6},{node:2,weight:.3}]};

test('Canvas draws every admitted port with steady weight cues, including coincident input and pickup',()=>fallback(()=>{
 const s=surface(),r=createNetworkRenderer(s.canvas);r.setNetwork(multiport);r.draw();
 assert.equal(s.markers.length,5);
 assert.deepEqual(s.markers.map(marker=>marker.color),['#40ff76','#40ff76','#ff9f33','#ff9f33','#ff9f33']);
 assert(s.markers[0].r<s.markers[1].r);assert(s.markers[0].alpha<s.markers[1].alpha);
 assert.equal(s.markers[1].r,5);assert.equal(s.markers[1].alpha,1);
 assert.deepEqual(s.markers.map(marker=>marker.ring),[false,false,true,false,true]);
 assert.deepEqual([s.markers[0].x,s.markers[0].y],s.paths[0].points[0]);
 assert.deepEqual([s.markers[1].x,s.markers[1].y],s.paths[2].points.at(-1));
 assert.deepEqual([s.markers[2].x,s.markers[2].y],[s.markers[0].x,s.markers[0].y]);
 assert.deepEqual([s.markers[4].x,s.markers[4].y],[s.markers[1].x,s.markers[1].y]);
 const steady=structuredClone(s.markers);
 r.setStatus({revision:7,waveformSize:32,edgeWaveforms:new Float32Array(64),inputPeak:0,activeEdges:1});r.draw();
 assert.deepEqual(s.markers,steady,'port visibility and weight cues do not follow signal amplitude or partial status');
 r.dispose();
}));

test('explicit ports replace legacy anchors and routing links retain coherent measured waves',()=>fallback(()=>{
 const s=surface(),r=createNetworkRenderer(s.canvas);
 const routed={...network,inputPorts:[{node:1,weight:1}],pickupPorts:[{node:1,weight:1}],
  edges:network.edges.map((edge,i)=>({...edge,routingLink:i===1,routingType:i===1?'shortcuts':undefined}))};
 r.setNetwork(routed);r.draw();assert.equal(s.markers.length,2);
 assert.deepEqual([s.markers[0].x,s.markers[0].y],s.paths[0].points.at(-1));
 assert.deepEqual([s.markers[1].x,s.markers[1].y],[s.markers[0].x,s.markers[0].y]);
 assert.notEqual(s.paths[0].color,s.paths[2].color);
 const baseline=structuredClone(s.paths);
 r.setStatus({revision:7,waveformSize:32,edgeWaveforms:Float32Array.from({length:64},(_,i)=>i>=32?.08:0)});r.draw();
 assert.deepEqual(s.paths[0],baseline[0]);assert.deepEqual(s.paths[1],baseline[1]);
 assert.deepEqual(s.paths[2],baseline[2]);assert.notDeepEqual(s.paths[3].points,baseline[3].points);
 const live=structuredClone(s.paths);r.draw();assert.deepEqual(s.paths,live,'routing adds no separate carrier or visual clock');
 r.dispose();
}));

function gpuSurface(){
 const draws=[],textureImages=[],pressureUploads=[],buffers=new Map(),attributes=new Map(),uniforms=new Map();let boundBuffer,vao;
 const gl=new Proxy({
  createBuffer:()=>({}),createVertexArray:()=>({}),createShader:()=>({}),createProgram:()=>({}),createTexture:()=>({}),
  getShaderParameter:()=>true,getProgramParameter:()=>true,getUniformLocation:(_,name)=>name,
  bindBuffer:(_,buffer)=>{boundBuffer=buffer;},bindVertexArray:value=>{vao=value;},
  bufferData:(_,data)=>buffers.set(boundBuffer,data.slice()),
  texImage2D:(...args)=>textureImages.push(args.at(-1).slice()),
  texSubImage2D:(...args)=>pressureUploads.push(args.at(-1).slice()),
  vertexAttribPointer:(index,size,type,normalized,stride,offset)=>{if(!attributes.has(vao))attributes.set(vao,new Map());attributes.get(vao).set(index,{buffer:boundBuffer,size,stride,offset});},
  uniform1f:(name,value)=>uniforms.set(name,value),
  drawArrays:(mode,first,count)=>{const position=attributes.get(vao).get(0);draws.push({mode,first,count,stride:position.stride,data:buffers.get(position.buffer).slice(),size:uniforms.get('uSize')});},
 },{get(target,key){if(key in target)return target[key];return /^[A-Z_0-9]+$/.test(key)?key:()=>{};}});
 return {gl,draws,textureImages,pressureUploads};
}

test('GPU reuploads retained measured pressure after geometry recreates its texture without uploading every draw',()=>{
 const previous=globalThis.OffscreenCanvas,gpu=gpuSurface();
 globalThis.OffscreenCanvas=class{constructor(){this.width=this.height=1;}getContext(){return gpu.gl;}};
 let r;
 try{
  r=createNetworkRenderer(surface().canvas);r.setNetwork(network);
  const status=measuredFrame(),original=status.edgeWaveforms.slice();r.setStatus(status);r.draw();
  assert.equal(r.renderer,'WebGL2');assert.equal(gpu.textureImages.length,1);assert.equal(gpu.pressureUploads.length,1);
  assert.deepEqual(gpu.pressureUploads[0].subarray(0,64),original);
  r.setNetwork(movedNetwork());r.setStatus({});
  assert.equal(gpu.textureImages.length,2);assert.ok(gpu.textureImages[1].every(value=>value===0),'the rebuilt GPU texture starts empty');
  r.draw();assert.equal(gpu.pressureUploads.length,2);assert.deepEqual(gpu.pressureUploads[1],gpu.pressureUploads[0],
   'the held measurement is reuploaded despite retaining the same array');
  r.draw();r.draw();assert.equal(gpu.pressureUploads.length,2,'unchanged drawings reuse the uploaded pressure');
  r.setStatus(null);r.draw();assert.equal(gpu.pressureUploads.length,3);assert.ok(gpu.pressureUploads[2].every(value=>value===0));
  assert.equal(status.revision,7);assert.equal(status.sampleClock,8192);assert.deepEqual(status.edgeWaveforms,original);
 }finally{r?.dispose();if(previous===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=previous;}
});

test('GPU marker buffer and draw count include every admitted port with the same weight and overlap cues',()=>{
 const previous=globalThis.OffscreenCanvas,gpu=gpuSurface();
 globalThis.OffscreenCanvas=class{constructor(){this.width=this.height=1;}getContext(){return gpu.gl;}};
 try{
  const s=surface(),r=createNetworkRenderer(s.canvas);r.setNetwork(multiport);r.draw();assert.equal(r.renderer,'WebGL2');
  const draw=gpu.draws.at(-1);assert.equal(draw.mode,'POINTS');assert.equal(draw.count,5);assert.equal(draw.stride,32);assert.equal(draw.data.length,40);
  const rows=Array.from({length:draw.count},(_,i)=>Array.from(draw.data.slice(i*8,(i+1)*8)));
  assert.deepEqual(rows.map(row=>row.slice(0,2)),[[-1,0],[1,0],[-1,0],[0,.5],[1,0]]);
  assert.deepEqual(rows.map(row=>row[7]),[0,0,1,0,1]);
  assert(rows[0][5]<rows[1][5]);assert(rows[0][6]<rows[1][6]);assert.equal(rows[1][5],1);assert.equal(rows[1][6],1);
  assert.equal(draw.size,11);
  r.setNetwork(network);r.draw();const legacy=gpu.draws.at(-1);assert.equal(legacy.count,2);
  assert.deepEqual([legacy.data[5],legacy.data[6],legacy.data[7],legacy.data[13],legacy.data[14],legacy.data[15]],[1,1,0,1,1,0]);
  r.dispose();
 }finally{if(previous===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=previous;}
});

test('Canvas caches all-node markers across pressure frames and rebuilds them only for a new graph or fit',()=>{
 const previous=globalThis.OffscreenCanvas,caches=[];
 globalThis.OffscreenCanvas=class{
  constructor(){this.width=this.height=1;this.s=surface();}
  getContext(type){if(type!=='2d')return null;caches.push(this.s);return this.s.canvas.getContext('2d');}
 };
 try{
  const nodes=Array.from({length:256},(_,id)=>({id,x:id/255*2-1,y:Math.sin(id)}));
  const dense={...network,nodes,edges:nodes.slice(1).map((_,i)=>({id:i,a:i,b:i+1,length:1})),
   inputPorts:nodes.map(node=>({node:node.id,weight:1/16})),pickupPorts:nodes.map(node=>({node:node.id,weight:1/256}))};
  const s=surface(),r=createNetworkRenderer(s.canvas);r.setNetwork(dense);r.draw();assert.equal(r.renderer,'Canvas2D');
  const cache=caches[0];assert.equal(cache.markers.length,512);assert.equal(cache.arcCalls,512);assert.equal(s.images,1);
  r.setStatus({revision:7,waveformSize:32,edgeWaveforms:new Float32Array(dense.edges.length*32).fill(.04)});
  r.draw();r.draw();assert.equal(cache.arcCalls,512,'pressure frames reuse the static port overlay');assert.equal(s.images,3);
  r.resize();r.draw();assert.equal(cache.arcCalls,512,'an unchanged fit does not repaint all markers');
  r.setNetwork(network);r.draw();assert.equal(cache.arcCalls,514);assert.equal(cache.markers.length,2);
  r.dispose();
 }finally{if(previous===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=previous;}
});
