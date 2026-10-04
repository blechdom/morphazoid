import { test, expect } from '@playwright/test';
import { choose } from './helpers/synthesis-controls.mjs';
import { INSTRUMENT_PRESETS } from '../src/instruments/synthesis/instrument-presets.js';
import { METHODS } from '../src/instruments/synthesis/catalog.js';
import { METHOD_EDITOR_SCHEMAS } from '../src/instruments/synthesis/method-ui.js';
import { SEQUENCE_STUDIES } from '../src/instruments/synthesis/sequence-catalog.js';

test('complete preset tour and dice recall the entire instrument without arming Audio', async ({ page }) => {
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  page.on('console', message=>{ if(message.type()==='error') errors.push(message.text()); });
  await page.goto('/synthesis.html');
  for (const preset of INSTRUMENT_PRESETS) {
    await page.locator('#nextPerformancePreset').click();
    await expect(page.locator('#performancePresetHost .instrument-picker-current')).toHaveText(preset.label);
    const actual=await page.evaluate(async()=> (await import('/src/site/header-presets.js')).captureHeaderPresetState().snapshot);
    expect(actual).toEqual(preset.snapshot);
  }
  await page.locator('#randomPerformance').click();
  await expect(page.locator('#performancePresetHost .instrument-picker-current')).toHaveText('Preset · Custom');
  expect(await page.evaluate(()=>window.MorphazoidSynthesis.getStatus().armed)).toBe(false);
  expect(errors).toEqual([]);
});

test('local dice changes parameters in place and every arpeggiator retains visible notes', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/synthesis.html?method=fm&sequence=rotating-euclidean-chords');
  await page.evaluate(()=>{ let seed=214; Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296); });
  const before=await page.evaluate(()=>window.MorphazoidSynthesis.getState());
  await page.locator('#randomMethod').click();
  const after=await page.evaluate(()=>window.MorphazoidSynthesis.getState());
  expect(after.methodId).toBe(before.methodId); expect(after.params).not.toEqual(before.params);
  expect(after.tuningId).toBe(before.tuningId);
  for(const study of SEQUENCE_STUDIES){
    await choose(page, 'sequenceSelect', study.id);
    await page.locator('#randomSequencePreset').click();
    const state=await page.evaluate(()=>window.MorphazoidSynthesis.getSequenceState());
    expect(state.id).toBe(study.id);
    expect(state.cycle.steps.flatMap(step=>step.notes).length,study.id).toBeGreaterThan(0);
    await expect(page.locator('#sequenceSurface')).toBeVisible();
    if (!await page.locator('#sequenceOutput').evaluate(node => node.open)) await page.locator('#sequenceOutput > summary').click();
    await expect(page.locator('.synthesis-sequence-note').first()).toBeVisible();
    const labels=await page.locator('#sequencePresetSelect option').allTextContents();
    expect(labels.filter(label=>['Original','Spacious','Sparse','Tight','Dense','Wild'].includes(label))).toEqual([]);
  }
});

test('graph parameters have exactly one editor and menus contain no group subtitles', async({page})=>{
  await page.goto('/synthesis.html?method=additive');
  await expect(page.locator('#touchstoneSelect,#randomMethodType,#randomSequence,#randomEnvelopePreset')).toHaveCount(0);
  await expect(page.locator('.synthesis-shell select optgroup')).toHaveCount(0);
  await expect(page.locator('.synth-envelope input')).toHaveCount(0);
  for(const method of METHODS.filter(method=>METHOD_EDITOR_SCHEMAS[method.id])){
    await choose(page, 'methodSelect', method.id);
    const graphical=new Set(METHOD_EDITOR_SCHEMAS[method.id].flatMap(editor=>editor.kind==='xy'?[editor.x,editor.y]:editor.ids));
    await expect(page.locator('#methodControls .synthesis-parameter')).toHaveCount(method.controls.filter(control=>!graphical.has(control.id)).length);
    for(const id of graphical){const index=method.controls.findIndex(control=>control.id===id);await expect(page.locator(`#synth-param-${index}`)).toHaveCount(0);}
    const readouts = await page.locator('#methodEditor output').allTextContents();
    expect(readouts.length).toBeGreaterThan(0);
    expect(readouts.every(text => /[0-9]/.test(text))).toBe(true);
    const dots = await page.locator('.synthesis-xy-handle').evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node, '::after'); return [parseFloat(style.width), parseFloat(style.height)];
    }));
    for (const [width, height] of dots) { expect(width).toBeGreaterThanOrEqual(15); expect(width).toBe(height); }
  }
});

for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]) {
  test(`aligned axes, circular ADSR and readable information at ${viewport.width}×${viewport.height}`, async({page})=>{
    await page.setViewportSize(viewport);
    await page.goto('/synthesis.html?method=fm&sequence=rotating-euclidean-chords');
    await expect(page.locator('#sequencePresetSelect option')).toHaveCount(7);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const dice = await page.locator('#randomPerformance').boundingBox();
    const next = await page.locator('#nextPerformancePreset').boundingBox();
    expect(dice.width).toBeLessThanOrEqual(48);
    expect(Math.abs(dice.y - next.y)).toBeLessThan(1);
    const handles=await page.locator('.synth-envelope [data-node]').evaluateAll(nodes=>nodes.map(node=>{const rect=node.getBoundingClientRect();return {w:rect.width,h:rect.height,font:parseFloat(getComputedStyle(node.querySelector('span')||node).fontSize)};}));
    expect(handles.length).toBeGreaterThanOrEqual(4);
    for(const handle of handles){expect(Math.abs(handle.w-handle.h)).toBeLessThan(.5);expect(handle.font).toBeGreaterThanOrEqual(12);}
    for (const id of ['methodInfo','sequenceInfo','tuningInfo']) {
      await page.locator(`[popovertarget=${id}]`).click();
      await expect(page.locator(`#${id}`)).toBeVisible();
      expect(await page.locator(`#${id} h2`).textContent()).not.toBe('');
      await page.keyboard.press('Escape');
      await expect(page.locator(`#${id}`)).toBeHidden();
    }
    await choose(page,'tuningSelect','edo-19');
    await expect(page.locator('[data-select-id=tuningSelect] .instrument-picker-current')).toContainText('equal divisions of the octave');
    await expect(page.locator('.synthesis-reference-link a')).toHaveAttribute('href','synthesaurus-reference.html');
  });
}

test('reference page contains sourced synthesis gaps and reveals deep links',async({page})=>{
  await page.goto('/synthesaurus-reference.html#method-fm');
  await expect(page.locator('#method-fm')).toBeVisible();
  await expect(page.locator('#method-fm')).toHaveAttribute('open','');
  await expect(page.locator('#missing a[href^="https://"]').first()).toBeAttached();
});
