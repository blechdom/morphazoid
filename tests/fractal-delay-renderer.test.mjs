import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetworkRenderer } from '../src/instruments/fractal-delay/renderer.js';
const network={revision:7,mode:'inverse',nodes:[{id:0,x:-1,y:0},{id:1,x:0,y:.5},{id:2,x:1,y:0}],
  edges:[{id:12,a:0,b:1,length:1},{id:23,a:1,b:2,length:1}],inputNode:0,pickupNode:2,bounds:{minX:-1,maxX:1,minY:0,maxY:.5}};
function surface(){
 const paths=[],markers=[];let current=[],rectReads=0;
 const context={lineWidth:1,strokeStyle:'',fillStyle:'',clearRect(){paths.length=0;markers.length=0;},
  beginPath(){current=[];},moveTo(x,y){current.push([x,y]);},lineTo(x,y){current.push([x,y]);},
  stroke(){paths.push({points:current.map(point=>point.slice()),color:this.strokeStyle});},arc(x,y,r){markers.push({x,y,r});},fill(){markers.at(-1).color=this.fillStyle;}};
 const canvas={width:720,height:500,getContext(type){return type==='2d'?context:null;},getBoundingClientRect(){rectReads++;return{width:720,height:500};}};
 return{canvas,paths,markers,get rectReads(){return rectReads;}};
}
function fallback(run){const previous=globalThis.OffscreenCanvas;globalThis.OffscreenCanvas=class{getContext(){return null;}};
 try{return run();}finally{if(previous===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=previous;}}

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
