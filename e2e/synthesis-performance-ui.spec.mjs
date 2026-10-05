import { test, expect } from '@playwright/test';
import { choose } from './helpers/synthesis-controls.mjs';
import { INSTRUMENT_PRESETS } from '../src/instruments/synthesis/instrument-presets.js';
import { METHODS } from '../src/instruments/synthesis/catalog.js';
import { METHOD_EDITOR_SCHEMAS } from '../src/instruments/synthesis/method-ui.js';
import { SEQUENCE_STUDIES } from '../src/instruments/synthesis/sequence-catalog.js';
import { SYNTHESIS_DATES } from '../src/instruments/synthesis/chronology.js';

async function expectMatchingPresetControls(page) {
  const appearance = locator => locator.evaluate(node => {
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, border: style.border,
      radius: style.borderRadius, color: style.color, background: style.backgroundColor, font: style.font };
  });
  const mainNext = await appearance(page.locator('#nextPerformancePreset'));
  for (const id of ['nextMethod', 'nextPreset', 'nextTuning']) {
    expect(await appearance(page.locator(`#${id}`)), id).toEqual(mainNext);
  }
  expect(await appearance(page.locator('#randomMethod'))).toEqual(await appearance(page.locator('#randomPerformance')));
  for (const id of ['methodSelect', 'presetSelect']) {
    const picker = await page.locator(`[data-select-id="${id}"] summary`).boundingBox();
    // Wrapped labels may grow; their minimum size still matches the main picker.
    expect(picker.height).toBeGreaterThanOrEqual(mainNext.height);
  }
  const tuning = await page.locator('[data-select-id="tuningSelect"] summary').boundingBox();
  const voicing = await page.locator('[data-select-id="voiceMode"] summary').boundingBox();
  const row = await page.locator('.synthesis-pitch-options').boundingBox();
  const tuningField = await page.locator('.synthesis-tuning-choice').boundingBox();
  expect(Math.abs(tuning.y - voicing.y)).toBeLessThan(1);
  expect(voicing.x).toBeGreaterThan(tuning.x + tuning.width);
  expect(voicing.x - tuningField.x - tuningField.width).toBeCloseTo(14, 0);
  expect(row.width).toBeLessThanOrEqual(520);
  expect(tuning.width).toBeGreaterThan(90);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

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
  const methods = await page.locator('#methodSelect option').evaluateAll(options => options.map(option => ({ id: option.value, text: option.text })));
  for (const method of methods) {
    expect(method.text).toBe(`${METHODS.find(item => item.id === method.id).label} · ${SYNTHESIS_DATES[method.id].dateLabel}`);
  }
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
    await expectMatchingPresetControls(page);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const dice = await page.locator('#randomPerformance').boundingBox();
    const next = await page.locator('#nextPerformancePreset').boundingBox();
    expect(dice.width).toBeLessThanOrEqual(48);
    expect(Math.abs(dice.y - next.y)).toBeLessThan(1);
    const handles=await page.locator('.synth-envelope [data-node]').evaluateAll(nodes=>nodes.map(node=>{const rect=node.getBoundingClientRect();return {w:rect.width,h:rect.height,font:parseFloat(getComputedStyle(node.querySelector('span')||node).fontSize)};}));
    expect(handles.length).toBe(5);
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
    await choose(page, 'tuningSelect', 'japanese-in-12edo');
    const label = await page.locator('[data-select-id=tuningSelect] .instrument-picker-current').boundingBox();
    const menu = await page.locator('[data-select-id=tuningSelect] summary').boundingBox();
    expect(label.y).toBeGreaterThanOrEqual(menu.y);
    expect(label.y + label.height).toBeLessThanOrEqual(menu.y + menu.height);
    await expectMatchingPresetControls(page);
    await expect(page.locator('.synthesis-reference-link a')).toHaveAttribute('href','synthesaurus-reference.html');
  });
}

test.describe('touch preset controls', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('matching touch targets and compact tuning retain native voicing behavior', async ({ page }) => {
    await page.goto('/synthesis.html?method=fm');
    await expect(page.locator('#nextPerformancePreset')).toBeVisible();
    await expectMatchingPresetControls(page);
    for (const selector of ['#nextMethod', '#nextPreset', '#randomMethod', '[data-select-id="tuningSelect"] summary', '[data-select-id="voiceMode"] summary']) {
      expect((await page.locator(selector).boundingBox()).height).toBeGreaterThanOrEqual(48);
    }
    await choose(page, 'tuningSelect', 'edo-19');
    await choose(page, 'tuningSelect', 'japanese-in-12edo');
    const label = await page.locator('[data-select-id=tuningSelect] .instrument-picker-current').boundingBox();
    const menu = await page.locator('[data-select-id=tuningSelect] summary').boundingBox();
    expect(label.y).toBeGreaterThanOrEqual(menu.y);
    expect(label.y + label.height).toBeLessThanOrEqual(menu.y + menu.height);
    await expectMatchingPresetControls(page);
    await choose(page, 'voiceMode', 'poly');
    expect(await page.evaluate(() => window.MorphazoidSynthesis.getState().voiceMode)).toBe('poly');
    await choose(page, 'inputCategory', 'signals');
    await expect(page.locator('#voiceModeControl')).toBeHidden();
    await choose(page, 'inputCategory', 'synthesis');
    await expect(page.locator('#voiceModeControl')).toBeVisible();
    await expect(page.locator('#voiceMode')).toHaveValue('poly');
    await expect(page.locator('#tuningSelect')).toHaveValue('japanese-in-12edo');
    await expect(page.locator('.synthesis-synth-essentials #frequencyRow')).toBeVisible();
    await expectMatchingPresetControls(page);
    expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().armed)).toBe(false);
  });
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 940, height: 900 }, { width: 1440, height: 900 }]) {
  test(`compact knobs and width-aware selectors at ${viewport.width}×${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 900 });
    const page = await context.newPage();
    try {
      await page.goto('/synthesis.html?method=graphic&sequence=basic-up');
      await expect(page.locator('#methodControls .synthesis-knob')).toHaveCount(8);
      const knobs = await page.locator('#methodControls .synthesis-knob').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect(), input = node.querySelector('input[type=range]').getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, touchWidth: input.width, touchHeight: input.height };
      }));
      for (const knob of knobs) {
        expect(knob.width).toBeLessThanOrEqual(84);
        expect(knob.touchWidth).toBeGreaterThanOrEqual(48);
        expect(knob.touchHeight).toBeGreaterThanOrEqual(48);
      }
      expect(knobs[1].y).toBe(knobs[0].y);
      expect(knobs[1].x - knobs[0].x - knobs[0].width).toBeLessThanOrEqual(8);
      const tap = await page.locator('#tempoControl .mz-tap-tempo').boundingBox();
      const transport = await page.locator('#transportTiming').boundingBox();
      expect(tap.x).toBeGreaterThanOrEqual(transport.x);
      expect(tap.x + tap.width).toBeLessThanOrEqual(transport.x + transport.width + 1);
      await expect(page.locator('#performanceDock #tempoControl')).toBeVisible();
      const pair = await page.locator('.synthesis-method-choice .synthesis-axis-pair').boundingBox();
      const method = await page.locator('[data-select-id=methodSelect] summary').boundingBox();
      const preset = await page.locator('[data-select-id=presetSelect] summary').boundingBox();
      if (pair.width < 530) expect(preset.y).toBeGreaterThanOrEqual(method.y + method.height);
      else expect(preset.x).toBeGreaterThan(method.x + method.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await context.close(); }
  });
}

test('reference page contains sourced synthesis gaps and reveals deep links',async({page})=>{
  await page.goto('/synthesaurus-reference.html#method-fm');
  await expect(page.locator('#method-fm')).toBeVisible();
  await expect(page.locator('#method-fm')).toHaveAttribute('open','');
  await expect(page.locator('#missing a[href^="https://"]').first()).toBeAttached();
});
