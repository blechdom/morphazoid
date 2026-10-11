import { expect, test } from '@playwright/test';

// Verify the view owner against the real score/renderer code, with an observed
// engine seam. Integrated native Audio/transport is covered by the workspace QA.
test('external creative views share one visualizer, source controls and sample lifecycle', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/qa-midi-performance-views', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>[hidden]{display:none!important}canvas{width:600px;height:220px}</style></head><body>
    <button id="drawingAction">Play drawing</button><div id="controls"></div><div id="rules"></div>
    <div id="draw"></div><div id="automata"></div><div id="mixer"></div><script type="module">
    import {mountMixerPerformance} from '/src/instruments/midi-mixer/midi-mixer-performance.js';
    import {parseMidi} from '/src/instruments/midi-mixer/midi-mixer-model.js';
    import {generateGridMidi} from '/src/instruments/midiphoria/midiphoria-text-midi.js';
    const state={audioEnabled:false,playing:true,tempo:120,samples:[],sampleMidi:{},decks:[],crossfade:0};
    const qa=globalThis.__performanceViews={state,launches:[],stops:0,unsubscribed:0};
    const engine={get state(){return state},subscribeNotes(){return ()=>qa.unsubscribed++},
      triggerSample(buffer,options){const sample={id:qa.launches.length+1,...options,analysis:parseMidi(buffer),positionBeats:0};
        state.samples.push(sample);qa.launches.push(sample);return sample},configureSamples(patch){Object.assign(qa,patch)},
      sendSampleController(){return false},sendSampleParameter(){return false},
      stopSamples(){state.samples=[];qa.stops++}};
    const drawing=generateGridMidi(Array.from({length:8},()=>[1,0,0,1]),{lowestNote:48,secondsPerRow:.125});
    qa.view=mountMixerPerformance(document.querySelector('#controls'),{engine,getDrawing:()=>drawing,
      automataHost:document.querySelector('#rules'),visualizerHost:document.querySelector('#draw'),
      drawingButton:document.querySelector('#drawingAction')});
    qa.canvas=document.querySelector('#mixerPerformanceCanvas');
    qa.change=mode=>{qa.view.setView(mode,document.getElementById(mode));qa.view.setActive(true)};
    qa.change('draw');
    </script></body></html>` }));
  await page.goto('/qa-midi-performance-views');
  await expect(page.locator('#automataMidiGenerate')).toHaveText('Play rule');
  await expect(page.locator('#rules .midiphoria-automata')).toHaveAttribute('open', '');
  await expect(page.locator('#mixerSendDrawing')).toBeHidden();
  await expect(page.locator('#mixerPerformanceCanvas')).toHaveCount(1);
  await page.locator('#drawingAction').click();
  expect(await page.evaluate(() => __performanceViews.launches.length)).toBe(1);
  await page.locator('#mixerSampleLoop').check();
  await page.locator('#mixerSampleSync').uncheck();
  await page.locator('#mixerSampleProgram').selectOption('19');
  await page.evaluate(() => __performanceViews.change('automata'));
  await expect(page.locator('#automata #mixerPerformanceCanvas')).toHaveCount(1);
  await expect(page.locator('.mixer-stamp-palette')).toBeHidden();
  await expect(page.locator('.mixer-stamp-shape-controls')).toBeHidden();
  await expect(page.locator('.mixer-sample-message')).toBeHidden();
  await expect(page.locator('#mixerSampleLoop')).toBeVisible();
  await expect(page.locator('#mixerSampleSync')).toBeVisible();
  await expect(page.locator('#mixerSampleProgram')).toHaveValue('19');
  await page.locator('.mixer-stamp-midi > summary').click();
  await expect(page.locator('#mixerStampSeed')).toBeHidden();
  await expect(page.locator('#mixerStampDrawBase')).toBeHidden();
  await expect(page.locator('#mixerStampGate')).toBeVisible();
  await page.locator('#automataMidiGenerate').click();
  expect(await page.evaluate(() => __performanceViews.launches.at(-1).loop)).toBe(true);
  expect(await page.evaluate(() => __performanceViews.launches.at(-1).sync)).toBe(false);
  expect(await page.evaluate(() => __performanceViews.launches.at(-1).midi.program)).toBe(19);
  const count = await page.evaluate(() => __performanceViews.launches.length);
  await page.evaluate(() => __performanceViews.change('mixer'));
  const canvas = page.locator('#mixer #mixerPerformanceCanvas');
  await expect(canvas).not.toHaveAttribute('tabindex'); await expect(canvas).not.toHaveAttribute('aria-describedby');
  await canvas.click(); await canvas.dispatchEvent('keydown', { key: 'Enter' });
  expect(await page.evaluate(() => __performanceViews.launches.length)).toBe(count);
  expect(await page.evaluate(() => document.querySelector('#mixerPerformanceCanvas') === __performanceViews.canvas)).toBe(true);
  await page.evaluate(() => __performanceViews.change('draw'));
  await expect(page.locator('#draw #mixerPerformanceCanvas')).toHaveAttribute('tabindex', '0');
  await expect(page.locator('#mixerStampDrawBase')).toBeVisible();
  await expect(page.locator('#mixerStampSeed')).toBeEnabled();
  expect(await page.evaluate(() => __performanceViews.stops)).toBe(0);
  expect(await page.evaluate(() => __performanceViews.state.playing)).toBe(true);
  await page.locator('#mixerStampGate').fill('0.25');
  const returned = await page.evaluate(() => {
    const score = __performanceViews.view.playDrawing();
    return { bytes: score.buffer.byteLength, duration: score.analysis.notes[0].duration,
      played: __performanceViews.launches.at(-1).analysis.notes[0].duration };
  });
  expect(returned.bytes).toBeGreaterThan(0); expect(returned.duration).toBe(returned.played);
  await page.evaluate(() => { __performanceViews.view.stopSamples(); __performanceViews.view.dispose(); __performanceViews.view.dispose(); });
  await expect(page.locator('#mixerPerformanceCanvas')).toHaveCount(0);
  await expect(page.locator('#mixerAutomataTools')).toHaveCount(0);
  await expect(page.locator('.mixer-performance')).toHaveCount(0);
  expect(await page.evaluate(() => __performanceViews.unsubscribed)).toBe(1);
  await page.locator('#drawingAction').click();
  expect(await page.evaluate(() => __performanceViews.launches.length)).toBe(count + 1);
  expect(errors).toEqual([]);
});
