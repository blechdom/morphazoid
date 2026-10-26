import test from 'node:test';
import assert from 'node:assert/strict';
import {WITCH_VOICES, WITCH_SHELF, WITCH_TREE_OBJECTS, WITCH_INGREDIENTS} from '../src/instruments/witch/witch-model.js';
import {traceLSystem,L_SYSTEM_PRESETS} from '../src/instruments/l-system/l-system.js';
import {hitTestWitch, getFingerTips, getWitchLadle, getWitchHair, getWitchHat, getWitchObjectPosition, getWitchGhostPosition, getWitchTargets, getWitchTrail, getWitchTrails, getWitchRestTrails, getWitchFabric, getWitchTree, getWitchTreePulse, getWitchWeb, getWitchSpellArm, renderWitchFaceIcon, broomTransform, handTransform, transformHandPoint, warpWitchPoint, renderWitch, WITCH_LAYOUT} from '../src/instruments/witch/witch-renderer.js';

function distanceToPolyline(point,points) {
  let distance=Infinity;
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/Math.max(.01,dx*dx+dy*dy)));
    distance=Math.min(distance,Math.hypot(point.x-a.x-dx*t,point.y-a.y-dy*t));
  }
  return distance;
}

test('moon, pot, mushrooms and die remain playable in flight while grounded scenery fades away',()=>{
  assert.equal(WITCH_LAYOUT.mushrooms.length,1);
  assert.equal(WITCH_LAYOUT.mushrooms[0].x,844);
  for(const flightLift of [0,.5,1]) {
    const state={scene:flightLift?'flight':'brew',flightLift,handReach:0};
    assert.equal(hitTestWitch(WITCH_LAYOUT.moon.x,WITCH_LAYOUT.moon.y,state)?.type,'moon');
    assert.equal(hitTestWitch(600,540,state)?.type,'stir');
    const mushroom=WITCH_LAYOUT.mushrooms[0];
    assert.equal(hitTestWitch(mushroom.x+34*mushroom.scale,mushroom.y+5*mushroom.scale,state)?.type,'mushrooms');
    const die=getWitchTargets(state).die;
    assert.deepEqual(die,WITCH_LAYOUT.die);
    assert.deepEqual(hitTestWitch(die.x,die.y,state),{type:'dice'});
  }
  assert.equal(hitTestWitch(388,450,{scene:'brew'})?.type,'hand');
  assert.equal(hitTestWitch(NaN,450),null);
  assert.equal(hitTestWitch(-5,450),null);
});

test('mushroom deformation has an exact inverse and preserves direct targets',()=>{
  for(let trip=0;trip<4;trip++) for(const warpTime of [0,.2,1.7,129.8]) {
    const state={scene:'brew',trip,warpTime};
    for(const point of [WITCH_LAYOUT.moon,WITCH_LAYOUT.hand,WITCH_LAYOUT.die,...WITCH_LAYOUT.mushrooms,{x:600,y:520}]) {
      const visible=warpWitchPoint(point,state), restored=warpWitchPoint(visible,state,true);
      assert.ok(Math.abs(restored.x-point.x)<1e-10); assert.equal(restored.y,point.y);
      assert.deepEqual(hitTestWitch(visible.x,visible.y,state),hitTestWitch(point.x,point.y,{scene:'brew'}));
    }
  }
});

test('the extended hand shares the actual projected tips with touch picking',()=>{
  const state={scene:'fingers',handReach:1,handWrist:{x:590,y:590},handTips:[{index:0,x:424,y:320},{index:1,x:500,y:220},{index:2,x:590,y:185},{index:3,x:680,y:245},{index:4,x:730,y:350}]};
  for(let trip=0;trip<4;trip++) {
    state.trip=trip;state.warpTime=2.4;
    for(const tip of getFingerTips(state)) {
      const p=warpWitchPoint(tip,state);
      assert.deepEqual(hitTestWitch(p.x,p.y,state),{type:'finger',index:tip.index});
    }
  }
  const tucked=handTransform({...state,handReach:0});
  assert.equal(tucked.scale,.19);
  assert.ok(Math.abs(state.handWrist.x*tucked.scale+tucked.x-388)<1e-10);
  assert.ok(Math.abs(state.handWrist.y*tucked.scale+tucked.y-450)<1e-10);
});


test('both wrists, angled fingertips and inverse drags share their model transforms',()=>{
  for(const reach of [0,.3,.7,1]) for(const index of [0,1]) {
    const state={handReach:reach,handWrists:[{x:590,y:590},{x:588,y:593}],radius:.6,ladleAngle:1.7};
    const t=handTransform(state,index);
    assert.deepEqual(transformHandPoint(state.handWrists[index],state,index),t.wrist);
    for(const point of [{x:530,y:300},{x:700,y:200},{x:580,y:410}]) {
      const view=transformHandPoint(point,state,index);
      const local=transformHandPoint(view,state,index,true);
      assert.ok(Math.abs(local.x-point.x)<1e-10);
      assert.ok(Math.abs(local.y-point.y)<1e-10);
    }
    if(index===0) assert.ok(Math.abs(t.rotation-reach*55*Math.PI/180)<1e-12);
    else {
      assert.equal(t.mirror,-1);
      assert.ok(Math.abs(t.rotation-(-.38+Math.PI/2))<1e-12);
      assert.ok(Math.abs(t.scale-.23*1.25*1.25)<1e-12);
    }
  }
  const state={handReach:1};
  assert.ok(Math.hypot(handTransform(state,0).wrist.x-handTransform(state,1).wrist.x,handTransform(state,0).wrist.y-handTransform(state,1).wrist.y)>150);
});


test('spoon and nose remain separate drag targets throughout automatic stirring',()=>{
  for(const spoonHeight of [0,.25,.5,.75,1]) for(let i=0;i<24;i++) {
    const state={scene:'brew',radius:1,phase:i*Math.PI/12,spoonHeight,nose:1,hitRadius:67};
    const ladle=getWitchLadle(state),nose=getWitchTargets(state).nose;
    assert.equal(hitTestWitch(ladle.hx-8,ladle.hy-24,state)?.type,'spoon');
    assert.equal(hitTestWitch(nose.x,nose.y,state)?.type,'nose');
    const adjacent={...state,handReach:1},tip={x:ladle.gx+39,y:ladle.gy,index:1};
    adjacent.handTips=[transformHandPoint(tip,adjacent,0,true)];
    assert.equal(hitTestWitch(ladle.gx,ladle.gy,adjacent)?.type,'spoon','nearby finger touch halos leave the spoon palm playable');
    assert.deepEqual(hitTestWitch(tip.x,tip.y,adjacent),{type:'finger',index:1},'the actual foreground fingertip keeps its control');
  }
});

test('shelf, cupboard-top, branch and web instruments remain pickable through all visual modes',()=>{
  assert.deepEqual(WITCH_LAYOUT.objects.map(object=>object.id),WITCH_INGREDIENTS.map(object=>object.id));
  assert.equal(WITCH_SHELF.length,18);assert.equal(WITCH_TREE_OBJECTS.length,3);
  assert.equal(WITCH_LAYOUT.shelves.length,1);
  assert.equal(WITCH_LAYOUT.shelves[0].rows.length,6);
  for(const treeShape of [0,1,2,3,4,5])for(const hitRadius of [46,80])for(let visualMode=0;visualMode<8;visualMode++) {
    const state={handReach:1,treeShape,hitRadius,visualMode,warpTime:2.8};
    for(const [index,object] of WITCH_LAYOUT.objects.entries()) {
      const visible=getWitchObjectPosition(object,state),point=warpWitchPoint(visible,state);
      assert.ok(point.x>20&&point.x<990&&point.y>75&&point.y<705,`${object.id} remains inside the scene`);
      assert.deepEqual(hitTestWitch(point.x,point.y,state),object.location==='web'?{type:'spider'}:{type:'object',id:object.id,kind:object.kind,index});
      assert.notEqual(hitTestWitch(point.x,point.y,{...state,flightLift:1})?.type,'object','hidden ground objects cannot intercept flight gestures');
    }
  }
});

test('shelf solos fly immediately while branch solos sing before travelling into the potion',()=>{
  for(const home of WITCH_LAYOUT.objects) {
    const initial=getWitchObjectPosition(home,{});
    for(const time of [0,1,27,619])assert.deepEqual(getWitchObjectPosition(home,{time}),initial,'resting icons stay on their supports');
    const clicked={...home,x:initial.x,y:initial.y,dropped:true},hold=home.phraseDuration||0,duration=home.flightDuration;
    const start=getWitchObjectPosition({...clicked,dropAge:0});
    const middle=getWitchObjectPosition({...clicked,dropAge:hold+duration/2});
    const end=getWitchObjectPosition({...clicked,dropAge:hold+duration});
    assert.equal(start.x,initial.x);assert.equal(start.y,initial.y);
    assert.ok(Math.abs(middle.x-(initial.x+600)/2)<1e-10);
    assert.ok(middle.y<(initial.y+544)/2-100,'the solo follows a visible thrown arc');
    assert.equal(end.x,600);assert.equal(end.y,544);assert.equal(end.alpha,0);
    if(hold) {
      const singing=getWitchObjectPosition({...clicked,dropAge:hold/2});
      assert.ok(Math.hypot(singing.x-initial.x,singing.y-initial.y)<4,'branch performers sing on their branch first');
      assert.equal(singing.alpha,1);assert.equal(singing.scale,1);
    }
    const objects=WITCH_LAYOUT.objects.map(object=>object.id===home.id?{...object,dropped:true,dropAge:10}:object);
    assert.notEqual(hitTestWitch(initial.x,initial.y,{objects})?.id,home.id,'consumed ingredients cannot be picked again');
  }
});

test('parked broom, flying fabric and hair delay strands have direct gesture targets',()=>{
  for(const trip of [0,1,2,3])for(const warpTime of [0,.7,2.8]) {
    const state={trip,warpTime};
    const broom=warpWitchPoint(getWitchTargets(state).broom,state);
    assert.deepEqual(hitTestWitch(broom.x,broom.y,state),{type:'broom'});
    for(const fabricX of [0,.5,1])for(const fabricY of [0,.5,1]) {
      const current={...state,fabricX,fabricY,flightLift:1,scene:'flight'},cloth=warpWitchPoint(getWitchTargets(current).fabric,current);
      const hit=hitTestWitch(cloth.x,cloth.y,current);
      assert.equal(hit?.type,'fabric');
      assert.notEqual(hitTestWitch(cloth.x,cloth.y,{...current,flightLift:0})?.type,'fabric','fabric only exists in flight');
    }
    for(const flightPhase of [0,1,2,3,4,5,6,8,9]) {
      const current={...state,flightLift:1,scene:'flight',flightPhase},trail=getWitchTrail(current);
      const end=trail.at(-1),tip=getWitchHair(current).strands[10].points.at(-1);
      assert.deepEqual(end,tip,'the delay strand grows directly from a visible hair tip');
      assert.ok(trail.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)));
      const visible=warpWitchPoint(getWitchTargets(current).trail,current);
      assert.deepEqual(hitTestWitch(visible.x,visible.y,current),{type:'trail'});
      assert.notDeepEqual(getWitchTrail({...current,trailPull:0,trailTwist:0}),getWitchTrail({...current,trailPull:1,trailTwist:1}));
    }
  }
});

test('the full-frame fabric stays taut at rest and follows a local anchored pull',()=>{
  const state={flightLift:1,fabricGrabX:.5,fabricGrabY:.5},rest=getWitchFabric(state);
  const points=rest.strands.flatMap(strand=>strand.points);
  assert.equal(Math.min(...points.map(p=>p.x)),0);assert.equal(Math.max(...points.map(p=>p.x)),1000);
  assert.equal(Math.min(...points.map(p=>p.y)),0);assert.equal(Math.max(...points.map(p=>p.y)),720);
  assert.deepEqual(new Set(rest.strands.map(strand=>strand.color)),new Set(['#68f7a49e','#ff5cada8']));
  assert.deepEqual(getWitchFabric({...state,handTime:99,motionTime:120}),rest,'released cloth has no independent ambient waving');
  for(const [fabricGrabX,fabricGrabY] of [[.25,.25],[.5,.5],[.7,.6]]) {
    const held={...state,fabricHeld:true,fabricGrabX,fabricGrabY,fabricPullX:150,fabricPullY:-90};
    const pulled=getWitchFabric(held);
    assert.equal(pulled.target.x,fabricGrabX*1000+150);assert.equal(pulled.target.y,fabricGrabY*720-90);
    assert.deepEqual(getWitchTargets(held).fabric,pulled.target,'the held gesture stays at the same deformed mesh point');
    let localMovement=0;
    for(const [i,strand] of rest.strands.entries())for(const [j,p] of strand.points.entries()) {
      const q=pulled.strands[i].points[j];
      assert.ok(Number.isFinite(q.x)&&Number.isFinite(q.y));
      if(p.x===0||p.x===1000||p.y===0||p.y===720)assert.deepEqual(q,p,'the complete cloth perimeter stays anchored');
      if(Math.hypot(p.x-fabricGrabX*1000,p.y-fabricGrabY*720)<35)localMovement=Math.max(localMovement,Math.hypot(q.x-p.x,q.y-p.y));
    }
    assert.ok(localMovement>120,'grabbing the cloth produces substantial local deformation');
  }
});

test('fabric stays behind the witch body, larger boots and complete cauldron silhouette',()=>{
  for(const flightPhase of [0,2,8,17])for(const visualMode of [0,1,2,3,4,5,6,7])for(const hitRadius of [46,80]) {
    const state={flightLift:1,flightPhase,visualMode,warpTime:flightPhase,handReach:1,hitRadius,fabricGrabX:.5,fabricGrabY:.5};
    const body=broomTransform(state),project=([x,y])=>({
      x:body.x+(Math.cos(body.rotation)*x-Math.sin(body.rotation)*y)*body.scale,
      y:body.y+(Math.sin(body.rotation)*x+Math.cos(body.rotation)*y)*body.scale,
    });
    const points=[[-55,30],[-120,178],[-175,194],[-200,190]].map(project);
    points.push({x:600,y:610},{x:600,y:685},{x:476,y:680});
    for(const point of points) {
      const p=warpWitchPoint(point,state),hit=hitTestWitch(p.x,p.y,state);
      assert.ok(hit&&!['fabric','trail'].includes(hit.type),'solid foreground anatomy and fire never pluck an obscured sky layer');
    }
    const idle=warpWitchPoint(getWitchTargets(state).fabric,state);
    assert.equal(hitTestWitch(idle.x,idle.y,state)?.type,'fabric','an exposed fabric target survives every visual distortion');
  }
});

test('ingredient touch halos preserve scenery targets and choose the nearest object',()=>{
  for(const time of [0,1,4,17,39]) {
    const state={time,handReach:1,hitRadius:80};
    for(const [point,type] of [[WITCH_LAYOUT.moon,'moon'],...WITCH_LAYOUT.mushrooms.map(point=>[
      {x:point.x+34*point.scale,y:point.y+5*point.scale},'mushrooms']),
      [getWitchTargets(state).spider,'spider']]) {
      assert.equal(hitTestWitch(point.x,point.y,state)?.type,type,`${type} at ${point.x},${point.y}`);
    }
  }
  const objects=WITCH_LAYOUT.objects.map(object=>({...object,dropped:true}));
  objects[0]={...objects[0],x:140,y:100,dragging:true,dropped:false};
  objects[1]={...objects[1],x:200,y:100,dragging:true,dropped:false};
  const state={objects,hitRadius:80};
  assert.equal(hitTestWitch(193,100,state)?.id,'hyper-rubix');
  assert.equal(hitTestWitch(148,100,state)?.id,'glass');
  assert.equal(hitTestWitch(200,156,state)?.id,'hyper-rubix');
  objects[1].dropped=true;
  assert.equal(hitTestWitch(193,100,state)?.id,'glass');
});

test('three named ghost performers drift on the shared beat and stay quiet at every focus',()=>{
  assert.deepEqual(WITCH_LAYOUT.ghosts.map(ghost=>ghost.id),['creaturazoid','monstroid','hiccup']);
  const quiet={ghostPhase:12,ghostPresence:[0,0,0],ghostPulses:[0,0,0]};
  const phrase={...quiet,ghostPresence:[1,.5,.8],ghostPulses:[1,1,1]};
  for(let index=0;index<3;index++) {
    const absent=getWitchGhostPosition(index,quiet),present=getWitchGhostPosition(index,phrase);
    assert.equal(absent.alpha,.025,'quiet wisps remain available to drag between phrases');
    assert.ok(present.alpha>absent.alpha&&present.alpha<=.22);
    assert.equal(present.scale,1,'beat attacks cannot advance a ghost toward the viewer');
    assert.deepEqual(getWitchGhostPosition(index,{...phrase,scene:'flight',flightLift:1,handReach:1,event:{kind:'ghost',age:0}}),present);
    assert.deepEqual(getWitchGhostPosition(index,{...phrase,time:8391,motionTime:21}),present,'wall time cannot make an independent beat');
    assert.notEqual(getWitchGhostPosition(index,{...phrase,ghostPhase:32}).x,present.x);
    const frozen={...phrase,reducedMotion:true};
    assert.deepEqual(getWitchGhostPosition(index,{...frozen,ghostPhase:1}),getWitchGhostPosition(index,{...frozen,ghostPhase:999}));
  }
});

test('ghost tempo gestures follow exposed wisps and disappear with the ground during flight',()=>{
  for(const ghostPhase of [0,4,17,39,120,1000])for(const hitRadius of [46,80])for(const visualMode of [0,3,7]) {
    const state={handReach:1,hitRadius,visualMode,warpTime:ghostPhase,ghostPhase};
    for(let index=0;index<3;index++) {
      const ghost=getWitchGhostPosition(index,state);
      const exposed=[.3,.6,.9].flatMap(radius=>Array.from({length:36},(_,i)=>({x:ghost.x+Math.cos(i*Math.PI/18)*ghost.r*radius,y:ghost.y+Math.sin(i*Math.PI/18)*ghost.r*radius})));
      assert.ok(exposed.some(p=>{const q=warpWitchPoint(p,state);const hit=hitTestWitch(q.x,q.y,state);return hit?.type==='ghost'&&hit.index===index;}),`${ghost.id} has an exposed wisp at phase ${ghostPhase}`);
      for(const p of exposed) {
        const q=warpWitchPoint(p,state);
        assert.notEqual(hitTestWitch(q.x,q.y,{...state,flightLift:1})?.type,'ghost','hidden ghosts cannot intercept flight gestures');
      }
    }
  }
});

// Inspect actual draw calls, including the cached portrait canvases, to prove
// depth rather than merely pinning source-code statement order.
function captureWitchPaint() {
  const canvases=[];
  const document={createElement(tag) {
    if(tag==='img')return {complete:true,naturalWidth:512,src:''};
    const canvas={ownerDocument:document,width:0,height:0,cloneNode:()=>document.createElement('canvas')};
    const calls=[],stack=[];
    const context=new Proxy({canvas,calls,globalAlpha:1,dash:[],save(){stack.push(this.globalAlpha);},restore(){this.globalAlpha=stack.pop();},
      createLinearGradient(){return {addColorStop(){}};},createRadialGradient(){return {addColorStop(){}};},
      beginPath(){this.lastEllipse=null;},ellipse(x,y,rx,ry){this.lastEllipse={x,y,rx,ry};},
      fill(shape){calls.push({kind:'fill',path:shape?.d,alpha:this.globalAlpha,color:this.fillStyle,ellipse:shape?null:this.lastEllipse});},
      setLineDash(dash){this.dash=[...dash];},
      stroke(){calls.push({kind:'stroke',color:this.strokeStyle,width:this.lineWidth,dash:[...(this.dash||[])]});},
      fillText(value){calls.push({kind:'text',value});},
      fillRect(...args){calls.push({kind:'rect',args,alpha:this.globalAlpha,color:this.fillStyle});},
      clearRect(...args){calls.push({kind:'clear',args});},
      drawImage(source,...args){calls.push({kind:'image',source,args,alpha:this.globalAlpha});},
      getImageData(){
        const data=new Uint8ClampedArray(160*160*4);
        for(let p=0;p<data.length;p+=4)data[p+3]=255;
        for(let y=40;y<120;y++)for(let x=40;x<120;x++)data.set([80,140,190,255],(y*160+x)*4);
        data.set([0,0,0,255],(70*160+80)*4); // Enclosed dark anatomy.
        return {data,width:160,height:160};
      },
      putImageData(pixels){calls.push({kind:'pixels',pixels});},
    },{get(target,key){return key in target?target[key]:(()=>{});}});
    canvas.getContext=()=>context;canvases.push(canvas);return canvas;
  }};
  const canvas=document.createElement('canvas');
  return {context:canvas.getContext('2d'),canvases};
}

const portraitUrl=call=>call.kind==='image'?(call.source.src||call.source?.getContext?.('2d').calls.find(entry=>entry.kind==='image'&&entry.source.src)?.source.src):null;

test('flying fabric paints behind the scene and both long hair locks carry Candy Coil stripes',()=>{
  const previousPath=globalThis.Path2D;
  globalThis.Path2D=class {constructor(d){this.d=d;}};
  try {
    const state={flightLift:1,flightPhase:2,trailFeedback:.8};
    const {context,canvases}=captureWitchPaint();renderWitch(context,1000,720,state);
    const world=canvases[1].getContext('2d').calls;
    const grid=world.map((call,index)=>({call,index})).filter(({call})=>call.kind==='stroke'&&['#68f7a49e','#ff5cada8'].includes(call.color));
    assert.ok(grid.length>40,'the native colored mesh spans the entire sky');
    const moon=world.findIndex(call=>call.kind==='fill'&&call.ellipse?.x===WITCH_LAYOUT.moon.x&&call.ellipse?.y===WITCH_LAYOUT.moon.y&&call.ellipse?.rx===WITCH_LAYOUT.moon.r);
    const body=world.findIndex(call=>call.kind==='fill'&&call.path?.startsWith('M-67,-32'));
    assert.ok(grid.at(-1).index<moon&&grid.at(-1).index<body,'moon and flying witch occlude the background cloth');
    const red=world.filter(call=>call.kind==='stroke'&&call.color==='#dc2f3f');
    assert.equal(red.length,2);assert.equal(world.filter(call=>call.kind==='stroke'&&call.color==='#fff7ea').length,2);
    assert.ok(red.every(call=>call.dash.length===2&&call.dash.every(value=>value>0)),'each cream lock has a repeated red stripe');
  } finally {if(previousPath===undefined)delete globalThis.Path2D;else globalThis.Path2D=previousPath;}
});

test('BLECH flybys use the larger actual instrument portrait',()=>{
  const previousPath=globalThis.Path2D;
  globalThis.Path2D=class {constructor(d){this.d=d;}};
  try {
    for(const [flybyTime,count] of [[0,0],[7,1],[18.8,2]]) {
      const {context,canvases}=captureWitchPaint();renderWitch(context,1000,720,{flightLift:1,flybyTime});
      const flybys=canvases[1].getContext('2d').calls.filter(call=>call.args?.length===8&&portraitUrl(call)?.endsWith('/blech-midi.webp'));
      assert.equal(flybys.length,count,'the same sparse phrase schedule controls the visible logos');
      for(const call of flybys) {
        const [, , , , , ,width,height]=call.args;
        assert.ok(Math.abs(width-54*2.1)<1e-10&&Math.abs(height-54*2.1)<1e-10,'airborne artwork is forty percent larger than its former 1.5 scale');
      }
    }
  } finally {if(previousPath===undefined)delete globalThis.Path2D;else globalThis.Path2D=previousPath;}
});

test('capturing the native spider leaves its web and carries one model into the potion',()=>{
  const previousPath=globalThis.Path2D;
  globalThis.Path2D=class {constructor(d){this.d=d;}};
  try {
    const spiderSurface={},home=getWitchObjectPosition('spider'),target=getWitchTargets({}).spider;
    for(const [spiderCaptured,dropAge,flightLift,count] of [[false,0,0,1],[true,.6,0,1],[true,.6,1,1],[true,5,0,0]]) {
      const objects=WITCH_LAYOUT.objects.map(object=>object.id==='spider'?{...object,x:home.x,y:home.y,dropped:spiderCaptured,dropAge}:object);
      const state={spiderSurface,spiderCaptured,objects,flightLift};
      const {context,canvases}=captureWitchPaint();renderWitch(context,1000,720,state);
      const world=canvases[1].getContext('2d').calls;
      assert.equal(world.filter(call=>call.kind==='image'&&call.source===spiderSurface).length,count,'no static duplicate stays in the tree during the dive');
      if(!flightLift)assert.ok(world.some(call=>call.kind==='stroke'&&call.color==='#adc7d47a'),'the catching threads remain after their spider is consumed');
      if(spiderCaptured)assert.notEqual(hitTestWitch(target.x,target.y,state)?.type,'spider');
      else assert.equal(hitTestWitch(target.x,target.y,state)?.type,'spider');
    }
  } finally {if(previousPath===undefined)delete globalThis.Path2D;else globalThis.Path2D=previousPath;}
});

test('spectral instrument portraits always paint behind witch, pot, hands and solo ingredients',()=>{
  const previousPath=globalThis.Path2D;
  globalThis.Path2D=class {constructor(d){this.d=d;}};
  try {
    for(const scene of ['brew','flight']) {
      const {context,canvases}=captureWitchPaint(),hand0={},hand1={};
      renderWitch(context,1000,720,{scene,flightLift:scene==='flight'?1:0,handReach:1,
        handSurface:hand0,handSurfaces:[hand0,hand1],ghostPresence:[1,1,1],ghostPulses:[1,1,1],ghostPhase:4,
        objects:WITCH_LAYOUT.objects.map(object=>object.id==='hiccup'?{...object,dropped:true,dropAge:.3}:object)});
      const world=canvases[1].getContext('2d').calls;
      const isGhost=call=>call.args?.length===4&&call.args[2]>90&&/\/(creaturazoid|colony-syrinx|hiccup-head-bloody)\.webp$/.test(portraitUrl(call)||'');
      const portraits=world.map((call,index)=>({call,index})).filter(({call})=>isGhost(call));
      assert.equal(portraits.length,scene==='flight'?0:3,'ghosts fade out with ground scenery in flight');
      if(scene==='flight')continue;
      for(const {call} of portraits.slice(0,2)) {
        const pixels=call.source.getContext('2d').calls.find(entry=>entry.kind==='pixels').pixels.data;
        assert.equal(pixels[3],0,'opaque black portrait corners become transparent before tinting');
        assert.equal(pixels[(70*160+80)*4+3],255,'enclosed dark anatomy remains opaque');
        assert.equal(pixels[(50*160+50)*4+3],255,'colored anatomy remains opaque');
      }
      for(const {call,index} of portraits) {
        assert.ok(call.alpha<=.22&&call.alpha>0);
        assert.ok(world.findIndex(entry=>entry.kind==='fill'&&entry.path?.startsWith('M412,520'))>index,'cauldron occludes ghosts');
        assert.ok(world.findIndex(entry=>entry.kind==='image'&&entry.source===hand0)>index,'extended hand occludes ghosts');
        assert.ok(world.findIndex(entry=>entry.kind==='image'&&entry.source===hand1)>index,'ladle/broom hand occludes ghosts');
        assert.ok(world.findIndex(entry=>entry.args?.length===8&&/\/hiccup-head\.webp$/.test(portraitUrl(entry)||''))>index,'featured miniature stays in front');
      }
      const witchBody=world.findIndex(entry=>entry.kind==='fill'&&entry.path?.startsWith(scene==='flight'?'M-67,-32':'M398,360'));
      assert.ok(witchBody>portraits.at(-1).index,'the same depth applies while flying');
    }
  } finally {if(previousPath===undefined)delete globalThis.Path2D;else globalThis.Path2D=previousPath;}
});


test('the enlarged turned ladle hand holds the spoon in its real palm throughout takeoff and stirring',()=>{
  const state={handReach:1,handWrists:[{x:590,y:590},{x:588,y:593}],handPalms:[{x:588,y:516},{x:583,y:512}],radius:.76};
  for(const flightLift of [0,.15,.5,.8,1])for(const flightPhase of [0,.5,2,8,17])for(const phase of [0,1.7,4.2])for(const spoonHeight of [0,.5,1]) {
    const current={...state,flightLift,flightPhase,phase,spoonHeight},ladle=getWitchLadle(current),t=handTransform(current,1);
    const palm=transformHandPoint(state.handPalms[1],current,1),wrist=transformHandPoint(state.handWrists[1],current,1);
    assert.ok(Math.hypot(palm.x-ladle.gx,palm.y-ladle.gy)<1e-10,'shaft passes through projected palm');
    assert.deepEqual(wrist,t.wrist);
    assert.ok(Math.abs((ladle.gx-ladle.lx)*(ladle.ty-ladle.ly)-(ladle.gy-ladle.ly)*(ladle.tx-ladle.lx))<1e-8,'grip and handle lie on the same shaft');
    const ground=getWitchLadle({...current,flightLift:0});
    assert.equal(ladle.lx,ground.lx);assert.equal(ladle.ly,ground.ly,'bowl keeps stirring the same cauldron during flight');
  }
  const ground=handTransform({...state,flightLift:0},1),flying=handTransform({...state,flightLift:1},1);
  assert.ok(Math.abs(flying.scale-.54*1.3*.28*1.25*1.25)<1e-12&&flying.scale<ground.scale,'ladle hand follows the larger flying body and remains smaller than its grounded model');
  const first=getWitchLadle({...state,flightLift:1,flightPhase:0}),later=getWitchLadle({...state,flightLift:1,flightPhase:3});
  assert.ok(Math.hypot(first.gx-later.gx,first.gy-later.gy)>30,'spoon grip travels with the flying witch');
  assert.equal(first.lx,later.lx);assert.equal(first.ly,later.ly);
});

test('both actual hand models become body-sized and travel with the flying witch',()=>{
  const state={handReach:1};
  for(const index of [0,1]) {
    const ground=handTransform(state,index),first=handTransform({...state,flightLift:1,flightPhase:0},index);
    const later=handTransform({...state,flightLift:1,flightPhase:3},index);
    assert.ok(Math.abs(first.scale-.54*1.3*(index===0?.48:.28*1.25*1.25))<1e-12&&first.scale<ground.scale,'both hands share the 30% larger flight scale');
    assert.ok(Math.hypot(first.wrist.x-later.wrist.x,first.wrist.y-later.wrist.y)>50,'neither hand remains pinned to the foreground');
    for(const phase of [0,2,4,6,8]) {
      const current={...state,flightLift:1,flightPhase:phase},hand=handTransform(current,index),body=broomTransform(current);
      assert.ok(Math.hypot(hand.wrist.x-body.x,hand.wrist.y-body.y)<250*body.scale,'wrists stay within the same body-relative reach');
    }
  }
});

test('the ladle sleeve stays behind both faces and all instrument minis use their catalogue portraits',()=>{
  const previousPath=globalThis.Path2D;
  globalThis.Path2D=class {constructor(d){this.d=d;}};
  try {
    for(const flightLift of [0,.5,1]) {
      const {context,canvases}=captureWitchPaint(),hand0={},hand1={};
      renderWitch(context,1000,720,{handReach:1,handSurface:hand0,handSurfaces:[hand0,hand1],flightLift,flightPhase:1.7});
      const world=canvases[1].getContext('2d').calls;
      const sleeve=world.findIndex(call=>call.kind==='fill'&&call.color==='#48324b');
      const faces=world.map((call,index)=>({call,index})).filter(({call})=>call.kind==='fill'&&call.path?.startsWith('M-35,-30'));
      assert.ok(sleeve>=0&&faces.length>=1);
      for(const {index} of faces)assert.ok(index>sleeve,'face occludes the sleeve at every flight transition');
      assert.equal(world.filter(call=>call.kind==='image'&&call.source===hand1).length,1,'one continuous ladle hand, without a duplicate flight copy');
      const portraits=world.map((call,index)=>({call,index,url:portraitUrl(call)})).filter(({call,url})=>url&&call.args.length===8&&!url.endsWith('/spider-synth.webp'));
      const restingPortraits=WITCH_LAYOUT.objects.filter(object=>object.location!=='web');
      assert.equal(portraits.length,flightLift===1?0:restingPortraits.length,'grounded shelf and branch objects use their catalogue portraits');
      const body=world.findIndex(call=>call.kind==='fill'&&call.path?.startsWith(flightLift===1?'M-67,-32':'M398,360'));
      for(const object of flightLift===1?[]:restingPortraits) {
        const matching=portraits.filter(({url})=>url.endsWith('/'+object.imageHref));
        assert.equal(matching.length,1,object.name+' uses its actual instrument icon');
        assert.ok(matching[0].index<body,'stationary instruments paint behind the witch');
        const pixels=matching[0].call.source.getContext('2d').calls.find(call=>call.kind==='pixels').pixels.data;
        assert.equal(pixels[3],0,'black square backgrounds are cut away');
        assert.equal(pixels[(70*160+80)*4+3],255,'enclosed dark details remain');
      }
      assert.deepEqual(world.filter(call=>call.kind==='text').map(call=>call.value),['20','20','7','13','4'],
        'only the D20 face engravings add text; shelf names stay absent in brew and flight');
    }
  } finally {if(previousPath===undefined)delete globalThis.Path2D;else globalThis.Path2D=previousPath;}
});

test('eight preset palettes keep gesture geometry and mushroom deformation independent',()=>{
  const previousPath=globalThis.Path2D;
  globalThis.Path2D=class {constructor(d){this.d=d;}};
  try {
    const filters=new Set(),point={x:160,y:280};
    for(let palette=0;palette<8;palette++)for(let trip=0;trip<4;trip++) {
      const state={palette,trip,warpTime:2.7};
      assert.deepEqual(warpWitchPoint(point,state),warpWitchPoint(point,{...state,palette:0}));
      const {context,canvases}=captureWitchPaint();renderWitch(context,1000,720,state);
      const filter=canvases[2].getContext('2d').filter;
      if(!trip)filters.add(palette===0?'none':filter);
      if(palette||trip)assert.match(filter,/^hue-rotate\([0-9]+deg\) saturate\(/);
      const composites=context.calls.filter(call=>call.kind==='image');
      assert.equal(composites.length,trip?180:1,'color is a single cache pass and only mushroom warping adds strips');
    }
    assert.equal(filters.size,8);
  } finally {if(previousPath===undefined)delete globalThis.Path2D;else globalThis.Path2D=previousPath;}
});


test('hair pulls extend the same rooted locks along the advertised gesture axis',()=>{
  for(const flightLift of [0,.25,.5,.75,1])for(const flightPhase of [0,1,4,9]) {
    const state={flightLift,flightPhase,handTime:3.7,hat:.8};
    const slack=getWitchHair({...state,hair:0}),pulled=getWitchHair({...state,hair:1});
    assert.deepEqual(pulled.root,slack.root,'a pull never detaches hair from the scalp');
    assert.ok(Math.abs(Math.hypot(pulled.axis.x,pulled.axis.y)-1)<1e-12);
    assert.ok(Math.abs(pulled.tip.x-slack.tip.x-pulled.axis.x*pulled.pullDistance)<1e-10);
    assert.ok(Math.abs(pulled.tip.y-slack.tip.y-pulled.axis.y*pulled.pullDistance)<1e-10);
    for(const amount of [0,.5,1]) {
      const hair=getWitchHair({...state,hair:amount});
      assert.equal(hair.strands.length,23);
      for(const strand of hair.strands) {
        assert.equal(strand.points.length,21,'strand geometry has a fixed rendering budget');
        for(const p of strand.points)assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>80&&p.x<900&&p.y>100&&p.y<600);
      }
      // The existing face crossfade draws both heads. Picking uses the more
      // visible head, never an interpolated position in empty space between them.
      const nose=getWitchTargets({...state,hair:amount}).nose;
      assert.ok(Math.hypot(hair.root.x-nose.x,hair.root.y-nose.y)<175*hair.scale);
    }
  }
});

test('flying hair whips into snakes on the performance clock while reduced motion stays still',()=>{
  const base={hair:.7,handTime:3.2,flightPhase:1.3};
  const ground=getWitchHair({...base,flightLift:0}),flying=getWitchHair({...base,flightLift:1});
  const extension=h=>Math.hypot(h.tip.x-h.root.x,h.tip.y-h.root.y)/h.scale;
  assert.ok(extension(flying)>extension(ground)*1.1,'flight sweeps the free ends well behind the scalp');
  assert.notDeepEqual(getWitchHair({...base,flightLift:1,handTime:3.8}).strands,flying.strands,'the shared musical clock whips the locks');
  assert.deepEqual(getWitchHair({...base,time:999}),getWitchHair({...base,time:1}),'wall time does not animate stopped hair');
  for(const flightLift of [0,1]) {
    const reduced={...base,flightLift,reducedMotion:true};
    assert.deepEqual(getWitchHair({...reduced,time:1,handTime:1,flightPhase:1}),getWitchHair({...reduced,time:999,handTime:999,flightPhase:999}));
    assert.notDeepEqual(getWitchHair({...reduced,hair:0}).tip,getWitchHair({...reduced,hair:1}).tip,'direct pulls remain responsive without automatic wiggles');
  }
});

test('visible hair locks remain pickable in brew and flight without replacing existing targets',()=>{
  for(const hair of [0,.5,1])for(const flightLift of [0,1])for(const flightPhase of [0,.5,2,4,8,17])for(const hitRadius of [46,67,80])for(let trip=0;trip<4;trip++) {
    const state={hair,flightLift,flightPhase,hitRadius,trip,warpTime:2.8,handTime:3.7,handReach:1,scene:flightLift?'flight':'brew'};
    const geometry=getWitchHair(state);
    assert.ok(geometry.targets.some(target=>{
      const p=warpWitchPoint(target,state);
      return hitTestWitch(p.x,p.y,state)?.type==='hair';
    }),'some exposed lock can always start a pull');
    const previous={...state,hair:0},targets=getWitchTargets(state),ladle=getWitchLadle(state);
    const points=[targets.nose,targets.hat,{x:ladle.hx-8,y:ladle.hy-24},WITCH_LAYOUT.moon,...WITCH_LAYOUT.mushrooms,...WITCH_LAYOUT.objects];
    for(const target of points) {
      const p=warpWitchPoint(target,state),before=hitTestWitch(p.x,p.y,previous),after=hitTestWitch(p.x,p.y,state);
      if(before&&!['hair','trail','flight','fabric'].includes(before.type))assert.deepEqual(after,before,'hair cannot take an established object or performer target');
    }
  }
  const state={hair:.5,handTime:2};
  const target=getWitchHair(state).targets.find(p=>hitTestWitch(p.x,p.y,state)?.type==='hair');
  assert.ok(target);
  const foreground={...state,handReach:1,handTips:[{index:2,...transformHandPoint(target,{...state,handReach:1},0,true)}]};
  assert.deepEqual(hitTestWitch(target.x,target.y,foreground),{type:'finger',index:2},'actual foreground fingertips still win over hair');
});

test('foreground hair remains playable where hidden ground ghosts once stood',()=>{
  for(const hitRadius of [67,80])for(const visualMode of [0,3,7]) {
    const state={hair:0,flightLift:1,flightPhase:5.75,handTime:3.7,handReach:1,scene:'flight',hitRadius,visualMode,warpTime:2.8};
    const lock=getWitchHair(state).targets[0],point=warpWitchPoint(lock,state);
    assert.deepEqual(hitTestWitch(point.x,point.y,state),{type:'hair'});
    const clear={...state,flightPhase:2},exposed=warpWitchPoint(getWitchGhostPosition(0,clear),clear);
    assert.notEqual(hitTestWitch(exposed.x,exposed.y,clear)?.type,'ghost','ground performers stay hidden through the whole flight');
  }
});


test('the enlarged flying rig follows longer returning loops while its grounded scale stays fixed',()=>{
  const route=Array.from({length:1201},(_,i)=>broomTransform({flightLift:1,flightPhase:i*.05,trailTwist:1}));
  const reversals=route.slice(2).filter((p,i)=>(p.x-route[i+1].x)*(route[i+1].x-route[i].x)<0).length;
  assert.ok(reversals>25,'the long sweep contains repeated local doublebacks');
  for(const hat of [0,.5,1])for(const flightLift of [0,.2,.5,.8,1])for(const flightPhase of [0,1,3,7,19]) {
    const state={hat,flightLift,flightPhase,handReach:1,altitude:.8,flightX:.2};
    const body=broomTransform(state),tallHat=Math.max(0,hat-.5)*2;
    const oldScale=.8-(.26+tallHat*.04)*flightLift;
    assert.ok(Math.abs(body.x-(455+(582+(state.flightX-.5)*120-455)*flightLift))<=165*flightLift+1e-9);
    assert.ok(Math.abs(body.y-(476+(350+tallHat*16+(.5-state.altitude)*36-476)*flightLift))<=47*flightLift+1e-9);
    if(flightLift===0)assert.equal(body.scale,oldScale,'grounded broom and witch keep their existing scale');
    if(flightLift===1) {
      assert.ok(Math.abs(body.scale/oldScale-1.3)<1e-12);
      assert.ok(Math.abs(getWitchHair(state).scale/body.scale-1)<1e-12,'hair uses the larger face transform');
      for(const index of [0,1])assert.ok(Math.abs(handTransform(state,index).scale/body.scale-(index===0?.48:.28*1.25*1.25))<1e-12,'both hands retain their body-relative scale');
    }
  }
});

test('the enlarged flying hat, hair, broom and boots remain inside the warped scene at extremes',()=>{
  // Inspect both the restored original silhouette and the burned panels.
  const broomPoints=[[-295,120],[-265,126],[-310,152],[162,96],[-207,177],[-200,193],[-187,188],[-159,216],[-117,193]];
  const turn=(p,rotation,scale=1)=>({x:(Math.cos(rotation)*p.x-Math.sin(rotation)*p.y)*scale,y:(Math.sin(rotation)*p.x+Math.cos(rotation)*p.y)*scale});
  for(const hatClicks of [0,2])for(let phase=0;phase<Math.PI*20;phase+=.2)for(const hat of [0,.5,1])for(const altitude of [0,1])for(const flightX of [0,1]) {
    const state={flightLift:1,flightPhase:phase,hat,hatClicks,altitude,flightX,hair:1,handTime:phase,trip:3,warpTime:phase,energy:1,time:phase};
    const body=broomTransform(state);
    const worldPoint=p=>{const q=turn(p,body.rotation,body.scale);return {x:body.x+q.x,y:body.y+q.y};};
    const hatWorld=getWitchHat(state).panels.flat();
    const points=[...hatWorld,...broomPoints.map(([x,y])=>worldPoint({x,y})),...getWitchHair(state).strands.flatMap(strand=>strand.points)];
    for(const point of points) {
      const p=warpWitchPoint(point,state);
      assert.ok(p.x>10&&p.x<990&&p.y>20&&p.y<610,'larger flight anatomy stays inside the playable viewbox');
    }
  }
});

test('eye shock leaves the outer flying broom stroke inside the screen at its extreme right sweep',()=>{
  const state={flightLift:1,hat:0,altitude:0,flightX:1,flightPhase:56.1,visualMode:3,eyeShock:1,warpTime:30.095};
  const body=broomTransform(state),point={x:body.x+(Math.cos(body.rotation)*166-Math.sin(body.rotation)*94)*body.scale,
    y:body.y+(Math.sin(body.rotation)*166+Math.cos(body.rotation)*94)*body.scale};
  const visible=warpWitchPoint(point,state);
  assert.ok(visible.x+5.5*body.scale*1.05<1000);
});

test('the spoon shows one color mote per native singing preset',()=>{
  const previousPath=globalThis.Path2D;
  globalThis.Path2D=class {constructor(d){this.d=d;}};
  try {
    const colors=new Set(['#cfb8ee','#78ccdc','#addc94','#dfaa7d','#e6a4c9','#f2bf83','#bb9de7']);
    for(const spoonHeight of [0,.5,1]) {
      const {context,canvases}=captureWitchPaint();renderWitch(context,1000,720,{spoonHeight});
      const motes=canvases[1].getContext('2d').calls.filter(call=>call.kind==='fill'&&call.ellipse&&colors.has(call.color));
      assert.equal(motes.length,WITCH_VOICES.length);
      assert.equal(new Set(motes.map(mote=>mote.color)).size,WITCH_VOICES.length,'every native voice has a distinct mote');
      assert.equal(motes.filter(mote=>mote.ellipse.rx===3.4).length,1,'one singing state is featured at any spoon height');
      assert.equal(motes[Math.min(WITCH_VOICES.length-1,Math.floor(spoonHeight*WITCH_VOICES.length))].ellipse.rx,3.4);
      assert.ok(Math.max(...motes.map(m=>m.ellipse.y))-Math.min(...motes.map(m=>m.ellipse.y))<=140,'new voices share the existing compact spoon range');
    }
  } finally {if(previousPath===undefined)delete globalThis.Path2D;else globalThis.Path2D=previousPath;}
});

test('visible portrait alpha rests directly on the shelf boards and tree branches',()=>{
  const previousPath=globalThis.Path2D;
  globalThis.Path2D=class {constructor(d){this.d=d;}};
  try {
    const {context,canvases}=captureWitchPaint();renderWitch(context,1000,720,{});
    const world=canvases[1].getContext('2d').calls;
    const cupboardTop=[];
    for(const [index,object] of WITCH_LAYOUT.objects.entries()) {
      if(object.location==='web')continue; // the web owns the native spider model at rest
      const image=world.find(call=>call.kind==='image'&&call.args.length===8&&portraitUrl(call)?.endsWith('/'+object.imageHref));
      assert.ok(image,object.id);
      const [sx,sy,sw,sh,dx,dy,dw,dh]=image.args;
      assert.deepEqual([sx,sy,sw,sh],[40,40,80,80],'transparent margins are cropped using the cached alpha bounds');
      const size=object.r/28;
      assert.equal(dy+dh,27*size,'the visible bottom, not the source rectangle, sits on the support');
      assert.ok(dw<=56*size+1e-10&&dh<=54*size+1e-10&&dx===-dw/2);
      const position=getWitchObjectPosition(object,{});
      if(index<18)assert.equal(position.y+dy+dh,WITCH_LAYOUT.shelves[0].rows[Math.floor(index/3)]);
      else if(object.location==='cupboard-top') {
        assert.equal(position.y+dy+dh,147);
        const left=position.x+dx,right=left+dw,y=position.y+dy+dh/2;
        cupboardTop.push({left,right});
        for(const x of [left+2,position.x,right-2])assert.equal(hitTestWitch(x,y,{hitRadius:80})?.id,object.id,'visible top portraits keep distinct touch targets');
      }
      else assert.ok(getWitchTree({}).segments.some(({a,b})=>distanceToPolyline({x:position.x,y:position.y+27*size},[a,b])<1e-10),'tree icons sit on actual turtle branches');
    }
    assert.equal(cupboardTop.length,5);
    const shelf=WITCH_LAYOUT.shelves[0];
    for(const [index,portrait] of cupboardTop.entries()) {
      assert.ok(portrait.left>=shelf.x&&portrait.right<=shelf.x+shelf.w,'all five portraits fit on the cupboard top');
      if(index)assert.ok(portrait.left>cupboardTop[index-1].right,'the five visible portraits do not overlap');
    }
  } finally {if(previousPath===undefined)delete globalThis.Path2D;else globalThis.Path2D=previousPath;}
});

test('six upright L-system trees have deterministic bounded branches and reachable trunks',()=>{
  const shapes=new Set();
  for(let treeShape=0;treeShape<6;treeShape++) {
    const state={treeShape},tree=getWitchTree(state);
    assert.equal(tree,getWitchTree({...state,handTime:500}), 'tree geometry is cached independently of animation time');
    assert.ok(tree.segments.length>=63&&tree.segments.length<=512);
    assert.equal(tree.root.y,692);
    assert.ok(tree.segments.every(segment=>[segment.a,segment.b].every(p=>p.x>=710&&p.x<=980&&p.y>=20&&p.y<=692)));
    assert.deepEqual(new Set(Object.keys(tree.objects)),new Set(WITCH_TREE_OBJECTS.map(object=>object.id)));
    const creature=getWitchObjectPosition('eyeball',state);
    assert.ok(creature.y<300&&creature.y+creature.r<400,'Creaturazoid rests on an upper branch well above the mushroom controls');
    for(const hitRadius of [46,80])assert.equal(hitTestWitch(tree.target.x,tree.target.y,{...state,hitRadius})?.type,'tree');
    shapes.add(JSON.stringify(tree.segments));
  }
  assert.equal(shapes.size,6);
});

test('branch spread and curl preserve neutral trees while continuously changing native geometry',()=>{
  const width=tree=>{const xs=tree.segments.flatMap(segment=>[segment.a.x,segment.b.x]);return Math.max(...xs)-Math.min(...xs);};
  for(let treeShape=0;treeShape<6;treeShape++) {
    const neutral=getWitchTree({treeShape}),source=L_SYSTEM_PRESETS[[0,1,2,0,1,2][treeShape]];
    const trace=traceLSystem({...source,iterations:[5,3,3,6,3,3][treeShape],angle:[31,25,29,41,36,18][treeShape],turnAsymmetry:treeShape%2?.15:-.08,maxSymbols:6000});
    const b=trace.bounds,project=p=>({x:710+(p.y-b.minY)/Math.max(.01,b.maxY-b.minY)*270,y:692-(p.x-b.minX)/Math.max(.01,b.maxX-b.minX)*672});
    assert.deepEqual(neutral.segments,trace.segments.map(segment=>({a:project(segment.start),b:project(segment.end),depth:segment.forkDepth/Math.max(1,trace.maxForkDepth),generation:segment.generation})),'neutral branches retain their original native trace and projection');
    assert.equal(neutral,getWitchTree({treeShape,treeSpread:.5,treeCurl:.5}));
    const narrow=getWitchTree({treeShape,treeSpread:0}),wide=getWitchTree({treeShape,treeSpread:1});
    assert.ok(narrow.controls.angle<neutral.controls.angle&&wide.controls.angle>neutral.controls.angle);
    assert.ok(width(wide)>width(narrow)+20,'frame fitting does not normalize away the change in crown width');
    const left=getWitchTree({treeShape,treeCurl:0}),right=getWitchTree({treeShape,treeCurl:1});
    assert.ok(left.controls.turnAsymmetry<neutral.controls.turnAsymmetry&&right.controls.turnAsymmetry>neutral.controls.turnAsymmetry);
    assert.notDeepEqual(left.segments,right.segments,'vertical branch pulls change the native left/right turn asymmetry');
    const tiny=getWitchTree({treeShape,treeSpread:.5001,treeCurl:.5001});
    assert.notDeepEqual(tiny.segments,neutral.segments,'small continuous gestures are not rounded to a preset shape');
    assert.deepEqual(tiny.anchors,neutral.anchors,'small pulls keep the same instrument perches');
  }
});

test('deformed trees keep a fixed floor root, bounded branches and playable seated instruments',()=>{
  for(let treeShape=0;treeShape<6;treeShape++)for(const [treeSpread,treeCurl] of [[0,0],[0,1],[1,0],[1,1],[.3,.8]]) {
    const state={treeShape,treeSpread,treeCurl,handReach:1},tree=getWitchTree(state),neutral=getWitchTree({treeShape});
    assert.deepEqual(tree.root,neutral.root);assert.equal(tree.root.y,692);
    assert.ok(tree.segments.every(segment=>[segment.a,segment.b].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=710&&p.x<=980&&p.y>=20&&p.y<=692)));
    assert.equal(tree,getWitchTree({...state,handTime:999}),'unchanged controls reuse the cached native trace');
    for(const item of WITCH_TREE_OBJECTS) {
      const object=getWitchObjectPosition(item.id,state),anchor=tree.anchors[item.id],segment=tree.segments[anchor.segmentIndex];
      const support={x:segment.a.x+(segment.b.x-segment.a.x)*anchor.t,y:segment.a.y+(segment.b.y-segment.a.y)*anchor.t};
      assert.ok(Math.abs(object.x-support.x)<1e-9&&Math.abs(object.y+27*object.r/28-support.y)<1e-9,'the visible miniature bottom stays on its actual branch');
      for(const visualMode of [0,7])for(const hitRadius of [46,80]) {
        const current={...state,visualMode,hitRadius,warpTime:2.8},point=warpWitchPoint(object,current);
        assert.equal(hitTestWitch(point.x,point.y,current)?.id,item.id,'every deformed perch remains independently clickable');
      }
    }
  }
});

test('continuous tree tracing uses a bounded deterministic cache',()=>{
  const state={treeShape:2,treeSpread:.314,treeCurl:.618},first=getWitchTree(state);
  assert.equal(first,getWitchTree({...state}));
  for(let i=0;i<64;i++)getWitchTree({treeShape:i%6,treeSpread:i/63,treeCurl:1-i/63});
  const restored=getWitchTree(state);
  assert.notEqual(restored,first,'old continuous gesture entries are evicted instead of accumulating');
  assert.deepEqual(restored,first,'an evicted trace is reconstructed deterministically');
  assert.equal(restored,getWitchTree(state));
});

test('the bent spell arm meets the wrist along the actual hand axis during takeoff',()=>{
  for(const handReach of [0,.3,.7,1])for(const flightLift of [0,.3,.7,1])for(const flightPhase of [0,2,8]) {
    const state={handReach,flightLift,flightPhase},arm=getWitchSpellArm(state),hand=handTransform(state);
    assert.deepEqual(arm.wrist,hand.wrist);
    assert.ok(Math.abs(Math.hypot(arm.axis.x,arm.axis.y)-1)<1e-12);
    const forearm={x:arm.wrist.x-arm.elbow.x,y:arm.wrist.y-arm.elbow.y};
    assert.ok(Math.abs(forearm.x*arm.axis.y-forearm.y*arm.axis.x)<1e-10);
    assert.ok(forearm.x*arm.axis.x+forearm.y*arm.axis.y>0);
    assert.ok(Math.hypot(arm.elbow.x-arm.shoulder.x,arm.elbow.y-arm.shoulder.y)>15);
  }
});

test('face controls, web plucks and spider remain connected through every visual mode',()=>{
  for(let visualMode=0;visualMode<8;visualMode++)for(const eyeShock of [0,1]) {
    const state={visualMode,eyeShock,warpTime:3.5},targets=getWitchTargets(state);
    for(const type of ['nose','mouth','eyes','tree','web','spider']) {
      const point=warpWitchPoint(targets[type],state),hit=hitTestWitch(point.x,point.y,state);
      assert.equal(hit?.type,type,`${type} under mode ${visualMode}`);
      if(type==='web')assert.equal(hit.index,4);
    }
    const short=getWitchTargets({...state,nose:0}).nose,long=getWitchTargets({...state,nose:1}).nose;
    assert.ok(Math.abs(Math.hypot(long.x-short.x,long.y-short.y)-80)<1e-10,'nose pulling has the doubled eighty-pixel range');
  }
  const web=getWitchWeb({});
  for(const [index,p] of web.targets.entries())assert.deepEqual(hitTestWitch(p.x,p.y,{}),{type:'web',index});
  assert.deepEqual(web.corners,[{x:700,y:12},{x:994,y:12},{x:994,y:386}]);
  assert.deepEqual(web.center,{x:910,y:140});
});

test('distorted hit coordinates follow the actual painted strip, including static discontinuities',()=>{
  const previousPath=globalThis.Path2D;
  globalThis.Path2D=class {constructor(d){this.d=d;}};
  try {
    for(let visualMode=0;visualMode<8;visualMode++) {
      const state={visualMode,eyeShock:.7,warpTime:2.93};
      const {context}=captureWitchPaint();renderWitch(context,1000,720,state);
      const strips=context.calls.filter(call=>call.kind==='image'&&call.args.length===8);
      assert.equal(strips.length,180);
      for(const {args:[sx,sy,sw,sh,dx,dy,dw,dh]} of strips) {
        for(const offset of [.1,1.9,3.9]) {
          const point={x:367,y:sy+offset},visible=warpWitchPoint(point,state);
          assert.ok(Math.abs(visible.x-(dx+(point.x-sx)/sw*dw))<1e-10);
          assert.ok(Math.abs(visible.y-(dy+offset/sh*dh))<1e-10);
          assert.ok(Math.abs(warpWitchPoint(visible,state,true).x-point.x)<1e-10);
        }
      }
    }
  } finally {if(previousPath===undefined)delete globalThis.Path2D;else globalThis.Path2D=previousPath;}
});

test('all eight visual modes have bounded exact inverse picking and respect reduced motion',()=>{
  const patterns=new Set();
  for(let visualMode=0;visualMode<8;visualMode++) {
    const state={visualMode,warpTime:3.7,eyeShock:.7},samples=[];
    for(let y=20;y<720;y+=17) {
      const point={x:510,y},warped=warpWitchPoint(point,state),inverse=warpWitchPoint(warped,state,true);
      assert.ok(Math.abs(inverse.x-point.x)<1e-10);assert.equal(inverse.y,point.y);
      assert.ok(Math.abs(warped.x-point.x)<45);samples.push(warped.x);
      const frozen={visualMode,reducedMotion:true,eyeShock:.7};
      assert.deepEqual(warpWitchPoint(point,{...frozen,warpTime:0}),warpWitchPoint(point,{...frozen,warpTime:999}));
    }
    for(const flightLift of [0,.5,1]) {
      const current={...state,flightLift},die=warpWitchPoint(getWitchTargets(current).die,current);
      assert.deepEqual(hitTestWitch(die.x,die.y,current),{type:'dice'});
    }
    patterns.add(JSON.stringify(samples));
  }
  assert.equal(patterns.size,8);
});

test('full flight preserves controls and two separate bounded striped hair trails',()=>{
  for(let flightPhase=0;flightPhase<20;flightPhase+=.8)for(const visualMode of [0,3,7]) {
    const state={flightLift:1,flightPhase,visualMode,warpTime:flightPhase,trailSpace:1},trails=getWitchTrails(state),hair=getWitchHair(state);
    assert.equal(trails.length,2,'two long locks leave open cloth between their loops');
    assert.equal(new Set(trails.map(trail=>trail.index)).size,2);assert.notDeepEqual(trails[0].points,trails[1].points);
    for(const trail of trails) {
      assert.equal(trail.points.length,257);
      assert.ok(trail.points.every(p=>p.x>=24&&p.x<=976&&p.y>=38&&p.y<=674));
      assert.ok(Math.max(...trail.points.map(p=>p.x))-Math.min(...trail.points.map(p=>p.x))>700);
      assert.deepEqual(trail.points.at(-1),hair.strands[trail.index].points.at(-1),'each delay strand stays joined to its own visible hair lock');
      assert.equal(trail.color,'#fff7ea');assert.equal(trail.stripe,'#dc2f3f');
    }
    for(const type of ['broom','dice']) {
      const target=getWitchTargets(state)[type==='dice'?'die':'broom'],p=warpWitchPoint(target,state);
      assert.equal(hitTestWitch(p.x,p.y,state)?.type,type);
    }
    // The flying hat may cross the left-shifted moon; its exposed rim stays playable.
    const moon=WITCH_LAYOUT.moon;
    const exposed=Array.from({length:12},(_,i)=>{
      const angle=i*Math.PI/6,p=warpWitchPoint({x:moon.x+Math.cos(angle)*moon.r*.7,y:moon.y+Math.sin(angle)*moon.r*.7},state);
      return hitTestWitch(p.x,p.y,state)?.type==='moon';
    }).filter(Boolean).length;
    assert.ok(exposed>=6,'at least half the moon remains directly clickable');
    for(const type of ['tree','web','spider']) {
      const p=warpWitchPoint(getWitchTargets(state)[type],state);
      assert.notEqual(hitTestWitch(p.x,p.y,state)?.type,type);
    }
  }
  const state={flightLift:1,flightPhase:2};
  const extent=trails=>{const xs=trails.flatMap(trail=>trail.points.map(p=>p.x));return Math.max(...xs)-Math.min(...xs);};
  assert.ok(extent(getWitchTrails({...state,trailSpace:1}))>extent(getWitchTrails({...state,trailSpace:0}))*3,'stretching the delay space opens compact coils across the sky');
  assert.ok(getWitchTrails({...state,trailFeedback:1})[0].stripeLength<getWitchTrails({...state,trailFeedback:0})[0].stripeLength,'feedback winding visibly tightens the stripe spacing');
  const frozen={...state,reducedMotion:true};
  assert.deepEqual(getWitchTrails({...frozen,flightPhase:1,handTime:1}),getWitchTrails({...frozen,flightPhase:999,handTime:999}));
});

test('hair noodles coil into quarter, half and full-stage shapes with an exposed grab point',()=>{
  for(const [trailSpace,minWidth,maxWidth,minHeight,maxHeight] of [[0,170,220,110,145],[.0625,220,270,145,180],[.375,440,510,295,345],[1,900,960,600,640]]) {
    for(const flightPhase of [0,2,8,17])for(const visualMode of [0,3,7]) {
      const state={flightLift:1,flightPhase,visualMode,warpTime:flightPhase,handReach:1,trailSpace};
      for(const trail of getWitchRestTrails(state)) {
        const xs=trail.points.map(p=>p.x),ys=trail.points.map(p=>p.y),width=Math.max(...xs)-Math.min(...xs),height=Math.max(...ys)-Math.min(...ys);
        assert.ok(width>=minWidth&&width<=maxWidth&&height>=minHeight&&height<=maxHeight,'reach changes both dimensions from a small coil to the whole sky');
        assert.ok(trail.points.every(p=>p.x>=24-1e-9&&p.x<=976+1e-9&&p.y>=38-1e-9&&p.y<=674+1e-9));
      }
      const target=warpWitchPoint(getWitchTargets(state).trail,state);
      assert.equal(hitTestWitch(target.x,target.y,state)?.type,'trail','a compact coil remains reachable beside her hair and foreground anatomy');
    }
  }
  const normalized=state=>getWitchRestTrails(state).map(({points})=>{
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y),left=Math.min(...xs),top=Math.min(...ys),width=Math.max(...xs)-left,height=Math.max(...ys)-top;
    return points.map(p=>({x:(p.x-left)/width,y:(p.y-top)/height}));
  });
  const distance=(a,b)=>a.flatMap((points,j)=>points.map((p,i)=>Math.hypot(p.x-b[j][i].x,p.y-b[j][i].y))).reduce((sum,d)=>sum+d,0)/(a.length*a[0].length);
  const base={flightLift:1,flightPhase:2,trailSpace:.375,trailPull:.3,trailTwist:.4,trailFeedback:.5};
  for(const control of ['trailPull','trailTwist','trailFeedback'])assert.ok(distance(normalized({...base,[control]:0}),normalized({...base,[control]:1}))>.08,`${control} changes the shape beyond just translating or scaling it`);
  assert.ok(distance(normalized({...base,flightPhase:0}),normalized({...base,flightPhase:2}))>.08,'travelling bends whip the resting worm shape on the flight clock');
});

test('simulated noodles share drawing and hit geometry while keeping their own hair attachments',()=>{
  const state={flightLift:1,flightPhase:2,trailSpace:.375},rest=getWitchRestTrails(state);
  const trailStrands=rest.map(strand=>({index:strand.index,points:strand.points.filter((p,i)=>i%2===0).map(p=>({...p}))}));
  trailStrands[0].points[12]={x:80,y:240};
  trailStrands[0].points[20]={x:-60,y:225};
  trailStrands[0].points[128]={x:0,y:0};
  const current={...state,trailStrands},trails=getWitchTrails(current),hair=getWitchHair(current);
  assert.deepEqual(getWitchRestTrails(current),rest,'the simulation target never feeds its deformed points back into its resting shape');
  for(const [i,trail] of trails.entries()) {
    assert.equal(trail.points.length,129,'the rope controller can use a smaller fixed simulation budget');
    assert.deepEqual(trail.points.slice(0,-1),trailStrands[i].points.slice(0,-1));
    assert.deepEqual(trail.points.at(-1),hair.strands[trail.index].points.at(-1));
  }
  assert.deepEqual(trails[0].points[20],{x:-60,y:225},'captured pointer coordinates are not clamped away from the real grab');
  assert.deepEqual(trailStrands[0].points[128],{x:0,y:0},'the renderer never mutates the rope controller state');
  assert.equal(hitTestWitch(80,240,current)?.type,'trail','picking follows a directly displaced rope node');
  const target=warpWitchPoint(getWitchTargets(current).trail,current);
  assert.equal(hitTestWitch(target.x,target.y,current)?.type,'trail');
});

test('the catalogue face icon paints anatomy over a cleared transparent surface',()=>{
  const previousPath=globalThis.Path2D;
  globalThis.Path2D=class {constructor(d){this.d=d;}};
  try {
    const {context}=captureWitchPaint();renderWitchFaceIcon(context,512);
    assert.deepEqual(context.calls[0],{kind:'clear',args:[0,0,512,512]});
    assert.ok(context.calls.some(call=>call.kind==='fill'&&call.path?.startsWith('M-35,-30')));
    assert.equal(context.calls.filter(call=>call.kind==='rect'||call.kind==='text').length,0,'no opaque scene background or lettering enters the face icon');
  } finally {if(previousPath===undefined)delete globalThis.Path2D;else globalThis.Path2D=previousPath;}
});

test('visible hair in front of the leaning broom keeps the pull gesture',()=>{
  const state={hair:.75,handReach:1,flightLift:0,hitRadius:46};
  const lock=getWitchHair(state).strands[0].points[17];
  assert.ok(lock.x>290&&lock.x<340&&lock.y>350&&lock.y<420);
  assert.equal(hitTestWitch(lock.x,lock.y,state)?.type,'hair');
  const broom=getWitchTargets(state).broom;
  assert.equal(hitTestWitch(broom.x,broom.y,state)?.type,'broom','the exposed handle remains clickable');
});

test('tree sound travels up the native branches without changing their shape',()=>{
  const state={treeShape:2,treeSpread:.63,treeCurl:.4},tree=getWitchTree(state);
  assert.deepEqual(getWitchTreePulse({...state,treeProgress:.3,treeEnvelope:0}),[]);
  const start=getWitchTreePulse({...state,treeProgress:0,treeEnvelope:1});
  assert.equal(start.length,1);assert.equal(start[0].x,tree.root.x);assert.equal(start[0].y,tree.root.y);
  const later=getWitchTreePulse({...state,treeProgress:.65,treeEnvelope:1});
  assert.ok(later.length>1,'the sound frontier splits into the branches');
  assert.notDeepEqual(later,start);
  for(const head of later) {
    const {a,b}=tree.segments[head.index];
    assert.ok(distanceToPolyline(head,[a,b])<1e-7,'every light follows a visible branch');
  }
  assert.equal(getWitchTree(state),tree,'playback leaves the tree geometry untouched');
  assert.deepEqual(getWitchTreePulse({...state,treeProgress:1,treeEnvelope:1}),[]);
});
