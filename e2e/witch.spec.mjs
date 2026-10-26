import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';

async function open(page) {
  await page.goto('/witch.html');
  await expect(page.locator('.instrument-preset-controls')).toBeVisible();
  await page.waitForFunction(()=>Boolean(window.witchInstrument?.state));
}
const state=page=>page.evaluate(()=>window.witchInstrument.state);
const shelfIds=['glass','tail','earwax','hair','roach','oculoid','rubix','hiccup','gesticules','marimba','choir','julie-saw','puggler','fractal','synthesaurus','jaw-harp','harmonicazoid','dentaphone'];
const treeIds=['blech','syrinx','eyeball'];
const ingredientIds=[...shelfIds,...treeIds];
const ghostIds=['creaturazoid','monstroid','hiccup'];
async function parameters(page,open=true) {
  const panel=page.locator('#witchParameters');
  if(await panel.evaluate(el=>el.open)!==open) await panel.locator(':scope > summary').click();
  expect(await panel.evaluate(el=>el.open)).toBe(open);
}
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
    window.witchTriggers=[];
    const Original=window.AudioWorkletNode;
    window.AudioWorkletNode=class extends Original {
      constructor(context,name,options) {
        super(context,name,options);
        if(name==='witch-voice') {
          const post=this.port.postMessage.bind(this.port);
          this.port.postMessage=(message,...args)=>{
            if(message.type==='trigger') window.witchTriggers.push(message.kind);
            return post(message,...args);
          };
          this.port.addEventListener('message',({data})=>{
            if(data.type==='visual') {
              window.witchVisual=data;
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
async function range(page,id,value) {
  await page.locator(`#${id}`).evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
}
async function clickIngredient(page,id,touch=false) {
  await page.locator('#witchCanvas').scrollIntoViewIfNeeded();
  const object=await page.evaluate(async id=>{
    const {warpWitchPoint}=await import('/src/instruments/witch/witch-renderer.js');
    const state=window.witchInstrument.state,object=state.objects.find(item=>item.id===id);
    return {...object,...warpWitchPoint(object,{trip:state.config.trip,visualMode:state.config.visualMode,eyeShock:state.eyeShock,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
      warpTime:matchMedia('(prefers-reduced-motion: reduce)').matches?0:performance.now()/1000})};
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
    const visual=window.witchVisual;
    return {triggered:window.witchTriggers.includes(kind),kind:visual?.dropKind,
      solo:visual?.dropLevel>.0001,voice:visual?.brewLevel>.0001,fingers:visual?.handLevel>.0001};
  },`drop-${id}`)).toEqual({triggered:true,kind:`drop-${id}`,solo:true,voice:true,fingers:true});
}
async function clickWorld(page,key,{touch=false,index=0}={}) {
  await page.locator('#witchCanvas').scrollIntoViewIfNeeded();
  const session=await page.context().newCDPSession(page);
  const snapshot=await inputSnapshot(session,async({key,index})=>{
    const {WITCH_LAYOUT,warpWitchPoint}=await import('/src/instruments/witch/witch-renderer.js');
    const current=window.witchInstrument.state,rect=document.querySelector('#witchCanvas').getBoundingClientRect();
    const target=key==='moon'?WITCH_LAYOUT.moon:key==='mushrooms'?WITCH_LAYOUT.mushrooms[0]
      :key==='web'?{x:993,y:235+(index+.5)*270/7}:current.targets[key];
    return {target:warpWitchPoint(target,{...current.config,eyeShock:current.eyeShock,
      reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,warpTime:performance.now()/1000}),
      rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
  },{key,index});
  const from=stagePoint(snapshot.rect,snapshot.target.x,snapshot.target.y);
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
    const visual={trip:current.config.trip,visualMode:current.config.visualMode,eyeShock:current.eyeShock,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,warpTime:matchMedia('(prefers-reduced-motion: reduce)').matches?0:performance.now()/1000};
    const blockers=[...current.fingerTips.map(point=>({...point,r:minRadius})),
      ...current.hands.slice(0,1).flatMap(hand=>hand.palm?[{...hand.palm,r:minRadius},{...hand.wrist,r:minRadius*.55}]:[]),
      ...current.hairGeometry.strands.flatMap(strand=>strand.points.map(point=>({...point,r:Math.min(28,Math.max(12*current.hairGeometry.scale,minRadius*.32))}))),
      ...['nose','hat','tone','fabric'].map(key=>({...warpWitchPoint(current.targets[key],visual),r:Math.max(current.targets[key].r,minRadius*.7)})),
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
async function ghostRate(page,duration=450) {
  return page.evaluate(ms=>new Promise(resolve=>{
    const phase=window.witchInstrument.state.ghostPhase,time=performance.now();
    setTimeout(()=>resolve((window.witchInstrument.state.ghostPhase-phase)*1000/(performance.now()-time)),ms);
  }),duration);
}
async function dragHair(page,amount,{touch=false,cancel=false,hold=false}={}) {
  const canvas=page.locator('#witchCanvas');await canvas.scrollIntoViewIfNeeded();
  const session=await page.context().newCDPSession(page);
  await canvas.evaluate(async canvas=>{
    const {warpWitchPoint}=await import('/src/instruments/witch/witch-renderer.js');
    window.witchHairPointerId=null;
    canvas.addEventListener('pointerdown',event=>{
      window.witchHairPointerId=event.pointerId;
      const current=window.witchInstrument.state,rect=canvas.getBoundingClientRect(),scale=Math.min(rect.width/1000,rect.height/720);
      const visual={trip:current.config.trip,visualMode:current.config.visualMode,eyeShock:current.eyeShock,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,warpTime:matchMedia('(prefers-reduced-motion: reduce)').matches?0:performance.now()/1000};
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
    const visual={trip:current.config.trip,visualMode:current.config.visualMode,eyeShock:current.eyeShock,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,warpTime:matchMedia('(prefers-reduced-motion: reduce)').matches?0:performance.now()/1000};
    const rect=document.querySelector('#witchCanvas').getBoundingClientRect();
    const minRadius=Math.max(46,24/Math.min(rect.width/1000,rect.height/720));
    const unwarp=point=>warpWitchPoint(point,visual,true);
    const blockers=[...['nose','mouth','eyes','hat','tone','fabric'].map(key=>{
      const target=current.targets[key],radius={nose:minRadius*.65,mouth:Math.min(27,minRadius*.38),eyes:Math.min(27,minRadius*.38),hat:minRadius*.7,tone:Math.min(50,minRadius*.7),fabric:minRadius*.6}[key];
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
    if((await canvas.getAttribute('title'))!=='Pull her hair for a noisier spell')return false;
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
  if(hold) {
    const before=await state(page);
    for(let i=0;i<3;i++) {
      await page.waitForTimeout(100);
      if(!touch)await session.send('Input.dispatchMouseEvent',{type:'mouseMoved',...from,button:'left',buttons:1});
      expect((await state(page)).config.hair).toBe(before.config.hair);
    }
    const after=await state(page);
    expect(Math.hypot(after.hairGeometry.root.x-before.hairGeometry.root.x,after.hairGeometry.root.y-before.hairGeometry.root.y)).toBeGreaterThan(.5);
  }
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

test('parameters start tucked away while presets, transport and every ingredient remain reachable',async({page})=>{
  await open(page);
  await expect(page.locator('#outputLevel')).toHaveValue('0.75');
  expect(await page.locator('#witchParameters').evaluate(el=>el.open)).toBe(false);
  for(const selector of ['.instrument-preset-controls','#playButton','#resetButton','#audioButton']) await expect(page.locator(selector)).toBeVisible();
  const sliders=page.locator('.witch-panel input[type="range"]');
  expect(await sliders.count()).toBeGreaterThan(0);
  for(const slider of await sliders.all()) await expect(slider).toBeHidden();
  await expect(page.locator('#ghostTempo')).toBeHidden();
  await expect(page.locator('.mz-tap-tempo[data-tap-control="#ghostTempo"]')).toBeHidden();
  expect((await state(page)).objects.map(object=>object.id)).toEqual(ingredientIds);
  const icons=await page.evaluate(async()=>{
    const {WITCH_INGREDIENTS}=await import('/src/instruments/witch/witch-model.js');
    return Promise.all(WITCH_INGREDIENTS.map(async item=>{
      const image=new Image();image.src=item.imageHref;await image.decode();
      return {id:item.id,instrumentId:item.instrumentId,imageHref:item.imageHref,presetId:item.presetId,location:item.location,loaded:image.naturalWidth>0};
    }));
  });
  expect(icons).toHaveLength(ingredientIds.length);expect(icons.every(icon=>icon.loaded&&icon.instrumentId)).toBe(true);
  expect(icons.filter(icon=>icon.location==='shelf')).toHaveLength(18);
  expect(icons.filter(icon=>icon.location==='tree')).toHaveLength(3);
  expect(icons.find(icon=>icon.id==='puggler')).toEqual({id:'puggler',instrumentId:'puggler',imageHref:'assets/instruments/puggler.webp',presetId:'shelf-puggler',location:'shelf',loaded:true});
  const rows=Object.groupBy((await state(page)).objects.filter(object=>object.location==='shelf'),object=>object.y);
  expect(Object.values(rows).map(row=>row.length)).toEqual([3,3,3,3,3,3]);
  await page.locator('#witchParameters > summary').focus();await page.keyboard.press('Enter');
  for(const slider of await sliders.all()) await expect(slider).toBeVisible();
  await expect(page.locator('.mz-tap-tempo[data-tap-control="#ghostTempo"]')).toBeVisible();
  for(const id of ingredientIds) await expect(page.locator(`#witchParameters [data-drop="${id}"]`)).toBeVisible();
  await page.locator('[data-drop="roach"]').focus();await page.keyboard.press('Enter');
  expect((await state(page)).objects.find(item=>item.id==='roach').dropped).toBe(true);
  expect((await state(page)).playing).toBe(true);expect((await state(page)).audioOn).toBe(false);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test('Witches Brew opens as one silent, moving ensemble with two offset model hands',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await open(page);await expect(page.locator('h1')).toHaveText('witches brew');
  await expect(page).toHaveTitle('Witches Brew · Morphazoid');
  expect((await state(page)).playing).toBe(true);
  expect((await state(page)).world.handReach).toBe(1);
  expect((await state(page)).audioOn).toBe(false);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await expect(page.locator('.witch-scene-switch, button[data-scene], .witch-scene-caption, .witch-understage')).toHaveCount(0);
  expect(await page.locator('h1').evaluate(el=>getComputedStyle(el).fontFamily)).not.toContain('Georgia');
  await page.waitForFunction(()=>window.witchInstrument.state.handReady);
  // The permanently enlarged hand is playable while the voice is featured.
  await page.locator('#playButton').click();
  const unfeatured=await state(page),tip=unfeatured.hands[0].tips[1],from=await point(page,tip.x,tip.y);
  expect(unfeatured.world.handOpen).toBe(false);
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  expect((await state(page)).manualFingerMask&2).toBe(2);
  await page.mouse.move(from.x+30,from.y+60,{steps:4});await page.mouse.up();
  expect((await state(page)).config.fingers[1]).not.toBe(unfeatured.config.fingers[1]);
  expect((await state(page)).manualFingerMask).toBe(0);
  await page.locator('#playButton').click();
  await selectScene(page,'fingers');
  const hand=await state(page);
  expect(hand.handMetadata).toMatchObject({triangles:28994,deformBones:22,runtimeAdapted:true,modelInstances:2,webglContexts:1});
  expect(hand.hands).toHaveLength(2);
  expect(hand.hands[0].rotation).toBeCloseTo(55*Math.PI/180,5);
  expect(hand.hands[1].rotation).toBeCloseTo(-.38+Math.PI/2,5);
  expect(hand.handMetadata.wristTwists[1]-hand.handMetadata.wristTwists[0]).toBeCloseTo(180,5);
  expect(hand.hands[1].scale).toBeCloseTo(.23*1.25*1.25,5);
  expect(Math.hypot(hand.hands[1].palm.x-hand.ladle.gx,hand.hands[1].palm.y-hand.ladle.gy)).toBeLessThan(.001);
  for(const model of hand.hands) {
    expect(model.tips).toHaveLength(5);
    for(const tip of model.tips) {expect(tip.x).toBeGreaterThan(0);expect(tip.x).toBeLessThan(1000);expect(tip.y).toBeGreaterThan(0);expect(tip.y).toBeLessThan(720);}
  }
  await expect.poll(async()=>(await state(page)).handTime).toBeGreaterThan(hand.handTime+.2);
  for(const i of [0,1]) await expect.poll(async()=>JSON.stringify((await state(page)).hands[i].tips)).not.toBe(JSON.stringify(hand.hands[i].tips));
  await page.locator('#witchCanvas').focus();await page.keyboard.press('w');
  expect((await state(page)).world.trip).toBe(1);
  expect((await state(page)).playing).toBe(true);
  expect(errors).toEqual([]);
});

test('voice and fingers stay sounding together through focus, flight and manual finger overrides',async({page})=>{
  await observeWorklet(page);await open(page);
  await page.locator('#audioButton').click();
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.brewLevel??0)).toBeGreaterThan(.001);
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.handLevel??0)).toBeGreaterThan(.001);
  await selectScene(page,'fingers');
  await page.locator('#witchCanvas').focus();await page.keyboard.down('3');
  const before=await state(page);await page.keyboard.press('ArrowUp');
  const after=await state(page);
  expect(after.manualFingerMask&4).toBe(4);
  expect(after.config.fingers[2]).toBeGreaterThan(before.config.fingers[2]);
  expect(after.config.fingers.filter((_,i)=>i!==2)).toEqual(before.config.fingers.filter((_,i)=>i!==2));
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.fingerLevels?.filter(v=>v>.05).length)).toBe(5);
  await page.keyboard.up('3');expect((await state(page)).manualFingerMask).toBe(0);
  const grounded=await state(page);
  await selectScene(page,'flight');
  await expect.poll(async()=>(await state(page)).world.flightLift).toBe(1);
  const flying=await state(page);
  expect(flying.hands[1].scale).toBeLessThan(grounded.hands[1].scale);
  expect(flying.hands[0].scale).toBeLessThan(grounded.hands[0].scale);
  for(const i of [0,1])expect(Math.hypot(flying.hands[i].wrist.x-grounded.hands[i].wrist.x,flying.hands[i].wrist.y-grounded.hands[i].wrist.y)).toBeGreaterThan(20);
  expect(Math.hypot(flying.hands[1].palm.x-flying.ladle.gx,flying.hands[1].palm.y-flying.ladle.gy)).toBeLessThan(.001);
  expect(((flying.ladle.lx-600)/188)**2+((flying.ladle.ly-520)/62)**2).toBeLessThan(1);
  expect((await state(page)).world.handOpen).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.delayWet??0)).toBeGreaterThan(.1);
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.brewLevel??0)).toBeGreaterThan(.001);
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.handLevel??0)).toBeGreaterThan(.001);
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.mouth??0)).toBeGreaterThan(.01);
  const envelope=await sampleAudioEnvelope(page,{durationMs:650});
  expect(envelope.summary.finite).toBe(true);expect(envelope.summary.maxPeak).toBeGreaterThan(.001);expect(envelope.summary.clippedSamples).toBe(0);
  await page.locator('#playButton').click();
  await waitForStableAudioState(page,false,{timeout:12000,stableMs:300});
});

test('preset balances and the two new voices change without restarting the ensemble',async({page})=>{
  test.setTimeout(45000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await observeWorklet(page);await open(page);
  await expect(page.locator('#spellBalance')).toBeHidden();
  expect((await state(page)).config.spellBalance).toBe(.5);
  const presets=await page.evaluate(async()=>(await import('/src/instruments/witch/witch-presets.js')).WITCH_PRESETS);
  const choices=['blood-moon','low-fog','green-lightning'].map(id=>presets.find(preset=>preset.id===id));
  expect(choices.every(Boolean)).toBe(true);
  const balances=choices.map(preset=>preset.snapshot.spellBalance);
  expect(Math.max(...balances)-Math.min(...balances)).toBeGreaterThan(.35);
  expect(choices.map(preset=>preset.snapshot.voice)).toEqual(['wail','whisper','chatter']);
  await page.locator('#audioButton').click();
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.brewLevel>.00001&&window.witchVisual?.handLevel>.00001)).toBe(true);
  const connections=(await readAudioStatus(page)).connectionCount;expect(connections).toBeGreaterThan(0);
  for(const preset of choices) {
    const before=await state(page);
    await page.locator('.header-preset-controls summary').click();
    await page.locator(`button[data-preset-id="${preset.id}"]`).click();
    await expect.poll(async()=>(await state(page)).activeVoice).toBe(preset.snapshot.voice);
    const after=await state(page);
    expect(after.config).toEqual(preset.snapshot);
    expect(after).toMatchObject({playing:true,audioOn:true,config:{spoonAuto:false}});
    for(const clock of ['performanceTime','handTime','flightPhase','ghostPhase'])expect(after[clock]).toBeGreaterThan(before[clock]);
    expect(Number(await page.locator('#spellBalance').inputValue())).toBeCloseTo(preset.snapshot.spellBalance,6);
    expect(await page.locator('#witchParameters').evaluate(el=>el.open)).toBe(false);
    expect((await readAudioStatus(page)).connectionCount).toBe(connections);
    await expect.poll(()=>page.evaluate(()=>window.witchVisual?.brewLevel>.00001&&window.witchVisual?.handLevel>.00001)).toBe(true);
  }
  await parameters(page);await page.locator('#spellBalance').focus();
  for(const [key,value] of [['Home',0],['End',1]]) {
    const before=await state(page);await page.keyboard.press(key);
    const after=await state(page);
    expect(after.config).toEqual({...before.config,spellBalance:value});
    expect(after).toMatchObject({playing:true,audioOn:true});
    await expect.poll(()=>page.evaluate(()=>window.witchVisual?.brewLevel>.00001&&window.witchVisual?.handLevel>.00001)).toBe(true);
  }
  const envelope=await sampleAudioEnvelope(page,{durationMs:350});
  expect(envelope.summary.finite).toBe(true);expect(envelope.summary.maxPeak).toBeGreaterThan(.001);expect(envelope.summary.clippedSamples).toBe(0);
  expect(errors).toEqual([]);
});

test('spoon height selects all seven singing characters and automatic motion remains visible',async({page})=>{
  await open(page);
  const initial=await state(page);
  await expect.poll(async()=>(await state(page)).spoonHeight).not.toBe(initial.spoonHeight);
  await parameters(page);
  const voices=await page.evaluate(async()=>[...(await import('/src/instruments/witch/witch-model.js')).WITCH_VOICES]);
  expect(voices).toHaveLength(7);expect(voices).toEqual(expect.arrayContaining(['wail','chatter']));
  expect(await page.locator('#voice option').evaluateAll(options=>options.map(option=>option.value))).toEqual(voices);
  for(const [i,voice] of voices.entries()) {
    await range(page,'spoonHeight',(i+.5)/voices.length);
    expect((await state(page)).config.voice).toBe(voice);
    expect((await state(page)).config.spoonAuto).toBe(false);
    expect((await state(page)).activeVoice).toBe(voice);
  }
  await range(page,'spoonHeight',.5);
  await parameters(page,false);
  // Freeze automatic ladle travel for a precise height gesture; do not arm sound.
  await page.locator('#playButton').click();
  const ladle=(await state(page)).ladle,from=await point(page,ladle.hx,ladle.hy-12);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(from.x,from.y-65,{steps:5});await page.mouse.up();
  expect((await state(page)).config.spoonHeight).toBeGreaterThan(.65);
  await parameters(page);await page.locator('#spoonAuto').check();await parameters(page,false);await page.locator('#playButton').click();
  const resumed=await state(page);
  await expect.poll(async()=>(await state(page)).spoonHeight).not.toBe(resumed.spoonHeight);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test('nose, hat, ember and flight reshape the ensemble without leaving the shared scene',async({page})=>{
  await open(page);await page.locator('#playButton').click();
  for(const [kind,dx,dy] of [['nose',45,0],['hat',0,-45],['tone',0,-45]]) {
    const before=await state(page),target=before.targets[kind],from=await point(page,target.x,target.y);
    await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(from.x+dx,from.y+dy,{steps:5});await page.mouse.up();
    expect((await state(page)).config[kind]).toBeGreaterThan(before.config[kind]);
  }
  const brighter=await state(page),ember=await point(page,brighter.targets.tone.x,brighter.targets.tone.y);
  await page.mouse.move(ember.x,ember.y);await page.mouse.down();await page.mouse.move(ember.x,ember.y+90,{steps:5});await page.mouse.up();
  expect((await state(page)).config.tone).toBeLessThan(brighter.config.tone);
  const dimmer=(await state(page)).config.tone;
  await page.locator('#witchCanvas').focus();await page.keyboard.press('+');
  expect((await state(page)).config.tone).toBeGreaterThan(dimmer);
  await page.keyboard.press('-');expect((await state(page)).config.tone).toBeCloseTo(dimmer,5);
  expect(await page.locator('#witchParameters').evaluate(el=>el.open)).toBe(false);
  expect((await state(page)).audioOn).toBe(false);
  await selectScene(page,'flight');
  await expect.poll(async()=>(await state(page)).world.flightLift).toBe(1);
  const target=(await state(page)).targets.nose;expect(target.x).toBeGreaterThan(0);expect(target.x).toBeLessThan(1000);
  const skyStart=await point(page,185,90),skyEnd=await point(page,780,600),flight=(await state(page)).config;
  await page.mouse.move(skyStart.x,skyStart.y);await page.mouse.down();await page.mouse.move(skyEnd.x,skyEnd.y,{steps:5});await page.mouse.up();
  const steered=(await state(page)).config;
  expect(steered.flightX).toBeCloseTo(.78,2);expect(steered.altitude).toBeCloseTo(1-600/720,2);expect(steered.speed).toBeGreaterThan(flight.speed);
  await page.locator('#witchCanvas').focus();await page.keyboard.press('h');
  expect((await state(page)).config.scene).toBe('flight');
  expect((await state(page)).world.handOpen).toBe(true);
});

test('grounded fabric filters the brew and the broom toggles playable flight strings',async({page})=>{
  await open(page);
  for(const [targetName,xKey,yKey] of [['fabric','fabricX','fabricY'],['trail','trailPull','trailTwist']]) {
    if(targetName==='trail') {
      await clickWorld(page,'broom');
      await expect.poll(async()=>(await state(page)).world.flightLift).toBe(1);
      expect((await state(page)).config.scene).toBe('flight');
    }
    const before=await state(page),target=before.targets[targetName],from=await point(page,target.x,target.y);
    await page.mouse.move(from.x,from.y);await page.mouse.down();
    await page.mouse.move(from.x+35,from.y-32,{steps:5});
    const pulled=await state(page);
    expect(pulled.config[xKey]).toBeGreaterThan(before.config[xKey]);
    expect(pulled.config[yKey]).toBeGreaterThan(before.config[yKey]);
    if(targetName==='fabric') {
      expect(pulled.targets.fabric.x).toBeGreaterThan(before.targets.fabric.x);
      expect(pulled.targets.fabric.y).toBeLessThan(before.targets.fabric.y);
    }
    await page.locator('#witchCanvas').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();
    await page.mouse.move(from.x+70,from.y-64);
    expect((await state(page)).config[xKey]).toBe(pulled.config[xKey]);
    expect((await state(page)).config[yKey]).toBe(pulled.config[yKey]);
    const fresh=(await state(page)).targets[targetName],reverse=await point(page,fresh.x,fresh.y);
    await page.mouse.move(reverse.x,reverse.y);await page.mouse.down();
    await page.mouse.move(reverse.x-45,reverse.y+42,{steps:5});await page.mouse.up();
    expect((await state(page)).config[xKey]).toBeLessThan(pulled.config[xKey]);
    expect((await state(page)).config[yKey]).toBeLessThan(pulled.config[yKey]);
  }
  await clickWorld(page,'moon');
  await expect.poll(async()=>(await state(page)).world.flightLift).toBe(0);
  expect((await state(page))).toMatchObject({playing:true,audioOn:false,config:{scene:'brew'}});
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test('mouth, eyes, tree, spider and seven web strings respond over the continuous ensemble',async({page},testInfo)=>{
  test.setTimeout(60000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await observeWorklet(page);await open(page);
  await expect.poll(async()=>(await state(page)).spiderReady,{timeout:15000}).toBe(true);
  await page.locator('#audioButton').click();
  await clickWorld(page,'mouth');
  const voices=await page.evaluate(async()=>(await import('/src/instruments/witch/witch-model.js')).WITCH_VOICES);
  const seen=new Set();
  for(let i=0;i<voices.length;i++) {
    const before=await state(page);await clickWorld(page,'mouth');
    await expect.poll(async()=>(await state(page)).activeVoice).toBe(voices[(voices.indexOf(before.activeVoice)+1)%voices.length]);
    seen.add((await state(page)).activeVoice);expect((await state(page)).config.spoonAuto).toBe(false);
  }
  expect([...seen].sort()).toEqual([...voices].sort());
  for(let i=0;i<6;i++) {
    const before=await state(page);await clickWorld(page,'tree');
    expect((await state(page)).config.treeShape).toBe((before.config.treeShape+1)%6);
  }
  await clickWorld(page,'spider');
  await expect.poll(()=>page.evaluate(()=>window.witchTriggers.includes('spider-groan'))).toBe(true);
  for(let index=0;index<7;index++) {
    await clickWorld(page,'web',{index});
    await expect.poll(()=>page.evaluate(index=>window.witchTriggers.includes(`web-${index}`),index)).toBe(true);
  }
  const audioBefore=await readAudioStatus(page),timeBefore=(await state(page)).performanceTime;
  await clickWorld(page,'eyes');
  await expect.poll(async()=>(await state(page)).eyeShock).toBeGreaterThan(.1);
  await expect.poll(()=>page.evaluate(()=>window.witchTriggers.includes('eye-shock'))).toBe(true);
  await page.screenshot({path:testInfo.outputPath('desktop-electrical-hex.png'),fullPage:true});
  const shock=await sampleAudioEnvelope(page,{durationMs:350});
  expect(shock.summary.finite).toBe(true);expect(shock.summary.maxPeak).toBeGreaterThan(.001);expect(shock.summary.clippedSamples).toBe(0);
  await expect.poll(async()=>(await state(page)).eyeShock,{timeout:3000}).toBe(0);
  expect((await state(page))).toMatchObject({playing:true,audioOn:true});
  expect((await state(page)).performanceTime).toBeGreaterThan(timeBefore);
  expect((await readAudioStatus(page)).connectionCount).toBe(audioBefore.connectionCount);
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.brewLevel>.0001&&window.witchVisual?.handLevel>.0001)).toBe(true);
  expect(errors).toEqual([]);
});

test('all eight mushroom pictures preserve native scene picking and continuous sound',async({page},testInfo)=>{
  test.setTimeout(45000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await observeWorklet(page);await open(page);await page.locator('#audioButton').click();
  await clickWorld(page,'mouth');
  for(let mode=1;mode<=8;mode++) {
    await clickWorld(page,'mushrooms');expect((await state(page)).config.visualMode).toBe(mode%8);
    const voice=(await state(page)).activeVoice;await clickWorld(page,'mouth');
    await expect.poll(async()=>(await state(page)).activeVoice).not.toBe(voice);
    if([4,5,6,7].includes(mode))await page.screenshot({path:testInfo.outputPath(`desktop-picture-${mode}.png`),fullPage:true});
  }
  expect((await state(page))).toMatchObject({playing:true,audioOn:true});
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.brewLevel>.0001&&window.witchVisual?.handLevel>.0001)).toBe(true);
  expect(errors).toEqual([]);
});

test('Reset releases a new electrical accent even when primary Play was already stopped',async({page})=>{
  await observeWorklet(page);await open(page);await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  expect((await state(page))).toMatchObject({playing:false,audioOn:true});
  await clickWorld(page,'eyes');
  await expect.poll(async()=>(await state(page)).eyeShock).toBeGreaterThan(.1);
  await page.locator('#resetButton').click();
  await expect.poll(async()=>(await state(page)).eyeShock).toBe(0);
  expect((await state(page))).toMatchObject({playing:false,audioOn:true,performanceTime:0});
  const release=await sampleAudioEnvelope(page,{durationMs:300});
  expect(release.summary.finite).toBe(true);expect(release.summary.clippedSamples).toBe(0);
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.shockEnvelope)).toBe(0);
  await expect.poll(async()=>(await readAudioStatus(page)).peak,{timeout:6000}).toBeLessThan(.00001);
  const silence=await sampleAudioEnvelope(page,{durationMs:300});
  expect(silence.summary.finite).toBe(true);expect(silence.summary.maxPeak).toBeLessThan(.00001);
});

test('ten instrumental hand banks and sixteen Gesticules motions change without restarting the ensemble',async({page})=>{
  test.setTimeout(45000);
  await observeWorklet(page);await open(page);await page.locator('#audioButton').click();
  await parameters(page);
  await expect(page.locator('#handSound option')).toHaveCount(10);
  await expect(page.locator('#handMotion option')).toHaveCount(16);
  await expect(page.locator('#catGait option')).toHaveCount(4);
  const choices=await page.evaluate(()=>({
    sounds:[...document.querySelectorAll('#handSound option')].map(option=>option.value),
    motions:[...document.querySelectorAll('#handMotion option')].map(option=>option.value),
  }));
  for(const [id,values] of [['handSound',choices.sounds],['handMotion',choices.motions]])for(const value of values) {
    const before=await state(page);
    await page.locator(`#${id}`).selectOption(value);
    const after=await state(page);
    expect(after.config[id]).toBe(value);
    expect(after.handTime).toBeGreaterThanOrEqual(before.handTime);
    expect(after.performanceTime).toBeGreaterThanOrEqual(before.performanceTime);
    expect(after).toMatchObject({playing:true,audioOn:true});
    await expect.poll(()=>page.evaluate(()=>window.witchVisual?.handLevel??0)).toBeGreaterThan(.0001);
  }
  for(const rate of [.25,6]) {
    const before=await state(page);
    await range(page,'handRate',rate);
    const after=await state(page);
    expect(after.config.handRate).toBe(rate);
    expect(after.handTime).toBeGreaterThanOrEqual(before.handTime);
    expect(after).toMatchObject({playing:true,audioOn:true});
  }
  await expect(page.locator('#outputLevel')).toHaveValue('0.75');
  const envelope=await sampleAudioEnvelope(page,{durationMs:500});
  expect(envelope.summary.finite).toBe(true);expect(envelope.summary.clippedSamples).toBe(0);
});

test('three background ghosts share a faster or slower beat without taking the witch focus',async({page})=>{
  test.setTimeout(60000);
  await open(page);
  const initial=await state(page);
  expect(initial.ghosts.map(ghost=>ghost.id)).toEqual(ghostIds);
  expect(initial.config.ghostTempo).toBe(72);
  await expect.poll(async()=>(await state(page)).ghostPhase).toBeGreaterThan(initial.ghostPhase+.25);
  await page.locator('#playButton').click();
  const paused=await state(page);
  for(const id of ghostIds) {
    const before=await state(page);
    await dragGhost(page,id,-45);
    const faster=await state(page);
    expect(faster.config.ghostTempo).toBeGreaterThan(before.config.ghostTempo+20);
    expect(faster).toMatchObject({playing:false,audioOn:false,world:{handOpen:paused.world.handOpen}});
    expect(faster.config).toMatchObject({scene:paused.config.scene,voice:paused.config.voice,spoonAuto:paused.config.spoonAuto});
    await dragGhost(page,id,45,{cancel:true});
    const cancelled=await state(page);
    expect(cancelled.config.ghostTempo).toBeLessThan(faster.config.ghostTempo-20);
    await page.mouse.move(20,20);
    expect((await state(page)).config.ghostTempo).toBe(cancelled.config.ghostTempo);
    expect((await state(page)).ghostPhase).toBeCloseTo(paused.ghostPhase,6);
  }
  await page.locator('#witchCanvas').focus();
  // Adjusting the backing beat must not release a separately held finger spell.
  for(const cancel of [false,true]) {
    await page.keyboard.down('3');
    expect((await state(page)).manualFingerMask&4).toBe(4);
    await dragGhost(page,'creaturazoid',-20,{cancel});
    expect((await state(page)).manualFingerMask&4).toBe(4);
    expect((await state(page)).ghostPhase).toBeCloseTo(paused.ghostPhase,6);
    await page.keyboard.up('3');
    expect((await state(page)).manualFingerMask).toBe(0);
  }
  const slower=(await state(page)).config.ghostTempo;
  await page.keyboard.press('g');expect((await state(page)).config.ghostTempo).toBeCloseTo(slower+6,5);
  await page.keyboard.press('Shift+G');expect((await state(page)).config.ghostTempo).toBeCloseTo(slower,5);
  await page.locator('#playButton').click();
  await range(page,'ghostTempo',36);const slow=await ghostRate(page);
  await range(page,'ghostTempo',180);const fast=await ghostRate(page);
  expect(slow).toBeGreaterThan(.3);expect(slow).toBeLessThan(.9);
  expect(fast).toBeGreaterThan(2);expect(fast).toBeLessThan(3.6);
  expect(fast).toBeGreaterThan(slow*3);
  expect((await state(page)).audioOn).toBe(false);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test('ghost beat joins Audio without restarting, survives presets and Tap, and releases on Stop',async({page})=>{
  test.setTimeout(45000);
  await observeWorklet(page);await open(page);
  await range(page,'ghostTempo',180);
  await expect.poll(async()=>(await state(page)).ghostPhase).toBeGreaterThan(3);
  const silent=await state(page);
  await page.locator('#audioButton').click();
  expect((await state(page)).ghostPhase).toBeGreaterThan(silent.ghostPhase-.1);
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.ghostLevel??0),{timeout:10000}).toBeGreaterThan(.00001);
  const live=await state(page);
  expect(live.audioOn).toBe(true);expect(live.playing).toBe(true);
  for(const selector of ['.header-preset-next','.header-preset-random']) {
    const before=await state(page);
    await page.locator(selector).click();
    const after=await state(page);
    expect(after.ghostPhase).toBeGreaterThan(before.ghostPhase-.1);
    expect(after.performanceTime).toBeGreaterThanOrEqual(before.performanceTime);
    expect(after).toMatchObject({playing:true,audioOn:true});
    expect(after.config.ghostTempo).toBeGreaterThanOrEqual(36);expect(after.config.ghostTempo).toBeLessThanOrEqual(180);
  }
  await parameters(page);
  const tap=page.locator('.mz-tap-tempo[data-tap-control="#ghostTempo"]');
  const beforeTap=await state(page);
  await tap.evaluate(button=>{button.reset();const now=performance.now();button.tap(now);button.tap(now+500);button.tap(now+1000);});
  const tapped=await state(page);
  expect(tapped.config.ghostTempo).toBeCloseTo(120,5);
  expect(tapped.ghostPhase).toBeGreaterThanOrEqual(beforeTap.ghostPhase);
  expect(tapped.performanceTime).toBeGreaterThanOrEqual(beforeTap.performanceTime);
  expect(tapped).toMatchObject({playing:true,audioOn:true});
  await expect(page.locator('#ghostTempo')).toHaveValue('120');
  await parameters(page,false);
  await selectScene(page,'flight');
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.delayWet??0)).toBeGreaterThan(.1);
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.ghostLevel??0),{timeout:10000}).toBeGreaterThan(.00001);
  const envelope=await sampleAudioEnvelope(page,{durationMs:500});
  expect(envelope.summary.finite).toBe(true);expect(envelope.summary.clippedSamples).toBe(0);
  expect(await page.evaluate(()=>window.witchGhostPeak)).toBeLessThanOrEqual(.028);
  await page.locator('#playButton').click();
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.ghostLevel??1),{timeout:6000}).toBeLessThan(.00001);
  const stopped=(await state(page)).ghostPhase;
  await page.waitForTimeout(250);
  expect((await state(page)).ghostPhase).toBeCloseTo(stopped,5);
  await waitForStableAudioState(page,false,{timeout:12000,stableMs:300});
});

test('expanded presets recall night colors while the cat clock follows Play and keeps its place',async({page})=>{
  test.setTimeout(90000);
  await open(page);await range(page,'outputLevel',.23);
  const initial=await state(page);
  expect(initial.cat).toMatchObject({active:false,source:'quadruped',animalId:'cat',behaviorId:'cat-prowl'});
  await expect.poll(async()=>(await state(page)).performanceTime).toBeGreaterThan(initial.performanceTime+.15);
  const bank=await page.evaluate(async()=>{
    const {WITCH_PRESETS}=await import('/src/instruments/witch/witch-presets.js');return WITCH_PRESETS;
  });
  expect(bank.filter(preset=>preset.id.startsWith('shelf-'))).toHaveLength(ingredientIds.length);
  const row=page.locator('.header-preset-controls');
  for(const palette of Array.from({length:8},(_,i)=>i)) {
    const preset=bank.find(item=>item.snapshot.palette===palette),before=await state(page);
    expect(preset,`preset for color ${palette}`).toBeTruthy();
    await row.locator('summary').click();
    await expect(page.locator('button[data-preset-id]')).toHaveCount(bank.length);
    await page.locator(`button[data-preset-id="${preset.id}"]`).click();
    const recalled=await state(page);
    expect(recalled.config).toEqual(preset.snapshot);
    expect(recalled.world.trip).toBe(preset.snapshot.trip);
    expect(recalled.performanceTime).toBeGreaterThanOrEqual(before.performanceTime);
    expect(recalled.ghostPhase).toBeGreaterThanOrEqual(before.ghostPhase);
    expect(recalled).toMatchObject({playing:true,audioOn:false});
  }
  await page.locator('#playButton').click();
  const stopped=await state(page);
  await page.locator('#witchCanvas').focus();await page.keyboard.down('3');await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(250);
  expect((await state(page)).performanceTime).toBe(stopped.performanceTime);
  expect((await state(page)).ghostPhase).toBe(stopped.ghostPhase);
  await page.keyboard.up('3');
  await parameters(page);
  const colors=[];
  for(const palette of Array.from({length:8},(_,i)=>i)) {
    await page.locator('#palette').selectOption(String(palette));
    await page.waitForTimeout(90);
    colors.push(await page.locator('#witchCanvas').evaluate(canvas=>{
      const rect=canvas.getBoundingClientRect(),scale=Math.min(rect.width/1000,rect.height/720);
      const x=(rect.width-1000*scale)/2+50*scale,y=(rect.height-720*scale)/2+50*scale;
      return [...canvas.getContext('2d').getImageData(Math.floor(x*canvas.width/rect.width),Math.floor(y*canvas.height/rect.height),1,1).data].join(',');
    }));
    expect((await state(page)).config.palette).toBe(palette);
    expect((await state(page)).performanceTime).toBe(stopped.performanceTime);
  }
  expect(new Set(colors).size).toBeGreaterThanOrEqual(6);
  await range(page,'lineBend',3);expect((await state(page)).world.trip).toBe(3);expect((await state(page)).config.trip).toBe(3);
  await parameters(page,false);
  await page.locator('.header-preset-next').click();
  expect((await state(page))).toMatchObject({playing:false,audioOn:false,performanceTime:stopped.performanceTime});
  expect((await state(page)).world.trip).toBe((await state(page)).config.trip);
  await expect(page.locator('#outputLevel')).toHaveValue('0.23');
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator('#playButton').click();
  await expect.poll(async()=>(await state(page)).performanceTime).toBeGreaterThan(stopped.performanceTime+.15);
  await page.locator('#resetButton').click();
  expect((await state(page))).toMatchObject({playing:false,performanceTime:0,cat:{active:false},config:{palette:0,trip:0},world:{trip:0}});
});

test('mouse, cat and lizard make real timed visits and native clicks send each into the pot once',async({page},testInfo)=>{
  test.setTimeout(90000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await observeWorklet(page);await open(page);
  expect((await state(page)).cat.active).toBe(false);
  expect((await state(page)).visitors.every(visitor=>!visitor.active)).toBe(true);
  // Follow the actual Play clock through all three first visits; no seek.
  await expect.poll(async()=>{
    const current=await state(page),mouse=current.visitors.find(visitor=>visitor.id==='mouse');
    return mouse.visible&&mouse.progress>.2&&mouse.progress<.8;
  },{timeout:25000,intervals:[100,250]}).toBe(true);
  await page.locator('#playButton').click();
  const stopped=await state(page);
  expect(stopped.performanceTime).toBeGreaterThanOrEqual(18);
  expect(stopped.visitors.find(visitor=>visitor.id==='mouse')).toMatchObject({source:'quadruped',behaviorId:'walk'});
  await clickAnimal(page,'mouse',{touch:true});
  const captured=await state(page);
  expect(captured.visitors.find(visitor=>visitor.id==='mouse')).toMatchObject({captured:true,diving:true,captureProgress:0});
  expect(captured.visitorTargets.mouse).toBeUndefined();
  await page.waitForTimeout(250);
  expect((await state(page)).performanceTime).toBe(stopped.performanceTime);
  expect((await state(page)).visitors.find(visitor=>visitor.id==='mouse').captureProgress).toBe(0);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator('#audioButton').click();
  expect((await state(page)).performanceTime).toBeCloseTo(stopped.performanceTime,5);
  await page.locator('#playButton').click();
  await expect.poll(async()=>(await state(page)).visitors.find(visitor=>visitor.id==='mouse').captureProgress).toBe(1);
  expect((await state(page)).capturedAnimals.mouse).toEqual(captured.capturedAnimals.mouse);
  await expect.poll(async()=>{
    const cat=(await state(page)).cat;return cat.active&&cat.progress>.2&&cat.progress<.8;
  },{timeout:18000,intervals:[100,250]}).toBe(true);
  const cat=await state(page);
  expect(cat.performanceTime).toBeGreaterThanOrEqual(30);expect(cat.performanceTime).toBeLessThan(36);
  expect(cat.cat).toMatchObject({visit:1,source:'quadruped',animalId:'cat',behaviorId:'cat-prowl'});
  await clickAnimal(page,'cat',{part:'head'});
  await expectIngredientSolo(page,'cat');
  await expect.poll(async()=>(await state(page)).catMeow).toBeGreaterThan(.01);
  await expect.poll(()=>page.evaluate(()=>window.witchTriggers.includes('drop-cat'))).toBe(true);
  await expect.poll(async()=>(await state(page)).cat.captured).toBe(true);
  expect((await state(page)).catTargets).toBeNull();
  await page.screenshot({path:testInfo.outputPath('desktop-cat-dive.png'),fullPage:true});
  await expect.poll(async()=>(await state(page)).cat.captureProgress).toBe(1);
  const captures=await page.evaluate(()=>window.witchTriggers.filter(kind=>kind==='drop-cat').length);
  await page.locator('#witchCanvas').focus();await page.keyboard.press('c');
  expect(await page.evaluate(()=>window.witchTriggers.filter(kind=>kind==='drop-cat').length)).toBe(captures);
  const audible=await sampleAudioEnvelope(page,{durationMs:150});
  expect(audible.summary.finite).toBe(true);expect(audible.summary.maxPeak).toBeGreaterThan(.001);
  await page.locator('#audioButton').click();
  await expect.poll(async()=>{
    const lizard=(await state(page)).visitors.find(visitor=>visitor.id==='lizard');
    return lizard.visible&&lizard.progress>.25&&lizard.progress<.75;
  },{timeout:20000,intervals:[100,250]}).toBe(true);
  expect((await state(page)).visitors.find(visitor=>visitor.id==='lizard')).toMatchObject({source:'quadruped',behaviorId:'lizard-scuttle'});
  await clickAnimal(page,'lizard');
  await expect.poll(async()=>(await state(page)).visitors.find(visitor=>visitor.id==='lizard').captureProgress).toBe(1);
  expect(Object.keys((await state(page)).capturedAnimals).sort()).toEqual(['cat','lizard','mouse']);
  expect((await state(page))).toMatchObject({playing:true,audioOn:false});
  const silence=await sampleAudioEnvelope(page,{durationMs:150});expect(silence.summary.maxPeak).toBeLessThan(.00001);
  await page.locator('#resetButton').click();
  expect((await state(page))).toMatchObject({playing:false,performanceTime:0,cat:{active:false},capturedAnimals:{},catMeow:0});
  expect((await state(page)).visitors.every(visitor=>!visitor.active)).toBe(true);
  expect(errors).toEqual([]);
});

test('all real shelf instruments solo over the ensemble and interpolate the whole spell during their dive',async({page})=>{
  test.setTimeout(120000);
  await observeWorklet(page);await open(page);await page.locator('#audioButton').click();
  const bank=await page.evaluate(async()=>(await import('/src/instruments/witch/witch-presets.js')).WITCH_PRESETS);
  let consumed=0;
  for(const id of shelfIds) await test.step(`click ${id}`,async()=>{
    const before=await state(page),object=before.objects.find(item=>item.id===id);
    expect(object.imageHref).toMatch(/^assets\/instruments\/.+\.webp$/);
    const preset=bank.find(preset=>preset.id===object.presetId);expect(preset).toBeTruthy();
    await clickIngredient(page,id);await expectIngredientSolo(page,id);
    const diving=await state(page);
    expect(diving.spellTransition).toBeTruthy();
    expect(diving.spellTransition.progress).toBeLessThan(1);
    expect(diving.config).not.toEqual(preset.snapshot);
    await expect.poll(async()=>(await state(page)).config).toEqual(preset.snapshot);
    const running=await state(page);
    expect(running.playing).toBe(true);expect(running.audioOn).toBe(true);
    expect(running.objects.filter(object=>object.dropped)).toHaveLength(++consumed);
    for(const clock of ['performanceTime','handTime'])expect(running[clock]).toBeGreaterThan(before[clock]);
    await expect.poll(async()=>(await state(page)).objects.find(object=>object.id===id).alpha).toBe(0);
  });
  const envelope=await sampleAudioEnvelope(page,{durationMs:500});
  expect(envelope.summary.finite).toBe(true);expect(envelope.summary.maxPeak).toBeGreaterThan(.001);expect(envelope.summary.clippedSamples).toBe(0);
  await page.locator('#witchCanvas').focus();await page.keyboard.press('Escape');
  await waitForStableAudioState(page,false,{timeout:12000,stableMs:250});
});

test('tree instruments play perched phrases before diving and Stop freezes their spell transition',async({page})=>{
  test.setTimeout(45000);
  await observeWorklet(page);await open(page);await page.locator('#audioButton').click();
  const bank=await page.evaluate(async()=>(await import('/src/instruments/witch/witch-presets.js')).WITCH_PRESETS);
  for(const id of treeIds) {
    const before=await state(page),origin=before.objects.find(object=>object.id===id);
    await clickIngredient(page,id);await expectIngredientSolo(page,id);
    await page.waitForTimeout(700);
    const perched=await state(page),object=perched.objects.find(object=>object.id===id);
    // A tiny singing wiggle stays on the branch until the phrase finishes.
    expect(Math.abs(object.x-origin.x)).toBeLessThanOrEqual(3);expect(Math.abs(object.y-origin.y)).toBeLessThanOrEqual(2);
    expect(perched.spellTransition.progress).toBe(0);expect(perched.config).toEqual(before.config);
    if(id==='blech') {
      await page.locator('#playButton').click();await page.waitForTimeout(150);
      const stopped=await state(page);await page.waitForTimeout(350);
      expect((await state(page)).objects.find(object=>object.id===id).dropAge).toBeCloseTo(stopped.objects.find(object=>object.id===id).dropAge,5);
      expect((await state(page)).spellTransition).toEqual(stopped.spellTransition);
      await page.locator('#playButton').click();
    }
    await expect.poll(async()=>(await state(page)).spellTransition?.progress??1,{timeout:6000,intervals:[50,100]}).toBeGreaterThan(0);
    const diving=await state(page);expect(diving.spellTransition?.progress).toBeLessThan(1);
    expect(diving.objects.find(object=>object.id===id).x).not.toBe(origin.x);
    const preset=bank.find(preset=>preset.id===origin.presetId);
    await expect.poll(async()=>(await state(page)).config).toEqual(preset.snapshot);
    expect((await state(page))).toMatchObject({playing:true,audioOn:true});
  }
});

test('shelf icons stay consumed until a manual preset refill and keyboard clicks keep Audio off',async({page})=>{
  await open(page);
  await clickIngredient(page,'puggler');
  await expect.poll(async()=>(await state(page)).objects.find(item=>item.id==='puggler').alpha).toBe(0);
  const gone=(await state(page)).objects.find(item=>item.id==='puggler');
  expect(gone).toMatchObject({dropped:true,alpha:0,x:600,y:544});
  await expect(page.locator('[data-drop="puggler"]')).toBeDisabled();
  await page.locator('#witchCanvas').focus();await page.keyboard.press('q');await page.keyboard.press('e');await page.keyboard.press('r');
  for(const id of ['gesticules','marimba','choir']) expect((await state(page)).objects.find(item=>item.id===id).dropped).toBe(true);
  expect((await state(page)).objects.find(item=>item.id==='puggler').dropped).toBe(true);
  const available=(await state(page)).objects;
  await page.keyboard.press(']');expect((await state(page)).selectedIngredient).toBe(available[0].id);
  await page.keyboard.press('[');expect((await state(page)).selectedIngredient).toBe(available.at(-1).id);
  await page.keyboard.press('Enter');
  expect((await state(page)).objects.find(item=>item.id===available.at(-1).id).dropped).toBe(true);
  expect((await state(page)).audioOn).toBe(false);expect((await readAudioStatus(page)).connectionCount).toBe(0);
  for(const selector of ['.header-preset-next','.header-preset-random']) {
    await page.locator(selector).click();
    expect((await state(page)).objects.every(object=>!object.dropped)).toBe(true);
    await expect(page.locator('[data-drop="puggler"]')).toBeEnabled();
    if((await state(page)).config.scene==='flight'){await selectScene(page,'brew');await expect.poll(async()=>(await state(page)).world.flightLift).toBe(0);}
    await clickIngredient(page,'puggler');
  }
  await page.locator('.header-preset-controls summary').click();
  await page.locator('button[data-preset-id]').first().click();
  expect((await state(page)).objects.every(object=>!object.dropped)).toBe(true);
  await clickIngredient(page,'puggler');
  await page.locator('#resetButton').click();
  expect((await state(page)).objects.every(object=>!object.dropped)).toBe(true);
});

test('stirring, presets, cancellation and page lifecycle preserve the ensemble and explicit Audio state',async({page})=>{
  await open(page);await range(page,'outputLevel',.23);
  // Start in the exposed potion, clear of the permanently enlarged fingers.
  const center=await point(page,440,520);await page.mouse.move(center.x,center.y);await page.mouse.down();
  for(let i=1;i<=12;i++){const a=-i/12*Math.PI*2;const p=await point(page,600+155*Math.cos(a),520+48*Math.sin(a));await page.mouse.move(p.x,p.y);}
  await page.mouse.up();expect((await state(page)).config.direction).toBe(-1);
  expect((await state(page)).playing).toBe(true);
  await page.locator('.header-preset-next').click();await page.locator('.header-preset-random').click();
  expect((await state(page)).playing).toBe(true);expect((await state(page)).audioOn).toBe(false);
  await expect(page.locator('#outputLevel')).toHaveValue('0.23');
  await selectScene(page,'fingers');await page.locator('#witchCanvas').focus();await page.keyboard.down('1');await page.keyboard.down('3');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  expect((await state(page)).manualFingerMask).toBe(0);
  await page.keyboard.up('1');await page.keyboard.up('3');
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  const before=await state(page);await expect.poll(async()=>(await state(page)).handTime).toBeGreaterThan(before.handTime);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator('#resetButton').click();
  expect((await state(page)).playing).toBe(false);expect((await state(page)).world.trip).toBe(0);
  expect((await state(page)).world.handReach).toBe(1);
});

for(const [label,width,height] of [['desktop',1440,900],['portrait',390,844],['landscape',844,390]]) {
  test.describe(label,()=>{
    test.use({viewport:{width,height},hasTouch:label!=='desktop',isMobile:label!=='desktop'});
    test(`Witches Brew ${label}: hair pulls stay independent, cancel cleanly and keep sounding during flight`,async({page},testInfo)=>{
      test.setTimeout(60000);
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await observeWorklet(page);await open(page);
      await expect(page.locator('#hair')).toBeHidden();
      if(label==='desktop') {
        await parameters(page);await page.locator('#hair').focus();
        for(const [key,value] of [['End',1],['Home',0]]) {
          await page.keyboard.press(key);expect((await state(page)).config.hair).toBe(value);
          expect((await state(page)).audioOn).toBe(false);
        }
        expect((await readAudioStatus(page)).connectionCount).toBe(0);
        await parameters(page,false);
      }
      const initial=await state(page);expectHairInScene(initial);
      await dragHair(page,.75,{touch:label!=='desktop'});
      const pulled=await state(page);
      expect(pulled.config.hair).toBeGreaterThan(initial.config.hair+.4);
      expect(pulled.config).toEqual({...initial.config,hair:pulled.config.hair});
      expect(pulled).toMatchObject({playing:true,audioOn:false});
      expect(Number(await page.locator('#hair').inputValue())).toBeCloseTo(pulled.config.hair,2);
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      expectHairInScene(pulled);
      await page.screenshot({path:testInfo.outputPath(`${label}-hair-brew.png`),fullPage:true});
      await dragHair(page,-.65,{touch:label!=='desktop',cancel:true});
      const combed=await state(page);
      expect(combed.config.hair,JSON.stringify(await page.evaluate(()=>window.witchHairDown))).toBeLessThan(pulled.config.hair-.3);
      expect(combed.config).toEqual({...pulled.config,hair:combed.config.hair});
      expect(combed).toMatchObject({playing:true,audioOn:false});
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      if(label==='desktop')await page.emulateMedia({reducedMotion:'no-preference'});
      await selectScene(page,'flight');await range(page,'lineBend',label==='desktop'?3:2);
      if(label==='desktop')await page.locator('#visualMode').evaluate(el=>{el.value='7';el.dispatchEvent(new Event('change',{bubbles:true}));});
      await expect.poll(async()=>(await state(page)).world.flightLift).toBe(1);
      await page.locator('#audioButton').click();
      await expect.poll(()=>page.evaluate(()=>window.witchVisual?.brewLevel>.0001&&window.witchVisual?.handLevel>.0001)).toBe(true);
      const flying=await state(page);expectHairInScene(flying);
      await dragHair(page,.7,{touch:label!=='desktop',hold:true});
      const spell=await state(page);
      expect(spell.config,JSON.stringify(await page.evaluate(()=>window.witchHairDown))).toEqual({...flying.config,hair:spell.config.hair});
      expect(spell.config.hair).toBeGreaterThan(flying.config.hair+.3);
      expect(spell).toMatchObject({playing:true,audioOn:true});
      for(const clock of ['performanceTime','handTime','flightPhase'])expect(spell[clock]).toBeGreaterThan(flying[clock]);
      expectHairInScene(spell);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await page.screenshot({path:testInfo.outputPath(`${label}-hair-flight.png`),fullPage:true});
      const envelope=await sampleAudioEnvelope(page,{durationMs:350});
      expect(envelope.summary.finite).toBe(true);expect(envelope.summary.maxPeak).toBeGreaterThan(.001);expect(envelope.summary.clippedSamples).toBe(0);
      await page.locator('#resetButton').click();
      expect((await state(page))).toMatchObject({playing:false,config:{hair:0}});
      expect(errors).toEqual([]);
    });
    test(`Witches Brew ${label}: controls, two hands and ongoing flight fit`,async({page},testInfo)=>{
      test.setTimeout(60000);
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await observeWorklet(page);await open(page);
      for(const scene of ['brew','fingers','flight']) {
        await selectScene(page,scene);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
        await expect(page.locator('#witchCanvas')).toBeVisible();
        await page.screenshot({path:testInfo.outputPath(`${label}-${scene}.png`),fullPage:true});
      }
      for(const object of (await state(page)).objects) {
        expect(object.x).toBeGreaterThan(0);expect(object.x).toBeLessThan(1000);
        expect(object.y).toBeGreaterThan(0);expect(object.y).toBeLessThan(720);
      }
      await expect.poll(async()=>(await state(page)).world.flightLift).toBe(1);
      const neutral=(await state(page)).config;
      for(const [id,value] of [['hat',1],['nose',1],['hair',1],['lineBend',3]])await range(page,id,value);
      for(const [edge,x,altitude] of [['left-high',.12,1],['right-low',.88,0]]) {
        await range(page,'flightX',x);await range(page,'altitude',altitude);
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const flying=await state(page);expectHairInScene(flying);
        expect(flying.hands.map(hand=>hand.tips.length)).toEqual([5,5]);
        const points=flying.hands.flatMap(hand=>[hand.wrist,hand.palm,...hand.tips]);
        expect(points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y))).toBe(true);
        expect(Math.min(...points.map(point=>point.x))).toBeGreaterThan(0);expect(Math.max(...points.map(point=>point.x))).toBeLessThan(1000);
        expect(Math.min(...points.map(point=>point.y))).toBeGreaterThan(0);expect(Math.max(...points.map(point=>point.y))).toBeLessThan(720);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
        await page.screenshot({path:testInfo.outputPath(`${label}-flight-${edge}.png`),fullPage:true});
      }
      for(const key of ['hat','nose','hair','flightX','altitude'])await range(page,key,neutral[key]);
      await range(page,'lineBend',neutral.trip);
      const airborne=await state(page),hiddenObject=airborne.objects.find(object=>object.id==='oculoid');
      const hiddenPoint=await point(page,hiddenObject.x,hiddenObject.y);await page.mouse.click(hiddenPoint.x,hiddenPoint.y);
      expect((await state(page)).objects.every(object=>!object.dropped)).toBe(true);
      expect((await state(page)).catTargets).toBeNull();expect((await state(page)).visitorTargets).toEqual({});
      await clickWorld(page,'moon',{touch:label!=='desktop'});
      await expect.poll(async()=>(await state(page)).world.flightLift).toBe(0);
      await clickIngredient(page,'oculoid',label!=='desktop');
      await expect.poll(async()=>(await state(page)).spellTransition).toBeNull();
      expect((await state(page)).audioOn).toBe(false);
      await range(page,'ghostTempo',72);
      const beforeGhost=await state(page);
      await dragGhost(page,'monstroid',-40,{touch:label!=='desktop'});
      expect((await state(page)).config.ghostTempo,JSON.stringify(await page.evaluate(()=>window.witchGhostDown))).toBeGreaterThan(beforeGhost.config.ghostTempo+20);
      expect((await state(page)).config.scene).toBe(beforeGhost.config.scene);expect((await state(page)).world.handOpen).toBe(beforeGhost.world.handOpen);
      if(label!=='desktop') for(const selector of ['#audioButton','#playButton']) {
        const rect=await page.locator(selector).boundingBox();expect(rect.width).toBeGreaterThanOrEqual(48);expect(rect.height).toBeGreaterThanOrEqual(48);
      }
      await page.locator('#audioButton').click();
      const pugglerPreset=await page.evaluate(async()=>(await import('/src/instruments/witch/witch-presets.js')).WITCH_PRESETS.find(preset=>preset.id==='shelf-puggler'));
      const beforePuggler=await state(page);
      await clickIngredient(page,'puggler',label!=='desktop');await expectIngredientSolo(page,'puggler');
      await expect.poll(async()=>(await state(page)).config).toEqual(pugglerPreset.snapshot);
      const afterPuggler=await state(page);
      expect(afterPuggler.config).toEqual(pugglerPreset.snapshot);
      expect(afterPuggler).toMatchObject({playing:true,audioOn:true});
      for(const clock of ['performanceTime','handTime'])expect(afterPuggler[clock]).toBeGreaterThan(beforePuggler[clock]);
      await expect.poll(async()=>(await state(page)).objects.find(object=>object.id==='puggler').alpha).toBe(0);
      expect((await state(page)).objects.find(object=>object.id==='puggler')).toMatchObject({dropped:true,x:600,y:544});
      await page.locator('#audioButton').click();
      expect(await page.locator('#witchParameters').evaluate(el=>el.open)).toBe(false);
      await parameters(page);
      await page.locator('[data-drop="choir"]').scrollIntoViewIfNeeded();await expect(page.locator('[data-drop="choir"]')).toBeInViewport();
      await page.locator('.witch-help').scrollIntoViewIfNeeded();await expect(page.locator('.witch-help')).toBeInViewport();
      const a11y=await new AxeBuilder({page}).include('.witch-shell').analyze();
      expect(a11y.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}
