import { expect, test } from "@playwright/test";

const pages = [
  { id: "birdsong-lab", ready: "#labStatus[data-state=ready]", play: "#playOriginal", loop: "#loopPlayback" },
  { id: "crickets", ready: "html[data-crickets-ready=true]", play: "#play-input", loop: "#loop-toggle" },
  { id: "nightingale-manifold", ready: "html[data-nightingale-manifold-ready=true]", play: "#play-route", loop: "#loop-route" },
  { id: "acoustic-manifold", ready: "html[data-acoustic-manifold-ready=true]", play: "#play-route", loop: "#loop-route" },
];

async function outputStatus(page) {
  return page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    const manager = getSharedAudioOutputManager();
    return { ...manager.sample(), connections: manager.connectionCount() };
  });
}

async function audibleOutput(page) {
  let audible;
  // Short chirps can fall entirely between Playwright's default 1 s polls.
  await expect.poll(async () => {
    audible = await outputStatus(page);
    return audible.peak;
  }, { intervals: [20] }).toBeGreaterThan(0.01);
  return audible;
}

async function peakOverWindow(page, durationMs) {
  return page.evaluate(async durationMs => {
    const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    const manager = getSharedAudioOutputManager();
    const endAt = performance.now() + durationMs;
    let peak = 0;
    do {
      peak = Math.max(peak, manager.sample().peak);
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (performance.now() < endAt);
    return peak;
  }, durationMs);
}

for (const config of pages) {
  test(`${config.id} local media reaches the shared stereo output after native volume`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/${config.id}.html`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(config.ready)).toBeAttached({ timeout: 20_000 });
    expect((await outputStatus(page)).connections).toBe(0);
    if (config.id.includes("manifold")) await page.locator("#listen-mode").selectOption("recording");
    if (config.id === "acoustic-manifold") await page.locator("#build-route").click();
    await page.locator(config.loop).check();
    await page.locator(config.play).click();
    await expect.poll(async () => (await outputStatus(page)).connections).toBe(1);
    const audible = await audibleOutput(page);
    expect(audible.leftPeak).toBeGreaterThan(0);
    expect(audible.rightPeak).toBeCloseTo(audible.leftPeak, 5);

    await page.locator("#level").evaluate(control => {
      control.value = "0";
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect.poll(async () => (await outputStatus(page)).peak).toBe(0);
    if (config.id === "crickets") {
      // Cover the entire 4.2 s demo, so a natural chirp gap cannot prove mute.
      expect(await peakOverWindow(page, 4_500)).toBe(0);
    }
    await page.locator("#level").evaluate(control => {
      control.value = "0.6";
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await audibleOutput(page);
    expect((await outputStatus(page)).connections).toBe(1);
    expect(errors).toEqual([]);
  });
}
