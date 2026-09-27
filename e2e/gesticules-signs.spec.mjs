import {test,expect} from '@playwright/test';
const signs=[['middle-finger','Middle finger',[false,false,true,false,false]],['hang-loose','Hang loose',[true,false,false,false,true]],['i-love-you','I love you',[true,true,false,false,true]],['rock-and-roll','Rock and roll',[false,true,false,false,true]],['vulcan-salute','Vulcan salute',[true,true,true,true,true]]];
const snapshot=page=>page.evaluate(()=>window.__gesticulatingHand.snapshot());
const range=(page,id,value)=>page.locator('#'+id).evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);
const choose=async(page,label)=>{await page.locator('.header-preset-picker summary').click();await page.getByRole('button',{name:label,exact:true}).click();await page.waitForFunction(()=>window.__gesticulatingHand.snapshot().loaded);};
function checkSign(pose,mask){for(let i=0;i<5;i++){const f=pose.fingers[i],bend=f.mcp+f.pip+f.dip;if(mask[i])expect(bend).toBeLessThan(30);else expect(bend).toBeGreaterThan(110);}}
function checkVulcan(viewer){const x=viewer.fingertips.map(p=>p[0]),gap=Math.abs(x[2]-x[3]);expect(gap).toBeGreaterThan(2*Math.abs(x[1]-x[2]));expect(gap).toBeGreaterThan(2*Math.abs(x[3]-x[4]));}
test.beforeEach(async({page})=>{page.signErrors=[];page.on('pageerror',e=>page.signErrors.push(e.message));await page.goto('gesticules.html');await page.waitForFunction(()=>window.__gesticulatingHand?.snapshot().loaded);});
test.afterEach(async({page})=>expect(page.signErrors).toEqual([]));

test('five signs work as static poses and complete presets with distinctive thumbs and a real Vulcan split',async({page},testInfo)=>{
  await range(page,'outputLevel',.23);
  for(const [id,label,mask]of signs){
    await page.locator('#motionPreset').selectOption('still');await page.locator('#posePreset').selectOption(id);checkSign((await snapshot(page)).pose,mask);
    await choose(page,label);const saved=await snapshot(page);checkSign(saved.pose,mask);expect(saved.config.motion.id).toBe(id);expect(saved.audio.contextState).toBe('uninitialized');
    await page.waitForTimeout(80);if(id==='vulcan-salute')checkVulcan((await snapshot(page)).viewer);
    await page.locator('#handCanvas').screenshot({path:testInfo.outputPath(id+'.png')});
    await range(page,'skin',.123);await range(page,'lighting',.456);await range(page,'pitchSpread',3.21);await range(page,'tempo',321);
    await page.locator('#bodyForm').selectOption('foot');await page.waitForFunction(()=>window.__gesticulatingHand.snapshot().loaded);
    await choose(page,label);expect((await snapshot(page)).config).toEqual(saved.config);await expect(page.locator('#outputLevel')).toHaveValue('0.23');
  }
});

test('choosing a sign movement loads an editable matching pose for hands and feet',async({page})=>{
  for(const form of ['hand','foot']){
    await page.locator('#bodyForm').selectOption(form);await page.waitForFunction(()=>window.__gesticulatingHand.snapshot().loaded);
    for(const [id,,mask]of signs){
      await page.locator('#posePreset').selectOption('fist');
      const before=await snapshot(page);await page.locator('#motionPreset').selectOption(id);
      let state=await snapshot(page);expect(state.config.motion.id).toBe(id);
      await expect(page.locator('#posePreset')).toHaveValue(id);
      if(form==='hand')checkSign(state.pose,mask);
      expect(state.config.sound).toEqual(before.config.sound);expect(state.config.view).toEqual(before.config.view);
      await page.locator('#fingerTabs [data-finger="1"]').click();
      for(const value of [0,20,30]){
        await range(page,'joint-mcp',value);state=await snapshot(page);
        expect(state.pose.fingers[1].mcp).toBeCloseTo(value,8);
        expect(state.config.motion.id).toBe(id);
      }
      expect(state.audio.contextState).toBe('uninitialized');
    }
  }
});

test('gesture recall, live joint edits and tempo preserve active audio and motion',async({page})=>{
  await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();expect((await snapshot(page)).audioOn).toBe(false);
  await page.locator('#audioButton').click();await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeGreaterThan(.001);
  for(const [id,label,mask]of signs){
    await choose(page,label);let state=await snapshot(page);checkSign(state.pose,mask);expect(state.playing&&state.soundPlaying&&state.audioOn).toBe(true);
    const before=state.time;await expect.poll(async()=>(await snapshot(page)).time).toBeGreaterThan(before+.03);
    await page.locator('#fingerTabs [data-finger="2"]').click();await range(page,'joint-mcp',3);
    expect((await snapshot(page)).config.motion).toEqual(state.config.motion);expect((await snapshot(page)).config.pose.fingers[2].mcp).toBe(3);
    await range(page,'tempo',240);await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeGreaterThan(.001);
    state=await snapshot(page);expect(state.playing&&state.soundPlaying&&state.audioOn).toBe(true);expect(state.audio.peak).toBeLessThan(.9);
  }
  await page.locator('#audioButton').click();await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeLessThan(.0001);
});

for(const viewport of [{width:390,height:844},{width:844,height:390}])test(`gesture presets remain visible and reachable at ${viewport.width}×${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport);
  for(const [id,label,mask]of signs){
    await choose(page,label);await page.waitForTimeout(70);const state=await snapshot(page);checkSign(state.pose,mask);
    for(const point of [...state.viewer.fingertips,...state.viewer.markers.map(m=>m.screen)])for(const axis of [0,1])expect(Math.abs(point[axis])).toBeLessThan(.97);
    if(id==='vulcan-salute')checkVulcan(state.viewer);
    await page.locator('#pitchSpread').scrollIntoViewIfNeeded();await expect(page.locator('#pitchSpread')).toBeVisible();
    const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,canvas:document.querySelector('#handCanvas').getBoundingClientRect().toJSON()}));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width+1);expect(geometry.canvas.top).toBeGreaterThanOrEqual(0);expect(geometry.canvas.bottom).toBeLessThanOrEqual(viewport.height);
    expect(state.audio.contextState).toBe('uninitialized');
  }
});
