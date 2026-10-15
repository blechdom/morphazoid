import { expect, test } from "@playwright/test";

const read = page => page.evaluate(() => globalThis.__MORPHAZOID_RUST_RESONATOR__.getState());
async function preset(page, id) {
  await page.locator(".header-preset-picker > summary").click();
  await page.locator(`button[data-preset-id="classic:resonator:${id}"]`).click();
}
async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
function wav(seconds = .12) {
  const rate = 48000, frames = Math.round(rate * seconds), bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let index = 0; index < frames; index++) bytes.writeInt16LE(Math.round(Math.sin(index * 440 * Math.PI * 2 / rate) * 8000), 44 + index * 2);
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
  await page.locator("#inputSource").selectOption("sample-file");
  await page.locator("#inputSample").selectOption("music-plucks");
  await page.locator("#inputPlay").click();
  expect((await read(page)).audioOn).toBe(false);
  expect((await read(page)).input.playing).toBe(false);
  expect(await page.evaluate(() => globalThis.__micRequests)).toBe(0);
});

test("sample feeds the FFT while preset, Next, dice and tweaks preserve its source and levels", async ({ page }) => {
  await page.goto("simd-resonator-rust.html");
  await page.locator("#inputSource").selectOption("sample-file");
  await page.locator("#inputSample").selectOption("music-arp");
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
  await page.locator("#inputSource").selectOption("sample-file");
  await page.locator("#inputSample").selectOption("music-plucks");
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await read(page)).audioOn).toBe(true);
  await expect.poll(async () => (await read(page)).input.pending).toBe(true);
  await page.locator("#inputPlay").click();
  expect((await read(page)).input.pending).toBe(false);
  await page.locator("#inputPlay").click();
  await expect.poll(async () => (await read(page)).input.pending).toBe(true);
  await page.locator("#inputSource").selectOption("mic");
  expect((await read(page)).input).toMatchObject({ mode: "mic", playing: false, pending: false });
  await page.locator("#inputSource").selectOption("sample-file");
  await expect.poll(async () => (await read(page)).input.pending).toBe(true);
  await page.locator("#audioButton").click();
  release();
  await expect.poll(async () => (await read(page)).contextState).toBe("none");
  expect((await read(page)).input).toMatchObject({ playing: false, pending: false });
  expect((await read(page)).inputPlaybackRevision).toBe(0);
});

test("short speech input repeats past its third loop without restarting its source", async ({ page }) => {
  await page.goto("simd-resonator-rust.html");
  await page.locator("#inputSource").selectOption("sample-file");
  await page.locator("#inputSample").selectOption("speech");
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

test("uploaded audio stays muted until Audio is armed, ends once, and can replay", async ({ page }) => {
  await page.goto("simd-resonator-rust.html");
  await page.locator("#inputSource").selectOption("file");
  await page.locator("#inputFile").setInputFiles({ name: "short-tone.wav", mimeType: "audio/wav", buffer: wav() });
  await expect.poll(async () => (await read(page)).input.pending).toBe(false);
  expect((await read(page)).audioOn).toBe(false);
  expect((await read(page)).input).toMatchObject({ hasFile: true, playing: false });
  await page.locator("#inputLoop").uncheck();
  await page.locator("#audioButton").click();
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
    await page.locator("#inputSource").selectOption("sample-file");
    await page.locator("#inputPlay").scrollIntoViewIfNeeded();
    await expect(page.locator("#inputPlay")).toBeVisible();
    await page.locator("#inputSample").scrollIntoViewIfNeeded();
    await expect(page.locator("#inputSample")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.goto("simd-lab.html");
  await expect(page.locator(".header-preset-controls, #inputSource")).toHaveCount(0);
  expect((await page.evaluate(() => globalThis.__MORPHAZOID_SIMD_RESONATOR__.getState())).availableEngines).toHaveLength(7);
  await expect(page.locator("#presetSelect")).toBeVisible();
});

test('all twenty presets retain live input; maximum bank keeps rendering through a UI stall', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('simd-resonator-rust.html');
  await page.locator('#inputSource').selectOption('sample-file');
  await page.locator('#inputSample').selectOption('music-arp');
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
  await setRange(page, 'controlA', 4096); await setRange(page, 'spectralSpan', 128);
  await page.locator('#fftSize').selectOption('4096'); await setRange(page, 'fftHopRatio', .125);
  await expect.poll(async () => (await read(page)).renderedModeCount).toBe(4096);
  const before = await read(page);
  await page.evaluate(() => { const until = performance.now() + 450; while (performance.now() < until) {} });
  await expect.poll(async () => (await read(page)).renderedFrames).toBeGreaterThan(before.renderedFrames + 12000);
  const after = await read(page);
  expect(after.inputPlaybackRevision).toBe(initial.inputPlaybackRevision);
  expect(after.audioOn).toBe(true); expect(after.input.playing).toBe(true);
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
    for (const id of ['controlA', 'spectralSpan', 'hardness', 'fftHighFrequency', 'resetButton']) {
      await page.locator('#' + id).scrollIntoViewIfNeeded(); await expect(page.locator('#' + id)).toBeVisible();
    }
    await page.locator('#controlA').scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.simd-control-list label.mz-range-knob')];
      return labels.map(label => {
        const field = label.getBoundingClientRect(), dial = label.querySelector('.mz-range-knob__dial').getBoundingClientRect(), output = label.querySelector('output').getBoundingClientRect();
        return { width: field.width, height: field.height, separated: output.top >= dial.bottom };
      });
    });
    expect(geometry.every(item => item.width >= 44 && item.height >= 66 && item.separated)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath('rust-resonator-controls.png') });
  });
}
