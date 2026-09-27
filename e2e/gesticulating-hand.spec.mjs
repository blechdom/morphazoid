import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

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
  expect(await page.locator('#motionPreset option').count()).toBe(43);
  expect(await page.locator('#source-0 option').count()).toBe(10);
  await expect(page.locator('#speed')).toHaveCount(0);
  await expect(page.locator('#tempo')).toHaveAttribute('min','2');
  await expect(page.locator('#tempo')).toHaveAttribute('max','4400');
  await expect(page.locator('#tempo')).toHaveAttribute('step','0.1');
  expect(Math.abs(Number(await page.locator('#tempo').inputValue())-state.config.motion.tempo*state.config.motion.speed)).toBeLessThanOrEqual(.051);
  await expect(page.locator('#outputLevel')).toHaveAttribute('max','1');
  await expect(page.locator('#rhythm')).toHaveValue('continuous');
  await expect(page.locator('#note-length')).toHaveAttribute('min','0.08');
  await expect(page.locator('#note-length')).toHaveAttribute('max','0.9');
  await expect(page.getByRole('link',{name:'Model, movement and sound notes',exact:true})).toHaveCount(0);
  const bank=await page.evaluate(async()=>{const {HAND_PRESETS}=await import('/src/instruments/gesticulating-hand/hand-model.js');return HAND_PRESETS.map(scene=>scene.snapshot.form);});
  expect(bank).toHaveLength(68);expect(bank.filter(form=>form==='hand')).toHaveLength(47);expect(bank.filter(form=>form==='foot')).toHaveLength(21);
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
});

test('motion and keyboard gestures remain silent until explicit Audio arm',async({page})=>{
  await page.locator('#motionButton').click();await page.waitForTimeout(350);
  expect((await snapshot(page)).time).toBeGreaterThan(.2);
  await expect(page.locator('#liveStatus')).toBeEmpty();
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
  expect(Math.abs(Number(await page.locator('#tempo').inputValue())-state.config.motion.tempo*state.config.motion.speed)).toBeLessThanOrEqual(.051);
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
  test(`combined tempo preserves gesture and tremor with Audio ${armed?'on':'off'}`,async({page})=>{
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
      for(const value of [2,4400,72.3,72]) {
        const id='tempo';
        const result=await page.evaluate(async({id,value})=>{
          const {evaluateHandPose,handMotionPeriod,handTremorRate}=await import("/src/instruments/gesticulating-hand/hand-model.js");
          const started=performance.now();
          const before=window.__gesticulatingHand.snapshot(),input=document.querySelector('#'+id);
          input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
          const after=window.__gesticulatingHand.snapshot(),elapsed=(performance.now()-started)/1000;
          const periodRatio=handMotionPeriod(before.config.motion)/handMotionPeriod(after.config.motion);
          const oldTime=after.time*periodRatio;
          const oldTremorTime=after.tremorTime*handTremorRate(after.config)/handTremorRate(before.config);
          return {before,after,oldTime,oldTremorTime,elapsed,periodRatio,expected:evaluateHandPose(before.config,oldTime,undefined,oldTremorTime)};
        },{id,value});
        const {before,after,expected,oldTime,oldTremorTime,elapsed,periodRatio}=result;
        expect(after.config.motion.tempo*after.config.motion.speed).toBeCloseTo(value,8);
        expect(after.playing).toBe(playing);expect(after.soundPlaying).toBe(true);expect(after.audioOn).toBe(armed);
        // Converting back to the old period also scales time spent updating the
        // DOM (up to 2,200× here). Chromium's audio clock advances in batched quanta.
        const clockAllowance=armed?.012:.0002;
        expect(Math.abs(oldTime-before.time)).toBeLessThan(playing?(elapsed+clockAllowance)*Math.max(1,periodRatio):1e-8);
        expect(Math.abs(oldTremorTime-before.tremorTime)).toBeLessThan(playing?(elapsed+clockAllowance)*Math.max(1,periodRatio):1e-8);
        for(let i=0;i<5;i++) for(const key of ['mcp','pip','dip','spread']) {
          // Compare at the same phase: the live audio clock keeps advancing during DOM updates.
          expect(Math.abs(after.pose.fingers[i][key]-expected.fingers[i][key])).toBeLessThan(.0001);
          if(!playing)expect(Math.abs(after.pose.fingers[i][key]-before.pose.fingers[i][key])).toBeLessThan(.0001);
        }
        await expect(page.locator('#tempoOut')).toHaveText(`${value} BPM`);
      }
    }
    if(!armed)expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
  });
}

// Exercise the actual dice/app path, including its captured random source.
for (const armed of [false, true]) {
  test(`Tempo slows severe randomized shakes with Audio ${armed ? 'on' : 'off'}`, async ({page}) => {
    await page.addInitScript(() => {
      const random = Math.random;
      Math.random = () => {
        if (window.__diceSeed === undefined) return random();
        window.__diceSeed = (Math.imul(window.__diceSeed, 1664525) + 1013904223) >>> 0;
        return window.__diceSeed / 4294967296;
      };
    });
    await page.reload();
    await page.waitForFunction(() => window.__gesticulatingHand?.snapshot().loaded);
    if (armed) await page.locator('#audioButton').click();
    await page.locator('#motionButton').click();
    await page.locator('#soundPlayButton').click();
    const observe = reference => page.evaluate(async reference => {
      const {evaluateHandPose, handEffectiveTempo} = await import('/src/instruments/gesticulating-hand/hand-model.js');
      const joints = pose => [...pose.fingers.flatMap(f => [f.mcp, f.pip, f.dip, f.spread]),
        ...Object.values(pose.wrist), ...Object.values(pose.foot ?? {})];
      let error = 0, travel = 0, previous = joints(window.__gesticulatingHand.snapshot().pose);
      for (let i = 0; i < 24; i++) {
        await new Promise(resolve => setTimeout(resolve, 20));
        const state = window.__gesticulatingHand.snapshot(), actual = joints(state.pose);
        const ratio = 2 / handEffectiveTempo(reference.motion);
        const expected = joints(evaluateHandPose(reference, state.time * ratio, undefined, state.tremorTime * ratio));
        error = Math.max(error, ...actual.map((value, j) => Math.abs(value - expected[j])));
        travel += actual.reduce((sum, value, j) => sum + Math.abs(value - previous[j]), 0);
        previous = actual;
      }
      return {error, travel};
    }, reference);
    for (const [seed, form] of [[38, 'hand'], [69, 'hand'], [103, 'foot']]) {
      await page.evaluate(seed => {
        window.__diceSeed = seed;
        try { document.querySelector('.header-preset-random').click(); }
        finally { delete window.__diceSeed; }
      }, seed);
      await page.waitForFunction(() => window.__gesticulatingHand.snapshot().loaded);
      const before = await snapshot(page);
      expect(before.config.form).toBe(form);
      expect(before.config.tremor.rate).toBeGreaterThan(70);
      await range(page, 'tempo', 2);
      const after = await snapshot(page), observed = await observe(before.config);
      expect(after.playing).toBe(true); expect(after.audioOn).toBe(armed);
      expect(after.config.tremor).toEqual(before.config.tremor);
      // Compare the entire live path with the original scene stretched in time.
      // Frame-sampled speed ratios alias the original 75–200 Hz shakes.
      expect(observed.error).toBeLessThan(.0001);
      expect(observed.travel).toBeGreaterThan(0);
      const effectiveHz = before.config.tremor.rate * 2 / before.config.tremor.referenceTempo;
      await expect(page.locator('#tremorRateOut')).toHaveText(`${Number(effectiveHz.toPrecision(3))} Hz`);
      await expect(page.locator('#tremorRate')).toHaveAttribute('aria-valuetext', `${Number(effectiveHz.toPrecision(3))} Hz`);
      await range(page, 'tempo', before.config.motion.tempo * before.config.motion.speed);
      expect((await snapshot(page)).config.tremor).toEqual(before.config.tremor);
    }
    if (!armed) expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
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
    if(motion==='drawn')expect(current.config.motion.custom).toBe(true);
    else {expect(current.config.motion.id).toBe(motion);expect(current.config.motion.custom).toBe(false);}
    expect(current.playing&&current.soundPlaying).toBe(true);
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

test('full presets restore combined tempo, rhythm, camera, tremors, skin and lighting after live edits',async({page})=>{
  await range(page,'outputLevel',.23);
  await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();
  for(const label of ['Finger swarm','Scattered sparks']) {
    await chooseScene(page,label);
    const saved=await snapshot(page);
    expect(saved.config.motion.tempo).toBeGreaterThan(220);
    expect(saved.config.motion.speed).toBeGreaterThan(1);
    expect(saved.config.tremor.amount).toBeGreaterThan(0);
    expect(Math.abs(Number(await page.locator('#tempo').inputValue())-saved.config.motion.tempo*saved.config.motion.speed)).toBeLessThanOrEqual(.051);
    await expect(page.locator('#rhythm')).toHaveValue(saved.config.sound.rhythm);
    expect(Number(await page.locator('#note-length').inputValue())).toBeCloseTo(saved.config.sound.noteLength,3);
    await page.locator('[data-view="back"]').click();await page.locator('#zoomIn').click();
    const camera=(await snapshot(page)).config.view;
    const captured=await page.evaluate(async()=>{
      const {captureHeaderPresetState}=await import('/src/site/header-presets.js');return captureHeaderPresetState();
    });
    expect(captured.snapshot.view).toEqual(camera);
    expect(captured.selectedId).toBe(null);
    await expect(page.locator('.header-preset-picker summary')).toContainText('Custom');
    await range(page,'tempo',8);await range(page,'tremorAmount',.7);
    await page.locator('#rhythm').selectOption('broken');await range(page,'note-length',.83);
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
  // Compare restored materials without transient afterimages; trails have separate pixel coverage.
  await range(page,'space',0);
  const canvas=page.locator('#handCanvas'),original=await canvas.screenshot();
  await expect(page.locator('#skin')).toHaveAttribute('type','range');await expect(page.locator('#lighting')).toHaveAttribute('type','range');
  await expect(page.locator('#lookTitle')).toHaveText('Color & light');
  await expect(page.locator('#lighting')).toHaveAttribute('max','1.6');
  for(const skin of [.137,.38,.552,.763,.912]) {
    await range(page,'skin',skin);await page.waitForTimeout(70);
    expect((await canvas.screenshot()).equals(original),String(skin)).toBe(false);
    expect((await snapshot(page)).config.appearance.skin).toBeCloseTo(skin,8);
  }
  await range(page,'skin',0);await page.waitForTimeout(70);expect((await canvas.screenshot()).equals(original)).toBe(true);
  for(const lighting of [.117,.36,.57,.8,.937,1.2,1.4,1.6]) {
    await range(page,'lighting',lighting);await page.waitForTimeout(70);
    expect((await canvas.screenshot()).equals(original),String(lighting)).toBe(false);
  }
  await range(page,'lighting',0);await page.waitForTimeout(70);expect((await canvas.screenshot()).equals(original)).toBe(true);
  await page.locator('#bodyForm').selectOption('foot');
  await page.waitForFunction(()=>window.__gesticulatingHand.snapshot().viewer.form==='foot');
  const foot=await canvas.screenshot();await range(page,'skin',.621);await range(page,'lighting',1.337);await page.waitForTimeout(70);
  expect((await canvas.screenshot()).equals(foot)).toBe(false);
  expect((await snapshot(page)).config.appearance).toEqual({skin:.621,lighting:1.337});
});

test('maximum combined tempo and tremor sustain all complex patterns through a rendering stall',async({page})=>{
  await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  await range(page,'tempo',4400);await range(page,'tremorAmount',15);await range(page,'tremorRate',40);
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
      for(const id of ['tempo','rhythm','note-length','rotationFx','skin','lighting','release','source-4','contour-joint-0','contour-0','contour-4']) {
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
  for(const id of ['soundPlayButton','motionButton','tempo']) {
    await expect(page.locator(`.hand-panel #${id}`)).toHaveCount(1);
    await expect(page.locator(`#handStage #${id}`)).toHaveCount(0);
  }
  const layout=await page.evaluate(()=>{
    const rect=id=>document.getElementById(id).getBoundingClientRect().toJSON();
    const ids=['soundPlayButton','motionButton','tempo'];
    return {boxes:Object.fromEntries(ids.map(id=>[id,rect(id)])),radius:getComputedStyle(document.getElementById('motionButton')).borderRadius};
  });
  expect(layout.radius).toBe('50%');
  expect(layout.boxes.soundPlayButton.y).toBeCloseTo(layout.boxes.motionButton.y,0);
  expect(layout.boxes.tempo.y).toBeCloseTo(layout.boxes.motionButton.y,0);
  await expect(page.locator('#speed')).toHaveCount(0);
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

test('rhythm controls keep transport independent and turn held sound into separated notes',async({page})=>{
  await expect(page.locator('#rhythm option')).toHaveCount(5);
  const choices=await page.locator('#rhythm option').evaluateAll(options=>options.map(option=>option.value));
  expect(choices).toEqual(['continuous','walk','offbeat','three-four','broken']);
  await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();
  for(const rhythm of choices) {
    await page.locator('#rhythm').selectOption(rhythm);await range(page,'note-length',.18);
    const state=await snapshot(page);
    expect(state.config.sound.rhythm).toBe(rhythm);expect(state.config.sound.noteLength).toBe(.18);
    expect(state.soundPlaying&&state.playing).toBe(true);expect(state.audio.contextState).toBe('uninitialized');
  }
  await page.locator('#rhythm').selectOption('continuous');await range(page,'tempo',120);
  await range(page,'attack',.004);await range(page,'release',.04);await range(page,'space',0);await range(page,'rotationFx',0);
  for(let i=0;i<5;i++)await page.locator(`#source-${i}`).selectOption('reed');
  await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  await expect.poll(async()=>(await readAudioStatus(page)).rms).toBeGreaterThan(.005);
  const sustained=await sampleAudioEnvelope(page,{durationMs:800,intervalMs:25});
  await page.locator('#rhythm').selectOption('walk');await range(page,'note-length',.08);await page.waitForTimeout(160);
  const separated=await sampleAudioEnvelope(page,{durationMs:2400,intervalMs:25});
  expect(separated.summary.finite).toBe(true);expect(separated.summary.clippedSamples).toBe(0);
  expect(separated.summary.maxRms).toBeGreaterThan(.001);
  expect(separated.summary.meanRms).toBeLessThan(sustained.summary.meanRms*.7);
  expect(separated.samples.filter(sample=>sample.rms<separated.summary.maxRms*.08).length).toBeGreaterThan(3);
  await range(page,'note-length',.9);await page.waitForTimeout(160);
  const longer=await sampleAudioEnvelope(page,{durationMs:1800,intervalMs:25});
  expect(longer.summary.meanRms).toBeGreaterThan(separated.summary.meanRms*1.25);
  const state=await snapshot(page);expect(state.audioOn&&state.soundPlaying&&state.playing).toBe(true);
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
  await page.locator('#audioButton').click();
  await expect.poll(async()=>(await readAudioStatus(page)).peak).toBeLessThan(.00001);
  expect((await snapshot(page)).playing).toBe(true);
});

test('four rhythmic hand presets recall their complete articulation and precise combined tempo',async({page})=>{
  const labels=['Crystal staccato','Wire backbeat','Singing triplet','Tin skips'];
  const scenes=await page.evaluate(async labels=>{
    const {HAND_PRESETS}=await import('/src/instruments/gesticulating-hand/hand-model.js');
    return labels.map(label=>HAND_PRESETS.find(scene=>scene.label===label));
  },labels);
  expect(scenes.every(Boolean)).toBe(true);
  await range(page,'outputLevel',.23);await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();
  for(const scene of scenes) {
    await range(page,'tempo',2);await page.locator('#rhythm').selectOption('continuous');await range(page,'note-length',.9);
    await chooseScene(page,scene.label);
    const restored=await snapshot(page);expect(restored.config).toEqual(scene.snapshot);
    expect(restored.soundPlaying&&restored.playing).toBe(true);expect(restored.audio.contextState).toBe('uninitialized');
    await expect(page.locator('#outputLevel')).toHaveValue('0.23');await expect(page.locator('#rhythm')).toHaveValue(scene.snapshot.sound.rhythm);
    expect(Number(await page.locator('#note-length').inputValue())).toBeCloseTo(scene.snapshot.sound.noteLength,3);
    const expectedTempo=scene.snapshot.motion.tempo*scene.snapshot.motion.speed;
    expect(Math.abs(Number(await page.locator('#tempo').inputValue())-expectedTempo)).toBeLessThanOrEqual(.051);
  }
});

test('the output control reaches unity and mutes the actual speaker route at zero',async({page})=>{
  await page.locator('#outputLevel').focus();await page.locator('#outputLevel').press('End');
  await expect(page.locator('#outputLevel')).toHaveValue('1');await expect(page.locator('#outputLevelOut')).toHaveText('100%');
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
  await page.locator('#audioButton').click();await page.locator('#soundPlayButton').click();
  await expect.poll(async()=>(await readAudioStatus(page)).rms).toBeGreaterThan(.005);
  const audible=await sampleAudioEnvelope(page,{durationMs:600,intervalMs:30});
  expect(audible.summary.finite).toBe(true);expect(audible.summary.clippedSamples).toBe(0);
  expect(audible.summary.maxPeak).toBeLessThanOrEqual(.890001);
  await page.locator('#outputLevel').focus();await page.locator('#outputLevel').press('Home');
  await expect(page.locator('#outputLevel')).toHaveValue('0');
  await expect.poll(async()=>(await readAudioStatus(page)).peak).toBe(0);
  expect((await snapshot(page)).audioOn).toBe(true);expect((await snapshot(page)).soundPlaying).toBe(true);
});

test('one captured contour drag fills skipped points, edits only its joint and undoes as one action',async({page})=>{
  await page.locator('#motionPreset').selectOption('still');
  await page.locator('#contour-joint-1').selectOption('pip');
  const before=await snapshot(page),canvas=page.locator('#contour-1');
  await canvas.scrollIntoViewIfNeeded();const rect=await canvas.boundingBox();
  await page.mouse.move(rect.x+rect.width*2/16,rect.y+rect.height*.2);await page.mouse.down();
  const pointerId=await canvas.evaluate(canvas=>[1,2,3].find(id=>canvas.hasPointerCapture(id)));
  expect(pointerId).toBeDefined();
  await page.mouse.move(rect.x+rect.width*14/16,rect.y+rect.height*.8,{steps:1});
  const drawn=await snapshot(page),curve=drawn.config.motion.edits.fingers[1].pip;
  expect(drawn.config.motion.custom).toBe(false);await expect(page.locator('#motionPreset')).toHaveValue('still');
  expect(drawn.config.motion.contours).toEqual(before.config.motion.contours);
  expect(curve[2]-curve[14]).toBeGreaterThan(.5);
  for(let point=3;point<14;point++)expect(curve[point]).toBeCloseTo(curve[2]+(curve[14]-curve[2])*(point-2)/12,8);
  for(let finger=0;finger<5;finger++)for(const joint of ['mcp','pip','dip','spread']) {
    if(finger!==1||joint!=='pip')expect(drawn.config.motion.edits.fingers?.[finger]?.[joint]).toEqual(before.config.motion.edits.fingers?.[finger]?.[joint]);
  }
  await page.mouse.move(rect.x+rect.width+20,rect.y+rect.height*.5);
  await canvas.dispatchEvent('pointercancel',{pointerId});await page.mouse.up();
  expect(await canvas.evaluate((canvas,id)=>canvas.hasPointerCapture(id),pointerId)).toBe(false);
  await expect(page.locator('#contourUndo')).toBeEnabled();await page.locator('#contourUndo').click();
  expect((await snapshot(page)).config.motion).toEqual(before.config.motion);await expect(page.locator('#contourUndo')).toBeDisabled();
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
});

test('contour keyboard edits and animation save/load preserve each joint and keep Audio off',async({page})=>{
  await page.locator('#motionPreset').selectOption('still');await page.locator('#contour-joint-2').selectOption('spread');
  const canvas=page.locator('#contour-2');await canvas.scrollIntoViewIfNeeded();await canvas.focus();
  await canvas.press('ArrowRight');await canvas.press('ArrowUp');await canvas.press('Shift+ArrowUp');
  const edited=await snapshot(page),curve=edited.config.motion.edits.fingers[2].spread;
  expect(curve[1]).toBeCloseTo(.125,8);expect(curve.filter(value=>value!==0)).toHaveLength(1);
  expect(edited.config.motion.edits.fingers[2].mcp).toBeUndefined();
  await expect(canvas).toHaveAttribute('aria-valuetext',/Point 2 of 16/);
  await range(page,'tempo',143.2);await range(page,'tremorAmount',4.2);await range(page,'tremorRate',17.3);
  await page.locator('#rhythm').selectOption('broken');await range(page,'note-length',.62);
  const saved=await snapshot(page),downloadPromise=page.waitForEvent('download');await page.locator('#saveMotion').click();
  const download=await downloadPromise;expect(download.suggestedFilename()).toBe('gesticules-animation.json');
  const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
  const bytes=Buffer.concat(chunks),animation=JSON.parse(bytes.toString());
  expect(animation.type).toBe('gesticules-animation');expect(animation.version).toBe(2);
  expect(animation.tremor).toEqual(saved.config.tremor);
  expect(animation.sound).toEqual({rhythm:saved.config.sound.rhythm,noteLength:saved.config.sound.noteLength});
  expect(animation.motion).toEqual(saved.config.motion);expect(animation.pose).toEqual(saved.config.pose);
  await page.locator('#contour-clear-2').click();expect((await snapshot(page)).config.motion.edits.fingers?.[2]?.spread).toBeUndefined();
  await page.locator('#bodyForm').selectOption('foot');await page.waitForFunction(()=>window.__gesticulatingHand.snapshot().viewer.form==='foot');
  await range(page,'tempo',4400);await range(page,'tremorAmount',0);await page.locator('#rhythm').selectOption('continuous');
  await page.locator('#motionFile').setInputFiles({name:'gesture.json',mimeType:'application/json',buffer:bytes});
  await page.waitForFunction(()=>window.__gesticulatingHand.snapshot().viewer.form==='hand');
  await expect(page.locator('#liveStatus')).toHaveText('Animation loaded.');
  const restored=await snapshot(page);expect(restored.config.motion).toEqual(saved.config.motion);expect(restored.config.pose).toEqual(saved.config.pose);
  expect(restored.config.tremor).toEqual(saved.config.tremor);
  expect(restored.config.sound.rhythm).toBe(saved.config.sound.rhythm);expect(restored.config.sound.noteLength).toBe(saved.config.sound.noteLength);
  expect(restored.config.form).toBe(saved.config.form);expect(restored.audio.contextState).toBe('uninitialized');expect(restored.audioOn).toBe(false);
  await expect(page.locator('#contourUndo')).toBeDisabled();await expect(page.locator('#tempo')).toHaveValue('143.2');
});

test('desktop shows the hand, all five digit lanes and wrist together',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const layout=await page.evaluate(()=>({
    height:innerHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    hand:document.querySelector('#handCanvas').getBoundingClientRect().toJSON(),
    rows:[...document.querySelectorAll('.hand-voice:not([hidden])')].map(row=>({
      bounds:row.getBoundingClientRect().toJSON(),curve:row.querySelector('.hand-contour').getBoundingClientRect().toJSON(),
    })),
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);expect(layout.hand.top).toBeGreaterThanOrEqual(0);
  expect(layout.hand.height).toBeGreaterThanOrEqual(280);expect(layout.rows).toHaveLength(6);
  for(const row of layout.rows) {
    expect(row.bounds.top).toBeGreaterThanOrEqual(layout.hand.bottom);
    expect(row.bounds.bottom).toBeLessThanOrEqual(layout.height);
    expect(row.curve.width).toBeGreaterThan(300);expect(row.curve.height).toBeGreaterThanOrEqual(38);
  }
});

async function drawUndoContour(page,finger=1) {
  const canvas=page.locator(`#contour-${finger}`);await canvas.scrollIntoViewIfNeeded();
  const rect=await canvas.boundingBox();
  await page.mouse.move(rect.x+rect.width*.2,rect.y+rect.height*.2);await page.mouse.down();
  await page.mouse.move(rect.x+rect.width*.8,rect.y+rect.height*.8,{steps:1});await page.mouse.up();
  await expect(page.locator('#contourUndo')).toBeEnabled();
}

for(const form of ['hand','foot']) {
  test(`contour Undo preserves later tempo and movement controls for ${form}`,async({page})=>{
    if(form==='foot') {
      await page.locator('#bodyForm').selectOption('foot');await page.waitForFunction(()=>window.__gesticulatingHand.snapshot().viewer.form==='foot');
    }
    await page.locator('#motionPreset').selectOption('still');const before=await snapshot(page);
    await drawUndoContour(page);expect((await snapshot(page)).config.motion.custom).toBe(false);
    expect(Object.keys((await snapshot(page)).config.motion.edits).length).toBeGreaterThan(0);
    await range(page,'tempo',317.6);await range(page,'motionAmount',.37);
    if(form==='foot')await range(page,'footElasticity',.64);
    await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();
    const latest=await snapshot(page);await page.locator('#contourUndo').click();const restored=await snapshot(page);
    expect(restored.config.motion).toEqual({...latest.config.motion,edits:before.config.motion.edits});
    expect(restored.config.motion.tempo*restored.config.motion.speed).toBeCloseTo(317.6,8);
    await expect(page.locator('#tempo')).toHaveValue('317.6');await expect(page.locator('#motionAmount')).toHaveValue('0.37');
    if(form==='foot')await expect(page.locator('#footElasticity')).toHaveValue('0.64');
    expect(restored.playing&&restored.soundPlaying).toBe(true);expect(restored.audio.contextState).toBe('uninitialized');
    await expect(page.locator('#contourUndo')).toBeDisabled();
  });
}

test('presets, form switches and choreography changes clear prior contour Undo history',async({page})=>{
  const assertHistoryCleared=async()=>{
    await expect(page.locator('#contourUndo')).toBeDisabled();const current=(await snapshot(page)).config;
    // A stale stack must not be recoverable even through a dispatched event.
    await page.locator('#contourUndo').dispatchEvent('click');expect((await snapshot(page)).config).toEqual(current);
    expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
  };
  await drawUndoContour(page);await chooseScene(page,'Crystal staccato');
  expect((await snapshot(page)).config.form).toBe('hand');await assertHistoryCleared();
  for(const form of ['foot','hand']) {
    await drawUndoContour(page);await page.locator('#bodyForm').selectOption(form);
    await page.waitForFunction(form=>window.__gesticulatingHand.snapshot().viewer.form===form,form);
    expect((await snapshot(page)).config.form).toBe(form);await assertHistoryCleared();
  }
  await drawUndoContour(page);await page.locator('#motionPreset').selectOption('wave');
  expect((await snapshot(page)).config.motion.id).toBe('wave');expect((await snapshot(page)).config.motion.custom).toBe(false);
  await assertHistoryCleared();
});

for (const form of ['hand', 'foot']) {
  test(`loaded ${form} animation shows every joint including body lanes, with isolated body edits`, async ({page}) => {
    if (form === 'foot') {
      await page.locator('#bodyForm').selectOption('foot');
      await page.waitForFunction(() => window.__gesticulatingHand.snapshot().loaded && window.__gesticulatingHand.snapshot().viewer.form === 'foot');
    }
    await page.locator('#motionPreset').selectOption('still');
    await range(page, 'motionAmount', 0); await range(page, 'tremorAmount', 0);
    const original = await snapshot(page);
    await expect(page.locator('.hand-voice:visible')).toHaveCount(form === 'foot' ? 7 : 6);
    await expect(page.locator('#body-lane-5')).toHaveText(form === 'foot' ? 'Ankle' : 'Wrist');
    if (form === 'foot') await expect(page.locator('#contour-joint-0 option[value="pip"]')).toHaveCount(0);
    for (const [index, group, joints] of [[5, 'wrist', ['flex', 'side', 'twist']], ...(form === 'foot' ? [[6, 'foot', ['arch', 'twist', 'stretch']]] : [])]) {
      const canvas = page.locator(`#contour-${index}`);
      for (const joint of joints) {
        await page.locator(`#contour-joint-${index}`).selectOption(joint);
        await expect.poll(async () => Number(await canvas.getAttribute('aria-valuenow'))).toBeCloseTo(original.pose[group][joint], 3);
        await expect(page.locator(`#contour-value-${index}`)).toHaveText(joint === 'stretch' ? `${Math.round(original.pose[group][joint] * 100)}%` : `${Math.round(original.pose[group][joint])}°`);
        await canvas.focus(); await canvas.press('ArrowUp');
        const edited = await snapshot(page);
        expect(edited.config.motion.id).toBe('still'); expect(edited.config.motion.custom).toBe(false);
        expect(edited.config.motion.amount).toBe(0); expect(edited.config.motion.contours).toEqual(original.config.motion.contours);
        expect(edited.config.motion.edits[group][joint][0]).toBeCloseTo(.025, 8);
        expect(edited.pose[group][joint]).toBeGreaterThan(original.pose[group][joint]);
        expect(edited.pose.fingers).toEqual(original.pose.fingers);
        await page.locator(`#contour-clear-${index}`).click();
        const reset = await snapshot(page);
        expect(reset.config.motion).toEqual(original.config.motion); expect(reset.pose).toEqual(original.pose);
      }
    }
    expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
  });
}

test('legacy animation files retain their four-beat curves without replacing current tremor or sound', async ({page}) => {
  const legacy = await page.evaluate(async () => {
    const {normalizeHandConfig} = await import('/src/instruments/gesticulating-hand/hand-model.js');
    const config = normalizeHandConfig({motion:{id:'wave',custom:true,tempo:96}});
    config.motion.contours[1].pip[4] = .31;
    delete config.motion.edits;
    return {type:'gesticules-animation',version:1,form:config.form,pose:config.pose,motion:config.motion};
  });
  await range(page, 'tremorAmount', 3.4); await page.locator('#rhythm').selectOption('broken');
  const before = await snapshot(page);
  await page.locator('#motionFile').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
  await expect(page.locator('#liveStatus')).toHaveText('Animation loaded.');
  const loaded = await snapshot(page);
  expect(loaded.config.motion.custom).toBe(true); expect(loaded.config.motion.contours[1].pip[4]).toBe(.31);
  expect(loaded.config.motion.edits).toEqual({}); expect(loaded.config.tremor).toEqual(before.config.tremor);
  expect(loaded.config.sound).toEqual(before.config.sound); expect(loaded.config.voices).toEqual(before.config.voices);
  expect(loaded.audio.contextState).toBe('uninitialized');
});
