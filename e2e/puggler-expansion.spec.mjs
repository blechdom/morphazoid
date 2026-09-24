import { test, expect } from '@playwright/test';
import { PUGGLER_FULL_PRESETS } from '../src/instruments/puggler/puggler-full-presets.js';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';
const state=page=>page.evaluate(()=>window.__puggler.snapshot());
const range=(page,id,value)=>page.locator(`#${id}`).evaluate((node,value)=>{node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
async function open(page,path='puggler.html'){
  await page.goto(path);await page.waitForFunction(()=>window.__puggler?.snapshot().collage.ready);
  await expect(page.locator('.header-preset-controls')).toBeVisible();
}
for(const path of ['puggler.html','dist-wax/puggler.html'])test(`panel scenes are complete, ordered and preserve paused/muted state: ${path}`,async({page})=>{
  test.setTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page,path);
  await expect(page.locator('.header-preset-picker summary')).toHaveText(/Select Preset/);
  await expect(page.locator('[data-full-preset]')).toHaveCount(48);
  expect(await page.evaluate(()=>{
    const presets=document.querySelector('.header-preset-controls'),host=document.querySelector('[data-instrument-preset-host]'),header=document.querySelector('.masthead');
    return host?.firstElementChild===presets&&!header.contains(presets)
      &&!!header.querySelector('.header-settings-panel .midi-toggle')
      &&!!header.querySelector('.mz-range-knob #level');
  })).toBe(true);
  await page.locator('#playButton').click();await range(page,'level',.13);
  for(const preset of PUGGLER_FULL_PRESETS){
    // Synchronous native click + capture avoids races with audience replacements.
    const captured=await page.evaluate(async()=>{
      const module=await import(new URL('src/site/header-presets.js',location.href));
      document.querySelector('.header-preset-next').click();return module.captureHeaderPresetState();
    });
    expect(captured.selectedId).toBe(preset.id);expect(captured.snapshot).toEqual(preset.snapshot);
    expect(await state(page)).toMatchObject({audioOn:false,running:false,level:.13,allowFlashes:false});
  }
  const before=await state(page);await page.locator('.header-preset-random').click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id','custom');
  expect(await state(page)).toMatchObject({audioOn:false,running:false,level:.13,allowFlashes:false});
  expect((await state(page)).time).toBeGreaterThan(before.time);expect(errors).toEqual([]);
});
test('auto voices follow object and skin; explicit voices survive prop changes',async({page})=>{
  await open(page);await page.locator('#playButton').click();
  // Pause lets existing flights land and audience replacements return. Re-rack
  // one held prop so this selector test is not racing those deliberate events.
  await range(page,'count','1');
  expect((await state(page)).objects[0].phase).toBe('held');
  await expect(page.locator('#riffs0')).toHaveValue('object');await expect(page.locator('#drums0')).toHaveValue('object');
  await page.locator('#object0').selectOption('fish');await page.locator('#skin').selectOption('future');
  await expect(page.locator('#riffs0 option:checked')).toHaveText('Own · Backwards underwater alien');
  await expect(page.locator('#drums0 option:checked')).toHaveText('Own · Backwards underwater alien hit');
  await page.locator('#riffs0').selectOption('object:bell');await page.locator('#object0').selectOption('boot');
  await expect(page.locator('#riffs0 option:checked')).toHaveText('Event-horizon bell');
  await page.locator('#skin').selectOption('history');await expect(page.locator('#riffs0 option:checked')).toHaveText('Beating Balinese-gong color');
  expect((await state(page)).audioOn).toBe(false);
});
test('flash consent is separate from presets and is suppressed by reduced motion',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await open(page);
  await expect(page.locator('#allowFlashes')).not.toBeChecked();await page.locator('#allowFlashes').check();
  await page.locator('.header-preset-next').click();await page.locator('.header-preset-random').click();
  await expect(page.locator('#allowFlashes')).toBeChecked();
  await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('#allowFlashes')).toBeDisabled();
  expect((await state(page)).reducedMotion).toBe(true);await expect(page.locator('#flashNote')).toContainText('disabled');
});
test('live scene/skin changes reuse the audio bank and stay bounded at dense settings',async({page})=>{
  test.setTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
  await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true',{timeout:20000});
  await range(page,'level',.35);
  for(const id of ['punk-skate','history-world','future-laser']){
    await page.locator('.header-preset-picker summary').click();await page.locator(`[data-full-preset][data-preset-id="${id}"]`).click();
    const s=await state(page);expect(s.audioOn).toBe(true);expect(s.running).toBe(true);expect(s.level).toBe(.35);
    await expect.poll(async()=>(await state(page)).sonics.some(v=>v.key.startsWith(`object:${id.split('-')[0]}:`))).toBe(true);
    const measured=await sampleAudioEnvelope(page,{durationMs:1000});expect(measured.summary.finite).toBe(true);expect(measured.summary.maxPeak).toBeGreaterThan(.003);expect(measured.summary.clippedSamples).toBe(0);
  }
  await range(page,'count','10');await range(page,'tempo',1200);await range(page,'level',1);await range(page,'sceneGain',1);await range(page,'flight',1);await range(page,'impacts',2);await range(page,'boo',3);
  for(let i=0;i<9;i++){
    await page.locator('#skin').selectOption(['punk','history','future'][i%3]);
    await page.locator('#lighting').selectOption(['party','disco','lasers'][i%3]);
    const measured=await sampleAudioEnvelope(page,{durationMs:700,intervalMs:35});expect(measured.summary.finite).toBe(true);expect(measured.summary.maxPeak).toBeLessThan(.92);expect(measured.summary.clippedSamples).toBe(0);
    const s=await state(page);expect(s.objectBufferCount).toBe(198);expect(s.sonics.length).toBeLessThanOrEqual(10);expect(s.airTails).toBeLessThanOrEqual(20);expect(s.attacks).toBeLessThanOrEqual(48);
  }
  await page.locator('#audioButton').click();await page.waitForTimeout(300);const muted=await sampleAudioEnvelope(page,{durationMs:300});expect(muted.summary.maxPeak).toBeLessThan(.001);expect(errors).toEqual([]);
});
