import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWitch, getWitchTree, getWitchHair, getWitchTargets, hitTestWitch, warpWitchPoint } from '../src/instruments/witch/witch-renderer.js';

function paintProbe() {
  const canvases=[],images=[];
  const document={createElement(tag) {
    if(tag==='img'){const image={complete:false,naturalWidth:0,src:''};images.push(image);return image;}
    const calls=[],stack=[];
    const canvas={ownerDocument:document,width:0,height:0,cloneNode(){const copy=document.createElement('canvas');copy.width=this.width;copy.height=this.height;return copy;}};
    const context=new Proxy({canvas,calls,globalAlpha:1,filter:'none',
      save(){stack.push(this.globalAlpha);},restore(){this.globalAlpha=stack.pop();},
      createLinearGradient(){return {addColorStop(){}};},createRadialGradient(){return {addColorStop(){}};},
    },{get(target,key){return key in target?target[key]:(...args)=>calls.push({type:key,args,color:target.strokeStyle,fill:target.fillStyle,alpha:target.globalAlpha});}});
    canvas.getContext=()=>context;canvases.push(canvas);return canvas;
  }};
  return {context:document.createElement('canvas').getContext('2d'),canvases,images};
}

function withPaths(run) {
  const previous=globalThis.Path2D;globalThis.Path2D=class {constructor(d){this.d=d;}};
  try {run();} finally {if(previous===undefined)delete globalThis.Path2D;else globalThis.Path2D=previous;}
}

test('unchanged tree/web paint is reused, while topology and resolution invalidate only their bounded layers',()=>withPaths(()=>{
  const {context,canvases}=paintProbe(),state={renderScale:.6,treeShape:3};
  renderWitch(context,390,281,state);
  const tree=canvases.find(canvas=>canvas.getContext('2d').calls.some(call=>call.type==='stroke'&&call.color==='#10141e'));
  const web=canvases.find(canvas=>canvas.getContext('2d').calls.some(call=>call.type==='stroke'&&call.color==='#adc7d47a'));
  assert.ok(tree&&web&&tree!==web);
  const treeCalls=tree.getContext('2d').calls.length,webCalls=web.getContext('2d').calls.length,count=canvases.length;
  const strokes=tree.getContext('2d').calls.filter(call=>call.type==='stroke').length;
  assert.equal(strokes,getWitchTree(state).segments.length*2,'cache retains every authored branch stroke');
  for(let frame=1;frame<=5;frame++)renderWitch(context,390,281,{...state,time:frame,handTime:frame,palette:frame,flightLift:.2,treeEnvelope:.8,treeProgress:frame*.1});
  assert.equal(tree.getContext('2d').calls.length,treeCalls);assert.equal(web.getContext('2d').calls.length,webCalls);
  renderWitch(context,390,281,{...state,treeCurl:.77});
  assert.ok(tree.getContext('2d').calls.length>treeCalls);assert.equal(web.getContext('2d').calls.length,webCalls);
  renderWitch(context,390,281,{...state,renderScale:.5});
  assert.ok(web.getContext('2d').calls.length>webCalls);assert.equal(canvases.length,count,'live controls reuse the same two layer surfaces');
  assert.ok(tree.width*tree.height<51000&&web.width*web.height<30000);
}));

test('default scene skips discarded color work and scaled buffers reduce processed pixels without changing logical output',()=>withPaths(()=>{
  const {context,canvases}=paintProbe();
  renderWitch(context,390,281,{renderScale:.6});
  const surface=canvases[1],color=canvases[2];
  assert.equal(surface.width,600);assert.equal(surface.height,432);assert.equal(color.width,600);assert.equal(color.height,432);
  assert.equal(color.getContext('2d').calls.filter(call=>call.type==='drawImage').length,0);
  renderWitch(context,390,281,{renderScale:.6,palette:3});
  assert.equal(color.getContext('2d').calls.filter(call=>call.type==='drawImage').length,1);
  renderWitch(context,390,281,{renderScale:.6});
  assert.equal(color.getContext('2d').calls.filter(call=>call.type==='drawImage').length,1);
  assert.deepEqual(context.calls.filter(call=>call.type==='drawImage').at(-1).args,[surface,0,0,600,432,0,0,1000,720]);
  for(const [renderScale,expected] of [[NaN,1000],[.01,500],[10,1000],[.551,550]]) {
    renderWitch(context,390,281,{renderScale});assert.equal(surface.width,expected);
  }
}));

test('lower-resolution distortion keeps the same 180 canonical strips and exact inverse picking',()=>withPaths(()=>{
  for(const renderScale of [.5,.6,.85,1])for(const visualMode of [0,4,5,6,7]) {
    const {context}=paintProbe(),state={renderScale,visualMode,eyeShock:.7,warpTime:2.93};
    renderWitch(context,390,281,state);
    const strips=context.calls.filter(call=>call.type==='drawImage'&&call.args.length===9);
    assert.equal(strips.length,180);
    for(const {args:[,sx,sy,sw,sh,dx,dy,dw,dh]} of strips) {
      const point={x:367,y:dy+1.9},visible=warpWitchPoint(point,state);
      assert.ok(Math.abs(visible.x-(dx+(point.x*renderScale-sx)/sw*dw))<1e-10);
      assert.ok(Math.abs(visible.y-(dy+(point.y*renderScale-sy)/sh*dh))<1e-10);
      assert.ok(Math.abs(warpWitchPoint(visible,state,true).x-point.x)<1e-10);
    }
  }
}));

test('hair cache is bounded to the current geometry and invalidates mutable controls without changing hit targets',()=>{
  const state={hair:.5,handTime:2.4,flightLift:1,flightPhase:1.3};
  const first=getWitchHair(state);
  assert.equal(first,getWitchHair({...state,palette:5,renderScale:.5}));
  state.hairPullX=121;const pulled=getWitchHair(state);
  assert.notEqual(pulled,first);assert.notDeepEqual(pulled.tip,first.tip);
  state.flightPhase=3;assert.notEqual(getWitchHair(state),pulled);
  for(const flightLift of [0,1]) {
    const config={...state,flightLift},targets=getWitchTargets(config);
    for(const type of ['nose','mouth','eyes','spoon','die','hat','broom']) {
      const target=warpWitchPoint(targets[type],config);
      assert.deepEqual(hitTestWitch(target.x,target.y,{...config,renderScale:.5}),hitTestWitch(target.x,target.y,{...config,renderScale:1}));
    }
  }
});

test('quiet portrait decoding requests one repaint from load/error rather than requiring polling',()=>withPaths(()=>{
  const {context,images}=paintProbe();let requests=0;
  const onInvalidate=()=>requests++;
  renderWitch(context,390,281,{onInvalidate});
  assert.ok(images.length>10);assert.equal(requests,0);
  for(const image of images){assert.equal(image.onload,onInvalidate);assert.equal(image.onerror,onInvalidate);}
  images[0].onload();images[1].onerror();assert.equal(requests,2);
  renderWitch(context,390,281,{onInvalidate});assert.equal(requests,2,'rendering itself does not schedule another frame');
}));
