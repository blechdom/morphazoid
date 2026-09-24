import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readAudioStatus } from './helpers/audio-probe.mjs';

const snapshot=page=>page.evaluate(()=>window.__gesticulatingHand.snapshot());
const range=(page,id,value)=>page.locator('#'+id).evaluate((input,value)=>{
  input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
},value);
test.beforeEach(async({page})=>{
  page.handErrors=[];page.on('pageerror',error=>page.handErrors.push(error.message));
  await page.goto('gesticulating-hand.html');
  await page.waitForFunction(()=>window.__gesticulatingHand?.snapshot().loaded,{},{timeout:15000});
});
test.afterEach(async({page})=>expect(page.handErrors).toEqual([]));

test('loads the real weighted hand and starts with no AudioContext',async({page})=>{
  const state=await snapshot(page);
  expect(state.viewer.boneCount).toBe(22);expect(state.viewer.triangles).toBe(28994);
  expect(state.audio.contextState).toBe('uninitialized');expect(state.audioOn).toBe(false);
  expect(state.config.motion.id).toBe('source-grasp');expect(state.pose.source.amount).toBe(.85);
  expect(await page.locator('#posePreset').inputValue()).toBe('source-open');
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

for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
  test(`controls and fingertips fit ${viewport.width}×${viewport.height}`,async({page})=>{
    await page.setViewportSize(viewport);await page.waitForTimeout(100);
    const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,canvas:document.querySelector('#handCanvas').getBoundingClientRect().toJSON()}));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.width+1);expect(sizes.canvas.width).toBeGreaterThan(250);expect(sizes.canvas.height).toBeGreaterThan(300);
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
