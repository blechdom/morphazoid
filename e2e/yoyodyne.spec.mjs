import {expect,test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {readAudioStatus,sampleAudioEnvelope,waitForAudioState,waitForStableAudioState} from "./helpers/audio-probe.mjs";
const diagnostics = page => page.evaluate(()=>window.__yoyodyne.getDiagnostics());
const range = (page,id,value) => page.locator("#"+id).evaluate((input,v)=>{
 input.value=String(v);input.dispatchEvent(new Event("input",{bubbles:true}));
},value);
test.beforeEach(async({page})=>{
 const errors=[];page.on("pageerror",error=>errors.push(error.message));page.__yoyoErrors=errors;
 const response=await page.goto("yoyodyne.html");expect(response.ok()).toBe(true);
 await expect.poll(async()=>!!await page.evaluate(()=>window.__yoyodyne)).toBe(true);
});
test.afterEach(async({page})=>expect(page.__yoyoErrors).toEqual([]));
test("kinetic surface exposes labelled accessible controls",async({page})=>{
 const result=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]).analyze();
 expect(result.violations).toEqual([]);
 const controls=await page.locator("input[type=range]").evaluateAll(inputs=>inputs.map(input=>({
  name:input.labels?.[0]?.textContent.trim(),min:Number(input.min),max:Number(input.max),value:Number(input.value)
 })));
 for(const control of controls){expect(control.name).toBeTruthy();expect(control.max).toBeGreaterThan(control.min);expect(Number.isFinite(control.value)).toBe(true);}
});
test("motion, Space, and gestures never implicitly arm Audio",async({page})=>{
 expect((await diagnostics(page)).hasContext).toBe(false);
 await page.locator("#playButton").click();
 await expect.poll(async()=>(await diagnostics(page)).launches).toBeGreaterThan(0);
 expect((await diagnostics(page)).hasContext).toBe(false);
 await expect(page.locator("#transportNotice")).toContainText("Audio is off");
 await page.locator("#playButton").click();
 await page.locator("#noteStage").focus();await page.keyboard.press("Space");
 expect((await diagnostics(page)).hasContext).toBe(false);
 expect((await readAudioStatus(page)).active).toBe(false);
});
test("manual keyboard throw, tug and bind return to hand; arrows guide the hand",async({page})=>{
 await page.locator("#noteStage").focus();await page.keyboard.press("ArrowRight");
 await expect.poll(async()=>(await diagnostics(page)).world.hand.x).toBeGreaterThan(.06);
 await page.keyboard.press("Enter");await expect.poll(async()=>(await diagnostics(page)).world.mode).toBe("sleeping");
 const before=(await diagnostics(page)).world;
 await page.keyboard.press("t");await page.waitForTimeout(100);
 expect((await diagnostics(page)).world.hand.y).toBeLessThan(before.hand.y-.05);
 await page.keyboard.press("c");
 await expect.poll(async()=>(await diagnostics(page)).world.mode,{timeout:6000}).toBe("held");
 expect((await diagnostics(page)).audioArmed).toBe(false);
});
test("pointer capture moves the held hand continuously and cancellation releases it",async({page})=>{
 const stage=page.locator("#noteStage"),r=await stage.boundingBox();
 await page.mouse.move(r.x+r.width*.5,r.y+r.height*.44);await page.mouse.down();
 await page.mouse.move(r.x+r.width*.58,r.y+r.height*.4,{steps:6});
 await page.waitForTimeout(200);expect((await diagnostics(page)).world.hand.x).toBeGreaterThan(.12);
 const pointerId=await stage.evaluate(canvas=>{
  let id=null;for(let n=0;n<10;n++)if(canvas.hasPointerCapture(n))id=n;return id;
 });
 expect(pointerId).not.toBeNull();
 await stage.dispatchEvent("pointercancel",{pointerId});
 expect(await stage.evaluate((canvas,id)=>canvas.hasPointerCapture(id),pointerId)).toBe(false);
 await page.mouse.up();expect((await diagnostics(page)).hasContext).toBe(false);
});
test("one real worklet makes bounded stereo for all four routines, then mute leaves motion running",async({page},info)=>{
 await page.locator("#audioButton").click();
 await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed","true");
 expect((await diagnostics(page)).running).toBe(false);
 expect((await readAudioStatus(page)).active).toBe(false);
 await page.locator("#playButton").click();
 const report={};
 for(const trick of ["sleeper","cradle","around-world","gravity-pull"]){
  await page.locator('[data-trick="'+trick+'"]').click();await page.locator("#resetAll").click();
  await waitForAudioState(page,true);
  const result=await sampleAudioEnvelope(page,{durationMs:1000,intervalMs:40});report[trick]=result.summary;
  expect(result.summary.finite).toBe(true);expect(result.summary.maxPeak).toBeGreaterThan(.002);
  expect(result.summary.maxPeak).toBeLessThan(.65);expect(result.summary.clippedSamples).toBe(0);
  const status=await readAudioStatus(page);expect(status.leftPeak).toBeGreaterThan(0);expect(status.rightPeak).toBeGreaterThan(0);
  expect((await diagnostics(page)).processorCount).toBe(1);
 }
 await info.attach("kinetic-audio-characterization.json",{body:JSON.stringify(report,null,2),contentType:"application/json"});
 await page.locator("#audioButton").click();await waitForStableAudioState(page,false);
 const time=(await diagnostics(page)).world.time;await page.waitForTimeout(150);
 expect((await diagnostics(page)).world.time).toBeGreaterThan(time);
});
test("live parameters, trick changes, output level and recall preserve Perform and Audio",async({page})=>{
 await page.locator("#audioButton").click();await page.locator("#playButton").click();await waitForAudioState(page,true);
 const before=await diagnostics(page);
 for(const [id,value] of Object.entries({tempo:135,stringLength:.5,friction:.8,rootNote:62,tone:.65})){
  await range(page,id,value);expect((await diagnostics(page)).running).toBe(true);
 }
 await page.locator('[data-trick="cradle"]').click();
 expect((await diagnostics(page)).world.time).toBeGreaterThanOrEqual(before.world.time);
 await range(page,"outputLevel",0);await waitForStableAudioState(page,false);
 expect((await diagnostics(page)).running).toBe(true);
 await range(page,"outputLevel",.4);await waitForAudioState(page,true);
 await page.locator("#resetAll").click();
 const reset=await diagnostics(page);expect(reset.running&&reset.audioArmed).toBe(true);expect(reset.settings.tempo).toBe(90);expect(reset.trick).toBe("cradle");
 await page.locator("#playButton").click();await waitForStableAudioState(page,false);
 const time=(await diagnostics(page)).world.time;await page.waitForTimeout(200);
 expect((await diagnostics(page)).world.time).toBe(time);
});
test("hidden lifecycle freezes safely and context interruption can be resumed explicitly",async({page})=>{
 await page.locator("#audioButton").click();await page.locator("#playButton").click();await waitForAudioState(page,true);
 await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"));});
 const hidden=await diagnostics(page);expect(hidden.intervalActive).toBe(false);
 await page.waitForTimeout(300);expect((await diagnostics(page)).world.time).toBe(hidden.world.time);
 await waitForStableAudioState(page,false);
 await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,value:false});document.dispatchEvent(new Event("visibilitychange"));});
 await waitForAudioState(page,true);
 await page.evaluate(async()=>{
  const {getSharedAudioOutputManager}=await import("./src/audio-output-manager.js");
  const record=[...getSharedAudioOutputManager(window).contexts.values()][0];await record.context.suspend();
 });
 await expect(page.locator("#transportNotice")).toContainText("interrupted");
 await page.locator("#audioButton").click();
 await expect.poll(async()=>(await diagnostics(page)).audioRunning).toBe(true);
 await waitForStableAudioState(page,true);
});
test("repeated arm/mute never duplicates the voice and page teardown releases output",async({page})=>{
 for(let i=0;i<3;i++){await page.locator("#audioButton").click();await expect.poll(async()=>(await diagnostics(page)).audioRunning).toBe(true);await page.locator("#audioButton").click();}
 await page.locator("#audioButton").click();await page.locator("#playButton").click();await waitForAudioState(page,true);
 expect((await readAudioStatus(page)).connectionCount).toBe(1);
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent("pagehide",{persisted:false})));
 await expect.poll(async()=>(await readAudioStatus(page)).connectionCount).toBe(0);
 const d=await diagnostics(page);expect(d.disposed).toBe(true);expect(d.processorCount).toBe(0);expect(d.intervalActive).toBe(false);
});
for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
 test("reachable controls and unclipped stage at "+viewport.width+"x"+viewport.height,async({page,browser},info)=>{
  const context=await browser.newContext({viewport,hasTouch:viewport.width<1000,isMobile:viewport.width<1000});
  const phone=await context.newPage();await phone.goto(new URL("yoyodyne.html",page.url()).href);await phone.locator("#playButton").click();
  await phone.waitForTimeout(400);
  const metrics=await phone.evaluate(()=>{
   const size=s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.width,r.height];};
   const panel=document.querySelector(".yd-panel");
   return {width:innerWidth,scroll:document.documentElement.scrollWidth,panelWidth:panel.clientWidth,panelScroll:panel.scrollWidth,
    overflow:getComputedStyle(panel).overflowY,stage:size("#noteStage"),audio:size("#audioButton"),play:size("#playButton")};
  });
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.width+1);expect(metrics.panelScroll).toBeLessThanOrEqual(metrics.panelWidth+1);
  const notice=await phone.locator("#transportAudioAttention").boundingBox(),transport=await phone.locator(".yd-transport").boundingBox();
  expect(notice.y+notice.height).toBeLessThanOrEqual(transport.y);
  expect(metrics.stage[0]).toBeGreaterThan(300);expect(metrics.stage[1]).toBeGreaterThanOrEqual(350);
  if(viewport.width<1000){expect(Math.min(...metrics.audio)).toBeGreaterThanOrEqual(48);expect(Math.min(...metrics.play)).toBeGreaterThanOrEqual(48);}
  for(const selector of ["#tempo",'[data-trick="around-world"]',"#tone","#resetAll"]){
   await phone.locator(selector).scrollIntoViewIfNeeded();
   expect(await phone.locator(selector).evaluate(el=>{
    const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return hit===el||el.contains(hit);
   })).toBe(true);
  }
  await phone.locator(".yd-details summary").first().click();await range(phone,"gravity",.8);await range(phone,"elasticity",.6);
  await phone.screenshot({path:info.outputPath("layout.png"),fullPage:true});
  await phone.setViewportSize(viewport.width<500?{width:844,height:390}:{width:390,height:844});
  expect((await diagnostics(phone)).running).toBe(true);
  expect(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await context.close();
 });
}
