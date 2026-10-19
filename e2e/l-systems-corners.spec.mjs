import { test, expect } from "@playwright/test";
import { sampleAudioEnvelope, readAudioStatus } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

async function instrument(page) {
  await page.route("**/src/instruments/l-systems/l-systems-app.js",async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:`${await response.text()}
      globalThis.__corner = { state, synthPool, drumAudio, amplitudeControl, applyFullPreset,
        get clock(){return discreteClock;},get presets(){return presetController;},
        get snapshot(){return captureLSystemsPreset(state,amplitudeControl.captureState());},
        markers(){return lSystemsCornerPoints(iterationTraces.at(-1),state.corners.minimumAngle);},
        heads(){return playbackHeads(iterationPlaybackAtPhase(iterationTraces,state.position,state.structureMode));},
        notes:[],triggers:[],
      };
      const note=synthPool.scheduleNotes.bind(synthPool);
      synthPool.scheduleNotes=(voices,options)=>{__corner.notes.push({voices,options});return note(voices,options);};
      const trigger=drumAudio.trigger.bind(drumAudio);
      drumAudio.trigger=(voice,options)=>{__corner.triggers.push({voice,options});return trigger(voice,options);};
    `});
  });
  await page.goto("l-systems.html");await page.waitForFunction(()=>globalThis.__corner);
}
async function setRange(page,id,value){await page.locator(`#${id}`).fill(String(value));}
async function hilbert(page) {
  await page.locator("#preset").selectOption("hilbert");
  await setRange(page,"iterations",1);
  await setRange(page,"cornerThreshold",12);
  await page.evaluate(()=>__corner.amplitudeControl.applyState({...__corner.amplitudeControl.captureState(),enabled:false,swell:false}));
}

for(const [name,width,height,hasTouch] of [["desktop",1440,900,false],["portrait",390,844,true],["landscape",844,390,true]]) {
  test.describe(name,()=>{
    test.use({viewport:{width,height},hasTouch});
    test("corner controls are reachable, contextual and leave natural branching intact",async({page,baseURL},testInfo)=>{
      const diagnostics=watchPageDiagnostics(page,{baseURL});await instrument(page);
      expect(await page.evaluate(()=>__corner.heads().length)).toBe(1);
      for(const id of ["cornerEmphasis","cornerThreshold","cornerWidth"]) await expect(page.locator(`#${id}`)).toBeVisible();
      await expect(page.locator("#hitPlacement")).toBeHidden();
      await page.locator("#modeNotes").click();
      await page.locator("#hitPlacement").selectOption("corners");
      for(const id of ["cornerEmphasis","cornerWidth","subdivisions"]) await expect(page.locator(`#${id}`)).toBeHidden();
      await expect(page.locator("#cornerThreshold")).toBeVisible();
      await page.locator("#hitPlacement").selectOption("all");
      for(const id of ["cornerEmphasis","cornerWidth","subdivisions"]) await expect(page.locator(`#${id}`)).toBeVisible();
      await page.locator("#modeMic").click();await expect(page.locator("#cornersRack")).toBeHidden();
      await page.locator("#modeContinuous").click();await hilbert(page);
      await setRange(page,"position",.3335);
      expect(await page.evaluate(()=>__corner.markers().length)).toBe(2);
      await page.locator("#cornerWidth").scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await testInfo.attach(`${name}-corners.png`,{body:await page.screenshot(),contentType:"image/png"});
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  });
}

test("continuous accent, minimum turn and width change actual output without boosting peaks or restarting",async({page,baseURL})=>{
  const diagnostics=watchPageDiagnostics(page,{baseURL});await instrument(page);await hilbert(page);
  await setRange(page,"speed",0);await setRange(page,"pitchRange",0);await setRange(page,"position",.5);
  await page.locator("#audioButton").click();await page.waitForFunction(()=>__corner.synthPool.enabled);
  await page.locator("#playButton").click();await page.waitForFunction(()=>__corner.clock);
  await page.evaluate(()=>__corner.savedClock=__corner.clock);
  const measure=async()=>{await page.waitForTimeout(250);const e=await sampleAudioEnvelope(page,{durationMs:350});expect(e.summary.clippedSamples).toBe(0);return e.summary.maxRms;};
  await setRange(page,"cornerEmphasis",0);const neutral=await measure();
  await setRange(page,"cornerEmphasis",1);const edge=await measure();
  expect(edge).toBeGreaterThan(.0001);expect(edge).toBeLessThan(neutral*.4);
  await setRange(page,"position",.3335);const bend=await measure();expect(bend).toBeGreaterThan(edge*2.5);
  await setRange(page,"cornerThreshold",100);const ignored=await measure();expect(ignored).toBeLessThan(bend*.4);
  expect(await page.evaluate(()=>__corner.markers().length)).toBe(0);
  await setRange(page,"cornerThreshold",12);await setRange(page,"position",.375);
  await setRange(page,"cornerWidth",.05);const narrow=await measure();
  await setRange(page,"cornerWidth",.5);const wide=await measure();expect(wide).toBeGreaterThan(narrow*2);
  expect(await page.evaluate(()=>__corner.clock===__corner.savedClock)).toBe(true);
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed","true");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

for(const mode of ["notes","triggers"]) test(`${mode}: corner-only hits and live placement changes retain the clock and audible output`,async({page,baseURL})=>{
  const diagnostics=watchPageDiagnostics(page,{baseURL});await instrument(page);await hilbert(page);
  await page.locator(mode==="notes"?"#modeNotes":"#modeTriggers").click();
  await setRange(page,"speed",.5);await setRange(page,"subdivisions",4);
  await page.locator("#hitPlacement").selectOption("corners");
  await page.locator("#audioButton").click();await page.waitForTimeout(150);
  await page.locator("#playButton").click();await page.waitForFunction(()=>__corner.clock);
  await page.evaluate(()=>{__corner.savedClock=__corner.clock;__corner.savedBudget=__corner.clock.budget;});
  const signal=await sampleAudioEnvelope(page,{durationMs:900});
  expect(signal.summary.maxRms).toBeGreaterThan(.0005);expect(signal.summary.clippedSamples).toBe(0);
  const count=await page.evaluate(mode=>__corner[mode].length,mode);expect(count).toBeGreaterThanOrEqual(1);expect(count).toBeLessThanOrEqual(3);
  await page.locator("#hitPlacement").selectOption("all");
  for(const value of [.2,.8,.4]) await setRange(page,"cornerEmphasis",value);
  for(const value of [20,45,10]) await setRange(page,"cornerThreshold",value);
  await page.waitForTimeout(400);
  expect(await page.evaluate(mode=>__corner[mode].length,mode)).toBeGreaterThan(count);
  expect(await page.evaluate(()=>__corner.clock===__corner.savedClock&&__corner.clock.budget===__corner.savedBudget)).toBe(true);
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed","true");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("preset, Random and legacy recall own the corner settings while Mic remains separate",async({page,baseURL})=>{
  const diagnostics=watchPageDiagnostics(page,{baseURL});await instrument(page);
  await page.evaluate(()=>__corner.presets.view.select("notes-2"));
  expect(await page.evaluate(()=>__corner.snapshot.corners)).toEqual(await page.evaluate(()=>__corner.presets.bank.find(p=>p.id==="notes-2").snapshot.corners));
  await expect(page.locator("#hitPlacement")).toHaveValue("corners");
  await page.locator(".header-preset-random").click();
  expect(await page.evaluate(()=>__corner.snapshot.corners)).toEqual(await page.evaluate(()=>__corner.state.corners));
  await page.evaluate(()=>{const s=structuredClone(__corner.snapshot);delete s.corners;__corner.applyFullPreset(s);});
  expect(await page.evaluate(()=>__corner.state.corners)).toEqual({emphasis:.45,minimumAngle:12,width:.2,placement:"all"});
  const before=await page.evaluate(()=>structuredClone(__corner.state.corners));
  await page.locator("#modeMic").click();await page.locator(".header-preset-next").click();
  expect(await page.evaluate(()=>__corner.state.corners)).toEqual(before);
  expect(await page.evaluate(()=>Object.hasOwn(__corner.snapshot,"corners"))).toBe(false);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});
