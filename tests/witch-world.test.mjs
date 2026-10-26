import test from 'node:test';
import assert from 'node:assert/strict';
import {hitTestWitch, getFingerTips, getWitchLadle, getWitchObjectPosition, getWitchGhostPosition, getWitchTargets, getWitchTrail, broomTransform, handTransform, transformHandPoint, warpWitchPoint, renderWitch, WITCH_LAYOUT} from '../src/instruments/witch/witch-renderer.js';

test('the same world exposes moon, mushrooms and cauldron in every activity',()=>{
  for(const scene of ['brew','fingers','flight']) {
    const state={scene,handReach:0};
    assert.equal(hitTestWitch(800,164,state)?.type,'moon');
    assert.equal(hitTestWitch(162,639,state)?.type,'mushrooms');
    assert.equal(hitTestWitch(846,655,state)?.type,'mushrooms');
    assert.equal(hitTestWitch(600,520,state)?.type,'stir');
  }
  assert.equal(hitTestWitch(388,450,{scene:'brew'})?.type,'hand');
  assert.equal(hitTestWitch(NaN,450),null);
  assert.equal(hitTestWitch(-5,450),null);
});

test('mushroom deformation has an exact inverse and preserves direct targets',()=>{
  for(let trip=0;trip<4;trip++) for(const warpTime of [0,.2,1.7,129.8]) {
    const state={scene:'brew',trip,warpTime};
    for(const point of [WITCH_LAYOUT.moon,WITCH_LAYOUT.hand,...WITCH_LAYOUT.mushrooms,{x:600,y:520}]) {
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
  }
});

test('all shelf instruments stay pickable through flight and mushroom warping',()=>{
  assert.deepEqual(WITCH_LAYOUT.objects.map(object=>object.id),[
    'glass','tail','earwax','eyeball','newt','hair','roach','spider','oculoid','rubix','hiccup','gesticules','marimba','choir','blowhole','syrinx','throat-singing','julie-saw','puggler',
  ]);
  for(const scene of ['brew','flight'])for(const hitRadius of [46,67,80])for(let trip=0;trip<4;trip++)for(const time of [0,1,4,17,39]) {
    const state={scene,handReach:1,flightLift:scene==='flight'?1:0,hitRadius,trip,time,warpTime:time};
    for(const [index,object] of WITCH_LAYOUT.objects.entries()) {
      const visible=getWitchObjectPosition(object,state),point=warpWitchPoint(visible,state);
      assert.ok(point.x>30&&point.x<970&&point.y>75&&point.y<705,`${object.id} remains inside the scene`);
      assert.deepEqual(hitTestWitch(point.x,point.y,state),{type:'object',id:object.id,kind:object.kind,index});
    }
  }
});

test('shelf instruments stay parked until a single arc carries each into the potion',()=>{
  for(const home of WITCH_LAYOUT.objects) {
    const initial=getWitchObjectPosition(home,{});
    for(const time of [0,1,27,619])for(const flightLift of [0,.5,1])
      assert.deepEqual(getWitchObjectPosition(home,{time,flightLift}),initial,'a shelf icon never hovers or fades');
    const start=getWitchObjectPosition({...home,dropped:true,dropAge:0});
    const middle=getWitchObjectPosition({...home,dropped:true,dropAge:.425});
    const end=getWitchObjectPosition({...home,dropped:true,dropAge:.85});
    assert.equal(start.x,home.x);assert.equal(start.y,home.y);
    assert.equal(middle.x,(home.x+600)/2);
    assert.ok(middle.y<(home.y+544)/2-100,'the solo follows a visible thrown arc');
    assert.equal(end.x,600);assert.equal(end.y,544);assert.equal(end.alpha,0);
    const objects=WITCH_LAYOUT.objects.map(object=>object.id===home.id?{...object,dropped:true,dropAge:4}:object);
    assert.notEqual(hitTestWitch(home.x,home.y,{objects})?.id,home.id,'consumed ingredients cannot be picked again');
  }
});

test('parked broom, cloth and continuous flight string have direct gesture targets',()=>{
  const lowered=getWitchTargets({fabricY:0}).fabric,raised=getWitchTargets({fabricY:1}).fabric;
  assert.ok(raised.y<lowered.y,'an upward pull raises both the filter setting and visible cloth');
  for(const trip of [0,1,2,3])for(const warpTime of [0,.7,2.8]) {
    const state={trip,warpTime};
    const broom=warpWitchPoint(getWitchTargets(state).broom,state);
    assert.deepEqual(hitTestWitch(broom.x,broom.y,state),{type:'broom'});
    for(const fabricX of [0,.5,1])for(const fabricY of [0,.5,1]) {
      const current={...state,fabricX,fabricY},cloth=warpWitchPoint(getWitchTargets(current).fabric,current);
      assert.deepEqual(hitTestWitch(cloth.x,cloth.y,current),{type:'fabric'});
    }
    for(const flightPhase of [0,1,2,3,4,5,6,8,9]) {
      const current={...state,flightLift:1,scene:'flight',flightPhase},trail=getWitchTrail(current);
      const end=trail.at(-1),broom=broomTransform(current);
      assert.ok(Math.abs(end.x-(broom.x+(Math.cos(broom.rotation)*-265-Math.sin(broom.rotation)*126)*broom.scale))<1e-10);
      assert.ok(Math.abs(end.y-(broom.y+(Math.sin(broom.rotation)*-265+Math.cos(broom.rotation)*126)*broom.scale))<1e-10);
      assert.ok(trail.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)));
      const visible=warpWitchPoint(getWitchTargets(current).trail,current);
      assert.deepEqual(hitTestWitch(visible.x,visible.y,current),{type:'trail'});
      assert.notDeepEqual(getWitchTrail({...current,trailPull:0,trailTwist:0}),getWitchTrail({...current,trailPull:1,trailTwist:1}));
    }
  }
});

test('ingredient touch halos preserve scenery targets and choose the nearest object',()=>{
  for(const time of [0,1,4,17,39]) {
    const state={time,handReach:1,hitRadius:80};
    for(const [point,type] of [[WITCH_LAYOUT.moon,'moon'],...WITCH_LAYOUT.mushrooms.map(point=>[point,'mushrooms']),
      ...WITCH_LAYOUT.ghosts.map(ghost=>[getWitchGhostPosition(ghost,state),'ghost']),...WITCH_LAYOUT.bats.map(point=>[point,'bat'])]) {
      assert.equal(hitTestWitch(point.x,point.y,state)?.type,type,`${type} at ${point.x},${point.y}`);
    }
  }
  const objects=WITCH_LAYOUT.objects.map(object=>({...object,dropped:true}));
  objects[0]={...objects[0],x:140,y:100,dragging:true,dropped:false};
  objects[1]={...objects[1],x:200,y:100,dragging:true,dropped:false};
  const state={objects,hitRadius:80};
  assert.equal(hitTestWitch(193,100,state)?.id,'tail');
  assert.equal(hitTestWitch(148,100,state)?.id,'glass');
  assert.equal(hitTestWitch(200,156,state)?.id,'tail');
  objects[1].dropped=true;
  assert.equal(hitTestWitch(193,100,state)?.id,'glass');
});

test('the tone firefly follows brightness and remains separate from the bat and spark',()=>{
  for(const tone of [0,.25,.5,.75,1])for(const hitRadius of [46,67,80])for(let trip=0;trip<4;trip++) {
    const state={tone,trip,warpTime:1.4,hitRadius},target=getWitchTargets(state).tone;
    assert.equal(target.y,235-tone*130);
    const point=warpWitchPoint(target,state);
    assert.deepEqual(hitTestWitch(point.x,point.y,state),{type:'tone'});
    for(const [point,type] of [[WITCH_LAYOUT.bats[0],'bat'],[WITCH_LAYOUT.spirits[0],'spark']]) {
      const visible=warpWitchPoint(point,state);
      assert.equal(hitTestWitch(visible.x,visible.y,state)?.type,type);
    }
  }
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

test('ghost tempo gestures use the visible drifting centers without swallowing ingredients',()=>{
  for(const scene of ['brew','flight'])for(const ghostPhase of [0,4,17,39,120,1000])for(const hitRadius of [46,67,80])for(let trip=0;trip<4;trip++) {
    const state={scene,handReach:1,flightLift:scene==='flight'?1:0,hitRadius,trip,time:ghostPhase*.5,warpTime:ghostPhase,ghostPhase};
    for(let index=0;index<3;index++) {
      const ghost=getWitchGhostPosition(index,state),point=warpWitchPoint(ghost,state);
      const hit=hitTestWitch(point.x,point.y,state);
      if(scene==='flight'&&['hat','nose','spoon','hand'].includes(hit?.type)) {
        const targets=getWitchTargets(state),ladle=getWitchLadle(state);
        const foreground=hit.type==='spoon'?{x:ladle.hx-8,y:ladle.hy-24,r:Math.max(27,hitRadius*.75)}:
          hit.type==='hand'?{...transformHandPoint({x:590,y:415},state),r:Math.max(38,hitRadius)}:
          {...targets[hit.type],r:Math.max(targets[hit.type].r,hitRadius*(hit.type==='hat'?.7:.65))};
        assert.ok(Math.hypot(ghost.x-foreground.x,ghost.y-foreground.y)<foreground.r,'only a visibly overlapping foreground gesture can occlude a ghost');
      } else assert.deepEqual(hit,{type:'ghost',index},`${ghost.id} at phase ${ghostPhase}`);
    }
    for(const [index,ingredient] of WITCH_LAYOUT.objects.entries()) {
      const point=warpWitchPoint(getWitchObjectPosition(ingredient,state),state);
      assert.deepEqual(hitTestWitch(point.x,point.y,state),{type:'object',id:ingredient.id,kind:ingredient.kind,index});
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
    const context=new Proxy({canvas,calls,globalAlpha:1,save(){stack.push(this.globalAlpha);},restore(){this.globalAlpha=stack.pop();},
      createLinearGradient(){return {addColorStop(){}};},createRadialGradient(){return {addColorStop(){}};},
      fill(shape){calls.push({kind:'fill',path:shape?.d,alpha:this.globalAlpha,color:this.fillStyle});},
      fillText(value){calls.push({kind:'text',value});},
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
      const isGhost=call=>call.args?.[2]>90&&/\/(creaturazoid|colony-syrinx|hiccup-head)\.webp$/.test(portraitUrl(call)||'');
      const portraits=world.map((call,index)=>({call,index})).filter(({call})=>isGhost(call));
      assert.equal(portraits.length,3,'each original instrument portrait paints once');
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
        assert.ok(world.findIndex(entry=>entry.args?.[2]===60&&/\/hiccup-head\.webp$/.test(portraitUrl(entry)||''))>index,'featured miniature stays in front');
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
  assert.ok(flying.scale<ground.scale*.75&&flying.scale>ground.scale*.5,'hand becomes somewhat smaller in the sky');
  const first=getWitchLadle({...state,flightLift:1,flightPhase:0}),later=getWitchLadle({...state,flightLift:1,flightPhase:3});
  assert.ok(Math.hypot(first.gx-later.gx,first.gy-later.gy)>30,'spoon grip travels with the flying witch');
  assert.equal(first.lx,later.lx);assert.equal(first.ly,later.ly);
});

test('both actual hand models become body-sized and travel with the flying witch',()=>{
  const state={handReach:1};
  for(const index of [0,1]) {
    const ground=handTransform(state,index),first=handTransform({...state,flightLift:1,flightPhase:0},index);
    const later=handTransform({...state,flightLift:1,flightPhase:3},index);
    assert.ok(first.scale<ground.scale*.75,'both hands shrink as the body moves into the sky');
    assert.ok(Math.hypot(first.wrist.x-later.wrist.x,first.wrist.y-later.wrist.y)>50,'neither hand remains pinned to the foreground');
    for(const phase of [0,2,4,6,8]) {
      const current={...state,flightLift:1,flightPhase:phase},hand=handTransform(current,index),body=broomTransform(current);
      assert.ok(Math.hypot(hand.wrist.x-body.x,hand.wrist.y-body.y)<135,'wrists stay near the flying body');
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
      const portraits=world.map((call,index)=>({call,index,url:portraitUrl(call)})).filter(({call,url})=>url&&call.args[2]<=64);
      assert.equal(portraits.length,WITCH_LAYOUT.objects.length,'every shelf object uses its catalogue portrait');
      const body=world.findIndex(call=>call.kind==='fill'&&call.path?.startsWith(flightLift===1?'M-67,-32':'M398,360'));
      for(const object of WITCH_LAYOUT.objects) {
        const matching=portraits.filter(({url})=>url.endsWith('/'+object.imageHref));
        assert.equal(matching.length,1,object.name+' uses its actual instrument icon');
        assert.ok(matching[0].index<body,'stationary instruments paint behind the witch');
        const pixels=matching[0].call.source.getContext('2d').calls.find(call=>call.kind==='pixels').pixels.data;
        assert.equal(pixels[3],0,'black square backgrounds are cut away');
        assert.equal(pixels[(70*160+80)*4+3],255,'enclosed dark details remain');
      }
      assert.equal(world.filter(call=>call.kind==='text').length,0,'shelf names do not add text to the scene');
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
