import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';
const targets = [
  { name: 'Rubix', route: '/rubix.html', prefix: '/src/instruments/rubix', scope: 'body' },
  { name: 'Rubixoids 3D', route: '/rubixoids.html?dimension=3d', prefix: '/src/instruments/rubixoids/rubix', scope: '.rubixoids-pane[data-dimension="3d"]', owned: true },
];
const set = (scope, key, value) => scope.locator(`[data-bank-param="${key}"]`).evaluate((input, value) => {
  input.value = String(value); input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true}));
}, value);
const capture = page => page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState().snapshot);
for (const target of targets) {
  for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]) test(`${target.name} bank controls follow selection at ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(target.route); const scope=page.locator(target.scope);
    const banks=await scope.locator('#soundBank option').evaluateAll(options=>options.map(option=>option.value));
    for (const bank of banks) {
      await scope.locator('#soundBank').selectOption(bank);
      if(bank==='acid-303') {
        await expect(scope.locator('#acidBankControls')).toBeVisible();
        await expect(scope.locator('#kitBankControls')).toBeHidden();
        await expect(scope.locator('#cutoff')).toBeEnabled();
      } else {
        await expect(scope.locator('#acidBankControls')).toBeHidden();
        await expect(scope.locator('#kitBankControls')).toBeVisible();
        expect(await scope.locator('[data-bank-param]').count()).toBeGreaterThan(4);
        await scope.locator('[data-bank-param="pan"]').scrollIntoViewIfNeeded();
        await expect(scope.locator('[data-bank-param="pan"]')).toBeInViewport();
      }
    }
    for(const selector of ['#faceBadges','#stageReadout','#gestureHint','#soundBankState','#soundBankSummary','#soundBankHelp']) await expect(scope.locator(selector)).toBeHidden();
    expect(await scope.locator('#faceBadges').evaluate(node=>node.children.length)).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
    await scope.locator('#soundBank').selectOption('soft-fm');
    await scope.locator('#soundBank').scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('bank-controls.png')});
    expect(errors).toEqual([]);
  });

  test(`${target.name} retains separate bank settings, preset compatibility and dimension state`, async ({page})=>{
    await page.goto(target.route); const scope=page.locator(target.scope);
    await set(scope,'fmDepth',2); await set(scope,'toneOffset',.2);
    await scope.locator('#soundBank').selectOption('shared-simd-chiptune');
    await set(scope,'rootHz',144); await set(scope,'tuning','harmonic'); await set(scope,'attack',.02);
    await scope.locator('#soundBank').selectOption('soft-fm');
    await expect(scope.locator('#bank-fmDepth')).toHaveValue('2');
    const edited=await capture(page);
    await page.evaluate(async ({prefix,params})=>{
      const {rubixoidsNative}=await import(`${prefix}/rubix-app.js`);
      await rubixoidsNative.applySettings({bankParams:null});
      await rubixoidsNative.applySettings({bankParams:params});
    },{prefix:target.prefix,params:edited.bankParams});
    expect(await capture(page)).toEqual(edited);
    if(target.owned) {
      await page.locator('.rubixoids-dimensions [data-dimension="4d"]').click();
      await page.locator('.rubixoids-dimensions [data-dimension="3d"]').click();
      await expect(scope).toBeVisible();
      await expect(page.locator('body > .masthead #audioButton')).toBeEnabled();
      expect((await capture(page)).bankParams).toEqual(edited.bankParams);
    }
    await page.locator('.header-preset-picker > summary').click();
    await page.locator('.header-preset-picker input[type="search"]').fill('classic');
    await expect(page.locator('.header-preset-picker')).toHaveAttribute('open','');
    await page.locator('[data-preset-id="classic"]').click();
    expect((await capture(page)).bankParams).toBeUndefined();
    await expect(scope.locator('#bank-fmDepth')).toHaveValue('1');
    await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id','classic');
    await page.locator('.header-preset-picker > summary').press('ArrowRight');
    await expect(page.locator('.header-preset-controls')).not.toHaveAttribute('data-preset-id','classic');
    await page.locator('.header-preset-picker > summary').press('ArrowLeft');
    await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id','classic');
    await page.locator('.header-preset-picker > summary').click();
    await expect(page.locator('.header-preset-picker')).toHaveAttribute('open','');
    await scope.locator('#soundBank').click();
    await scope.locator('#soundBank').press('Escape');
    await expect(page.locator('.header-preset-picker')).not.toHaveAttribute('open','');
    await set(scope,'fmDepth',2); await scope.locator('#resetSound').click();
    expect((await capture(page)).bankParams).toBeUndefined();
  });

  test(`${target.name} live native and shared sound edits preserve scheduled notes`, async ({page},info)=>{
    test.setTimeout(90000); const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(target.route);const scope=page.locator(target.scope);
    await page.evaluate(async prefix=>{
      const {RubixAudioEngine}=await import(`${prefix}/rubix-app.js`);
      const p=globalThis.__bankProbe={notes:[],transports:[],silent:0};
      const build=RubixAudioEngine.prototype.buildGraph;
      RubixAudioEngine.prototype.buildGraph=function(...args){p.engine=this;return build.apply(this,args);};
      const schedule=RubixAudioEngine.prototype.scheduleDrum;
      RubixAudioEngine.prototype.scheduleDrum=function(index,when,gain,bank,sticker){
        if(sticker?.id.startsWith('up:')) p.notes.push({when,step:sticker.homeRow*3+sticker.homeColumn});
        if(!bank.startsWith('shared-')&&!Array.isArray(this.kitBuffers.get(bank)))p.silent++;
        return schedule.apply(this,arguments);
      };
      const transport=RubixAudioEngine.prototype.setTransportActive;
      RubixAudioEngine.prototype.setTransportActive=function(active){p.transports.push({active,time:this.context?.currentTime});return transport.apply(this,arguments);};
    },target.prefix);
    await page.locator('body > .masthead #audioButton').click();
    await expect(page.locator('body > .masthead #audioButton')).toHaveAttribute('aria-pressed','true');
    await scope.locator('#playButton').click();
    for(const bank of ['soft-fm','rattlesnake','pitched-morph','karplus-strong','shared-simd-chiptune']) {
      await scope.locator('#soundBank').selectOption(bank);
      await expect(scope.locator('#playButton')).toHaveAttribute('aria-pressed','true');
      const key=bank==='soft-fm'?'fmDepth':bank==='karplus-strong'?'length':bank.startsWith('shared-')?'brightness':'hardness';
      await scope.locator(`[data-bank-param="${key}"]`).evaluate(async input=>{
        const p=globalThis.__bankProbe;p.start=p.engine.context.currentTime;p.notes=[];p.transports=[];
        for(let i=0;i<40;i++){
          input.value=String(Number(input.min)+(Number(input.max)-Number(input.min))*(i%2?.35:.75));
          input.dispatchEvent(new Event('input',{bubbles:true}));
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        await new Promise(resolve=>setTimeout(resolve,500));
      });
      const evidence=await page.evaluate(()=>{
        const p=globalThis.__bankProbe;
        return {silent:p.silent,transports:p.transports,gaps:p.notes.slice(1).map((note,index)=>note.when-p.notes[index].when),bad:p.notes.slice(1).filter((note,index)=>note.step!==(p.notes[index].step+1)%9).length};
      });
      expect(evidence.silent,bank).toBe(0);expect(evidence.transports,bank).toEqual([]);expect(evidence.bad,bank).toBe(0);
      expect(Math.max(...evidence.gaps),bank).toBeLessThan(.22);
      const envelope=await sampleAudioEnvelope(page,{durationMs:350});
      expect(envelope.summary.finite).toBe(true);expect(envelope.summary.maxPeak).toBeGreaterThan(.001);expect(envelope.summary.clippedSamples).toBe(0);
      await info.attach(`${bank}-continuity.json`,{body:JSON.stringify({evidence,envelope:envelope.summary}),contentType:'application/json'});
    }
    await scope.locator('#playButton').click(); await page.locator('body > .masthead #audioButton').click();
    expect(errors).toEqual([]);
  });
}

test('native bank sound controls change finite rendered audio at their endpoints', async ({page}, info) => {
  test.setTimeout(90000);
  await page.goto('/rubix.html');
  const results=await page.evaluate(async ()=>{
    const {MorphazoidDrumRenderer}=await import('/src/families/percussion/drum-renderer.js');
    const {DEFAULT_FM_DRUM_VOICES,sanitizeFmDrumVoice}=await import('/src/instruments/fm-drums/fm-drums.js');
    const {renderRubixExtraDrum,normalizeRubixDrumBuffer}=await import('/src/instruments/rubix/rubix-percussion.js');
    const {RUBIX_BANK_CONTROLS,rubixBankDefaults,rubixVoiceWithParams,rubixExtraSettings}=await import('/src/instruments/rubix/sound-params.js');
    const source=DEFAULT_FM_DRUM_VOICES.find(voice=>voice.family==='snare');
    const render=async (bank,params)=>{
      const context=new OfflineAudioContext(2,21600,12000);
      const voice=sanitizeFmDrumVoice(rubixVoiceWithParams(source,params));
      let buffer;
      const originalRandom=Math.random; Math.random=()=>.37;
      try {
        if(['rattlesnake','pitched-morph'].includes(bank)) buffer=await renderRubixExtraDrum(context,voice,bank,rubixExtraSettings(bank,params));
        else {
          const noise=context.createBuffer(1,24000,12000);let seed=123;
          const samples=noise.getChannelData(0);for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;samples[i]=seed/2**31-1;}
          const renderer=new MorphazoidDrumRenderer(context,noise,()=>.37);
          renderer[{ 'soft-fm':'scheduleFmDrum',analog:'scheduleAnalogDrum',modal:'scheduleModalDrum',noise:'scheduleNoiseDrum'}[bank]](voice,0,1,context.destination);
          buffer=await context.startRendering();
        }
      } finally {Math.random=originalRandom;}
      normalizeRubixDrumBuffer(buffer);
      return buffer.getChannelData(0);
    };
    const results=[];
    for(const bank of ['soft-fm','analog','modal','noise','rattlesnake','pitched-morph']) {
      const params=rubixBankDefaults(bank);const baseline=await render(bank,params);
      for(const control of RUBIX_BANK_CONTROLS[bank].filter(control=>control.render)) {
        const values=control.options?control.options.map(([id])=>id):[control.min,control.max];
        let difference=0,peak=0,finite=true;
        for(const value of values){
          const audio=await render(bank,{...params,[control.key]:value});let error=0;
          for(let i=0;i<audio.length;i++){finite&&=Number.isFinite(audio[i]);peak=Math.max(peak,Math.abs(audio[i]));error+=(audio[i]-baseline[i])**2;}
          difference=Math.max(difference,Math.sqrt(error/audio.length));
        }
        results.push({bank,key:control.key,difference,peak,finite});
      }
    }
    return results;
  });
  for(const result of results){
    expect(result.finite,`${result.bank}:${result.key}`).toBe(true);
    expect(result.peak).toBeLessThanOrEqual(.651);
    expect(result.difference,`${result.bank}:${result.key}`).toBeGreaterThan(.00001);
  }
  await info.attach('native-parameter-audio.json',{body:JSON.stringify(results),contentType:'application/json'});
});


for (const target of targets) test(`${target.name} Play waits for explicit Audio preparation and remains cancellable`, async ({page}) => {
  test.setTimeout(90000);
  for (const action of ['start', 'cancel-play', 'cancel-audio', ...(target.owned ? ['switch-dimension'] : [])]) {
    await page.goto(target.route);
    const scope = page.locator(target.scope);
    const audioButton = page.locator('body > .masthead #audioButton');
    await scope.locator('#playButton').click();
    await expect(audioButton).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(async prefix => {
      const {RubixAudioEngine} = await import(`${prefix}/rubix-app.js`);
      const probe = globalThis.__startup = { held: false, starts: 0 };
      const prepare = RubixAudioEngine.prototype.prepareKit;
      RubixAudioEngine.prototype.prepareKit = async function (...args) {
        if (!probe.held) {
          probe.held = true;
          await new Promise(resolve => { probe.release = resolve; });
        }
        return prepare.apply(this, args);
      };
      const transport = RubixAudioEngine.prototype.setTransportActive;
      RubixAudioEngine.prototype.setTransportActive = function (active) {
        if (active) probe.starts++;
        return transport.apply(this, arguments);
      };
    }, target.prefix);
    await audioButton.click();
    await page.waitForFunction(() => globalThis.__startup?.held);
    await scope.locator('#playButton').click();
    await expect(scope.locator('#playButton')).toHaveAttribute('aria-busy', 'true');
    if (action === 'cancel-play') await scope.locator('#playButton').click();
    if (action === 'cancel-audio') await audioButton.click();
    if (action === 'switch-dimension') await page.locator('.rubixoids-dimensions [data-dimension="4d"]').click();
    await page.evaluate(() => globalThis.__startup.release());
    if (action === 'switch-dimension') {
      await expect(page.locator('.rubixoids-pane[data-dimension="4d"]')).toBeVisible();
      await expect(page.locator('body > .masthead #audioButton')).toBeEnabled();
    } else {
      await expect(audioButton).toHaveAttribute('aria-pressed', String(action !== 'cancel-audio'));
    }
    await expect(scope.locator('#playButton')).not.toHaveAttribute('aria-busy', 'true');
    await expect(scope.locator('#playButton')).toHaveAttribute('aria-pressed', String(action === 'start'));
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => globalThis.__startup.starts), action).toBe(action === 'start' ? 1 : 0);
  }
});
