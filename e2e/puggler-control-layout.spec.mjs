import { expect, test } from '@playwright/test';
import { choosePugglerPattern } from './helpers/puggler-pattern.mjs';
const state = page => page.evaluate(() => window.__puggler.snapshot());
const capture = page => page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState());
const range = (page, id, value) => page.locator(`#${id}`).evaluate((input, value) => {
  input.value = value; input.dispatchEvent(new Event('input', { bubbles:true }));
}, String(value));
const viewports = [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390},{width:667,height:375}];

for (const viewport of viewports) test(`compact controls and Choose menus at ${viewport.width}x${viewport.height}`, async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL, viewport, hasTouch:viewport.width<1000, isMobile:viewport.width<1000 });
  try {
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('puggler.html'); await page.waitForFunction(() => window.__puggler?.snapshot().collage.ready);
    const layout = () => page.evaluate(() => {
      const rect = node => node.getBoundingClientRect().toJSON();
      const style = selector => {
        const c = getComputedStyle(document.querySelector(selector));
        return [c.height,c.borderRadius,c.borderTopWidth,c.backgroundColor,c.color];
      };
      const play = document.querySelector('#playButton');
      return {
        names:[...document.querySelectorAll('.rider-toggle')].map(rect), play:rect(play),
        visibleIcon:rect(play.querySelector(play.getAttribute('aria-pressed')==='true'?'.transport-pause':'.transport-play')),
        objects:rect(document.querySelector('#randomButton')), throw:rect(document.querySelector('#crowdButton')),
        objectIcon:rect(document.querySelector('.puggler-objects-icon')),
        host:document.querySelector('[data-instrument-preset-host]').parentElement.id,
        first:document.querySelector('.puggler-performance-controls').firstElementChild.id,
        arrows:['.masthead .instrument-picker-next','.header-preset-next','#nextPattern'].map(style),
        triggers:['.masthead .instrument-picker-trigger','.header-preset-picker summary','.puggler-pattern-picker summary'].map(style),
      };
    });
    const initial = await layout();
    expect(initial.host).toBe(viewport.width<1000?'mobilePresets':'panelPresets');
    expect(initial.first).toBe('mobilePresets');
    expect(initial.arrows[1]).toEqual(initial.arrows[0]); expect(initial.arrows[2]).toEqual(initial.arrows[0]);
    expect(initial.triggers[1]).toEqual(initial.triggers[0]); expect(initial.triggers[2]).toEqual(initial.triggers[0]);
    expect(initial.objects.y).toBe(initial.throw.y);
    expect(initial.objectIcon.width).toBeGreaterThanOrEqual(22);
    await expect(page.locator('#crowdButton')).toHaveText('Throw');
    for (const skin of ['history','future','punk']) {
      await page.locator('#skin').evaluate((input, value) => {input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));}, skin);
      const after = await layout();
      for (let i=0;i<3;i++) {
        expect(after.names[i].width).toBeCloseTo(initial.names[i].width, 1);
        expect(after.names[i].width).toBeCloseTo(after.names[0].width, 1);
        expect(after.names[i].height).toBe(initial.names[i].height);
      }
      expect(await page.locator('.rider-toggle').evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth && node.scrollHeight<=node.clientHeight))).toBe(true);
    }
    for (const paused of [true,false]) {
      await page.locator('#playButton').click();
      await expect(page.locator('#playButton')).toHaveAccessibleName(paused?'Play':'Pause');
      const {play,visibleIcon:icon} = await layout();
      expect(Math.abs(icon.y+icon.height/2-play.y-play.height/2)).toBeLessThan(.6);
      expect(Math.abs(icon.x+icon.width/2-play.x-play.width/2)).toBeLessThan(.6);
    }
    const picker = page.locator('.puggler-pattern-picker'), summary = picker.locator('summary');
    await summary.click();
    const popup = await page.locator('#puggler-pattern-panel').boundingBox();
    expect(popup.x).toBeGreaterThanOrEqual(0); expect(popup.y).toBeGreaterThanOrEqual(0);
    expect(popup.x+popup.width).toBeLessThanOrEqual(viewport.width); expect(popup.y+popup.height).toBeLessThanOrEqual(viewport.height);
    const search = page.getByRole('searchbox',{name:'Filter juggling patterns'});
    await search.fill('nonesuch-123'); await expect(picker.locator('.instrument-picker-empty')).toBeVisible();
    await search.press('Escape'); await expect(search).toHaveValue('');
    await search.fill('Evolving'); await expect(picker.locator('.instrument-picker-row:visible')).toHaveCount(1);
    await picker.getByRole('button',{name:'Evolving phrases'}).click();
    expect((await state(page)).phrase).toBe('evolve'); await expect(summary).toBeFocused();
    await summary.press('Enter'); await search.fill(''); await search.press('Escape');
    await expect(picker).not.toHaveAttribute('open'); await expect(summary).toBeFocused();
    await summary.click(); await page.locator('#playButton').click(); await expect(picker).not.toHaveAttribute('open');
    // Rebuilding compatible choices preserves one picker and uses the real model.
    await range(page,'count',10); await choosePugglerPattern(page,'shower-10');
    expect(await state(page)).toMatchObject({count:10,pattern:'shower-10',phrase:'loop',running:false,audioOn:false});
    const last = await page.locator('#pattern option').last().getAttribute('value');
    await choosePugglerPattern(page,last); await page.locator('#nextPattern').click();
    await expect(page.locator('#pattern')).toHaveValue('phrase:verse');
    await range(page,'count',1); await expect(picker.locator('[data-pattern="shower-10"]')).toHaveCount(0);
    await expect(picker).toHaveCount(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({path:testInfo.outputPath('compact-controls.png')});
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('moved act controls still affect the show, with Audio and transport independent', async ({page}) => {
  await page.goto('puggler.html'); await page.waitForFunction(()=>window.__puggler);
  await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  for(const id of ['ridePattern','preset','passMode','skin','rideRange']) await expect(page.locator(`.puggler-performance-controls #${id}`)).toHaveCount(1);
  await page.locator('#preset').selectOption('ballet');
  await page.locator('#ridePattern').selectOption('rock'); await page.locator('#passMode').selectOption('three');
  await page.locator('#skin').selectOption('history'); await range(page,'rideRange',88);
  const scene = await capture(page);
  expect(scene.snapshot.model).toMatchObject({ridePattern:'rock',passMode:'three',rideRange:88});
  expect(scene.snapshot.sound.skin).toBe('history');
  expect(await state(page)).toMatchObject({running:true,audioOn:true});
  await page.locator('#preset').selectOption('moss'); await expect(page.locator('#passingField')).toBeHidden();
  await page.locator('#preset').selectOption('ballet'); await expect(page.locator('#passingField')).toBeVisible();
  await page.locator('#audioButton').click();
});

test('presets move as the same live controls on resize without recalling or resetting state', async ({page}) => {
  await page.goto('puggler.html'); await page.waitForFunction(()=>window.__puggler);
  await page.locator('#playButton').click(); await range(page,'level',.13);
  await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  await page.locator('.header-preset-next').click();
  const scene = await capture(page), before = await state(page);
  await page.evaluate(()=>{window.__originalPresetRow=document.querySelector('.header-preset-controls');});
  await page.locator('.header-preset-picker summary').click();
  await page.getByRole('searchbox',{name:'Filter presets'}).focus();
  for (const viewport of [viewports[1],viewports[3],viewports[0],viewports[2],viewports[0]]) {
    await page.setViewportSize(viewport);
    const target = viewport.width<1000?'mobilePresets':'panelPresets';
    await expect(page.locator(`#${target} .header-preset-controls`)).toHaveCount(1);
    expect(await page.evaluate(()=>document.querySelector('.header-preset-controls')===window.__originalPresetRow)).toBe(true);
    await expect(page.locator('[data-instrument-preset-host]')).toHaveCount(1);
    expect(await capture(page)).toEqual(scene);
    expect(await state(page)).toMatchObject({level:.13,audioOn:true,running:false});
  }
  await expect(page.locator('.header-preset-picker')).not.toHaveAttribute('open');
  await expect(page.locator('.header-preset-picker summary')).toBeFocused();
  expect((await state(page)).time).toBeGreaterThan(before.time);
  await page.locator('#playButton').click();
  await page.setViewportSize(viewports[1]);
  await page.locator('.header-preset-next').click();
  await page.locator('.header-preset-random').click();
  expect(await state(page)).toMatchObject({level:.13,audioOn:true,running:true});
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id','custom');
  await page.locator('#audioButton').click();
});
