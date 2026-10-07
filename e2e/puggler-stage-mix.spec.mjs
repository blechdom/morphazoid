import {test,expect} from '@playwright/test';
const state=page=>page.evaluate(()=>window.__puggler.snapshot());
const range=(page,id,value)=>page.locator(`#${id}`).evaluate((input,v)=>{input.value=String(v);input.dispatchEvent(new Event('input',{bubbles:true}));},value);

for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
  test(`things precede lighting, complete looks darken the room, speed knob fits at ${viewport.width}x${viewport.height}`,async({browser,baseURL},testInfo)=>{
    const context=await browser.newContext({baseURL,viewport,hasTouch:viewport.width<1000,isMobile:viewport.width<1000,reducedMotion:'reduce'});
    try{
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto('puggler.html');await page.waitForFunction(()=>window.__puggler?.snapshot().collage.ready);
      await page.locator('#playButton').click();await range(page,'rideSpeed',0);
      const sections=await page.locator('.puggler-panel .mz-control-section__title').allTextContents();
      expect(sections).toEqual(['The things','Stage & lights']);
      await expect(page.locator('#lightIntensity,#lightSpeed,#lightingControls')).toHaveCount(0);
      await expect(page.locator('#postersButton')).toHaveText('↻ Random posters');
      await expect(page.locator('#lighting option')).toHaveCount(12);
      const seed=(await state(page)).posterSeed;await page.locator('#postersButton').click();
      expect((await state(page)).posterSeed).not.toBe(seed);
      const brightness=()=>page.locator('#stage').evaluate(canvas=>{
        const {width:w,height:h}=canvas,data=canvas.getContext('2d').getImageData(0,0,w,Math.floor(h*.32)).data;
        let total=0;for(let i=0;i<data.length;i+=4)total+=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];return total/(data.length/4);
      });
      const levels={};
      for(const lighting of ['house','disco','blackout']){
        await page.locator('#lighting').selectOption(lighting);await page.waitForTimeout(120);
        levels[lighting]=await brightness();
        await page.locator('.puggler-stage-wrap').screenshot({path:testInfo.outputPath(`${lighting}.png`)});
      }
      expect(levels.blackout).toBeLessThan(levels.house*.15);
      expect(levels.disco).toBeGreaterThan(levels.blackout*3);
      await testInfo.attach('background-luminance',{body:JSON.stringify(levels),contentType:'application/json'});
      await page.locator('#lighting').selectOption('house');
      for(const skin of ['history','future']){
        await page.locator('#skin').selectOption(skin);await page.waitForTimeout(120);
        await page.locator('.puggler-stage-wrap').screenshot({path:testInfo.outputPath(`${skin}-posters.png`)});
      }
      expect((await state(page))).toMatchObject({running:false,audioOn:false});
      await page.locator('#tempoMultiplier').scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      expect(errors).toEqual([]);
    }finally{await context.close();}
  });
}

test('a real audience catch plays its dedicated cue while 2×/4× retain live audio and beat',async({page})=>{
  await page.goto('puggler.html');await page.waitForFunction(()=>window.__puggler);
  await range(page,'rideSpeed',0);await range(page,'chaos',0);await range(page,'assist',120);
  await range(page,'tempo',150);await range(page,'boo',1);
  await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  const before=await state(page);await range(page,'tempoMultiplier',1);
  await range(page,'tempoMultiplier',2);
  expect(await state(page)).toMatchObject({tempo:600,tempoMultiplier:4,rideSpeed:0,audioOn:true,running:true});
  await expect.poll(async()=>(await state(page)).beat).toBeGreaterThan(before.beat);
  await range(page,'tempoMultiplier',0);await range(page,'tempo',300);await page.locator('#crowdButton').click();
  await expect.poll(async()=>(await state(page)).hitSounds.includes('crowd-catch'),{timeout:15000,intervals:[50,50,100]}).toBe(true);
  expect((await state(page)).crowdCatches).toBeGreaterThan(before.crowdCatches);
  await page.locator('#audioButton').click();
});
