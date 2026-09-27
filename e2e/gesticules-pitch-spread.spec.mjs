import { test, expect } from '@playwright/test';

const snapshot=page=>page.evaluate(()=>window.__gesticulatingHand.snapshot());
const range=(page,value)=>page.locator('#pitchSpread').evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);
const chooseScene=async(page,label)=>{await page.locator('.header-preset-picker summary').click();await page.getByRole('button',{name:label,exact:true}).click();await page.waitForFunction(()=>window.__gesticulatingHand.snapshot().loaded);};
test.beforeEach(async({page})=>{
  page.handErrors=[];page.on('pageerror',error=>page.handErrors.push(error.message));
  await page.goto('gesticules.html');await page.waitForFunction(()=>window.__gesticulatingHand?.snapshot().loaded);
});
test.afterEach(async({page})=>expect(page.handErrors).toEqual([]));

test('Pitch spread supports native keyboard input and full-state recall in both forms',async({page})=>{
  const slider=page.getByRole('slider',{name:/^Pitch spread/});
  await expect(slider).toHaveValue('1');await expect(slider).toHaveAttribute('min','0');await expect(slider).toHaveAttribute('max','4');
  await slider.focus();await page.keyboard.press('Home');await expect(slider).toHaveValue('0');await expect(page.locator('#pitchSpreadOut')).toHaveText('0%');
  await page.keyboard.press('End');await expect(slider).toHaveValue('4');await expect(page.locator('#pitchSpreadOut')).toHaveText('400%');
  for(const [label,value] of [['Lingering choir',.3],['Marimba footprints',2.25],['Finger loom',1]]){
    await chooseScene(page,label);const saved=await snapshot(page);
    expect(saved.config.sound.pitchSpread).toBe(value);await expect(slider).toHaveValue(String(value));
    await range(page,2.37);await expect(page.locator('#pitchSpreadOut')).toHaveText('237%');
    const captured=await page.evaluate(async()=>{const{captureHeaderPresetState}=await import('/src/site/header-presets.js');return captureHeaderPresetState();});
    expect(captured.selectedId).toBeNull();expect(captured.snapshot.sound.pitchSpread).toBe(2.37);
    await page.locator('#bodyForm').selectOption(saved.config.form==='hand'?'foot':'hand');await page.waitForFunction(()=>window.__gesticulatingHand.snapshot().loaded);
    expect((await snapshot(page)).config.sound.pitchSpread).toBe(2.37);
    await chooseScene(page,label);expect((await snapshot(page)).config).toEqual(saved.config);
    expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
  }
  const values=[];
  for(let i=0;i<3;i++){
    await page.getByRole('button',{name:'Randomize instrument parameters',exact:true}).click();
    const value=(await snapshot(page)).config.sound.pitchSpread;values.push(value);
    expect(value).toBeGreaterThanOrEqual(0);expect(value).toBeLessThanOrEqual(4);
    expect(Number(await slider.inputValue())).toBeCloseTo(value,2);
  }
  expect(new Set(values).size).toBeGreaterThan(1);expect((await snapshot(page)).audioOn).toBe(false);
});

test('live spread changes preserve pose timeline, register, Sound and Motion with real audio',async({page})=>{
  await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();
  await range(page,4);expect((await snapshot(page)).audioOn).toBe(false);
  await page.locator('#audioButton').click();await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeGreaterThan(.001);
  for(const playing of [true,false]){
    if(!playing)await page.locator('#motionButton').click();
    for(const value of [0,4,1.23]){
      const result=await page.evaluate(async value=>{
        const{evaluateHandPose}=await import('/src/instruments/gesticulating-hand/hand-model.js');
        const before=window.__gesticulatingHand.snapshot(),input=document.querySelector('#pitchSpread');
        input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
        const after=window.__gesticulatingHand.snapshot();
        return {before,after,expectedPose:evaluateHandPose(before.config,after.time,undefined,after.tremorTime)};
      },value);
      expect(result.after.config.sound.pitchSpread).toBe(value);expect(result.after.pose).toEqual(result.expectedPose);
      expect(result.after.config.sound.rootHz).toBe(result.before.config.sound.rootHz);
      expect(result.after.playing).toBe(playing);expect(result.after.soundPlaying).toBe(true);expect(result.after.audioOn).toBe(true);
      if(!playing)expect(result.after.time).toBe(result.before.time);
      await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeGreaterThan(.001);
      expect((await snapshot(page)).audio.peak).toBeLessThanOrEqual(.9);
    }
  }
  await page.locator('#audioButton').click();await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeLessThan(.0001);
  expect((await snapshot(page)).soundPlaying).toBe(true);
});

for(const viewport of [{width:390,height:844},{width:844,height:390}])test(`Pitch spread remains reachable below the sticky model at ${viewport.width}×${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport);
  for(const form of ['hand','foot']){
    await page.locator('#bodyForm').selectOption(form);await page.waitForFunction(()=>window.__gesticulatingHand.snapshot().loaded);
    const slider=page.locator('#pitchSpread');await slider.scrollIntoViewIfNeeded();await expect(slider).toBeVisible();
    const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,canvas:document.querySelector('#handCanvas').getBoundingClientRect().toJSON(),slider:document.querySelector('#pitchSpread').getBoundingClientRect().toJSON()}));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width+1);expect(geometry.slider.width).toBeGreaterThan(120);
    expect(geometry.canvas.bottom).toBeLessThanOrEqual(viewport.height+1);expect(geometry.canvas.top).toBeGreaterThanOrEqual(0);
    await slider.focus();await page.keyboard.press('End');await expect(slider).toHaveValue('4');expect((await snapshot(page)).config.sound.pitchSpread).toBe(4);
    expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
  }
});
