import { expect, test } from "@playwright/test";

import { settlePage } from "./helpers/diagnostics.mjs";

const route = "/spiral.html";

async function loadProductionPage(page) {
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `${route} returned HTTP ${response?.status()}`).toBe(true);
  await expect(page.locator('link[rel="stylesheet"][href="style.css"]')).toHaveCount(1);
  await settlePage(page);
}

async function controlMetrics(page) {
  return page.evaluate(() => {
    const measure = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`Missing control: ${selector}`);
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        height: rect.height,
        minHeight: style.minHeight,
        minWidth: style.minWidth,
        width: rect.width,
      };
    };

    return {
      audio: measure("#audioButton"),
      choice: measure("#timePath button"),
      miniAction: measure("#sizeCoupling"),
      play: measure("#playButton"),
    };
  });
}

test("shared legacy controls retain their desktop production geometry", async ({ page }) => {
  await loadProductionPage(page);
  const metrics = await controlMetrics(page);

  expect(metrics.audio.width).toBe(44);
  expect(metrics.audio.height).toBe(44);
  expect(metrics.audio.backgroundColor).not.toMatch(/^(?:transparent|rgba\(0, 0, 0, 0\))$/u);

  expect(metrics.miniAction.minHeight).toBe("32px");
  expect(metrics.miniAction.height).toBe(32);
  expect(metrics.miniAction.minWidth).not.toBe("44px");
  expect(metrics.miniAction.width).toBeGreaterThan(44);

  expect(metrics.play.width).toBe(44);
  expect(metrics.play.height).toBe(44);

  expect(metrics.choice.minHeight).toBe("40px");
  expect(metrics.choice.height).toBe(40);
});

test.describe("coarse pointer", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("audio and play controls retain 48px touch targets", async ({ page }) => {
    await loadProductionPage(page);
    await expect.poll(() => page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const metrics = await controlMetrics(page);

    expect(metrics.audio.width).toBe(48);
    expect(metrics.audio.height).toBe(48);
    expect(metrics.play.width).toBe(48);
    expect(metrics.play.height).toBe(48);
  });
});
