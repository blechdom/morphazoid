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
    await expect.poll(async () => (await outputStatus(page)).peak).toBeGreaterThan(0.01);
    const audible = await outputStatus(page);
    expect(audible.leftPeak).toBeGreaterThan(0);
    expect(audible.rightPeak).toBeCloseTo(audible.leftPeak, 5);

    await page.locator("#level").evaluate(control => {
      control.value = "0";
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect.poll(async () => (await outputStatus(page)).peak).toBe(0);
    await page.locator("#level").evaluate(control => {
      control.value = "0.6";
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect.poll(async () => (await outputStatus(page)).peak).toBeGreaterThan(0.01);
    expect((await outputStatus(page)).connections).toBe(1);
    expect(errors).toEqual([]);
  });
}
