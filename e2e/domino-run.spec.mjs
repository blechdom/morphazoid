import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const open = async page => { await page.goto('domino-run.html'); await page.waitForFunction(() => Boolean(window.dominoRun)); };
const range = async (page,id,value) => {
  await page.locator(`#${id}`).evaluate((input,v) => {input.value=String(v);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},value);
  await page.waitForTimeout(100);
};
const preset = async (page,id) => {
  await page.locator('.header-preset-picker summary').click();
  await page.locator(`#header-preset-panel button[data-preset-id="${id}"]`).click();
};

test('silent transport, complete presets, randomization and recovery',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
  expect(await page.evaluate(()=>window.dominoRun.audio.state)).toBe('uninitialized');
  await page.locator('#playButton').click();
  await expect.poll(()=>page.evaluate(()=>window.dominoRun.time)).toBeGreaterThan(.15);
  expect(await page.evaluate(()=>window.dominoRun.audio.armed)).toBe(false);
  await range(page,'level',.27);
  const ids=await page.locator('#header-preset-panel button[data-preset-id]').evaluateAll(bs=>bs.map(b=>b.dataset.presetId));
  expect(ids.length).toBeGreaterThanOrEqual(12);
  for(const id of ids){
    await preset(page,id);
    expect(await page.evaluate(()=>window.dominoRun.playing)).toBe(true);
    expect(await page.evaluate(()=>window.dominoRun.timeline.falls.length)).toBeGreaterThan(10);
  }
  const before=await page.evaluate(()=>window.dominoRun.snapshot);
  await page.locator('#newRun').click();
  expect(await page.evaluate(()=>window.dominoRun.snapshot)).not.toEqual(before);
  expect(await page.locator('#level').inputValue()).toBe('0.27');
  expect(await page.evaluate(()=>window.dominoRun.playing)).toBe(true);
  expect(await page.evaluate(()=>window.dominoRun.audio.armed)).toBe(false);
  await page.locator('#stage').focus();await page.keyboard.press('Space');
  expect(await page.evaluate(()=>window.dominoRun.playing)).toBe(false);
  await page.locator('#resetAll').click();
  expect(await page.evaluate(()=>window.dominoRun.snapshot.params.layout)).toBe('henge');
  expect(await page.evaluate(()=>window.dominoRun.snapshot.params.material)).toBe('stone');
  expect(errors).toEqual([]);
});

test('real gaps interrupt propagation, and manual edits are recoverable',async({page})=>{
  await open(page);await page.locator('#layout').selectOption('serpentine');await range(page,'count',40);
  await range(page,'spacing',1.35);
  expect(await page.evaluate(()=>window.dominoRun.timeline.falls.length)).toBeLessThan(40);
  await range(page,'spacing',.54);
  expect(await page.evaluate(()=>window.dominoRun.timeline.falls.length)).toBe(40);
  await page.locator('[data-mode="arrange"]').click();
  await page.locator('#stage').focus();
  const before=await page.evaluate(()=>window.dominoRun.run.dominoes[0].x);
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(()=>window.dominoRun.run.dominoes[0].x)).toBeGreaterThan(before);
  await page.locator('.group summary').filter({hasText:'Selected domino'}).click();
  await page.locator('#undoEdit').click();
  expect(await page.evaluate(()=>window.dominoRun.run.dominoes[0].x)).toBeCloseTo(before,8);
  await page.locator('#removeSelected').click();
  expect(await page.evaluate(()=>window.dominoRun.run.dominoes[0].enabled)).toBe(false);
  expect(await page.evaluate(()=>window.dominoRun.timeline.falls.length)).toBe(0);
  await page.locator('#removeSelected').click();
  expect(await page.evaluate(()=>window.dominoRun.timeline.falls.length)).toBe(40);
});

test('worklet produces bounded sound, advances through a UI stall and mutes cleanly',async({page},testInfo)=>{
  await open(page);expect((await readAudioStatus(page)).active).toBe(false);
  await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  await page.locator('#playButton').click();
  const envelope=await sampleAudioEnvelope(page,{durationMs:1400,intervalMs:60});
  await testInfo.attach('domino-audio.json',{body:JSON.stringify(envelope),contentType:'application/json'});
  expect(envelope.summary.finite).toBe(true);expect(envelope.summary.maxPeak).toBeGreaterThan(.001);expect(envelope.summary.clippedSamples).toBe(0);
  const played=await page.evaluate(()=>window.dominoRun.audio.played);
  await page.evaluate(()=>{const end=performance.now()+650;while(performance.now()<end){/* deliberate rendering/UI stall */}});
  await expect.poll(()=>page.evaluate(()=>window.dominoRun.audio.played)).toBeGreaterThan(played);
  expect(await page.evaluate(()=>window.dominoRun.audio.dropped)).toBe(0);
  const times=await page.evaluate(async()=>{const values=[];for(let i=0;i<8;i++){values.push(window.dominoRun.time);const input=document.querySelector('#brightness');input.value=String(.2+i*.08);input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,12));}return values;});
  for(let i=1;i<times.length;i++)expect(times[i]).toBeGreaterThanOrEqual(times[i-1]-.001);
  await range(page,'level',0);const quiet=await sampleAudioEnvelope(page,{durationMs:300,intervalMs:50});expect(quiet.summary.maxPeak).toBeLessThan(.001);
  await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(()=>window.dominoRun.playing)).toBe(true);
  await page.locator('#playButton').click();
  const time=await page.evaluate(()=>window.dominoRun.time);await page.waitForTimeout(180);
  expect(await page.evaluate(()=>window.dominoRun.time)).toBeCloseTo(time,3);
});

test('MIDI note/velocity and transport use domino actions without fallback output',async({page})=>{
  await open(page);
  const send=message=>page.evaluate(m=>{const e=new CustomEvent('morphazoid:midi-input',{cancelable:true,detail:{message:m,source:'test'}});window.dispatchEvent(e);return e.defaultPrevented;},message);
  expect(await send({type:'noteOn',note:7,velocity:100})).toBe(true);
  expect(await page.evaluate(()=>window.dominoRun.timeline.falls[0].id)).toBe(7);
  expect(await page.evaluate(()=>window.dominoRun.audio.armed)).toBe(false);
  expect(await send({type:'noteOff',note:7})).toBe(true);
  expect(await page.evaluate(()=>window.dominoRun.playing)).toBe(true);
  await page.locator('[data-mode="arrange"]').click();await page.locator('#stage').focus();await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(()=>window.dominoRun.timeline.falls[0].id)).toBe(7);
  await send({type:'controlChange',controller:7,value:32});expect(Number(await page.locator('#level').inputValue())).toBeCloseTo(32/127,2);
  await send({type:'stop'});expect(await page.evaluate(()=>window.dominoRun.playing)).toBe(false);
  await send({type:'continue'});expect(await page.evaluate(()=>window.dominoRun.playing)).toBe(true);
  await send({type:'controlChange',controller:123,value:0});expect(await page.evaluate(()=>window.dominoRun.playing)).toBe(false);
});

for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
  test(`reachable controls and canvas at ${viewport.width}x${viewport.height}`,async({page})=>{
    await page.setViewportSize(viewport);await open(page);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    const box=await page.locator('#stage').boundingBox();expect(box.width).toBeGreaterThan(250);expect(box.height).toBeGreaterThan(250);
    await page.locator('#newRun').scrollIntoViewIfNeeded();await page.locator('#newRun').click();
    await page.locator('#resetAll').scrollIntoViewIfNeeded();await page.locator('#resetAll').click();
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const target=await page.evaluate(()=>window.dominoRun.targets.find(t=>t.id===0));
    await page.locator('#stage').click({position:{x:target.x,y:target.y}});
    expect(await page.evaluate(()=>window.dominoRun.playing)).toBe(true);
  });
}

test('new instrument controls have no serious accessibility violations',async({page})=>{
  await open(page);
  const result=await new AxeBuilder({page}).include('.domino-shell').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(result.violations.filter(v=>['critical','serious'].includes(v.impact))).toEqual([]);
});
