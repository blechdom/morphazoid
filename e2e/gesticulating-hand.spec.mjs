import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readAudioStatus } from './helpers/audio-probe.mjs';

const snapshot=page=>page.evaluate(()=>window.__gesticulatingHand.snapshot());
const range=(page,id,value)=>page.locator('#'+id).evaluate((input,value)=>{
  input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
},value);
test.beforeEach(async({page})=>{
  page.handErrors=[];page.on('pageerror',error=>page.handErrors.push(error.message));
  await page.goto('gesticules.html');
  await page.waitForFunction(()=>window.__gesticulatingHand?.snapshot().loaded,{},{timeout:15000});
});
test.afterEach(async({page})=>expect(page.handErrors).toEqual([]));

test('loads the real weighted hand and starts with no AudioContext',async({page})=>{
  const state=await snapshot(page);
  expect(state.viewer.boneCount).toBe(22);expect(state.viewer.triangles).toBe(28994);
  expect(state.audio.contextState).toBe('uninitialized');expect(state.audioOn).toBe(false);
  expect(state.config.motion.id).toBe('finger-roll');expect(state.pose.source).toBeNull();
  await expect(page.locator('.header-preset-picker summary')).toContainText('Finger loom');
  expect(await page.locator('#posePreset').inputValue()).toBe('relaxed');
  await expect(page.locator('h1')).toHaveText('Gesticules');
  await expect(page.locator('[data-instrument-preset-host] .header-preset-picker')).toBeVisible();
  expect(await page.locator('#motionPreset option').count()).toBe(36);
  expect(await page.locator('#source-0 option').count()).toBe(8);
  expect(await page.locator('#speed').inputValue()).toBe('1');
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
});

test('motion and keyboard gestures remain silent until explicit Audio arm',async({page})=>{
  await page.locator('#motionButton').click();await page.waitForTimeout(350);
  expect((await snapshot(page)).time).toBeGreaterThan(.2);
  await expect(page.locator('#liveStatus')).toContainText('Audio is off');
  await page.locator('#handCanvas').focus();await page.keyboard.press('Space');
  expect((await snapshot(page)).playing).toBe(false);
  await page.keyboard.press('3');await page.keyboard.press('ArrowDown');
  expect((await snapshot(page)).selected).toBe(2);
  expect((await snapshot(page)).config.pose.fingers[2].mcp).toBeGreaterThan(0);
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
});

test('direct joint drag changes the selected bone and cancellation releases the hold',async({page})=>{
  const before=await snapshot(page),rect=await page.locator('#handCanvas').boundingBox();
  const marker=before.viewer.markers.find(m=>m.finger===1&&m.joint==='pip');
  const x=rect.x+(marker.screen[0]+1)/2*rect.width,y=rect.y+(1-marker.screen[1])/2*rect.height;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+12,y+65,{steps:5});
  const held=await snapshot(page);expect(held.held).toBe(2);expect(held.config.pose.fingers[1].pip).toBeGreaterThan(20);
  expect(held.viewer.markers.find(m=>m.finger===1&&m.joint==='dip').position).not.toEqual(before.viewer.markers.find(m=>m.finger===1&&m.joint==='dip').position);
  const id=await page.locator('#handCanvas').evaluate(c=>[1,2,3].find(id=>c.hasPointerCapture(id)));
  await page.locator('#handCanvas').dispatchEvent('pointercancel',{pointerId:id});
  expect((await snapshot(page)).held).toBe(0);await page.mouse.up();
});

test('real worklet sustains bounded stereo through movement and releases on Audio off',async({page})=>{
  await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  await page.waitForTimeout(180);expect((await snapshot(page)).audio.rms).toBeLessThan(.00001);
  await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();
  await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeGreaterThan(.005);
  const before=await snapshot(page);expect(before.audio.peak).toBeLessThan(.95);
  await page.evaluate(()=>{const end=performance.now()+400;while(performance.now()<end){};});
  await page.waitForTimeout(120);
  const after=await snapshot(page);expect(after.time-before.time).toBeGreaterThan(.35);
  expect(after.audio.rms).toBeGreaterThan(.001);
  const output=await readAudioStatus(page);expect(output.leftPeak).toBeGreaterThan(0);expect(output.rightPeak).toBeGreaterThan(0);
  await page.locator('#audioButton').click();await page.waitForTimeout(180);
  expect((await snapshot(page)).audio.rms).toBeLessThan(.0001);
  expect((await snapshot(page)).playing).toBe(true);
});

test('preset recall covers its full ranges and preserves both players and output',async({page})=>{
  await range(page,'outputLevel',.23);await page.locator('#motionButton').click();await page.locator('#soundPlayButton').click();
  await page.locator('.header-preset-picker summary').click();
  await page.getByRole('button',{name:'Little machinery',exact:true}).click();
  const state=await snapshot(page);expect(state.playing&&state.soundPlaying).toBe(true);expect(state.audioOn).toBe(false);
  expect(await page.locator('#outputLevel').inputValue()).toBe('0.23');
  expect(Number(await page.locator('#tempo').inputValue())).toBe(state.config.motion.tempo);
  await page.locator('.header-preset-picker summary').click();
  await page.getByRole('button',{name:'Hushed palm',exact:true}).click();
  expect(Number(await page.locator('#release').inputValue())).toBe(2.2);
  expect((await snapshot(page)).playing).toBe(true);
  const motion=(await snapshot(page)).config.motion.id;
  await page.locator('#posePreset').selectOption('point');
  expect((await snapshot(page)).config.motion.id).toBe(motion);
  expect((await snapshot(page)).playing).toBe(true);
});

test('MIDI velocity and independent releases drive the same audible and visible pose',async({page})=>{
  const send=message=>page.evaluate(message=>window.dispatchEvent(new CustomEvent('morphazoid:midi-input',{cancelable:true,detail:{routeId:'gesticulating-hand',message}})),message);
  await send({type:'noteOn',note:60,velocity:1,sourceId:'test',channel:0});const soft=await snapshot(page);
  await send({type:'noteOn',note:60,velocity:127,sourceId:'test',channel:0});const loud=await snapshot(page);
  expect(loud.pose.fingers[0].mcp).toBeGreaterThan(soft.pose.fingers[0].mcp+20);
  await send({type:'noteOn',note:61,velocity:80,sourceId:'other',channel:0});expect((await snapshot(page)).held).toBe(3);
  await send({type:'noteOff',note:60,velocity:0,sourceId:'test',channel:0});expect((await snapshot(page)).held).toBe(2);
  await send({type:'noteOff',note:61,velocity:0,sourceId:'other',channel:0});expect((await snapshot(page)).held).toBe(0);
  expect((await snapshot(page)).config.pose).toEqual(soft.config.pose);
});

for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
  test(`controls and fingertips fit ${viewport.width}×${viewport.height}`,async({page})=>{
    await page.setViewportSize(viewport);await page.waitForTimeout(100);
    const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,canvas:document.querySelector('#handCanvas').getBoundingClientRect().toJSON()}));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.width+1);expect(sizes.canvas.width).toBeGreaterThan(250);expect(sizes.canvas.height).toBeGreaterThan(viewport.width>960?300:140);
    const state=await snapshot(page);for(const m of state.viewer.markers){expect(Math.abs(m.screen[0])).toBeLessThan(1);expect(Math.abs(m.screen[1])).toBeLessThan(1);}
    await page.locator('#release').scrollIntoViewIfNeeded();await expect(page.locator('#release')).toBeVisible();
    await page.locator('#source-4').scrollIntoViewIfNeeded();await expect(page.locator('#source-4')).toBeVisible();
  });
}

test('BFCache page lifecycle releases audio without destroying the returned controls',async({page})=>{
  await page.locator('#audioButton').click();await page.locator('#soundPlayButton').click();
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await page.waitForTimeout(100);expect((await snapshot(page)).audioOn).toBe(false);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await page.locator('#motionPreset').selectOption('wave');expect((await snapshot(page)).config.motion.id).toBe('wave');
  await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
});


test('the previous address preserves queries and fragments when redirecting to Gesticules',async({page})=>{
  await page.goto('gesticulating-hand.html?gesture=wave#movement');
  await expect(page).toHaveURL(/gesticules\.html\?gesture=wave#movement$/);
  await expect(page.locator('h1')).toHaveText('Gesticules');
});

for(const armed of [false,true]) {
  test(`speed and tempo preserve gesture and tremor with Audio ${armed?'on':'off'}`,async({page})=>{
    if(armed) {
      await page.locator('#audioButton').click();
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
    }
    await range(page,'tremorAmount',12.5);await range(page,'tremorRate',3.7);
    await page.locator('#tremorJoint').selectOption('middle');
    await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();
    await page.waitForTimeout(320);
    for(const playing of [true,false]) {
      if(!playing)await page.locator('#motionButton').click();
      for(const [id,values] of [['speed',[.1,4,1]],['tempo',[20,1100,72]]])for(const value of values) {
        const result=await page.evaluate(async({id,value})=>{
          const {evaluateHandPose,handMotionPeriod}=await import("/src/instruments/gesticulating-hand/hand-model.js");
          const started=performance.now();
          const before=window.__gesticulatingHand.snapshot(),input=document.querySelector('#'+id);
          input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
          const after=window.__gesticulatingHand.snapshot(),elapsed=(performance.now()-started)/1000;
          const periodRatio=handMotionPeriod(before.config.motion)/handMotionPeriod(after.config.motion);
          const oldTime=after.time*periodRatio;
          return {before,after,oldTime,elapsed,periodRatio,expected:evaluateHandPose(before.config,oldTime,undefined,after.tremorTime)};
        },{id,value});
        const {before,after,expected,oldTime,elapsed,periodRatio}=result;
        expect(after.config.motion[id]).toBe(value);
        expect(after.playing).toBe(playing);expect(after.soundPlaying).toBe(true);expect(after.audioOn).toBe(armed);
        // Converting back to the old period also scales time spent updating the
        // DOM (up to 55× here). Chromium's audio clock advances in batched quanta.
        const clockAllowance=armed?.012:.0002;
        expect(Math.abs(oldTime-before.time)).toBeLessThan(playing?(elapsed+clockAllowance)*Math.max(1,periodRatio):1e-8);
        expect(Math.abs(after.tremorTime-before.tremorTime)).toBeLessThan(playing?elapsed+clockAllowance:1e-8);
        for(let i=0;i<5;i++) for(const key of ['mcp','pip','dip','spread']) {
          // Compare at the same phase: the live audio clock keeps advancing during DOM updates.
          expect(Math.abs(after.pose.fingers[i][key]-expected.fingers[i][key])).toBeLessThan(.0001);
          if(!playing)expect(Math.abs(after.pose.fingers[i][key]-before.pose.fingers[i][key])).toBeLessThan(.0001);
        }
        await expect(page.locator('#'+id+'Out')).toHaveText(id==='speed'?`${value}×`:String(value));
      }
    }
    if(!armed)expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
  });
}

test('new engines play through the worklet and all choreography choices remain editable',async({page})=>{
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  await page.locator('#motionPreset').selectOption('finger-drumming');
  await page.locator('#motionButton').click();await page.locator('#soundPlayButton').click();
  for(const source of ['bowed','vowel','metal']) {
    for(let i=0;i<5;i++)await page.locator(`#source-${i}`).selectOption(source);
    await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeGreaterThan(.0001);
    const current=await snapshot(page);
    expect(current.config.voices.every(voice=>voice.source===source)).toBe(true);
    expect(current.audio.peak).toBeLessThan(.95);expect(current.playing&&current.soundPlaying).toBe(true);
  }
  const motions=await page.locator('#motionPreset option').evaluateAll(options=>options.map(option=>option.value));
  for(const motion of motions) {
    await page.locator('#motionPreset').selectOption(motion);
    const current=await snapshot(page);
    expect(current.config.motion.id).toBe(motion);expect(current.playing&&current.soundPlaying).toBe(true);
  }
  await page.locator('#audioButton').click();await page.waitForTimeout(200);
  expect((await snapshot(page)).audio.rms).toBeLessThan(.0001);
});


test('a held direct drag re-excites Metal after the first strike has decayed',async({page})=>{
  await page.locator('#source-1').selectOption('metal');
  await range(page,'roughness',1);await range(page,'space',0);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  const state=await snapshot(page),rect=await page.locator('#handCanvas').boundingBox();
  const marker=state.viewer.markers.find(m=>m.finger===1&&m.joint==='pip');
  const x=rect.x+(marker.screen[0]+1)/2*rect.width,y=rect.y+(1-marker.screen[1])/2*rect.height;
  await page.mouse.move(x,y);await page.mouse.down();
  expect((await snapshot(page)).held).toBe(2);
  await page.waitForTimeout(1800);
  const settled=(await snapshot(page)).audio.rms;
  await page.mouse.move(x+5,y+40,{steps:3});
  await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeGreaterThan(settled*2+.0001);
  expect((await snapshot(page)).playing).toBe(false);
  await page.mouse.up();expect((await snapshot(page)).held).toBe(0);
});


for(const viewport of [{width:390,height:844},{width:320,height:568},{width:844,height:390}]) {
test(`framing contains fingertips throughout every choreography and pose at ${viewport.width}×${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport);
  const result=await page.evaluate(async()=>{
    const {createHandViewer}=await import('/src/instruments/gesticulating-hand/hand-viewer.js');
    const {HAND_POSES,HAND_MOTIONS,normalizeHandConfig,evaluateHandPose,handMotionPeriod}=await import('/src/instruments/gesticulating-hand/hand-model.js');
    const bounds=document.querySelector('#handCanvas').getBoundingClientRect();
    const canvas=document.createElement('canvas');
    canvas.style.cssText=`position:fixed;left:0;top:0;width:${bounds.width}px;height:${bounds.height}px`;
    document.body.append(canvas);
    let ready;const loaded=new Promise(resolve=>{ready=resolve;});
    const viewer=createHandViewer(canvas,{onReady:ready});
    try {
      await loaded;let peak={value:0},tipCount=0;
      for(const pose of HAND_POSES)for(const motion of HAND_MOTIONS)for(const amount of [0,15]){
        const config=normalizeHandConfig({pose:pose.pose,motion:{id:motion.id,amount:1},tremor:{joint:"wrist",amount,rate:13}});
        for(let frame=0;frame<32;frame++){
          viewer.setPose(evaluateHandPose(config,frame/32*handMotionPeriod(config.motion)));
          const state=viewer.getState();tipCount=state.fingertips.length;
          for(const point of [...state.fingertips,...state.markers.map(marker=>marker.screen)]){
            for(let axis=0;axis<2;axis++)if(Math.abs(point[axis])>peak.value){
              peak={value:Math.abs(point[axis]),pose:pose.id,motion:motion.id,frame,axis};
            }
          }
        }
      }
      return {peak,tipCount};
    } finally {viewer.dispose();canvas.remove();}
  });
  expect(result.tipCount).toBe(5);
  expect(result.peak.value,JSON.stringify(result.peak)).toBeLessThan(.97);
});
}


const chooseScene=async(page,label)=>{
  await page.locator('.header-preset-picker summary').click();
  await page.getByRole('button',{name:label,exact:true}).click();
};

test('full presets restore tempo, speed, camera, tremors, skin and lighting after live edits',async({page})=>{
  await range(page,'outputLevel',.23);
  await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();
  for(const label of ['Finger swarm','Scattered sparks']) {
    await chooseScene(page,label);
    const saved=await snapshot(page);
    expect(saved.config.motion.tempo).toBeGreaterThan(220);
    expect(saved.config.motion.speed).toBeGreaterThan(1);
    expect(saved.config.tremor.amount).toBeGreaterThan(0);
    expect(Number(await page.locator('#tempo').inputValue())).toBe(saved.config.motion.tempo);
    expect(Number(await page.locator('#speed').inputValue())).toBe(saved.config.motion.speed);
    await page.locator('[data-view="back"]').click();await page.locator('#zoomIn').click();
    const camera=(await snapshot(page)).config.view;
    const captured=await page.evaluate(async()=>{
      const {captureHeaderPresetState}=await import('/src/site/header-presets.js');return captureHeaderPresetState();
    });
    expect(captured.snapshot.view).toEqual(camera);
    expect(captured.selectedId).toBe(null);
    await expect(page.locator('.header-preset-picker summary')).toContainText('Custom');
    await range(page,'tempo',40);await range(page,'speed',.2);await range(page,'tremorAmount',.7);
    await range(page,'skin',.83);await range(page,'lighting',.71);
    await chooseScene(page,label);
    const restored=await snapshot(page);
    expect(restored.config).toEqual(saved.config);
    expect(restored.viewer.view.yaw).toBeCloseTo(saved.config.view.yaw,8);
    expect(restored.viewer.view.pitch).toBe(saved.config.view.pitch);
    expect(restored.viewer.view.zoom).toBe(saved.config.view.zoom);
    expect(restored.viewer.appearance).toEqual(saved.config.appearance);
    expect(restored.playing&&restored.soundPlaying).toBe(true);expect(restored.audioOn).toBe(false);
    expect(await page.locator('#outputLevel').inputValue()).toBe('0.23');
  }
  const before=(await snapshot(page)).config.view;
  const rect=await page.locator('#handCanvas').boundingBox();
  await page.mouse.move(rect.x+rect.width-25,rect.y+60);await page.mouse.down();
  await page.mouse.move(rect.x+rect.width-95,rect.y+80,{steps:4});await page.mouse.up();
  const orbited=await snapshot(page);
  expect(Math.abs(orbited.config.view.yaw-before.yaw)).toBeGreaterThan(.4);
  expect(orbited.viewer.view).toEqual(orbited.config.view);
  await expect(page.locator('.header-preset-picker summary')).toContainText('Custom');
});

test('tremor animates the chosen finger joints and freezes on Motion pause',async({page})=>{
  await page.locator('#motionPreset').selectOption('still');await page.locator('#posePreset').selectOption('relaxed');
  await page.locator('#tremorFinger').selectOption('index');await page.locator('#tremorJoint').selectOption('middle');
  await range(page,'tremorAmount',12.5);await range(page,'tremorRate',3.7);
  await expect(page.locator('#tremorAmountOut')).toHaveText('12.5°');
  await page.locator('#motionButton').click();
  const first=await snapshot(page);
  await expect.poll(async()=>Math.abs((await snapshot(page)).pose.fingers[1].pip-first.pose.fingers[1].pip)).toBeGreaterThan(5);
  const second=await snapshot(page);
  for(const index of [0,2,3,4])expect(second.pose.fingers[index]).toEqual(first.pose.fingers[index]);
  await expect.poll(async()=>JSON.stringify((await snapshot(page)).viewer.fingertips[1])).not.toBe(JSON.stringify(first.viewer.fingertips[1]));
  await page.locator('#motionButton').click();const paused=await snapshot(page);await page.waitForTimeout(180);
  expect((await snapshot(page)).pose).toEqual(paused.pose);
  for(const rate of [.5,40,8]) {
    await range(page,'tremorRate',rate);
    const changed=await snapshot(page);
    for(const key of ['mcp','pip','dip','spread'])expect(changed.pose.fingers[1][key]).toBeCloseTo(paused.pose.fingers[1][key],8);
  }
  expect(paused.audio.contextState).toBe('uninitialized');
  await page.locator('#tremorJoint').selectOption('wrist');await expect(page.locator('#tremorFinger')).toBeDisabled();
});

test('continuous Color and Light sliders change both surfaces and restore their saved positions',async({page})=>{
  const canvas=page.locator('#handCanvas'),original=await canvas.screenshot();
  await expect(page.locator('#skin')).toHaveAttribute('type','range');await expect(page.locator('#lighting')).toHaveAttribute('type','range');
  await expect(page.locator('#lookTitle')).toHaveText('Color & light');
  for(const skin of [.137,.38,.552,.763,.912]) {
    await range(page,'skin',skin);await page.waitForTimeout(70);
    expect((await canvas.screenshot()).equals(original),String(skin)).toBe(false);
    expect((await snapshot(page)).config.appearance.skin).toBeCloseTo(skin,8);
  }
  await range(page,'skin',0);await page.waitForTimeout(70);expect((await canvas.screenshot()).equals(original)).toBe(true);
  for(const lighting of [.117,.36,.57,.8,.937]) {
    await range(page,'lighting',lighting);await page.waitForTimeout(70);
    expect((await canvas.screenshot()).equals(original),String(lighting)).toBe(false);
  }
  await range(page,'lighting',0);await page.waitForTimeout(70);expect((await canvas.screenshot()).equals(original)).toBe(true);
  await page.locator('#bodyForm').selectOption('foot');
  await page.waitForFunction(()=>window.__gesticulatingHand.snapshot().viewer.form==='foot');
  const foot=await canvas.screenshot();await range(page,'skin',.621);await range(page,'lighting',.337);await page.waitForTimeout(70);
  expect((await canvas.screenshot()).equals(foot)).toBe(false);
  expect((await snapshot(page)).config.appearance).toEqual({skin:.621,lighting:.337});
});

test('maximum tempo, speed and tremor sustain all complex patterns through a rendering stall',async({page})=>{
  await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  await range(page,'tempo',1100);await range(page,'speed',4);await range(page,'tremorAmount',15);await range(page,'tremorRate',40);
  await page.locator('#tremorJoint').selectOption('whole');await page.locator('#tremorFinger').selectOption('alternating');
  await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();
  for(const motion of ['polyrhythmic-tangle','finger-swarm','frantic-orbit','scatter']) {
    await page.locator('#motionPreset').selectOption(motion);
    await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeGreaterThan(.001);
    const before=await snapshot(page);
    await page.evaluate(()=>{const until=performance.now()+250;while(performance.now()<until){};});
    await page.waitForTimeout(80);
    const after=await snapshot(page);
    expect(after.time-before.time).toBeGreaterThan(.25);
    expect(after.audio.rms).toBeGreaterThan(.001);expect(after.audio.peak).toBeLessThan(.95);
    expect(after.pose.fingers.flatMap(f=>Object.values(f)).every(Number.isFinite)).toBe(true);
  }
});

test.describe('pinned mobile stage',()=>{
  test.use({isMobile:true,hasTouch:true});
  for(const viewport of [{width:390,height:844},{width:320,height:568},{width:844,height:390}]) {
    test(`touch scrolling, focus and playback leave the stage fixed at ${viewport.width}×${viewport.height}`,async({page})=>{
      await page.setViewportSize(viewport);await page.waitForTimeout(100);
      const geometry=()=>page.evaluate(()=>{
        const rect=id=>document.querySelector(id).getBoundingClientRect().toJSON();
        return {stage:rect('#handStage'),canvas:rect('#handCanvas'),header:rect('.masthead'),scroll:scrollY,width:innerWidth,overflow:document.documentElement.scrollWidth};
      });
      const initial=await geometry();
      expect(initial.overflow).toBeLessThanOrEqual(initial.width+1);
      expect(viewport.height-initial.stage.bottom).toBeGreaterThan(100);
      for(const id of ['audioButton','soundPlayButton','motionButton']) {
        const bounds=await page.locator('#'+id).boundingBox();expect(bounds.width).toBeGreaterThanOrEqual(48);expect(bounds.height).toBeGreaterThanOrEqual(48);
      }
      await page.locator('#audioButton').click();await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();
      const playing=await geometry();
      expect(playing.stage.x).toBeCloseTo(initial.stage.x,0);expect(playing.stage.width).toBeCloseTo(initial.stage.width,0);
      const cdp=await page.context().newCDPSession(page);
      const x=viewport.width-6,from=viewport.height-15,to=playing.stage.bottom+12;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:from}]});
      for(let step=1;step<=8;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:from+(to-from)*step/8}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await expect.poll(async()=>(await geometry()).scroll).toBeGreaterThan(30);
      for(const id of ['tempo','speed','rotationFx','skin','lighting','release','source-4']) {
        await page.locator('#'+id).evaluate(input=>{input.scrollIntoView({block:'center'});input.focus({preventScroll:true});});
        const current=await geometry();
        expect(current.stage.y).toBeCloseTo(initial.stage.y,0);expect(current.canvas.x).toBeCloseTo(initial.canvas.x,0);
        const control=await page.locator('#'+id).evaluate(input=>{
          const r=input.getBoundingClientRect();return {top:r.top,bottom:r.bottom,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===input};
        });
        expect(control.top).toBeGreaterThanOrEqual(current.stage.bottom);expect(control.bottom).toBeLessThan(viewport.height);expect(control.hit).toBe(true);
      }
      await page.locator('#motionButton').evaluate(button=>button.scrollIntoView({block:'center'}));
      expect(await page.locator('#motionButton').evaluate(button=>{const r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
      const before=(await snapshot(page)).config.view,rect=await page.locator('#handCanvas').boundingBox();
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x+rect.width-15,y:rect.y+50}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:rect.x+rect.width-65,y:rect.y+55}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
      expect((await snapshot(page)).config.view).not.toEqual(before);
      await page.setViewportSize(viewport.width>viewport.height?{width:390,height:844}:{width:844,height:390});
      await page.waitForTimeout(120);
      const rotated=await geometry();expect(rotated.overflow).toBeLessThanOrEqual(rotated.width+1);
      const state=await snapshot(page);expect(state.playing&&state.soundPlaying&&state.audioOn).toBe(true);
      expect(state.audio.rms).toBeGreaterThan(.001);
      await cdp.detach();
    });
  }
});


test('right-panel players use aligned Shape transport icons and keep separate ownership',async({page})=>{
  for(const id of ['soundPlayButton','motionButton','speed','tempo']) {
    await expect(page.locator(`.hand-panel #${id}`)).toHaveCount(1);
    await expect(page.locator(`#handStage #${id}`)).toHaveCount(0);
  }
  const layout=await page.evaluate(()=>{
    const rect=id=>document.getElementById(id).getBoundingClientRect().toJSON();
    const ids=['soundPlayButton','motionButton','tempo','speed'];
    return {boxes:Object.fromEntries(ids.map(id=>[id,rect(id)])),radius:getComputedStyle(document.getElementById('motionButton')).borderRadius};
  });
  expect(layout.radius).toBe('50%');
  expect(layout.boxes.soundPlayButton.y).toBeCloseTo(layout.boxes.motionButton.y,0);
  expect(layout.boxes.tempo.y).toBeCloseTo(layout.boxes.motionButton.y,0);
  expect(layout.boxes.speed.y).toBeGreaterThan(layout.boxes.tempo.bottom);
  await page.locator('#soundPlayButton').click();
  await expect(page.locator('#soundPlayButton .transport-pause')).toBeVisible();
  await expect(page.locator('#soundPlayButton .transport-play')).toBeHidden();
  const sound=await snapshot(page);expect(sound.soundPlaying).toBe(true);expect(sound.playing).toBe(false);expect(sound.audioOn).toBe(false);
  await page.locator('#motionButton').click();await page.locator('#soundPlayButton').click();
  const motion=await snapshot(page);expect(motion.soundPlaying).toBe(false);expect(motion.playing).toBe(true);expect(motion.audioOn).toBe(false);
  await expect(page.locator('#motionButton .transport-pause')).toBeVisible();
});

test('rotation reaches the worklet and auditions the hand only after Audio is armed',async({page})=>{
  await page.locator('[data-view="side"]').click();
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
  await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  await range(page,'release',.04);await range(page,'space',0);
  await page.locator('[data-view="back"]').click();
  await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeGreaterThan(.001);
  const rotated=await snapshot(page);
  expect(rotated.soundPlaying||rotated.playing).toBe(false);
  await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeLessThan(.0001);
  await page.locator('#zoomIn').click();await page.waitForTimeout(130);
  expect((await snapshot(page)).audio.rms).toBeLessThan(.0001);
  await range(page,'rotationFx',0);await page.locator('[data-view="palm"]').click();await page.waitForTimeout(130);
  expect((await snapshot(page)).audio.rms).toBeLessThan(.0001);
  await range(page,'rotationFx',1);
  const rect=await page.locator('#handCanvas').boundingBox();
  await page.mouse.move(rect.x+rect.width-20,rect.y+60);await page.mouse.down();
  await page.mouse.move(rect.x+rect.width-90,rect.y+85,{steps:5});await page.mouse.up();
  await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeGreaterThan(.001);
  expect((await snapshot(page)).audio.peak).toBeLessThan(.95);
  await chooseScene(page,'Finger swarm');const saved=(await snapshot(page)).config.sound.rotationFx;
  await range(page,'rotationFx',saved===1?0:1);await chooseScene(page,'Finger swarm');
  expect((await snapshot(page)).config.sound.rotationFx).toBe(saved);
});
