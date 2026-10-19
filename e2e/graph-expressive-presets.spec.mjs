import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { watchPageDiagnostics, pageDiagnosticMessages } from './helpers/diagnostics.mjs';
const owners = [ ['drums', 'graph-drum-machine'], ['synth', 'graph-synth'] ];
async function observe(page, mode, id) {
  await page.route(`**/src/instruments/${id}/${id}-app.js*`, async route => {
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace(`initializeGraphInstrument({ mode: "${mode}" });`, `globalThis.__graphStudy = initializeGraphInstrument({ mode: "${mode}" });`)});
  });
}
async function bankFor(page, mode, prefix='') {
  return page.evaluate(async ({mode,prefix}) => {
    const {graphInstrumentDefaultState}=await import(`${prefix}/src/families/graph/graph-instrument-app.js`);
    const defaults=graphInstrumentDefaultState(mode);
    if(mode==='drums') return (await import(`${prefix}/src/families/graph-presets/drum-full-presets.js`)).GRAPH_DRUM_FULL_PRESETS;
    return (await import(`${prefix}/src/families/graph-presets/full-presets.js`)).graphSynthFullPresets(defaults);
  },{mode,prefix});
}
for(const prefix of ['']) for(const [mode,id] of owners) {
  test(`${prefix || 'source'} ${id}: twenty new scenes preserve paused/live pulses and explicit audition`,async({page,baseURL})=>{
    const diagnostics=watchPageDiagnostics(page,{baseURL}); await observe(page,mode,id);
    await page.goto(`${prefix}/${id}.html`); await expect(page.locator('.header-preset-picker')).toBeVisible();
    const bank=await bankFor(page,mode,prefix); expect(bank).toHaveLength(mode === 'drums' ? 34 : 32);
    const recall=async preset=>page.evaluate(async({preset,prefix})=>{
      const {captureHeaderPresetState}=await import(`${prefix}/src/site/header-presets.js`);
      const app=__graphStudy;
      const read=()=>({audio:app.state.audio,playing:app.state.playing,pulses:app.pulseCount,deadline:app.scheduledPulseTime,active:app.activeRunCount,phase:app.state.nodeMotionPhase,output:app.mode==='drums'?app.state.output:null});
      const before=read(); document.querySelector(`[data-full-preset][data-preset-id="${preset.id}"]`).click();
      return {before,after:read(),snapshot:captureHeaderPresetState().snapshot};
    },{preset,prefix});
    for(const preset of bank.slice(mode === 'drums' ? 14 : 12)) {
      const result=await recall(preset); expect(result.after).toEqual(result.before);
      expect(result.after.audio).toBe(false); expect(result.after.playing).toBe(false); expect(result.after.pulses).toBe(0);
      expect(result.snapshot).toEqual(preset.snapshot);
    }
    await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
    await recall(bank[mode === 'drums' ? 14 : 12]);
    const before=await page.evaluate(()=>__graphStudy.pulseCount);
    await page.locator('#pulseButton').click();
    await expect.poll(()=>page.evaluate(()=>__graphStudy.pulseCount)).toBe(before+1);
    expect(await page.evaluate(()=>__graphStudy.state.playing)).toBe(false);
    await page.locator('#playButton').click(); await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','true');
    await expect.poll(()=>page.evaluate(()=>__graphStudy.pulseCount)).toBeGreaterThan(before+1);
    for(const preset of bank.slice(mode === 'drums' ? 14 : 12)) {
      const result=await recall(preset); expect(result.after).toEqual(result.before); expect(result.after.playing).toBe(true);
      expect(result.snapshot).toEqual(preset.snapshot);
    }
    await page.locator('.header-preset-random').click(); await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id','custom');
    await page.locator('.header-preset-next').click(); await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id',bank[0].id);
    await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
    for (const [seed, next] of [[424, 425], [999, 1]]) {
      await page.evaluate(seed => {
        const input = document.querySelector('#seed');
        input.value = String(seed); input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#newGraphButton').click();
      }, seed);
      await expect(page.locator('#seed')).toHaveValue(String(next));
    }
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}
for(const [mode,id] of owners) test(`${id}: all twenty additions produce bounded sound with a fresh audio context for each scene`,async({page,baseURL},testInfo)=>{
  test.setTimeout(210000);
  const diagnostics=watchPageDiagnostics(page,{baseURL}); await observe(page,mode,id);
  await page.goto(`/${id}.html`); await expect(page.locator('.header-preset-picker')).toBeVisible();
  const bank=(await bankFor(page,mode)).slice(mode === 'drums' ? 14 : 12), rows=[];
  try {
    for(const preset of bank) for(let repeat=0;repeat<1;repeat++) {
      await page.evaluate(id=>document.querySelector(`[data-full-preset][data-preset-id="${id}"]`).click(),preset.id);
      await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
      const result=await page.evaluate(async()=>{
        const app=__graphStudy;
        const {getSharedAudioOutputManager}=await import('/src/audio-output-manager.js');
        const manager=getSharedAudioOutputManager(globalThis);
        const before=app.soundedEventCount, shed=app.shedAudioEventCount;
        document.querySelector('#playButton').click();
        const samples=[], start=performance.now();
        while(performance.now()-start<2000) {
          const {peak,rms,clipped}=manager.getStatus(); samples.push({peak,rms,clipped});
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        return {sampleCount:samples.length, finite:samples.every(s=>Number.isFinite(s.peak)&&Number.isFinite(s.rms)),clipped:samples.some(s=>s.clipped),
          maxPeak:Math.max(...samples.map(s=>s.peak)),maxRms:Math.max(...samples.map(s=>s.rms)),meanRms:samples.reduce((sum,s)=>sum+s.rms,0)/samples.length,
          sounded:app.soundedEventCount-before,shed:app.shedAudioEventCount-shed,protected:app.audioProtected, master:app.state.output, sampleRates:[...manager.contexts.values()].map(record=>record.context.sampleRate)};
      });
      rows.push({id:preset.id,label:preset.label,repeat,...result});
      expect(result.finite,preset.label).toBe(true); expect(result.clipped,preset.label).toBe(false);
      expect(result.maxPeak,preset.label).toBeGreaterThan(.01); expect(result.maxRms,preset.label).toBeGreaterThan(.004);
      expect(result.sounded,preset.label).toBeGreaterThan(0); expect(result.protected,preset.label).toBe(false);
      expect(result.shed,preset.label).toBe(0);
      await page.locator('#playButton').click(); await page.locator('#audioButton').click();
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
      expect(await page.evaluate(async()=>{
        const {getSharedAudioOutputManager}=await import('/src/audio-output-manager.js');
        return getSharedAudioOutputManager(globalThis).getStatus().connectionCount;
      })).toBe(0);
    }
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  } finally {
    const evidence = testInfo.outputPath(`${id}-expressive-levels.json`);
    await writeFile(evidence, JSON.stringify({durationMs:2000,browser:page.context().browser().version(),mode:'Pulse Tempo; each trial begins with closed engines',rows},null,2));
    await testInfo.attach(`${id}-expressive-levels.json`,{path:evidence,contentType:'application/json'});
  }
});
for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]) test.describe(`${viewport.width}`,()=>{
  test.use({viewport,hasTouch:viewport.width<900});
  for(const [mode,id] of owners) test(`${id}: expanded menu, tempo and one-shot pulse remain reachable`,async({page})=>{
    await observe(page,mode,id); await page.goto(`/${id}.html`);
    const bank=await bankFor(page,mode);
    await page.locator('.header-preset-picker > summary').click();
    const last=page.locator(`[data-full-preset][data-preset-id="${bank.at(-1).id}"]`);
    await last.scrollIntoViewIfNeeded(); await expect(last).toBeInViewport(); await last.click();
    for(const selector of ['#playButton','#tempo','#pulseButton','.header-preset-next','.header-preset-random']) {
      await page.locator(selector).scrollIntoViewIfNeeded(); await expect(page.locator(selector)).toBeInViewport();
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width+1);
  });
});
