import { test, expect } from '@playwright/test';
const snapshot=page=>page.evaluate(()=>window.__gesticulatingHand.snapshot());
const range=(page,id,value)=>page.locator('#'+id).evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);

for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}])test.describe(`Wrist drag at ${viewport.width}×${viewport.height}`,()=>{
  const touch=viewport.width!==1440;
  test.use({viewport,hasTouch:touch,isMobile:touch});
  test('native dragging remains continuous through wrist and ankle choreography',async({page,context})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('gesticules.html');await page.waitForFunction(()=>window.__gesticulatingHand?.snapshot().loaded);
    if(!touch){
      await page.locator('#soundPlayButton').click();await page.locator('#audioButton').click();
      await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeGreaterThan(.001);
    }
    const cdp=touch?await context.newCDPSession(page):null;
    for(const form of ['hand','foot']){
      await page.locator('#bodyForm').selectOption(form);await page.waitForFunction(()=>window.__gesticulatingHand.snapshot().loaded);
      await page.locator('#motionPreset').selectOption('wrist-nod');await range(page,'motionAmount',1);await range(page,'tempo',240);
      await page.locator('#tremorJoint').selectOption('wrist');await range(page,'tremorAmount',12);await range(page,'tremorRate',4);
      await page.locator('#motionButton').click();
      await page.waitForFunction(()=>{const s=window.__gesticulatingHand.snapshot(),m=s.config.motion;return Math.sin(2*Math.PI*s.time*m.tempo*m.speed/240)>.9;});
      await page.locator('#motionButton').click();
      const frozen=await snapshot(page),input=page.locator('#wristFlex');await input.scrollIntoViewIfNeeded();
      const box=await input.boundingBox(),scroll=await page.evaluate(()=>scrollY),samples=[];
      await input.evaluate(input=>{input.dataset.cancels='0';input.addEventListener('pointercancel',()=>input.dataset.cancels=String(Number(input.dataset.cancels)+1),{once:true});});
      if(!touch){await page.mouse.move(box.x+12,box.y+box.height/2);await page.mouse.down();}
      for(let i=0;i<=12;i++){
        const x=box.x+12+(box.width-24)*i/12,y=box.y+box.height/2+(touch?12*i/12:0);
        if(touch)await cdp.send('Input.dispatchTouchEvent',{type:i?'touchMove':'touchStart',touchPoints:[{x,y,id:1}]});
        else await page.mouse.move(x,y);
        const state=await snapshot(page),value=Number(await input.inputValue());
        expect(state.config.pose.wrist.flex).toBe(value);expect(state.playing).toBe(false);expect(state.time).toBe(frozen.time);
        expect(state.config.sound).toEqual(frozen.config.sound);expect(state.pose.fingers).toEqual(frozen.pose.fingers);
        if(samples.length){const previous=samples.at(-1);expect(value).toBeGreaterThan(previous.value);expect(state.pose.wrist.flex-previous.pose).toBeGreaterThanOrEqual((value-previous.value)*.14999);}
        samples.push({value,pose:state.pose.wrist.flex});
      }
      if(touch)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();
      expect(samples.at(-1).pose-samples[0].pose).toBeGreaterThan(form==='hand'?40:20);
      await expect(input).toHaveAttribute('data-cancels','0');expect(await page.evaluate(()=>scrollY)).toBe(scroll);
      await input.focus();await page.keyboard.press('Home');expect(Number(await input.inputValue())).toBe(Number(await input.getAttribute('min')));
      await page.keyboard.press('End');expect(Number(await input.inputValue())).toBe(Number(await input.getAttribute('max')));
      if(touch)expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
      else{expect((await snapshot(page)).soundPlaying).toBe(true);await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeGreaterThan(.001);expect((await snapshot(page)).audio.peak).toBeLessThan(.9);}
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    }
    if(!touch){await page.locator('#audioButton').click();await expect.poll(async()=>(await snapshot(page)).audio.rms).toBeLessThan(.0001);}
    expect(errors).toEqual([]);
  });
});
