import { test, expect } from '@playwright/test';
import { choose, exact } from './helpers/synthesis-controls.mjs';

const canvases = page => page.evaluate(() => ['scope','spectrum'].map(id => document.getElementById(id).toDataURL()));
const settle = page => page.waitForTimeout(70); // Allow the 30 fps display loop to repaint.

for (const viewport of [{width:390,height:844},{width:844,height:390}]) {
  test('mobile analysis stays visible while editing at '+viewport.width+'×'+viewport.height, async ({page})=>{
    await page.setViewportSize(viewport);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/synthesis.html?method=graphic');
    for(const selector of ['#scope','#spectrum']) await expect(page.locator(selector)).toBeInViewport({ratio:1});
    await expect(page.locator('#spectrumOverlay')).toBeChecked();
    await expect(page.locator('#spectrumMode')).toHaveValue('spectrogram');
    for(const selector of ['#methodControls input[type=range]','.synth-envelope input[type=range]']){
      const input=page.locator(selector).last();await input.scrollIntoViewIfNeeded();
      await expect(input).toBeInViewport({ratio:1});
      const bounds=await input.boundingBox(),dock=await page.locator('#soundAnalysis').boundingBox();
      expect(bounds.y+bounds.height).toBeLessThanOrEqual(dock.y);
      expect(await input.evaluate(node=>{const r=node.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===node;})).toBe(true);
      for(const monitor of ['#scope','#spectrum']) await expect(page.locator(monitor)).toBeInViewport({ratio:1});
      const knob=input.locator('..').locator('..');
      await knob.locator('.synthesis-knob-value').click();
      const editor=knob.locator('input[type=number]');
      await expect(editor).toBeInViewport({ratio:1});
      const editorBounds=await editor.boundingBox(),editingDock=await page.locator('#soundAnalysis').boundingBox();
      expect(editorBounds.y+editorBounds.height).toBeLessThanOrEqual(editingDock.y);
      await editor.press('Escape');
      for(const monitor of ['#scope','#spectrum']) await expect(page.locator(monitor)).toBeInViewport({ratio:1});
    }
    // Closed local menus must scroll underneath the persistent analysis dock.
    await page.evaluate(() => {
      const study=document.querySelector('[data-select-id="touchstoneSelect"]');
      const scope=document.getElementById('scope').getBoundingClientRect();
      if(study) scrollBy(0,study.getBoundingClientRect().top-scope.top-scope.height/2);
    });
    for(const monitor of ['#scope','#spectrum']) expect(await page.locator(monitor).evaluate(node=>{
      const r=node.getBoundingClientRect();return [.25,.5,.75].every(f=>document.elementFromPoint(r.x+r.width/2,r.y+r.height*f)===node);
    })).toBe(true);
    await page.locator('#sectionProcessing').click();
    await exact(page, '#dryWet-value', 47);
    expect(await page.evaluate(()=>window.MorphazoidSynthesis.getState().wet)).toBeCloseTo(.47, 12);
    for(const monitor of ['#scope','#spectrum']) await expect(page.locator(monitor)).toBeInViewport({ratio:1});
    await page.locator('#presetHost summary').click();
    await page.locator('#header-preset-panel input').fill('delay');
    const row=page.locator('[data-full-preset]:visible').last();await row.scrollIntoViewIfNeeded();await row.click();
    await expect(page.locator('#presetHost summary')).toBeVisible();
    expect(await page.evaluate(()=>window.MorphazoidSynthesis.getStatus().armed)).toBe(false);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('live spectrum overlay and spectrogram freeze through rotation without changing sound',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/synthesis.html?method=additive');
  await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  await page.locator('#playButton').click();await expect(page.locator('#signalStatus')).toHaveText('Sounding');
  const first=await canvases(page);
  await expect.poll(async()=>JSON.stringify(await canvases(page))===JSON.stringify(first)).toBe(false);
  await page.locator('#freezeDisplay').check();await settle(page);
  const frozen=await canvases(page), sound=await page.evaluate(()=>window.MorphazoidSynthesis.getState());
  await page.locator('#spectrumOverlay').uncheck();await expect(page.locator('#scope')).toHaveAttribute('aria-label','Live output waveform');await settle(page);
  expect((await canvases(page))[0]).not.toBe(frozen[0]);
  await page.locator('#spectrumOverlay').check();await settle(page);
  expect(await canvases(page)).toEqual(frozen);
  expect(await page.evaluate(()=>window.MorphazoidSynthesis.getState())).toEqual(sound);
  await exact(page, '#frequencyHz', 880);
  await page.waitForTimeout(150);expect(await canvases(page)).toEqual(frozen);
  await page.setViewportSize({width:844,height:390});await settle(page);
  for(const monitor of ['#scope','#spectrum']) await expect(page.locator(monitor)).toBeInViewport({ratio:1});
  await page.setViewportSize({width:390,height:844});await settle(page);
  expect(await canvases(page)).toEqual(frozen);
  await choose(page, 'spectrumMode', 'spectrum');await settle(page);
  expect((await canvases(page))[1]).not.toBe(frozen[1]);
  await choose(page, 'spectrumMode', 'spectrogram');await settle(page);
  expect(await canvases(page)).toEqual(frozen);
  expect(await page.evaluate(()=>window.MorphazoidSynthesis.getStatus())).toMatchObject({armed:true,playing:true});
  await page.locator('#freezeDisplay').uncheck();
  await expect.poll(async()=>JSON.stringify(await canvases(page))===JSON.stringify(frozen)).toBe(false);
  await page.locator('#audioButton').click();await expect(page.locator('#signalStatus')).toHaveText('Audio off');
});
