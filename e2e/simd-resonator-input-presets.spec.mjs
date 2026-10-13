import { expect, test } from "@playwright/test";

const read = page => page.evaluate(() => globalThis.__MORPHAZOID_SIMD_RESONATOR__.getState());
async function preset(page, id) {
  await page.locator(".header-preset-picker > summary").click();
  await page.locator(`button[data-preset-id="resonator:${id}"]`).click();
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
  await page.goto("simd-resonator.html");
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "unselected");
  await expect(page.locator("button[data-full-preset]")).toHaveCount(12);
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
  await page.goto("simd-resonator.html");
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
  await page.goto("simd-resonator.html");
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
  await page.goto("simd-resonator.html");
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
  await page.goto("simd-resonator.html");
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
    await page.setViewportSize(viewport); await page.goto("simd-resonator.html");
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
  expect((await read(page)).availableEngines).toHaveLength(7);
  await expect(page.locator("#presetSelect")).toBeVisible();
});
