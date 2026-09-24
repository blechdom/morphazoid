import { expect, test } from '@playwright/test';

const viewports = [
  { width: 1440, height: 900 }, { width: 390, height: 844 },
  { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 667, height: 375 },
];
const snapshot = page => page.evaluate(() => window.__puggler.snapshot());
async function open(page) {
  await page.goto('puggler.html');
  await page.waitForFunction(() => window.__puggler?.snapshot().collage.ready);
  await expect.poll(() => page.evaluate(() => Number.parseFloat(document.body.style.getPropertyValue('--puggler-header-height')))).toBeGreaterThan(0);
}
const geometry = page => page.evaluate(() => {
  const rect = selector => {
    const element = document.querySelector(selector), r = element.getBoundingClientRect(), css = getComputedStyle(element);
    return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom, right:r.right, border:css.borderWidth, radius:css.borderRadius, shadow:css.boxShadow, scrollTop:element.scrollTop };
  };
  return { header:rect('.masthead'), wrap:rect('.puggler-stage-wrap'), canvas:rect('#stage'), panel:rect('.puggler-panel'), controls:rect('.puggler-performance-controls'), scrollY, width:innerWidth, height:innerHeight, scrollWidth:document.documentElement.scrollWidth };
});

for (const viewport of viewports) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch:viewport.width<1000, isMobile:viewport.width<1000 });
    test('borderless stage stays visible and parameters scroll into a usable region', async ({ page }, testInfo) => {
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await open(page);
      const before=await geometry(page), stateBefore=await snapshot(page), portrait=viewport.width<viewport.height;
      expect(before.canvas.x).toBeCloseTo(0,0);
      expect(before.wrap.border).toBe('0px');expect(before.canvas.border).toBe('0px');
      expect(before.wrap.radius).toBe('0px');expect(before.wrap.shadow).toBe('none');
      expect(before.wrap.y).toBeCloseTo(before.header.bottom,0);
      expect(before.controls.y).toBeCloseTo(before.wrap.bottom,0);
      expect(before.scrollWidth).toBeLessThanOrEqual(viewport.width+1);
      if(portrait){
        expect(before.canvas.width).toBeCloseTo(viewport.width,0);
        expect(before.canvas.height).toBeLessThanOrEqual(viewport.height*.4);
        expect(before.canvas.width/before.canvas.height).toBeGreaterThanOrEqual(1.5);
        expect(before.canvas.width/before.canvas.height).toBeLessThanOrEqual(1.9);
        expect(viewport.height-before.wrap.bottom).toBeGreaterThanOrEqual(200);
        if(viewport.width>=375)expect(await page.locator('.puggler-performance-controls').evaluate(el=>el.getBoundingClientRect().y)).toBeLessThan(viewport.height-200);
      }else{
        expect(before.canvas.right).toBeCloseTo(before.panel.x,0);
        expect(before.panel.right).toBeCloseTo(viewport.width,0);
        expect(before.panel.height).toBeGreaterThanOrEqual(viewport.height*.75);
      }
      await page.screenshot({path:testInfo.outputPath('initial.png')});
      await page.mouse.move(viewport.width-5,viewport.height-20);
      await page.mouse.wheel(0,700);
      await expect.poll(()=>page.evaluate(()=>{
        const panel=document.querySelector('.puggler-panel');
        return getComputedStyle(panel).overflowY==='auto'?panel.scrollTop:scrollY;
      })).toBeGreaterThan(100);
      const scrolled=await geometry(page);
      expect(scrolled.wrap.y).toBeCloseTo(before.wrap.y,0);
      expect(scrolled.canvas.height).toBeCloseTo(before.canvas.height,0);
      if(!portrait){
        expect(scrolled.controls).toEqual(before.controls);
        // Sidebar content can change height without reflowing the left column.
        const lights=page.locator('.puggler-panel > details.puggler-control-section');
        await expect(lights).toHaveAttribute('open','');
        await lights.evaluate(el=>{el.open=false;});
        await expect(lights).not.toHaveAttribute('open');
        expect((await geometry(page)).controls).toEqual(before.controls);
      }
      const panelBeforeLeftScroll=(await geometry(page)).panel;
      const control=page.locator('#decay');
      await control.scrollIntoViewIfNeeded();
      await control.focus();
      const oldValue=Number(await control.inputValue());
      await control.press('ArrowLeft');
      expect(Number(await control.inputValue())).toBeLessThan(oldValue);
      const controlBox=await control.boundingBox(), current=await geometry(page);
      expect(controlBox.y).toBeGreaterThanOrEqual(current.wrap.bottom-1);
      if(!portrait){
        expect(current.panel).toEqual(panelBeforeLeftScroll);
        expect(current.wrap.y).toBeCloseTo(before.wrap.y,0);
        expect(current.controls.y).toBeCloseTo(before.wrap.bottom,0);
        if(viewport.height<560)expect(current.controls.scrollTop).toBeGreaterThan(0);
      }
      expect(controlBox.y+controlBox.height).toBeLessThanOrEqual(viewport.height+1);
      expect(await page.evaluate(()=>{
        const node=document.querySelector('#decay'),r=node.getBoundingClientRect();
        return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===node;
      })).toBe(true);
      const after=await snapshot(page);
      expect(after.running).toBe(stateBefore.running);expect(after.audioOn).toBe(false);
      expect(after.time).toBeGreaterThan(stateBefore.time);
      await page.screenshot({path:testInfo.outputPath('scrolled-controls.png')});
      expect(errors).toEqual([]);
    });
  });
}

test('orientation changes update the sticky offset without resetting the show', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});await open(page);
  const before=await snapshot(page);
  await page.evaluate(()=>scrollTo(0,600));
  await page.setViewportSize({width:844,height:390});
  await expect.poll(async()=>{
    const g=await geometry(page);return Math.abs(g.wrap.y-g.header.bottom);
  }).toBeLessThan(1);
  const landscape=await geometry(page);
  expect(landscape.canvas.right).toBeCloseTo(landscape.panel.x,0);
  await page.setViewportSize({width:390,height:844});
  await expect.poll(async()=>(await geometry(page)).canvas.width).toBe(390);
  const after=await snapshot(page);
  expect(after.time).toBeGreaterThan(before.time);expect(after.audioOn).toBe(false);
  expect(after.running).toBe(true);
});
