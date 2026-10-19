import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const read = page => page.evaluate(() => globalThis.__MORPHAZOID_RUST_RESONATOR__.getState());

test('Rezoidinator places only microphone controls in the menubar and keeps compact source controls beside the body', async ({ page }) => {
  await page.goto('simd-resonator-rust.html');
  await expect(page.locator('h1')).toHaveText('Rezoidinator');
  await expect(page.locator('.masthead #micButton')).toHaveCount(1);
  await expect(page.locator('.panel #inputSource')).toHaveCount(1);
  await expect(page.locator('.panel [data-select-id="inputSource"]')).toBeVisible();
  await expect(page.locator('#inputStatus')).toHaveCount(0);
  await expect(page.getByText('Mic stays local. Use headphones to prevent feedback.', { exact: true })).toHaveCount(0);
  const pluck = await page.locator('#pluckButton').boundingBox();
  expect(pluck.height).toBeLessThanOrEqual(36); expect(pluck.width).toBeLessThan(120);
  await choose(page, 'inputSource', 'file');
  await expect(page.locator('#chooseInputFile')).toBeVisible();
  const input = await page.locator('#inputPlay').boundingBox();
  expect(input.width).toBe(input.height); expect(input.height).toBeLessThanOrEqual(36);
});

test('surround presets and routing preserve live input, output level and recording channels', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('simd-resonator-rust.html');
  await choose(page, 'inputSource', 'sample-file'); await choose(page, 'inputSample', 'music-arp');
  await toggle(page, 'surroundEnabled'); await choose(page, 'surroundLayout', '7-4-1');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).input.playing).toBe(true);
  await expect.poll(async () => (await read(page)).spatialEnabled).toBe(true);
  await expect.poll(async () => (await read(page)).spatialPeaks.filter(value => value > .00001).length).toBeGreaterThan(3);
  await setRange(page, 'outputLevel', .35);
  const before = await read(page);
  await choose(page, 'surroundLayout', '16-ring');
  await expect.poll(async () => (await read(page)).surround.channelCount).toBe(16);
  await choose(page, 'surroundLayout', '7-4-1');
  await expect.poll(async () => (await read(page)).surround.channelCount).toBe(12);
  await page.locator('#multitrackRecord').click();
  await expect.poll(async () => (await read(page)).recording.state).toBe('recording');
  await expect(page.locator('#surroundEnabled')).toBeDisabled(); await expect(page.locator('#surroundLayout')).toBeDisabled();
  await toggle(page, 'surroundPreview');
  await page.locator('.header-preset-random').click(); await preset(page, 'vowel-glass');
  const after = await read(page);
  expect(after.inputPlaybackRevision).toBe(before.inputPlaybackRevision);
  expect(after.surround).toMatchObject({ enabled: true, layoutId: '7-4-1', forcePreview: true, channelCount: 12 });
  expect(after.recording.state).toBe('recording'); expect(after.outputLevel).toBeCloseTo(.35);
  await expect.poll(async () => (await read(page)).recording.seconds).toBeGreaterThan(.4);
  await page.locator('#multitrackRecord').click();
  await expect(page.locator('#multitrackDialog')).toBeVisible();
  const downloadPromise = page.waitForEvent('download'); await page.locator('#multitrackWav').click();
  const download = await downloadPromise; const path = info.outputPath('rezoidinator-12ch.wav'); await download.saveAs(path);
  const bytes = await readFile(path);
  expect(bytes.readUInt16LE(22)).toBe(12); expect(bytes.readUInt16LE(34)).toBe(24);
  let data = 12;
  while (bytes.toString('ascii', data, data + 4) !== 'data') data += 8 + bytes.readUInt32LE(data + 4);
  const size = bytes.readUInt32LE(data + 4); data += 8;
  const layout = await page.evaluate(async () => (await import('./src/instruments/spartial/spartial-audio.js')).spartialLayout('7-4-1'));
  const lfe = layout.speakers.find(speaker => speaker.kind === 'lfe').channel - 1;
  const peaks = new Array(12).fill(0), signatures = new Array(12).fill(0);
  for (let offset = data, frame = 0; offset < data + size; offset += 36, frame++) for (let channel = 0; channel < 12; channel++) {
    const value = bytes.readIntLE(offset + channel * 3, 3); peaks[channel] = Math.max(peaks[channel], Math.abs(value));
    signatures[channel] += value * (1 + frame % 13);
  }
  expect(peaks[lfe]).toBe(0); expect(peaks.filter(peak => peak > 10).length).toBeGreaterThan(3);
  expect(new Set(signatures).size).toBeGreaterThan(4); expect(download.suggestedFilename()).toMatch(/^rezoidinator-.*multichannel\.wav$/);
  await page.locator('#multitrackDiscard').click();
  await page.locator('#multitrackRecord').click();
  await expect.poll(async () => (await read(page)).recording.state).toBe('recording');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).contextState).toBe('none');
  await expect.poll(async () => (await read(page)).recording.state).toBe('ready');
  expect(errors).toEqual([]);
});

test('surround controls and recording remain reachable on coarse-pointer phone layouts', async ({ browser }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(test.info().project.use.baseURL + 'simd-resonator-rust.html');
    await toggle(page, 'surroundEnabled'); await choose(page, 'surroundLayout', '16-ring');
    await page.locator('#spaceRate').scrollIntoViewIfNeeded(); await expect(page.locator('#spaceRate')).toBeVisible();
    await page.locator('#multitrackRecord').scrollIntoViewIfNeeded(); await expect(page.locator('#multitrackRecord')).toBeVisible();
    await page.locator('#pluckButton').scrollIntoViewIfNeeded();
    const pluck = await page.locator('#pluckButton').boundingBox(); expect(pluck.height).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await context.close();
  }
});
async function choose(page, id, value) {
  const index = await page.locator('#' + id).evaluate((select, next) => [...select.options].findIndex(option => option.value === next), value);
  await page.locator(`[data-select-id="${id}"] > summary`).click();
  await page.locator(`[data-select-id="${id}"] button[data-option-index="${index}"]`).click();
}
async function toggle(page, id) { await page.locator(`label[for="${id}"]`).click(); }
async function preset(page, id) {
  await page.locator(".header-preset-picker > summary").click();
  await page.locator(`button[data-preset-id="classic:resonator:${id}"]`).click();
}
async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
function wav(seconds = .12, channels = 1) {
  const rate = 48000, frames = Math.round(rate * seconds), bytes = Buffer.alloc(44 + frames * channels * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28); bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(frames * channels * 2, 40);
  // Stereo fixture has sound only on the right: both input channels must reach
  // mono FFT analysis even though the separate output bank is discrete.
  for (let index = 0; index < frames; index++) bytes.writeInt16LE(Math.round(Math.sin(index * 440 * Math.PI * 2 / rate) * 8000), 44 + (index * channels + channels - 1) * 2);
  return bytes;
}

test("full presets, dice and source choices leave Audio off and never request microphone permission", async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__micRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => { globalThis.__micRequests++; throw new Error("Unexpected microphone request"); };
  });
  await page.goto("simd-resonator-rust.html");
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "unselected");
  await expect(page.locator("button[data-full-preset]")).toHaveCount(20);
  await preset(page, "spectral-fog");
  expect((await read(page)).settings.fftResponseMs).toBe(620);
  await page.locator(".header-preset-next").click();
  await page.locator(".header-preset-random").click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
  await choose(page, "inputSource", "sample-file");
  await choose(page, "inputSample", "music-plucks");
  await page.locator("#inputPlay").click();
  expect((await read(page)).audioOn).toBe(false);
  expect((await read(page)).input.playing).toBe(false);
  expect(await page.evaluate(() => globalThis.__micRequests)).toBe(0);
});

test("sample feeds the FFT while preset, Next, dice and tweaks preserve its source and levels", async ({ page }) => {
  await page.goto("simd-resonator-rust.html");
  await choose(page, 'applicationMode', 'resynthesis');
  await choose(page, "inputSource", "sample-file");
  await choose(page, "inputSample", "music-arp");
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await read(page)).input.playing).toBe(true);
  await expect.poll(async () => (await read(page)).fftInputPeak).toBeGreaterThan(.0001);
  await expect.poll(async () => (await read(page)).fftOutputPeak).toBeGreaterThan(.00001);
  await page.locator('.mz-audio-input-strip input[type="range"]').evaluate(input => {
    input.value = "1.3"; input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await setRange(page, "outputLevel", .37);
  const before = await read(page);
  await preset(page, "glass");
  await page.locator(".header-preset-next").click();
  await page.locator(".header-preset-random").click();
  await preset(page, "vowel-glass");
  await setRange(page, "fftResponseMs", 170);
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
  const after = await read(page);
  expect(after.inputPlaybackRevision).toBe(before.inputPlaybackRevision);
  expect(after.input).toMatchObject({ sampleId: "music-arp", playing: true, loop: true });
  expect(after.audioOn).toBe(true); expect(after.inputGain).toBe(1.3); expect(after.outputLevel).toBeCloseTo(.37);
  expect(after.contextTime).toBeGreaterThan(before.contextTime); expect(after.micOn).toBe(false);
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await read(page)).input.playing).toBe(false);
});

test("pending sample fetches cannot restart after Stop, source change or Audio off", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/assets/synthesis/loops/plucked-strings.wav", async route => {
    await gate;
    await route.fulfill({ contentType: "audio/wav", body: wav() }).catch(() => {});
  });
  await page.goto("simd-resonator-rust.html");
  await choose(page, "inputSource", "sample-file");
  await choose(page, "inputSample", "music-plucks");
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await read(page)).audioOn).toBe(true);
  await expect.poll(async () => (await read(page)).input.pending).toBe(true);
  await page.locator("#inputPlay").click();
  expect((await read(page)).input.pending).toBe(false);
  await page.locator("#inputPlay").click();
  await expect.poll(async () => (await read(page)).input.pending).toBe(true);
  await choose(page, "inputSource", "mic");
  expect((await read(page)).input).toMatchObject({ mode: "mic", playing: false, pending: false });
  await choose(page, "inputSource", "sample-file");
  await expect.poll(async () => (await read(page)).input.pending).toBe(true);
  await page.locator("#audioButton").click();
  release();
  await expect.poll(async () => (await read(page)).contextState).toBe("none");
  expect((await read(page)).input).toMatchObject({ playing: false, pending: false });
  expect((await read(page)).inputPlaybackRevision).toBe(0);
});

test("short speech input repeats past its third loop without restarting its source", async ({ page }) => {
  await page.goto("simd-resonator-rust.html");
  await choose(page, "inputSource", "sample-file");
  await choose(page, "inputSample", "speech");
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await read(page)).input.playing).toBe(true);
  const initial = await read(page);
  // The speech buffer lasts 2.326 s. An active source flag alone did not catch
  // Chrome 152 falling silent after its first native buffer wrap.
  await expect.poll(async () => (await read(page)).contextTime, { timeout: 8000 }).toBeGreaterThan(initial.contextTime + 5);
  await expect.poll(async () => (await read(page)).fftInputPeak).toBeGreaterThan(.1);
  const repeated = await read(page);
  expect(repeated.inputPlaybackRevision).toBe(initial.inputPlaybackRevision);
  expect(repeated.input).toMatchObject({ sampleId: "speech", playing: true, loop: true });
});

test("uploaded stereo audio reaches mono analysis, stays muted until Audio is armed, ends once, and can replay", async ({ page }) => {
  await page.goto("simd-resonator-rust.html");
  await choose(page, "inputSource", "file");
  await page.locator("#inputFile").setInputFiles({ name: "short-tone.wav", mimeType: "audio/wav", buffer: wav(.5, 2) });
  await expect.poll(async () => (await read(page)).input.pending).toBe(false);
  expect((await read(page)).audioOn).toBe(false);
  expect((await read(page)).input).toMatchObject({ hasFile: true, playing: false });
  await toggle(page, "inputLoop");
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await read(page)).fftInputPeak).toBeGreaterThan(.01);
  await expect.poll(async () => (await read(page)).input.ended).toBe(true);
  expect((await read(page)).inputPlaybackRevision).toBe(1);
  await page.locator("#inputPlay").click();
  await expect.poll(async () => (await read(page)).inputPlaybackRevision).toBe(2);
  await expect.poll(async () => (await read(page)).input.ended).toBe(true);
});

test("new controls remain reachable at desktop and phone sizes; Lab keeps its focused picker", async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); await page.goto("simd-resonator-rust.html");
    await expect(page.locator(".header-preset-picker")).toBeVisible();
    await choose(page, "inputSource", "sample-file");
    await page.locator("#inputPlay").scrollIntoViewIfNeeded();
    await expect(page.locator("#inputPlay")).toBeVisible();
    await page.locator('[data-select-id="inputSample"] > summary').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-select-id="inputSample"] > summary')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.goto("simd-lab.html");
  // The Lab gained its own full preset and source controls on main; the
  // exclusive role picker remains specific to Rezoidinator.
  await expect(page.locator('.header-preset-controls')).toHaveCount(1);
  await expect(page.locator('#inputSource')).toHaveCount(1);
  await expect(page.locator('#applicationMode')).toHaveCount(0);
  expect((await page.evaluate(() => globalThis.__MORPHAZOID_SIMD_RESONATOR__.getState())).availableEngines).toHaveLength(7);
  await expect(page.locator("#presetSelect")).toBeVisible();
});

test('all twenty presets retain live input; maximum bank keeps rendering through a UI stall', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('simd-resonator-rust.html');
  await choose(page, "inputSource", 'sample-file');
  await choose(page, "inputSample", 'music-arp');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).input.playing).toBe(true);
  const initial = await read(page);
  const bank = await page.evaluate(async () => (await import('./src/instruments/simd-resonator-rust/presets.js')).PRESETS);
  for (const scene of bank) {
    await page.locator('.header-preset-next').click();
    await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', scene.id);
    expect((await read(page)).settings).toEqual(scene.snapshot);
  }
  await page.locator('.header-preset-next').click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', bank[0].id);
  await choose(page, 'applicationMode', 'body');
  await setRange(page, 'controlA', 4096); await setRange(page, 'spectralSpan', 128);
  await choose(page, 'applicationMode', 'resynthesis');
  await page.locator('#fftSize').selectOption('4096'); await setRange(page, 'fftHopRatio', .125);
  await toggle(page, 'surroundEnabled'); await choose(page, 'surroundLayout', '16-ring');
  await toggle(page, 'spaceMotion'); await setRange(page, 'spaceRate', .2);
  await expect.poll(async () => (await read(page)).spatialEnabled).toBe(true);
  await expect.poll(async () => (await read(page)).renderedModeCount).toBe(4096);
  const before = await read(page);
  await page.evaluate(() => { const until = performance.now() + 450; while (performance.now() < until) {} });
  await expect.poll(async () => (await read(page)).renderedFrames).toBeGreaterThan(before.renderedFrames + 12000);
  const after = await read(page);
  expect(after.inputPlaybackRevision).toBe(initial.inputPlaybackRevision);
  expect(after.audioOn).toBe(true); expect(after.input.playing).toBe(true);
  expect(after.spatialPeaks.every(value => Number.isFinite(value) && value <= .951)).toBe(true);
  await expect.poll(async () => (await read(page)).fftOutputPeak).toBeGreaterThan(.01);
  expect(errors).toEqual([]);
});

test('Rust scalar fallback is independently playable at the maximum count', async ({ page }) => {
  await page.goto('simd-resonator-rust.html?scalar=1');
  await setRange(page, 'controlA', 4096);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).backend).toBe('scalar');
  await page.locator('#pluckButton').click();
  await expect.poll(async () => (await read(page)).rms).toBeGreaterThan(.005);
  await expect.poll(async () => (await read(page)).renderedModeCount).toBe(4096);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).contextState).toBe('none');
});

test('edits made while the worklet announces readiness reach the actual running bank', async ({ page }) => {
  await page.addInitScript(() => {
    const Native = AudioWorkletNode;
    window.AudioWorkletNode = class extends Native {
      constructor(...args) {
        super(...args);
        this.port.addEventListener('message', event => {
          if (event.data?.type !== 'ready' || event.data.__released) return;
          event.stopImmediatePropagation();
          window.__releaseRustReady = () => this.port.dispatchEvent(new MessageEvent('message', { data: { ...event.data, __released: true } }));
        });
      }
    };
  });
  await page.goto('simd-resonator-rust.html'); await page.locator('#audioButton').click();
  await page.waitForFunction(() => Boolean(window.__releaseRustReady));
  await setRange(page, 'controlA', 4096); await setRange(page, 'spectralSpan', 64);
  await page.evaluate(() => window.__releaseRustReady());
  await expect.poll(async () => (await read(page)).audioOn).toBe(true);
  await expect.poll(async () => (await read(page)).renderedModeCount).toBe(4096);
  expect((await read(page)).settings.spectralSpan).toBe(64);
});

test('a cancelled final context resume cannot rearm output or resurrect the graph', async ({ page }) => {
  await page.addInitScript(() => {
    const Native = AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) { super(...args); this.testResumeCount = 0; }
      resume() {
        this.testResumeCount++;
        if (this.testResumeCount === 2) return new Promise(resolve => { window.__releaseRustResume = resolve; });
        return super.resume();
      }
    };
  });
  await page.goto('simd-resonator-rust.html'); await page.locator('#audioButton').click();
  await page.waitForFunction(() => Boolean(window.__releaseRustResume));
  await page.locator('#audioButton').click();
  await page.evaluate(() => window.__releaseRustResume());
  await expect.poll(async () => (await read(page)).contextState).toBe('none');
  expect((await read(page)).audioOn).toBe(false);
  expect((await read(page)).audioStarting).toBe(false);
  await page.evaluate(() => { delete window.__releaseRustResume; });
  await page.locator('#audioButton').click();
  await page.waitForFunction(() => Boolean(window.__releaseRustResume));
  await page.evaluate(() => window.__releaseRustResume());
  await expect.poll(async () => (await read(page)).audioOn).toBe(true);
  await expect.poll(async () => (await read(page)).contextState).toBe('running');
});

test('microphone cancellation releases late tracks, and live input survives presets until Audio off', async ({ page }) => {
  await page.addInitScript(() => {
    window.__rustMicStreams = [];
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
      const context = new AudioContext(), source = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      source.frequency.value = 220; source.connect(destination); source.start();
      window.__rustMicStreams.push({ context, stream: destination.stream });
      window.__releaseRustMic = () => resolve(destination.stream);
    });
  });
  await page.goto('simd-resonator-rust.html');
  await page.locator('#micButton').click();
  await page.waitForFunction(() => Boolean(window.__releaseRustMic));
  expect((await read(page)).audioOn).toBe(false);
  await page.locator('#micButton').click();
  await page.evaluate(() => window.__releaseRustMic());
  await expect.poll(() => page.evaluate(() => window.__rustMicStreams[0].stream.getTracks()[0].readyState)).toBe('ended');
  expect((await read(page)).micOn).toBe(false);

  await page.evaluate(() => { delete window.__releaseRustMic; });
  await page.locator('#micButton').click();
  await page.waitForFunction(() => Boolean(window.__releaseRustMic));
  await page.evaluate(() => window.__releaseRustMic());
  await expect.poll(async () => (await read(page)).micOn).toBe(true);
  expect((await read(page)).audioOn).toBe(false);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).fftInputPeak).toBeGreaterThan(.01);
  await preset(page, 'glass');
  await page.locator('.header-preset-random').click();
  expect((await read(page)).micOn).toBe(true);
  expect(await page.evaluate(() => window.__rustMicStreams.length)).toBe(2);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).contextState).toBe('none');
  expect(await page.evaluate(() => window.__rustMicStreams.every(({ stream }) => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  await page.evaluate(() => Promise.all(window.__rustMicStreams.map(({ context }) => context.close())));
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`knob labels, wave controls and the stage remain reachable at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport); await page.goto('simd-resonator-rust.html');
    await expect(page.locator('#resonatorCanvas')).toBeVisible(); await expect(page.locator('h1')).toBeVisible();
    for (const [mode, ids] of [['body', ['controlA', 'spectralSpan', 'hardness']], ['resynthesis', ['fftHighFrequency', 'resetButton']]]) {
      await choose(page, 'applicationMode', mode);
      for (const id of ids) {
        await page.locator('#' + id).scrollIntoViewIfNeeded(); await expect(page.locator('#' + id)).toBeVisible();
      }
      const geometry = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('.simd-control-list label.mz-range-knob')].filter(label => label.getClientRects().length);
        return labels.map(label => {
          const field = label.getBoundingClientRect(), dial = label.querySelector('.mz-range-knob__dial').getBoundingClientRect(), output = label.querySelector('output').getBoundingClientRect();
          return { width: field.width, height: field.height, separated: output.top >= dial.bottom };
        });
      });
      expect(geometry.length).toBeGreaterThan(0);
      expect(geometry.every(item => item.width >= 44 && item.height >= 66 && item.separated)).toBe(true);
    }
    await choose(page, 'applicationMode', 'body');
    await page.locator('#controlA').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath('rust-resonator-controls.png') });
  });
}
