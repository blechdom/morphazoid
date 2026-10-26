import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';

async function open(page) {
  await page.goto('/witch.html');
  await expect(page.locator('.instrument-preset-controls')).toBeVisible();
  await page.waitForFunction(()=>Boolean(window.witchInstrument?.state));
}
const state=page=>page.evaluate(()=>window.witchInstrument.state);
const ingredientIds=['glass','tail','earwax','eyeball','newt','hair','roach','spider','oculoid','rubix','hiccup','gesticules','marimba','choir'];
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
async function clickStage(page,x,y) {
  await page.locator('#witchCanvas').scrollIntoViewIfNeeded();
  const p=await point(page,x,y);
  await page.mouse.click(p.x,p.y);
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
          this.port.addEventListener('message',({data})=>{ if(data.type==='visual') window.witchVisual=data; });
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
async function range(page,id,value) {
  await page.locator(`#${id}`).evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
}
async function dropIngredient(page,id,touch=false) {
  await page.locator('#witchCanvas').scrollIntoViewIfNeeded();
  const object=(await state(page)).objects.find(item=>item.id===id);
  expect(object,`${id} has a visible scene object`).toBeTruthy();
  expect(object.dropped).toBe(false);
  const rect=await page.locator('#witchCanvas').boundingBox(),from=stagePoint(rect,object.x,object.y),to=stagePoint(rect,600,520);
  const session=touch?await page.context().newCDPSession(page):null;
  if(session) await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
  else { await page.mouse.move(from.x,from.y);await page.mouse.down(); }
  expect((await state(page)).objects.find(item=>item.id===id).dragging,`${id} can be picked at its visible position`).toBe(true);
  if(session) {
    for(let step=1;step<=7;step++) await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*step/7,y:from.y+(to.y-from.y)*step/7}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
  } else { await page.mouse.move(to.x,to.y,{steps:7});await page.mouse.up(); }
  await expect.poll(async()=>(await state(page)).objects.find(item=>item.id===id).dropped).toBe(true);
}

test('parameters start tucked away while presets, transport and every ingredient remain reachable',async({page})=>{
  await open(page);
  expect(await page.locator('#witchParameters').evaluate(el=>el.open)).toBe(false);
  for(const selector of ['.instrument-preset-controls','#playButton','#resetButton','#audioButton']) await expect(page.locator(selector)).toBeVisible();
  const sliders=page.locator('.witch-panel input[type="range"]');
  expect(await sliders.count()).toBeGreaterThan(0);
  for(const slider of await sliders.all()) await expect(slider).toBeHidden();
  expect((await state(page)).objects.map(object=>object.id)).toEqual(expect.arrayContaining(ingredientIds));
  await page.locator('#witchParameters > summary').focus();await page.keyboard.press('Enter');
  for(const slider of await sliders.all()) await expect(slider).toBeVisible();
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
  await selectScene(page,'flight');
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

test('spoon height selects all five singing characters and automatic motion remains visible',async({page})=>{
  await open(page);
  const initial=await state(page);
  await expect.poll(async()=>(await state(page)).spoonHeight).not.toBe(initial.spoonHeight);
  await parameters(page);
  for(const [i,voice] of ['mutter','whisper','creak','cackle','sing'].entries()) {
    await range(page,'spoonHeight',(i+.5)/5);
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

test('nose, hat, ember and night creatures reshape the ensemble without leaving the shared scene',async({page})=>{
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
  await clickStage(page,160,280);
  expect((await state(page)).config.voice).toBe('whisper');
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

test('every potion ingredient drops from the picture for a solo while voice, fingers and flight continue',async({page})=>{
  test.setTimeout(120000);
  await observeWorklet(page);await open(page);await page.locator('#audioButton').click();
  await selectScene(page,'flight');
  for(const id of ingredientIds) await test.step(`drop ${id}`,async()=>{
    await dropIngredient(page,id);
    await expect.poll(()=>page.evaluate(kind=>{
      const visual=window.witchVisual;
      return {triggered:window.witchTriggers.includes(kind),kind:visual?.dropKind,
        solo:visual?.dropLevel>.0001,voice:visual?.brewLevel>.0001,fingers:visual?.handLevel>.0001};
    },`drop-${id}`)).toEqual({triggered:true,kind:`drop-${id}`,solo:true,voice:true,fingers:true});
    const running=await state(page);expect(running.config.scene).toBe('flight');expect(running.playing).toBe(true);
  });
  const potion=(await state(page)).config;expect(potion.glass).toBeGreaterThan(0);expect(potion.hair).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.delayLevel??0)).toBeGreaterThan(.0001);
  const envelope=await sampleAudioEnvelope(page,{durationMs:500});
  expect(envelope.summary.finite).toBe(true);expect(envelope.summary.maxPeak).toBeGreaterThan(.001);expect(envelope.summary.clippedSamples).toBe(0);
  await page.locator('#witchCanvas').focus();await page.keyboard.press('Escape');
  await waitForStableAudioState(page,false,{timeout:12000,stableMs:250});
});

test('cancelled ingredients return, dropped ingredients reappear, and keyboard drops keep Audio off',async({page})=>{
  await open(page);
  const before=(await state(page)).objects.find(item=>item.id==='spider'),from=await point(page,before.x,before.y),to=await point(page,600,520);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:5});
  expect((await state(page)).objects.find(item=>item.id==='spider').dragging).toBe(true);
  await page.locator('#witchCanvas').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();
  const returned=(await state(page)).objects.find(item=>item.id==='spider');
  expect(returned.dropped).toBe(false);expect(returned.dragging).toBe(false);
  // Returning resumes the object's mist-hover, so compare its home neighborhood.
  expect(Math.hypot(returned.x-before.x,returned.y-before.y)).toBeLessThan(32);
  await page.locator('#witchCanvas').focus();await page.keyboard.press('q');await page.keyboard.press('e');await page.keyboard.press('r');
  for(const id of ['gesticules','marimba','choir']) expect((await state(page)).objects.find(item=>item.id===id).dropped).toBe(true);
  await expect.poll(async()=>(await state(page)).objects.find(item=>item.id==='choir').dropped,{timeout:6000}).toBe(false);
  const available=(await state(page)).objects;
  await page.keyboard.press(']');expect((await state(page)).selectedIngredient).toBe(available[0].id);
  await page.keyboard.press('[');expect((await state(page)).selectedIngredient).toBe(available.at(-1).id);
  await page.keyboard.press('Enter');
  expect((await state(page)).objects.find(item=>item.id===available.at(-1).id).dropped).toBe(true);
  expect((await state(page)).audioOn).toBe(false);expect((await readAudioStatus(page)).connectionCount).toBe(0);
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
    test(`Witches Brew ${label}: controls, two hands and ongoing flight fit`,async({page},testInfo)=>{
      await open(page);
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
      await dropIngredient(page,'oculoid',label!=='desktop');
      expect((await state(page)).config.scene).toBe('flight');expect((await state(page)).audioOn).toBe(false);
      if(label!=='desktop') for(const selector of ['#audioButton','#playButton']) {
        const rect=await page.locator(selector).boundingBox();expect(rect.width).toBeGreaterThanOrEqual(48);expect(rect.height).toBeGreaterThanOrEqual(48);
      }
      expect(await page.locator('#witchParameters').evaluate(el=>el.open)).toBe(false);
      await parameters(page);
      await page.locator('[data-drop="choir"]').scrollIntoViewIfNeeded();await expect(page.locator('[data-drop="choir"]')).toBeInViewport();
      await page.locator('.witch-help').scrollIntoViewIfNeeded();await expect(page.locator('.witch-help')).toBeInViewport();
      const a11y=await new AxeBuilder({page}).include('.witch-shell').analyze();
      expect(a11y.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    });
  });
}
