import { expect, test } from "@playwright/test";

import {
  readAudioStatus,
  sampleAudioEnvelope,
  waitForAudioState,
  waitForStableAudioState,
} from "./helpers/audio-probe.mjs";

const surfaces = [
  { id: "moebius", href: "moebius.html" },
  { id: "klein-bottle", href: "klein-bottle.html" },
];

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

for (const surface of surfaces) {
  test(`${surface.id} keeps its 2D playhead, transport, view, and audio causally separate`, async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto(surface.href, { waitUntil: "load" });
    const canvas = page.locator("#stage");
    const play = page.locator("#playButton");
    const audio = page.locator("#audioButton");
    await expect(canvas).toBeVisible();
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).active).toBe(false);

    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#liveStatus")).toHaveText(
      "Audio is off — turn it on to hear playback",
    );

    await canvas.focus();
    const positionBefore = Number(await page.locator("#position").inputValue());
    await page.keyboard.press("ArrowRight");
    expect(Number(await page.locator("#position").inputValue())).toBeGreaterThan(positionBefore);
    const yawBefore = Number(await page.locator("#planeYaw").inputValue());
    await page.keyboard.press("Shift+BracketLeft");
    expect(Number(await page.locator("#planeYaw").inputValue())).toBe(yawBefore - 12);
    await page.keyboard.press("Home");
    expect(Number(await page.locator("#position").inputValue())).toBeCloseTo(0.5, 1);

    const autoRotate = page.locator("#autoRotateButton");
    await page.locator('[data-section="rotation"]').evaluate((details) => { details.open = true; });
    await autoRotate.click();
    await expect(autoRotate).toHaveAttribute("aria-pressed", "true");
    await setRange(page, "#rotationSpeed", 0.08);
    await expect(autoRotate).toHaveAttribute("aria-pressed", "true");
    await setRange(page, "#rotationX", 16);
    await expect(autoRotate).toHaveAttribute("aria-pressed", "false");

    await page.locator("[data-preset]").last().click();
    await expect(play).toHaveAttribute("aria-pressed", "true");

    await audio.click();
    await expect(audio).toHaveAttribute("aria-pressed", "true");
    await waitForAudioState(page, true);
    const envelope = await sampleAudioEnvelope(page, { durationMs: 700, intervalMs: 50 });
    await testInfo.attach(`${surface.id}-audio-envelope.json`, {
      body: JSON.stringify(envelope, null, 2),
      contentType: "application/json",
    });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.activeSamples).toBeGreaterThan(0);
    expect(envelope.summary.maxPeak).toBeGreaterThan(0.001);
    expect(envelope.summary.clippedSamples).toBe(0);

    await audio.click();
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await waitForStableAudioState(page, false);
    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "false");
    expect(errors).toEqual([]);
  });
}

test.describe("touch-sized responsive topology controls", () => {
  test.use({ hasTouch: true });

  for (const surface of surfaces) {
    test(`${surface.id} stays reachable at required viewports`, async ({ page }) => {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(surface.href, { waitUntil: "load" });

        const layout = await page.evaluate(() => {
          const rect = (selector) => {
            const box = document.querySelector(selector)?.getBoundingClientRect();
            return box ? {
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
              width: box.width,
              height: box.height,
            } : null;
          };
          const identity = rect(".topology-identity");
          const target = rect(".topology-target-switch");
          const overlaps = identity && target
            ? !(identity.right <= target.left || target.right <= identity.left
              || identity.bottom <= target.top || target.bottom <= identity.top)
            : true;
          return {
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            panelOverflow: document.querySelector(".topology-panel").scrollWidth
              - document.querySelector(".topology-panel").clientWidth,
            canvas: rect("#stage"),
            overlaps,
          };
        });

        expect(layout.documentOverflow).toBeLessThanOrEqual(1);
        expect(layout.panelOverflow).toBeLessThanOrEqual(1);
        expect(layout.canvas.width).toBeGreaterThan(100);
        expect(layout.canvas.height).toBeGreaterThan(100);
        if (viewport.height <= 430) expect(layout.overlaps).toBe(false);

        for (const selector of [
          "#audioButton",
          "#playButton",
          "#directionButton",
          "#resetAll",
        ]) {
          const box = await page.locator(selector).boundingBox();
          expect(box.width, `${selector} width at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(48);
          expect(box.height, `${selector} height at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(48);
        }

        const stage = page.locator("#stage");
        await page.locator("#selectPlayhead").click();
        const box = await stage.boundingBox();
        await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
        await page.mouse.down();
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
        await page.mouse.up();
        await expect(page.locator("#stageWrap")).not.toHaveClass(/is-dragging/);
      }
    });
  }
});
