import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

async function instrument(page) {
  await page.addInitScript(() => {
    const raf = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => raf(function paint(time) {
      if (globalThis.__pausePaint) raf(paint); else callback(time);
    });
  });
  await page.route("**/src/instruments/l-systems/l-systems-app.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      globalThis.__ensemble = { state, synthPool, amplitudeControl, synthVoicesForPlayheads, applyFullPreset, trajectories: [], notes: [],
        get clock() { return discreteClock; }, get traces() { return iterationTraces; }, get presets() { return presetController; },
        get snapshot() { return captureLSystemsPreset(state, amplitudeControl.captureState()); },
        heads() { return playbackHeads(iterationPlaybackAtPhase(iterationTraces, state.position, state.structureMode)); },
      };
      const submit = synthPool.setVoiceTrajectory.bind(synthPool);
      synthPool.setVoiceTrajectory = (...args) => {
        __ensemble.trajectories.push({ at:synthPool.context.currentTime, phase:state.position, voices:args[0] });
        if (__ensemble.trajectories.length > 500) __ensemble.trajectories.shift();
        return submit(...args);
      };
      const schedule = synthPool.scheduleNotes.bind(synthPool);
      synthPool.scheduleNotes = (...args) => {
        __ensemble.notes.push({ at:synthPool.context.currentTime, voices:args[0], options:args[1] });
        return schedule(...args);
      };
    ` });
  });
  await page.goto("l-systems.html");
  await page.waitForFunction(() => globalThis.__ensemble);
}

for (const [name, width, height, hasTouch] of [["desktop",1440,900,false],["portrait",390,844,true],["landscape",844,390,true]]) {
  test.describe(name, () => {
    test.use({viewport:{width,height},hasTouch});
    test("visible path readers have distinct live pitches and audio-clock motion independent of paint", async ({page,baseURL},testInfo) => {
      const diagnostics=watchPageDiagnostics(page,{baseURL});
      await instrument(page);
      await page.evaluate(() => __ensemble.presets.view.select("continuous-8"));
      await expect(page.locator('#pitchSource option[value="depth"]')).toHaveText("Path distance");
      await page.locator("#playButton").click();
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      await page.locator("#audioButton").click();
      await page.waitForFunction(() => __ensemble.trajectories.length > 4);
      const submitted=await page.evaluate(() => __ensemble.trajectories.at(-1));
      expect(submitted.voices.length).toBe(3);
      expect(new Set(submitted.voices.map(v=>v.key)).size).toBe(3);
      expect(new Set(submitted.voices.map(v=>v.frequency.toFixed(1))).size).toBe(3);
      const signal=await sampleAudioEnvelope(page,{durationMs:800});
      expect(signal.summary.maxRms).toBeGreaterThan(.001);
      expect(signal.summary.clippedSamples).toBe(0);
      await page.evaluate(() => { __ensemble.savedClock=__ensemble.clock; __ensemble.trajectories=[]; __pausePaint=true; });
      await page.waitForTimeout(600);
      const unpainted=await page.evaluate(() => __ensemble.trajectories);
      expect(unpainted.length).toBeGreaterThan(10);
      expect(unpainted.at(-1).phase).toBeGreaterThan(unpainted[0].phase);
      expect(unpainted.at(-1).voices.map(v=>v.frequency)).not.toEqual(unpainted[0].voices.map(v=>v.frequency));
      await page.evaluate(() => { __pausePaint=false; });
      for (const value of [.04,.07,.09,.05]) await page.locator("#speed").fill(String(value));
      await page.locator("#turnAsymmetry").fill("0.2");
      expect(await page.evaluate(() => __ensemble.clock===__ensemble.savedClock)).toBe(true);
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed","true");
      await page.locator("#mainPresets").scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await testInfo.attach(`${name}-ensemble.png`,{body:await page.screenshot(),contentType:"image/png"});
      await page.locator("#playButton").click(); await page.waitForTimeout(400);
      expect((await readAudioStatus(page)).rms).toBeLessThan(.0001);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
      await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  });
}

test("Notes keep three different pitches when all readers share a percussion cell",async({page,baseURL})=>{
  const diagnostics=watchPageDiagnostics(page,{baseURL});await instrument(page);
  await page.evaluate(()=>{
    const s=structuredClone(__ensemble.snapshot);
    s.mode="notes";Object.assign(s.shared,{presetId:"cantor",iterations:0,structureMode:"final",readerMode:"regions",speed:.08});
    Object.assign(s.synth,{pitchSource:"depth",soundMode:"sine",articulation:"fixed",noteDuration:1});
    s.drums.subdivisions=1;__ensemble.applyFullPreset(s);
  });
  await page.locator("#audioButton").click();await page.waitForFunction(()=>__ensemble.synthPool.enabled);
  await page.locator("#playButton").click();await page.waitForFunction(()=>__ensemble.notes.length>=3);
  const first=await page.evaluate(()=>__ensemble.notes.slice(0,3));
  expect(new Set(first.map(n=>n.options.startAt)).size).toBe(1);
  expect(new Set(first.map(n=>n.voices[0].key)).size).toBe(3);
  expect(new Set(first.map(n=>n.voices[0].frequency)).size).toBe(3);
  const signal=await sampleAudioEnvelope(page,{durationMs:500});
  expect(signal.summary.maxRms).toBeGreaterThan(.001);
  expect(signal.summary.clippedSamples).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("earlier near-silent high-winding scene stays audible while playing and changing parameters",async({page,baseURL})=>{
  const diagnostics=watchPageDiagnostics(page,{baseURL});await instrument(page);
  await page.evaluate(()=>{
    const s=structuredClone(__ensemble.snapshot);
    Object.assign(s.shared,{presetId:"sierpinski",readerMode:"regions",iterations:5,angle:137.9,turnAsymmetry:.237,mutation:.027,speed:.06});
    Object.assign(s.synth,{soundMode:"fm",pitchSource:"angle",baseFrequency:220,pitchRange:2,cutoff:2400});
    __ensemble.applyFullPreset(s);
  });
  await page.locator("#audioButton").click();await page.waitForFunction(()=>__ensemble.synthPool.enabled);
  await page.locator("#playButton").click();await page.waitForTimeout(200);
  await page.locator("#position").fill("0.45");
  const signal=await sampleAudioEnvelope(page,{durationMs:1200});
  expect(signal.summary.maxRms).toBeGreaterThan(.001);expect(signal.summary.clippedSamples).toBe(0);
  const voices=await page.evaluate(()=>__ensemble.trajectories.at(-1).voices);
  expect(voices.length).toBe(3);expect(voices.every(v=>v.frequency>=110&&v.frequency<=440)).toBe(true);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("factory path envelopes submit multiple audible pitches, including the formerly short pluck scene",async({page,baseURL})=>{
  const diagnostics=watchPageDiagnostics(page,{baseURL});await instrument(page);
  await page.locator("#audioButton").click();await page.waitForFunction(()=>__ensemble.synthPool.enabled);
  await page.locator("#playButton").click();
  for(const id of ["continuous-5","continuous-8","continuous-10","continuous-16"]){
    await page.evaluate(id=>__ensemble.presets.view.select(id),id);
    await page.locator("#position").fill("0.45");await page.waitForTimeout(160);
    const voices=await page.evaluate(()=>__ensemble.trajectories.at(-1).voices.filter(v=>v.gain>.005));
    expect(voices.length,id).toBeGreaterThanOrEqual(2);
    expect(new Set(voices.map(v=>v.frequency.toFixed(1))).size,id).toBeGreaterThanOrEqual(2);
    const signal=await sampleAudioEnvelope(page,{durationMs:350});
    expect(signal.summary.maxRms,id).toBeGreaterThan(.001);expect(signal.summary.clippedSamples,id).toBe(0);
  }
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

for (const [name,width,height,hasTouch] of [["desktop",1440,900,false],["portrait",390,844,true],["landscape",844,390,true]]) {
  test.describe(`${name} natural tree`,()=>{
    test.use({viewport:{width,height},hasTouch});
    test("refresh starts at one root and final tree branches 1 -> 2 -> 4",async({page,baseURL},testInfo)=>{
      const diagnostics=watchPageDiagnostics(page,{baseURL}); await instrument(page);
      expect(await page.evaluate(()=>[__ensemble.state.position,__ensemble.heads().length])).toEqual([0,1]);
      await page.evaluate(()=>__ensemble.presets.view.select("continuous-1"));
      await expect(page.locator("#readerMode")).toHaveValue("end-to-end");
      await expect(page.locator("#structureMode")).toHaveValue("final");
      for(let depth=0;depth<3;depth++){
        const phase=await page.evaluate(depth=>{
          const trace=__ensemble.traces.at(-1), segment=trace.segments.find(s=>s.forkDepth===depth);
          return (segment.startDistance+segment.endDistance)/(2*trace.duration);
        },depth);
        await page.locator("#position").fill(String(Math.round(phase * 2000) / 2000));
        expect(await page.evaluate(()=>__ensemble.heads().length)).toBe(2**depth);
      }
      await page.locator("#readerMode").scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await testInfo.attach(`${name}-natural-tree.png`,{body:await page.screenshot(),contentType:"image/png"});
      await page.locator("#readerMode").selectOption("regions");
      expect(await page.evaluate(()=>new Set(__ensemble.heads().map(h=>h.reader)).size)).toBe(3);
      await page.locator("#position").fill("0.83");
      await page.reload();await page.waitForFunction(()=>globalThis.__ensemble);
      expect(await page.evaluate(()=>[__ensemble.state.position,__ensemble.state.readerMode,__ensemble.state.structureMode,__ensemble.state.presetId,__ensemble.heads().length])).toEqual([0,"end-to-end","final","pythagorean",1]);
      await expect(page.locator("#position")).toHaveValue("0");
      await expect(page.locator("#readerMode")).toHaveValue("end-to-end");
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  });
}

test("new shapes and presets restart at their own end, while live sliders preserve phase, audio and tails",async({page,baseURL})=>{
  const diagnostics=watchPageDiagnostics(page,{baseURL}); await instrument(page);
  await page.evaluate(()=>__ensemble.presets.view.select("notes-1"));
  await page.locator("#audioButton").click(); await page.waitForFunction(()=>__ensemble.synthPool.enabled);
  await page.locator("#playButton").click(); await page.waitForFunction(()=>__ensemble.clock);
  await page.evaluate(()=>{
    __ensemble.savedClock=__ensemble.clock; __ensemble.savedBudget=__ensemble.clock.budget;
    __ensemble.savedContext=__ensemble.synthPool.context; __ensemble.cancelCount=0;
    const cancel=__ensemble.synthPool.cancelScheduledNotes.bind(__ensemble.synthPool);
    __ensemble.synthPool.cancelScheduledNotes=(...args)=>{__ensemble.cancelCount++;return cancel(...args);};
  });
  await page.locator("#position").fill("0.61"); await page.waitForTimeout(120);
  // Knob movement is not a scene recall: keep the running phase.
  await page.locator("#baseFrequency").fill("280"); await page.locator("#angle").fill("40");
  expect(await page.evaluate(()=>__ensemble.state.position)).toBeGreaterThan(.6);
  // Same-mode recalls restart from the direction's correct end at the next audio boundary.
  for(const id of ["notes-1","notes-5"]){
    await page.locator("#position").fill("0.57"); await page.waitForTimeout(120);
    await page.evaluate(id=>__ensemble.presets.view.select(id),id); await page.waitForTimeout(120);
    const s=await page.evaluate(()=>({position:__ensemble.state.position,direction:__ensemble.state.direction}));
    if(s.direction>0) expect(s.position).toBeLessThan(.15); else expect(s.position).toBeGreaterThan(.85);
  }
  await page.locator("#readerMode").selectOption("regions");
  await page.locator("#structureMode").selectOption("canon");
  await page.locator("#mutation").fill("0.23");
  await page.locator("#position").fill("0.72"); await page.waitForTimeout(120);
  await page.locator("#preset").selectOption("pythagorean"); await page.waitForTimeout(120);
  expect(await page.evaluate(()=>[__ensemble.state.readerMode,__ensemble.state.structureMode,__ensemble.state.direction,__ensemble.state.mutation,__ensemble.state.childTimeRatio])).toEqual(["end-to-end","final",1,0,1]);
  expect(await page.evaluate(()=>__ensemble.state.position)).toBeLessThan(.15);
  expect(await page.evaluate(()=>__ensemble.clock===__ensemble.savedClock && __ensemble.clock.budget===__ensemble.savedBudget && __ensemble.synthPool.context===__ensemble.savedContext)).toBe(true);
  expect(await page.evaluate(()=>__ensemble.cancelCount)).toBe(0);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed","true");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed","true");
  const signal=await sampleAudioEnvelope(page,{durationMs:1000});
  expect(signal.summary.maxRms).toBeGreaterThan(.001); expect(signal.summary.clippedSamples).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("medium and fast factory sounds remain active across Continuous, Notes and Triggers",async({page,baseURL})=>{
  const diagnostics=watchPageDiagnostics(page,{baseURL}); await instrument(page);
  await page.locator("#audioButton").click(); await page.waitForFunction(()=>__ensemble.synthPool.enabled);
  await page.locator("#playButton").click();
  for(const id of ["continuous-1","continuous-10","notes-1","notes-10","triggers-1","triggers-6"]){
    await page.evaluate(id=>__ensemble.presets.view.select(id),id); await page.waitForTimeout(180);
    expect(await page.evaluate(()=>__ensemble.state.speed)).toBeGreaterThanOrEqual(.18);
    const signal=await sampleAudioEnvelope(page,{durationMs:1200});
    expect(signal.summary.maxRms,id).toBeGreaterThan(.0005); expect(signal.summary.clippedSamples,id).toBe(0);
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed","true");
  }
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Next, Random and legacy scenes cannot inherit an old phase or reader choice",async({page,baseURL})=>{
  const diagnostics=watchPageDiagnostics(page,{baseURL}); await instrument(page);
  for(const button of [".header-preset-next",".header-preset-random"]){
    await page.locator("#position").fill("0.63");
    await page.locator(button).click();
    const s=await page.evaluate(()=>({position:__ensemble.state.position,direction:__ensemble.state.direction}));
    expect(s.position).toBe(s.direction>0 ? 0 : 1-1e-9);
  }
  await page.evaluate(()=>__ensemble.presets.view.select("continuous-8"));
  await expect(page.locator("#readerMode")).toHaveValue("regions");
  await page.locator("#position").fill("0.67");
  await page.evaluate(()=>{
    const legacy=structuredClone(__ensemble.snapshot);delete legacy.shared.readerMode;
    __ensemble.applyFullPreset(legacy);
  });
  await expect(page.locator("#readerMode")).toHaveValue("end-to-end");
  expect(await page.evaluate(()=>__ensemble.state.position)).toBe(0);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("cross-mode preset recall still sounds the first root note after engine preparation",async({page,baseURL})=>{
  const diagnostics=watchPageDiagnostics(page,{baseURL}); await instrument(page);
  await page.locator("#audioButton").click();await page.waitForFunction(()=>__ensemble.synthPool.enabled);
  await page.locator("#playButton").click();
  for(const outgoing of ["continuous-1","triggers-1"]){
    await page.evaluate(id=>__ensemble.presets.view.select(id),outgoing);
    await page.waitForFunction(mode=>__ensemble.clock?.playingMode===mode,outgoing.split("-")[0]);
    await page.locator("#position").fill("0.57");await page.waitForTimeout(120);
    await page.evaluate(()=>{__ensemble.notes=[];__ensemble.presets.view.select("notes-1");});
    await page.waitForFunction(()=>__ensemble.notes.length>0);
    const first=await page.evaluate(()=>__ensemble.notes[0]);
    expect(first.voices).toHaveLength(1);
    expect(first.voices[0].key).toBe("l-system-suite:note:0:l-system:6:0:0");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed","true");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed","true");
  }
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});


for (const [name, width, height, hasTouch] of [["desktop",1440,900,false],["portrait",390,844,true],["landscape",844,390,true]]) {
  test.describe(`${name} branch articulation`, () => {
    test.use({ viewport: { width, height }, hasTouch });
    test("default and first Continuous scene repeat envelopes through the final branches", async ({page,baseURL},testInfo) => {
      const diagnostics = watchPageDiagnostics(page,{baseURL});
      await instrument(page);
      await page.locator("#audioButton").click();
      await page.waitForFunction(() => __ensemble.synthPool.enabled);
      await page.locator("#playButton").click();
      for (const scene of ["default", "continuous-1"]) {
        if (scene !== "default") await page.evaluate(id => __ensemble.presets.view.select(id), scene);
        const model = await page.evaluate(async () => {
          const { lSystemsPlaybackAtPhase, lSystemsPlaybackHeads } = await import("/src/instruments/l-systems/ensemble.js");
          const { lSystemTraversalBoundaryGain } = await import("/src/instruments/l-system/l-system.js");
          const trace = __ensemble.traces.at(-1), { state } = __ensemble;
          return Array.from({length:trace.maxForkDepth+1}, (_,depth) => {
            const segment = trace.segments.find(s => s.forkDepth === depth);
            const phase = (segment.startDistance + segment.endDistance) / (2 * trace.duration);
            const heads = lSystemsPlaybackHeads(lSystemsPlaybackAtPhase(__ensemble.traces,phase,state.structureMode,state.readerMode));
            const voices = __ensemble.synthVoicesForPlayheads(heads);
            return {depth,phase,heads:heads.length,progress:heads[0].progress,
              // Separate the tiny intentional cycle-wrap fade from branch power.
              power:Math.hypot(...voices.map(v => v.gain)) / lSystemTraversalBoundaryGain(phase,state.traversalBehavior)};
          });
        });
        expect(model.map(m => m.heads)).toEqual(model.map(m => 2 ** m.depth));
        for (const m of model) {
          expect(m.progress).toBeCloseTo(.5,7);
          expect(m.power, `${scene} depth ${m.depth} should repeat the root envelope, not fade with global phase`).toBeCloseTo(model[0].power,5);
        }
        const capture = await page.evaluate(async () => {
          const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
          const meter = getSharedAudioOutputManager(globalThis), rows = [];
          const { synthPool, state } = __ensemble, began = synthPool.context.currentTime;
          let wraps = 0, previous = state.position;
          // Two boundaries cover at least one complete cycle even if startup
          // or preset preparation completed after the root had begun moving.
          while (wraps < 2 && synthPool.context.currentTime - began < 2 / state.speed + .5) {
            const phase = state.position;
            if (phase < previous - .5) wraps++;
            previous = phase;
            const heads = __ensemble.heads(), status = meter.getStatus();
            rows.push({phase,wraps,depth:heads[0]?.depth,progress:heads[0]?.progress,
              gain:Math.hypot(...__ensemble.synthPool.pendingVoices.map(v => v.gain)),
              rms:status.rms,peak:status.peak,clipped:status.clipped});
            await new Promise(resolve => setTimeout(resolve,12));
          }
          return {rows,wraps,depth:__ensemble.traces.at(-1).maxForkDepth,sampleRate:synthPool.context.sampleRate};
        });
        expect(capture.wraps).toBe(2);
        const tips = capture.rows.filter(r => r.depth === capture.depth && r.progress >= .3 && r.progress <= .8);
        expect(tips.length).toBeGreaterThan(1);
        expect(Math.max(...tips.map(r => r.gain)), `${scene}: final segments must still receive audible voices`).toBeGreaterThan(.03);
        expect(Math.max(...tips.map(r => r.rms)), `${scene}: measured audio must reach the tips`).toBeGreaterThan(.003);
        expect(capture.rows.every(r => Number.isFinite(r.rms) && Number.isFinite(r.peak) && !r.clipped)).toBe(true);
        await testInfo.attach(`${scene}-branch-cycle.json`,{body:JSON.stringify({model,...capture}),contentType:"application/json"});
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed","true");
      }
      // Manual expressiveness is preserved: short envelopes still create rests
      // within a segment and sound again at the next segment, however late it is.
      const manual = await page.evaluate(async () => {
        const { amplitudeEnvelopePreset } = await import("/src/audio.js");
        const { lSystemsPlaybackAtPhase, lSystemsPlaybackHeads } = await import("/src/instruments/l-systems/ensemble.js");
        const { state, amplitudeControl } = __ensemble, trace = __ensemble.traces.at(-1);
        const segment = trace.segments.find(s => s.forkDepth === trace.maxForkDepth);
        const gainAt = progress => {
          const phase = (segment.startDistance + progress * (segment.endDistance-segment.startDistance)) / trace.duration;
          const heads = lSystemsPlaybackHeads(lSystemsPlaybackAtPhase(__ensemble.traces,phase,state.structureMode,state.readerMode));
          return Math.hypot(...__ensemble.synthVoicesForPlayheads(heads).map(v => v.gain));
        };
        const envelope = amplitudeControl.captureState();
        amplitudeControl.applyState({...envelope,preset:"pluck",points:amplitudeEnvelopePreset("pluck")});
        const attack = gainAt(.04), rest = gainAt(.5);
        state.branchDecay = .5;
        const decayed = gainAt(.04);
        state.branchDecay = 1; amplitudeControl.applyState(envelope);
        return {attack,rest,decayed,depth:trace.maxForkDepth};
      });
      expect(manual.attack).toBeGreaterThan(.01);
      expect(manual.rest).toBe(0);
      expect(manual.decayed / manual.attack).toBeCloseTo(.5 ** manual.depth,6);
      await page.locator("#playButton").click();
      await page.waitForTimeout(400);
      expect((await readAudioStatus(page)).rms).toBeLessThan(.0001);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  });
}
