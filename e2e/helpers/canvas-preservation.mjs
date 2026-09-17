import { expect } from "@playwright/test";

export const canvasLayouts = [
  { name: "desktop", width: 1440, height: 900, dpr: 1, touch: false },
  { name: "phone-portrait", width: 390, height: 844, dpr: 3, touch: true },
  { name: "phone-landscape", width: 844, height: 390, dpr: 2, touch: true },
];

async function canvasMetrics(page) {
  return page.evaluate(() => {
    const bounds = document.getElementById("stageWrap").getBoundingClientRect();
    const canvas = document.getElementById("stage");
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    // Frozen rule from 4e9feed, deliberately independent of the runtime helper.
    const ratio = Math.max(1, Math.min(
      window.devicePixelRatio || 1,
      2,
      Math.sqrt(3_000_000 / (width * height)),
    ));
    return {
      cssWidth: width,
      cssHeight: height,
      devicePixelRatio: window.devicePixelRatio,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      expectedWidth: Math.round(width * ratio),
      expectedHeight: Math.round(height * ratio),
    };
  });
}

export async function expectCanvasSizing(page) {
  await expect.poll(async () => {
    const value = await canvasMetrics(page);
    return value.canvasWidth === value.expectedWidth && value.canvasHeight === value.expectedHeight;
  }).toBe(true);
  return canvasMetrics(page);
}

export async function attachJson(testInfo, name, value) {
  await testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: "application/json" });
}

export async function captureSettledLayout(page, testInfo) {
  // Initial control discovery flashes the MIDI preview for 180 ms. Compare
  // settled layouts, not different moments in the same existing transition.
  await expect(page.locator(".midi-output-monitor-card.is-updated")).toHaveCount(0);
  await testInfo.attach("reference-layout.png", {
    body: await page.screenshot({ animations: "disabled" }),
    contentType: "image/png",
  });
}
