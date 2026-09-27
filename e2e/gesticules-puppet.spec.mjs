import {test,expect} from '@playwright/test';
const snapshot=page=>page.evaluate(()=>window.__gesticulatingHand.snapshot());
const range=(page,id,value)=>page.locator('#'+id).evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);
const choose=async page=>{await page.locator('.header-preset-picker summary').click();await page.getByRole('button',{name:'Puppet mouth',exact:true}).click();await page.waitForFunction(()=>window.__gesticulatingHand.snapshot().loaded);};
test.beforeEach(async({page})=>{page.puppetErrors=[];page.on('pageerror',e=>page.puppetErrors.push(e.message));await page.goto('gesticules.html');await page.waitForFunction(()=>window.__gesticulatingHand?.snapshot().loaded);});
test.afterEach(async({page})=>expect(page.puppetErrors).toEqual([]));

for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}])test(`puppet jaws close and open visibly with reachable controls at ${viewport.width}x${viewport.height}`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);await page.locator('#posePreset').selectOption('fist');await page.locator('#motionPreset').selectOption('puppet-mouth');
  await expect(page.locator('#posePreset')).toHaveValue('puppet-mouth');
  await choose(page);const saved=await snapshot(page);expect(saved.audio.contextState).toBe('uninitialized');
  expect(saved.config.voices.some(v=>v.source==='vowel')).toBe(true);expect(saved.config.voices.some(v=>v.source==='choir')).toBe(true);
  const geometry=await page.evaluate(async()=>{
    const {createHandViewer}=await import('/src/instruments/gesticulating-hand/hand-viewer.js');
    const {evaluateHandPose,handMotionPeriod}=await import('/src/instruments/gesticulating-hand/hand-model.js');
    const config=window.__gesticulatingHand.snapshot().config,box=document.querySelector('#handCanvas').getBoundingClientRect(),canvas=document.createElement('canvas');
    canvas.id='puppetTestCanvas';canvas.style.cssText=`position:fixed;left:0;top:0;z-index:999;width:${box.width}px;height:${box.height}px`;document.body.append(canvas);
    let viewer;await new Promise(resolve=>{viewer=createHandViewer(canvas,{onReady:resolve});});viewer.setCameraView(config.view);viewer.setAppearance(config.appearance);viewer.setShowJoints(false);
    const states=[],period=handMotionPeriod(config.motion);
    for(let step=0;step<32;step++){viewer.setPose(evaluateHandPose(config,period*step/32));states.push(viewer.getState());}
    window.puppetTest={viewer,config,period,evaluateHandPose};return states;
  });
  const gap=s=>{const tips=s.fingertips,center=[0,1].map(axis=>tips.slice(1).reduce((sum,p)=>sum+p[axis],0)/4);return Math.hypot(...center.map((v,axis)=>v-tips[0][axis]));};
  expect(gap(geometry[8])).toBeGreaterThan(gap(geometry[24])*5);expect(gap(geometry[8])-gap(geometry[24])).toBeGreaterThan(.2);
  for(const s of geometry)for(const p of [...s.fingertips,...s.markers.map(m=>m.screen)])for(const axis of [0,1])expect(Math.abs(p[axis])).toBeLessThan(.97);
  for(const [name,fraction]of [['open',.25],['closed',.75]]){
    await page.evaluate(fraction=>{const {viewer,config,period,evaluateHandPose}=window.puppetTest;viewer.setPose(evaluateHandPose(config,period*fraction));viewer.render();},fraction);
    await page.locator('#puppetTestCanvas').screenshot({path:testInfo.outputPath(name+'.png')});
  }
  await page.evaluate(()=>{window.puppetTest.viewer.dispose();document.querySelector('#puppetTestCanvas').remove();delete window.puppetTest;});
  await range(page,'outputLevel',.23);await range(page,'skin',.81);await range(page,'lighting',.4);await range(page,'tempo',420);await page.locator('[data-view="back"]').click();
  await page.locator('#bodyForm').selectOption('foot');await page.waitForFunction(()=>window.__gesticulatingHand.snapshot().loaded);
  await page.locator('#motionPreset').selectOption('puppet-mouth');await expect(page.locator('#posePreset')).toHaveValue('puppet-mouth');
  expect((await snapshot(page)).pose.fingers[0].pip).toBe(0);
  await choose(page);expect((await snapshot(page)).config).toEqual(saved.config);await expect(page.locator('#outputLevel')).toHaveValue('0.23');
  await page.locator('#pitchSpread').scrollIntoViewIfNeeded();await expect(page.locator('#pitchSpread')).toBeVisible();
  const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,canvas:document.querySelector('#handCanvas').getBoundingClientRect().toJSON()}));
  expect(layout.scroll).toBeLessThanOrEqual(layout.width+1);if(viewport.width<960){expect(layout.canvas.top).toBeGreaterThanOrEqual(0);expect(layout.canvas.bottom).toBeLessThanOrEqual(viewport.height);}
});

test('puppet playback stays audible and editable through tempo changes and preset recall',async({page})=>{
  await choose(page);await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();expect((await snapshot(page)).audioOn).toBe(false);
  await page.locator('#audioButton').click();await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeGreaterThan(.001);
  const before=await snapshot(page);await expect.poll(async()=>(await snapshot(page)).pose.fingers[1].mcp).not.toBeCloseTo(before.pose.fingers[1].mcp,1);
  await page.locator('#fingerTabs [data-finger="1"]').click();await range(page,'joint-mcp',25);
  expect((await snapshot(page)).config.pose.fingers[1].mcp).toBe(25);expect((await snapshot(page)).config.motion).toEqual(before.config.motion);
  for(const tempo of [4400,2,64]){await range(page,'tempo',tempo);await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeGreaterThan(.001);const s=await snapshot(page);expect(s.playing&&s.soundPlaying&&s.audioOn).toBe(true);expect(s.audio.peak).toBeLessThan(.9);}
  await choose(page);expect((await snapshot(page)).config).toEqual(before.config);
  await page.locator('#motionButton').click();const paused=(await snapshot(page)).pose;await page.waitForTimeout(100);expect((await snapshot(page)).pose).toEqual(paused);
  await page.locator('#audioButton').click();await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeLessThan(.0001);
});
