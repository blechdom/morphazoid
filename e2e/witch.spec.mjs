import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';

const pageErrors=new WeakMap();
test.afterEach(async({page})=>{expect(pageErrors.get(page)??[]).toEqual([]);});

async function open(page) {
  const errors=[];pageErrors.set(page,errors);page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/witch.html');
  await expect(page.locator('#witchCanvas')).toBeVisible();
  await page.waitForFunction(()=>Boolean(window.witchInstrument?.state));
}
const state=page=>page.evaluate(()=>window.witchInstrument.state);
const shelfIds=['glass','hyper-rubix','earwax','hair','roach','oculoid','rubix','hiccup','gesticules','marimba','choir','julie-saw','puggler','fractal','synthesaurus','jaw-harp','harmonicazoid','dentaphone'];
const treeIds=['blech','syrinx','eyeball'];
const topIds=['quadruped','monstroid','candy-coil','chiptune','acid-303'];
const ingredientIds=[...shelfIds,...treeIds,...topIds,'spider'];
const ghostIds=['creaturazoid','monstroid','hiccup'];
async function selectScene(page,scene) {
  if((scene==='fingers'&&!(await state(page)).world.handOpen)||(scene!=='fingers'&&(await state(page)).config.scene!==scene)) {
    await page.locator('#witchCanvas').focus();
    await page.keyboard.press({brew:'b',fingers:'h',flight:'m'}[scene]);
  }
  if(scene==='fingers') {
    await expect.poll(async()=>(await state(page)).world.handOpen).toBe(true);
    await expect.poll(async()=>(await state(page)).handReady,{timeout:15000}).toBe(true);
    await expect.poll(async()=>(await state(page)).world.handReach).toBe(1);
  } else await expect.poll(async()=>(await state(page)).config.scene).toBe(scene);
}
async function observeWorklet(page) {
  await page.addInitScript(()=>{
    window.witchTriggers=[];window.witchVariantTriggers=[];window.witchVariantEvidence=[];window.witchGainRamps=[];window.witchDropEvidence={};
    const ramp=AudioParam.prototype.linearRampToValueAtTime;
    AudioParam.prototype.linearRampToValueAtTime=function(value,time) {
      window.witchGainRamps.push({value,time});return ramp.call(this,value,time);
    };
    const Original=window.AudioWorkletNode;
    window.AudioWorkletNode=class extends Original {
      constructor(context,name,options) {
        super(context,name,options);
        if(name==='witch-voice') {
          const post=this.port.postMessage.bind(this.port);
          this.port.postMessage=(message,...args)=>{
            if(message.type==='trigger') {
              window.witchTriggers.push(message.kind);
              if(message.kind.startsWith('drop-'))window.witchVariantTriggers.push({kind:message.kind,variant:message.variant});
              if(message.kind.startsWith('drop-')) {
                delete window.witchDropEvidence[message.kind];
                window.witchVariantEvidence=window.witchVariantEvidence.filter(item=>item.kind!==message.kind);
              }
            }
            return post(message,...args);
          };
          this.port.addEventListener('message',({data})=>{
            if(data.type==='visual') {
              window.witchVisual=data;
              if(data.dropKind&&data.dropLevel>.0001)window.witchVariantEvidence.push({kind:data.dropKind,variant:data.dropVariant});
              if(data.dropKind&&data.dropLevel>.0001&&data.brewLevel>.0001&&data.handLevel>.0001) {
                window.witchDropEvidence[data.dropKind]={kind:data.dropKind,solo:true,voice:true,fingers:true};
              }
              window.witchGhostPeak=Math.max(window.witchGhostPeak??0,Math.abs(data.ghostLevel??0));
              if(data.catClock?.active&&!window.witchCatFirstActive)window.witchCatFirstActive=data.catClock;
              window.witchCatPeak=Math.max(window.witchCatPeak??0,Math.abs(data.catLevel??0));
              window.witchCatMeowPeak=Math.max(window.witchCatMeowPeak??0,Math.abs(data.catMeowLevel??0));
            }
          });
          this.port.start();
        }
      }
    };
  });
}
async function point(page,x,y) {
  const rect=await page.locator('#witchCanvas').boundingBox();
  return stagePoint(rect,x,y);
}
function stagePoint(rect,x,y) {
  const s=Math.min(rect.width/1000,rect.height/720);
  return {x:rect.x+(rect.width-1000*s)/2+x*s,y:rect.y+(rect.height-720*s)/2+y*s};
}
async function inputSnapshot(session,read,arg) {
  // Sample on the native input session. Traced page.evaluate snapshots can
  // delay its return enough for moving hair or foreground fingers to cross.
  const {result,exceptionDetails}=await session.send('Runtime.evaluate',{
    expression:`(${read.toString()})(${JSON.stringify(arg)})`,awaitPromise:true,returnByValue:true,
  });
  if(exceptionDetails)throw new Error(exceptionDetails.text);
  return result.value;
}
async function clickIngredient(page,id,touch=false) {
  await page.locator('#witchCanvas').scrollIntoViewIfNeeded();
  const object=await page.evaluate(async id=>{
    const {warpWitchPoint}=await import('/src/instruments/witch/witch-renderer.js');
    const state=window.witchInstrument.state,object=state.objects.find(item=>item.id===id);
    return {...object,...warpWitchPoint(object,{trip:state.config.trip,visualMode:state.config.visualMode,eyeShock:state.eyeShock,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
      warpTime:state.warpTime})};
  },id);
  expect(object,`${id} has a visible scene object`).toBeTruthy();
  expect(object.dropped).toBe(false);
  expect(object.x).toBeGreaterThan(0);expect(object.x).toBeLessThan(1000);
  expect(object.y).toBeGreaterThan(0);expect(object.y).toBeLessThan(720);
  const rect=await page.locator('#witchCanvas').boundingBox(),from=stagePoint(rect,object.x,object.y);
  const session=touch?await page.context().newCDPSession(page):null;
  if(session) await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
  else await page.mouse.click(from.x,from.y);
  if(session) {
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
  }
  await expect.poll(async()=>(await state(page)).objects.find(item=>item.id===id).dropped).toBe(true);
  expect((await state(page)).objects.find(item=>item.id===id).dragging).toBe(false);
}
async function expectIngredientSolo(page,id) {
  await expect.poll(()=>page.evaluate(kind=>{
    // Keep actual simultaneous worklet evidence: a short solo can finish while
    // a traced input/snapshot call is still returning to the test runner.
    return {triggered:window.witchTriggers.includes(kind),...window.witchDropEvidence[kind]};
  },`drop-${id}`)).toEqual({triggered:true,kind:`drop-${id}`,solo:true,voice:true,fingers:true});
}
async function clickWorld(page,key,{touch=false,index=0,drag=null}={}) {
  await page.locator('#witchCanvas').scrollIntoViewIfNeeded();
  const session=await page.context().newCDPSession(page);
  const snapshot=await inputSnapshot(session,async({key,index,drag})=>{
    const {WITCH_LAYOUT,hitTestWitch,warpWitchPoint}=await import('/src/instruments/witch/witch-renderer.js');
    const current=window.witchInstrument.state,rect=document.querySelector('#witchCanvas').getBoundingClientRect();
    const mushroom=WITCH_LAYOUT.mushrooms[0];
    let target=key==='moon'?WITCH_LAYOUT.moon:key==='mushrooms'?{x:mushroom.x+34*mushroom.scale,y:mushroom.y+5*mushroom.scale}
      :key==='web'?current.web.targets[index]:current.targets[key];
    // Touch the same note sector farther down the upper radial strings.
    if(key==='web'&&[4,5].includes(index))target={
      x:current.web.center.x+(target.x-current.web.center.x)*.6,
      y:current.web.center.y+(target.y-current.web.center.y)*.6,
    };
    const visual={...current.config,eyeShock:current.eyeShock,
      reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,warpTime:current.warpTime};
    let targets=[target];
    if(key==='moon') {
      const moon=WITCH_LAYOUT.moon,scale=Math.min(rect.width/1000,rect.height/720);
      const hitState={...visual,...current.world,hitRadius:Math.max(46,24/scale),time:current.visualTime,handTime:current.handTime,flightPhase:current.flightPhase,objects:current.objects};
      targets=[target,...Array.from({length:12},(_,i)=>({x:moon.x+Math.cos(i*Math.PI/6)*moon.r*.7,y:moon.y+Math.sin(i*Math.PI/6)*moon.r*.7}))].filter(p=>{
        const q=warpWitchPoint(p,visual);return hitTestWitch(q.x,q.y,hitState)?.type==='moon';
      });
    }
    if(key==='tree') {
      const canvas=document.querySelector('#witchCanvas'),scale=Math.min(rect.width/1000,rect.height/720),seen=new Set();
      const hitState={...visual,...current.world,hitRadius:Math.max(46,24/scale),time:current.visualTime,handTime:current.handTime,flightPhase:current.flightPhase,objects:current.objects,spiderCaptured:current.spiderCaptured};
      targets=[target,...current.tree.segments.flatMap(({a,b})=>[.25,.5,.75].map(t=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})))].filter(p=>{
        const cell=`${Math.round(p.x/8)},${Math.round(p.y/8)}`;if(seen.has(cell))return false;seen.add(cell);
        const q=warpWitchPoint(p,visual),x=rect.x+(rect.width-1000*scale)/2+q.x*scale,y=rect.y+(rect.height-720*scale)/2+q.y*scale;
        return document.elementFromPoint(x,y)===canvas&&hitTestWitch(q.x,q.y,hitState)?.type==='tree';
      // Upper branches stay clear of the animated hand that crosses the trunk.
      }).sort((a,b)=>(a.y<380?0:1)-(b.y<380?0:1)).slice(0,80);
    }
    return {targets:targets.map(point=>({...warpWitchPoint(point,visual),...(drag?{
      to:warpWitchPoint({x:point.x+drag.spread*(point.x<current.tree.root.x-4?-1:1),y:point.y+drag.dy},visual),
    }:{})})),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
  },{key,index,drag});
  expect(snapshot.targets.length,`${key} has an exposed native target`).toBeGreaterThan(0);
  let selected=snapshot.targets[0],from=stagePoint(snapshot.rect,selected.x,selected.y);
  const readDragState=()=>inputSnapshot(session,()=>window.witchInstrument.state);
  const beforeDrag=drag?await inputSnapshot(session,()=>{
    const canvas=document.querySelector('#witchCanvas');window.witchTreePointerId=null;
    canvas.addEventListener('pointerdown',event=>{window.witchTreePointerId=event.pointerId;},{once:true,capture:true});
    return window.witchInstrument.state;
  }):null;
  if(key==='tree') {
    let exposed=false;
    for(const target of snapshot.targets) {
      from=stagePoint(snapshot.rect,target.x,target.y);
      await session.send('Input.dispatchMouseEvent',{type:'mouseMoved',...from});
      const title=await inputSnapshot(session,()=>document.querySelector('#witchCanvas').title);
      if(title.startsWith('Play the L-system tree')){selected=target;exposed=true;break;}
    }
    expect(exposed,'an exposed L-system branch remains playable').toBe(true);
  }
  if(drag) {
    const canvas=page.locator('#witchCanvas'),to=stagePoint(snapshot.rect,selected.to.x,selected.to.y);
    const before=beforeDrag,settings=current=>[current.config.treeShape,current.config.treeSpread,current.config.treeCurl];
    const move=position=>session.send(touch?'Input.dispatchTouchEvent':'Input.dispatchMouseEvent',touch
      ?{type:'touchMove',touchPoints:[position]}:{type:'mouseMoved',...position,button:'left',buttons:1});
    if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
    else await session.send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});
    expect(await inputSnapshot(session,()=>document.querySelector('#witchCanvas').hasPointerCapture(window.witchTreePointerId))).toBe(true);
    expect(settings(await readDragState()),'a branch pickup does not change the tree').toEqual(settings(before));
    await move(from);expect(settings(await readDragState()),'zero movement keeps the captured settings').toEqual(settings(before));
    for(let step=1;step<=5;step++)await move({x:from.x+(to.x-from.x)*step/5,y:from.y+(to.y-from.y)*step/5});
    const held=await readDragState();
    if(touch)await session.send('Input.dispatchTouchEvent',{type:drag.cancel?'touchCancel':'touchEnd',touchPoints:[]});
    else {
      if(drag.cancel)await canvas.dispatchEvent('pointercancel',{pointerId:await page.evaluate(()=>window.witchTreePointerId)});
      await session.send('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',buttons:0,clickCount:1});
    }
    expect(await inputSnapshot(session,()=>document.querySelector('#witchCanvas').hasPointerCapture(window.witchTreePointerId))).toBe(false);
    const released=await readDragState();
    await session.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:to.x+12,y:to.y+12,buttons:0});
    expect(settings(await readDragState()),'released input cannot keep bending a branch').toEqual(settings(released));
    await session.detach();return {before,held,released};
  }
  if(touch) {
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  } else {
    await session.send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});
    await session.send('Input.dispatchMouseEvent',{type:'mouseReleased',...from,button:'left',buttons:0,clickCount:1});
  }
  await session.detach();
}
async function clickAnimal(page,id,{touch=false,part='body'}={}) {
  await page.locator('#witchCanvas').scrollIntoViewIfNeeded();
  const session=await page.context().newCDPSession(page);
  if(touch)await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const snapshot=await inputSnapshot(session,({id,part})=>{
    const current=window.witchInstrument.state,rect=document.querySelector('#witchCanvas').getBoundingClientRect();
    return {target:(id==='cat'?current.catTargets:current.visitorTargets[id])?.[part],
      rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
  },{id,part});
  const target=snapshot.target;expect(target,`${id} has a live ${part} target`).toBeTruthy();
  expect(target.x).toBeGreaterThan(0);expect(target.x).toBeLessThan(1000);
  expect(target.y).toBeGreaterThan(0);expect(target.y).toBeLessThan(720);
  const from=stagePoint(snapshot.rect,target.x,target.y);
  if(touch) {
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await session.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  } else {
    await session.send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});
    await session.send('Input.dispatchMouseEvent',{type:'mouseReleased',...from,button:'left',buttons:0,clickCount:1});
  }
  await session.detach();return target;
}
async function dragGhost(page,id,dy,{touch=false,cancel=false}={}) {
  await page.locator('#witchCanvas').scrollIntoViewIfNeeded();
  const session=await page.context().newCDPSession(page);
  await page.locator('#witchCanvas').evaluate((canvas,id)=>{
    window.witchGhostPointerId=null;
    canvas.addEventListener('pointerdown',event=>{
      window.witchGhostPointerId=event.pointerId;
      const current=window.witchInstrument.state;
      window.witchGhostDown={id,title:canvas.title,clientX:event.clientX,clientY:event.clientY,
        ghost:current.ghosts.find(ghost=>ghost.id===id),config:current.config,world:current.world};
    },{once:true,capture:true});
  },id);
  const candidateSnapshot=(offset=null)=>inputSnapshot(session,async({id,dy,offset})=>{
    const {warpWitchPoint,getWitchGhostPosition,WITCH_LAYOUT}=await import('/src/instruments/witch/witch-renderer.js');
    const current=window.witchInstrument.state,ghost=current.ghosts.find(item=>item.id===id);
    const rect=document.querySelector('#witchCanvas').getBoundingClientRect(),minRadius=Math.max(46,24/Math.min(rect.width/1000,rect.height/720));
    const visual={trip:current.config.trip,visualMode:current.config.visualMode,eyeShock:current.eyeShock,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,warpTime:current.warpTime};
    const blockers=[...current.fingerTips.map(point=>({...point,r:minRadius})),
      ...current.hands.slice(0,1).flatMap(hand=>hand.palm?[{...hand.palm,r:minRadius},{...hand.wrist,r:minRadius*.55}]:[]),
      ...current.hairGeometry.strands.flatMap(strand=>strand.points.map(point=>({...point,r:Math.min(28,Math.max(12*current.hairGeometry.scale,minRadius*.32))}))),
      ...['nose','hat','fabric'].map(key=>({...warpWitchPoint(current.targets[key],visual),r:Math.max(current.targets[key].r,minRadius*.7)})),
      ...current.objects.filter(object=>!object.dropped).map(object=>({...warpWitchPoint(object,visual),r:object.r+8})),
      {...warpWitchPoint({x:current.ladle.hx-8,y:current.ladle.hy-24},visual),r:Math.max(27,minRadius*.75)}];
    const offsets=offset?[offset]:[[0,0],[-.35,0],[0,-.35],[0,.35],[.35,0],[-.25,-.25],[.25,-.25],[-.25,.25],[.25,.25],[-.65,0],[0,-.65],[0,.65],[.65,0],[-.46,-.46],[.46,-.46],[-.46,.46],[.46,.46]];
    const rawGhost=getWitchGhostPosition(id,{ghostPhase:ghost.phase}),pot=WITCH_LAYOUT.cauldron;
    const candidates=offsets.map(offset=>{
      // A vertical offset crosses different static/VHS strips, so offset the
      // raw wisp before applying the same warp as the painted scene.
      const raw={x:rawGhost.x+offset[0]*ghost.r,y:rawGhost.y+offset[1]*ghost.r};
      const from=warpWitchPoint(raw,visual),dx=raw.x-pot.x,dyPot=raw.y-pot.y;
      const normalized=Math.hypot(dx/(pot.rx+30),dyPot/(pot.ry+33));
      const potClearance=Math.hypot(dx,dyPot)*(1-1/Math.max(.00001,normalized));
      const clearance=Math.min(potClearance,...blockers.map(blocker=>Math.hypot(from.x-blocker.x,from.y-blocker.y)-blocker.r));
      const interior=ghost.r*(1-Math.hypot(...offset));
      return {offset,from,to:warpWitchPoint({x:raw.x,y:raw.y+dy},visual),clearance,score:Math.min(clearance,interior)};
    });
    const ranked=candidates.toSorted((a,b)=>b.score-a.score);
    return {...ranked[0],offsets:ranked.map(candidate=>candidate.offset),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
  },{id,dy,offset});
  let from,to;
  // Foreground fingers and hair can cross a ghost. Pick an exposed edge with
  // room around that anatomy, then capture immediately after live hover.
  await expect.poll(async()=>{
    const ranking=await candidateSnapshot();
    for(const offset of ranking.offsets) {
      const snapshot=await candidateSnapshot(offset);
      if(snapshot.clearance<30)continue;
      const candidate=stagePoint(snapshot.rect,snapshot.from.x,snapshot.from.y);
      await page.mouse.move(candidate.x,candidate.y);
      if(!(await page.locator('#witchCanvas').getAttribute('title'))?.startsWith('Lift a ghost'))continue;
      const fresh=await candidateSnapshot(offset);
      if(fresh.clearance<30)continue;
      from=stagePoint(fresh.rect,fresh.from.x,fresh.from.y);to=stagePoint(fresh.rect,fresh.to.x,fresh.to.y);
      if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
      else await session.send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});
      return true;
    }
    return false;
  },{intervals:[50,100]}).toBe(true);
  const capture=await inputSnapshot(session,()=>({captured:document.querySelector('#witchCanvas').hasPointerCapture(window.witchGhostPointerId),down:window.witchGhostDown}));
  expect(capture.captured,JSON.stringify(capture.down)).toBe(true);
  for(let step=1;step<=5;step++) {
    const position={x:from.x+(to.x-from.x)*step/5,y:from.y+(to.y-from.y)*step/5};
    if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[position]});
    else await session.send('Input.dispatchMouseEvent',{type:'mouseMoved',...position,button:'left',buttons:1});
  }
  if(touch)await session.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
  else {
    if(cancel)await page.locator('#witchCanvas').dispatchEvent('pointercancel',{pointerId:1});
    await session.send('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',buttons:0,clickCount:1});
  }
  await session.detach();
}
async function dragHair(page,amount,{touch=false,cancel=false}={}) {
  const canvas=page.locator('#witchCanvas');await canvas.scrollIntoViewIfNeeded();
  const session=await page.context().newCDPSession(page);
  await canvas.evaluate(async canvas=>{
    const {warpWitchPoint}=await import('/src/instruments/witch/witch-renderer.js');
    window.witchHairPointerId=null;
    canvas.addEventListener('pointerdown',event=>{
      window.witchHairPointerId=event.pointerId;
      const current=window.witchInstrument.state,rect=canvas.getBoundingClientRect(),scale=Math.min(rect.width/1000,rect.height/720);
      const visual={trip:current.config.trip,visualMode:current.config.visualMode,eyeShock:current.eyeShock,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,warpTime:current.warpTime};
      const raw={x:(event.clientX-rect.x-(rect.width-1000*scale)/2)/scale,y:(event.clientY-rect.y-(rect.height-720*scale)/2)/scale};
      const p=warpWitchPoint(raw,visual,true),minRadius=Math.max(46,24/scale);
      const hairDistances=current.hairGeometry.strands.slice(0,12).flatMap(strand=>strand.points.slice(7).map((_,index)=>{
        const a=warpWitchPoint(strand.points[index+6],visual,true),b=warpWitchPoint(strand.points[index+7],visual,true),dx=b.x-a.x,dy=b.y-a.y;
        const along=Math.min(1,Math.max(0,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
        return Math.hypot(p.x-a.x-along*dx,p.y-a.y-along*dy);
      }));
      window.witchHairDown={x:p.x,y:p.y,title:canvas.title,config:{...current.config},world:{...current.world},minRadius,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,sampleAge:performance.now()-window.witchHairSampleAt,
        hairDistance:Math.min(...hairDistances),hairRadius:Math.min(28,Math.max(12*current.hairGeometry.scale,minRadius*.32)),
        mouth:Math.hypot(p.x-current.targets.mouth.x,p.y-current.targets.mouth.y)-Math.max(current.targets.mouth.r,Math.min(27,minRadius*.38)),
        eyes:Math.hypot(p.x-current.targets.eyes.x,p.y-current.targets.eyes.y)-Math.max(current.targets.eyes.r,Math.min(27,minRadius*.38)),
        nose:Math.hypot(p.x-current.targets.nose.x,p.y-current.targets.nose.y)-Math.max(current.targets.nose.r,minRadius*.65),
        hat:Math.hypot(p.x-current.targets.hat.x,p.y-current.targets.hat.y)-Math.max(current.targets.hat.r,minRadius*.7),
        spoon:Math.hypot(p.x-current.ladle.hx+8,p.y-current.ladle.hy+24)-Math.max(27,minRadius*.75),
        fingers:Math.min(...current.fingerTips.map(target=>{const q=warpWitchPoint(target,visual,true);return Math.hypot(p.x-q.x,p.y-q.y)-minRadius;})),
        ghosts:Math.min(...current.ghosts.map(target=>{const q=warpWitchPoint(target,visual,true);return Math.hypot(p.x-q.x,p.y-q.y)-Math.max(target.r,minRadius);})),
      };
    },{once:true,capture:true});
  });
  const candidateSnapshot=(index=null)=>inputSnapshot(session,async({amount,index})=>{
    const {warpWitchPoint,WITCH_LAYOUT}=await import('/src/instruments/witch/witch-renderer.js');
    const current=window.witchInstrument.state,geometry=current.hairGeometry;
    const visual={trip:current.config.trip,visualMode:current.config.visualMode,eyeShock:current.eyeShock,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,warpTime:current.warpTime};
    const rect=document.querySelector('#witchCanvas').getBoundingClientRect();
    const minRadius=Math.max(46,24/Math.min(rect.width/1000,rect.height/720));
    const unwarp=point=>warpWitchPoint(point,visual,true);
    const blockers=[...['nose','mouth','eyes','hat','fabric'].map(key=>{
      const target=current.targets[key],radius={nose:minRadius*.65,mouth:Math.min(27,minRadius*.38),eyes:Math.min(27,minRadius*.38),hat:minRadius*.7,fabric:minRadius*.6}[key];
      return {...target,r:Math.max(target.r,radius)};
    }),{x:current.ladle.hx-8,y:current.ladle.hy-24,r:Math.max(27,minRadius*.75)},
      ...current.fingerTips.map(target=>({...unwarp(target),r:minRadius})),
      ...current.objects.filter(object=>!object.dropped).map(object=>({...object,r:object.r+8})),
      {...WITCH_LAYOUT.moon,r:Math.max(WITCH_LAYOUT.moon.r+12,minRadius)}];
    const candidates=geometry.targets.map((target,index)=>{
      const start=unwarp(target),clearance=Math.min(...blockers.map(blocker=>Math.hypot(start.x-blocker.x,start.y-blocker.y)-blocker.r));
      return {index,from:target,clearance,to:warpWitchPoint({x:start.x+geometry.axis.x*geometry.pullDistance*amount,
        y:start.y+geometry.axis.y*geometry.pullDistance*amount},visual)};
    });
    const chosen=index===null?candidates.toSorted((a,b)=>b.clearance-a.clearance)[0]:candidates[index];
    window.witchHairSampleAt=performance.now();
    return {...chosen,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
  },{amount,index});
  let from,to;
  await expect.poll(async()=>{
    // Pick a free end clear of foreground controls, then confirm its live
    // hover response. Background ghosts must not steal visible hair pulls.
    const snapshot=await candidateSnapshot();
    if(snapshot.clearance<30)return false;
    const candidate=stagePoint(snapshot.rect,snapshot.from.x,snapshot.from.y);
    await page.mouse.move(candidate.x,candidate.y);
    if(!(await canvas.getAttribute('title'))?.startsWith('Pull her hair'))return false;
    const fresh=await candidateSnapshot(snapshot.index);
    if(fresh.clearance<30)return false;
    from=stagePoint(fresh.rect,fresh.from.x,fresh.from.y);to=stagePoint(fresh.rect,fresh.to.x,fresh.to.y);
    if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
    else await session.send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});
    return true;
  },{intervals:[50,100]}).toBe(true);
  const down=await page.evaluate(()=>window.witchHairDown);
  expect(await canvas.evaluate(canvas=>canvas.hasPointerCapture(window.witchHairPointerId)),JSON.stringify(down)).toBe(true);
  expect(down.hairDistance,JSON.stringify(down)).toBeLessThan(down.hairRadius);
  for(let step=1;step<=5;step++) {
    const position={x:from.x+(to.x-from.x)*step/5,y:from.y+(to.y-from.y)*step/5};
    if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[position]});
    else await session.send('Input.dispatchMouseEvent',{type:'mouseMoved',...position,button:'left',buttons:1});
  }
  if(touch)await session.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
  else {
    if(cancel)await canvas.dispatchEvent('pointercancel',{pointerId:await page.evaluate(()=>window.witchHairPointerId)});
    await session.send('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',buttons:0,clickCount:1});
  }
  await session.detach();
  expect(await canvas.evaluate(canvas=>canvas.hasPointerCapture(window.witchHairPointerId))).toBe(false);
  const released=(await state(page)).config.hair;
  await page.mouse.move(to.x+16,to.y+12);
  expect((await state(page)).config.hair).toBe(released);
}
function expectHairInScene(current) {
  const geometry=current.hairGeometry;
  expect(geometry.targets.length).toBeGreaterThan(0);
  const points=[geometry.root,geometry.tip,...geometry.targets,...geometry.strands.flatMap(strand=>strand.points)];
  expect(points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y))).toBe(true);
  expect(Math.min(...points.map(point=>point.x))).toBeGreaterThan(0);
  expect(Math.max(...points.map(point=>point.x))).toBeLessThan(1000);
  expect(Math.min(...points.map(point=>point.y))).toBeGreaterThan(0);
  expect(Math.max(...points.map(point=>point.y))).toBeLessThan(720);
}

const settings=config=>Object.fromEntries(Object.entries(config).filter(([key])=>key!=='scene'));
const clocks=current=>Object.fromEntries(['performanceTime','handTime','ghostPhase','flightPhase','visualTime','warpTime'].map(key=>[key,current[key]]));
async function key(page,value) {await page.locator('#witchCanvas').focus();await page.keyboard.press(value);}
async function wake(page,{touch=false}={}) {
  const p=await point(page,24,704);
  if(touch)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);
  await expect.poll(async()=>(await state(page)).audioOn,{timeout:15000}).toBe(true);
  expect((await state(page))).toMatchObject({quiet:false,playing:true,presence:1});
}
async function bendFinger(page,{touch=false,index=2}={}) {
  const session=await page.context().newCDPSession(page);
  try {
    const from=await inputSnapshot(session,({index})=>{
      const tip=window.witchInstrument.state.hands[0].tips[index],rect=document.querySelector('#witchCanvas').getBoundingClientRect();
      const scale=Math.min(rect.width/1000,rect.height/720);
      return {x:rect.x+(rect.width-1000*scale)/2+tip.x*scale,y:rect.y+(rect.height-720*scale)/2+tip.y*scale};
    },{index});
    if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
    else await session.send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});
    expect(await inputSnapshot(session,({index})=>window.witchInstrument.state.manualFingerMask&(1<<index),{index})).toBe(1<<index);
    const to={x:from.x+35,y:from.y+35};
    if(touch) {
      await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[to]});
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    } else {
      await session.send('Input.dispatchMouseEvent',{type:'mouseMoved',...to,button:'left',buttons:1});
      await session.send('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',buttons:0,clickCount:1});
    }
  } finally {await session.detach();}
}
async function preset(page,id) {
  // Use the picture's native next-spell shortcut; there is no preset menu.
  const spells=await bank(page),current=await state(page);
  const target=spells.findIndex(spell=>spell.id===id);
  expect(target).toBeGreaterThanOrEqual(0);
  const start=spells.findIndex(spell=>spell.id===current.presetId);
  const steps=(target-start+spells.length)%spells.length||spells.length;
  await page.locator('#witchCanvas').focus();
  const session=await page.context().newCDPSession(page);
  try {
    for(let i=0;i<steps;i++) {
      await session.send('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
      await session.send('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
    }
  } finally {await session.detach();}
  expect((await state(page)).config).toEqual({...spells[target].snapshot,scene:current.config.scene});
}
async function bank(page) {return page.evaluate(async()=>(await import('/src/instruments/witch/witch-presets.js')).WITCH_PRESETS);}
async function assertFrozen(page) {
  // Allow the final queued paint/worklet packet to settle, then compare the
  // actual rendering clocks rather than wall time or a derived test clock.
  await page.waitForTimeout(120);
  const before=await state(page);expect(before.quiet).toBe(true);
  for(const value of Object.values(clocks(before)))expect(Number.isFinite(value)).toBe(true);
  await page.waitForTimeout(220);
  expect(clocks(await state(page))).toEqual(clocks(before));
  return before;
}
async function dragWorld(page,key,dx,dy,{cancel=false,holdMs=0,turns=0}={}) {
  const session=await page.context().newCDPSession(page);
  const snapshot=await inputSnapshot(session,async({key,dx,dy,turns})=>{
    const {hitTestWitch,warpWitchPoint}=await import('/src/instruments/witch/witch-renderer.js');
    const current=window.witchInstrument.state,canvas=document.querySelector('#witchCanvas'),rect=canvas.getBoundingClientRect();
    const visual={...current.config,...current.world,...current.fabricGesture.visual,...current.fabricGesture.audio,
      performanceTime:current.performanceTime,time:current.visualTime,warpTime:current.warpTime,handTime:current.handTime,trailStrands:current.trailGesture?.active?current.trailGesture.strands:undefined,
      flightPhase:current.flightPhase,spoonHeight:current.spoonHeight,objects:current.objects,capturedAnimals:current.capturedAnimals,
      spiderCaptured:current.spiderCaptured,eyeShock:current.eyeShock,phase:Math.atan2((current.ladle.ly-520)/.27,current.ladle.lx-600),
      reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
    let candidates=[key==='spoon'?{x:current.ladle.gx,y:current.ladle.gy}:current.targets[key]];
    if(key==='fabric') {
      // Find exposed cloth across the whole background, below the controls
      // and noodles. The live native hover also checks the rendered hand mesh.
      candidates=[];const scale=Math.min(rect.width/1000,rect.height/720);
      for(let y=100;y<=620;y+=80)for(let x=80;x<=920;x+=80) {
        if(x+dx<25||x+dx>975||y+dy<25||y+dy>695)continue;
        const p=warpWitchPoint({x,y},visual);
        const clientX=rect.x+(rect.width-1000*scale)/2+p.x*scale,clientY=rect.y+(rect.height-720*scale)/2+p.y*scale;
        if(hitTestWitch(p.x,p.y,visual)?.type==='fabric'&&document.elementFromPoint(clientX,clientY)===canvas)candidates.push({x,y});
      }
    }
    return {candidates:candidates.map(raw=>({from:warpWitchPoint(raw,visual),to:warpWitchPoint({x:raw.x+dx,y:raw.y+dy},visual),
      orbit:Array.from({length:24*turns},(_,i)=>{
        const angle=Math.atan2(dy,dx)+(i+1)/24*Math.PI*2,radius=Math.hypot(dx,dy);
        return warpWitchPoint({x:raw.x+Math.cos(angle)*radius,y:raw.y+Math.sin(angle)*radius},visual);
      })})),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
  },{key,dx,dy,turns});
  let target=snapshot.candidates[0];
  if(key==='fabric') {
    target=null;
    for(const candidate of snapshot.candidates) {
      const from=stagePoint(snapshot.rect,candidate.from.x,candidate.from.y);
      await session.send('Input.dispatchMouseEvent',{type:'mouseMoved',...from});
      const title=await inputSnapshot(session,()=>document.querySelector('#witchCanvas').title);
      if(title.startsWith('Grab the cloth')){target=candidate;break;}
    }
    expect(target,'an exposed point on the full flight fabric remains draggable').toBeTruthy();
  }
  const from=stagePoint(snapshot.rect,target.from.x,target.from.y),to=stagePoint(snapshot.rect,target.to.x,target.to.y);
  await session.send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});
  const grabbed=key==='fabric'?await inputSnapshot(session,()=>window.witchInstrument.state.fabricGesture)
    :key==='spoon'?await inputSnapshot(session,()=>({spoonHeight:window.witchInstrument.state.config.spoonHeight})):null;
  for(let step=1;step<=5;step++)await session.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+(to.x-from.x)*step/5,y:from.y+(to.y-from.y)*step/5,button:'left',buttons:1});
  for(const p of target.orbit)await session.send('Input.dispatchMouseEvent',{type:'mouseMoved',...stagePoint(snapshot.rect,p.x,p.y),button:'left',buttons:1});
  const moved=await state(page);
  if(holdMs)await page.waitForTimeout(holdMs);
  const held=holdMs?await state(page):moved;
  if(cancel)await page.locator('#witchCanvas').dispatchEvent('pointercancel',{pointerId:1});
  await session.send('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',buttons:0,clickCount:1});
  await session.detach();return {from,to,grabbed,moved,held};
}
async function audible(page) {
  await expect.poll(()=>page.evaluate(()=>Boolean(window.witchVisual?.brewLevel>.0001&&window.witchVisual?.handLevel>.0001))).toBe(true);
  const result=await sampleAudioEnvelope(page,{durationMs:240});
  expect(result.summary.finite).toBe(true);expect(result.summary.maxPeak).toBeGreaterThan(.001);expect(result.summary.clippedSamples).toBe(0);
}

test('loads quiet and frozen with two model hands, real ingredients and no parameter sidebar',async({page})=>{
  await open(page);await expect(page).toHaveTitle('Witches Brew · Morphazoid');await expect(page.locator('h1')).toHaveText('witches brew');
  await expect.poll(async()=>(await state(page)).handReady,{timeout:15000}).toBe(true);
  expect(await state(page)).toMatchObject({playing:false,audioOn:false,quiet:true,presence:0,world:{handReach:1}});
  expect((await readAudioStatus(page)).connectionCount).toBe(0);await assertFrozen(page);
  await expect(page.locator('.witch-panel,#witchParameters,.witch-scene-caption,.witch-understage')).toHaveCount(0);
  await expect(page.locator('.witch-shell input[type=range],.witch-shell select')).toHaveCount(0);
  await expect(page.locator('[data-instrument-preset-host],.instrument-preset-controls,#playButton,#resetButton,.witch-help')).toHaveCount(0);
  const initial=await state(page);expect(initial.objects.map(object=>object.id)).toEqual(ingredientIds);
  expect(initial.handMetadata).toMatchObject({triangles:28994,deformBones:22,modelInstances:2,webglContexts:1});
  expect(initial.hands.map(hand=>hand.tips.length)).toEqual([5,5]);
  expect(initial.hands[0].rotation).toBeCloseTo(55*Math.PI/180,5);
  expect(initial.handMetadata.wristTwists[1]-initial.handMetadata.wristTwists[0]).toBeCloseTo(180,5);
  expect(Math.hypot(initial.hands[1].palm.x-initial.ladle.gx,initial.hands[1].palm.y-initial.ladle.gy)).toBeLessThan(.001);
  const icons=await page.evaluate(async()=>{
    const {WITCH_INGREDIENTS}=await import('/src/instruments/witch/witch-model.js');
    return Promise.all(WITCH_INGREDIENTS.map(async item=>{const image=new Image();image.src=item.imageHref;await image.decode();return {...item,loaded:image.naturalWidth>0};}));
  });
  expect(icons.every(icon=>icon.loaded&&icon.instrumentId&&/^assets\/instruments\/.+\.webp$/.test(icon.imageHref))).toBe(true);
  expect(icons.filter(icon=>icon.location==='shelf')).toHaveLength(18);expect(icons.filter(icon=>icon.location==='tree')).toHaveLength(3);
  expect(icons.filter(icon=>icon.location==='cupboard-top').map(icon=>icon.id)).toEqual(topIds);
  expect(icons.filter(icon=>icon.location==='web').map(icon=>icon.id)).toEqual(['spider']);
  expect(initial.objects.filter(object=>object.location==='cupboard-top').map(object=>object.id)).toEqual(topIds);
  expect(initial.objects.filter(object=>object.location==='web').map(object=>object.id)).toEqual(['spider']);
  expect(initial.spiderCaptured).toBe(false);
  const rows=Object.groupBy(initial.objects.filter(object=>object.location==='shelf'),object=>object.y);
  expect(Object.values(rows).map(row=>row.length)).toEqual([3,3,3,3,3,3]);
});

test('a genuine picture click arms Audio and fades both voices in; synthetic input does not',async({page})=>{
  await observeWorklet(page);await open(page);
  await page.locator('#witchCanvas').dispatchEvent('pointerdown',{button:0,clientX:1,clientY:1});
  expect(await state(page)).toMatchObject({playing:false,audioOn:false,quiet:true});
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await wake(page);await audible(page);
  expect(await page.evaluate(()=>window.witchGainRamps.some(ramp=>ramp.value===1))).toBe(true);
  await expect(page.locator('#outputLevel')).toHaveValue('0.75');
  const live=await state(page);await expect.poll(async()=>(await state(page)).performanceTime).toBeGreaterThan(live.performanceTime+.15);
  await key(page,'Space');expect(await state(page)).toMatchObject({playing:false,audioOn:true,quiet:true,presence:0});
  await assertFrozen(page);await waitForStableAudioState(page,false,{timeout:5000,stableMs:150});
  expect(await page.evaluate(()=>window.witchGainRamps.some(ramp=>ramp.value===0))).toBe(true);
  await wake(page);await audible(page);
});

test('presets, mushrooms and ingredient spells preserve the chosen ground or flight mode',async({page})=>{
  test.setTimeout(45000);
  await observeWorklet(page);await open(page);await wake(page);
  const spells=await bank(page);
  for(const scene of ['brew','flight']) {
    await selectScene(page,scene);
    for(const id of ['broom','secret','fingertips']) {
      const before=await state(page);await preset(page,id);
      expect((await state(page)).config).toEqual({...spells.find(spell=>spell.id===id).snapshot,scene});
      expect((await state(page)).performanceTime).toBeGreaterThanOrEqual(before.performanceTime);
    }
    const beforeMushroom=await state(page);await clickWorld(page,'mushrooms');
    await expect.poll(()=>page.evaluate(()=>window.witchTriggers.includes('mushroom-gloop'))).toBe(true);
    expect((await state(page)).config.scene).toBe(scene);
    expect(settings((await state(page)).config)).not.toEqual(settings(beforeMushroom.config));
    expect((await state(page)).objects.every(object=>!object.dropped)).toBe(true);
    // The shelf fades away in flight; its native keyboard ingredient action
    // remains available and must obey the same mode-preserving contract.
    if(scene==='brew')await clickIngredient(page,'gesticules');else await key(page,'q');
    await expectIngredientSolo(page,'gesticules');
    await expect.poll(async()=>(await state(page)).spellTransition,{timeout:5000}).toBeNull();
    const ingredientPreset=(await state(page)).objects.find(object=>object.id==='gesticules').presetId;
    const ingredient=spells.find(spell=>spell.id===ingredientPreset);
    expect((await state(page)).config).toEqual({...ingredient.snapshot,scene});
    expect(await state(page)).toMatchObject({playing:true,audioOn:true});
    await clickWorld(page,'mushrooms');expect((await state(page)).objects.every(object=>!object.dropped)).toBe(true);
  }
  await clickWorld(page,'moon');await expect.poll(async()=>(await state(page)).world.flightLift).toBe(0);
  expect((await state(page)).config.scene).toBe('brew');
});

test('the floor D20 and D randomize complete settings without changing flight or output',async({page})=>{
  await observeWorklet(page);await open(page);await wake(page);
  await page.locator('#outputLevel').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
  const output=await page.locator('#outputLevel').inputValue();
  const spells=await bank(page);
  for(const scene of ['brew','flight']) {
    await selectScene(page,scene);
    for(const action of ['picture','keyboard']) {
      await key(page,'q');expect((await state(page)).objects.some(object=>object.dropped)).toBe(true);
      const before=await state(page);
      if(action==='picture')await clickWorld(page,'die');
      else await key(page,'d');
      await expect.poll(()=>page.evaluate(()=>window.witchTriggers.includes('dice-charm'))).toBe(true);
      const current=await state(page);
      for(const field of ['handRate','handDepth','spellBalance','catSpeed','fabricX','fabricY','trailPull','trailTwist','trailFeedback','trailSpace','treeSpread','treeCurl','ghostTempo','speed','radius','glass','hair','altitude','flightX','tone','nose','hat','spoonHeight'])expect(current.config[field],field).not.toBe(before.config[field]);
      expect(current.config.fingers).not.toEqual(before.config.fingers);
      expect(spells.some(spell=>JSON.stringify(settings(spell.snapshot))===JSON.stringify(settings(current.config)))).toBe(false);
      expect(current).toMatchObject({playing:true,audioOn:true,config:{scene}});
      expect(current.objects.every(object=>!object.dropped)).toBe(true);
      expect(current.performanceTime).toBeGreaterThanOrEqual(before.performanceTime);
      await expect(page.locator('#outputLevel')).toHaveValue(output);
      expect(await page.evaluate(async()=>(await import('/src/site/header-presets.js')).captureHeaderPresetState().selectedId)).toBeNull();
    }
  }
});

test('manual presets wait for stirring or finger bends while the ensemble keeps playing',async({page})=>{
  test.setTimeout(45000);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await observeWorklet(page);await open(page);await preset(page,'secret');
  await expect.poll(async()=>page.evaluate(()=>window.witchVisual?.speed??1),{timeout:12000}).toBeLessThan(.006);
  expect((await state(page)).config).toMatchObject({stirAuto:false,spoonAuto:false});
  const start=await point(page,440,520);await page.mouse.move(start.x,start.y);await page.mouse.down();
  for(let i=1;i<=12;i++){const angle=Math.PI+i/12*Math.PI*2,p=await point(page,600+155*Math.cos(angle),520+48*Math.sin(angle));await page.mouse.move(p.x,p.y);}
  await expect.poll(async()=>page.evaluate(()=>window.witchVisual?.speed??0)).toBeGreaterThan(.03);
  await page.mouse.up();
  const live=await state(page);
  await expect.poll(async()=>page.evaluate(()=>window.witchVisual?.speed??1),{timeout:12000}).toBeLessThan(.006);
  expect((await state(page)).handTime).toBeGreaterThan(live.handTime);
  expect(await page.evaluate(()=>window.witchVisual.brewLevel>0&&window.witchVisual.handLevel>0)).toBe(true);

  await preset(page,'fingertips');
  await expect.poll(async()=>(await state(page)).handReady,{timeout:15000}).toBe(true);
  await page.waitForTimeout(180);
  const before=await state(page);await page.waitForTimeout(350);
  expect((await state(page)).hands[0].tips).toEqual(before.hands[0].tips);
  const tip=before.hands[0].tips[2],from=await point(page,tip.x,tip.y);
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  expect((await state(page)).manualFingerMask&4).toBe(4);
  await page.mouse.move(from.x+45,from.y+40,{steps:5});await page.mouse.up();
  await page.waitForTimeout(120);
  const bent=await state(page);await page.waitForTimeout(350);
  expect(bent.config.fingers[2]).not.toBe(before.config.fingers[2]);
  expect((await state(page)).hands[0].tips).toEqual(bent.hands[0].tips);
  expect(bent.config.handAuto).toBe(false);
  await key(page,'a');expect((await state(page)).config.handAuto).toBe(true);
  await expect.poll(async()=>(await state(page)).hands[0].tips).not.toEqual(bent.hands[0].tips);
  await audible(page);
});

test('stirring and fingers wake only their own part, including during a hair fade',async({page})=>{
  test.setTimeout(45000);await observeWorklet(page);await open(page);
  await expect.poll(async()=>(await state(page)).handReady,{timeout:15000}).toBe(true);
  // A finger can be the first Audio opt-in without starting the singer.
  await bendFinger(page);
  await expect.poll(async()=>(await state(page)).audioOn,{timeout:15000}).toBe(true);
  expect((await state(page)).parts).toEqual({brew:false,hand:true});
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.handLevel??0)).toBeGreaterThan(.0001);
  expect(await page.evaluate(()=>window.witchVisual.brewLevel)).toBeLessThan(.000001);
  const handTime=(await state(page)).handTime;
  const stir=async()=>{
    const start=await point(page,440,520);await page.mouse.move(start.x,start.y);await page.mouse.down();
    for(let i=1;i<=6;i++){const angle=Math.PI+i/6*Math.PI,p=await point(page,600+155*Math.cos(angle),520+48*Math.sin(angle));await page.mouse.move(p.x,p.y);}
    await page.mouse.up();
  };
  await stir();
  expect((await state(page)).parts).toEqual({brew:true,hand:true});
  expect((await state(page)).handTime).toBeGreaterThan(handTime);
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.brewLevel??0)).toBeGreaterThan(.0001);
  await dragHair(page,.85);
  await expect.poll(async()=>(await state(page)).quiet,{timeout:5000}).toBe(true);
  await stir();
  expect((await state(page)).parts).toEqual({brew:true,hand:false});
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.handLevel??1)).toBeLessThan(.000001);
  const held=(await state(page)).handTime;await page.waitForTimeout(150);
  expect((await state(page)).handTime).toBe(held);
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.brewLevel??0)).toBeGreaterThan(.0001);
  // Cancel the next long fade with a finger, keeping the singer asleep.
  await dragHair(page,.85);expect((await state(page)).hushing).toBe(true);
  await bendFinger(page);
  expect(await state(page)).toMatchObject({hushing:false,parts:{brew:false,hand:true}});
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.brewLevel??1)).toBeLessThan(.000001);
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.handLevel??0)).toBeGreaterThan(.0001);
  await page.waitForTimeout(3300);
  expect(await state(page)).toMatchObject({playing:true,parts:{brew:false,hand:true}});
  // Keyboard stirring joins in; a new preset restores its full arrangement.
  await key(page,'b');expect((await state(page)).parts).toEqual({brew:true,hand:true});
  await key(page,'Space');await key(page,'3');expect((await state(page)).parts).toEqual({brew:false,hand:true});
  await key(page,'w');expect((await state(page)).parts).toEqual({brew:true,hand:true});
});

test('web plucks wake alone and the dice and mushrooms restore the preset performance',async({page})=>{
  test.setTimeout(45000);await observeWorklet(page);await open(page);
  await clickWorld(page,'web',{index:6});
  await expect.poll(async()=>(await state(page)).audioOn,{timeout:15000}).toBe(true);
  expect(await state(page)).toMatchObject({playing:true,parts:{brew:false,hand:false},backingAwake:false});
  await expect.poll(()=>page.evaluate(()=>window.witchTriggers.includes('web-6'))).toBe(true);
  const web=await sampleAudioEnvelope(page,{durationMs:180});
  expect(web.summary.finite).toBe(true);expect(web.summary.maxPeak).toBeGreaterThan(.001);expect(web.summary.clippedSamples).toBe(0);
  expect(await page.evaluate(()=>['brewLevel','handLevel','ghostLevel','catLevel','flybyLevel'].every(key=>window.witchVisual[key]<.000001))).toBe(true);
  await clickWorld(page,'die');
  expect(await state(page)).toMatchObject({parts:{brew:true,hand:true},backingAwake:true});
  expect(await page.evaluate(()=>window.witchTriggers.includes('dice-charm'))).toBe(true);
  await preset(page,'small-spell');await audible(page);
  await dragHair(page,.85);
  await expect.poll(async()=>(await state(page)).quiet,{timeout:5000}).toBe(true);
  await key(page,'p');
  expect(await state(page)).toMatchObject({parts:{brew:false,hand:false},backingAwake:false});
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.brewLevel??1)).toBeLessThan(.000001);
  expect(await page.evaluate(()=>window.witchVisual.handLevel)).toBeLessThan(.000001);
  await clickWorld(page,'mushrooms');
  expect(await state(page)).toMatchObject({parts:{brew:true,hand:true},backingAwake:true});
  expect(await page.evaluate(()=>window.witchTriggers.includes('mushroom-gloop'))).toBe(true);
  await audible(page);
});

test('the ladle, fingers, nose and stretchable hat are native controls with clean cancellation',async({page})=>{
  await observeWorklet(page);await open(page);await wake(page);
  await expect.poll(async()=>(await state(page)).handReady,{timeout:15000}).toBe(true);
  const initial=await state(page);await dragWorld(page,'nose',55,0);expect((await state(page)).config.nose).toBeGreaterThan(initial.config.nose+.2);
  const beforeHat=await state(page),hatPull=await dragWorld(page,'hat',40,-50);expect((await state(page)).config.hat).toBeGreaterThan(beforeHat.config.hat);
  expect(Math.abs(hatPull.held.world.hatPullX)).toBeGreaterThan(5);
  expect((await state(page)).world.hatClicks).toBe(0);
  const beforeSpoon=await state(page),spoonDy=beforeSpoon.spoonHeight>.5?55:-55,spoon=await dragWorld(page,'spoon',0,spoonDy);
  expect((await state(page)).config.spoonHeight).toBeCloseTo(Math.max(0,Math.min(1,spoon.grabbed.spoonHeight-spoonDy/180)),5);
  // Capture the live fingertip on the input session: traced snapshots can
  // return after this fast animation has already moved away from the pointer.
  const fingerSession=await page.context().newCDPSession(page);
  const finger=await inputSnapshot(fingerSession,()=>{
    const current=window.witchInstrument.state,tip=current.hands[0].tips[2],rect=document.querySelector('#witchCanvas').getBoundingClientRect();
    const scale=Math.min(rect.width/1000,rect.height/720);
    return {x:rect.x+(rect.width-1000*scale)/2+tip.x*scale,y:rect.y+(rect.height-720*scale)/2+tip.y*scale,before:current.config.fingers[2]};
  });
  await fingerSession.send('Input.dispatchMouseEvent',{type:'mousePressed',x:finger.x,y:finger.y,button:'left',buttons:1,clickCount:1});
  expect(await inputSnapshot(fingerSession,()=>window.witchInstrument.state.manualFingerMask&4)).toBe(4);
  await fingerSession.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:finger.x+45,y:finger.y+40,button:'left',buttons:1});
  await fingerSession.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:finger.x+45,y:finger.y+40,button:'left',buttons:0,clickCount:1});
  await fingerSession.detach();
  expect((await state(page)).config.fingers[2]).not.toBe(finger.before);expect((await state(page)).manualFingerMask).toBe(0);
  await selectScene(page,'fingers');await page.keyboard.down('3');const beforeKey=await state(page);await page.keyboard.press('ArrowDown');
  expect((await state(page)).config.fingers[2]).toBeLessThan(beforeKey.config.fingers[2]);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));expect((await state(page)).manualFingerMask).toBe(0);await page.keyboard.up('3');
  await selectScene(page,'brew');
  const center=await point(page,440,520);await page.mouse.move(center.x,center.y);await page.mouse.down();
  for(let i=1;i<=12;i++){const angle=-i/12*Math.PI*2,p=await point(page,600+155*Math.cos(angle),520+48*Math.sin(angle));await page.mouse.move(p.x,p.y);}
  await page.mouse.up();expect((await state(page)).config.direction).toBe(-1);
  const brightness=(await state(page)).config.tone;await key(page,'+');expect((await state(page)).config.tone).toBeGreaterThan(brightness);
  await key(page,'-');expect((await state(page)).config.tone).toBeCloseTo(brightness,5);
  await audible(page);
});

test('the hat starts intact, breaks on click two and falls on click three until a new spell',async({page})=>{
  test.setTimeout(45000);
  await open(page);await wake(page);
  expect((await state(page)).hatStage).toBe('intact');
  for(const scene of ['brew','flight']) {
    expect((await state(page)).config.scene).toBe(scene);
    for(const [clicks,stage] of [[1,'intact'],[2,'busted'],[3,'gone']]) {
      await clickWorld(page,'hat');
      expect((await state(page)).world.hatClicks).toBe(clicks);
      expect((await state(page)).hatStage).toBe(stage);
    }
    await expect.poll(async()=>(await state(page)).hatDrop).toBeNull();
    expect((await state(page)).targets.hat.r).toBe(0);
    await key(page,'k');expect((await state(page)).world.hatClicks).toBe(3);
    if(scene==='brew') {
      await clickWorld(page,'moon');expect((await state(page)).world.hatClicks).toBe(3);
    }
    await clickWorld(page,'mushrooms');
    expect((await state(page)).world.hatClicks).toBe(0);expect((await state(page)).hatStage).toBe('intact');
  }
  await key(page,'k');await key(page,'k');await key(page,'k');
  await key(page,'q');expect((await state(page)).hatStage).toBe('intact');
});

test('mouth, tree, spider, web, eyes and ghost gestures play over the running ensemble',async({page})=>{
  test.setTimeout(60000);
  await observeWorklet(page);await open(page);await wake(page);
  const voices=await page.evaluate(async()=>(await import('/src/instruments/witch/witch-model.js')).WITCH_VOICES);
  await clickWorld(page,'mouth');
  await expect.poll(async()=>{const current=await state(page);return !current.config.spoonAuto&&current.activeVoice===current.config.voice;}).toBe(true);
  const seen=new Set();
  for(let i=0;i<voices.length;i++) {const before=(await state(page)).activeVoice;await clickWorld(page,'mouth');await expect.poll(async()=>(await state(page)).activeVoice).toBe(voices[(voices.indexOf(before)+1)%voices.length]);seen.add((await state(page)).activeVoice);}
  expect([...seen].sort()).toEqual([...voices].sort());expect((await state(page)).config.spoonAuto).toBe(false);
  const treeBefore=(await state(page)).config.treeShape;await clickWorld(page,'tree');expect((await state(page)).config.treeShape).toBe(treeBefore);
  await expect.poll(()=>page.evaluate(()=>window.witchTriggers.includes('tree-l-system'))).toBe(true);
  await expect.poll(async()=>(await state(page)).treeLevel).toBeGreaterThan(.0001);
  await clickWorld(page,'spider');
  const spiderTriggers=()=>page.evaluate(()=>window.witchTriggers.filter(kind=>['spider-groan','drop-spider'].includes(kind)));
  await expect.poll(spiderTriggers).toEqual(['drop-spider']);
  expect(await page.evaluate(()=>window.witchTriggers.some(kind=>kind.startsWith('web-')))).toBe(false);
  expect((await state(page)).spiderCaptured).toBe(true);expect((await state(page)).objects.find(object=>object.id==='spider').dropped).toBe(true);
  await key(page,'s');expect(await spiderTriggers()).toEqual(['drop-spider']);
  await preset(page,'small-spell');expect((await state(page)).spiderCaptured).toBe(false);
  expect((await state(page)).objects.find(object=>object.id==='spider').dropped).toBe(false);
  for(let index=0;index<7;index++){await clickWorld(page,'web',{index});await expect.poll(()=>page.evaluate(index=>window.witchTriggers.includes(`web-${index}`),index)).toBe(true);}
  const beforeGhost=await state(page);expect(beforeGhost.ghosts.map(ghost=>ghost.id)).toEqual(ghostIds);
  await dragGhost(page,'creaturazoid',-35);expect((await state(page)).config.ghostTempo).toBeGreaterThan(beforeGhost.config.ghostTempo+20);
  const fast=(await state(page)).config.ghostTempo;await dragGhost(page,'creaturazoid',30,{cancel:true});expect((await state(page)).config.ghostTempo).toBeLessThan(fast-15);
  expect((await state(page)).config.scene).toBe(beforeGhost.config.scene);expect((await state(page)).world.handOpen).toBe(beforeGhost.world.handOpen);
  const tempo=(await state(page)).config.ghostTempo;await key(page,'g');expect((await state(page)).config.ghostTempo).toBeCloseTo(tempo+6,5);
  await key(page,'Shift+G');expect((await state(page)).config.ghostTempo).toBeCloseTo(tempo,5);
  await clickWorld(page,'eyes');await expect.poll(async()=>(await state(page)).eyeShock).toBeGreaterThan(.1);
  await expect.poll(()=>page.evaluate(()=>window.witchTriggers.includes('eye-shock'))).toBe(true);await audible(page);
});

test('broom and moon alone toggle flight while the fabric and hair noodles bend its sound',async({page})=>{
  await observeWorklet(page);await open(page);await clickWorld(page,'broom');
  await expect.poll(async()=>(await state(page)).world.flightLift).toBe(1);
  expect((await state(page)).config.scene).toBe('flight');
  const flying=await state(page);expectHairInScene(flying);
  const fabric=await dragWorld(page,'fabric',100,-65,{holdMs:120});
  expect(fabric.grabbed.held).toBe(true);
  const anchor={fabricGrabX:fabric.grabbed.visual.fabricGrabX,fabricGrabY:fabric.grabbed.visual.fabricGrabY};
  expect(fabric.held.fabricGesture).toMatchObject({held:true,visual:anchor});
  for(const field of ['fabricPullX','fabricPullY'])expect(fabric.held.fabricGesture.visual[field]).toBe(fabric.moved.fabricGesture.visual[field]);
  expect(fabric.held.fabricGesture.visual.fabricPullX).toBeCloseTo(100,1);expect(fabric.held.fabricGesture.visual.fabricPullY).toBeCloseTo(-65,1);
  expect(fabric.held.config.fabricX).toBeCloseTo(anchor.fabricGrabX+.1,3);
  expect(fabric.held.config.fabricY).toBeCloseTo(1-anchor.fabricGrabY+65/720,3);
  expect(fabric.held.fabricGesture.audio.fabricPull).toBeGreaterThan(fabric.grabbed.audio.fabricPull);
  await expect.poll(async()=>{
    const current=(await state(page)).fabricGesture,v=current.visual,held=fabric.held.fabricGesture.visual;
    return !current.held&&Math.hypot(v.fabricPullX-held.fabricPullX,v.fabricPullY-held.fabricPullY)>1&&
      Math.hypot(v.fabricVelocityX,v.fabricVelocityY)>0&&current.audio.fabricPull+current.audio.fabricVelocity>0;
  }).toBe(true);
  const cancelled=await dragWorld(page,'fabric',70,-40,{cancel:true});
  const still={held:false,visual:{fabricPullX:0,fabricPullY:0,fabricVelocityX:0,fabricVelocityY:0},audio:{fabricPull:0,fabricVelocity:0}};
  expect((await state(page)).fabricGesture).toMatchObject(still);
  await page.mouse.move(cancelled.to.x+30,cancelled.to.y-30);expect((await state(page)).fabricGesture).toMatchObject(still);
  const beforeTrail=await state(page),trail=await dragWorld(page,'trail',35,-32,{turns:1}),pulled=await state(page);
  const rope=trail.held.trailGesture,grab=rope.grab,points=rope.strands.find(strand=>strand.index===grab.index).points;
  expect(rope.held).toBe(true);
  for(const axis of ['x','y'])expect(points[grab.segment][axis]*(1-grab.fraction)+points[grab.segment+1][axis]*grab.fraction).toBeCloseTo(rope.point[axis]+grab.offset[axis],3);
  expect(pulled.trailGesture).toMatchObject({held:false,active:true});
  await expect.poll(async()=>{
    const current=(await state(page)).trailGesture.strands.find(strand=>strand.index===grab.index)?.points;
    return current?Math.hypot(current[grab.segment].x-points[grab.segment].x,current[grab.segment].y-points[grab.segment].y):0;
  }).toBeGreaterThan(1);
  expect(pulled.config.trailPull).toBeGreaterThan(beforeTrail.config.trailPull);expect(pulled.config.trailTwist).toBeGreaterThan(beforeTrail.config.trailTwist);
  expect(pulled.config.trailFeedback).toBeGreaterThan(beforeTrail.config.trailFeedback+.3);
  expect(Math.abs(pulled.config.trailSpace-beforeTrail.config.trailSpace)).toBeGreaterThan(.01);
  await page.mouse.move(trail.to.x+30,trail.to.y-30);
  for(const field of ['trailPull','trailTwist','trailFeedback','trailSpace'])expect((await state(page)).config[field]).toBe(pulled.config[field]);
  await expect.poll(()=>page.evaluate(()=>window.witchTriggers.includes('fabric-wind'))).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.delayWet??0)).toBeGreaterThan(.1);await audible(page);
  expect((await state(page)).catTargets).toBeNull();expect((await state(page)).visitorTargets).toEqual({});
  await dragWorld(page,'fabric',100,-65,{holdMs:120});
  expect((await state(page)).fabricGesture.audio.fabricPull).toBeGreaterThan(0);
  await key(page,'Backspace');expect(await state(page)).toMatchObject({quiet:true,config:{scene:'flight'},fabricGesture:still,trailGesture:{held:false,active:false,strands:[]}});
  await clickWorld(page,'moon');await expect.poll(async()=>(await state(page)).world.flightLift).toBe(0);
  expect((await state(page)).config.scene).toBe('brew');
});

test('representative shelf icons solo, interpolate settings and stay consumed until a refill',async({page})=>{
  test.setTimeout(60000);
  await observeWorklet(page);await open(page);await wake(page);const spells=await bank(page);
  let count=0;
  for(const id of ['puggler','roach','rubix','chiptune','acid-303','eyeball']) {
    const origin=(await state(page)).objects.find(object=>object.id===id);await clickIngredient(page,id);await expectIngredientSolo(page,id);
    expect((await state(page)).spellTransition).toBeTruthy();
    const phraseAndDive=(origin.phraseDuration||0)+(origin.flightDuration||1.5);
    await expect.poll(async()=>(await state(page)).spellTransition,{timeout:phraseAndDive*1000+3000}).toBeNull();
    expect((await state(page)).config).toEqual({...spells.find(spell=>spell.id===origin.presetId).snapshot,scene:'brew'});
    await expect.poll(async()=>(await state(page)).objects.find(object=>object.id===id).alpha).toBe(0);
    expect((await state(page)).objects.filter(object=>object.dropped)).toHaveLength(++count);
  }
  await clickWorld(page,'mushrooms');expect((await state(page)).objects.every(object=>!object.dropped)).toBe(true);
  await clickIngredient(page,'puggler');await clickWorld(page,'moon');expect((await state(page)).objects.every(object=>!object.dropped)).toBe(true);
  expect((await state(page)).config.scene).toBe('flight');
  await key(page,']');expect((await state(page)).selectedIngredient).toBe(ingredientIds[0]);await key(page,'[');expect((await state(page)).selectedIngredient).toBe(ingredientIds.at(-1));
  await key(page,'Enter');expect((await state(page)).objects.find(object=>object.id===ingredientIds.at(-1)).dropped).toBe(true);
});

test('ingredient clicks cycle three sounds across refills without toggling flight',async({page})=>{
  test.setTimeout(45000);
  await observeWorklet(page);await open(page);await wake(page);
  for(const variant of [0,1,2,0]) {
    await clickIngredient(page,'rubix');
    await expect.poll(()=>page.evaluate(()=>window.witchVariantTriggers.filter(item=>item.kind==='drop-rubix').at(-1)?.variant)).toBe(variant);
    await expect.poll(()=>page.evaluate(variant=>window.witchVariantEvidence.some(item=>item.kind==='drop-rubix'&&item.variant===variant),variant)).toBe(true);
    expect((await state(page)).config.scene).toBe('brew');
    await clickWorld(page,'mushrooms');
    expect((await state(page)).objects.find(item=>item.id==='rubix').dropped).toBe(false);
  }
  expect(await page.evaluate(()=>window.witchVariantTriggers.filter(item=>item.kind==='drop-rubix').map(item=>item.variant))).toEqual([0,1,2,0]);
});

test('a tree phrase stays perched before its dive, and hush freezes the pending transition',async({page})=>{
  await observeWorklet(page);await open(page);await wake(page);
  const before=await state(page),origin=before.objects.find(object=>object.id==='blech');
  await clickIngredient(page,'blech');await expectIngredientSolo(page,'blech');
  await page.waitForTimeout(350);const perched=await state(page),object=perched.objects.find(object=>object.id==='blech');
  expect(Math.abs(object.x-origin.x)).toBeLessThanOrEqual(3);expect(Math.abs(object.y-origin.y)).toBeLessThanOrEqual(2);
  expect(perched.spellTransition.progress).toBe(0);expect(perched.config).toEqual(before.config);
  await key(page,'Space');const asleep=await assertFrozen(page);
  expect((await state(page)).spellTransition).toEqual(asleep.spellTransition);
  expect((await state(page)).objects.find(object=>object.id==='blech').dropAge).toBe(asleep.objects.find(object=>object.id==='blech').dropAge);
  await wake(page);await expect.poll(async()=>(await state(page)).spellTransition,{timeout:7000}).toBeNull();
  expect((await state(page)).objects.find(object=>object.id==='blech')).toMatchObject({dropped:true,alpha:0,x:600,y:544});
});

test('real visitor routes and native captures work while a slow Audio startup catches up',async({page})=>{
  await observeWorklet(page);await page.clock.install({time:new Date('2026-10-26T12:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-26T12:00:01Z'));
  // Chromium's worklet fetch can bypass page routing. Hold the actual module
  // promise so the native fallback clock is deterministically under test.
  await page.addInitScript(()=>{
    const addModule=AudioWorklet.prototype.addModule;
    const ready=new Promise(resolve=>{window.releaseWitchModule=resolve;});
    AudioWorklet.prototype.addModule=function(url,...args){
      return String(url).includes('/witch-worklet.js')?ready.then(()=>addModule.call(this,url,...args)):addModule.call(this,url,...args);
    };
  });
  try {
    await open(page);const p=await point(page,24,704);await page.mouse.click(p.x,p.y);
    await expect.poll(async()=>(await state(page)).starting).toBe(true);
    const advanceBy=async milliseconds=>{await page.clock.fastForward(milliseconds);await page.clock.runFor(80);};
    const advanceTo=async seconds=>{const elapsed=(await state(page)).performanceTime;await advanceBy(Math.max(1,(seconds-elapsed)*1000));expect((await state(page)).performanceTime).toBeGreaterThanOrEqual(seconds);};
    await advanceTo(19.5);
    const mouse=(await state(page)).visitors.find(visitor=>visitor.id==='mouse');
    expect(mouse).toMatchObject({source:'quadruped',behaviorId:'walk',visible:true,rotation:Math.PI/2});expect(mouse.x).toBe(10);
    await clickAnimal(page,'mouse',{touch:true});expect((await state(page)).visitorTargets.mouse).toBeUndefined();
    await advanceBy(1100);expect((await state(page)).visitors.find(visitor=>visitor.id==='mouse').captureProgress).toBe(1);
    await advanceTo(32);
    expect((await state(page)).cat).toMatchObject({source:'quadruped',animalId:'cat',active:true});
    await clickAnimal(page,'cat',{part:'head'});expect((await state(page)).catTargets).toBeNull();
    await advanceBy(1100);expect((await state(page)).cat.captureProgress).toBe(1);
    await advanceTo(47);
    const lizard=(await state(page)).visitors.find(visitor=>visitor.id==='lizard');
    expect(lizard).toMatchObject({source:'quadruped',behaviorId:'lizard-scuttle',visible:true,rotation:Math.PI,y:14});
    await clickAnimal(page,'lizard');await advanceBy(1100);
    expect((await state(page)).visitors.find(visitor=>visitor.id==='lizard').captureProgress).toBe(1);
    const captured=(await state(page)).capturedAnimals;expect(Object.keys(captured).sort()).toEqual(['cat','lizard','mouse']);
    await key(page,'c');await key(page,'n');await key(page,'l');expect((await state(page)).capturedAnimals).toEqual(captured);
    await page.evaluate(()=>window.releaseWitchModule());await expect.poll(async()=>(await state(page)).audioOn,{timeout:15000}).toBe(true);
    await expect.poll(()=>page.evaluate(()=>window.witchTriggers.filter(kind=>['drop-cat','drop-mouse','drop-lizard'].includes(kind)))).toEqual(['drop-mouse','drop-cat','drop-lizard']);
    await key(page,'Backspace');expect(await state(page)).toMatchObject({playing:false,quiet:true,performanceTime:0,capturedAnimals:{}});
  } finally {await page.evaluate(()=>window.releaseWitchModule?.());}
});

test('Space, reset and page lifecycle release gestures without losing the chosen flight mode',async({page})=>{
  await observeWorklet(page);await open(page);await wake(page);await selectScene(page,'flight');
  await key(page,'x');await expect.poll(async()=>(await state(page)).eyeShock).toBeGreaterThan(.1);
  await key(page,'Space');await assertFrozen(page);expect((await state(page)).config.scene).toBe('flight');
  await key(page,'Backspace');expect(await state(page)).toMatchObject({playing:false,quiet:true,performanceTime:0,eyeShock:0,config:{scene:'flight'}});
  await waitForStableAudioState(page,false,{timeout:5000,stableMs:150});
  await wake(page);await page.locator('#witchCanvas').focus();await page.keyboard.down('2');expect((await state(page)).manualFingerMask&2).toBe(2);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));expect((await state(page)).manualFingerMask).toBe(0);await page.keyboard.up('2');
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  const live=await state(page);await expect.poll(async()=>(await state(page)).performanceTime).toBeGreaterThan(live.performanceTime);
  await audible(page);await page.locator('#audioButton').click();expect(await state(page)).toMatchObject({quiet:true,audioOn:false,config:{scene:'flight'}});
  await waitForStableAudioState(page,false,{timeout:5000,stableMs:150});
});

for(const [label,width,height] of [['desktop',1440,900],['portrait',390,844],['landscape',844,390]]) {
  test.describe(label,()=>{
    test.use({viewport:{width,height},hasTouch:label!=='desktop',isMobile:label!=='desktop'});
    if(label!=='landscape')test(`${label}: branch drags retain their shape and release native capture`,async({page})=>{
      await observeWorklet(page);await open(page);await wake(page,{touch:label==='portrait'});
      await expect.poll(async()=>(await state(page)).handReady,{timeout:15000}).toBe(true);
      const touch=label==='portrait',treeSettings=current=>({treeShape:current.config.treeShape,treeSpread:current.config.treeSpread,treeCurl:current.config.treeCurl});
      const cues=()=>page.evaluate(()=>window.witchTriggers.filter(kind=>kind==='tree-l-system').length);
      let count=await cues();
      for(const drag of [{spread:36,dy:-28},{spread:-24,dy:20,cancel:true},{spread:0,dy:0,cancel:true}]) {
        const {before,held,released}=await clickWorld(page,'tree',{touch,drag});
        await expect.poll(cues).toBeGreaterThan(count);count=await cues();
        expect(held.config.treeShape).toBe(before.config.treeShape);
        expect(held.config.treeSpread).toBeCloseTo(Math.max(0,Math.min(1,before.config.treeSpread+drag.spread/180)),4);
        expect(held.config.treeCurl).toBeCloseTo(Math.max(0,Math.min(1,before.config.treeCurl-drag.dy/180)),4);
        expect(treeSettings(released)).toEqual(treeSettings(held));
        expect(released).toMatchObject({playing:true,config:{scene:'brew'}});
        const points=released.tree.segments.flatMap(({a,b})=>[a,b]);
        expect(points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))).toBe(true);
        expect(points.some(p=>p.x>0&&p.x<1000&&p.y>0&&p.y<720)).toBe(true);
        if(drag.spread||drag.dy)expect(released.tree.segments).not.toEqual(before.tree.segments);
        else expect(released.tree.segments).toEqual(before.tree.segments);
      }
      if(!touch) {
        const before=await state(page);await page.locator('#witchCanvas').focus();await page.keyboard.down('t');
        expect(treeSettings(await state(page))).toEqual(treeSettings(before));
        await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowUp');await page.keyboard.up('t');
        const after=await state(page);expect(after.config.treeShape).toBe(before.config.treeShape);
        expect(after.config.treeSpread).toBeCloseTo(before.config.treeSpread-.05,5);expect(after.config.treeCurl).toBeCloseTo(before.config.treeCurl+.05,5);
        await key(page,'t');expect((await state(page)).config.treeShape).toBe(after.config.treeShape);
      }
      const beforeClick=await state(page);await clickWorld(page,'tree',{touch});
      expect((await state(page)).config).toMatchObject({treeShape:beforeClick.config.treeShape,treeSpread:beforeClick.config.treeSpread,treeCurl:beforeClick.config.treeCurl});
      const clicked=await state(page);expect(clicked.tree.segments).toEqual(beforeClick.tree.segments);
      await clickWorld(page,'mushrooms',{touch});expect((await state(page)).tree.segments).not.toEqual(clicked.tree.segments);
      await preset(page,'small-spell');const authored=(await bank(page)).find(item=>item.id==='small-spell').snapshot;
      expect((await state(page)).config).toMatchObject({treeShape:authored.treeShape,treeSpread:authored.treeSpread,treeCurl:authored.treeCurl});
    });
    test(`${label}: full-width controls, slow grounded hair hush and flying hair delay`,async({page},testInfo)=>{
      test.setTimeout(60000);await observeWorklet(page);await open(page);
      const touch=label!=='desktop';await wake(page,{touch});
      await expect.poll(async()=>(await state(page)).handReady,{timeout:15000}).toBe(true);
      const canvasBox=await page.locator('#witchCanvas').boundingBox();expect(canvasBox.width).toBe(width);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await expect(page.locator('.witch-panel,#witchParameters')).toHaveCount(0);
      await expect(page.locator('[data-instrument-preset-host],.instrument-preset-controls,#playButton,#resetButton,.witch-help')).toHaveCount(0);
      if(touch){const rect=await page.locator('#audioButton').boundingBox();expect(rect.width).toBeGreaterThanOrEqual(48);expect(rect.height).toBeGreaterThanOrEqual(48);}
      for(const scene of ['brew','flight']) {
        await selectScene(page,scene);if(scene==='flight')await expect.poll(async()=>(await state(page)).world.flightLift).toBe(1);
        const before=await state(page);expectHairInScene(before);
        await dragHair(page,.3,{touch,cancel:true});
        expect((await state(page)).config.hair).toBeGreaterThan(before.config.hair+.15);expect((await state(page)).quiet).toBe(false);
        if(scene==='brew') {
          await dragHair(page,.85,{touch});
          expect(await state(page)).toMatchObject({hushing:true,playing:true,audioOn:true,presence:0});
          const fading=await state(page);
          expect(fading.presenceLevel).toBeGreaterThan(.1);
          await page.waitForTimeout(650);
          const later=await state(page);
          expect(later.performanceTime).toBeGreaterThan(fading.performanceTime);
          expect(later.presenceLevel).toBeLessThan(fading.presenceLevel);
          await expect.poll(async()=>(await state(page)).quiet,{timeout:5000}).toBe(true);
          const frozen=await assertFrozen(page);await waitForStableAudioState(page,false,{timeout:5000,stableMs:150});
          // A real ladle turn resumes only the singer after the long hush.
          const from=await point(page,440,520);await page.mouse.move(from.x,from.y);await page.mouse.down();
          for(let i=1;i<=6;i++){const angle=Math.PI+i/6*Math.PI,p=await point(page,600+155*Math.cos(angle),520+48*Math.sin(angle));await page.mouse.move(p.x,p.y);}
          await page.mouse.up();await expect.poll(async()=>(await state(page)).performanceTime).toBeGreaterThan(frozen.performanceTime);
          expect((await state(page)).parts).toEqual({brew:true,hand:false});
          await expect.poll(()=>page.evaluate(()=>window.witchVisual?.handLevel??1)).toBeLessThan(.000001);
          await bendFinger(page,{touch});
          expect((await state(page)).parts).toEqual({brew:true,hand:true});
        } else {
          const beforePull=await state(page);
          await dragHair(page,touch?1.3:2.2,{touch});
          const pulled=await state(page);
          expect(pulled).toMatchObject({hushing:false,playing:true,audioOn:true,presence:1});
          expect(Math.abs(pulled.world.hairPullX)+Math.abs(pulled.world.hairPullY)).toBeGreaterThan(70);
          expect(pulled.config.trailPull).not.toBe(beforePull.config.trailPull);
          expect(pulled.config.trailTwist).not.toBe(beforePull.config.trailTwist);
          expect(pulled.config.trailSpace).toBeGreaterThan(beforePull.config.trailSpace);
          expect(pulled.config.trailFeedback).toBeGreaterThan(beforePull.config.trailFeedback);
          expect(pulled.performanceTime).toBeGreaterThan(beforePull.performanceTime);
        }
        expect((await state(page)).config.scene).toBe(scene);await audible(page);
        await page.screenshot({path:testInfo.outputPath(`${label}-${scene}-hair.png`),fullPage:true});
        await clickWorld(page,'die',{touch});expect((await state(page)).config.scene).toBe(scene);
        // Return to a moderate authored hair amount for the next mode without
        // changing flight or reaching through a removed parameter panel.
        await preset(page,'small-spell');expect((await state(page)).config.scene).toBe(scene);
      }
      await expect(page.locator('#witchCanvas')).toHaveAttribute('aria-describedby','gestureHint keyboardHelp');
      await expect(page.locator('#keyboardHelp')).toContainText('Backspace resets the brew.');
      const a11y=await new AxeBuilder({page}).include('.witch-shell').analyze();expect(a11y.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    });
  });
}
