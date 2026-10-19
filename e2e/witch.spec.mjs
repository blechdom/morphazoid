import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';

async function open(page) {
  await page.goto('/witch.html');
  await expect(page.locator('.instrument-preset-controls')).toBeVisible();
}
async function point(page,x,y) {
  const rect=await page.locator('#witchCanvas').boundingBox();
  const s=Math.min(rect.width/1000,rect.height/720);
  return {x:rect.x+(rect.width-1000*s)/2+x*s,y:rect.y+(rect.height-720*s)/2+y*s};
}
async function range(page,id,value) {
  await page.locator(`#${id}`).evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
}

test('Witch gestures stay silent until Audio is explicitly armed; voice releases and output stays bounded', async({page},testInfo)=>{
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await open(page);
  await page.locator('#playButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  const envelope=await sampleAudioEnvelope(page,{durationMs:900});
  expect(envelope.summary.finite).toBe(true); expect(envelope.summary.maxPeak).toBeGreaterThan(.001); expect(envelope.summary.clippedSamples).toBe(0);
  await page.locator('[data-scene="flight"]').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#voice')).toBeHidden();
  await expect(page.locator('#radius')).toBeHidden();
  await expect(page.locator('#reverseButton')).toBeHidden();
  await page.locator('[data-effect="moon"]').click();
  await expect(page.locator('#gestureReadout')).toContainText('moon bell');
  const flight=await sampleAudioEnvelope(page,{durationMs:600});
  expect(flight.summary.maxPeak).toBeGreaterThan(.001); expect(flight.summary.clippedSamples).toBe(0);
  await page.locator('#playButton').click();
  await waitForStableAudioState(page,false,{timeout:10000,stableMs:300});
  await range(page,'outputLevel',0);
  await page.locator('[data-effect="spark"]').click();
  await waitForStableAudioState(page,false,{stableMs:250});
  await page.locator('#resetButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#outputLevel')).toHaveValue('0');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','false');
  await page.locator('#audioButton').click();
  expect(errors).toEqual([]);
  await testInfo.attach('witch-audio.json',{body:JSON.stringify(envelope,null,2),contentType:'application/json'});
});

test('cauldron circles reverse, widen, and release; finger and flight keyboard gestures work', async({page})=>{
  await open(page);
  const first=await point(page,690,520); await page.mouse.move(first.x,first.y); await page.mouse.down();
  for(let i=1;i<=24;i++){const a=i/24*Math.PI*2;const p=await point(page,600+160*Math.cos(a),520+53*Math.sin(a));await page.mouse.move(p.x,p.y);}
  await expect(page.locator('#radius')).toHaveValue(/0\.[789]/);
  await expect(page.locator('#reverseButton')).toHaveAttribute('aria-pressed','false');
  for(let i=1;i<=10;i++){const a=-i/24*Math.PI*2;const p=await point(page,600+160*Math.cos(a),520+53*Math.sin(a));await page.mouse.move(p.x,p.y);}
  await expect(page.locator('#reverseButton')).toHaveAttribute('aria-pressed','true');
  await page.mouse.up();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','false');
  await page.locator('[data-scene="fingers"]').click();
  await expect(page.locator('#voice')).toBeHidden();
  await expect(page.locator('#finger0Label')).toHaveText('Thumb · glass');
  await expect(page.locator('.mz-tap-tempo:visible')).toHaveCount(0);
  const bends=await page.locator('.witch-finger-controls input').evaluateAll(inputs=>inputs.map(el=>Number(el.value)));
  const tip=await page.evaluate(async()=>{const {getFingerTips}=await import('/src/instruments/witch/witch-renderer.js');return getFingerTips({scene:'fingers',fingers:[.5,.5,.3,.25,.25]})[2];});
  const tipPoint=await point(page,tip.x,tip.y);
  await page.mouse.move(tipPoint.x,tipPoint.y);await page.mouse.down();await page.mouse.move(tipPoint.x,tipPoint.y+30,{steps:5});await page.mouse.up();
  expect(Number(await page.locator('#finger2').inputValue())).toBeGreaterThan(.3);
  const afterBends=await page.locator('.witch-finger-controls input').evaluateAll(inputs=>inputs.map(el=>Number(el.value)));
  expect(afterBends.filter((_,i)=>i!==2)).toEqual(bends.filter((_,i)=>i!==2));
  const before=Number(await page.locator('#finger2').inputValue());
  await page.locator('#witchCanvas').focus();await page.keyboard.press('3');await page.keyboard.press('ArrowUp');
  expect(Number(await page.locator('#finger2').inputValue())).toBeGreaterThan(before);
  await page.locator('[data-scene="flight"]').click();await page.locator('#witchCanvas').focus();await page.keyboard.press('ArrowUp');
  expect(Number(await page.locator('#altitude').inputValue())).toBeGreaterThan(.5);
  await page.keyboard.press('m');await expect(page.locator('#gestureReadout')).toContainText('moon bell');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test('instrumental fingers play independently, combine held keys and touches, and release on cancellation',async({page})=>{
  await page.addInitScript(()=>{
    const Original=window.AudioWorkletNode;
    window.AudioWorkletNode=class extends Original {
      constructor(context,name,options) {
        super(context,name,options);
        if(name==='witch-voice') {
          this.port.addEventListener('message',({data})=>{ if(data.type==='visual') window.witchVisual=data; });
          this.port.start();
        }
      }
    };
  });
  await open(page); await page.locator('[data-scene="fingers"]').click();
  await page.locator('#witchCanvas').focus();
  await page.keyboard.down('1');await page.keyboard.down('3');await page.keyboard.up('1');await page.keyboard.up('3');
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator('#audioButton').click();await page.locator('#witchCanvas').focus();
  await page.keyboard.down('1');await page.keyboard.down('3');
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.fingerLevels?.filter(v=>v>.05).length)).toBe(2);
  expect(await page.evaluate(()=>window.witchVisual.mouth)).toBe(0);
  const hand=await sampleAudioEnvelope(page,{durationMs:450}); expect(hand.summary.maxPeak).toBeGreaterThan(.001);
  await page.keyboard.up('1');
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.fingerLevels?.[0])).toBeLessThan(.01);
  expect(await page.evaluate(()=>window.witchVisual.fingerLevels[2])).toBeGreaterThan(.05);
  await page.keyboard.up('3');
  await waitForStableAudioState(page,false,{timeout:8000,stableMs:200});
  const slider=await page.locator('#finger1').boundingBox();
  await page.mouse.move(slider.x+slider.width*.5,slider.y+slider.height*.5);await page.mouse.down();
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.fingerLevels?.[1])).toBeGreaterThan(.05);
  expect(await page.evaluate(()=>window.witchVisual.fingerLevels.filter(v=>v>.05).length)).toBe(1);
  await page.mouse.up();await waitForStableAudioState(page,false,{timeout:8000,stableMs:200});
  const tips=await page.evaluate(async()=>{const {getFingerTips}=await import('/src/instruments/witch/witch-renderer.js');return getFingerTips({scene:'fingers',fingers:[.5,.5,.3,.25,.25]});});
  const a=await point(page,tips[0].x,tips[0].y), b=await point(page,tips[2].x,tips[2].y);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,id:1},{...b,id:2}]});
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.fingerLevels?.filter(v=>v>.05).length)).toBe(2);
  // CDP touchEnd lists the contact being lifted, not the remaining contact.
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{...a,id:1}]});
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.fingerLevels?.[0])).toBeLessThan(.01);
  expect(await page.evaluate(()=>window.witchVisual.fingerLevels[2])).toBeGreaterThan(.05);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await waitForStableAudioState(page,false,{timeout:8000,stableMs:200});
  await page.locator('#playButton').click();await page.locator('#witchCanvas').focus();await page.keyboard.press('ArrowUp');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.fingerLevels?.filter(v=>v>.05).length)).toBe(5);
  await page.locator('[data-scene="flight"]').click();
  await expect.poll(()=>page.evaluate(()=>window.witchVisual?.flightPulse??0)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>window.witchVisual.mouth)).toBe(0);
  await page.locator('#audioButton').click();
});

test('Witch survives a persisted page lifecycle without losing controls or arming Audio',async({page})=>{
  await open(page);await page.locator('[data-scene="fingers"]').click();
  await page.evaluate(()=>{
    window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
    window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
  });
  await page.locator('#playButton').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
  await page.locator('[data-scene="flight"]').click();await page.locator('[data-effect="ghost"]').click();
  await expect(page.locator('#gestureReadout')).toContainText('Ghost chimes');
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test('flight Tap sets the instrumental strike rate without arming Audio or starting Play',async({page})=>{
  await open(page);await page.locator('[data-scene="flight"]').click();
  const tap=page.locator('#nightControls .mz-tap-tempo');await expect(tap).toHaveCount(1);
  await expect(page.locator('.mz-tap-tempo:visible')).toHaveCount(1);
  await tap.click();await page.waitForTimeout(460);await tap.click();
  const speed=Number(await page.locator('#flightSpeed').inputValue());
  expect(speed).toBeLessThan(.2);expect(speed).toBeGreaterThan(.02);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

for(const [label,width,height] of [['desktop',1440,900],['portrait',390,844],['landscape',844,390]]) {
  test(`Witch ${label}: scenes and controls fit, keyboard focus and accessibility`,async({page},testInfo)=>{
    await page.setViewportSize({width,height});await open(page);
    for(const scene of ['brew','fingers','flight']) {
      await page.locator(`[data-scene="${scene}"]`).click();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await expect(page.locator('#witchCanvas')).toBeVisible();
      await page.locator('#playButton').scrollIntoViewIfNeeded();await expect(page.locator('#playButton')).toBeInViewport();
      await page.screenshot({path:testInfo.outputPath(`${label}-${scene}.png`),fullPage:true});
    }
    if(label==='portrait') {
      await page.locator('[data-scene="brew"]').click();
      await page.mouse.move(330,700);await page.mouse.wheel(0,1600);
      await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(100);
      await expect(page.locator('#clearIngredients')).toBeInViewport();
    } else {
      await page.locator('.witch-help').scrollIntoViewIfNeeded();
      await expect(page.locator('.witch-help')).toBeInViewport();
    }
    const a11y=await new AxeBuilder({page}).include('.witch-shell').analyze();
    expect(a11y.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
  });
}

test('presets and randomization preserve Audio/output/play; cancellation releases touch gesture',async({page})=>{
  await open(page);await range(page,'outputLevel',.19);await page.locator('#playButton').click();
  await page.locator('.header-preset-next').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#outputLevel')).toHaveValue('0.19');
  await page.locator('.header-preset-random').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
  await page.locator('[data-scene="brew"]').click();
  const p=await point(page,680,520);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','false');
});
