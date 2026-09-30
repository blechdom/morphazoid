import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';

async function observeReadback(page, text = 'cat dog fish.') {
  await page.route('**/spelling-synthesizer-app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + `
      window.__spellingAudio = audio;
      window.__spellingReadback = readback;
      window.__spellingEvents = [];
      window.__spellingCompletedAt = null;
      new MutationObserver(() => {
        if (document.getElementById('readbackButton').getAttribute('aria-label') === 'Read it again') {
          window.__spellingCompletedAt = performance.now();
        }
      }).observe(document.getElementById('readbackButton'), { attributes: true, attributeFilter: ['aria-label'] });
      const originalArticulate = audio.articulate.bind(audio);
      audio.articulate = event => {
        const played = originalArticulate(event);
        if (played) window.__spellingEvents.push({
          at: performance.now(), engine: audio.activeEngine,
          personality: event.personality, word: event.word?.source,
          phone: event.wordPhone, articulation: event.articulation,
          emphasis: event.dynamics.emphasis, wordSpeech: Boolean(event.wordSpeech),
        });
        return played;
      };
    ` });
  });
  await page.goto('spelling-synthesizer.html');
  await page.locator('#spellingInput').fill(text);
}

async function playLoop(page) {
  await page.locator('#readbackLoop').click();
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#readbackButton').click();
  await expect(page.locator('#readbackButton')).toHaveAttribute('aria-label', 'Pause readback');
}

const events = page => page.evaluate(() => window.__spellingEvents.filter(event => event.wordSpeech));

test('tone changes keep the readback cursor and update the next phone without a preview vowel', async ({ page }) => {
  await observeReadback(page);
  await playLoop(page);
  for (const personality of ['warm', 'whisper', 'reed', 'creature', 'clear']) {
    const before = (await events(page)).length;
    await page.locator(`[data-personality=${personality}]`).click();
    await expect(page.locator('#readbackButton')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await events(page)).slice(before).some(event => event.personality === personality)).toBe(true);
    await expect(page.locator('#readbackLoop')).toHaveAttribute('aria-pressed', 'true');
  }
  expect(await page.evaluate(() => window.__spellingEvents.some(event => !event.wordSpeech))).toBe(false);
  const phones = (await events(page)).map(event => event.articulation);
  expect(phones.slice(0, 3)).toEqual(['k', 'a', 't']);
  await page.locator('#readbackButton').click();
});

test('changing all five engines preserves Play, Loop, text and level', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await observeReadback(page);
  await playLoop(page);
  await page.evaluate(() => {
    window.__stoppedDuringSelection = false;
    new MutationObserver(() => {
      if (document.getElementById('readbackButton').getAttribute('aria-pressed') !== 'true') {
        window.__stoppedDuringSelection = true;
      }
    }).observe(document.getElementById('readbackButton'), { attributes: true, attributeFilter: ['aria-pressed'] });
  });
  for (const engine of ['bell', 'tube', 'lpc', 'vocoder', 'diphone']) {
    const before = (await events(page)).length;
    await page.locator(`[data-engine=${engine}]`).click();
    await expect(page.locator('#readbackButton')).toHaveAttribute('aria-label', 'Pause readback');
    await expect.poll(async () => (await events(page)).slice(before).some(event => event.engine === engine)).toBe(true);
    await expect(page.locator('#readbackLoop')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#spellingInput')).toHaveValue('cat dog fish.');
    await expect(page.locator('#level')).toHaveValue('0.46');
    const envelope = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 25 });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.clippedSamples).toBe(0);
  }
  expect(await page.evaluate(() => window.__stoppedDuringSelection)).toBe(false);
  expect(await page.evaluate(() => window.__spellingEvents.some(event => !event.wordSpeech))).toBe(false);
  expect(errors).toEqual([]);
  await page.locator('#audioButton').click();
  await waitForStableAudioState(page, false);
  const closed = await page.evaluate(async () => {
    const audio = window.__spellingAudio;
    const contexts = Object.values(audio.backends).map(backend => backend.context);
    await audio.close();
    await audio.close();
    return { states: contexts.map(context => context.state),
      released: Object.values(audio.backends).every(backend => !backend.context && !backend.output) };
  });
  expect(closed.states).toEqual(['closed', 'closed', 'closed', 'closed', 'closed']);
  expect(closed.released).toBe(true);
});

for (const engine of ['tube', 'diphone', 'vocoder', 'bell', 'lpc']) {
  test(`${engine}: half/double speed changes readback pace without changing its phones`, async ({ page }) => {
    await observeReadback(page, 'cat.');
    await page.locator(`[data-engine=${engine}]`).click();
    await page.locator('#audioButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    const durations = [];
    for (const speed of [0.5, 2]) {
      await page.locator('#readbackSpeed').evaluate((el, value) => {
        el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true }));
      }, speed);
      await page.evaluate(() => { window.__spellingEvents = []; window.__spellingCompletedAt = null; });
      await page.locator('#readbackButton').click();
      await expect(page.locator('#readbackButton')).toHaveAttribute('aria-label', 'Read it again');
      durations.push(await page.evaluate(() => window.__spellingCompletedAt - window.__spellingEvents[0].at));
      expect((await events(page)).map(event => event.articulation)).toEqual(['k', 'a', 't']);
    }
    expect(durations[0] / durations[1]).toBeGreaterThan(2.8);
    expect(durations[0] / durations[1]).toBeLessThan(5);
    await expect(page.locator('#level')).toHaveValue('0.46');
  });
}

test('live speed changes preserve the elapsed pause, Play, Loop, and Audio consent', async ({ page }) => {
  await observeReadback(page, 'cat.');
  const speed = page.locator('#readbackSpeed');
  await speed.focus(); await speed.press('ArrowRight');
  await expect(speed).toHaveValue('1.05');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#readbackButton')).toHaveAttribute('aria-pressed', 'false');
  await playLoop(page);
  await expect(page.locator('#currentPair')).toHaveText('PHRASE END');
  const timing = await page.evaluate(() => {
    const r = window.__spellingReadback;
    const generation = r.generation, index = r.index;
    const remaining = (r.timerDeadline - performance.now()) * r.timerSpeed;
    const input = document.getElementById('readbackSpeed');
    input.value = '0.5'; input.dispatchEvent(new Event('input', { bubbles: true }));
    return { before: remaining, after: r.timerDeadline - performance.now(), generation, nextGeneration: r.generation, index, nextIndex: r.index };
  });
  expect(timing.after).toBeCloseTo(timing.before * 2, -1);
  expect(timing.nextGeneration).toBe(timing.generation);
  expect(timing.nextIndex).toBe(timing.index);
  await expect(page.locator('#readbackButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#readbackLoop')).toHaveAttribute('aria-pressed', 'true');
  const before = (await events(page)).length;
  await expect.poll(async () => (await events(page)).length).toBeGreaterThan(before);
  await page.locator('#resetButton').click();
  await expect(speed).toHaveValue('1');
  await expect(page.locator('#readbackButton')).toHaveAttribute('aria-pressed', 'false');
});

for (const action of ['Pause', 'Clear', 'Audio off', 'pagehide', 'Reset']) {
  test(`${action} cancels automatic readback continuation during a voice load`, async ({ page }) => {
    await observeReadback(page);
    await playLoop(page);
    await page.evaluate(() => {
      const audio = window.__spellingAudio;
      const select = audio.selectEngine.bind(audio);
      audio.selectEngine = async name => {
        audio.selectEngine = select;
        await new Promise(resolve => { window.__finishVoiceLoad = resolve; });
        return select(name);
      };
    });
    await page.locator('[data-engine=bell]').click();
    await expect(page.locator('#readbackButton')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#readbackButton')).toBeEnabled();
    if (action === 'Pause') await page.locator('#readbackButton').click();
    if (action === 'Clear') await page.locator('#clearButton').click();
    if (action === 'Reset') await page.locator('#resetButton').click();
    if (action === 'Audio off') await page.locator('#audioButton').click();
    if (action === 'pagehide') await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    const before = (await events(page)).length;
    await page.evaluate(() => window.__finishVoiceLoad());
    await expect(page.locator('[data-engine=bell]')).toBeEnabled();
    await page.waitForTimeout(800);
    expect((await events(page)).length).toBe(before);
    await expect(page.locator('#readbackButton')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#readbackLoop')).toHaveAttribute('aria-pressed', action === 'Reset' ? 'false' : 'true');
    if (action === 'Reset') {
      await expect(page.locator('[data-engine=diphone]')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#readbackSpeed')).toHaveValue('1');
    }
    if (['Audio off', 'pagehide'].includes(action)) await waitForStableAudioState(page, false);
  });
}

test('a failed voice change resumes the available engine, not a stuck or second player', async ({ page }) => {
  await observeReadback(page);
  await playLoop(page);
  await page.evaluate(() => {
    window.__spellingAudio.selectEngine = async () => { throw new Error('Voice unavailable in regression test'); };
  });
  const before = (await events(page)).length;
  await page.locator('[data-engine=bell]').click();
  await expect(page.locator('#readbackButton')).toHaveAttribute('aria-label', 'Pause readback');
  await expect(page.locator('[data-engine=diphone]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await events(page)).length).toBeGreaterThan(before + 3);
  expect((await events(page)).every(event => event.engine === 'diphone')).toBe(true);
  await expect(page.locator('#audioError')).toContainText('Voice unavailable');
});

test('rhythm edits update sounding events in an existing loop; letter-pair controls do not pause it', async ({ page }) => {
  await observeReadback(page);
  await playLoop(page);
  const emphasis = [];
  for (const amount of [0, 1]) {
    const before = await page.locator('#rhythmAmount').evaluate((el, value) => {
      el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true }));
      return window.__spellingEvents.filter(event => event.wordSpeech).length;
    }, amount);
    await expect.poll(async () => (await events(page)).length).toBeGreaterThan(before);
    emphasis.push((await events(page))[before].emphasis);
  }
  expect(emphasis[1]).toBeGreaterThan(emphasis[0] + .1);
  await page.locator('#pairGlidesButton').click();
  await page.locator('#diphthongDelay').evaluate(el => {
    el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#readbackButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#readbackLoop')).toHaveAttribute('aria-pressed', 'true');
});

test('the five real voices have comparable measured output with headroom at full master', async ({ page }, testInfo) => {
  test.setTimeout(45000);
  const levels = [];
  for (const engine of ['tube', 'diphone', 'vocoder', 'bell', 'lpc']) {
    await observeReadback(page, 'The quick brown fox. Daisy, give me your answer.');
    await page.locator(`[data-engine=${engine}]`).click();
    await page.locator('#level').evaluate(el => {
      el.value = '.82'; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#audioButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(async () => {
      const backend = window.__spellingAudio.backends[window.__spellingAudio.activeEngine];
      const context = backend.context;
      const code = `class Meter extends AudioWorkletProcessor {
        constructor() { super(); this.peak=0;this.bad=0;this.square=0;this.count=0;this.blockSquare=0;this.blockCount=0;
          this.port.onmessage=()=>this.port.postMessage({peak:this.peak,bad:this.bad,rms:Math.sqrt(this.square/this.count)}); }
        process(inputs) { for(const value of inputs[0]?.[0]??[]) {
          if(!Number.isFinite(value))this.bad++;
          this.peak=Math.max(this.peak,Math.abs(value));this.blockSquare+=value*value;this.blockCount++;
          if(this.blockCount>=sampleRate/10){if(this.blockSquare/this.blockCount>.000009){this.square+=this.blockSquare;this.count+=this.blockCount;}this.blockSquare=0;this.blockCount=0;}
        } return true; }
      } registerProcessor('spelling-level-check',Meter);`;
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      await context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(context, 'spelling-level-check');
      const silent = context.createGain(); silent.gain.value = 0;
      backend.output.connect(node); node.connect(silent).connect(context.destination);
      window.__levelCapture = { backend, node, silent };
    });
    await page.locator('#readbackButton').click();
    await expect(page.locator('#readbackButton')).toHaveAttribute('aria-label', 'Read it again', { timeout: 10000 });
    const level = await page.evaluate(() => new Promise(resolve => {
      const { node, silent, backend } = window.__levelCapture;
      node.port.onmessage = event => {
        backend.output.disconnect(node); node.disconnect(); silent.disconnect(); resolve(event.data);
      };
      node.port.postMessage('measure');
    }));
    expect(level.bad).toBe(0);
    expect(level.peak).toBeLessThan(.95);
    expect(level.rms).toBeGreaterThan(.07);
    expect(level.rms).toBeLessThan(.18);
    levels.push({ engine, ...level, activeDb: 20 * Math.log10(level.rms) });
    await page.locator('#audioButton').click();
  }
  await testInfo.attach('voice-levels.json', { body: JSON.stringify(levels), contentType: 'application/json' });
  const decibels = levels.map(level => level.activeDb);
  expect(Math.max(...decibels) - Math.min(...decibels)).toBeLessThan(4);
});
