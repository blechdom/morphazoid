import {test,expect} from '@playwright/test';
const capture=page=>page.evaluate(async()=>{const {captureHeaderPresetState}=await import('/src/site/header-presets.js');return captureHeaderPresetState();});
test('Spelling recalls every full scene and true Random without replacing text, master, Loop or Audio consent',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/spelling-synthesizer.html');await expect(page.locator('.header-preset-controls')).toBeVisible();
  await page.locator('#spellingInput').fill('My own words');await page.locator('#readbackLoop').click();
  const level=page.locator('#level');await level.evaluate(e=>{e.value='0.2';e.dispatchEvent(new Event('input',{bubbles:true}));});
  expect((await capture(page)).selectedId).toBeNull();expect((await capture(page)).presetCount).toBe(22);
  const states=[];
  for(let i=0;i<22;i++){
    await page.locator('.header-preset-next').click();
    await expect.poll(async()=>(await capture(page)).selectedId).not.toBeNull();
    states.push((await capture(page)).snapshot);
    await expect(level).toHaveValue('0.2');await expect(page.locator('#spellingInput')).toHaveValue('My own words');
    await expect(page.locator('#readbackLoop')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
  }
  for(let i=0;i<5;i++){
    await page.locator('.header-preset-random').click();await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id','custom');
    expect(states).not.toContainEqual((await capture(page)).snapshot);
  }
  await expect(level).toHaveValue('0.2');await expect(page.locator('#spellingInput')).toHaveValue('My own words');
  await expect(page.locator('#readbackLoop')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');expect(errors).toEqual([]);
});
