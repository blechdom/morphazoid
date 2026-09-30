import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';

async function instrumentAudio(page) {
  await page.route('**/spelling-synthesizer-app.js', async route => {
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace('const audio = new SpellingSynthesizerAudio', 'const audio = window.__spellingTestAudio = new SpellingSynthesizerAudio')});
  });
}

for(const [name,viewport] of Object.entries({desktop:{width:1440,height:900},portrait:{width:390,height:844},landscape:{width:844,height:390}})) {
  test(`spelling ${name}: large frontal mouth and editor stay together while rail scrolls`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.goto('spelling-synthesizer.html');
    await expect(page.locator('#mouthGraphic')).toBeVisible();
    await expect(page.locator('#letterTrail, #engineIndex, .spelling-engine-note, .spelling-history-note')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('one interface, three synthesis models');
    await expect(page.locator('[data-engine=tube]')).toContainText('Pinkazoid');
    await expect(page.locator('.header-preset-controls')).toBeVisible();
    const seam=await page.evaluate(()=>{
      const rect=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
      return {header:rect('.masthead'),shell:rect('.spelling-shell'),stage:rect('.spelling-composer'),
        panel:rect('.spelling-panel'),presets:rect('.header-preset-controls'),section:rect('.spelling-control-block')};
    });
    expect(seam.shell.left).toBe(0);
    expect(seam.shell.right).toBe(viewport.width);
    expect(seam.shell.top).toBe(seam.header.bottom);
    expect(seam.shell.bottom).toBe(viewport.height);
    expect(seam.stage.left).toBe(seam.shell.left);
    expect(seam.stage.top).toBe(seam.shell.top);
    expect(seam.panel.right).toBe(seam.shell.right);
    expect(seam.panel.bottom).toBe(seam.shell.bottom);
    if(viewport.width<=700) {
      expect(seam.stage.bottom).toBeCloseTo(seam.panel.top,1);
      expect(seam.stage.right).toBe(seam.shell.right);
      expect(seam.panel.left).toBe(seam.shell.left);
    } else {
      expect(seam.stage.right).toBeCloseTo(seam.panel.left,1);
      expect(seam.stage.bottom).toBe(seam.shell.bottom);
      expect(seam.panel.top).toBe(seam.shell.top);
    }
    for(const edge of ['left','right','top']) expect(seam.presets[edge]).toBeCloseTo(seam.panel[edge],1);
    expect(seam.section.top).toBeCloseTo(seam.presets.bottom,1);
    expect(seam.section.left).toBe(seam.panel.left);
    expect(seam.section.right).toBe(seam.panel.right);
    const bounds=await page.evaluate(()=>{
      const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom}};
      const stage=box('#voiceStage'),input=box('#spellingInput'),before=box('[data-cooking-stage]');
      const panel=document.querySelector('[data-cooking-panel]');panel.scrollTop=panel.scrollHeight;
      return {stage,input,before,after:box('[data-cooking-stage]'),play:box('#readbackButton'),loop:box('#readbackLoop'),speed:box('.spelling-readback-speed'),overflow:document.documentElement.scrollWidth-innerWidth,
        inGraphic:document.getElementById('spellingInput').closest('[data-cooking-stage]')!==null};
    });
    expect(bounds.inGraphic).toBe(true);
    expect(bounds.stage.w).toBeGreaterThan(viewport.width>1000?700:280);
    expect(bounds.stage.h).toBeGreaterThan(130);
    expect(bounds.input.y).toBeGreaterThanOrEqual(bounds.stage.b-1);
    expect(bounds.play.b).toBeLessThanOrEqual(viewport.height);
    expect(bounds.play.w).toBeGreaterThanOrEqual(48);
    expect(bounds.loop.w).toBeGreaterThanOrEqual(48);
    expect(bounds.loop.h).toBeGreaterThanOrEqual(48);
    expect(bounds.loop.y).toBe(bounds.play.y);
    expect(bounds.loop.x).toBeGreaterThan(bounds.play.x + bounds.play.w);
    expect(bounds.loop.b).toBeLessThanOrEqual(viewport.height);
    expect(Math.abs((bounds.speed.y + bounds.speed.h / 2) - (bounds.loop.y + bounds.loop.h / 2))).toBeLessThanOrEqual(1);
    expect(bounds.speed.x).toBeGreaterThan(bounds.loop.x + bounds.loop.w);
    expect(bounds.speed.b).toBeLessThanOrEqual(viewport.height);
    await expect(page.locator('#readbackSpeed')).toBeVisible();

    expect(bounds.before).toEqual(bounds.after);
    expect(bounds.overflow).toBeLessThanOrEqual(1);
    const sticky=await page.locator('.header-preset-controls').boundingBox();
    expect(sticky.y).toBeCloseTo(seam.panel.top,1);
    for(const selector of ['.header-preset-next','.header-preset-random']) {
      await expect(page.locator(selector)).toBeInViewport();
      await page.locator(selector).click();
      await expect(page.locator(selector)).toBeEnabled();
    }
    await expect(page.locator('#readbackButton')).toHaveAttribute('aria-pressed','false');
    await page.locator('#spellingInput').press('a');
    await expect(page.locator('#currentLetter')).toHaveText('A');
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
    await page.screenshot({path:`test-results/spelling-mouth/accepted-${name}.png`});
  });
}

test('typed phones visibly open, round and close the wireframe without arming Audio', async ({page}) => {
  await page.goto('spelling-synthesizer.html');
  await page.locator('#pairGlidesButton').click();
  const rest=await page.locator('#mouthLips').getAttribute('d');
  await page.locator('#spellingInput').press('a');
  await expect(page.locator('#voiceStage')).toHaveAttribute('data-phone','a');
  await page.waitForTimeout(85);
  const open=await page.locator('#mouthLips').getAttribute('d');
  expect(open).not.toBe(rest);
  await page.locator('#spellingInput').press('m');
  await expect(page.locator('#voiceStage')).toHaveAttribute('data-phone','m');
  await page.waitForTimeout(85);
  expect(await page.locator('#mouthLips').getAttribute('d')).not.toBe(open);
  await page.locator('#clearButton').click();
  await expect(page.locator('#voiceStage')).toHaveAttribute('data-phone','rest');
  expect(await page.locator('#mouthLips').getAttribute('d')).toBe(rest);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
});

for (const engine of ['tube','diphone','vocoder','bell','lpc']) {
  test(`${engine}: mouth follows each sounded readback phone and stops with Audio`, async ({page},testInfo) => {
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await instrumentAudio(page);
    await page.goto('spelling-synthesizer.html');
    await page.locator(`[data-engine=${engine}]`).click();
    await page.locator('#spellingInput').fill('cat');
    await page.locator('#audioButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
    await page.evaluate(()=>{
      const audio=window.__spellingTestAudio, original=audio.articulate.bind(audio);
      window.__spoken=[];window.__mouthPhones=[];
      audio.articulate=event=>{const played=original(event);if(played)window.__spoken.push(event.articulation);return played;};
      new MutationObserver(records=>{
        for(const r of records) if(r.attributeName==='data-phone')window.__mouthPhones.push(document.getElementById('voiceStage').dataset.phone);
      }).observe(document.getElementById('voiceStage'),{attributes:true});
    });
    await page.locator('#readbackButton').click();
    const envelope=await sampleAudioEnvelope(page,{durationMs:900,intervalMs:30});
    await testInfo.attach(`${engine}-envelope.json`,{body:JSON.stringify(envelope),contentType:'application/json'});
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
    expect(envelope.summary.clippedSamples).toBe(0);
    await expect(page.locator('#readbackButton')).toHaveAttribute('aria-label','Read it again');
    const observed=await page.evaluate(()=>({spoken:window.__spoken,visual:window.__mouthPhones.filter(p=>p!=='rest')}));
    expect(observed.spoken).toEqual(['k','a','t']);
    expect(observed.visual).toEqual(observed.spoken);
    // Held vowels remain visible beyond the usual one-shot timeout.
    await page.locator('#spellingInput').press('e');
    await page.locator('#spellingInput').dispatchEvent('keydown',{key:'e',code:'KeyE',repeat:true});
    await page.waitForTimeout(500);
    await expect(page.locator('#voiceStage')).toHaveAttribute('data-phone','e');
    await page.locator('#spellingInput').dispatchEvent('keyup',{key:'e',code:'KeyE'});
    await expect(page.locator('#voiceStage')).toHaveAttribute('data-phone','rest');
    await page.locator('#audioButton').click();
    await expect(page.locator('#voiceStage')).toHaveAttribute('data-phone','rest');
    await waitForStableAudioState(page,false);
    expect(errors).toEqual([]);
  });
}

test('KAL advertises tone-only controls; Pinkazoid and Voxazoid retain personalities', async ({page}) => {
  await page.goto('spelling-synthesizer.html');
  await expect(page.locator('#personalityLabel')).toHaveText('Sample tone');
  await expect(page.locator('[data-personality=whisper] b')).toHaveText('Bright');
  await expect(page.locator('#personalityNote')).toContainText('recorded voice');
  for(const engine of ['tube','vocoder']) {
    await page.locator(`[data-engine=${engine}]`).click();
    await expect(page.locator('#personalityLabel')).toHaveText('Personality');
    await expect(page.locator('[data-personality=whisper] b')).toHaveText('Whisper');
  }
  await page.locator('[data-engine=diphone]').click();
  await expect(page.locator('#personalityLabel')).toHaveText('Sample tone');
});

test('Speak & Spell-ish recalls a complete scene without replacing text or master level', async ({page}) => {
  await page.goto('spelling-synthesizer.html');
  await page.locator('#spellingInput').fill('My own spelling toy');
  await page.locator('.header-preset-picker summary').click();
  await page.locator('.header-preset-controls [data-preset-id="speak-spell"]').click();
  await expect(page.locator('[data-engine=vocoder]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-personality=reed]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#rhythmAmount')).toHaveValue('0');
  await expect(page.locator('#diphthongDelay')).toHaveValue('0');
  await expect(page.locator('#spellingInput')).toHaveValue('My own spelling toy');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#level')).toHaveValue('0.46');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#readbackButton').click();
  const envelope=await sampleAudioEnvelope(page,{durationMs:700,intervalMs:30});
  expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.clippedSamples).toBe(0);
});

test('mouth animation cancels on pagehide and does not restart when restored', async ({page}) => {
  await page.route('**/spelling-synthesizer-app.js', async route => {
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text())+'\nwindow.__mouthFrameForTest=()=>mouthFrame;\n'});
  });
  await page.goto('spelling-synthesizer.html');
  await page.locator('#pairGlidesButton').click();
  await page.locator('#spellingInput').press('a');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await expect(page.locator('#voiceStage')).toHaveAttribute('data-phone','rest');
  expect(await page.evaluate(()=>window.__mouthFrameForTest())).toBe(0);
  const pose=await page.locator('#mouthLips').getAttribute('d');
  await page.waitForTimeout(200);
  expect(await page.locator('#mouthLips').getAttribute('d')).toBe(pose);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
  await page.locator('#spellingInput').press('a');
  await expect(page.locator('#voiceStage')).toHaveAttribute('data-phone','a');
});


async function observeReadback(page, engine = 'diphone') {
  await instrumentAudio(page);
  await page.goto('spelling-synthesizer.html');
  await page.locator(`[data-engine=${engine}]`).click();
  await page.locator('#spellingInput').fill('cat.');
  await page.evaluate(() => {
    window.__readbackPhones = [];
    const audio = window.__spellingTestAudio;
    const articulate = audio.articulate.bind(audio);
    audio.articulate = event => {
      const played = articulate(event);
      if (played && event.wordSpeech) window.__readbackPhones.push(event.articulation);
      return played;
    };
  });
}

for (const engine of ['tube', 'diphone', 'vocoder', 'bell', 'lpc']) {
  test(`${engine}: Loop repeats complete readback and Loop off finishes the current pass`, async ({page}) => {
    await observeReadback(page, engine);
    const loop = page.locator('#readbackLoop'), play = page.locator('#readbackButton');
    await expect(loop).toHaveAttribute('aria-pressed', 'false');
    await loop.focus();
    await loop.press('Space');
    await expect(loop).toHaveAttribute('aria-pressed', 'true');
    await play.click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => window.__readbackPhones)).toEqual([]);
    await page.locator('#audioButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await play.click();
    await expect.poll(() => page.evaluate(() => window.__readbackPhones.length)).toBeGreaterThanOrEqual(6);
    expect(await page.evaluate(() => window.__readbackPhones.slice(0, 6))).toEqual(['k', 'a', 't', 'k', 'a', 't']);
    await expect(play).toHaveAttribute('aria-pressed', 'true');
    await loop.click();
    await expect(play).toHaveAttribute('aria-label', 'Read it again');
    const count = await page.evaluate(() => window.__readbackPhones.length);
    expect(count % 3).toBe(0);
    await page.waitForTimeout(650);
    expect(await page.evaluate(() => window.__readbackPhones.length)).toBe(count);
  });
}

test('readback Loop survives presets and Random without replacing text, level or transport', async ({page}) => {
  await observeReadback(page);
  await page.locator('#readbackLoop').click();
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#readbackButton').click();
  await expect.poll(() => page.evaluate(() => window.__readbackPhones.length)).toBeGreaterThanOrEqual(3);
  await page.locator('.header-preset-picker summary').click();
  await page.locator('.header-preset-controls [data-preset-id="speak-spell"]').click();
  await expect(page.locator('[data-engine=vocoder]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#readbackButton')).toHaveAttribute('aria-label', 'Pause readback');
  for (const selector of ['.header-preset-next', '.header-preset-random']) {
    await page.locator(selector).click();
    await expect(page.locator('#readbackLoop')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#readbackButton')).toHaveAttribute('aria-label', 'Pause readback');
    await expect(page.locator('#spellingInput')).toHaveValue('cat.');
    await expect(page.locator('#level')).toHaveValue('0.46');
    const count = await page.evaluate(() => window.__readbackPhones.length);
    await expect.poll(() => page.evaluate(() => window.__readbackPhones.length)).toBeGreaterThan(count + 3);
  }
});

test('readback Loop is cancelled by Pause, Clear, Audio off and pagehide', async ({page}) => {
  await observeReadback(page);
  await page.locator('#readbackLoop').click();
  await page.locator('#audioButton').click();
  const play = page.locator('#readbackButton');
  const settled = async () => {
    const count = await page.evaluate(() => window.__readbackPhones.length);
    await page.waitForTimeout(650);
    expect(await page.evaluate(() => window.__readbackPhones.length)).toBe(count);
    await expect(page.locator('#readbackLoop')).toHaveAttribute('aria-pressed', 'true');
  };
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause readback');
  await play.click();
  await settled();
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause readback');
  await page.locator('#clearButton').click();
  await settled();
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Read it back to me');
  await page.locator('#spellingInput').fill('cat.');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause readback');
  await page.locator('#audioButton').click();
  await settled();
  await waitForStableAudioState(page, false);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause readback');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true})));
  await settled();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true})));
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#resetButton').click();
  await expect(page.locator('#readbackLoop')).toHaveAttribute('aria-pressed', 'false');
});

for (const engine of ['bell','lpc']) {
  test(`${engine}: additive preset plays the real worklet without fetching KAL audio or losing Loop`,async({page})=>{
    const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>requests.push(request.url()));
    await instrumentAudio(page);await page.goto('spelling-synthesizer.html');
    await page.locator('#spellingInput').fill('Daisy, give me your answer.');
    await page.locator('#readbackLoop').click();
    await page.locator('.header-preset-picker summary').click();
    await page.locator(`[data-preset-id="${engine==='bell'?'bell-labs':'lpc-spelling'}"]`).click();
    await page.locator('#audioButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#readbackButton').click();
    const audio=await sampleAudioEnvelope(page,{durationMs:1400,intervalMs:25});
    expect(audio.summary.finite).toBe(true);expect(audio.summary.clippedSamples).toBe(0);expect(audio.summary.maxPeak).toBeGreaterThan(.005);
    expect(await page.evaluate(()=>window.__spellingTestAudio.activeEngine)).toBe(engine);
    // AudioWorklet module fetches are not reliably surfaced by page.request.
    // An active real worklet plus measured output proves the loaded backend.
    expect(await page.evaluate(engine => {
      const backend = window.__spellingTestAudio.backends[engine];
      return backend.node instanceof AudioWorkletNode && backend.mode === engine;
    }, engine)).toBe(true);
    expect(requests.some(url=>url.includes('spelling-diphone-kal16.wav'))).toBe(false);
    await expect(page.locator('#readbackLoop')).toHaveAttribute('aria-pressed','true');
    await page.locator('#audioButton').click();await waitForStableAudioState(page,false);
    expect(errors).toEqual([]);
  });
}
